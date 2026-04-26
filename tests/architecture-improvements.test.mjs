/**
 * Tests for new architecture abstractions
 * 
 * Run with: node tests/architecture-improvements.test.mjs
 */

import { SQLiteRepository } from '../src/db/repository-base.mjs';
import { CircuitBreaker, CircuitState, CircuitBreakerRegistry } from '../src/circuit-breaker.mjs';
import { Result, ErrorCode, NotFoundError, ValidationError } from '../src/result.mjs';
import { DIContainer } from '../src/di-container.mjs';
import { promises as fs } from 'fs';
import { join } from 'path';

const TEST_DB_PATH = '/tmp/test-architecture.db';

// Test utilities
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(msg || 'Expected true');
  }
}

// ========================================================================
// SQLiteRepository Tests
// ========================================================================

console.log('\n=== SQLiteRepository Tests ===\n');

async function testSQLiteRepository() {
  // Clean up any existing test db
  try {
    await fs.unlink(TEST_DB_PATH);
  } catch {}

  const schema = {
    tables: {
      users: `id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT`
    },
    indexes: {
      idx_users_email: `users(email)`
    }
  };

  const repo = new SQLiteRepository(TEST_DB_PATH, schema, { verbose: false });
  
  // Test init
  await repo.init();
  test('Repository initializes', () => assertTrue(repo.initialized));
  
  // Test query
  await repo.query("INSERT INTO users VALUES (?, ?, ?)", ['1', 'Alice', 'alice@example.com']);
  const row = await repo.queryOne("SELECT * FROM users WHERE id = ?", ['1']);
  test('Query works', () => assertEqual(row.name, 'Alice'));
  
  // Test transaction success
  const txResult = await repo.transaction(async (db) => {
    await repo.query("INSERT INTO users VALUES (?, ?, ?)", ['2', 'Bob', 'bob@example.com']);
    return { success: true };
  });
  test('Transaction succeeds', () => assertTrue(txResult.success));
  
  const bob = await repo.queryOne("SELECT * FROM users WHERE id = ?", ['2']);
  test('Transaction committed', () => assertEqual(bob.name, 'Bob'));
  
  // Test transaction rollback
  try {
    await repo.transaction(async (db) => {
      await repo.query("INSERT INTO users VALUES (?, ?, ?)", ['3', 'Charlie', 'charlie@example.com']);
      throw new Error('Forced rollback');
    });
  } catch {}
  const charlie = await repo.queryOne("SELECT * FROM users WHERE id = ?", ['3']);
  test('Transaction rolls back on error', () => assertTrue(!charlie, 'Charlie should not exist'));
  
  // Test health
  const health = await repo.health();
  test('Health check passes', () => assertTrue(health.healthy));
  
  await repo.close();
  test('Repository closes', () => assertTrue(!repo.initialized));
  
  // Cleanup
  try {
    await fs.unlink(TEST_DB_PATH);
  } catch {}
}

await testSQLiteRepository();

// ========================================================================
// CircuitBreaker Tests
// ========================================================================

console.log('\n=== CircuitBreaker Tests ===\n');

function testCircuitBreaker() {
  const cb = new CircuitBreaker('test-service', {
    failureThreshold: 3,
    cooldownMs: 100,
    successThreshold: 2
  });
  
  // Initial state
  test('Initial state is CLOSED', () => {
    assertEqual(cb.getState().state, CircuitState.CLOSED);
    assertTrue(cb.canAttempt());
  });
  
  // Record failures
  cb.recordFailure('error1');
  test('After 1 failure, still CLOSED', () => {
    assertEqual(cb.getState().state, CircuitState.CLOSED);
    assertEqual(cb.getState().consecutiveFailures, 1);
  });
  
  cb.recordFailure('error2');
  cb.recordFailure('error3');
  test('After threshold, OPEN', () => {
    assertEqual(cb.getState().state, CircuitState.OPEN);
    assertTrue(!cb.canAttempt(), 'Should not allow attempts when open');
  });
  
  // Wait for cooldown
  setTimeout(() => {
    test('After cooldown, HALF_OPEN', () => {
      assertTrue(cb.canAttempt(), 'Should allow attempt after cooldown');
      assertEqual(cb.getState().state, CircuitState.HALF_OPEN);
    });
    
    // Success in half-open
    cb.recordSuccess();
    cb.recordSuccess();
    test('After successes, CLOSED', () => {
      assertEqual(cb.getState().state, CircuitState.CLOSED);
      assertTrue(cb.canAttempt());
    });
  }, 150);
}

