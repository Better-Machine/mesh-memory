/**
 * @module add-performance-indexes
 * @description Migration script to add performance indexes to existing databases
 * 
 * Run this after deployment to add missing indexes without dropping tables.
 * 
 * @version 1.0.0
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.mjs';

/**
 * Index definitions for each database
 */
const INDEX_DEFINITIONS = {
  // Token database indexes
  tokens: [
    { name: 'idx_tokens_status_expires', sql: 'CREATE INDEX IF NOT EXISTS idx_tokens_status_expires ON tokens(status, expires_at)' },
    { name: 'idx_tokens_agent_status', sql: 'CREATE INDEX IF NOT EXISTS idx_tokens_agent_status ON tokens(agent_id, status)' }
  ],
  
  // Queue persistence indexes
  'queue_entries': [
    { name: 'idx_queue_peer_status_time', sql: 'CREATE INDEX IF NOT EXISTS idx_queue_peer_status_time ON queue_entries(peerName, status, timestamp)' },
    { name: 'idx_queue_status_time', sql: 'CREATE INDEX IF NOT EXISTS idx_queue_status_time ON queue_entries(status, timestamp)' }
  ],
  
  // A2A Context Escrow indexes
  'context_mappings': [
    { name: 'idx_context_peer_status', sql: 'CREATE INDEX IF NOT EXISTS idx_context_peer_status ON context_mappings(peer_name, status)' },
    { name: 'idx_context_status_activity', sql: 'CREATE INDEX IF NOT EXISTS idx_context_status_activity ON context_mappings(status, last_activity)' }
  ],
  'context_messages': [
    { name: 'idx_messages_context_time', sql: 'CREATE INDEX IF NOT EXISTS idx_messages_context_time ON context_messages(context_id, timestamp)' }
  ],
  
  // A2A Discovery Registry indexes
  'request_history': [
    { name: 'idx_reqhist_peer_time', sql: 'CREATE INDEX IF NOT EXISTS idx_reqhist_peer_time ON request_history(peer_name, timestamp)' }
  ],
  'peer_health': [
    { name: 'idx_peerhealth_state', sql: 'CREATE INDEX IF NOT EXISTS idx_peerhealth_state ON peer_health(circuit_breaker_state)' }
  ],
  
  // ABAC Policy indexes
  'policies': [
    { name: 'idx_policies_active_priority', sql: 'CREATE INDEX IF NOT EXISTS idx_policies_active_priority ON policies(is_active, priority)' }
  ],
  
  // Temporal Knowledge Graph indexes
  'facts': [
    { name: 'idx_facts_room_subject_time', sql: 'CREATE INDEX IF NOT EXISTS idx_facts_room_subject_time ON facts(room_id, subject, valid_from)' },
    { name: 'idx_facts_validity', sql: 'CREATE INDEX IF NOT EXISTS idx_facts_validity ON facts(valid_from, valid_until)' }
  ],
  
  // Deal Room indexes
  'rooms': [
    { name: 'idx_rooms_status', sql: 'CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status)' },
    { name: 'idx_rooms_created', sql: 'CREATE INDEX IF NOT EXISTS idx_rooms_created ON rooms(created_at)' }
  ],
  'room_participants': [
    { name: 'idx_participants_room', sql: 'CREATE INDEX IF NOT EXISTS idx_participants_room ON room_participants(room_id)' }
  ]
};

/**
 * Check if an index exists
 */
async function indexExists(db, indexName) {
  const result = await db.get(
    "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
    [indexName]
  );
  return result !== undefined;
}

/**
 * Add indexes to a database
 */
async function addIndexesToDatabase(dbPath, indexes) {
  if (!existsSync(dbPath)) {
    console.log(`[migration] Database not found: ${dbPath}`);
    return { added: 0, skipped: 0, errors: [] };
  }
  
  const db = new sqlite3.Database(dbPath);
  db.get = promisify(db.get.bind(db));
  db.run = promisify(db.run.bind(db));
  
  const results = { added: 0, skipped: 0, errors: [] };
  
  try {
    for (const { name, sql } of indexes) {
      try {
        const exists = await indexExists(db, name);
        if (exists) {
          console.log(`[migration] Index ${name} already exists, skipping`);
          results.skipped++;
          continue;
        }
        
        console.log(`[migration] Creating index: ${name}`);
        await db.run(sql);
        results.added++;
      } catch (error) {
        console.error(`[migration] Failed to create index ${name}:`, error.message);
        results.errors.push({ name, error: error.message });
      }
    }
  } finally {
    db.close();
  }
  
  return results;
}

/**
 * Main migration function
 */
export async function runMigration(config = null) {
  if (!config) {
    config = loadConfig();
  }
  
  const baseDir = config.memory?.baseDir || 'memory';
  const dbBaseDir = process.env.HOME || process.env.USERPROFILE;
  const dataDir = join(dbBaseDir, '.openclaw/workspace', baseDir);
  
  const results = {
    databases: {},
    totalAdded: 0,
    totalSkipped: 0,
    totalErrors: 0
  };
  
  // Migrate tokens database
  const tokensDbPath = join(dataDir, 'tokens.db');
  results.databases.tokens = await addIndexesToDatabase(tokensDbPath, INDEX_DEFINITIONS.tokens);
  
  // Migrate queue persistence
  const queueDbPath = join(dataDir, 'queue/index.db');
  results.databases.queue = await addIndexesToDatabase(queueDbPath, INDEX_DEFINITIONS.queue_entries);
  
  // Migrate A2A context escrow
  const escrowDbPath = join(dataDir, 'a2a-escrow/context-escrow.db');
  results.databases.contextEscrow = await addIndexesToDatabase(escrowDbPath, [
    ...INDEX_DEFINITIONS.context_mappings,
    ...INDEX_DEFINITIONS.context_messages
  ]);
  
  // Migrate A2A discovery registry
  const registryDbPath = join(dataDir, 'a2a-registry/peer-registry.db');
  results.databases.discoveryRegistry = await addIndexesToDatabase(registryDbPath, [
    ...INDEX_DEFINITIONS.request_history,
    ...INDEX_DEFINITIONS.peer_health
  ]);
  
  // Migrate ABAC policies
  const policiesDbPath = join(dataDir, 'policies/policies.db');
  results.databases.abac = await addIndexesToDatabase(policiesDbPath, INDEX_DEFINITIONS.policies);
  
  // TKG and Deal Room databases
  const tkgDbPath = join(dataDir, 'tkg/tkg.db');
  results.databases.tkg = await addIndexesToDatabase(tkgDbPath, INDEX_DEFINITIONS.facts);
  
  const roomsDbPath = join(dataDir, 'rooms/rooms.db');
  results.databases.rooms = await addIndexesToDatabase(roomsDbPath, [
    ...INDEX_DEFINITIONS.rooms,
    ...INDEX_DEFINITIONS.room_participants
  ]);
  
  // Calculate totals
  for (const db of Object.values(results.databases)) {
    results.totalAdded += db.added;
    results.totalSkipped += db.skipped;
    results.totalErrors += db.errors.length;
  }
  
  console.log('\n[migration] Performance index migration complete:');
  console.log(`  Total indexes added: ${results.totalAdded}`);
  console.log(`  Total indexes skipped (already exist): ${results.totalSkipped}`);
  console.log(`  Total errors: ${results.totalErrors}`);
  
  return results;
}

/**
 * CLI usage
 */
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runMigration()
    .then(results => {
      console.log('[migration] Migration completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('[migration] Migration failed:', error);
      process.exit(1);
    });
}

export default { runMigration, INDEX_DEFINITIONS };
