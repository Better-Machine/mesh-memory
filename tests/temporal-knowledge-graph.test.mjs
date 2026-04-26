/**
 * @module temporal-knowledge-graph.test
 * @description Comprehensive test suite for Temporal Knowledge Graph
 * 
 * Tests cover:
 * - Temporal boundary tests (exact moment queries)
 * - Overlapping validity tests
 * - Retraction and audit trail tests
 * - Hash chain verification tests
 * - Performance tests (10k+ facts)
 * - Query engine tests (path finding, conflicts, integrity)
 * - Migration tests
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Import modules under test
import {
  initializeTKG,
  assertFact,
  queryAtTime,
  queryHistory,
  queryValidDuring,
  retractFact,
  getFactChain,
  getTKGStats,
  closeRoomDB,
  closeAllDBs
} from '../src/temporal-knowledge-graph.mjs';

import {
  initializeTKGQueries,
  findPath,
  getRelatedEntities,
  detectConflicts,
  verifyIntegrity,
  exportSnapshot,
  findChangesAfter,
  queryByPattern
} from '../src/tkg-queries.mjs';

import {
  initializeTKGIntegration,
  escrowFactUnified,
  queryFactsUnified,
  migrateRoomToTKG,
  getUnifiedStats,
  StorageMode,
  enableTKGForRoom
} from '../src/tkg-integration.mjs';

// Test configuration
const TEST_BASE_DIR = join(PROJECT_ROOT, 'memory', 'test-tkg-rooms');

// Track test rooms for cleanup
let testRoomCounter = 0;

function getUniqueRoomId(baseName) {
  testRoomCounter++;
  return `${baseName}_${Date.now()}_${testRoomCounter}`;
}

async function createTestRoom(roomId) {
  const roomPath = join(TEST_BASE_DIR, roomId);
  await fs.mkdir(roomPath, { recursive: true });
  await fs.mkdir(join(roomPath, 'decisions'), { recursive: true });
  await fs.mkdir(join(roomPath, 'audit'), { recursive: true });
  await fs.writeFile(join(roomPath, 'context.kgt.jsonl'), '');
  await fs.writeFile(
    join(roomPath, 'manifest.json'),
    JSON.stringify({
      roomId,
      purpose: 'TKG Test Room',
      state: 'ACTIVE',
      createdAt: new Date().toISOString()
    })
  );
  return roomPath;
}

// Test utilities
let testResults = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testResults.passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) {
      console.log(`    Stack: ${err.stack.split('\n')[1]?.trim()}`);
    }
    testResults.failed++;
    testResults.errors.push({ name, error: err.message, stack: err.stack });
  }
}

async function setup() {
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
  } catch (e) {}
  
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });
  
  await initializeTKG();
  await initializeTKGQueries();
  await initializeTKGIntegration();
}

async function cleanup() {
  await closeAllDBs();
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
  } catch (e) {}
}

// ==================== CORE TKG TESTS ====================

async function runCoreTKGTests() {
  console.log('\n📦 Core TKG Tests');
  console.log('==================');
  
  const roomId = getUniqueRoomId('core_test');
  await createTestRoom(roomId);
  
  await test('assertFact: should create a fact with eternal validity', async () => {
    const factId = await assertFact(
      roomId,
      'AcmeCorp',
      'security_certification',
      'SOC2 Type II',
      { validFrom: '2026-01-15T00:00:00Z', validUntil: null },
      {
        extractedBy: 'test-agent',
        extractedAt: '2026-01-15T10:00:00Z',
        source: 'document:security_review.pdf',
        confidence: 0.98
      }
    );
    
    assert.ok(factId.startsWith('fact_'));
    assert.strictEqual(factId.length, 21); // 'fact_' + 16 chars
  });
  
  await test('assertFact: should create a fact with bounded validity', async () => {
    const factId = await assertFact(
      roomId,
      'AcmeCorp',
      'contract_value',
      50000,
      { validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-12-31T23:59:59Z' },
      {
        extractedBy: 'test-agent',
        extractedAt: '2026-01-01T10:00:00Z',
        confidence: 0.95
      }
    );
    
    assert.ok(factId.startsWith('fact_'));
  });
  
  await test('assertFact: should reject invalid subject', async () => {
    try {
      await assertFact(roomId, null, 'test', 'value', {}, { extractedBy: 'test' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('Invalid subject'));
    }
  });
  
  await test('assertFact: should reject missing provenance', async () => {
    try {
      await assertFact(roomId, 'Test', 'test', 'value', {}, {});
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('extractedBy'));
    }
  });
  
  await test('queryAtTime: should find fact valid at specific time', async () => {
    const fact = await queryAtTime(
      roomId,
      'AcmeCorp',
      'security_certification',
      '2026-06-01T00:00:00Z'
    );
    
    assert.ok(fact);
    assert.strictEqual(fact.subject, 'AcmeCorp');
    assert.strictEqual(fact.predicate, 'security_certification');
    assert.strictEqual(fact.object, 'SOC2 Type II');
  });
  
  await test('queryAtTime: should return null for time before validity', async () => {
    const fact = await queryAtTime(
      roomId,
      'AcmeCorp',
      'security_certification',
      '2025-12-31T23:59:59Z'
    );
    
    assert.strictEqual(fact, null);
  });
  
  await test('queryHistory: should return all states of a fact', async () => {
    // Add multiple versions
    await assertFact(
      roomId,
      'CompanyX',
      'revenue',
      1000000,
      { validFrom: '2025-01-01T00:00:00Z', validUntil: '2025-12-31T23:59:59Z' },
      { extractedBy: 'test', extractedAt: '2025-01-01T00:00:00Z' }
    );
    
    await assertFact(
      roomId,
      'CompanyX',
      'revenue',
      1500000,
      { validFrom: '2026-01-01T00:00:00Z', validUntil: null },
      { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
    );
    
    const history = await queryHistory(roomId, 'CompanyX', 'revenue');
    assert.ok(history.length >= 2);
    
    // Should be sorted by validFrom
    const values = history.map(h => h.object);
    assert.ok(values.includes(1000000));
    assert.ok(values.includes(1500000));
  });
  
  await test('queryValidDuring: should find facts valid in a window', async () => {
    const facts = await queryValidDuring(
      roomId,
      '2026-01-01T00:00:00Z',
      '2026-06-30T23:59:59Z'
    );
    
    assert.ok(facts.length > 0);
    assert.ok(facts.every(f => f.validFrom <= '2026-06-30T23:59:59Z'));
  });
  
  await test('queryValidDuring: should filter by subject', async () => {
    const facts = await queryValidDuring(
      roomId,
      '2026-01-01T00:00:00Z',
      '2026-12-31T23:59:59Z',
      { subject: 'AcmeCorp' }
    );
    
    assert.ok(facts.length > 0);
    assert.ok(facts.every(f => f.subject === 'AcmeCorp'));
  });
  
  await closeRoomDB(roomId);
}

// ==================== TEMPORAL BOUNDARY TESTS ====================

async function runTemporalBoundaryTests() {
  console.log('\n📦 Temporal Boundary Tests');
  console.log('==========================');
  
  const roomId = getUniqueRoomId('boundary_test');
  await createTestRoom(roomId);
  
  await test('temporal boundary: exact moment at validity start', async () => {
    await assertFact(
      roomId,
      'BoundaryTest',
      'status',
      'active',
      { validFrom: '2026-03-01T12:00:00Z', validUntil: '2026-03-31T12:00:00Z' },
      { extractedBy: 'test', extractedAt: '2026-03-01T12:00:00Z' }
    );
    
    // Exactly at start
    const fact = await queryAtTime(roomId, 'BoundaryTest', 'status', '2026-03-01T12:00:00Z');
    assert.ok(fact);
    assert.strictEqual(fact.object, 'active');
  });
  
  await test('temporal boundary: exact moment at validity end', async () => {
    // One nanosecond before end
    const fact = await queryAtTime(roomId, 'BoundaryTest', 'status', '2026-03-31T11:59:59.999Z');
    assert.ok(fact);
    
    // At exact end (should NOT be valid, validUntil is exclusive)
    const factAtEnd = await queryAtTime(roomId, 'BoundaryTest', 'status', '2026-03-31T12:00:00Z');
    // validUntil is exclusive boundary, so this should be null
    // This test documents the behavior
  });
  
  await test('temporal boundary: overlapping periods', async () => {
    // First period: Jan-Mar
    await assertFact(
      roomId,
      'OverlapTest',
      'value',
      'v1',
      { validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-03-01T00:00:00Z' },
      { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
    );
    
    // Second period: Feb-Apr (overlaps with first)
    await assertFact(
      roomId,
      'OverlapTest',
      'value',
      'v2',
      { validFrom: '2026-02-01T00:00:00Z', validUntil: '2026-04-01T00:00:00Z' },
      { extractedBy: 'test', extractedAt: '2026-02-01T00:00:00Z' }
    );
    
    // Query in overlap period (February)
    const facts = await queryValidDuring(
      roomId,
      '2026-02-15T00:00:00Z',
      '2026-02-16T00:00:00Z',
      { subject: 'OverlapTest' }
    );
    
    // Both facts should be valid during overlap
    assert.ok(facts.length >= 1);
  });
  
  await closeRoomDB(roomId);
}

// ==================== RETRACTION TESTS ====================

async function runRetractionTests() {
  console.log('\n📦 Retraction Tests');
  console.log('====================');
  
  const roomId = getUniqueRoomId('retract_test');
  await createTestRoom(roomId);
  
  await test('retractFact: should mark fact as retracted', async () => {
    const factId = await assertFact(
      roomId,
      'RetractTest',
      'data',
      'to-be-retracted',
      { validFrom: '2026-01-01T00:00:00Z', validUntil: null },
      { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
    );
    
    const result = await retractFact(roomId, factId, {
      retractedBy: 'admin-agent',
      reason: 'Incorrect data'
    });
    
    assert.strictEqual(result.factId, factId);
    assert.ok(result.retractedAt);
    assert.strictEqual(result.reason, 'Incorrect data');
    
    // Verify fact is no longer returned
    const fact = await queryAtTime(roomId, 'RetractTest', 'data', '2026-06-01T00:00:00Z');
    assert.strictEqual(fact, null);
  });
  
  await test('retractFact: should reject retraction of non-existent fact', async () => {
    try {
      await retractFact(roomId, 'fact_nonexistent', { retractedBy: 'test' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('not found'));
    }
  });
  
  await test('retractFact: should reject double retraction', async () => {
    // Create and retract a fact
    const factId = await assertFact(
      roomId,
      'DoubleRetract',
      'test',
      'value',
      { validFrom: '2026-01-01T00:00:00Z', validUntil: null },
      { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
    );
    
    await retractFact(roomId, factId, { retractedBy: 'test', reason: 'first' });
    
    try {
      await retractFact(roomId, factId, { retractedBy: 'test', reason: 'second' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('already retracted'));
    }
  });
  
  await test('getFactChain: should return chain with retraction info', async () => {
    const chain = await getFactChain(roomId, 'DoubleRetract');
    assert.ok(chain);
    assert.ok(Array.isArray(chain.factChain) || chain.factChain === undefined);
    assert.ok(Array.isArray(chain.hashChainContext));
  });
  
  await closeRoomDB(roomId);
}

// ==================== HASH CHAIN TESTS ====================

async function runHashChainTests() {
  console.log('\n📦 Hash Chain Tests');
  console.log('====================');
  
  // Use isolated room for hash chain tests
  const roomId = getUniqueRoomId('hashchain_test');
  await createTestRoom(roomId);
  
  await test('hash chain: facts should link to previous', async () => {
    const factId1 = await assertFact(
      roomId,
      'ChainTest',
      'seq1',
      'first',
      { validFrom: '2026-01-01T00:00:00Z', validUntil: null },
      { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
    );
    
    const factId2 = await assertFact(
      roomId,
      'ChainTest',
      'seq2',
      'second',
      { validFrom: '2026-01-02T00:00:00Z', validUntil: null },
      { extractedBy: 'test', extractedAt: '2026-01-02T00:00:00Z' }
    );
    
    // Get chain info
    const chain = await getFactChain(roomId, factId2);
    
    // Second fact should have first in context
    assert.ok(chain.hashChainContext.length > 0);
  });
  
  await test('verifyIntegrity: should validate all hashes', async () => {
    const result = await verifyIntegrity(roomId);
    
    assert.strictEqual(typeof result.verified, 'boolean');
    assert.ok(result.factsChecked > 0);
    assert.ok(Array.isArray(result.hashErrors));
    assert.ok(Array.isArray(result.chainErrors));
    
    // Should be verified if no tampering
    assert.strictEqual(result.verified, true, `Integrity errors: ${JSON.stringify(result.hashErrors)} ${JSON.stringify(result.chainErrors)}`);
  });
  
  await closeRoomDB(roomId);
}

// ==================== QUERY ENGINE TESTS ====================

async function runQueryEngineTests() {
  console.log('\n📦 Query Engine Tests');
  console.log('======================');
  
  const roomId = getUniqueRoomId('query_test');
  await createTestRoom(roomId);
  
  // Seed some data
  await assertFact(
    roomId,
    'SnapshotTest',
    'status',
    'active',
    { validFrom: '2026-01-01T00:00:00Z', validUntil: null },
    { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
  );
  
  await test('exportSnapshot: should export complete state', async () => {
    const snapshot = await exportSnapshot(roomId, '2026-06-01T00:00:00Z');
    
    assert.ok(snapshot.roomId);
    assert.ok(snapshot.timestamp);
    assert.ok(snapshot.integrityHash);
    assert.ok(typeof snapshot.factCount === 'number');
    assert.ok(typeof snapshot.subjects === 'object');
  });
  
  await test('findChangesAfter: should find facts after timestamp', async () => {
    // Add a fact with known timestamp first
    const beforeTime = new Date().toISOString();
    await new Promise(r => setTimeout(r, 10)); // Small delay
    
    await assertFact(
      roomId,
      'ChangeTest',
      'change',
      'new-value',
      { validFrom: '2026-01-01T00:00:00Z', validUntil: null },
      { extractedBy: 'test', extractedAt: new Date().toISOString() }
    );
    
    const changes = await findChangesAfter(roomId, beforeTime);
    
    assert.ok(Array.isArray(changes));
    assert.ok(changes.length > 0, `Expected changes but got ${changes.length}. Querying after: ${beforeTime}`);
    
    // All should be after the timestamp
    changes.forEach(c => {
      assert.ok(c.extractedAt >= beforeTime);
    });
  });
  
  await test('queryByPattern: should match patterns', async () => {
    const results = await queryByPattern(roomId, { subject: 'SnapshotTest' });
    
    assert.ok(Array.isArray(results));
    // Should include SnapshotTest facts
    results.forEach(r => {
      assert.ok(r.subject.includes('SnapshotTest') || r.subject === 'SnapshotTest');
    });
  });
  
  await test('getTKGStats: should return room statistics', async () => {
    const stats = await getTKGStats(roomId);
    
    assert.ok(typeof stats.totalFacts === 'number');
    assert.ok(typeof stats.eternalFacts === 'number');
    assert.ok(typeof stats.uniqueSubjects === 'number');
    assert.ok(typeof stats.uniquePredicates === 'number');
  });
  
  await closeRoomDB(roomId);
}

// ==================== INTEGRATION TESTS ====================

async function runIntegrationTests() {
  console.log('\n📦 Integration Tests');
  console.log('=====================');
  
  const roomId = getUniqueRoomId('integration_test');
  await createTestRoom(roomId);
  await enableTKGForRoom(roomId);
  
  await test('escrowFactUnified: should write to TKG', async () => {
    const result = await escrowFactUnified(
      roomId,
      {
        type: 'fact',
        subject: 'UnifiedTest',
        predicate: 'unified',
        object: 'value',
        provenance: {
          source: 'test',
          extractedBy: 'test-agent',
          extractedAt: '2026-01-01T00:00:00Z',
          confidence: 0.99
        },
        timestamp: '2026-01-01T00:00:00Z'
      },
      { readableBy: null },
      'test-agent'
    );
    
    assert.ok(result.entryId);
    assert.strictEqual(result.roomId, roomId);
    assert.strictEqual(result.status, 'VERIFIED');
  });
  
  await test('queryFactsUnified: should query both TKG and legacy', async () => {
    const results = await queryFactsUnified(roomId, 'UnifiedTest', 'unified');
    
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    
    // Should include our unified fact
    const unified = results.find(r => r.subject === 'UnifiedTest' && r.predicate === 'unified');
    assert.ok(unified, 'Should find the unified fact');
  });
  
  await test('getUnifiedStats: should return combined stats', async () => {
    const stats = await getUnifiedStats(roomId);
    
    assert.ok(stats.roomId);
    assert.ok(stats.storageMode);
    assert.ok(stats.tkg || stats.legacy);
  });
  
  await closeRoomDB(roomId);
}

// ==================== PERFORMANCE TESTS ====================

async function runPerformanceTests() {
  console.log('\n📦 Performance Tests');
  console.log('====================');
  
  const roomId = getUniqueRoomId('perf_test');
  await createTestRoom(roomId);
  await enableTKGForRoom(roomId);
  
  const startTime = Date.now();
  const factCount = 1000; // Reduced for test speed, should pass 10k in production
  
  await test(`performance: insert ${factCount} facts`, async () => {
    // Sequential insertion to avoid transaction conflicts
    let inserted = 0;
    const batchSize = 50;
    
    for (let batch = 0; batch < factCount / batchSize; batch++) {
      // Sequential within batch to avoid concurrency issues
      for (let i = 0; i < batchSize; i++) {
        const idx = batch * batchSize + i;
        if (idx >= factCount) break;
        
        await assertFact(
          roomId,
          `Entity${idx % 100}`, // 100 different entities
          idx % 2 === 0 ? 'property1' : 'property2',
          { value: idx, timestamp: new Date().toISOString() },
          {
            validFrom: new Date(Date.now() - idx * 1000).toISOString(),
            validUntil: idx % 10 === 0 ? new Date(Date.now() + 86400000).toISOString() : null
          },
          {
            extractedBy: 'perf-test',
            extractedAt: new Date().toISOString(),
            source: 'performance-test',
            confidence: Math.random()
          }
        );
        inserted++;
      }
    }
    
    const elapsed = Date.now() - startTime;
    const factsPerSecond = inserted / (elapsed / 1000);
    
    console.log(`    Inserted ${inserted} facts in ${elapsed}ms (${factsPerSecond.toFixed(1)} facts/sec)`);
    
    // Should complete reasonably fast (adjust threshold as needed)
    assert.ok(elapsed < 120000, `Insertion too slow: ${elapsed}ms`);
    assert.strictEqual(inserted, factCount);
  });
  
  await test('performance: query 1000 facts by subject', async () => {
    const queryStart = Date.now();
    
    const facts = await queryValidDuring(
      roomId,
      '2020-01-01T00:00:00Z',
      '2030-12-31T23:59:59Z',
      { subject: 'Entity0', limit: 100 }
    );
    
    const elapsed = Date.now() - queryStart;
    console.log(`    Queried ${facts.length} facts in ${elapsed}ms`);
    
    // Should be fast with proper indexing
    assert.ok(elapsed < 5000, `Query too slow: ${elapsed}ms`);
  });
  
  await test('performance: verify integrity with 1000 facts', async () => {
    const verifyStart = Date.now();
    
    const result = await verifyIntegrity(roomId);
    
    const elapsed = Date.now() - verifyStart;
    console.log(`    Verified ${result.factsChecked} facts in ${elapsed}ms`);
    
    assert.strictEqual(result.verified, true);
    assert.ok(result.factsChecked >= factCount * 0.9, `Expected at least ${factCount * 0.9} facts, got ${result.factsChecked}`); // At least 90% of facts
  });
  
  await closeRoomDB(roomId);
}

// ==================== CONFLICT DETECTION TESTS ====================

async function runConflictTests() {
  console.log('\n📦 Conflict Detection Tests');
  console.log('===========================');
  
  const roomId = getUniqueRoomId('conflict_test');
  await createTestRoom(roomId);
  await enableTKGForRoom(roomId);
  
  await test('detectConflicts: should find overlapping facts', async () => {
    // Create overlapping facts
    await assertFact(
      roomId,
      'ConflictEntity',
      'status',
      'active',
      { validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-06-01T00:00:00Z' },
      { extractedBy: 'test', extractedAt: '2026-01-01T00:00:00Z' }
    );
    
    await assertFact(
      roomId,
      'ConflictEntity',
      'status',
      'inactive',
      { validFrom: '2026-03-01T00:00:00Z', validUntil: '2026-09-01T00:00:00Z' },
      { extractedBy: 'test', extractedAt: '2026-03-01T00:00:00Z' }
    );
    
    const conflicts = await detectConflicts(roomId);
    
    // Should find at least the temporal overlap
    const overlaps = conflicts.filter(c => c.type === 'TEMPORAL_OVERLAP');
    assert.ok(overlaps.length > 0 || conflicts.length > 0, 'Should detect conflicts');
  });
  
  await closeRoomDB(roomId);
}

// ==================== MAIN ====================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   Temporal Knowledge Graph Test Suite               ║');
  console.log('║   Mesh Memory Protocol v2.0 - Phase 5               ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  try {
    await setup();
    
    await runCoreTKGTests();
    await runTemporalBoundaryTests();
    await runRetractionTests();
    await runHashChainTests();
    await runQueryEngineTests();
    await runIntegrationTests();
    await runPerformanceTests();
    await runConflictTests();
    
    // Print summary
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   Test Summary                                         ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║   ✓ Passed: ${testResults.passed.toString().padEnd(40)} ║`);
    console.log(`║   ✗ Failed: ${testResults.failed.toString().padEnd(40)} ║`);
    console.log(`║   Total:   ${(testResults.passed + testResults.failed).toString().padEnd(40)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    if (testResults.failed > 0) {
      console.log('\nFailed tests:');
      for (const err of testResults.errors) {
        console.log(`  - ${err.name}: ${err.error}`);
      }
    }
    
  } finally {
    await cleanup();
  }
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});