testCircuitBreaker();

// Wait for async circuit breaker test
await new Promise(resolve => setTimeout(resolve, 200));

// ========================================================================
// Result<T,E> Tests
// ========================================================================

console.log('\n=== Result<T,E> Tests ===\n');

function testResult() {
  // Success case
  const ok = Result.ok(42);
  test('Result.ok is success', () => {
    assertTrue(ok.isOk());
    assertEqual(ok.value, 42);
    assertEqual(ok.unwrap(), 42);
  });
  
  // Error case
  const err = Result.err(new NotFoundError('user', '123'));
  test('Result.err is error', () => {
    assertTrue(err.isErr());
    assertEqual(err.error.code, ErrorCode.NOT_FOUND);
  });
  
  // unwrapOr
  test('unwrapOr returns value on success', () => {
    assertEqual(ok.unwrapOr(0), 42);
  });
  test('unwrapOr returns default on error', () => {
    assertEqual(err.unwrapOr(0), 0);
  });
  
  // map
  const doubled = ok.map(x => x * 2);
  test('map transforms success', () => {
    assertEqual(doubled.value, 84);
  });
  
  const mapErr = err.map(x => x * 2);
  test('map passes through error', () => {
    assertTrue(mapErr.isErr());
  });
  
  // flatMap
  const chained = ok.flatMap(x => Result.ok(x + 1));
  test('flatMap chains results', () => {
    assertEqual(chained.value, 43);
  });
  
  // orElse
  const recovered = err.orElse(e => Result.ok('recovered'));
  test('orElse recovers from error', () => {
    assertEqual(recovered.value, 'recovered');
  });
  
  // match
  const matchResult = ok.match(
    v => `value: ${v}`,
    e => `error: ${e.message}`
  );
  test('match extracts value', () => {
    assertEqual(matchResult, 'value: 42');
  });
}

testResult();

// ========================================================================
// DI Container Tests
// ========================================================================

console.log('\n=== DIContainer Tests ===\n');

function testDIContainer() {
  const container = new DIContainer({ env: 'test' });
  
  // Register a simple service
  container.register('config', () => ({ env: 'test' }));
  const config = container.resolve('config');
  test('Container resolves service', () => {
    assertEqual(config.env, 'test');
  });
  
  // Singleton behavior
  const config2 = container.resolve('config');
  test('Singleton returns same instance', () => {
    assertTrue(config === config2);
  });
  
  // Dependency injection
  container.register('database', (c) => ({
    url: 'sqlite://test',
    config: c.resolve('config')
  }));
  const db = container.resolve('database');
  test('Dependency injection works', () => {
    assertEqual(db.config.env, 'test');
  });
  
  // registerInstance
  const mockService = { mock: true };
  container.registerInstance('mockService', mockService);
  const resolvedMock = container.resolve('mockService');
  test('registerInstance works', () => {
    assertTrue(resolvedMock === mockService);
  });
  
  // has check
  test('has returns true for registered', () => {
    assertTrue(container.has('config'));
  });
  test('has returns false for unregistered', () => {
    assertTrue(!container.has('nonexistent'));
  });
}

testDIContainer();

// ========================================================================
// Summary
// ========================================================================

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
console.log('\n✓ All tests passed!\n');
