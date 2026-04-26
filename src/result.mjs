/**
 * @module result
 * @description Standardized Result<T,E> type for functional error handling
 * 
 * Replaces throwing exceptions with explicit error handling:
 * - Result.ok(value) for success
 * - Result.err(code, message, details) for failure
 * 
 * Benefits:
 * - Type-safe error handling
 * - Explicit error paths
 * - Composable with map, flatMap, orElse
 * - Forces handling of error cases
 * 
 * @version 1.0.0
 */

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Standard error codes for mesh operations
 * @enum {string}
 */
export const ErrorCode = {
  // Not found errors
  NOT_FOUND: 'NOT_FOUND',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  TOKEN_NOT_FOUND: 'TOKEN_NOT_FOUND',
  PEER_NOT_FOUND: 'PEER_NOT_FOUND',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STATE: 'INVALID_STATE',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Permission errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Conflict errors
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  DUPLICATE: 'DUPLICATE',
  CONFLICT: 'CONFLICT',
  
  // State errors
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  ROTATING: 'ROTATING',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  
  // External errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAVAILABLE: 'UNAVAILABLE',
  EXTERNAL_ERROR: 'EXTERNAL_ERROR',
  
  // Storage errors
  STORAGE_ERROR: 'STORAGE_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  
  // Unknown error
  UNKNOWN: 'UNKNOWN'
};

/**
 * Base error class for mesh operations
 */
export class MeshError extends Error {
  /**
   * @param {string} code - Error code from ErrorCode
   * @param {string} message - Human-readable message
   * @param {Object} details - Additional context
   */
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

/**
 * Specific error types for common cases
 */
export class NotFoundError extends MeshError {
  constructor(resource, id) {
    super(ErrorCode.NOT_FOUND, `${resource} not found: ${id}`, { resource, id });
  }
}

export class ValidationError extends MeshError {
  constructor(message, details = {}) {
    super(ErrorCode.VALIDATION_ERROR, message, details);
  }
}

export class UnauthorizedError extends MeshError {
  constructor(action, reason = 'insufficient permissions') {
    super(ErrorCode.UNAUTHORIZED, `Unauthorized: ${action}`, { action, reason });
  }
}

export class ConflictError extends MeshError {
  constructor(resource, id, reason) {
    super(ErrorCode.CONFLICT, `Conflict with ${resource}: ${id}`, { resource, id, reason });
  }
}

export class StateError extends MeshError {
  constructor(expected, actual) {
    super(ErrorCode.INVALID_STATE, `Invalid state: expected ${expected}, got ${actual}`, { expected, actual });
  }
}

// ============================================================================
// RESULT TYPE
// ============================================================================

/**
 * Result<T, E> type for functional error handling
 * 
 * @template T - Success value type
 * @template E - Error type (defaults to MeshError)
 */
export class Result {
  /**
   * @private
   * @param {boolean} ok - Whether result is success
   * @param {T|null} value - Success value
   * @param {E|null} error - Error value
   */
  constructor(ok, value, error) {
    this.ok = ok;
    this.value = value;
    this.error = error;
    Object.freeze(this);
  }

  // -------------------------------------------------------------------------
  // Constructors
  // -------------------------------------------------------------------------

  /**
   * Create a success result
   * @param {T} value - Success value
   * @returns {Result<T, never>}
   */
  static ok(value) {
    return new Result(true, value, null);
  }

  /**
   * Create a failure result
   * @param {E} error - Error value
   * @returns {Result<never, E>}
   */
  static err(error) {
    return new Result(false, null, error);
  }

  /**
   * Create a failure result from error code and message
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {Object} details - Additional details
   * @returns {Result<never, MeshError>}
   */
  static fail(code, message, details) {
    return new Result(false, null, new MeshError(code, message, details));
  }

  /**
   * Wrap a function that may throw in a Result
   * @param {Function} fn - Function to wrap
   * @returns {Result<T, MeshError>}
   */
  static try(fn) {
    try {
      const value = fn();
      return Result.ok(value);
    } catch (err) {
      const error = err instanceof MeshError 
        ? err 
        : new MeshError(ErrorCode.UNKNOWN, err.message, { originalError: err });
      return Result.err(error);
    }
  }

