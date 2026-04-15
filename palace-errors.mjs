/**
 * @module palace-errors
 * @description Structured error classes for mesh-memory Palace
 * @version 1.0.0
 */

/**
 * Base error class for all Palace operations
 * Includes error codes, correlation IDs, and structured metadata
 */
export class PalaceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PalaceError';
    this.code = options.code || 'PALACE_001';
    this.correlationId = options.correlationId || generateCorrelationId();
    this.timestamp = new Date().toISOString();
    this.severity = options.severity || 'error';
    this.context = options.context || {};
    this.recoverable = options.recoverable ?? false;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error to JSON for logging/transmission
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      correlationId: this.correlationId,
      timestamp: this.timestamp,
      severity: this.severity,
      context: this.context,
      recoverable: this.recoverable,
      stack: this.stack
    };
  }

  /**
   * Create a user-friendly error response
   */
  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        correlationId: this.correlationId,
        recoverable: this.recoverable
      }
    };
  }
}

/**
 * Tunnel-specific errors for mesh communication failures
 */
export class TunnelError extends PalaceError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'TunnelError';
    this.code = options.code || 'TUNNEL_001';
    this.peer = options.peer || null;
    this.factId = options.factId || null;
    this.retryable = options.retryable ?? true;
  }

  /**
   * Create a retryable tunnel error
   */
  static retryable(message, peer, factId, context = {}) {
    return new TunnelError(message, {
      code: 'TUNNEL_RETRYABLE',
      peer,
      factId,
      retryable: true,
      recoverable: true,
      context
    });
  }

  /**
   * Create a non-retryable tunnel error
   */
  static permanent(message, peer, factId, context = {}) {
    return new TunnelError(message, {
      code: 'TUNNEL_PERMANENT',
      peer,
      factId,
      retryable: false,
      recoverable: false,
      severity: 'error',
      context
    });
  }

  /**
   * Create authentication error
   */
  static auth(peer, context = {}) {
    return new TunnelError('Authentication failed', {
      code: 'TUNNEL_AUTH',
      peer,
      retryable: false,
      recoverable: false,
      severity: 'warn',
      context
    });
  }

  /**
   * Create timeout error
   */
  static timeout(peer, factId, timeoutMs, context = {}) {
    return new TunnelError(`Request timeout after ${timeoutMs}ms`, {
      code: 'TUNNEL_TIMEOUT',
      peer,
      factId,
      retryable: true,
      recoverable: true,
      severity: 'warn',
      context: { timeoutMs, ...context }
    });
  }
}

/**
 * Validation errors for input validation failures
 */
export class ValidationError extends PalaceError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ValidationError';
    this.code = options.code || 'VALIDATION_001';
    this.field = options.field || null;
    this.constraints = options.constraints || [];
    this.retryable = false;
    this.recoverable = true;
  }

  /**
   * Create a validation error for a specific field
   */
  static field(field, message, constraints = []) {
    return new ValidationError(message, {
      code: 'VALIDATION_FIELD',
      field,
      constraints,
      severity: 'warn'
    });
  }

  /**
   * Create a schema validation error
   */
  static schema(message, errors = []) {
    return new ValidationError(message, {
      code: 'VALIDATION_SCHEMA',
      constraints: errors,
      severity: 'warn'
    });
  }

  /**
   * Create a missing required field error
   */
  static required(field, context = {}) {
    return new ValidationError(`Missing required field: ${field}`, {
      code: 'VALIDATION_REQUIRED',
      field,
      severity: 'warn',
      context
    });
  }

  /**
   * Create an invalid value error
   */
  static invalid(field, value, expected, context = {}) {
    return new ValidationError(
      `Invalid value for ${field}: expected ${expected}, got ${typeof value}`,
      {
        code: 'VALIDATION_INVALID',
        field,
        severity: 'warn',
        context: { value, expected, ...context }
      }
    );
  }

  /**
   * Convert validation errors to response format
   */
  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        correlationId: this.correlationId,
        field: this.field,
        constraints: this.constraints
      }
    };
  }
}

/**
 * Database errors for SQLite operations
 */
export class DatabaseError extends PalaceError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'DatabaseError';
    this.code = options.code || 'DB_001';
    this.operation = options.operation || null;
    this.table = options.table || null;
    this.retryable = options.retryable ?? true;
  }

  /**
   * Create a connection error
   */
  static connection(path, originalError, context = {}) {
    return new DatabaseError(`Failed to connect to database at ${path}`, {
      code: 'DB_CONNECTION',
      operation: 'connect',
      retryable: true,
      recoverable: false,
      severity: 'error',
      context: { path, originalError: originalError?.message, ...context }
    });
  }

  /**
   * Create a query error
   */
  static query(sql, originalError, context = {}) {
    return new DatabaseError(`Query failed: ${originalError?.message}`, {
      code: 'DB_QUERY',
      operation: 'query',
      retryable: true,
      recoverable: true,
      severity: 'error',
      context: { sql, originalError: originalError?.message, ...context }
    });
  }
}

/**
 * Async operation wrapper that ensures no unhandled rejections
 * Returns { success: true, data } or { success: false, error }
 */
export async function safeExecute(operation, context = {}) {
  const correlationId = generateCorrelationId();
  
  try {
    const result = await operation();
    return {
      success: true,
      data: result,
      correlationId
    };
  } catch (err) {
    const error = err instanceof PalaceError 
      ? err 
      : new PalaceError(err.message, {
          code: 'EXECUTION_ERROR',
          correlationId,
          context: { ...context, originalError: err.stack }
        });
    
    return {
      success: false,
      error: error.toResponse().error,
      correlationId
    };
  }
}

/**
 * Synchronous version of safeExecute
 */
export function safeExecuteSync(operation, context = {}) {
  const correlationId = generateCorrelationId();
  
  try {
    const result = operation();
    return {
      success: true,
      data: result,
      correlationId
    };
  } catch (err) {
    const error = err instanceof PalaceError 
      ? err 
      : new PalaceError(err.message, {
          code: 'EXECUTION_ERROR',
          correlationId,
          context: { ...context, originalError: err.stack }
        });
    
    return {
      success: false,
      error: error.toResponse().error,
      correlationId
    };
  }
}

/**
 * Generate a correlation ID for request tracing
 */
function generateCorrelationId() {
  return `palace_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Error code registry for reference
 */
export const ErrorCodes = {
  // Palace general errors
  PALACE_001: 'General Palace error',
  
  // Tunnel errors
  TUNNEL_001: 'General tunnel error',
  TUNNEL_RETRYABLE: 'Retryable tunnel communication error',
  TUNNEL_PERMANENT: 'Permanent tunnel failure',
  TUNNEL_AUTH: 'Authentication failed',
  TUNNEL_TIMEOUT: 'Request timeout',
  
  // Validation errors
  VALIDATION_001: 'General validation error',
  VALIDATION_FIELD: 'Field validation failed',
  VALIDATION_SCHEMA: 'Schema validation failed',
  VALIDATION_REQUIRED: 'Required field missing',
  VALIDATION_INVALID: 'Invalid value provided',
  
  // Database errors
  DB_001: 'General database error',
  DB_CONNECTION: 'Database connection failed',
  DB_QUERY: 'Database query failed'
};

export default {
  PalaceError,
  TunnelError,
  ValidationError,
  DatabaseError,
  safeExecute,
  safeExecuteSync,
  ErrorCodes
};
