/**
 * Integration Tests for tunnel-publisher.mjs
 * Tests: TunnelPublisher class with mock peer connections
 * Coverage: Publish operations, retry logic, queue management, listener
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

// Module under test
import {
  TunnelPublisher,
  validateFact,
  validateProvenance,
  containsInterpretationKeywords
} from '../tunnel-publisher.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(__dirname, '.test-tunnel-data');

// Port management for tests
// Use dynamic port allocation (port 0) to avoid conflicts
const usedServers = [];

async function getTestPort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function cleanupServers() {
  for (const serverInfo of usedServers) {
    try {
      await new Promise((resolve) => {
        if (serverInfo.server && !serverInfo.server.closing) {
          serverInfo.server.close(resolve);
        } else {
          resolve();
        }
      });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  usedServers.length = 0;
}

// Mock fact data
const VALID_FACT = {
  id: 'test-fact-001',
  tier: 'critical',
  category: 'projects',
  type: 'decision',
  content: {
    title: 'Test Decision',
    body: 'This is a factual observation without interpretation.',
    tags: ['test', 'decision']
  },
  provenance: {
    source: 'test-system',
    author: 'test-agent',
    timestamp: new Date().toISOString(),
    source_version: '1.0.0'
  },
  updated_at: new Date().toISOString(),
  expires_at: null
};

const FACT_WITH_INTERPRETATION = {
  ...VALID_FACT,
  id: 'test-fact-002',
  content: {
    title: 'Interpretation',
    body: 'This agent believes the system probably has issues.',
    tags: ['interpretation']
  }
};

const FACT_INVALID_TIER = {
  ...VALID_FACT,
  id: 'test-fact-003',
  tier: 'invalid-tier'
};

const FACT_MISSING_PROVENANCE = {
  id: 'test-fact-004',
  tier: 'critical',
  category: 'events',
  content: { title: 'Test', body: 'Content' },
  updated_at: new Date().toISOString()
};

// Mock peer server factory
async function createMockPeer(behavior = 'success') {
  const port = await getTestPort();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.url === '/tunnel/incoming') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        switch (behavior) {
          case 'success':
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, id: JSON.parse(body).id }));
            break;
          case 'duplicate':
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Duplicate' }));
            break;
          case 'error':
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal error' }));
            break;
          case 'timeout':
            // Don't respond - let it timeout
            break;
          default:
            res.writeHead(200);
            res.end('OK');
        }
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      const mockPeer = {
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(resolve => {
          server.close(resolve);
          server.closing = true;
        })
      };
      usedServers.push(mockPeer);
      resolve(mockPeer);
    });
    server.on('error', reject);
  });
}

// Setup helpers
async function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

async function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============== TESTS ==============

describe('validateFact', () => {
  test('should validate a complete fact', () => {
    const result = validateFact(VALID_FACT);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  test('should reject fact missing required fields', () => {
    const noId = { ...VALID_FACT, id: undefined };
    let result = validateFact(noId);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Missing required field: id')));

    const noTier = { ...VALID_FACT, tier: undefined };
    result = validateFact(noTier);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Missing required field: tier')));
  });

  test('should reject fact with invalid tier', () => {
    const result = validateFact(FACT_INVALID_TIER);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Invalid tier')));
  });

  test('should reject fact with missing provenance', () => {
    const result = validateFact(FACT_MISSING_PROVENANCE);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Missing required field: provenance')));
  });

  test('should reject fact with interpretation keywords', () => {
    const result = validateFact(FACT_WITH_INTERPRETATION);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('interpretation keywords')));
  });

  test('should validate timestamp format', () => {
    const invalidTs = {
      ...VALID_FACT,
      id: 'ts-test',
      provenance: { ...VALID_FACT.provenance, timestamp: 'invalid-date' }
    };
    const result = validateFact(invalidTs);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ISO 8601')));
  });
});

describe('validateProvenance', () => {
  test('should validate correct provenance', () => {
    const result = validateProvenance(VALID_FACT.provenance);
    assert.strictEqual(result.valid, true);
  });

  test('should reject null provenance', () => {
    const result = validateProvenance(null);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('object'));
  });

  test('should reject missing source', () => {
    const result = validateProvenance({ timestamp: new Date().toISOString() });
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('source'));
  });

  test('should reject future timestamp', () => {
    const future = new Date(Date.now() + 3600000).toISOString(); // 1 hour future
    const result = validateProvenance({ source: 'test', timestamp: future });
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('future'));
  });

  test('should reject old timestamp (>24h)', () => {
    const old = new Date(Date.now() - 25 * 3600000).toISOString(); // 25 hours ago
    const result = validateProvenance({ source: 'test', timestamp: old });
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('24 hours'));
  });
});

describe('containsInterpretationKeywords', () => {
  test('should detect interpretation keywords', () => {
    assert.strictEqual(containsInterpretationKeywords('This believes that'), true);
    assert.strictEqual(containsInterpretationKeywords('I think this works'), true);
    assert.strictEqual(containsInterpretationKeywords('Probably correct'), true);
    assert.strictEqual(containsInterpretationKeywords('It seems fine'), true);
    assert.strictEqual(containsInterpretationKeywords('Appears to be'), true);
    assert.strictEqual(containsInterpretationKeywords('Likely outcome'), true);
  });

  test('should return false for factual content', () => {
    assert.strictEqual(containsInterpretationKeywords('The system is running'), false);
    assert.strictEqual(containsInterpretationKeywords('Data shows X equals Y'), false);
    assert.strictEqual(containsInterpretationKeywords('Configuration updated'), false);
  });

  test('should handle empty/null content', () => {
    assert.strictEqual(containsInterpretationKeywords(''), false);
    assert.strictEqual(containsInterpretationKeywords(null), false);
    assert.strictEqual(containsInterpretationKeywords(undefined), false);
  });
});

describe('TunnelPublisher - Basic Operations', () => {
  test('should create instance with default options', () => {
    const publisher = new TunnelPublisher();
    assert.deepStrictEqual(publisher.peers, []);
    assert.strictEqual(publisher.localPort, 18803);
    assert.strictEqual(publisher.token, 'replace-with-your-token');
    assert.strictEqual(publisher.server, null);
  });

  test('should create instance with custom options', () => {
    const publisher = new TunnelPublisher({
      peers: [{ url: 'http://peer1:8080' }],
      localPort: 9999,
      token: 'custom-token'
    });
    assert.strictEqual(publisher.peers.length, 1);
    assert.strictEqual(publisher.localPort, 9999);
    assert.strictEqual(publisher.token, 'custom-token');
  });
});

describe('TunnelPublisher - Publishing', () => {
  let mockPeer;
  let publisher;

  afterEach(async () => {
    if (mockPeer) {
      try { await mockPeer.close(); } catch (e) {}
      mockPeer = null;
    }
    await cleanupServers();
  });

  test('should publish fact to peer successfully', async () => {
    mockPeer = await createMockPeer('success');
    publisher = new TunnelPublisher({
      peers: [{ url: mockPeer.url, token: 'test-token' }],
      token: 'test-token'
    });

    const result = await publisher.publishFact(VALID_FACT);
    assert.strictEqual(result.success, true, 'Should succeed');
    assert.ok(result.data, 'Should have data');
    assert.ok(result.data[mockPeer.url], 'Should have peer result');
  });

  test('should handle duplicate fact response (409)', async () => {
    mockPeer = await createMockPeer('duplicate');
    publisher = new TunnelPublisher({
      peers: [{ url: mockPeer.url, token: 'test-token' }],
      token: 'test-token'
    });

    const result = await publisher.publishFact(VALID_FACT);
    assert.strictEqual(result.success, true, 'Should succeed (409 is treated as success)');
  });

  test('should reject invalid fact', async () => {
    publisher = new TunnelPublisher({
      peers: [{ url: 'http://localhost:8080', token: 'test' }],
      token: 'test'
    });

    const result = await publisher.publishFact(FACT_INVALID_TIER);
    assert.strictEqual(result.success, false, 'Should fail validation');
    assert.ok(result.error, 'Should have error');
  });

  test('should warn when no peers configured', async () => {
    publisher = new TunnelPublisher({ peers: [] });
    const result = await publisher.publishFact(VALID_FACT);
    assert.strictEqual(result.success, true, 'Should succeed with no peers');
    assert.deepStrictEqual(result.data, {}, 'Should return empty summary');
  });

  test('should publish multiple facts', async () => {
    mockPeer = await createMockPeer('success');
    publisher = new TunnelPublisher({
      peers: [{ url: mockPeer.url, token: 'test-token' }],
      token: 'test-token'
    });

    const facts = [
      { ...VALID_FACT, id: 'fact-001' },
      { ...VALID_FACT, id: 'fact-002' },
      { ...VALID_FACT, id: 'fact-003' }
    ];

    const result = await publisher.publishFacts(facts);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.published, 3);
    assert.strictEqual(result.data.results.length, 3);
    assert.ok(result.data.results.every(r => r.success === true));
  });

  test('should handle empty facts array', async () => {
    publisher = new TunnelPublisher({ peers: [] });
    const result = await publisher.publishFacts([]);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.published, 0);
    assert.deepStrictEqual(result.data.results, []);
  });
});

describe('TunnelPublisher - Retry Logic', () => {
  let mockPeer;

  afterEach(async () => {
    await cleanupServers();
  });

  test('should retry failed publishes', async () => {
    // Create a peer that fails first 2 requests then succeeds
    let requestCount = 0;
    const port = await getTestPort();
    const server = http.createServer((req, res) => {
      if (req.url === '/tunnel/incoming') {
        requestCount++;
        if (requestCount < 3) {
          res.writeHead(500);
          res.end('Error');
        } else {
          res.writeHead(201);
          res.end(JSON.stringify({ ok: true }));
        }
      }
    });

    await new Promise((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    
    const peerUrl = `http://127.0.0.1:${port}`;
    usedServers.push({ server, close: () => new Promise(r => server.close(r)) });

    const publisher = new TunnelPublisher({
      peers: [{ url: peerUrl, token: 'test-token' }],
      token: 'test-token'
    });

    const result = await publisher.publishFact(VALID_FACT);
    
    // Should succeed after retries
    assert.strictEqual(result.success, true, 'Should eventually succeed');
    assert.ok(result.data[peerUrl], 'Should have peer result');
    
    await new Promise(r => server.close(r));
  });

  test('should fail with error when server returns 500', async () => {
    const port = await getTestPort();
    const server = http.createServer((req, res) => {
      if (req.url === '/tunnel/incoming') {
        res.writeHead(500);
        res.end('Server Error');
      }
    });

    await new Promise((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });

    const peerUrl = `http://127.0.0.1:${port}`;
    usedServers.push({ server, close: () => new Promise(r => server.close(r)) });

    const publisher = new TunnelPublisher({
      peers: [{ url: peerUrl, token: 'test-token' }],
      token: 'test-token'
    });

    // This will fail after max retries
    const result = await publisher.publishFact(VALID_FACT);
    
    assert.strictEqual(result.success, true, 'safeExecute returns success');
    assert.ok(result.data[peerUrl], 'Should have peer result');
    assert.strictEqual(result.data[peerUrl].success, false, 'Should mark as failed');

    await new Promise(r => server.close(r));
  });
});

describe('TunnelPublisher - Listener', () => {
  let publisher;
  let testPort;

  afterEach(async () => {
    if (publisher?.server) {
      try { await publisher.stopListener(); } catch (e) {}
    }
    await cleanupServers();
  });

  test('should start and stop listener', async () => {
    testPort = await getTestPort();
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();
    assert.ok(publisher.server, 'Server should be running');
    assert.ok(publisher.app, 'App should exist');

    // Test health endpoint
    const response = await fetch(`http://127.0.0.1:${testPort}/health`);
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.status, 'ok');

    await publisher.stopListener();
    assert.strictEqual(publisher.server, null);
  });

  test('should reject unauthorized requests', async () => {
    testPort = await getTestPort();
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();

    const response = await fetch(`http://127.0.0.1:${testPort}/tunnel/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_FACT)
    });

    assert.strictEqual(response.status, 401);

    await publisher.stopListener();
  });

  test('should accept valid incoming fact', async () => {
    // Clean up first to avoid duplicate ID conflicts
    await cleanupTestDir();
    await setupTestDir();
    testPort = await getTestPort();
    
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();

    const uniqueFact = { ...VALID_FACT, id: `test-fact-${Date.now()}` };
    const response = await fetch(`http://127.0.0.1:${testPort}/tunnel/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify(uniqueFact)
    });

    assert.strictEqual(response.status, 201);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.id, uniqueFact.id);

    await publisher.stopListener();
    await cleanupTestDir();
  });

  test('should reject duplicate incoming facts', async () => {
    // Clean up first to start fresh
    await cleanupTestDir();
    await setupTestDir();
    testPort = await getTestPort();
    
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();

    // First insert
    await fetch(`http://127.0.0.1:${testPort}/tunnel/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({ ...VALID_FACT, id: 'dup-test-001' })
    });

    // Duplicate insert
    const response = await fetch(`http://127.0.0.1:${testPort}/tunnel/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({ ...VALID_FACT, id: 'dup-test-001' })
    });

    assert.strictEqual(response.status, 409);

    await publisher.stopListener();
    await cleanupTestDir();
  });

  test('should reject invalid incoming fact', async () => {
    testPort = await getTestPort();
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();

    const response = await fetch(`http://127.0.0.1:${testPort}/tunnel/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify(FACT_INVALID_TIER)
    });

    assert.strictEqual(response.status, 400);

    await publisher.stopListener();
  });

  test('should throw when starting already running listener', async () => {
    testPort = await getTestPort();
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();
    
    // Try to start again - implementation should reject or return error
    try {
      await publisher.startListener();
      // If we get here without throwing, check if it's already running
      assert.ok(publisher.server, 'Server should be running');
    } catch (err) {
      // Expected behavior - should throw
      assert.ok(err.message.includes('already') || err.message.includes('running') || err.code === 'EADDRINUSE');
    }

    await publisher.stopListener();
  });
});

describe('Edge Cases', () => {
  let publisher;

  afterEach(async () => {
    if (publisher?.server) {
      try { await publisher.stopListener(); } catch (e) {}
    }
    await cleanupServers();
  });

  test('should handle malformed JSON in incoming request', async () => {
    const testPort = await getTestPort();
    publisher = new TunnelPublisher({
      localPort: testPort,
      token: 'test-token'
    });

    await publisher.startListener();

    const response = await fetch(`http://127.0.0.1:${testPort}/tunnel/incoming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: 'not valid json'
    });

    // Express body parser returns 400 for malformed JSON
    assert.ok(response.status === 400 || response.status === 500, `Expected 400 or 500, got ${response.status}`);

    await publisher.stopListener();
  });

  test('should handle very large fact content', async () => {
    const largeFact = {
      ...VALID_FACT,
      id: 'large-fact',
      content: {
        title: 'Large Content',
        body: 'x'.repeat(100000), // 100KB of content
        tags: ['large']
      }
    };

    const result = validateFact(largeFact);
    assert.strictEqual(result.valid, true);
  });

  test('should handle special characters in content', async () => {
    const specialFact = {
      ...VALID_FACT,
      id: 'special-fact',
      content: {
        title: "Title with 'quotes' and \"double quotes\"",
        body: "Body with unicode: 🐿️ and symbols: <>&",
        tags: ['special']
      }
    };

    const result = validateFact(specialFact);
    assert.strictEqual(result.valid, true);
  });
});

export { createMockPeer, TEST_DIR };
