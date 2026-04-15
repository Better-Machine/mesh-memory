/**
 * Test Setup - Shared utilities for Phase 1 tests
 * Phase 1: Foundation Hardening
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test paths
export const TEST_PATHS = {
  tokens: path.join(__dirname, '.test-tokens'),
  logs: path.join(__dirname, '.test-logs'),
  db: path.join(__dirname, '.test-queue.db'),
  audit: path.join(__dirname, '.test-logs', 'token-audit.jsonl'),
  fixtures: path.join(__dirname, 'fixtures')
};

/**
 * Initialize test environment
 */
export async function setupTestEnv() {
  // Ensure test directories exist
  await fs.mkdir(TEST_PATHS.tokens, { recursive: true });
  await fs.mkdir(TEST_PATHS.logs, { recursive: true });
  await fs.mkdir(TEST_PATHS.fixtures, { recursive: true });
}

/**
 * Clean up all test artifacts
 */
export async function cleanupTestEnv() {
  try {
    // Clean up tokens directory
    await fs.rm(TEST_PATHS.tokens, { recursive: true, force: true });
    
    // Clean up logs
    await fs.rm(TEST_PATHS.logs, { recursive: true, force: true });
    
    // Clean up database files
    await fs.rm(TEST_PATHS.db, { force: true });
    await fs.rm(TEST_PATHS.db + '-shm', { force: true });
    await fs.rm(TEST_PATHS.db + '-wal', { force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Reset all test state - call before/after each test suite
 */
export async function resetTestState() {
  await cleanupTestEnv();
  await setupTestEnv();
}

/**
 * Wait for specified milliseconds
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a test token with specific expiry
 */
export function createTestToken(expiryHours = 48) {
  const now = Date.now();
  return {
    id: `test-token-${now}`,
    agentId: 'test-agent',
    createdAt: now,
    expiresAt: now + (expiryHours * 60 * 60 * 1000),
    status: 'active'
  };
}

/**
 * Create a test message for queue testing
 */
export function createTestMessage(type = 'test', overrides = {}) {
  return {
    type,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: new Date().toISOString(),
    ...overrides
  };
}

/**
 * Measure async function execution time
 */
export async function measureExecutionTime(fn) {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Retry an async operation with timeout
 */
export async function retryWithTimeout(fn, timeoutMs = 5000, intervalMs = 100) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      // Continue retrying
    }
    await delay(intervalMs);
  }
  
  throw new Error(`Operation timed out after ${timeoutMs}ms`);
}

/**
 * Assert that a promise rejects with specific error
 */
export async function assertRejects(promise, expectedMessage) {
  try {
    await promise;
    throw new Error('Expected promise to reject but it resolved');
  } catch (err) {
    if (expectedMessage && !err.message.includes(expectedMessage)) {
      throw new Error(`Expected error containing "${expectedMessage}" but got: ${err.message}`);
    }
    return err;
  }
}

/**
 * Generate test fixtures
 */
export async function generateFixtures() {
  const fixtures = {
    tokens: [
      { agentId: 'test-agent-1', ttlHours: 24 },
      { agentId: 'test-agent-2', ttlHours: 48 },
      { agentId: 'test-agent-3', ttlHours: 1 } // For expiry testing
    ],
    messages: [
      { type: 'a2a-message', action: 'test' },
      { type: 'memory-write', data: { key: 'test' } },
      { type: 'thread-create', participants: ['agent1', 'agent2'] }
    ]
  };
  
  await fs.writeFile(
    path.join(TEST_PATHS.fixtures, 'test-data.json'),
    JSON.stringify(fixtures, null, 2)
  );
  
  return fixtures;
}

/**
 * Load test fixtures
 */
export async function loadFixtures() {
  try {
    const content = await fs.readFile(
      path.join(TEST_PATHS.fixtures, 'test-data.json'),
      'utf-8'
    );
    return JSON.parse(content);
  } catch (err) {
    return generateFixtures();
  }
}

// Default export for convenience
export default {
  TEST_PATHS,
  setupTestEnv,
  cleanupTestEnv,
  resetTestState,
  delay,
  createTestToken,
  createTestMessage,
  measureExecutionTime,
  retryWithTimeout,
  assertRejects,
  generateFixtures,
  loadFixtures
};