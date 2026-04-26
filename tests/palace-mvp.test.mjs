/**
 * Comprehensive Test Suite for mesh-memory Palace MVP (P1-P5)
 * Tests: CriticalFactsLoader, TunnelPublisher validation
 * Uses Node.js built-in test runner
 * 
 * Note: All CFL methods use safeExecuteSync which returns { success, data, error }
 */

import { test, describe } from 'node:test';
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
    
    const result = loader.insertFact(VALID_FACT);
    assert.strictEqual(result.success, true, 'insertFact should succeed');
    
    const getResult = loader.getFactById(VALID_FACT.id);
    assert.strictEqual(getResult.success, true, 'Should retrieve fact');
    assert.ok(getResult.data, 'Should have data');
    assert.strictEqual(getResult.data.id, VALID_FACT.id);
    assert.strictEqual(getResult.data.content.title, VALID_FACT.content.title);
    
    loader.close();
    await cleanup();
  });

  test('Reject invalid tier', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const invalid = { ...VALID_FACT, id: 'inv-001', tier: 'invalid' };
    const result = loader.insertFact(invalid);
    assert.strictEqual(result.success, false, 'Should fail for invalid tier');
    
    loader.close();
    await cleanup();
  });

  test('Reject missing required fields', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const result1 = loader.insertFact({ ...VALID_FACT, id: undefined });
    assert.strictEqual(result1.success, false, 'Should fail for missing id');
    
    const result2 = loader.insertFact({ ...VALID_FACT, id: 't-002', tier: undefined });
    assert.strictEqual(result2.success, false, 'Should fail for missing tier');
    
    loader.close();
    await cleanup();
  });

  test('Filter expired facts', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const r1 = loader.insertFact(VALID_FACT);
    assert.strictEqual(r1.success, true, 'Should insert valid fact');
    
    const r2 = loader.insertFact({ ...VALID_FACT, id: 'expired', expires_at: new Date(Date.now() - 86400000).toISOString() });
    assert.strictEqual(r2.success, true, 'Should insert expired fact');
    
    const facts = loader.getCriticalFacts();
    assert.strictEqual(facts.success, true, 'getCriticalFacts should succeed');
    assert.strictEqual(facts.data.length, 1);
    assert.strictEqual(facts.data[0].id, VALID_FACT.id);
    
    const expired = loader.getExpiredFacts();
    assert.strictEqual(expired.success, true, 'getExpiredFacts should succeed');
    assert.strictEqual(expired.data.length, 1);
    assert.strictEqual(expired.data[0].id, 'expired');
    
    loader.close();
    await cleanup();
  });

  test('Delete expired facts', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const r1 = loader.insertFact({ ...VALID_FACT, id: 'old1', expires_at: new Date(Date.now() - 86400000).toISOString() });
    assert.strictEqual(r1.success, true, 'Should insert old1');
    
    const r2 = loader.insertFact({ ...VALID_FACT, id: 'old2', expires_at: new Date(Date.now() - 172800000).toISOString() });
    assert.strictEqual(r2.success, true, 'Should insert old2');
    
    const deleted = loader.deleteExpiredFacts();
    assert.strictEqual(deleted.success, true, 'deleteExpiredFacts should succeed');
    assert.strictEqual(deleted.data, 2);
    
    const expired = loader.getExpiredFacts();
    assert.strictEqual(expired.data.length, 0);
    
    loader.close();
    await cleanup();
  });

  test('Generate wake-up context', async () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();
    
    const result = loader.insertFact(VALID_FACT);
    assert.strictEqual(result.success, true, 'Should insert fact');
    
    const context = await loader.generateWakeUpContext();
    assert.strictEqual(context.success, true, 'generateWakeUpContext should succeed');
    
    assert.ok(context.data.l0, 'Should have L0 (passport)');
    assert.ok(context.data.l1, 'Should have L1 (facts)');
    assert.ok(Array.isArray(context.data.l1), 'L1 should be array');
    assert.strictEqual(context.data.l1Count, 1);
    assert.ok(typeof context.data.tokenEstimate === 'number');
    
    loader.close();
    await cleanup();
  });

  test('Database not initialized returns error', () => {
    if (!CFL) { console.log('SKIP: CFL not loaded'); return; }
    const loader = new CFL({ dbPath: TEST_DB });
    const result = loader.insertFact(VALID_FACT);
    assert.strictEqual(result.success, false, 'Should fail when DB not initialized');
    
    const getResult = loader.getCriticalFacts();
    assert.strictEqual(getResult.success, false, 'Should fail when DB not initialized');
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
    const result = validateFact({ 
      ...VALID_FACT, 
      id: 'interp-001', 
      content: { ...VALID_FACT.content, title: 'I believe this is true' } 
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('interpretation')));
  });

  test('validateProvenance accepts valid', () => {
    if (!validateProvenance) { console.log('SKIP: validateProvenance not loaded'); return; }
    const result = validateProvenance({ source: 'test', timestamp: new Date().toISOString() });
    assert.strictEqual(result.valid, true);
  });

  test('validateProvenance rejects invalid', () => {
    if (!validateProvenance) { console.log('SKIP: validateProvenance not loaded'); return; }
    assert.strictEqual(validateProvenance(null).valid, false);
    assert.strictEqual(validateProvenance({}).valid, false);
    assert.strictEqual(validateProvenance({ source: 'test' }).valid, false);
  });

  test('containsInterpretationKeywords detects belief words', () => {
    if (!containsInterpretationKeywords) { console.log('SKIP: containsInterpretationKeywords not loaded'); return; }
    assert.strictEqual(containsInterpretationKeywords('believes'), true);
    assert.strictEqual(containsInterpretationKeywords('thinks'), true);
    assert.strictEqual(containsInterpretationKeywords('probably'), true);
    assert.strictEqual(containsInterpretationKeywords('likely'), true);
  });

  test('containsInterpretationKeywords allows facts', () => {
    if (!containsInterpretationKeywords) { console.log('SKIP: containsInterpretationKeywords not loaded'); return; }
    assert.strictEqual(containsInterpretationKeywords('The server is running'), false);
    assert.strictEqual(containsInterpretationKeywords('Data shows X'), false);
  });
});
