/**
 * @module di-container
 * @description Lightweight Dependency Injection Container
 * 
 * Replaces singletons with explicit dependency injection:
 * - TokenManager, QueueManager, and other services
 * - Clear dependency graph
 * - Easy mocking for tests
 * - Explicit lifecycle management
 * 
 * Usage:
 *   const container = await createContainer(config);
 *   const tokenManager = container.resolve('tokenManager');
 * 
 * @version 1.0.0
 */

import { TokenManager } from './token-manager.mjs';
import { TokenStore } from './token-store.mjs';
import { QueueManager } from './queue-manager.mjs';

// ============================================================================
// CONTAINER CLASS
// ============================================================================

/**
 * Dependency Injection Container
 */
export class DIContainer {
  constructor(config = {}) {
    this.config = config;
    this.registry = new Map();
    this.singletons = new Map();
    this.factories = new Map();
  }

  /**
   * Register a factory function for creating instances
   * @param {string} name - Service identifier
   * @param {Function} factory - Factory function receiving container
   * @param {Object} options - Registration options
   * @param {boolean} options.singleton - Create only once (default: true)
   */
  register(name, factory, options = {}) {
    const { singleton = true } = options;
    
    this.factories.set(name, { factory, singleton });
    
    // Clean up any existing instance
    this.singletons.delete(name);
    
    return this;
  }

  /**
   * Register an existing instance (for testing/mocking)
   * @param {string} name - Service identifier
   * @param {*} instance - Pre-created instance
   */
  registerInstance(name, instance) {
    this.singletons.set(name, instance);
    return this;
  }

  /**
   * Resolve a service by name
   * @param {string} name - Service identifier
   * @returns {*} Service instance
   * @throws {Error} if service not registered
   */
  resolve(name) {
    // Return cached singleton
    if (this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    // Create from factory
    const registration = this.factories.get(name);
    if (!registration) {
      throw new Error(`Service not registered: ${name}`);
    }

    const instance = registration.factory(this);

    // Cache if singleton
    if (registration.singleton) {
      this.singletons.set(name, instance);
    }

    return instance;
  }

  /**
   * Check if a service is registered
   * @param {string} name - Service identifier
   * @returns {boolean}
   */
  has(name) {
    return this.singletons.has(name) || this.factories.has(name);
  }

  /**
   * Resolve multiple services
   * @param {Array<string>} names - Service identifiers
   * @returns {Object} Object with named services
   */
  resolveMany(names) {
    const result = {};
    for (const name of names) {
      result[name] = this.resolve(name);
    }
    return result;
  }

  /**
   * Check if a service has been initialized
   * @param {string} name - Service identifier
   * @returns {boolean}
   */
  isInitialized(name) {
    return this.singletons.has(name);
  }

  /**
   * Clear a specific service (forces re-creation)
   * @param {string} name - Service identifier
   */
  clear(name) {
    this.singletons.delete(name);
  }

  /**
   * Clear all services
   */
  clearAll() {
    this.singletons.clear();
  }

  /**
   * Initialize all registered services
   * @returns {Promise<void>}
   */
  async initializeAll() {
    for (const name of this.factories.keys()) {
      const instance = this.resolve(name);
      
      // Call initialize if present
      if (instance?.initialize && typeof instance.initialize === 'function') {
        await instance.initialize();
      }
    }
  }

  /**
   * Dispose all services
   * @returns {Promise<void>}
   */
  async disposeAll() {
    for (const [name, instance] of this.singletons) {
      if (instance?.close && typeof instance.close === 'function') {
        try {
          await instance.close();
        } catch (err) {
          console.error(`[DIContainer] Error disposing ${name}:`, err);
        }
      }
    }
    this.singletons.clear();
  }

  /**
   * Get container health status
   * @returns {Object}
   */
  health() {
    return {
      registeredServices: Array.from(this.factories.keys()),
      initializedServices: Array.from(this.singletons.keys()),
      config: this.config
    };
  }
}

// ============================================================================
// COMPOSITION ROOT
// ============================================================================

/**
 * Create the application container with all services
 * 
 * @param {Object} config - Application configuration
 * @returns {Promise<DIContainer>}
 */
export async function createContainer(config = {}) {
  const container = new DIContainer(config);

  // Token Store - low-level storage
  container.register('tokenStore', (c) => {
    return new TokenStore({
      storePath: config.tokenStore?.path || process.env.MESH_TOKEN_STORE_PATH
    });
  }, { singleton: true });

  // Token Manager - lifecycle management
  container.register('tokenManager', (c) => {
    const tokenStore = c.resolve('tokenStore');
    return new TokenManager({
      tokenStore,
      auditLogPath: config.tokenManager?.auditLogPath || process.env.MESH_TOKEN_AUDIT_PATH,
      rotationInterval: config.tokenManager?.rotationInterval || process.env.MESH_TOKEN_ROTATION_INTERVAL,
      agentId: config.agentId || process.env.MESH_AGENT_ID || 'unknown'
    });
  }, { singleton: true });

  // Queue Manager - message queuing
  container.register('queueManager', (c) => {
    return new QueueManager({
      dbPath: config.queueManager?.dbPath || process.env.MESH_QUEUE_DB_PATH,
      processorInterval: config.queueManager?.processorInterval || process.env.MESH_QUEUE_PROCESSOR_INTERVAL,
      maxRetries: config.queueManager?.maxRetries || 5
    });
  }, { singleton: true });

  // Initialize all services
  await container.initializeAll();

  return container;
}

// ============================================================================
// LEGACY BACKWARD COMPATIBILITY
// ============================================================================

// These will be replaced by container-based resolution
// Maintained for backward compatibility during migration

let _container = null;

/**
 * Get or create global container (backward compatibility)
 * @param {Object} config - Configuration
 * @returns {Promise<DIContainer>}
 */
export async function getContainer(config = {}) {
  if (!_container) {
    _container = await createContainer(config);
  }
  return _container;
}

/**
 * Reset global container (for testing)
 */
export function resetContainer() {
  if (_container) {
    _container.disposeAll();
    _container = null;
  }
}

/**
 * Get a service from global container
 * @param {string} name - Service name
 * @returns {Promise<*>}
 */
export async function getService(name) {
  const container = await getContainer();
  return container.resolve(name);
}

/**
 * Inject dependencies into a function
 * @param {Array<string>} deps - Dependency names
 * @param {Function} fn - Function receiving deps as arguments
 * @returns {Function}
 */
export function inject(deps, fn) {
  return async function(...args) {
    const container = await getContainer();
    const resolved = deps.map(name => container.resolve(name));
    return fn(...resolved, ...args);
  };
}

export default {
  DIContainer,
  createContainer,
  getContainer,
  resetContainer,
  getService,
  inject
};
