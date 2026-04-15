/**
 * @module mocks/config
 * @description Mock configuration loader for testing
 * Provides isolated config without file system dependencies
 */

import { randomUUID } from 'node:crypto';

/**
 * Creates a mock configuration
 * @param {Object} overrides - Config overrides
 * @returns {Object} Mock config object
 */
export function createMockConfig(overrides = {}) {
  const agentId = overrides.agentId || `test-agent-${randomUUID().slice(0, 8)}`;
  
  return {
    // Agent identification
    agentId,
    agentName: overrides.agentName || 'Test Agent',
    
    // Receiver configuration
    receiverPort: overrides.receiverPort || 18801,
    receiverToken: overrides.receiverToken || `test-token-${randomUUID().slice(0, 16)}`,
    receiverHost: overrides.receiverHost || '127.0.0.1',
    
    // Thread manager configuration
    threadPort: overrides.threadPort || 18802,
    threadToken: overrides.threadToken || `thread-token-${randomUUID().slice(0, 16)}`,
    
    // Memory bridge configuration
    bridgePort: overrides.bridgePort || 18803,
    
    // Relay configuration
    relayEnabled: overrides.relayEnabled ?? true,
    relayMaxQueueDepth: overrides.relayMaxQueueDepth || 500,
    relayBatchSize: overrides.relayBatchSize || 10,
    relayFlushInterval: overrides.relayFlushInterval || 5000,
    
    // Peer configuration
    peers: overrides.peers || [],
    // Example peer structure:
    // peers: [
    //   { agentId: 'alice', receiverUrl: 'http://127.0.0.1:18801', token: 'token-a' },
    //   { agentId: 'bob', receiverUrl: 'http://127.0.0.1:18802', token: 'token-b' },
    // ]
    
    // Storage configuration
    storageDir: overrides.storageDir || `/tmp/mesh-memory-test-${randomUUID().slice(0, 8)}`,
    maxStorageSize: overrides.maxStorageSize || 1024 * 1024 * 100, // 100MB
    rotationEnabled: overrides.rotationEnabled ?? true,
    rotationIntervalDays: overrides.rotationIntervalDays || 30,
    
    // Privacy configuration
    privacyKeywords: overrides.privacyKeywords || ['private', 'confidential', 'secret'],
    privateModeDefault: overrides.privateModeDefault ?? false,
    
    // Thread configuration
    threadTimeoutMinutes: overrides.threadTimeoutMinutes || 10,
    threadAutoCloseEnabled: overrides.threadAutoCloseEnabled ?? true,
    
    // Feature flags
    features: {
      relayPipeline: overrides.features?.relayPipeline ?? true,
      threadManager: overrides.features?.threadManager ?? true,
      dreamCycle: overrides.features?.dreamCycle ?? true,
      sharedPool: overrides.features?.sharedPool ?? true,
      blindGate: overrides.features?.blindGate ?? true,
      ...overrides.features,
    },
    
    // Logging
    logLevel: overrides.logLevel || 'silent',
    verbose: overrides.verbose ?? false,
    
    // Test-specific
    _isMock: true,
    _mockId: randomUUID(),
  };
}

/**
 * Creates a config for 3-node mesh testing
 * @param {number} nodeIndex - Which node (0, 1, 2)
 * @returns {Object} Mesh node config
 */
export function createMeshConfig(nodeIndex) {
  const ports = [18801, 18802, 18803];
  const tokens = [
    'token-alice-mesh-001',
    'token-bob-mesh-002',
    'token-charlie-mesh-003',
  ];
  const names = ['alice', 'bob', 'charlie'];
  
  const myPort = ports[nodeIndex];
  const myToken = tokens[nodeIndex];
  const myName = names[nodeIndex];
  
  // Create peers list (all except self)
  const peers = [];
  for (let i = 0; i < 3; i++) {
    if (i !== nodeIndex) {
      peers.push({
        agentId: names[i],
        receiverUrl: `http://127.0.0.1:${ports[i]}`,
        token: tokens[i],
      });
    }
  }
  
  return createMockConfig({
    agentId: myName,
    agentName: `Agent ${myName.charAt(0).toUpperCase() + myName.slice(1)}`,
    receiverPort: myPort,
    receiverToken: myToken,
    threadPort: myPort + 100,
    peers,
  });
}

/**
 * Creates minimal config for unit testing
 * @returns {Object} Minimal config
 */
export function createMinimalConfig() {
  return createMockConfig({
    relayEnabled: false,
    peers: [],
    features: {
      relayPipeline: false,
      threadManager: false,
      dreamCycle: false,
      sharedPool: false,
      blindGate: false,
    },
  });
}

/**
 * Creates a mock config module that can be imported
 * @param {Object} config - The config to use
 * @returns {Object} Mock config module
 */
export function createMockConfigModule(config) {
  let cachedConfig = null;
  
  return {
    loadConfig: () => {
      if (!cachedConfig) {
        cachedConfig = { ...config };
      }
      return cachedConfig;
    },
    
    resetConfig: () => {
      cachedConfig = null;
    },
    
    __setConfig: (newConfig) => {
      cachedConfig = newConfig;
    },
    
    __getConfig: () => cachedConfig,
  };
}

/**
 * Validates config structure
 * @param {Object} config - Config to validate
 * @returns {Object} Validation result
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  
  // Required fields
  const required = ['agentId', 'receiverPort', 'receiverToken'];
  for (const field of required) {
    if (config[field] === undefined || config[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Type checks
  if (typeof config.receiverPort !== 'number') {
    errors.push('receiverPort must be a number');
  }
  
  if (typeof config.receiverToken !== 'string') {
    errors.push('receiverToken must be a string');
  }
  
  // Peer validation
  if (config.peers) {
    if (!Array.isArray(config.peers)) {
      errors.push('peers must be an array');
    } else {
      for (const peer of config.peers) {
        if (!peer.agentId) {
          errors.push('Each peer must have an agentId');
        }
        if (!peer.receiverUrl) {
          errors.push(`Peer ${peer.agentId} missing receiverUrl`);
        }
        if (!peer.token) {
          warnings.push(`Peer ${peer.agentId} missing token`);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Deep merge configs
 * @param {Object} base - Base config
 * @param {Object} override - Override values
 * @returns {Object} Merged config
 */
export function mergeConfig(base, override) {
  const merged = { ...base };
  
  for (const key of Object.keys(override)) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      merged[key] = mergeConfig(base[key] || {}, override[key]);
    } else {
      merged[key] = override[key];
    }
  }
  
  return merged;
}

export default {
  createMockConfig,
  createMeshConfig,
  createMinimalConfig,
  createMockConfigModule,
  validateConfig,
  mergeConfig,
};
