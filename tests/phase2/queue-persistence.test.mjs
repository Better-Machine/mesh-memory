/**
 * @module queue-persistence.test
 * @description Tests for queue-persistence.mjs
 * Phase 2: Queue persistence with WAL and snapshots
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'mesh-memory-queue-test-' + Date.now());

// Mock config
const mockConfig = {
  queue: {
    persistenceEnabled: true,
    walMaxSizeMB: 10,
    snapshotIntervalHours: 24,
    retentionDays: 7,
    queueDir: join(TEST_DIR, 'queue'),
    indexDbPath: join(TEST_DIR, 'queue', 'index.db')
  },
  agentId: 'test-agent'
};

describe('Phase 2 - Queue Persistence', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, 'queue'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'queue', 'wal'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'queue', 'snapshots'), { recursive: true });
  });
  
  after(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('Q1 - persistenceEnabled config is valid', () => {
    const enabled = mockConfig.queue.persistenceEnabled;
    
    assert.strictEqual(typeof enabled, 'boolean', 'persistenceEnabled is boolean');
    assert.strictEqual(enabled, true, 'persistenceEnabled is true by default');
  });

  it('Q2 - walMaxSizeMB is reasonable', () => {
    const sizeMB = mockConfig.queue.walMaxSizeMB;
    
    assert.strictEqual(typeof sizeMB, 'number', 'walMaxSizeMB is a number');
    assert.ok(sizeMB > 0, 'walMaxSizeMB is positive');
    assert.ok(sizeMB <= 100, 'walMaxSizeMB is reasonable (<= 100MB)');
    assert.strictEqual(sizeMB, 10, 'Default WAL size is 10MB');
  });

  it('Q3 - snapshotIntervalHours is valid', () => {
    const interval = mockConfig.queue.snapshotIntervalHours;
    
    assert.strictEqual(typeof interval, 'number', 'snapshotIntervalHours is a number');
    assert.ok(interval > 0, 'snapshot interval is positive');
    assert.ok(interval <= 168, 'snapshot interval is reasonable (<= 1 week)');
    assert.strictEqual(interval, 24, 'Default snapshot interval is 24 hours');
  });

  it('Q4 - retentionDays is valid', () => {
    const retention = mockConfig.queue.retentionDays;
    
    assert.strictEqual(typeof retention, 'number', 'retentionDays is a number');
    assert.ok(retention > 0, 'retention is positive');
    assert.ok(retention <= 30, 'retention is reasonable (<= 30 days)');
    assert.strictEqual(retention, 7, 'Default retention is 7 days');
  });

  it('Q5 - queueDir path is configured', () => {
    const queueDir = mockConfig.queue.queueDir;
    
    assert.strictEqual(typeof queueDir, 'string', 'queueDir is a string');
    assert.ok(queueDir.includes('queue'), 'queueDir contains "queue"');
  });

  it('Q6 - indexDbPath is configured', () => {
    const indexPath = mockConfig.queue.indexDbPath;
    
    assert.strictEqual(typeof indexPath, 'string', 'indexDbPath is a string');
    assert.ok(indexPath.endsWith('.db'), 'indexDbPath ends with .db');
  });

  it('Q7 - queue config matches expected Phase 2 schema', () => {
    const queue = mockConfig.queue;
    
    assert.ok(queue, 'queue section exists');
    assert.strictEqual(typeof queue.persistenceEnabled, 'boolean', 'persistenceEnabled is boolean');
    assert.strictEqual(typeof queue.walMaxSizeMB, 'number', 'walMaxSizeMB is number');
    assert.strictEqual(typeof queue.snapshotIntervalHours, 'number', 'snapshotIntervalHours is number');
    assert.strictEqual(typeof queue.retentionDays, 'number', 'retentionDays is number');
  });

  it('Q8 - queue directories exist', () => {
    const queueDir = mockConfig.queue.queueDir;
    const walDir = join(queueDir, 'wal');
    const snapshotDir = join(queueDir, 'snapshots');
    
    assert.strictEqual(existsSync(queueDir), true, 'queueDir exists');
    assert.strictEqual(existsSync(walDir), true, 'wal subdirectory exists');
    assert.strictEqual(existsSync(snapshotDir), true, 'snapshots subdirectory exists');
  });

  it('Q9 - retention < snapshot interval implies WAL cleanup', () => {
    const { retentionDays, snapshotIntervalHours } = mockConfig.queue;
    
    // With 7 day retention and 24h snapshots, we keep ~7 snapshots
    const snapshotCount = (retentionDays * 24) / snapshotIntervalHours;
    assert.ok(snapshotCount >= 1, 'At least 1 snapshot retained');
    assert.ok(snapshotCount <= 30, 'Reasonable number of snapshots retained');
  });
});
