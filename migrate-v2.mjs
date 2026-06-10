#!/usr/bin/env node
/**
 * mesh-memory v2 migration
 * Imports shared-pool.json into v2 SQLite database
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const WORKSPACE = resolve(homedir(), '.openclaw/workspace');
const SHARED_POOL = resolve(WORKSPACE, 'memory/shared-pool.json');
const DB_PATH = resolve(WORKSPACE, 'memory/palace/mesh-memory.db');

function log(level, msg) {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

if (!existsSync(SHARED_POOL)) {
  log('WARN', 'No shared-pool.json found');
  process.exit(0);
}

const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create v2 tables
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
`);

const pool = JSON.parse(readFileSync(SHARED_POOL, 'utf-8'));
const entries = pool.entries || pool.facts || (Array.isArray(pool) ? pool : []);

const stmt = db.prepare(`
  INSERT OR IGNORE INTO shared_pool (id, agent_id, fact_type, content, tags, timestamp, received_at, provenance, source_agent, decay_score)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let migrated = 0;
for (const entry of entries) {
  const id = entry.id || `legacy-${Date.now()}-${migrated}`;
  stmt.run(
    id,
    entry.agentId || entry.agent_id || entry.source || 'unknown',
    entry.factType || entry.type || 'fact',
    entry.content || entry.fact || JSON.stringify(entry),
    JSON.stringify(entry.tags || []),
    entry.timestamp || entry.date || new Date().toISOString(),
    entry.receivedAt || entry.timestamp || new Date().toISOString(),
    JSON.stringify(entry.provenance || {}),
    entry.sourceAgent || entry.agentId || 'unknown',
    entry.decayScore || entry.decay_score || 1.0
  );
  migrated++;
}

db.close();
log('INFO', `Migrated ${migrated} entries to v2 database`);
