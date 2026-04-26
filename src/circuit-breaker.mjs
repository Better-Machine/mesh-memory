/**
 * @module circuit-breaker
 * @description Shared Circuit Breaker implementation
 * 
 * Provides resilient failure handling with automatic recovery:
 * - CLOSED: Normal operation, failures tracked
 * - OPEN: Failures exceeded threshold, requests blocked
 * - HALF_OPEN: Probe period after cooldown, allows limited requests
 * 
 * Used by: a2a-reliability-layer, a2a-discovery-registry, and any
 * module needing resilience patterns.
 * 
 * @version 1.0.0
 */

// ============================================================================
// TYPES AND CONSTANTS
// ============================================================================

/**
 * Circuit breaker states
 * @enum {string}
 */
export const CircuitState = {
  CLOSED: 'closed',      // Normal operation
  OPEN: 'open',          // Failures exceeded threshold
  HALF_OPEN: 'half-open' // Probing for recovery
};

/**
 * Delivery status enum for reliability layer
 * @enum {string}
 */
export const DeliveryStatus = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter'
};

/**
 * Default configuration values
 */
const DEFAULTS = {
  FAILURE_THRESHOLD: 5,        // Failures before opening
  COOLDOWN_MS: 60000,          // 60 seconds cooldown
  SUCCESS_THRESHOLD: 2,        // Successes in half-open to close
  HALF_OPEN_MAX_CALLS: 1     // Max concurrent calls in half-open
};

// ============================================================================
// CIRCUIT BREAKER CLASS
// ============================================================================

/**
 * Circuit Breaker for resilient operations
 * 
 * @example
 * const cb = new CircuitBreaker('my-service', {
 *   failureThreshold: 5,
 *   cooldownMs: 60000
 * });
 * 
 * if (cb.canAttempt()) {
 *   try {
 *     const result = await someOperation();
 *     cb.recordSuccess();
 *     return result;
 *   } catch (err) {
 *     await cb.recordFailure(err.message);
 *     throw err;
 *   }
 * }
 */
export class CircuitBreaker {
  /**
   * @param {string} key - Unique identifier for this circuit
   * @param {Object} options - Circuit breaker options
   * @param {number} options.failureThreshold - Failures before opening (default: 5)
 * @param {number} options.cooldownMs - Cooldown period in ms (default: 60000)
 * @param {number} options.successThreshold - Successes to close from half-open (default: 2)
 * @param {number} options.halfOpenMaxCalls - Max concurrent calls in half-open (default: 1)
   * @param {Function} options.onStateChange - Callback for state changes
   */
  constructor(key, options = {}) {
    this.key = key;
    this.failureThreshold = options.failureThreshold ?? DEFAULTS.FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULTS.COOLDOWN_MS;
    this.successThreshold = options.successThreshold ?? DEFAULTS.SUCCESS_THRESHOLD;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? DEFAULTS.HALF_OPEN_MAX_CALLS;
    this.onStateChange = options.onStateChange || null;

    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
    this.halfOpenCalls = 0;

    this.metrics = {
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      lastStateChangeAt: null,
      stateChangeCount: 0
    };
  }

  /**
   * Check if a request can be attempted
   * @returns {boolean}
   */
  canAttempt() {
    this.metrics.totalCalls++;

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if cooldown has elapsed
        if (this.openedAt && Date.now() - this.openedAt >= this.cooldownMs) {
          this.transitionTo(CircuitState.HALF_OPEN, 'cooldown elapsed');
          return this.canAttempt();
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited concurrent calls in half-open
        return this.halfOpenCalls < this.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation
   * @returns {void}
   */
  recordSuccess() {
    this.metrics.totalSuccesses++;
    this.consecutiveFailures = 0;

    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.consecutiveSuccesses++;
        this.halfOpenCalls--;
        
        if (this.consecutiveSuccesses >= this.successThreshold) {
          this.transitionTo(CircuitState.CLOSED, 'probe succeeded');
        }
        break;

      case CircuitState.CLOSED:
        // Reset any partial failure tracking
        this.consecutiveSuccesses = 0;
        break;

      case CircuitState.OPEN:
        // Direct success while open - close immediately
        this.transitionTo(CircuitState.CLOSED, 'direct recovery');
        break;
    }
  }

  /**
   * Record a failed operation
   * @param {string} reason - Failure reason
   * @returns {void}
   */
  recordFailure(reason) {
    this.metrics.totalFailures++;
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();

    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.halfOpenCalls--;
        this.consecutiveSuccesses = 0;
        // Any failure in half-open immediately opens circuit
        this.transitionTo(CircuitState.OPEN, `probe failed: ${reason}`);
        break;

      case CircuitState.CLOSED:
        if (this.consecutiveFailures >= this.failureThreshold) {
          this.transitionTo(CircuitState.OPEN, `failure threshold reached: ${reason}`);
        }
        break;

      case CircuitState.OPEN:
        // Already open, just update last failure
        break;
    }
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @param {Object} options - Execution options
   * @param {*} options.fallback - Fallback value if circuit is open
   * @returns {Promise<*>} Result from fn or fallback
   */
  async execute(fn, options = {}) {
    if (!this.canAttempt()) {
      if (options.fallback !== undefined) {
        return options.fallback;
      }
      throw new CircuitBreakerOpenError(this.key, this.getState());
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err.message);
      throw err;
    }
  }

