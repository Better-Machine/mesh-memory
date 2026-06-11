#!/usr/bin/env node
/**
 * mesh-memory v2 — Single daemon for cross-agent shared memory
 * 
 * Replaces: palace-daemon + memory-receiver + memory-bridge + memory-watcher + tunnel-publisher + token-service
 * One process, one port (18805), no auth (Tailscale LAN only)
 * 
 * @version 2.0.0
 */

import http from 'node:http';
import { URL } from 'node:url';
import { watch as fsWatch } from 'node:fs';
import Database from 'better-sqlite3';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile, stat, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// ─── Configuration ──────────────────────────────────────────────────────────

const WORKSPACE = resolve(homedir(), '.openclaw/workspace');
const PROJECTS = join(WORKSPACE, 'projects/mesh-memory');
const MEMORY = join(WORKSPACE, 'memory');
const PALACE = join(MEMORY, 'palace');
const MESH = join(MEMORY, 'mesh');
const CONTACTS = join(PROJECTS, 'mesh-memory.contacts.json');
const SHARED_POOL = join(MEMORY, 'shared-pool.json');

const CONFIG = {
  port: parseInt(process.env.MESH_PORT) || 18805,
  host: process.env.MESH_HOST || '0.0.0.0',
  dbPath: process.env.MESH_DB_PATH || join(PALACE, 'mesh-memory.db'),
  passportPath: process.env.MESH_PASSPORT || join(PROJECTS, 'mesh-memory/mesh-memory.passport.json'),
  syncIntervalMs: parseInt(process.env.MESH_SYNC_INTERVAL) || 30000,
  peerTimeoutMs: parseInt(process.env.MESH_PEER_TIMEOUT) || 5000,
  maxQueueDepth: parseInt(process.env.MESH_MAX_QUEUE) || 500,
  logLevel: process.env.MESH_LOG_LEVEL || 'INFO',
};

// Ensure directories
[MESH, PALACE].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

// ─── Logging ────────────────────────────────────────────────────────────────

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS[CONFIG.logLevel] ?? 1;

function log(level, msg, meta = {}) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const ts = new Date().toISOString();
  const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  console.log(`[${ts}] [${level}] ${msg}${extra}`);
}

// ─── SQLite Database ────────────────────────────────────────────────────────

let db = null;

