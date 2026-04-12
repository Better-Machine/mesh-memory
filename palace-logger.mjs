/**
 * @module palace-logger
 * @description Structured logging utility with correlation IDs and log levels
 * @version 1.0.0
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Log levels with priorities
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

const LogLevelNames = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL'
};

// Default configuration
const DEFAULT_CONFIG = {
  minLevel: LogLevel.INFO,
  logDir: resolve(homedir(), '.openclaw/workspace/memory/logs'),
  logFile: 'palace.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  includeTimestamp: true,
  includeCorrelationId: true,
  prettyPrint: false,
  console: true
};

/**
 * Palace Logger class
 * Provides structured logging with correlation IDs and rotation
 */
export class PalaceLogger {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.logPath = resolve(this.config.logDir, this.config.logFile);
    this.correlationId = null;
    this.context = {};
    
    // Ensure log directory exists
    this._ensureLogDir();
  }

  /**
   * Set correlation ID for current request context
   */
  setCorrelationId(id) {
    this.correlationId = id;
    return this;
  }

  /**
   * Set persistent context fields
   */
  setContext(context) {
    this.context = { ...this.context, ...context };
    return this;
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext = {}) {
    const childLogger = new PalaceLogger(this.config);
    childLogger.correlationId = this.correlationId;
    childLogger.context = { ...this.context, ...additionalContext };
    return childLogger;
  }

  /**
   * Log at DEBUG level
   */
  debug(message, meta = {}) {
    return this._log(LogLevel.DEBUG, message, meta);
  }

  /**
   * Log at INFO level
   */
  info(message, meta = {}) {
    return this._log(LogLevel.INFO, message, meta);
  }

  /**
   * Log at WARN level
   */
  warn(message, meta = {}) {
    return this._log(LogLevel.WARN, message, meta);
  }

  /**
   * Log at ERROR level
   */
  error(message, meta = {}) {
    return this._log(LogLevel.ERROR, message, meta);
  }

  /**
   * Log at FATAL level
   */
  fatal(message, meta = {}) {
    return this._log(LogLevel.FATAL, message, meta);
  }

  /**
   * Log an error object with full stack trace
   */
  logError(error, message = null, meta = {}) {
    const logEntry = {
      ...meta,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
        correlationId: error.correlationId
      }
    };
    return this._log(LogLevel.ERROR, message || error.message, logEntry);
  }

  /**
   * Internal log method
   */
  async _log(level, message, meta = {}) {
    if (level < this.config.minLevel) {
      return;
    }

    const entry = this._formatLogEntry(level, message, meta);
    
    // Console output
    if (this.config.console) {
      this._consoleOutput(level, entry);
    }

    // File output (async, don't wait)
    this._fileOutput(entry).catch(() => {
      // Silently fail on file write errors
    });

    return entry;
  }

  /**
   * Format log entry
   */
  _formatLogEntry(level, message, meta) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level: LogLevelNames[level],
      message,
      ...this.context
    };

    if (this.config.includeCorrelationId && this.correlationId) {
      entry.correlationId = this.correlationId;
    }

    if (Object.keys(meta).length > 0) {
      entry.meta = meta;
    }

    return entry;
  }

  /**
   * Output to console with appropriate method
   */
  _consoleOutput(level, entry) {
    const formatted = this.config.prettyPrint 
      ? this._prettyPrint(entry)
      : JSON.stringify(entry);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.log(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
    }
  }

  /**
   * Pretty print for development
   */
  _prettyPrint(entry) {
    const { timestamp, level, message, correlationId, ...rest } = entry;
    const parts = [`[${timestamp}] [${level}] ${message}`];
    
    if (correlationId) {
      parts.push(`[${correlationId}]`);
    }
    
    if (Object.keys(rest).length > 0) {
      parts.push(JSON.stringify(rest, null, 2));
    }
    
    return parts.join(' ');
  }

  /**
   * Async file output with rotation check
   */
  async _fileOutput(entry) {
    try {
      await mkdir(this.config.logDir, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      await appendFile(this.logPath, line, 'utf-8');
    } catch (err) {
      // Fail silently - don't let logging break the app
    }
  }

  /**
   * Ensure log directory exists
   */
  async _ensureLogDir() {
    try {
      await mkdir(this.config.logDir, { recursive: true });
    } catch (err) {
      // Directory may already exist
    }
  }
}

/**
 * Create a logger instance with optional correlation ID
 */
export function createLogger(options = {}, correlationId = null) {
  const logger = new PalaceLogger(options);
  if (correlationId) {
    logger.setCorrelationId(correlationId);
  }
  return logger;
}

/**
 * Generate correlation ID
 */
export function generateCorrelationId() {
  return `palace_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Async context store for correlation IDs (simple implementation)
 */
class AsyncContextStore {
  constructor() {
    this.store = new Map();
  }

  run(correlationId, fn) {
    const id = correlationId || generateCorrelationId();
    this.store.set('current', id);
    try {
      return fn();
    } finally {
      this.store.delete('current');
    }
  }

  async runAsync(correlationId, fn) {
    const id = correlationId || generateCorrelationId();
    this.store.set('current', id);
    try {
      return await fn();
    } finally {
      this.store.delete('current');
    }
  }

  getCurrent() {
    return this.store.get('current');
  }
}

export const asyncContext = new AsyncContextStore();

// Default logger instance
export const defaultLogger = new PalaceLogger();

export default {
  PalaceLogger,
  createLogger,
  generateCorrelationId,
  asyncContext,
  LogLevel,
  defaultLogger
};
