/**
 * @module connection-pool
 * @description SQLite Connection Pool for Concurrent Operations
 * 
 * Provides connection pooling to handle concurrent database access
 * without blocking the event loop.
 * 
 * @version 1.0.0
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { EventEmitter } from 'events';

/**
 * Connection Pool Configuration
 */
const DEFAULT_CONFIG = {
  minConnections: 2,
  maxConnections: 10,
  acquireTimeoutMs: 30000,
  idleTimeoutMs: 300000, // 5 minutes
  maxQueueSize: 100,
  connectionRetryDelayMs: 1000,
  connectionMaxRetries: 3
};

/**
 * SQLite Connection Pool
 */
export class ConnectionPool extends EventEmitter {
  constructor(dbPath, options = {}) {
    super();
    this.dbPath = dbPath;
    this.config = { ...DEFAULT_CONFIG, ...options };
    
    // Connection tracking
    this.connections = new Map(); // connectionId -> { connection, inUse, createdAt, lastUsed }
    this.available = []; // Array of available connection IDs
    this.waiting = []; // Queue of waiting promises
    
    // Stats
    this.stats = {
      totalCreated: 0,
      totalAcquired: 0,
      totalReleased: 0,
      totalTimedOut: 0,
      peakConnections: 0,
      currentQueueLength: 0
    };
    
    // State
    this.shuttingDown = false;
    this.idleCheckInterval = null;
  }
  
  /**
   * Initialize the pool
   */
  async initialize() {
    // Create minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      await this.createConnection();
    }
    
    // Start idle connection cleanup
    this.idleCheckInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // Check every minute
    
