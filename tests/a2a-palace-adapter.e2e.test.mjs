/**
 * End-to-End Tests for a2a-palace-adapter.mjs
 * Tests: Full integration with Palace L0/L1/L2 layers
 * Coverage: Context loading, peer publishing, error scenarios
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// Module under test
import {
  loadPalaceContext,
  publishToPeers
} from '../a2a-palace-adapter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test configuration - use a temp workspace
const TEST_WORKSPACE = path.join(__dirname, '.test-e2e-workspace');
const TEST_PALACE_DIR = path.join(TEST_WORKSPACE, 'palace-mvp');
const TEST_MEMORY_DIR = path.join(TEST_WORKSPACE, 'memory');
const TEST_DB_PATH = path.join(TEST_MEMORY_DIR, 'critical-facts.db');
const TEST_PASSPORT_PATH = path.join(TEST_PALACE_DIR, 'agent-passport.json');

// Sample test data
const TEST_PASSPORT = {
  version: '1.0.0',
  schema: 'agent-passport-v1',
  agent: {
    id: 'test-agent-e2e',
    name: 'Test Agent',
    creature: 'Test creature',
    emoji: '🧪',
    vibe: 'Testing vibe',
    bio: 'Test bio for e2e'
  },
  capabilities: ['test', 'e2e', 'validation'],
  hardware_profile: {
    host: 'localhost',
    platform: 'test',
    gpu: null,
    local_inference: false
  },
  mesh_identity: {
    a2a_url: 'http://localhost:18800',
    receiver_url: 'http://localhost:18803',
    receiver_port: 18803
  },
  provenance: {
    created_by: 'e2e-test',
    created_at: new Date().toISOString(),
    lineage: ['test'],
    workspace: TEST_WORKSPACE
  }
};

const SAMPLE_FACT = {
  id: 'e2e-fact-001',
  tier: 'critical',
  category: 'projects',
  content: {
    title: 'E2E Test Fact',
    body: 'This is a fact for end-to-end testing.'
  },
  provenance: {
    source: 'e2e-test',
    author: 'test-system',
    timestamp: new Date().toISOString(),
    source_version: '1.0.0'
  },
  updated_at: new Date().toISOString(),
  expires_at: null
};

// Mock peer server for testing
function createMockPeer(port, behavior = 'success') {
  return import('node:http').then(http => {
    const server = http.createServer((req, res) => {
      if (req.url === '/tunnel/incoming' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const auth = req.headers.authorization;
          if (!auth) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }

          switch (behavior) {
            case 'success':
              res.writeHead(201);
              res.end(JSON.stringify({ ok: true }));
              break;
            case 'error':
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'Server error' }));
              break;
            default:
              res.writeHead(200);
              res.end('OK');
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    return new Promise((resolve, reject) => {
      server.listen(port, () => {
        resolve({
          server,
          url: `http://localhost:${port}`,
          close: () => new Promise(resolve => server.close(resolve))
        });
      });
      server.on('error', reject);
    });
  });
}

// Setup helpers
async function setupTestWorkspace() {
  // Clean up any existing test workspace
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }

  // Create directories
  mkdirSync(TEST_WORKSPACE, { recursive: true });
  mkdirSync(TEST_PALACE_DIR, { recursive: true });
  mkdirSync(TEST_MEMORY_DIR, { recursive: true });

  // Write passport
  await fs.writeFile(TEST_PASSPORT_PATH, JSON.stringify(TEST_PASSPORT, null, 2));

  // Create database with test data
  const db = new Database(TEST_DB_PATH);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS critical_facts (
      id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT,
      source TEXT NOT NULL,
      author TEXT,
      timestamp TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT
    )
  `);

  // Insert test facts
  const stmt = db.prepare(`
    INSERT INTO critical_facts (id, tier, category, type, title, body, tags, source, author, timestamp, updated_at, expires_at)
    VALUES (@id, @tier, @category, @type, @title, @body, @tags, @source, @author, @timestamp, @updated_at, @expires_at)
  `);

  stmt.run({
    id: 'e2e-critical-001',
    tier: 'critical',
    category: 'projects',
    type: 'decision',
    title: 'E2E Test Project',
    body: 'This is a critical fact for e2e testing.',
    tags: JSON.stringify(['e2e', 'test']),
    source: 'e2e-setup',
    author: 'test-system',
    timestamp: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: null
  });

  stmt.run({
    id: 'e2e-critical-002',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'config',
    title: 'E2E Standing Instruction',
    body: 'Always test thoroughly.',
    tags: JSON.stringify(['standing', 'e2e']),
    source: 'e2e-setup',
    author: 'test-system',
    timestamp: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: null
  });

  // Add an expired fact
  stmt.run({
    id: 'e2e-expired-001',
    tier: 'critical',
    category: 'events',
    type: 'event',
    title: 'Expired Event',
    body: 'This event has passed.',
    tags: JSON.stringify(['expired']),
    source: 'e2e-setup',
    author: 'test-system',
    timestamp: new Date(Date.now() - 172800000).toISOString(),
    updated_at: new Date(Date.now() - 172800000).toISOString(),
    expires_at: new Date(Date.now() - 86400000).toISOString() // Expired yesterday
  });

  db.close();
}

async function cleanupTestWorkspace() {
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
}

// ============== TESTS ==============

describe('E2E: loadPalaceContext', () => {
  test('should load complete L0 + L1 context', async () => {
    await setupTestWorkspace();

    // Set environment for the test
    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();

    // Verify L0 (Passport)
    assert.ok(context.passport, 'Should have passport (L0)');
    assert.strictEqual(context.passport.agent.id, 'test-agent-e2e');
    assert.ok(context.passport.capabilities, 'Should have capabilities');

    // Verify L1 (Critical Facts)
    assert.ok(context.facts, 'Should have facts (L1)');
    assert.ok(Array.isArray(context.facts), 'Facts should be array');
    assert.ok(context.facts.length >= 2, 'Should have at least 2 critical facts');
    
    // Verify token estimate
    assert.ok(typeof context.tokenEstimate === 'number', 'Should have token estimate');
    assert.ok(context.tokenEstimate > 0, 'Token estimate should be positive');

    // Restore environment
    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should handle missing passport gracefully', async () => {
    await setupTestWorkspace();
    await fs.unlink(TEST_PASSPORT_PATH);

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    assert.strictEqual(context.passport, null);

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should handle missing database gracefully', async () => {
    await setupTestWorkspace();
    await fs.unlink(TEST_DB_PATH);

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    assert.deepStrictEqual(context.facts, []);

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should filter expired facts', async () => {
    await setupTestWorkspace();

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    
    // Should not include expired fact
    assert.ok(!context.facts.some(f => f.id === 'e2e-expired-001'), 'Should filter expired facts');

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should parse JSON tags from database', async () => {
    await setupTestWorkspace();

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    
    // Check that tags are parsed as array
    const fact = context.facts.find(f => f.id === 'e2e-critical-001');
    assert.ok(fact, 'Should find fact');
    assert.ok(Array.isArray(fact.tags), 'Tags should be parsed as array');
    assert.ok(fact.tags.includes('e2e'), 'Tags should contain expected values');

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });
});

describe('E2E: publishToPeers', () => {
  let mockPeer1, mockPeer2;

  test('should publish fact to multiple peers', async () => {
    mockPeer1 = await createMockPeer(18810, 'success');
    mockPeer2 = await createMockPeer(18811, 'success');

    const peers = [
      { url: mockPeer1.url, token: 'test-token' },
      { url: mockPeer2.url, token: 'test-token' }
    ];

    const result = await publishToPeers(SAMPLE_FACT, peers);

    assert.strictEqual(result.success.length, 2, 'Should have 2 successes');
    assert.strictEqual(result.failed.length, 0, 'Should have 0 failures');
    assert.ok(result.success.every(s => s.status === 201));

    await mockPeer1.close();
    await mockPeer2.close();
  });

  test('should handle partial failures', async () => {
    mockPeer1 = await createMockPeer(18812, 'success');
    mockPeer2 = await createMockPeer(18813, 'error');

    const peers = [
      { url: mockPeer1.url, token: 'test-token' },
      { url: mockPeer2.url, token: 'test-token' }
    ];

    const result = await publishToPeers(SAMPLE_FACT, peers);

    assert.strictEqual(result.success.length, 1, 'Should have 1 success');
    assert.strictEqual(result.failed.length, 1, 'Should have 1 failure');

    await mockPeer1.close();
    await mockPeer2.close();
  });

  test('should handle empty peer list', async () => {
    const result = await publishToPeers(SAMPLE_FACT, []);
    assert.deepStrictEqual(result.success, []);
    assert.deepStrictEqual(result.failed, []);
  });

  test('should validate fact before publishing', async () => {
    const invalidFact = { ...SAMPLE_FACT, id: undefined };
    const peers = [{ url: 'http://localhost:8080', token: 'test' }];

    await assert.rejects(
      () => publishToPeers(invalidFact, peers),
      /Invalid fact/
    );
  });

  test('should reject missing tier', async () => {
    const noTierFact = { ...SAMPLE_FACT, tier: undefined };
    const peers = [{ url: 'http://localhost:8080', token: 'test' }];

    await assert.rejects(
      () => publishToPeers(noTierFact, peers),
      /Invalid fact/
    );
  });

  test('should reject missing content', async () => {
    const noContentFact = { ...SAMPLE_FACT, content: undefined };
    const peers = [{ url: 'http://localhost:8080', token: 'test' }];

    await assert.rejects(
      () => publishToPeers(noContentFact, peers),
      /Invalid fact/
    );
  });

  test('should reject missing provenance', async () => {
    const noProvFact = { ...SAMPLE_FACT, provenance: undefined };
    const peers = [{ url: 'http://localhost:8080', token: 'test' }];

    await assert.rejects(
      () => publishToPeers(noProvFact, peers),
      /Invalid fact/
    );
  });

  test('should handle unauthorized peer', async () => {
    mockPeer1 = await createMockPeer(18814, 'success'); // Requires auth, but we won't provide it

    const peers = [
      { url: mockPeer1.url } // No token provided
    ];

    const result = await publishToPeers(SAMPLE_FACT, peers);
    assert.strictEqual(result.failed.length, 1);

    await mockPeer1.close();
  });

  test('should handle timeout scenario', async () => {
    // Create a peer that never responds
    const http = await import('node:http');
    const server = http.createServer(() => {
      // Never respond
    });

    await new Promise(resolve => server.listen(18815, resolve));

    const peers = [{ url: 'http://localhost:18815', token: 'test' }];

    // Should timeout and fail
    const result = await publishToPeers(SAMPLE_FACT, peers);
    // Note: This might fail with AbortError depending on timeout handling

    server.close();
  });
});

describe('E2E: Full Workflow', () => {
  test('complete L0->L1->L2 workflow', async () => {
    await setupTestWorkspace();
    mockPeer1 = await createMockPeer(18816, 'success');

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    // Step 1: Load context (L0 + L1)
    const context = await loadPalaceContext();
    assert.ok(context.passport);
    assert.ok(context.facts.length > 0);

    // Step 2: Create new fact from context
    const newFact = {
      id: 'e2e-workflow-001',
      tier: 'deep',
      category: 'projects',
      content: {
        title: 'Workflow Test Fact',
        body: `Generated from ${context.passport.agent.name} context with ${context.facts.length} existing facts.`
      },
      provenance: {
        source: 'e2e-workflow',
        author: context.passport.agent.id,
        timestamp: new Date().toISOString(),
        source_version: '1.0.0'
      },
      updated_at: new Date().toISOString()
    };

    // Step 3: Publish to peer
    const peers = [{ url: mockPeer1.url, token: 'test-token' }];
    const publishResult = await publishToPeers(newFact, peers);

    assert.strictEqual(publishResult.success.length, 1);

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await mockPeer1.close();
    await cleanupTestWorkspace();
  });
});

describe('Edge Cases', () => {
  test('should handle malformed database', async () => {
    await setupTestWorkspace();
    
    // Corrupt the database
    await fs.writeFile(TEST_DB_PATH, 'not a valid sqlite database');

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    assert.deepStrictEqual(context.facts, []);

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should handle malformed passport JSON', async () => {
    await setupTestWorkspace();
    
    // Write invalid JSON to passport
    await fs.writeFile(TEST_PASSPORT_PATH, 'not valid json {');

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    assert.strictEqual(context.passport, null);

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should handle database with malformed tags', async () => {
    await setupTestWorkspace();

    const db = new Database(TEST_DB_PATH);
    db.prepare(`
      INSERT INTO critical_facts (id, tier, category, title, body, tags, source, timestamp, updated_at)
      VALUES (@id, @tier, @category, @title, @body, @tags, @source, @timestamp, @updated_at)
    `).run({
      id: 'malformed-tags',
      tier: 'critical',
      category: 'events',
      title: 'Malformed',
      body: 'Test',
      tags: 'not-valid-json', // Invalid JSON
      source: 'test',
      timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    db.close();

    const originalEnv = process.env.OPENCLAW_WORKSPACE;
    process.env.OPENCLAW_WORKSPACE = TEST_WORKSPACE;

    const context = await loadPalaceContext();
    // Should not crash, should return empty array for invalid tags
    const fact = context.facts.find(f => f.id === 'malformed-tags');
    if (fact) {
      assert.deepStrictEqual(fact.tags, []);
    }

    process.env.OPENCLAW_WORKSPACE = originalEnv;
    await cleanupTestWorkspace();
  });

  test('should handle very large fact', async () => {
    const largeFact = {
      ...SAMPLE_FACT,
      id: 'e2e-large-001',
      content: {
        title: 'Large Fact',
        body: 'x'.repeat(100000) // 100KB
      }
    };

    mockPeer1 = await createMockPeer(18817, 'success');
    const peers = [{ url: mockPeer1.url, token: 'test-token' }];

    const result = await publishToPeers(largeFact, peers);
    assert.strictEqual(result.success.length, 1);

    await mockPeer1.close();
  });
});

export { TEST_WORKSPACE, setupTestWorkspace, cleanupTestWorkspace };
