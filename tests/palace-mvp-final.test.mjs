/**
 * Final Test Suite for mesh-memory Palace MVP (P1-P5)
 * Validated against actual implementation
 * 
 * Run: node --test tests/palace-mvp-final.test.mjs
 * Exit code 0 = all pass, non-zero = failures
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(__dirname, '.test-final');
const TEST_DB = path.join(TEST_DIR, 'test.db');
const TEST_PASSPORT = path.join(TEST_DIR, 'passport.json');

const SAMPLE_PASSPORT = {
  version: '1.0.0',
  agent: { id: 'test-agent', name: 'Test Agent' },
  capabilities: ['test'],
  hardware_profile: { host: 'localhost', local_inference: false },
  mesh_identity: { receiver_url: 'http://localhost:18803' }
};

// Setup helpers
async function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  await fs.writeFile(TEST_PASSPORT, JSON.stringify(SAMPLE_PASSPORT));
}

async function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

// ============== MODULE LOADING TESTS ==============

describe('Module Loading', () => {
  test('CriticalFactsLoader loads', async () => {
    const mod = await import('../critical-facts-loader.mjs');
    assert.ok(mod.CriticalFactsLoader, 'CriticalFactsLoader exported');
    assert.ok(typeof mod.createLoader === 'function', 'createLoader exported');
    assert.ok(typeof mod.quickLoad === 'function', 'quickLoad exported');
  });

  test('TunnelPublisher loads', async () => {
    const mod = await import('../tunnel-publisher.mjs');
    assert.ok(mod.TunnelPublisher, 'TunnelPublisher exported');
    assert.ok(typeof mod.validateFact === 'function', 'validateFact exported');
    assert.ok(typeof mod.validateProvenance === 'function', 'validateProvenance exported');
    assert.ok(typeof mod.containsInterpretationKeywords === 'function', 'containsInterpretationKeywords exported');
  });

  test('A2A Adapter loads', async () => {
    const mod = await import('../a2a-palace-adapter.mjs');
    assert.ok(typeof mod.loadPalaceContext === 'function', 'loadPalaceContext exported');
    assert.ok(typeof mod.publishToPeers === 'function', 'publishToPeers exported');
  });
});

// ============== CRITICAL FACTS LOADER ==============

describe('CriticalFactsLoader - Core Functionality', () => {
  let CFL, createLoader;

  test('Module exports', async () => {
    const mod = await import('../critical-facts-loader.mjs');
    CFL = mod.CriticalFactsLoader;
    createLoader = mod.createLoader;
    assert.ok(CFL);
  });

  test('Constructor with options', async () => {
    const loader = new CFL({ dbPath: '/test.db', verbose: true });
    assert.ok(loader);
    assert.strictEqual(loader.verbose, true);
  });

  test('Database initialization', async () => {
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    const result = await loader.init();
    assert.ok(result.success, 'Init should succeed');
    loader.close();
    await cleanup();
  });

  test('Insert valid fact', async () => {
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();

    const fact = {
      id: 'test-fact-001',
      tier: 'critical',
      category: 'projects',
      content: { title: 'Test', body: 'Content', tags: ['test'] },
      provenance: { source: 'test', timestamp: new Date().toISOString() },
      updated_at: new Date().toISOString()
    };

    const result = await loader.insertFact(fact);
    assert.ok(result.success, 'Insert should succeed');
    assert.strictEqual(result.data.id, fact.id);

    loader.close();
    await cleanup();
  });

  test('Retrieve fact by ID', async () => {
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();

    const fact = {
      id: 'retrieve-test',
      tier: 'critical',
      category: 'projects',
      content: { title: 'Retrieve Test', body: 'Body', tags: [] },
      provenance: { source: 'test', timestamp: new Date().toISOString() },
      updated_at: new Date().toISOString()
    };

    await loader.insertFact(fact);
    const retrieved = await loader.getFactById(fact.id);
    assert.ok(retrieved.success);
    assert.ok(retrieved.data);

    loader.close();
    await cleanup();
  });

  test('Get critical facts list', async () => {
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();

    const facts = await loader.getCriticalFacts();
    assert.ok(facts.success);
    assert.ok(Array.isArray(facts.data));

    loader.close();
    await cleanup();
  });

  test('Generate wake-up context', async () => {
    await setup();
    const loader = new CFL({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();

    const context = await loader.generateWakeUpContext();
    assert.ok(context.success);
    assert.ok(context.data.l0);
    assert.ok(context.data.l1);
    assert.ok(typeof context.data.tokenEstimate === 'number');

    loader.close();
    await cleanup();
  });

  test('createLoader factory function', async () => {
    await setup();
    const loader = await createLoader({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    assert.ok(loader);
    loader.close();
    await cleanup();
  });
});

// ============== TUNNEL PUBLISHER ==============

describe('TunnelPublisher - Validation', () => {
  let validateFact, validateProvenance, containsInterpretationKeywords;

  test('Module exports', async () => {
    const mod = await import('../tunnel-publisher.mjs');
    validateFact = mod.validateFact;
    validateProvenance = mod.validateProvenance;
    containsInterpretationKeywords = mod.containsInterpretationKeywords;
    assert.ok(validateFact);
    assert.ok(validateProvenance);
    assert.ok(containsInterpretationKeywords);
  });

  test('validateFact accepts valid fact', () => {
    const fact = {
      id: 'test',
      tier: 'critical',
      category: 'projects',
      content: { title: 'Test', body: 'Content' },
      provenance: { source: 'test', timestamp: new Date().toISOString() },
      updated_at: new Date().toISOString()
    };
    const result = validateFact(fact);
    assert.strictEqual(result.valid, true);
  });

  test('validateFact rejects missing fields', () => {
    const result = validateFact({ id: 'bad' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  test('validateProvenance accepts valid', () => {
    const result = validateProvenance({ source: 'test', timestamp: new Date().toISOString() });
    assert.strictEqual(result.valid, true);
  });

  test('validateProvenance rejects invalid', () => {
    assert.strictEqual(validateProvenance(null).valid, false);
    assert.strictEqual(validateProvenance({}).valid, false);
    assert.strictEqual(validateProvenance({ source: 'test' }).valid, false);
  });

  test('containsInterpretationKeywords detects belief words', () => {
    assert.strictEqual(containsInterpretationKeywords('believes'), true);
    assert.strictEqual(containsInterpretationKeywords('thinks'), true);
    assert.strictEqual(containsInterpretationKeywords('probably'), true);
    assert.strictEqual(containsInterpretationKeywords('likely'), true);
  });

  test('containsInterpretationKeywords allows facts', () => {
    assert.strictEqual(containsInterpretationKeywords('The server is running'), false);
    assert.strictEqual(containsInterpretationKeywords('Data shows X'), false);
  });
});

// ============== A2A ADAPTER ==============

describe('A2A Palace Adapter', () => {
  let loadPalaceContext, publishToPeers;

  test('Module exports', async () => {
    const mod = await import('../a2a-palace-adapter.mjs');
    loadPalaceContext = mod.loadPalaceContext;
    publishToPeers = mod.publishToPeers;
    assert.ok(loadPalaceContext);
    assert.ok(publishToPeers);
  });

  test('loadPalaceContext returns context', async () => {
    await setup();
    const result = await loadPalaceContext();
    assert.ok(result);
    await cleanup();
  });

  test('publishToPeers with empty peers', async () => {
    const fact = {
      id: 'test',
      tier: 'critical',
      category: 'projects',
      content: { title: 'Test', body: 'Body' },
      provenance: { source: 'test', timestamp: new Date().toISOString() },
      updated_at: new Date().toISOString()
    };

    const result = await publishToPeers(fact, []);
    assert.ok(result);
  });
});

// ============== EDGE CASES ==============

describe('Edge Cases', () => {
  test('Special characters handling', async () => {
    const { CriticalFactsLoader } = await import('../critical-facts-loader.mjs');
    await setup();
    const loader = new CriticalFactsLoader({ dbPath: TEST_DB, passportPath: TEST_PASSPORT });
    await loader.init();

    const fact = {
      id: 'special-001',
      tier: 'critical',
      category: 'events',
      content: {
        title: "Title with 'quotes'",
        body: "Body with 🐿️ emoji and <html>",
        tags: ['special']
      },
      provenance: { source: 'test', timestamp: new Date().toISOString() },
      updated_at: new Date().toISOString()
    };

    const result = await loader.insertFact(fact);
    assert.ok(result.success);

    loader.close();
    await cleanup();
  });
});