  /**
   * Wrap an async function that may throw in a Result
   * @param {Function} fn - Async function to wrap
   * @returns {Promise<Result<T, MeshError>>}
   */
  static async tryAsync(fn) {
    try {
      const value = await fn();
      return Result.ok(value);
    } catch (err) {
      const error = err instanceof MeshError 
        ? err 
        : new MeshError(ErrorCode.UNKNOWN, err.message, { originalError: err });
      return Result.err(error);
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Check if result is success
   * @returns {boolean}
   */
  isOk() {
    return this.ok;
  }

  /**
   * Check if result is failure
   * @returns {boolean}
   */
  isErr() {
    return !this.ok;
  }

  /**
   * Get success value or throw
   * @returns {T}
   * @throws {E} if result is error
   */
  unwrap() {
    if (!this.ok) {
      throw this.error;
    }
    return this.value;
  }

  /**
   * Get success value or return default
   * @param {T} defaultValue - Default if error
   * @returns {T}
   */
  unwrapOr(defaultValue) {
    return this.ok ? this.value : defaultValue;
  }

  /**
   * Get success value or call fallback function
   * @param {Function} fn - Fallback function
   * @returns {T}
   */
  unwrapOrElse(fn) {
    return this.ok ? this.value : fn(this.error);
  }

  /**
   * Get error value (null if success)
   * @returns {E|null}
   */
  getError() {
    return this.error;
  }

  // -------------------------------------------------------------------------
  // Transformations
  // -------------------------------------------------------------------------

  /**
   * Transform success value
   * @param {Function} fn - Transform function
   * @returns {Result<U, E>}
   */
  map(fn) {
    if (this.ok) {
      try {
        return Result.ok(fn(this.value));
      } catch (err) {
        return Result.err(err);
      }
    }
    return this;
  }

  /**
   * Transform success value with async function
   * @param {Function} fn - Async transform function
   * @returns {Promise<Result<U, E>>}
   */
  async mapAsync(fn) {
    if (this.ok) {
      try {
        const value = await fn(this.value);
        return Result.ok(value);
      } catch (err) {
        return Result.err(err);
      }
    }
    return this;
  }

  /**
   * Flat map - chain results
   * @param {Function} fn - Function returning Result
   * @returns {Result<U, E>}
   */
  flatMap(fn) {
    if (this.ok) {
      try {
        return fn(this.value);
      } catch (err) {
        return Result.err(err);
      }
    }
    return this;
  }

  /**
   * Flat map with async function
   * @param {Function} fn - Async function returning Result
   * @returns {Promise<Result<U, E>>}
   */
  async flatMapAsync(fn) {
    if (this.ok) {
      try {
        return await fn(this.value);
      } catch (err) {
        return Result.err(err);
      }
    }
    return this;
  }

  /**
   * Transform error value
   * @param {Function} fn - Transform function
   * @returns {Result<T, U>}
   */
  mapErr(fn) {
    if (!this.ok) {
      try {
        return Result.err(fn(this.error));
      } catch (err) {
        return Result.err(err);
      }
    }
    return this;
  }

  /**
   * Chain with fallback if error
   * @param {Function} fn - Fallback function returning Result
   * @returns {Result<T, E>}
   */
  orElse(fn) {
    if (!this.ok) {
      try {
        return fn(this.error);
      } catch (err) {
        return Result.err(err);
      }
    }
    return this;
  }

  /**
   * Filter success value by predicate
   * @param {Function} predicate - Filter function
   * @param {E} error - Error to return if predicate fails
   * @returns {Result<T, E>}
   */
  filter(predicate, error) {
    if (this.ok && !predicate(this.value)) {
      return Result.err(error);
    }
    return this;
  }

  /**
   * Match both branches
   * @param {Function} onOk - Success handler
   * @param {Function} onErr - Error handler
   * @returns {U}
   */
  match(onOk, onErr) {
    return this.ok ? onOk(this.value) : onErr(this.error);
  }

  /**
   * Tap - inspect value without changing it
   * @param {Function} fn - Inspection function
   * @returns {Result<T, E>}
   */
  tap(fn) {
    if (this.ok) {
      fn(this.value);
    }
    return this;
  }

  /**
   * Tap error - inspect error without changing it
   * @param {Function} fn - Inspection function
   * @returns {Result<T, E>}
   */
  tapErr(fn) {
    if (!this.ok) {
      fn(this.error);
    }
    return this;
  }

  /**
   * Convert to Promise
   * @returns {Promise<T>}
   */
  toPromise() {
    return this.ok 
      ? Promise.resolve(this.value)
      : Promise.reject(this.error);
  }

  /**
   * Convert to JSON-serializable object
   * @returns {Object}
   */
  toJSON() {
    return {
      ok: this.ok,
      value: this.value,
      error: this.error?.toJSON?.() || this.error
    };
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Combine multiple results into one
 * Returns first error if any fail, or Ok with array of values
 * 
 * @param {Array<Result>} results
 * @returns {Result<Array, MeshError>}
 */
export function combine(results) {
  const values = [];
  
  for (const result of results) {
    if (result.isErr()) {
      return result;
    }
    values.push(result.value);
  }
  
  return Result.ok(values);
}

/**
 * Combine multiple results, collecting all errors
 * @param {Array<Result>} results
 * @returns {Result<Array, Array<MeshError>>}
 */
export function combineAll(results) {
  const values = [];
  const errors = [];
  
  for (const result of results) {
    if (result.isOk()) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }
  
  if (errors.length > 0) {
    return Result.err(errors);
  }
  
  return Result.ok(values);
}

/**
 * Create a result from a nullable value
 * @param {*} value - Nullable value
 * @param {E} error - Error if null/undefined
 * @returns {Result}
 */
export function fromNullable(value, error) {
  return value != null ? Result.ok(value) : Result.err(error);
}

/**
 * Create a result from a promise
 * @param {Promise} promise
 * @returns {Promise<Result>}
 */
export async function fromPromise(promise) {
  try {
    const value = await promise;
    return Result.ok(value);
  } catch (err) {
    const error = err instanceof MeshError 
      ? err 
      : new MeshError(ErrorCode.UNKNOWN, err.message);
    return Result.err(error);
  }
}

export default {
  Result,
  ErrorCode,
  MeshError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ConflictError,
  StateError,
  combine,
  combineAll,
  fromNullable,
  fromPromise
};