    console.log(`[connection-pool] Initialized with ${this.connections.size} connections`);
  }
  
  /**
   * Create a new database connection
   */
  async createConnection() {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const connection = new sqlite3.Database(this.dbPath);
    
    // Promisify methods
    connection.run = promisify(connection.run.bind(connection));
    connection.get = promisify(connection.get.bind(connection));
    connection.all = promisify(connection.all.bind(connection));
    
    // Enable WAL mode for better concurrency
    await connection.run('PRAGMA journal_mode = WAL');
    await connection.run('PRAGMA synchronous = NORMAL');
    await connection.run('PRAGMA cache_size = -64000'); // 64MB cache
    await connection.run('PRAGMA temp_store = MEMORY');
    
    this.connections.set(connectionId, {
      connection,
      inUse: false,
      createdAt: Date.now(),
      lastUsed: Date.now()
    });
    
    this.available.push(connectionId);
    this.stats.totalCreated++;
    this.stats.peakConnections = Math.max(this.stats.peakConnections, this.connections.size);
    
    return connectionId;
  }
  
  /**
   * Acquire a connection from the pool
   */
  async acquire() {
    if (this.shuttingDown) {
      throw new Error('Connection pool is shutting down');
    }
    
    // Try to get an available connection
    while (this.available.length > 0) {
      const connectionId = this.available.shift();
      const connData = this.connections.get(connectionId);
      
      if (connData) {
        connData.inUse = true;
        connData.lastUsed = Date.now();
        this.stats.totalAcquired++;
        return { connectionId, connection: connData.connection };
      }
    }
    
    // No available connections - create one if under max
    if (this.connections.size < this.config.maxConnections) {
      const connectionId = await this.createConnection();
      const connData = this.connections.get(connectionId);
      connData.inUse = true;
      connData.lastUsed = Date.now();
      this.stats.totalAcquired++;
      return { connectionId, connection: connData.connection };
    }
    
    // Max connections reached - wait for one to become available
    if (this.waiting.length >= this.config.maxQueueSize) {
      this.stats.totalTimedOut++;
      throw new Error('Connection pool queue is full');
    }
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waiting.findIndex(w => w.timeoutId === timeoutId);
        if (index > -1) {
          this.waiting.splice(index, 1);
          this.stats.totalTimedOut++;
          reject(new Error('Timeout waiting for database connection'));
        }
      }, this.config.acquireTimeoutMs);
      
      this.waiting.push({ resolve, reject, timeoutId, startTime: Date.now() });
      this.stats.currentQueueLength = this.waiting.length;
    });
  }
  
  /**
   * Release a connection back to the pool
   */
  async release(connectionId) {
    const connData = this.connections.get(connectionId);
    if (!connData) {
      return;
    }
    
    connData.inUse = false;
    connData.lastUsed = Date.now();
    this.stats.totalReleased++;
    
    // Check if anyone is waiting
    if (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      clearTimeout(waiter.timeoutId);
      this.stats.currentQueueLength = this.waiting.length;
      
      connData.inUse = true;
      connData.lastUsed = Date.now();
      this.stats.totalAcquired++;
      waiter.resolve({ connectionId, connection: connData.connection });
      return;
    }
    
    // Return to available pool
    this.available.push(connectionId);
  }
  
  /**
   * Execute a query with automatic connection management
   */
  async query(queryFn) {
    const { connectionId, connection } = await this.acquire();
    
    try {
      const result = await queryFn(connection);
      await this.release(connectionId);
      return result;
    } catch (error) {
      await this.release(connectionId);
      throw error;
    }
  }
  
  /**
   * Execute a transaction with automatic connection management
   */
  async transaction(txFn) {
    const { connectionId, connection } = await this.acquire();
    
    try {
      await connection.run('BEGIN IMMEDIATE');
      const result = await txFn(connection);
      await connection.run('COMMIT');
      await this.release(connectionId);
      return result;
    } catch (error) {
      try {
        await connection.run('ROLLBACK');
      } catch (rollbackError) {
        // Ignore rollback errors
      }
      await this.release(connectionId);
      throw error;
    }
  }
  
  /**
   * Cleanup idle connections above minimum
   */
  cleanupIdleConnections() {
    const now = Date.now();
    const toClose = [];
    
    for (const [connectionId, connData] of this.connections) {
      if (!connData.inUse && 
          this.connections.size > this.config.minConnections &&
          now - connData.lastUsed > this.config.idleTimeoutMs) {
        
        // Remove from available pool
        const index = this.available.indexOf(connectionId);
        if (index > -1) {
          this.available.splice(index, 1);
        }
        
        toClose.push(connectionId);
      }
    }
    
    for (const connectionId of toClose) {
      const connData = this.connections.get(connectionId);
      if (connData) {
        connData.connection.close();
        this.connections.delete(connectionId);
      }
    }
    
    if (toClose.length > 0) {
      console.log(`[connection-pool] Closed ${toClose.length} idle connections`);
    }
  }
  
  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalConnections: this.connections.size,
      availableConnections: this.available.length,
      inUseConnections: this.connections.size - this.available.length
    };
  }
  
  /**
   * Shutdown the pool
   */
  async shutdown() {
    this.shuttingDown = true;
    
    // Clear idle check interval
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    
    // Reject all waiting requests
    for (const waiter of this.waiting) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error('Connection pool is shutting down'));
    }
    this.waiting = [];
    
    // Wait for all connections to be released
    const waitStart = Date.now();
    while (Date.now() - waitStart < 10000) {
      const inUse = Array.from(this.connections.values()).filter(c => c.inUse).length;
      if (inUse === 0) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Close all connections
    for (const [connectionId, connData] of this.connections) {
      connData.connection.close();
    }
    this.connections.clear();
    this.available = [];
    
    console.log('[connection-pool] Shutdown complete');
  }
}

/**
 * Create a singleton pool instance
 */
let globalPool = null;

export async function createConnectionPool(dbPath, options = {}) {
  if (globalPool) {
    await globalPool.shutdown();
  }
  
  globalPool = new ConnectionPool(dbPath, options);
  await globalPool.initialize();
  return globalPool;
}

export function getConnectionPool() {
  if (!globalPool) {
    throw new Error('Connection pool not initialized');
  }
  return globalPool;
}

export async function closeConnectionPool() {
  if (globalPool) {
    await globalPool.shutdown();
    globalPool = null;
  }
}

export default {
  ConnectionPool,
  createConnectionPool,
  getConnectionPool,
  closeConnectionPool
};