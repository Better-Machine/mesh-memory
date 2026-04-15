/**
 * @module helpers/test-helpers
 * @description Core test utilities and patterns for mesh-memory testing
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ───────────────────────────────────────────────────────────────────────────────
// Test Directory Management
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates an isolated test directory
 * @param {string} name - Test name or identifier
 * @returns {string} Path to test directory
 */
export function createTestDir(name) {
  const testDir = resolve('/tmp', `mesh-test-${name}-${process.pid}-${Date.now()}`);
  
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
  
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/**
 * Cleans up a test directory
 * @param {string} testDir - Path to test directory
 */
export function cleanupTestDir(testDir) {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Creates a scoped test environment that auto-cleans
 * @param {string} name - Test name
 * @returns {Object} Test environment with path and cleanup
 */
export function createTestEnvironment(name) {
  const dir = createTestDir(name);
  
  return {
    dir,
    cleanup: () => cleanupTestDir(dir),
    [Symbol.dispose]: () => cleanupTestDir(dir), // For using statement
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Module Reloading
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Forces a fresh module import to avoid caching issues
 * Use this when testing modules that maintain internal state
 * @param {string} modulePath - Path to module
 * @returns {Promise<Object>} Fresh module exports
 */
export async function reloadModule(modulePath) {
  const cacheBuster = `?t=${Date.now()}-${Math.random()}`;
  return import(`${modulePath}${cacheBuster}`);
}

/**
 * Resets module cache for testing
 * Note: Only works in ESM when combined with reloadModule
 */
export function resetModuleCache() {
  // In ESM, we rely on cache-busting via query params
  // This is a no-op for documentation purposes
}

// ───────────────────────────────────────────────────────────────────────────────
// Timing Utilities
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a promise that resolves after a delay
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Waits for a condition to be true
 * @param {Function} condition - Function returning boolean
 * @param {Object} options - Wait options
 * @returns {Promise<boolean>}
 */
export async function waitFor(condition, options = {}) {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await sleep(interval);
  }
  
  return false;
}

/**
 * Measures execution time of a function
 * @param {Function} fn - Function to measure
 * @returns {Promise<{result: any, duration: number}>}
 */
export async function measureTime(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  
  return {
    result,
    duration: Number(end - start) / 1000000, // Convert to milliseconds
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Assertion Helpers
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Asserts that a function throws an error with specific message
 * @param {Function} fn - Function to test
 * @param {string|RegExp} expectedMessage - Expected error message
 * @returns {Promise<Error>} The thrown error
 */
export async function assertRejects(fn, expectedMessage) {
  try {
    await fn();
    throw new Error('Expected function to throw but it did not');
  } catch (err) {
    const message = err.message || String(err);
    
    if (expectedMessage instanceof RegExp) {
      if (!expectedMessage.test(message)) {
        throw new Error(`Expected error message to match ${expectedMessage}, got: ${message}`);
      }
    } else if (!message.includes(expectedMessage)) {
      throw new Error(`Expected error message to include "${expectedMessage}", got: ${message}`);
    }
    
    return err;
  }
}

/**
 * Asserts that a date is within expected range
 * @param {Date|string} actual - Actual date
 * @param {Date|string} expected - Expected date
 * @param {number} toleranceMs - Tolerance in milliseconds
 */
export function assertDateClose(actual, expected, toleranceMs = 1000) {
  const actualDate = new Date(actual);
  const expectedDate = new Date(expected);
  const diff = Math.abs(actualDate.getTime() - expectedDate.getTime());
  
  if (diff > toleranceMs) {
    throw new Error(
      `Expected date ${actualDate.toISOString()} to be within ${toleranceMs}ms of ${expectedDate.toISOString()}, but difference was ${diff}ms`
    );
  }
}

/**
 * Asserts that an object contains expected properties
 * @param {Object} actual - Actual object
 * @param {Object} expected - Expected properties
 */
export function assertContains(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) {
      throw new Error(`Expected object to have property "${key}"`);
    }
    
    if (typeof value === 'object' && value !== null) {
      assertContains(actual[key], value);
    } else if (actual[key] !== value) {
      throw new Error(
        `Expected property "${key}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`
      );
    }
  }
}

/**
 * Asserts that array contains an item matching criteria
 * @param {Array} array - Array to search
 * @param {Function|Object} matcher - Matcher function or partial object
 */
export function assertArrayContains(array, matcher) {
  const found = typeof matcher === 'function'
    ? array.some(matcher)
    : array.some(item => {
        for (const [key, value] of Object.entries(matcher)) {
          if (item[key] !== value) return false;
        }
        return true;
      });
  
  if (!found) {
    throw new Error(
      `Expected array to contain item matching ${JSON.stringify(matcher)}, but it did not. Array: ${JSON.stringify(array)}`
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Retry Logic
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Retries an async function until it succeeds or max retries reached
 * @param {Function} fn - Function to retry
 * @param {Object} options - Retry options
 * @returns {Promise<any>}
 */
export async function retry(fn, options = {}) {
  const { maxRetries = 3, delay = 100, backoff = 2 } = options;
  
  let lastError;
  let currentDelay = delay;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      if (i < maxRetries) {
        await sleep(currentDelay);
        currentDelay *= backoff;
      }
    }
  }
  
  throw lastError;
}

// ───────────────────────────────────────────────────────────────────────────────
// Process Management
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Spawns a child process and waits for output
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {Object} options - Spawn options
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
export function spawnAndWait(command, args, options = {}) {
  const { spawn } = await import('node:child_process');
  
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
    
    child.on('error', reject);
    
    // Timeout
    if (options.timeout) {
      setTimeout(() => {
        child.kill();
        reject(new Error(`Process timed out after ${options.timeout}ms`));
      }, options.timeout);
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// UUID Validation
// ───────────────────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates UUID format
 * @param {string} uuid - UUID to validate
 * @returns {boolean}
 */
export function isValidUUID(uuid) {
  return UUID_REGEX.test(uuid);
}

/**
 * Generates a test UUID with optional prefix
 * @param {string} prefix - Optional prefix for identification
 * @returns {string}
 */
export function generateTestUUID(prefix = '') {
  const uuid = randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

// ───────────────────────────────────────────────────────────────────────────────
// Token Management
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a test bearer token
 * @param {string} prefix - Optional prefix
 * @returns {string}
 */
export function createTestToken(prefix = 'test') {
  return `${prefix}-${randomUUID().replace(/-/g, '')}`;
}

/**
 * Creates auth headers for HTTP requests
 * @param {string} token - Bearer token
 * @returns {Object} Headers object
 */
export function createAuthHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Export All
// ───────────────────────────────────────────────────────────────────────────────

export default {
  // Directories
  createTestDir,
  cleanupTestDir,
  createTestEnvironment,
  
  // Modules
  reloadModule,
  resetModuleCache,
  
  // Timing
  sleep,
  waitFor,
  measureTime,
  
  // Assertions
  assertRejects,
  assertDateClose,
  assertContains,
  assertArrayContains,
  
  // Retry
  retry,
  
  // Process
  spawnAndWait,
  
  // UUID
  isValidUUID,
  generateTestUUID,
  
  // Auth
  createTestToken,
  createAuthHeaders,
};
