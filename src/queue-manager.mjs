/**
 * Queue Manager - SQLite-based outbound queue for failed A2A messages
 * Phase 1: Foundation Hardening
 * 
 * Features:
 * - SQLite-based outbound queue for failed messages
 * - Retry with exponential backoff (max 5 attempts)
 * - Dead-letter queue (DLQ) for permanent failures
 * - Queue processor daemon (30s interval)
 * - Metrics endpoint for queue depth, oldest, error rate
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DB_PATH = process.env.MESH_QUEUE_DB_PATH || 
  path.join(process.env.HOME, '.openclaw/workspace/projects/mesh-memory/queue.db');
const SCHEMA_PATH = path.join(__dirname, 'db', 'schema.sql');
const PROCESSOR_INTERVAL = process.env.MESH_QUEUE_PROCESSOR_INTERVAL || 30 * 1000; // 30 seconds
const MAX_RETRIES = 5;
const BACKOFF_DELAYS = [30, 60, 120, 240, 480]; // seconds: 30s, 60s, 2m, 4m, 8m
const METRICS_INTERVAL = 60 * 1000; // 1 minute

/**
 * Queue Manager class
 */
export class QueueManager {
  constructor(options = {}) {
    this.dbPath = options.dbPath || DB_PATH;
    this.processorInterval = options.processorInterval || PROCESSOR_INTERVAL;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
    this.backoffDelays = options.backoffDelays || BACKOFF_DELAYS;
    
    this.db = null;
    this.processorTimer = null;
    this.metricsTimer = null;
    this.initialized = false;
    this.isProcessing = false;
    this.messageHandlers = new Map();
    
    // Metrics
    this.metrics = {
      processedCount: 0,
      failedCount: 0,
      sentCount: 0,
      dlqCount: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Initialize the queue manager
   */
  async initialize() {
    if (this.initialized) return;

    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    // Load schema
    const schema = await fs.readFile(SCHEMA_PATH, 'utf-8');
    this.db.exec(schema);

    // Prepare statements
    this.#prepareStatements();

    // Start timers
    this.startProcessor();
    this.startMetricsCollector();

    this.initialized = true;
  }

  /**
   * Prepare SQL statements
   */
  #prepareStatements() {
    // Queue operations
    this.stmts = {
      enqueue: this.db.prepare(`
        INSERT INTO outbound_queue (id, message, attempts, next_retry, created_at, peer_id, endpoint)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      
      dequeue: this.db.prepare(`
        SELECT * FROM outbound_queue 
        WHERE next_retry <= ?
        ORDER BY created_at ASC
        LIMIT ?
      `),
      
      updateRetry: this.db.prepare(`
        UPDATE outbound_queue 
        SET attempts = ?, next_retry = ?, last_attempt_at = ?
        WHERE id = ?
      `),
      
      deleteFromQueue: this.db.prepare(`
        DELETE FROM outbound_queue WHERE id = ?
      `),
      
      moveToDlq: this.db.prepare(`
        INSERT INTO dlq (id, message, attempts, failed_at, created_at, peer_id, endpoint, last_error, context)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      
      getQueueDepth: this.db.prepare(`
        SELECT COUNT(*) as count FROM outbound_queue
      `),
      
      getOldestMessage: this.db.prepare(`
        SELECT MIN(created_at) as oldest FROM outbound_queue
      `),
      
      getReadyCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM outbound_queue WHERE next_retry <= ?
      `),
      
      getDlqCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM dlq
      `),
      
      recordMetrics: this.db.prepare(`
        INSERT INTO queue_metrics (recorded_at, queue_depth, oldest_message_age, error_rate, processed_count, failed_count, dlq_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      
      getRecentMetrics: this.db.prepare(`
        SELECT * FROM queue_metrics ORDER BY recorded_at DESC LIMIT ?
      `),
      
      getDlqEntries: this.db.prepare(`
        SELECT * FROM dlq ORDER BY failed_at DESC LIMIT ? OFFSET ?
      `),
      
      retryDlqEntry: this.db.prepare(`
        DELETE FROM dlq WHERE id = ?
      `),
      
      clearOldMetrics: this.db.prepare(`
        DELETE FROM queue_metrics WHERE recorded_at < ?
      `)
    };
  }

  /**
   * Start the queue processor daemon
   */
  startProcessor() {
    if (this.processorTimer) {
      clearInterval(this.processorTimer);
    }

    this.processorTimer = setInterval(async () => {
      await this.processQueue();
    }, this.processorInterval);

    // Also do an immediate first run
    setImmediate(() => this.processQueue());
  }

  /**
   * Stop the queue processor
   */
  stopProcessor() {
    if (this.processorTimer) {
      clearInterval(this.processorTimer);
      this.processorTimer = null;
    }
  }

  /**
   * Start metrics collector
   */
  startMetricsCollector() {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    this.metricsTimer = setInterval(async () => {
      await this.collectMetrics();
    }, METRICS_INTERVAL);
  }

  /**
   * Stop metrics collector
   */
  stopMetricsCollector() {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  /**
   * Enqueue a failed message for retry
   * @param {Object} messageData - Message data
   * @returns {Object} Enqueue result
   */
  async enqueue(messageData) {
    await this.initialize();

    const {
      message,
      peerId,
      endpoint,
      priority = 'normal'
    } = messageData;

    const id = crypto.randomUUID();
    const now = Date.now();
    // First attempt is immediate (next_retry = now), subsequent retries use backoff
    const nextRetry = now;

    try {
      this.stmts.enqueue.run(
        id,
        JSON.stringify(message),
        0,
        nextRetry,
        now,
        peerId,
        endpoint
      );

      return {
        success: true,
        id,
        nextRetry: new Date(nextRetry).toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Process the queue
   */
  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      const readyMessages = this.stmts.dequeue.all(now, 100);

      for (const msg of readyMessages) {
        await this.#processMessage(msg);
      }
    } catch (err) {
      console.error('Queue processing error:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single message
   */
  async #processMessage(msg) {
    const message = JSON.parse(msg.message);
    const attempts = msg.attempts + 1;
    const now = Date.now();

    try {
      // Try to send
      const handler = this.messageHandlers.get(msg.peer_id);
      
      if (handler) {
        await handler(message, {
          peerId: msg.peer_id,
          endpoint: msg.endpoint,
          attempt: attempts
        });
      } else {
        // No handler - use default HTTP POST
        await this.#defaultSend(message, msg.endpoint);
      }

      // Success - remove from queue
      this.stmts.deleteFromQueue.run(msg.id);
      this.metrics.sentCount++;
      
    } catch (err) {
      // Failed
      this.metrics.failedCount++;
      
      if (attempts >= this.maxRetries) {
        // Max retries exceeded - move to DLQ
        this.stmts.moveToDlq.run(
          msg.id,
          msg.message,
          attempts,
          now,
          msg.created_at,
          msg.peer_id,
          msg.endpoint,
          err.message,
          JSON.stringify({ lastAttempt: now })
        );
        this.stmts.deleteFromQueue.run(msg.id);
        this.metrics.dlqCount++;
        
        console.error(`Message ${msg.id} moved to DLQ after ${attempts} attempts`);
      } else {
        // Schedule retry with exponential backoff
        const delayMs = this.backoffDelays[Math.min(attempts - 1, this.backoffDelays.length - 1)] * 1000;
        const nextRetry = now + delayMs;
        
        this.stmts.updateRetry.run(attempts, nextRetry, now, msg.id);
      }
    }

    this.metrics.processedCount++;
  }

  /**
   * Default HTTP send for messages without handler
   */
  async #defaultSend(message, endpoint) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  /**
   * Register a message handler for a peer
   * @param {string} peerId - Peer identifier
   * @param {Function} handler - Message handler function
   */
  registerHandler(peerId, handler) {
    this.messageHandlers.set(peerId, handler);
  }

  /**
   * Unregister a message handler
   * @param {string} peerId - Peer identifier
   */
  unregisterHandler(peerId) {
    this.messageHandlers.delete(peerId);
  }

  /**
   * Collect and store metrics
   */
  async collectMetrics() {
    await this.initialize();

    const now = Date.now();
    
    try {
      const depth = this.stmts.getQueueDepth.get().count;
      const oldest = this.stmts.getOldestMessage.get().oldest || now;
      const oldestAge = Math.floor((now - oldest) / 1000);
      const dlqCount = this.stmts.getDlqCount.get().count;
      
      // Calculate error rate from current window
      const totalOps = this.metrics.processedCount + this.metrics.failedCount;
      const errorRate = totalOps > 0 ? this.metrics.failedCount / totalOps : 0;

      this.stmts.recordMetrics.run(
        now,
        depth,
        oldestAge,
        errorRate,
        this.metrics.processedCount,
        this.metrics.failedCount,
        dlqCount
      );

      // Reset counters
      this.metrics.processedCount = 0;
      this.metrics.failedCount = 0;

      // Clean up old metrics (keep 7 days)
      const cutoff = now - (7 * 24 * 60 * 60 * 1000);
      this.stmts.clearOldMetrics.run(cutoff);

    } catch (err) {
      console.error('Metrics collection error:', err.message);
    }
  }

  /**
   * Get current queue metrics
   */
  async getMetrics() {
    await this.initialize();

    const now = Date.now();
    const depth = this.stmts.getQueueDepth.get().count;
    const oldest = this.stmts.getOldestMessage.get().oldest;
    const oldestAge = oldest ? Math.floor((now - oldest) / 1000) : 0;
    const readyCount = this.stmts.getReadyCount.get(now).count;
    const dlqCount = this.stmts.getDlqCount.get().count;

    // Get recent metrics for trend
    const recentMetrics = this.stmts.getRecentMetrics.all(10);

    return {
      queue: {
        depth,
        oldestMessageAge: oldestAge,
        readyToSend: readyCount
      },
      dlq: {
        count: dlqCount
      },
      throughput: {
        sent: this.metrics.sentCount,
        sinceLastReset: new Date(this.metrics.lastReset).toISOString()
      },
      recent: recentMetrics.map(m => ({
        recordedAt: new Date(m.recorded_at).toISOString(),
        depth: m.queue_depth,
        oldestAge: m.oldest_message_age,
        errorRate: m.error_rate,
        processed: m.processed_count,
        failed: m.failed_count
      }))
    };
  }

  /**
   * Get dead letter queue entries
   * @param {number} limit - Max entries to return
   * @param {number} offset - Offset for pagination
   */
  async getDlq(limit = 50, offset = 0) {
    await this.initialize();

    const entries = this.stmts.getDlqEntries.all(limit, offset);

    return {
      entries: entries.map(e => ({
        id: e.id,
        message: JSON.parse(e.message),
        attempts: e.attempts,
        failedAt: new Date(e.failed_at).toISOString(),
        createdAt: new Date(e.created_at).toISOString(),
        peerId: e.peer_id,
        endpoint: e.endpoint,
        lastError: e.last_error
      })),
      count: entries.length,
      offset,
      limit
    };
  }

  /**
   * Retry a DLQ entry
   * @param {string} entryId - DLQ entry ID to retry
   */
  async retryDlqEntry(entryId) {
    await this.initialize();

    const entry = this.db.prepare('SELECT * FROM dlq WHERE id = ?').get(entryId);
    if (!entry) {
      return { success: false, error: 'Entry not found' };
    }

    // Remove from DLQ
    this.stmts.retryDlqEntry.run(entryId);

    // Re-queue with fresh attempts
    const now = Date.now();
    const nextRetry = now + (this.backoffDelays[0] * 1000);

    this.stmts.enqueue.run(
      entry.id,
      entry.message,
      0,
      nextRetry,
      entry.created_at,
      entry.peer_id,
      entry.endpoint
    );

    return {
      success: true,
      message: 'Re-queued for delivery'
    };
  }

  /**
   * Delete a DLQ entry
   * @param {string} entryId - DLQ entry ID to delete
   */
  async deleteDlqEntry(entryId) {
    await this.initialize();

    const result = this.stmts.retryDlqEntry.run(entryId);
    
    return {
      success: result.changes > 0,
      deleted: result.changes > 0
    };
  }

  /**
   * Get queue status summary
   */
  async getStatus() {
    await this.initialize();

    const metrics = await this.getMetrics();
    
    return {
      healthy: metrics.queue.depth < 1000 && metrics.dlq.count < 100,
      queue: metrics.queue,
      dlq: metrics.dlq,
      processor: {
        running: !!this.processorTimer,
        interval: this.processorInterval
      },
      handlers: Array.from(this.messageHandlers.keys())
    };
  }

  /**
   * Close the database connection
   */
  async close() {
    this.stopProcessor();
    this.stopMetricsCollector();
    
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    this.initialized = false;
  }
}

// Singleton instance
let queueManagerInstance = null;

export async function getQueueManager(options = {}) {
  if (!queueManagerInstance) {
    queueManagerInstance = new QueueManager(options);
    await queueManagerInstance.initialize();
  }
  return queueManagerInstance;
}

export function resetQueueManager() {
  if (queueManagerInstance) {
    queueManagerInstance.close();
    queueManagerInstance = null;
  }
}

export default QueueManager;