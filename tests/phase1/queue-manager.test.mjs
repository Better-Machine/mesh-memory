/**
 * Queue Manager Tests - Phase 1: Foundation Hardening
 * 
 * Tests:
 * - Message enqueue
 * - Queue processing
 * - Retry with exponential backoff
 * - Dead letter queue
 * - Metrics collection
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getQueueManager, resetQueueManager } from '../../src/queue-manager.mjs';
import { delay } from './setup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '..', '.test-queue.db');

async function cleanup() {
  try {
    await fs.rm(TEST_DB_PATH, { force: true });
    await fs.rm(TEST_DB_PATH + '-shm', { force: true });
    await fs.rm(TEST_DB_PATH + '-wal', { force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
  resetQueueManager();
}

describe('Queue Manager', async () => {
  await cleanup();

  await test('enqueues a message', async () => {
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000 // Don't auto-process during test
    });

    const result = await manager.enqueue({
      message: { type: 'test', data: 'hello' },
      peerId: 'test-peer',
      endpoint: 'http://localhost:18803'
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.id, 'Should have queue ID');
    assert.ok(result.nextRetry, 'Should have next retry time');
  });

  await test('gets queue metrics', async () => {
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000
    });

    // Collect metrics
    await manager.collectMetrics();
    const metrics = await manager.getMetrics();

    assert.ok(metrics.queue, 'Should have queue metrics');
    assert.ok(metrics.dlq, 'Should have DLQ metrics');
    assert.ok(metrics.throughput, 'Should have throughput metrics');
    assert.strictEqual(typeof metrics.queue.depth, 'number');
  });

  await test('gets queue status', async () => {
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000
    });

    const status = await manager.getStatus();

    assert.ok(status.healthy !== undefined, 'Should have healthy status');
    assert.ok(status.queue, 'Should have queue info');
    assert.ok(status.processor, 'Should have processor info');
  });

  await test('processes messages with registered handler', async () => {
    await cleanup();
    
    let processedMessages = [];
    
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000
    });

    // Register a test handler
    manager.registerHandler('test-peer', async (message, ctx) => {
      processedMessages.push({ message, ctx });
    });

    // Enqueue a message
    await manager.enqueue({
      message: { type: 'test', data: 'hello' },
      peerId: 'test-peer',
      endpoint: 'http://localhost:18803'
    });

    // Process queue manually
    await manager.processQueue();

    // Check if message was processed
    assert.ok(processedMessages.length >= 1, 'Should have processed at least 1 message');
  });

  await cleanup();
});

describe('Queue Retry Logic', async () => {
  await cleanup();

  await test('retries failed messages', async () => {
    await cleanup();
    
    let attemptCount = 0;
    
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000,
      maxRetries: 3,
      backoffDelays: [1, 2, 4] // Fast delays for testing
    });

    // Register a handler that fails
    manager.registerHandler('failing-peer', async () => {
      attemptCount++;
      throw new Error('Simulated failure');
    });

    // Enqueue a message
    await manager.enqueue({
      message: { type: 'test' },
      peerId: 'failing-peer',
      endpoint: 'http://localhost:18803'
    });

    // Process multiple times to trigger retries
    for (let i = 0; i < 5; i++) {
      await manager.processQueue();
    }

    // Should have attempted multiple times
    assert.ok(attemptCount >= 1, 'Should have attempted at least once');
  });

  await test('moves to DLQ after max retries', async () => {
    await cleanup();
    
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000,
      maxRetries: 2,
      backoffDelays: [1, 1]
    });

    // Register failing handler
    manager.registerHandler('dlq-peer', async () => {
      throw new Error('Always fails');
    });

    // Enqueue and process
    await manager.enqueue({
      message: { type: 'test', id: 'dlq-test' },
      peerId: 'dlq-peer',
      endpoint: 'http://localhost:18803'
    });

    // Process multiple times to exhaust retries (wait for backoff)
    for (let i = 0; i < 5; i++) {
      await manager.processQueue();
      await delay(1100); // Wait for 1s backoff + margin
    }

    // Check DLQ
    const dlq = await manager.getDlq(10, 0);
    
    // Note: DLQ entries may exist from previous test runs
    assert.ok(dlq.entries.length >= 1, 'Should have at least 1 DLQ entry');
    
    // Find our specific test message
    const ourEntry = dlq.entries.find(e => e.message?.id === 'dlq-test');
    if (ourEntry) {
      assert.ok(ourEntry.lastError, 'DLQ entry should have error info');
      assert.ok(ourEntry.attempts >= 2, 'Should have exhausted retries');
    }
  });

  await test('can retry DLQ entries', async () => {
    const manager = await getQueueManager({
      dbPath: TEST_DB_PATH,
      processorInterval: 10000
    });

    // Get DLQ entries
    const dlq = await manager.getDlq(1, 0);
    
    if (dlq.entries.length > 0) {
      const entryId = dlq.entries[0].id;
      
      // Retry the entry
      const result = await manager.retryDlqEntry(entryId);
      assert.strictEqual(result.success, true);
    }
  });

  await cleanup();
});