  /**
   * Get current circuit state
   * @returns {Object} Current state snapshot
   */
  getState() {
    return {
      key: this.key,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureAt: this.lastFailureAt,
      openedAt: this.openedAt,
      canAttempt: this.canAttempt(),
      metrics: { ...this.metrics }
    };
  }

  /**
   * Manually transition to a state (for testing/admin)
   * @param {string} newState - Target state
   * @param {string} reason - Reason for transition
   */
  forceState(newState, reason = 'manual') {
    if (!Object.values(CircuitState).includes(newState)) {
      throw new Error(`Invalid circuit state: ${newState}`);
    }
    this.transitionTo(newState, reason);
  }

  /**
   * Reset circuit to CLOSED state
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
    this.halfOpenCalls = 0;
    this.metrics = {
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      lastStateChangeAt: null,
      stateChangeCount: 0
    };
  }

  /**
   * Transition to a new state
   * @private
   */
  transitionTo(newState, reason) {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.metrics.stateChangeCount++;
    this.metrics.lastStateChangeAt = Date.now();

    if (newState === CircuitState.OPEN) {
      this.openedAt = Date.now();
      this.halfOpenCalls = 0;
    } else if (newState === CircuitState.CLOSED) {
      this.consecutiveSuccesses = 0;
      this.halfOpenCalls = 0;
    }

    // Notify listener
    if (this.onStateChange) {
      try {
        this.onStateChange({
          key: this.key,
          from: oldState,
          to: newState,
          reason,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[CircuitBreaker] State change callback error:', err);
      }
    }
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(key, state) {
    super(`Circuit breaker '${key}' is ${state.state}. Last failure: ${state.lastFailureAt}`);
    this.key = key;
    this.circuitState = state.state;
    this.lastFailureAt = state.lastFailureAt;
    this.code = 'CIRCUIT_OPEN';
  }
}

// ============================================================================
// CIRCUIT BREAKER REGISTRY
// ============================================================================

/**
 * Global registry for circuit breakers
 * Allows shared access to circuit state across modules
 */
export class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
    this.listeners = new Set();
  }

  /**
   * Get or create a circuit breaker
   * @param {string} key - Circuit identifier
   * @param {Object} options - Circuit breaker options
   * @returns {CircuitBreaker}
   */
  get(key, options = {}) {
    if (!this.breakers.has(key)) {
      const breaker = new CircuitBreaker(key, {
        ...options,
        onStateChange: (change) => this.notifyListeners(change)
      });
      this.breakers.set(key, breaker);
    }
    return this.breakers.get(key);
  }

  /**
   * Check if a circuit breaker exists
   * @param {string} key - Circuit identifier
   * @returns {boolean}
   */
  has(key) {
    return this.breakers.has(key);
  }

  /**
   * Get all circuit states
   * @returns {Array<Object>}
   */
  getAllStates() {
    return Array.from(this.breakers.values()).map(b => b.getState());
  }

  /**
   * Reset all circuits
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback for state changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of state change
   * @private
   */
  notifyListeners(change) {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        console.error('[CircuitBreakerRegistry] Listener error:', err);
      }
    }
  }

  /**
   * Clear all circuits
   */
  clear() {
    this.breakers.clear();
    this.listeners.clear();
  }
}

// Global singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Get or create a circuit breaker (convenience function)
 * @param {string} key - Circuit identifier
 * @param {Object} options - Circuit breaker options
 * @returns {CircuitBreaker}
 */
export function getCircuitBreaker(key, options = {}) {
  return circuitBreakerRegistry.get(key, options);
}

/**
 * Check if a circuit is closed (can attempt)
 * @param {string} key - Circuit identifier
 * @returns {boolean}
 */
export function isCircuitClosed(key) {
  const breaker = circuitBreakerRegistry.get(key);
  return breaker.canAttempt();
}

/**
 * Record success for a circuit
 * @param {string} key - Circuit identifier
 */
export function recordCircuitSuccess(key) {
  const breaker = circuitBreakerRegistry.get(key);
  breaker.recordSuccess();
}

/**
 * Record failure for a circuit
 * @param {string} key - Circuit identifier
 * @param {string} reason - Failure reason
 */
export function recordCircuitFailure(key, reason) {
  const breaker = circuitBreakerRegistry.get(key);
  breaker.recordFailure(reason);
}

export default {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  getCircuitBreaker,
  isCircuitClosed,
  recordCircuitSuccess,
  recordCircuitFailure
};