function initDatabase() {
  const dbDir = dirname(CONFIG.dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  db = new Database(CONFIG.dbPath);
  db.pragma('journal_mode = WAL');

  // L1: Critical facts (always loaded on wake-up)
  db.exec(`
    CREATE TABLE IF NOT EXISTS critical_facts (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      salience TEXT CHECK(salience IN ('HIGH','MED','LOW')),
      created_at TEXT NOT NULL,
      expires_at TEXT,
      source TEXT,
      provenance TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cf_agent ON critical_facts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_cf_salience ON critical_facts(salience);
    CREATE INDEX IF NOT EXISTS idx_cf_created ON critical_facts(created_at);
  `);

  // L2: Deep memory (FTS5 searchable)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS deep_memory USING fts5(
      agent_id,
      content,
      category,
      timestamp,
      source,
      provenance
    );
    CREATE TABLE IF NOT EXISTS deep_memory_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rowid INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      timestamp TEXT,
      source TEXT,
      provenance TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dm_agent ON deep_memory_meta(agent_id);
    CREATE INDEX IF NOT EXISTS idx_dm_ts ON deep_memory_meta(timestamp);
  `);

  // L3: Temporal knowledge graph
  db.exec(`
    CREATE TABLE IF NOT EXISTS temporal_kg (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      hash TEXT NOT NULL,
      previous_hash TEXT,
      retraction_of TEXT,
      confidence REAL DEFAULT 1.0,
      provenance TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tkg_agent ON temporal_kg(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tkg_ts ON temporal_kg(timestamp);
    CREATE INDEX IF NOT EXISTS idx_tkg_hash ON temporal_kg(hash);
  `);

  // Shared pool (cross-agent facts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_pool (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      fact_type TEXT CHECK(fact_type IN ('fact','lesson','correction','decision','warning')),
      content TEXT NOT NULL,
      tags TEXT,
      timestamp TEXT NOT NULL,
      received_at TEXT NOT NULL,
      provenance TEXT,
      source_agent TEXT,
      decay_score REAL DEFAULT 1.0
    );
    CREATE INDEX IF NOT EXISTS idx_sp_agent ON shared_pool(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sp_type ON shared_pool(fact_type);
    CREATE INDEX IF NOT EXISTS idx_sp_ts ON shared_pool(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sp_decay ON shared_pool(decay_score);
  `);

  // Sync state (track last sync per peer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      peer_name TEXT PRIMARY KEY,
      last_sync TEXT,
      last_success TEXT,
      failure_count INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('active','unreachable','stale'))
    );
  `);

  log('INFO', 'Database initialized', { path: CONFIG.dbPath });
}

// ─── Passport / Identity ────────────────────────────────────────────────────

function loadPassport() {
  if (!existsSync(CONFIG.passportPath)) {
    log('WARN', 'No passport found, creating default');
    return {
      l0: { agentId: 'unknown', name: 'Unknown Agent', version: '2.0.0' },
      l1: { facts: [] },
      created: new Date().toISOString()
    };
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG.passportPath, 'utf-8'));
    // Normalize both v1 (agent.id) and v2 (l0.agentId) schemas
    const agentId = raw.agent?.id || raw.l0?.agentId || 'unknown';
    const name = raw.agent?.name || raw.l0?.name || 'Unknown Agent';
    return {
      l0: { agentId, name, version: raw.version || '2.0.0' },
      l1: raw.l1 || { facts: [] },
      created: raw.created || new Date().toISOString()
    };
  } catch (e) {
    log('ERROR', 'Failed to load passport', { error: e.message });
    return { l0: { agentId: 'unknown', name: 'Unknown Agent' } };
  }
}

// ─── Peer Discovery ─────────────────────────────────────────────────────────

function loadPeers() {
  if (!existsSync(CONTACTS)) {
    log('WARN', 'No contacts file found', { path: CONTACTS });
    return [];
  }

  try {
    const contacts = JSON.parse(readFileSync(CONTACTS, 'utf-8'));
    const peers = [];

    // NEW FORMAT: { peers: [{ name, hostname, ip }] }
    if (contacts.peers && Array.isArray(contacts.peers)) {
      for (const peer of contacts.peers) {
        if (peer.name && (peer.hostname || peer.ip)) {
          const url = peer.hostname
            ? `http://${peer.hostname}:18805`
            : `http://${resolveTailscaleIp(peer.ip)}:18805`;
          peers.push({
            name: peer.name,
            url,
            machine: peer.ip,
            agentId: peer.name.toLowerCase(),
          });
        }
      }
    }
    // OLD FORMAT: { "Liz": { relationship: "peer", machine: "192.168.50.23" } }
    else {
      for (const [key, contact] of Object.entries(contacts)) {
        if (contact.relationship === 'peer' && contact.machine) {
          const tailscaleIp = resolveTailscaleIp(contact.machine);
          if (tailscaleIp) {
            peers.push({
              name: contact.name || key,
              url: `http://${tailscaleIp}:18805`,
              machine: contact.machine,
              agentId: key,
            });
          }
        }
      }
    }

    log('INFO', 'Discovered peers', { count: peers.length, peers: peers.map(p => p.name) });
    return peers;
  } catch (e) {
    log('ERROR', 'Failed to load peers', { error: e.message });
    return [];
  }
}

function resolveTailscaleIp(lanIp) {
  const tailscaleMap = {
    '192.168.50.22': '100.66.164.77',
    '192.168.50.23': '100.105.111.69',
    '192.168.50.24': '100.127.83.84',
    '192.168.50.30': '100.88.181.105',
    '192.168.50.32': '100.69.226.55',
  };
  return tailscaleMap[lanIp] || lanIp;
}

// ─── Shared Pool Operations ─────────────────────────────────────────────────

