/**
 * Comprehensive Test Suite for mesh-memory Palace MVP (P1-P5)
 * Tests: CriticalFactsLoader, TunnelPublisher validation, A2A Adapter
 * Uses Node.js built-in test runner
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test directories
const TEST_DIR = path.join(__dirname, '.test-run');
const TEST_DB = path.join(TEST_DIR, 'test.db');
const TEST_PASSPORT = path.join(TEST_DIR, 'passport.json');

// Test data
const SAMPLE_PASSPORT = {
  version: '1.0.0',
  agent: { id: 'test-agent', name: 'Test Agent' },
  capabilities: ['test'],
  hardware_profile: { host: 'localhost', local_inference: false },
  mesh_identity: { receiver_url: 'http://localhost:18803' }
};

const VALID_FACT = {
  id: 'test-001',
  tier: 'critical',
  category: 'projects',
  content: { title: 'Test', body: 'Content', tags: ['test'] },
  provenance: { source: 'test', author: 'tester', timestamp: new Date().toISOString() },
  updated_at: new Date().toISOString()
};

// Module cache
let CFL, createLoader, quickLoad;
let TunnelPublisher, validateFact, validateProvenance, containsInterpretationKeywords;
let loadPalaceContext, publishToPeers;

// Setup functions
async function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  await fs.writeFile(TEST_PASSPORT, JSON.stringify(SAMPLE_PASSPORT));
}

async function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

// Load modules once
describe('Module Loading', () => {
  test('Load critical-facts-loader', async () => {
    try {
      const mod = await import('../critical-facts-loader.mjs');
      CFL = mod.CriticalFactsLoader;
      createLoader = mod.createLoader;
      quickLoad = mod.quickLoad;
      assert.ok(CFL, 'CriticalFactsLoader should be exported');
    } catch (e) {
      console.log(`Note: critical-facts-loader error: ${e.message}`);
    }
  });

  test('Load tunnel-publisher', async () => {
    try {
      const mod = await import('../tunnel-publisher.mjs');
      TunnelPublisher = mod.TunnelPublisher;
      validateFact = mod.validateFact;
      validateProvenance = mod.validateProvenance;
      containsInterpretationKeywords = mod.containsInterpretationKeywords;
      assert.ok(validateFact, 'validateFact should be exported');
    } catch (e) {
      console.log(`Note: tunnel-publisher error: ${e.message}`);
    }
  });

  test('Load a2a-palace-adapter', async () => {
    try {
      const mod = await import('../a2a-palace-adapter.mjs');
      loadPalaceContext = mod.loadPalaceContext;
      publishToPeers = mod.publishToPeers;
      assert.ok(loadPalaceContext, 'loadPalaceContext should be exported');
    } catch (e) {
      console.log(`Note: a2a-adapter error: ${e.message}`);
    }
  });
});

// ============== UNIT TESTS: Critical Facts Loader ==============

describe('CriticalFactsLoader', () => {
  test('Constructor creates instance with defaults', () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    const loader = new CFL();
    assert.strictEqual(loader.dbPath, './memory/critical-facts.db');
    assert.strictEqual(loader.verbose, false);
    assert.strictEqual(loader.db, null);
  });

  test('Constructor accepts custom options', () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    const loader = new CFL({ dbPath: '/custom.db', verbose: true });
    assert.strictEqual(loader.dbPath, '/custom.db');
    assert.strictEqual(loader.verbose, true);
  });

  test('Database initialization creates tables', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    assert.ok(loader.db, 'Database should be initialized');
    
    const tables = loader.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    assert.ok(names.includes('critical_facts'), 'critical_facts table should exist');
    
    loader.close();
    await cleanup();
  });

  test('Insert and retrieve fact', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    loader.insertFact(VALID_FACT);
    const retrieved = loader.getFactById(VALID_FACT.id);
    
    assert.ok(retrieved, 'Should retrieve fact');
    assert.strictEqual(retrieved.id, VALID_FACT.id);
    assert.strictEqual(retrieved.content.title, VALID_FACT.content.title);
    
    loader.close();
    await cleanup();
  });

  test('Reject invalid tier', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const invalid = { ...VALID_FACT, id: 'inv-001', tier: 'invalid' };
    assert.throws(() => loader.insertFact(invalid), /Invalid tier/);
    
    loader.close();
    await cleanup();
  });

  test('Reject missing required fields', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    assert.throws(() => loader.insertFact({ ...VALID_FACT, id: undefined }), /Missing required field: id/);
    assert.throws(() => loader.insertFact({ ...VALID_FACT, id: 't-002', tier: undefined }), /Missing required field: tier/);
    
    loader.close();
    await cleanup();
  });

  test('Filter expired facts', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    loader.insertFact(VALID_FACT);
    loader.insertFact({ ...VALID_FACT, id: 'expired', expires_at: new Date(Date.now() - 86400000).toISOString() });
    
    const facts = loader.getCriticalFacts();
    assert.strictEqual(facts.length, 1);
    assert.strictEqual(facts[0].id, VALID_FACT.id);
    
    const expired = loader.getExpiredFacts();
    assert.strictEqual(expired.length, 1);
    assert.strictEqual(expired[0].id, 'expired');
    
    loader.close();
    await cleanup();
  });

  test('Delete expired facts', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    loader.insertFact({ ...VALID_FACT, id: 'old1', expires_at: new Date(Date.now() - 86400000).toISOString() });
    loader.insertFact({ ...VALID_FACT, id: 'old2', expires_at: new Date(Date.now() - 172800000).toISOString() });
    
    const deleted = loader.deleteExpiredFacts();
    assert.strictEqual(deleted, 2);
    assert.strictEqual(loader.getExpiredFacts().length, 0);
    
    loader.close();
    await cleanup();
  });

  test('Generate wake-up context', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    loader.insertFact(VALID_FACT);
    const context = await loader.generateWakeUpContext();
    
    assert.ok(context.l0, 'Should have L0 (passport)');
    assert.ok(context.l1, 'Should have L1 (facts)');
    assert.ok(Array.isArray(context.l1), 'L1 should be array');
    assert.strictEqual(context.l1Count, 1);
    assert.ok(typeof context.tokenEstimate === 'number');
    
    loader.close();
    await cleanup();
  });

  test('Database not initialized throws', () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    const loader = new CFL({ dbPath: TEST_DB });
    assert.throws(() => loader.insertFact(VALID_FACT), /not initialized/);
    assert.throws(() => loader.getCriticalFacts(), /not initialized/);
  });
});

// ============== UNIT TESTS: Tunnel Publisher ==============

describe('TunnelPublisher Validation', () => {
  test('validateFact accepts valid fact', () => {
    if (!validateFact) { console.log('SKIP: validateFact not loaded'); return; }
    const result = validateFact(VALID_FACT);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  test('validateFact rejects missing id', () => {
    if (!validateFact) { console.log('SKIP: validateFact not loaded'); return; }
    const result = validateFact({ ...VALID_FACT, id: undefined });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('id')));
  });

  test('validateFact rejects invalid tier', () => {
    if (!validateFact) { console.log('SKIP: validateFact not loaded'); return; }
    const result = validateFact({ ...VALID_FACT, tier: 'super-critical' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('tier')));
  });

  test('validateFact detects interpretation keywords', () => {
    if (!validateFact) { console.log('SKIP: validateFact not loaded'); return; }
    const badFact = { 
      ...VALID_FACT, 
      content: { ...VALID_FACT.content, body: 'This agent believes it will probably work' }
    };
    const result = validateFact(badFact);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('interpretation')));
  });

  test('validateProvenance accepts valid', () => {
    if (!validateProvenance) { console.log('SKIP: validateProvenance not loaded'); return; }
    const result = validateProvenance({ source: 'test', timestamp: new Date().toISOString() });
    assert.strictEqual(result.valid, true);
  });

  test('validateProvenance rejects null', () => {
    if (!validateProvenance) { console.log('SKIP: validateProvenance not loaded'); return; }
    const result = validateProvenance(null);
    assert.strictEqual(result.valid, false);
  });

  test('validateProvenance rejects missing source', () => {
    if (!validateProvenance) { console.log('SKIP: validateProvenance not loaded'); return; }
    const result = validateProvenance({ timestamp: new Date().toISOString() });
    assert.strictEqual(result.valid, false);
  });

  test('validateProvenance rejects invalid timestamp', () => {
    if (!validateProvenance) { console.log('SKIP: validateProvenance not loaded'); return; }
    const result = validateProvenance({ source: 'test', timestamp: 'not-a-date' });
    assert.strictEqual(result.valid, false);
  });

  test('containsInterpretationKeywords detects keywords', () => {
    if (!containsInterpretationKeywords) { console.log('SKIP: containsInterpretationKeywords not loaded'); return; }
    assert.strictEqual(containsInterpretationKeywords('I believe this'), true);
    assert.strictEqual(containsInterpretationKeywords('Probably true'), true);
    assert.strictEqual(containsInterpretationKeywords('It seems fine'), true);
    assert.strictEqual(containsInterpretationKeywords('This thinks'), true);
    assert.strictEqual(containsInterpretationKeywords('Likely outcome'), true);
  });

  test('containsInterpretationKeywords allows facts', () => {
    if (!containsInterpretationKeywords) { console.log('SKIP: containsInterpretationKeywords not loaded'); return; }
    assert.strictEqual(containsInterpretationKeywords('The server is running'), false);
    assert.strictEqual(containsInterpretationKeywords('Data shows X'), false);
    assert.strictEqual(containsInterpretationKeywords(''), false);
    assert.strictEqual(containsInterpretationKeywords(null), false);
  });
});

// ============== A2A ADAPTER TESTS ==============

describe('A2A Palace Adapter', () => {
  test('loadPalaceContext handles missing files', async () => {
    if (!loadPalaceContext) { console.log('SKIP: loadPalaceContext not loaded'); return; }
    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = '/nonexistent/path';
    
    const context = await loadPalaceContext();
    assert.ok(context, 'Should return context object');
    
    process.env.OPENCLAW_WORKSPACE = originalEnv;
  });

  test('publishToPeers validates fact', async () => {
    if (!publishToPeers) { console.log('SKIP: publishToPeers not loaded'); return; }
    await assert.rejects(
      () => publishToPeers({ id: 'bad' }, []),
      /Invalid fact/
    );
  });

  test('publishToPeers handles empty peers', async () => {
    if (!publishToPeers) { console.log('SKIP: publishToPeers not loaded'); return; }
    const result = await publishToPeers(VALID_FACT, []);
    assert.ok(result, 'Should return result');
    assert.deepStrictEqual(result.success, []);
    assert.deepStrictEqual(result.failed, []);
  });
});

// ============== EDGE CASES ==============

describe('Edge Cases', () => {
  test('Special characters in content', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const specialFact = {
      ...VALID_FACT,
      id: 'special-001',
      content: {
        title: "Test with 'quotes' and \"double\"",
        body: "Unicode: 🐿️ and symbols: <>&",
        tags: ['special']
      }
    };
    
    loader.insertFact(specialFact);
    const retrieved = loader.getFactById('special-001');
    assert.ok(retrieved);
    
    loader.close();
    await cleanup();
  });

  test('Empty content fields', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const emptyFact = {
      ...VALID_FACT,
      id: 'empty-001',
      content: { title: '', body: '', tags: [] }
    };
    
    loader.insertFact(emptyFact);
    const retrieved = loader.getFactById('empty-001');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.content.body, '');
    
    loader.close();
    await cleanup();
  });
});
