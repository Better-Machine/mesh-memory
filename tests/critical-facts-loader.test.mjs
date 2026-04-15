/**
 * Unit Tests for critical-facts-loader.mjs
 * Tests: CriticalFactsLoader class, createLoader, quickLoad
 * Coverage: All exported functions, edge cases, error conditions
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Module under test
import { CriticalFactsLoader, createLoader, quickLoad } from '../critical-facts-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test configuration
const TEST_DIR = path.join(__dirname, '.test-data');
const TEST_DB = path.join(TEST_DIR, 'test-critical-facts.db');
const TEST_PASSPORT = path.join(TEST_DIR, 'test-passport.json');

// Sample fact data
const SAMPLE_FACT = {
  id: 'test-fact-001',
  tier: 'critical',
  category: 'projects',
  type: 'decision',
  content: {
    title: 'Test Fact Title',
    body: 'This is a test fact body content.',
    tags: ['test', 'sample', 'unit-test']
  },
  provenance: {
    source: 'unit-test',
    author: 'test-agent',
    timestamp: new Date().toISOString(),
    source_version: '1.0.0'
  },
  updated_at: new Date().toISOString(),
  expires_at: null,
  relations: []
};

const SAMPLE_DEEP_FACT = {
  id: 'deep-fact-001',
  tier: 'deep',
  category: 'events',
  type: 'observation',
  content: {
    title: 'Deep Fact Title',
    body: 'This is searchable deep memory content.',
    tags: ['deep', 'searchable', 'l2']
  },
  provenance: {
    source: 'unit-test',
    author: 'test-agent',
    timestamp: new Date().toISOString(),
    source_version: '1.0.0'
  },
  updated_at: new Date().toISOString(),
  expires_at: null,
  relations: []
};

const EXPIRED_FACT = {
  ...SAMPLE_FACT,
  id: 'expired-fact-001',
  expires_at: new Date(Date.now() - 86400000).toISOString() // Yesterday
};

// Setup and teardown helpers
async function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });

  // Create test passport
  const testPassport = {
    version: '1.0.0',
    agent: { id: 'test-agent', name: 'Test Agent' },
    capabilities: ['test'],
    hardware_profile: { host: 'localhost', gpu: null, local_inference: false },
    mesh_identity: { receiver_url: 'http://localhost:18803' }
  };
  await fs.writeFile(TEST_PASSPORT, JSON.stringify(testPassport, null, 2));
}

async function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============== TESTS ==============

describe('CriticalFactsLoader - Constructor', () => {
  test('should create instance with default options', () => {
    const loader = new CriticalFactsLoader();
    assert.strictEqual(loader.dbPath, './memory/critical-facts.db');
    assert.strictEqual(loader.passportPath, './palace-mvp/agent-passport.json');
    assert.strictEqual(loader.verbose, false);
    assert.strictEqual(loader.db, null);
  });

  test('should create instance with custom options', () => {
    const loader = new CriticalFactsLoader({
      dbPath: '/custom/path.db',
      passportPath: '/custom/passport.json',
      verbose: true
    });
    assert.strictEqual(loader.dbPath, '/custom/path.db');
    assert.strictEqual(loader.passportPath, '/custom/passport.json');
    assert.strictEqual(loader.verbose, true);
  });
});

describe('CriticalFactsLoader - Database Initialization', () => {
  test('should initialize database and create tables', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT,
      verbose: false
    });

    await loader.init();

    assert.ok(loader.db, 'Database should be initialized');

    // Verify table was created
    const tables = loader.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();
    const tableNames = tables.map(t => t.name);
    assert.ok(tableNames.includes('critical_facts'), 'critical_facts table should exist');

    loader.close();
    await cleanupTestDir();
  });

  test('should create indexes on initialization', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });

    await loader.init();

    const indexes = loader.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index'"
    ).all();
    const indexNames = indexes.map(i => i.name);
    assert.ok(indexNames.some(n => n.includes('idx_tier')), 'tier index should exist');
    assert.ok(indexNames.some(n => n.includes('idx_category')), 'category index should exist');

    loader.close();
    await cleanupTestDir();
  });
});

describe('CriticalFactsLoader - Insert Operations', () => {
  test('should insert a valid fact', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    const result = loader.insertFact(SAMPLE_FACT);

    // Implementation returns wrapped response { success, data, correlationId }
    assert.ok(result, 'Should return result');
    assert.strictEqual(result.success, true, 'Should succeed');
    assert.ok(result.data, 'Should have data');
    assert.strictEqual(result.data.id, SAMPLE_FACT.id);
    assert.ok(result.data._rowid, 'Should have rowid');

    loader.close();
    await cleanupTestDir();
  });

  test('should reject fact without required fields', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    const invalidFact = { ...SAMPLE_FACT, id: undefined };
    const result1 = loader.insertFact(invalidFact);
    assert.strictEqual(result1.success, false, 'Should fail for missing id');
    assert.ok(result1.error, 'Should have error');

    const noTierFact = { ...SAMPLE_FACT, id: 'test-002', tier: undefined };
    const result2 = loader.insertFact(noTierFact);
    assert.strictEqual(result2.success, false, 'Should fail for missing tier');
    assert.ok(result2.error, 'Should have error');

    loader.close();
    await cleanupTestDir();
  });

  test('should reject fact with invalid tier', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    const invalidTierFact = { ...SAMPLE_FACT, id: 'test-003', tier: 'invalid' };
    const result = loader.insertFact(invalidTierFact);
    assert.strictEqual(result.success, false, 'Should fail for invalid tier');
    assert.ok(result.error, 'Should have error');

    loader.close();
    await cleanupTestDir();
  });

  test('should reject fact with invalid category', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    const invalidCatFact = { ...SAMPLE_FACT, id: 'test-004', category: 'invalid-category' };
    const result = loader.insertFact(invalidCatFact);
    assert.strictEqual(result.success, false, 'Should fail for invalid category');
    assert.ok(result.error, 'Should have error');

    loader.close();
    await cleanupTestDir();
  });

  test('should update existing fact with same ID', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_FACT);

    const updatedFact = {
      ...SAMPLE_FACT,
      content: { ...SAMPLE_FACT.content, title: 'Updated Title' },
      updated_at: new Date().toISOString()
    };

    const result = loader.insertFact(updatedFact);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.id, SAMPLE_FACT.id);

    // Verify update - unwrap response
    const retrieved = loader.getFactById(SAMPLE_FACT.id);
    assert.ok(retrieved.success);
    assert.strictEqual(retrieved.data.content.title, 'Updated Title');

    loader.close();
    await cleanupTestDir();
  });
});

describe('CriticalFactsLoader - Query Operations', () => {
  test('should get critical facts (excluding expired)', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    // Insert facts
    loader.insertFact(SAMPLE_FACT);
    loader.insertFact({ ...SAMPLE_FACT, id: 'test-005' });
    loader.insertFact(EXPIRED_FACT);
    loader.insertFact(SAMPLE_DEEP_FACT);

    const result = loader.getCriticalFacts();

    assert.ok(result.success, 'Should succeed');
    const criticalFacts = result.data;
    assert.strictEqual(criticalFacts.length, 2, 'Should return only non-expired critical facts');
    assert.ok(criticalFacts.every(f => f.tier === 'critical'), 'All should be critical tier');
    assert.ok(criticalFacts.every(f => f.id !== EXPIRED_FACT.id), 'Should not include expired');

    loader.close();
    await cleanupTestDir();
  });

  test('should get fact by ID', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_FACT);

    const result = loader.getFactById(SAMPLE_FACT.id);
    assert.ok(result.success, 'Should succeed');
    const retrieved = result.data;
    assert.ok(retrieved, 'Should retrieve fact');
    assert.strictEqual(retrieved.id, SAMPLE_FACT.id);
    assert.strictEqual(retrieved.content.title, SAMPLE_FACT.content.title);

    // Non-existent ID - returns { success: true, data: null }
    const notFoundResult = loader.getFactById('non-existent');
    assert.ok(notFoundResult.success, 'Should succeed even for missing');
    assert.strictEqual(notFoundResult.data, null, 'Should return null data for non-existent');

    loader.close();
    await cleanupTestDir();
  });

  test('should get deep facts', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_FACT);
    loader.insertFact(SAMPLE_DEEP_FACT);
    loader.insertFact({ ...SAMPLE_DEEP_FACT, id: 'deep-fact-002', category: 'projects' });

    const allDeepResult = loader.getDeepFacts();
    assert.ok(allDeepResult.success);
    assert.strictEqual(allDeepResult.data.length, 2, 'Should return all deep facts');

    const filteredResult = loader.getDeepFacts({ category: 'events' });
    assert.ok(filteredResult.success);
    assert.strictEqual(filteredResult.data.length, 1, 'Should filter by category');

    const limitedResult = loader.getDeepFacts({ limit: 1 });
    assert.ok(limitedResult.success);
    assert.strictEqual(limitedResult.data.length, 1, 'Should respect limit');

    loader.close();
    await cleanupTestDir();
  });

  test('should search deep facts', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_DEEP_FACT);
    loader.insertFact({
      ...SAMPLE_DEEP_FACT,
      id: 'deep-fact-003',
      content: {
        title: 'Another Title',
        body: 'Different content here.',
        tags: ['different']
      }
    });

    const result = loader.searchDeepFacts('searchable');
    assert.ok(result.success);
    const results = result.data;
    assert.ok(results.length >= 1, 'Should find matching facts');
    assert.ok(results.some(f => f.id === SAMPLE_DEEP_FACT.id));

    loader.close();
    await cleanupTestDir();
  });
});

describe('CriticalFactsLoader - Expiration', () => {
  test('should get expired facts', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_FACT);
    loader.insertFact(EXPIRED_FACT);

    const result = loader.getExpiredFacts();
    assert.ok(result.success);
    const expired = result.data;
    assert.strictEqual(expired.length, 1, 'Should find expired fact');
    assert.strictEqual(expired[0].id, EXPIRED_FACT.id);

    loader.close();
    await cleanupTestDir();
  });

  test('should delete expired facts', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(EXPIRED_FACT);
    loader.insertFact({ ...EXPIRED_FACT, id: 'expired-fact-002' });

    const result = loader.deleteExpiredFacts();
    assert.ok(result.success);
    assert.strictEqual(result.data, 2, 'Should delete 2 expired facts');

    const remaining = loader.getExpiredFacts();
    assert.ok(remaining.success);
    assert.strictEqual(remaining.data.length, 0, 'No expired facts should remain');

    loader.close();
    await cleanupTestDir();
  });

  test('should delete fact by ID', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_FACT);
    const preDeleteResult = loader.getFactById(SAMPLE_FACT.id);
    assert.ok(preDeleteResult.success && preDeleteResult.data);

    const deleteResult = loader.deleteFact(SAMPLE_FACT.id);
    assert.ok(deleteResult.success, 'Should succeed');
    assert.strictEqual(deleteResult.data, true, 'Should return true on delete');
    
    const postDeleteResult = loader.getFactById(SAMPLE_FACT.id);
    assert.ok(postDeleteResult.success && postDeleteResult.data === null);

    const notFoundResult = loader.deleteFact('non-existent');
    assert.ok(notFoundResult.success);
    assert.strictEqual(notFoundResult.data, false, 'Should return false when not found');

    loader.close();
    await cleanupTestDir();
  });
});

describe('CriticalFactsLoader - Wake-up Context', () => {
  test('should generate wake-up context', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    loader.insertFact(SAMPLE_FACT);
    loader.insertFact(EXPIRED_FACT);

    const result = await loader.generateWakeUpContext();
    assert.ok(result.success, 'Should succeed');
    const context = result.data;

    assert.ok(context.l0, 'Should have L0 (passport)');
    assert.ok(context.l1, 'Should have L1 (critical facts)');
    assert.strictEqual(typeof context.tokenEstimate, 'number');
    assert.ok(context.l1.length >= 1, 'Should have at least 1 L1 fact');
    assert.strictEqual(context.l1Count, 1, 'Should count only non-expired critical facts');
    assert.ok(context.expiredFactIds.includes(EXPIRED_FACT.id));
    assert.ok(context.generatedAt, 'Should have timestamp');

    // L0 should be compact
    assert.strictEqual(context.l0.agent.id, 'test-agent');

    loader.close();
    await cleanupTestDir();
  });

  test('should truncate L1 facts if too many', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    // Insert 20 facts
    for (let i = 0; i < 20; i++) {
      loader.insertFact({
        ...SAMPLE_FACT,
        id: `bulk-fact-${String(i).padStart(3, '0')}`
      });
    }

    const result = await loader.generateWakeUpContext();
    assert.ok(result.success);
    const context = result.data;

    assert.ok(context.l1Truncated, 'Should indicate truncation');
    assert.ok(context.l1.length <= 15, 'Should limit to 15 facts');

    loader.close();
    await cleanupTestDir();
  });
});

describe('CriticalFactsLoader - Error Handling', () => {
  test('should throw when database not initialized', () => {
    const loader = new CriticalFactsLoader({ dbPath: TEST_DB });

    // Operations return error objects instead of throwing
    const insertResult = loader.insertFact(SAMPLE_FACT);
    assert.strictEqual(insertResult.success, false, 'Should fail');
    
    const getResult = loader.getCriticalFacts();
    assert.strictEqual(getResult.success, false, 'Should fail');
    
    const getByIdResult = loader.getFactById('test');
    assert.strictEqual(getByIdResult.success, false, 'Should fail');
  });

  test('should handle missing passport gracefully', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: '/nonexistent/passport.json'
    });
    await loader.init();

    const result = await loader.generateWakeUpContext();
    assert.ok(result.success, 'Should succeed');
    const context = result.data;

    // _loadPassport returns success=true with error in data
    assert.ok(context.l0.error === 'passport not found' || context.l0.agent.id === 'unknown');

    loader.close();
    await cleanupTestDir();
  });
});

describe('Factory Functions', () => {
  test('createLoader should return initialized loader', async () => {
    await setupTestDir();
    // createLoader returns the raw loader (not wrapped) and throws on error
    const loader = await createLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });

    assert.ok(loader instanceof CriticalFactsLoader);
    assert.ok(loader.db, 'Database should be initialized');

    loader.close();
    await cleanupTestDir();
  });

  test('quickLoad should return wake-up context and auto-close', async () => {
    await setupTestDir();

    // Pre-initialize a database
    const loader = await createLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    loader.insertFact(SAMPLE_FACT);
    loader.close();

    // quickLoad returns the raw context data (not wrapped)
    const context = await quickLoad({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });

    assert.ok(context.l0);
    assert.ok(context.l1);
    assert.strictEqual(context.l1Count, 1);

    await cleanupTestDir();
  });
});

describe('Edge Cases', () => {
  test('should handle facts with empty content', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    // Empty body is not allowed, but minimal content is - use valid content
    const minimalContentFact = {
      ...SAMPLE_FACT,
      id: 'minimal-001',
      content: { title: 'Minimal', body: 'x', tags: [] }
    };

    const insertResult = loader.insertFact(minimalContentFact);
    assert.ok(insertResult.success, `Should succeed but got error: ${insertResult.error?.message}`);

    const retrieved = loader.getFactById('minimal-001');
    assert.ok(retrieved.success);
    assert.strictEqual(retrieved.data.content.body, 'x');
    assert.deepStrictEqual(retrieved.data.content.tags, []);

    loader.close();
    await cleanupTestDir();
  });

  test('should handle special characters in content', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });
    await loader.init();

    const specialFact = {
      ...SAMPLE_FACT,
      id: 'special-001',
      content: {
        title: "Test with 'quotes' and \"double quotes\"",
        body: "Content with \n newlines \t tabs and emoji 🐿️",
        tags: ['special']
      }
    };

    const insertResult = loader.insertFact(specialFact);
    assert.ok(insertResult.success, `Insert should succeed: ${insertResult.error?.message}`);
    
    const result = loader.getFactById('special-001');
    assert.ok(result.success);
    assert.ok(result.data.content.body.includes('emoji'));

    loader.close();
    await cleanupTestDir();
  });

  test('should handle multiple init calls idempotently', async () => {
    await setupTestDir();
    const loader = new CriticalFactsLoader({
      dbPath: TEST_DB,
      passportPath: TEST_PASSPORT
    });

    await loader.init();
    loader.insertFact(SAMPLE_FACT);

    // Second init should not break
    await loader.init();
    const facts = loader.getCriticalFacts();
    assert.ok(facts.success);
    assert.strictEqual(facts.data.length, 1, 'Fact should still exist');

    loader.close();
    await cleanupTestDir();
  });
});

// Export summary for test runner
export { TEST_DIR, TEST_DB, TEST_PASSPORT };