function addSharedFact(fact) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO shared_pool (id, agent_id, fact_type, content, tags, timestamp, received_at, provenance, source_agent, decay_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0)
  `);

  const id = fact.id || hashFact(fact);
  stmt.run(
    id,
    fact.agentId || 'unknown',
    fact.factType || 'fact',
    fact.content,
    JSON.stringify(fact.tags || []),
    fact.timestamp || new Date().toISOString(),
    new Date().toISOString(),
    JSON.stringify(fact.provenance || {}),
    fact.sourceAgent || fact.agentId || 'unknown'
  );

  return id;
}

function getSharedFacts(opts = {}) {
  const { since, limit = 100, agentId, factType } = opts;
  let sql = 'SELECT * FROM shared_pool WHERE 1=1';
  const params = [];

  if (since) {
    sql += ' AND timestamp > ?';
    params.push(since);
  }
  if (agentId) {
    sql += ' AND agent_id = ?';
    params.push(agentId);
  }
  if (factType) {
    sql += ' AND fact_type = ?';
    params.push(factType);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

function hashFact(fact) {
  const str = JSON.stringify({ content: fact.content, timestamp: fact.timestamp, agentId: fact.agentId });
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// ─── Cross-Node Sync ────────────────────────────────────────────────────────

let peers = [];
let syncTimer = null;

async function syncWithPeer(peer) {
  try {
    // Get our latest fact timestamp
    const lastFact = db.prepare('SELECT MAX(timestamp) as ts FROM shared_pool').get();
    const since = lastFact?.ts || '1970-01-01T00:00:00Z';

    // Fetch peer's facts since our last sync
    const res = await fetch(`${peer.url}/mesh/sync?since=${encodeURIComponent(since)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(CONFIG.peerTimeoutMs),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const facts = await res.json();
    let received = 0;

    for (const fact of facts) {
      // Skip our own facts (avoid loops)
      if (fact.agentId === passport.l0?.agentId) continue;

      addSharedFact({
        ...fact,
        sourceAgent: fact.agentId,
        provenance: { ...fact.provenance, receivedFrom: peer.name, receivedAt: new Date().toISOString() }
      });
      received++;
    }

    // Update sync state — preserve last_success (push will update it)
    db.prepare(`
      INSERT INTO sync_state (peer_name, last_sync, last_success, status)
      VALUES (?, ?, COALESCE((SELECT last_success FROM sync_state WHERE peer_name = ?), '1970-01-01T00:00:00Z'), 'active')
      ON CONFLICT(peer_name) DO UPDATE SET
        last_sync = excluded.last_sync,
        status = 'active',
        failure_count = 0
    `).run(peer.name, new Date().toISOString(), peer.name);

    if (received > 0) {
      log('INFO', `Received ${received} facts from ${peer.name}`);
    }

    return { success: true, received };
  } catch (err) {
    log('WARN', `Sync failed: ${peer.name}`, { error: err.message });

    const existing = db.prepare('SELECT failure_count FROM sync_state WHERE peer_name = ?').get(peer.name);
    const failures = (existing?.failure_count || 0) + 1;

    db.prepare(`
      INSERT INTO sync_state (peer_name, last_sync, failure_count, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(peer_name) DO UPDATE SET
        last_sync = excluded.last_sync,
        failure_count = excluded.failure_count,
        status = excluded.status
    `).run(peer.name, new Date().toISOString(), failures, failures > 3 ? 'unreachable' : 'active');

    return { success: false, error: err.message };
  }
}

