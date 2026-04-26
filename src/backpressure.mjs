/**
 * @module backpressure
 * @description Backpressure Mechanisms for Mesh-Memory
 * 
 * Implements flow control for:
 * - WAL write queue
 * - A2A message handling
 * - Audit log writes
 * 
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * Backpressure Controller
 * Manages flow control for various subsystems
 */
export class BackpressureController extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // WAL Write Queue
      walQueueMaxSize: options.walQueueMaxSize || 10000,
      walHighWatermark: options.walHighWatermark || 0.8, // 80%
      walLowWatermark: options.walLowWatermark || 0.3,   // 30%
      walDrainTimeoutMs: options.walDrainTimeoutMs || 30000,
      
      // A2A Message Handling
      a2aQueueMaxSize: options.a2aQueueMaxSize || 5000,
      a2aHighWatermark: options.a2aHighWatermark || 0.8,
      a2aLowWatermark: options.a2aLowWatermark || 0.3,
      a2aRateLimitPerSecond: options.a2aRateLimitPerSecond || 100,
      
      // Audit Log Writes
      auditBatchSize: options.auditBatchSize || 100,
      auditFlushIntervalMs: options.auditFlushIntervalMs || 5000,
      auditQueueMaxSize: options.auditQueueMaxSize || 10000,
      
      // General
      emitStatsIntervalMs: options.emitStatsIntervalMs || 60000,
      ...options
    };
    
    // Queue state tracking
    this.queues = {
      wal: { size: 0, paused: false, dropped: 0 },
      a2a: { size: 0, paused: false, dropped: 0, tokens: this.config.a2aRateLimitPerSecond },
      audit: { size: 0, pending: [], lastFlush: Date.now() }
    };
    
    // Token bucket refill timer
    this.tokenRefillInterval = null;
    
    // Stats
    this.stats = {
      wal: { processed: 0, dropped: 0, peakSize: 0 },
      a2a: { processed: 0, dropped: 0, peakSize: 0, throttled: 0 },
      audit: { flushed: 0, batched: 0, peakSize: 0 }
    };
    
    // Running state
    this.running = false;
  }
  
  /**
   * Initialize backpressure controller
   */
  initialize() {
    if (this.running) return;
    
    // Start token bucket refill
    this.tokenRefillInterval = setInterval(() => {
      this.queues.a2a.tokens = Math.min(
        this.config.a2aRateLimitPerSecond,
        this.queues.a2a.tokens + (this.config.a2aRateLimitPerSecond / 10)
      );
    }, 100);
    
    // Start stats emission
    this.statsInterval = setInterval(() => {
      this.emit('stats', this.getStats());
    }, this.config.emitStatsIntervalMs);
    
    this.running = true;
    console.log('[backpressure] Controller initialized');
  }
  
  /**
   * WAL Write Queue Backpressure
   * Returns true if write should proceed, false if should drop/reject
   */
  checkWALBackpressure() {
    const queue = this.queues.wal;
    const ratio = queue.size / this.config.walQueueMaxSize;
    
    // Update peak stats
    this.stats.wal.peakSize = Math.max(this.stats.wal.peakSize, queue.size);
    
    // Check if we're above high watermark
    if (ratio >= this.config.walHighWatermark && !queue.paused) {
      queue.paused = true;
      this.emit('wal:paused', { size: queue.size, ratio });
      console.log(`[backpressure] WAL queue paused at ${Math.round(ratio * 100)}% capacity`);
    }
    
    // Check if we're below low watermark (resume)
    if (ratio <= this.config.walLowWatermark && queue.paused) {
      queue.paused = false;
      this.emit('wal:resumed', { size: queue.size, ratio });
      console.log(`[backpressure] WAL queue resumed at ${Math.round(ratio * 100)}% capacity`);
    }
    
    // Reject if queue is full
    if (queue.size >= this.config.walQueueMaxSize) {
      queue.dropped++;
      this.stats.wal.dropped++;
      this.emit('wal:dropped', { size: queue.size });
      return false;
    }
    
    return !queue.paused;
  }
  
  /**
   * Increment WAL queue size
   */
  incrementWALQueue() {
    this.queues.wal.size++;
  }
  
  /**
   * Decrement WAL queue size
   */
  decrementWALQueue() {
    if (this.queues.wal.size > 0) {
      this.queues.wal.size--;
      this.stats.wal.processed++;
    }
    
    // Check for resume condition
    const ratio = this.queues.wal.size / this.config.walQueueMaxSize;
    if (ratio <= this.config.walLowWatermark && this.queues.wal.paused) {
      this.queues.wal.paused = false;
      this.emit('wal:resumed', { size: this.queues.wal.size, ratio });
    }
  }
  
  /**
   * A2A Message Rate Limiting
   * Returns true if message should proceed, false if should throttle
   */
  checkA2ARateLimit() {
    const queue = this.queues.a2a;
    
    // Update peak stats
    this.stats.a2a.peakSize = Math.max(this.stats.a2a.peakSize, queue.size);
    
    // Check queue size backpressure
    const ratio = queue.size / this.config.a2aQueueMaxSize;
    if (ratio >= this.config.a2aHighWatermark && !queue.paused) {
      queue.paused = true;
      this.emit('a2a:paused', { size: queue.size, ratio });
    }
    
    if (ratio <= this.config.a2aLowWatermark && queue.paused) {
      queue.paused = false;
      this.emit('a2a:resumed', { size: queue.size, ratio });
    }
    
    if (queue.size >= this.config.a2aQueueMaxSize) {
      queue.dropped++;
      this.stats.a2a.dropped++;
      this.emit('a2a:dropped', { size: queue.size });
      return false;
    }
    
    // Token bucket rate limiting
    if (queue.tokens < 1) {
      this.stats.a2a.throttled++;
      this.emit('a2a:throttled', { tokens: queue.tokens });
      return false;
    }
    
    queue.tokens--;
    queue.size++;
    return true;
  }
  
  /**
   * Mark A2A message as processed
   */
  markA2AProcessed() {
    if (this.queues.a2a.size > 0) {
      this.queues.a2a.size--;
      this.stats.a2a.processed++;
    }
    
    const ratio = this.queues.a2a.size / this.config.a2aQueueMaxSize;
    if (ratio <= this.config.a2aLowWatermark && this.queues.a2a.paused) {
      this.queues.a2a.paused = false;
      this.emit('a2a:resumed', { size: this.queues.a2a.size, ratio });
    }
  }
  
  /**
   * Queue audit log entry
   */
  queueAuditEntry(entry) {
    const queue = this.queues.audit;
    
    // Update peak stats
    this.stats.audit.peakSize = Math.max(this.stats.audit.peakSize, queue.size);
    
    queue.pending.push(entry);
    queue.size++;
    
    // Check if we should flush
    if (queue.pending.length >= this.config.auditBatchSize ||
        Date.now() - queue.lastFlush >= this.config.auditFlushIntervalMs) {
      this.flushAuditBatch();
    }
    
    // Check for overflow
    if (queue.size >= this.config.auditQueueMaxSize) {
      // Drop oldest entries
      const toDrop = Math.floor(this.config.auditQueueMaxSize * 0.1); // Drop 10%
      queue.pending.splice(0, toDrop);
      queue.size -= toDrop;
      this.emit('audit:dropped', { count: toDrop });
    }
    
    return true;
  }
  
  /**
   * Flush audit log batch
   */
  async flushAuditBatch() {
    const queue = this.queues.audit;
    if (queue.pending.length === 0) return;
    
    const batch = queue.pending.splice(0, this.config.auditBatchSize);
    queue.size -= batch.length;
    queue.lastFlush = Date.now();
    
    this.emit('audit:flush', { count: batch.length, entries: batch });
    this.stats.audit.flushed++;
    this.stats.audit.batched += batch.length;
  }
  
  /**
   * Get current backpressure stats
   */
  getStats() {
    return {
      wal: {
        currentSize: this.queues.wal.size,
        paused: this.queues.wal.paused,
        capacity: this.config.walQueueMaxSize,
        utilization: (this.queues.wal.size / this.config.walQueueMaxSize).toFixed(2),
        ...this.stats.wal
      },
      a2a: {
        currentSize: this.queues.a2a.size,
        paused: this.queues.a2a.paused,
        tokens: this.queues.a2a.tokens.toFixed(1),
        capacity: this.config.a2aQueueMaxSize,
        utilization: (this.queues.a2a.size / this.config.a2aQueueMaxSize).toFixed(2),
        ...this.stats.a2a
      },
      audit: {
        currentSize: this.queues.audit.size,
        pendingBatches: this.queues.audit.pending.length,
        capacity: this.config.auditQueueMaxSize,
        utilization: (this.queues.audit.size / this.config.auditQueueMaxSize).toFixed(2),
        ...this.stats.audit
      }
    };
  }
  
  /**
   * Force flush all pending operations
   */
  async forceFlush() {
    await this.flushAuditBatch();
    this.emit('force:flushed');
  }
  
  /**
   * Shutdown backpressure controller
   */
  async shutdown() {
    this.running = false;
    
    if (this.tokenRefillInterval) {
      clearInterval(this.tokenRefillInterval);
      this.tokenRefillInterval = null;
    }
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    // Flush remaining audit entries
    await this.flushAuditBatch();
    
    console.log('[backpressure] Controller shutdown');
  }
}

/**
 * Singleton instance
 */
let globalController = null;

export function createBackpressureController(options = {}) {
  if (globalController) {
    globalController.shutdown();
  }
  globalController = new BackpressureController(options);
  globalController.initialize();
  return globalController;
}

export function getBackpressureController() {
  if (!globalController) {
    throw new Error('Backpressure controller not initialized');
  }
  return globalController;
}

export async function shutdownBackpressure() {
  if (globalController) {
    await globalController.shutdown();
    globalController = null;
  }
}

export default {
  BackpressureController,
  createBackpressureController,
  getBackpressureController,
  shutdownBackpressure
};