async function pushFactsToPeer(peer) {
  try {
    // Get our facts not yet synced to this peer
    const lastSync = db.prepare('SELECT last_success FROM sync_state WHERE peer_name = ?').get(peer.name);
    const since = lastSync?.last_success || '1970-01-01T00:00:00Z';

    const facts = db.prepare('SELECT * FROM shared_pool WHERE timestamp > ? AND agent_id = ? ORDER BY timestamp ASC LIMIT 50')
      .all(since, passport.l0?.agentId);

    if (facts.length === 0) return { success: true, pushed: 0 };

    const res = await fetch(`${peer.url}/mesh/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(facts.map(f => ({
        id: f.id,
        agentId: f.agent_id,
        factType: f.fact_type,
        content: f.content,
        tags: JSON.parse(f.tags || '[]'),
        timestamp: f.timestamp,
        provenance: JSON.parse(f.provenance || '{}'),
      }))),
      signal: AbortSignal.timeout(CONFIG.peerTimeoutMs),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    log('INFO', `Pushed ${facts.length} facts to ${peer.name}`);

    // Update last_success — only after successful push
    db.prepare(`
      INSERT INTO sync_state (peer_name, last_sync, last_success, status)
      VALUES (?, ?, ?, 'active')
      ON CONFLICT(peer_name) DO UPDATE SET
        last_sync = excluded.last_sync,
        last_success = excluded.last_success,
        status = 'active',
        failure_count = 0
    `).run(peer.name, new Date().toISOString(), new Date().toISOString());

    return { success: true, pushed: facts.length };
  } catch (err) {
    log('WARN', `Push failed: ${peer.name}`, { error: err.message });
    return { success: false, error: err.message };
  }
}

async function runSync() {
  peers = loadPeers();
  if (peers.length === 0) return;

  for (const peer of peers) {
    // Pull from peer
    await syncWithPeer(peer);
    // Push to peer
    await pushFactsToPeer(peer);
  }
}

function startSyncLoop() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(runSync, CONFIG.syncIntervalMs);
  log('INFO', 'Sync loop started', { intervalMs: CONFIG.syncIntervalMs });
}

// ─── Memory Watcher (native fs.watch) ────────────────────────────────────────

const fileOffsets = new Map();
const watchers = new Map();

async function readDelta(filePath) {
  const offset = fileOffsets.get(filePath) || 0;
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat || fileStat.size <= offset) return [];

  const buf = await readFile(filePath);
  const delta = buf.subarray(offset).toString('utf-8');
  const lines = delta.split('\n').filter(l => l.trim().length > 0);

  // Only advance offset if we successfully process
  fileOffsets.set(filePath, fileStat.size);
  return lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function extractTaggedFacts(messages) {
  const facts = [];
  const tagPatterns = {
    lesson: /\[lesson\](.+?)(?=\[|$)/is,
    correction: /\[correction\](.+?)(?=\[|$)/is,
    decision: /\[decision\](.+?)(?=\[|$)/is,
    warning: /\[warning\](.+?)(?=\[|$)/is,
  };

  for (const msg of messages) {
    if (!msg.content) continue;
    const content = msg.content;

    for (const [type, pattern] of Object.entries(tagPatterns)) {
      const match = content.match(pattern);
      if (match) {
        facts.push({
          agentId: passport.l0?.agentId || 'unknown',
          factType: type,
          content: match[1].trim(),
          tags: [type],
          timestamp: msg.timestamp || new Date().toISOString(),
          provenance: { source: 'memory-watcher', sessionKey: msg.sessionKey },
        });
      }
    }
  }

  return facts;
}

async function processSessionFile(filePath) {
  const messages = await readDelta(filePath);
  if (messages.length === 0) return;

  const facts = extractTaggedFacts(messages);
  if (facts.length === 0) return;

  for (const fact of facts) {
    addSharedFact(fact);
  }

  log('INFO', `Extracted ${facts.length} tagged facts from ${filePath}`);
}

function startWatcher() {
  const watchDir = resolve(WORKSPACE, 'lcm-files');
  if (!existsSync(watchDir)) {
    log('WARN', 'LCM files directory not found, skipping watcher', { path: watchDir });
    return;
  }

  // Watch existing JSONL files
  function watchFile(filePath) {
    if (watchers.has(filePath)) return;

    const w = fsWatch(filePath, (eventType) => {
      if (eventType === 'change') {
        processSessionFile(filePath).catch(err =>
          log('WARN', `Watcher error: ${filePath}`, { error: err.message })
        );
      }
    });

    watchers.set(filePath, w);
    // Initial scan
    processSessionFile(filePath).catch(() => {});
  }

  // Watch directory for new files
  const dirWatcher = fsWatch(watchDir, { recursive: false }, (eventType, filename) => {
    if (filename && filename.endsWith('.jsonl')) {
      const fullPath = resolve(watchDir, filename);
      if (eventType === 'rename' && existsSync(fullPath)) {
        watchFile(fullPath);
      }
    }
  });

  // Watch existing files
  try {
    const files = readdirSync(watchDir);
    for (const f of files) {
      if (f.endsWith('.jsonl')) {
        watchFile(resolve(watchDir, f));
      }
    }
  } catch {}

  log('INFO', 'Memory watcher started', { dir: watchDir, files: watchers.size });
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const passport = loadPassport();

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(body); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  try {
    // ── Health ──────────────────────────────────────────────────────────────
    if (url.pathname === '/health' && method === 'GET') {
      const peerStatus = db.prepare('SELECT peer_name, status, last_success FROM sync_state').all();
      sendJSON(res, 200, {
        ok: true,
        version: '2.0.0',
        agent: passport.l0?.agentId || 'unknown',
        peers: peerStatus,
        uptime: process.uptime(),
      });
      return;
    }

    // ── Wake-up context (L1 facts) ──────────────────────────────────────────
    if (url.pathname === '/wakeup' && method === 'GET') {
      const facts = db.prepare('SELECT * FROM critical_facts ORDER BY created_at DESC LIMIT 20').all();
      sendJSON(res, 200, {
        agentId: passport.l0?.agentId,
        facts: facts.map(f => ({
          id: f.id,
          category: f.category,
          content: f.content,
          salience: f.salience,
          createdAt: f.created_at,
        })),
      });
      return;
    }

    // ── POST /mesh/sync (receive facts from peer) ───────────────────────────
    if (url.pathname === '/mesh/sync' && method === 'POST') {
      const facts = await readBody(req);
      if (!Array.isArray(facts)) {
        sendJSON(res, 400, { error: 'Expected array of facts' });
        return;
      }

      let accepted = 0;
      for (const fact of facts) {
        // Skip our own facts (loop prevention)
        if (fact.agentId === passport.l0?.agentId) continue;

        addSharedFact({
          ...fact,
          sourceAgent: fact.agentId,
          provenance: {
            ...fact.provenance,
            receivedAt: new Date().toISOString(),
          }
        });
        accepted++;
      }

      log('INFO', `Accepted ${accepted}/${facts.length} facts from peer`);
      sendJSON(res, 200, { accepted, total: facts.length });
      return;
    }

    // ── GET /mesh/sync (send facts to peer) ─────────────────────────────────
    if (url.pathname === '/mesh/sync' && method === 'GET') {
      const since = url.searchParams.get('since') || '1970-01-01T00:00:00Z';
      const limit = parseInt(url.searchParams.get('limit')) || 100;

      const facts = db.prepare('SELECT * FROM shared_pool WHERE timestamp > ? AND agent_id != ? ORDER BY timestamp ASC LIMIT ?')
        .all(since, passport.l0?.agentId || '', limit);

      sendJSON(res, 200, facts.map(f => ({
        id: f.id,
        agentId: f.agent_id,
        factType: f.fact_type,
        content: f.content,
        tags: JSON.parse(f.tags || '[]'),
        timestamp: f.timestamp,
        provenance: JSON.parse(f.provenance || '{}'),
      })));
      return;
    }

    // ── GET /mesh/shared-pool (local query) ───────────────────────────────────
    if (url.pathname === '/mesh/shared-pool' && method === 'GET') {
      const since = url.searchParams.get('since');
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      const agentId = url.searchParams.get('agentId');
      const factType = url.searchParams.get('type');

      const facts = getSharedFacts({ since, limit, agentId, factType });
      sendJSON(res, 200, { facts, count: facts.length });
      return;
    }

    // ── POST /facts (add local fact) ──────────────────────────────────────────
    if (url.pathname === '/facts' && method === 'POST') {
      const fact = await readBody(req);
      const id = addSharedFact({
        ...fact,
        agentId: passport.l0?.agentId || 'unknown',
      });
      sendJSON(res, 200, { id, status: 'stored' });
      return;
    }

    // ── GET /facts/search (search deep memory) ────────────────────────────────
    if (url.pathname === '/facts/search' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit')) || 10;

      const results = db.prepare('SELECT * FROM deep_memory WHERE deep_memory MATCH ? LIMIT ?')
        .all(q, limit);
      sendJSON(res, 200, { query: q, results });
      return;
    }

    // ── Root ──────────────────────────────────────────────────────────────────
    if (url.pathname === '/') {
      sendJSON(res, 200, {
        name: 'mesh-memory',
        version: '2.0.0',
        agent: passport.l0?.agentId || 'unknown',
        endpoints: ['/health', '/wakeup', '/mesh/sync', '/mesh/shared-pool', '/facts', '/facts/search'],
      });
      return;
    }

    sendJSON(res, 404, { error: 'Not found', path: url.pathname });

  } catch (err) {
    log('ERROR', 'HTTP handler error', { error: err.message, path: url.pathname });
    sendJSON(res, 500, { error: 'Internal error', message: err.message });
  }
});

// ─── Startup ────────────────────────────────────────────────────────────────

function start() {
  initDatabase();
  peers = loadPeers();

  server.listen(CONFIG.port, CONFIG.host, () => {
    log('INFO', 'mesh-memory v2 started', {
      port: CONFIG.port,
      host: CONFIG.host,
      agent: passport.l0?.agentId || 'unknown',
      peers: peers.length,
    });

    startSyncLoop();
    startWatcher();
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('INFO', 'Shutting down...');
  if (syncTimer) clearInterval(syncTimer);
  if (db) db.close();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  log('INFO', 'Interrupted, shutting down...');
  if (syncTimer) clearInterval(syncTimer);
  if (db) db.close();
  server.close(() => process.exit(0));
});

start();
