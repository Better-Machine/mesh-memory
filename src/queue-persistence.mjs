/**
 * @module queue-persistence
 * @description Disk-backed queue persistence with WAL, snapshots, and SQLite index
 * Provides zero data loss across crash/restart for memory-relay.mjs
 */

import { promises as fs } from 'fs';
import { openSync, writeSync, fsyncSync, closeSync } from 'fs';
import { join, basename, resolve } from 'path';
import { createHash } from 'crypto';
import { loadConfig } from './config.mjs';

// Config will be loaded on initialization
let config = null;

// SQLite will be dynamically imported to avoid startup overhead
let db = null;
let dbPath = null;

// Configurable paths (set during initialization)
let WAL_DIR = 'memory/queue/wal';
let SNAPSHOT_DIR = 'memory/queue/snapshots';
let INDEX_DB = 'memory/queue/index.db';
let WAL_MAX_SIZE_MB = 10;
let SNAPSHOT_INTERVAL_HOURS = 24;
let RETENTION_DAYS = 7;
let QUEUE_PERSISTENCE_ENABLED = true;

// Queue state
const pendingQueues = new Map();
let currentWalFile = null;
let walFd = null;  // File descriptor for synchronous fsync
let walWriteStream = null;
let walRotationTimer = null;
let snapshotTimer = null;

// WAL Write Queue - Phase 3 fix for race condition
class WALWriter {
  constructor() {
    this.fd = null;
    this.currentFile = null;
    this.queue = [];
    this.processing = false;
    this.pendingRotation = false;
    this.walSize = 0;
    this.shutdownRequested = false;  // P3: Track shutdown state
    this.shutdownPromise = null;       // P3: Prevent multiple shutdowns
  }

  async write(entry) {
    // P3: Reject writes after shutdown is requested
    if (this.shutdownRequested) {
      return Promise.reject(new Error('WALWriter is shutting down'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ entry, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const { entry, resolve, reject } = this.queue.shift();

      try {
        // Check rotation inside the queue (serialized) - P1 fix
        if (this.pendingRotation || !this.currentFile || this.needsRotation()) {
          await this.rotate();
        }

        // P3: Add checksum for corruption detection
        const checksum = this.calculateChecksum(entry);
        const entryWithChecksum = { ...entry, _cs: checksum };

        const line = JSON.stringify(entryWithChecksum) + '\n';
        const buffer = Buffer.from(line);
        writeSync(this.fd, buffer);
        
        // P2: Use fdatasyncSync for performance (data only, no metadata)
        const { fdatasyncSync } = await import('fs');
        fdatasyncSync(this.fd);
        
        this.walSize += buffer.length;
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    this.processing = false;
  }

  needsRotation() {
    return this.walSize > WAL_MAX_SIZE_MB * 1024 * 1024;
  }

  /**
   * P3: Calculate SHA-256 checksum for WAL entry
   * @param {Object} entry
   * @returns {string} First 8 chars of SHA-256 hex
   */
  calculateChecksum(entry) {
    const { createHash } = require('crypto');
    const data = JSON.stringify(entry);
    return createHash('sha256').update(data).digest('hex').slice(0, 8);
  }

  async rotate() {
    // Close current file descriptor
    if (this.fd !== null) {
      const { fdatasyncSync, closeSync } = await import('fs');
      fdatasyncSync(this.fd);
      closeSync(this.fd);
      this.fd = null;
    }

    // Generate new WAL file name
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    
    const walFiles = await getWalFiles();
    const nextNumber = walFiles.length > 0 
      ? parseInt(walFiles[walFiles.length - 1].split('.')[0]) + 1 
      : 1;
    
    this.currentFile = `${String(nextNumber).padStart(6, '0')}.log`;
    const walPath = join(WAL_DIR, this.currentFile);
    
    // Open new file descriptor
    const { openSync } = await import('fs');
    this.fd = openSync(walPath, 'a');
    this.walSize = 0;
    this.pendingRotation = false;
    
    // Update global references for backwards compatibility
    currentWalFile = this.currentFile;
    walFd = this.fd;
    
    console.log(`[queue-persistence] Rotated to new WAL file: ${this.currentFile}`);
  }

  async shutdown() {
    // P3: Prevent multiple concurrent shutdowns
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this._doShutdown();
    return this.shutdownPromise;
  }

  async _doShutdown() {
    // P3: Mark as shutting down to reject new writes
    this.shutdownRequested = true;

    // P3: Wait for queue to drain - check both queue length AND processing state
    while (this.queue.length > 0 || this.processing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // P3: Final safety check - ensure processing is truly done
    await new Promise(resolve => setTimeout(resolve, 50));

    // P3: Only close if fd is valid
    if (this.fd !== null) {
      try {
        const { fdatasyncSync, closeSync } = await import('fs');
        fdatasyncSync(this.fd);
        closeSync(this.fd);
      } catch (err) {
        // fd may already be closed, that's ok
        if (err.code !== 'EBADF') {
          throw err;
        }
      }
      this.fd = null;
    }

    // P3: Reset shutdown state for potential restart
    this.shutdownRequested = false;
    this.shutdownPromise = null;
  }
}

// Global WAL writer instance
const walWriter = new WALWriter();

/**
 * Initialize the queue persistence system
 * @returns {Promise<Map<string, any[]>>} Reconstructed queue state
 */
export async function initializeQueuePersistence() {
  try {
    // Load config
    config = loadConfig();
    
    // Check if persistence is enabled
    QUEUE_PERSISTENCE_ENABLED = config.queue?.persistenceEnabled ?? true;
    if (!QUEUE_PERSISTENCE_ENABLED) {
      console.log('[queue-persistence] Persistence disabled, using in-memory mode');
      return pendingQueues;
    }
    
    // Configure paths from config
    const queueDir = config.queue?.queueDir ?? 'memory/queue';
    WAL_DIR = join(queueDir, 'wal');
    SNAPSHOT_DIR = join(queueDir, 'snapshots');
    INDEX_DB = config.queue?.indexDbPath ?? join(queueDir, 'index.db');
    
    // Configure retention from config
    WAL_MAX_SIZE_MB = config.queue?.walMaxSizeMB ?? 10;
    SNAPSHOT_INTERVAL_HOURS = config.queue?.snapshotIntervalHours ?? 24;
    RETENTION_DAYS = config.queue?.retentionDays ?? 7;
    
    // Ensure directories exist
    await fs.mkdir(WAL_DIR, { recursive: true });
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
    
    // Initialize SQLite database
    const sqlite3 = await import('sqlite3');
    const { open } = await import('sqlite');
    
    dbPath = INDEX_DB;
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Create queue index table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS queue_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peerName TEXT NOT NULL,
        eventId TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        eventData TEXT NOT NULL,
        walFile TEXT,
        walOffset INTEGER,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes for fast lookups
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_peer_status ON queue_entries(peerName, status)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_event_id ON queue_entries(eventId)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_timestamp ON queue_entries(timestamp)`);
    
    // Load and reconstruct queue state
    const reconstructedState = await reconstructQueueState();
    
    // Start background WAL rotation
    startWalRotation();
    
    console.log(`[queue-persistence] Initialized (WAL max: ${WAL_MAX_SIZE_MB}MB, snapshot: ${SNAPSHOT_INTERVAL_HOURS}h, retention: ${RETENTION_DAYS}d)`);
    return reconstructedState;
    
  } catch (error) {
    console.error('[queue-persistence] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Reconstruct queue state from latest snapshot and WAL
 * @returns {Promise<Map<string, any[]>>} Reconstructed queue state
 */
async function reconstructQueueState() {
  const state = new Map();
  
  try {
    // 1. Load latest snapshot
    const snapshot = await loadLatestSnapshot();
    if (snapshot) {
      console.log(`[queue-persistence] Loaded snapshot from ${snapshot.timestamp}`);
      for (const [peerName, events] of Object.entries(snapshot.queues)) {
        state.set(peerName, events);
      }
    }
    
    // 2. Replay WAL entries after snapshot
    const walEntries = await replayWalAfterSnapshot(snapshot?.timestamp);
    console.log(`[queue-persistence] Replayed ${walEntries.length} WAL entries`);
    
    // 3. Apply WAL entries to state
    for (const entry of walEntries) {
      if (!state.has(entry.peerName)) {
        state.set(entry.peerName, []);
      }
      state.get(entry.peerName).push(entry.event);
    }
    
    // 4. Sync SQLite index with reconstructed state
    await syncIndexWithState(state);
    
  } catch (error) {
    console.error('[queue-persistence] Failed to reconstruct state:', error);
  }
  
  return state;
}

/**
 * Load the latest snapshot
 * @returns {Promise<Object|null>} Snapshot object or null
 */
async function loadLatestSnapshot() {
  try {
    const files = await fs.readdir(SNAPSHOT_DIR);
    const snapshotFiles = files
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (snapshotFiles.length === 0) {
      return null;
    }
    
    const latestSnapshotFile = snapshotFiles[0];
    const snapshotPath = join(SNAPSHOT_DIR, latestSnapshotFile);
    const snapshotData = await fs.readFile(snapshotPath, 'utf8');
    
    return JSON.parse(snapshotData);
  } catch (error) {
    console.error('[queue-persistence] Failed to load snapshot:', error);
    return null;
  }
}

/**
 * Replay WAL entries after given timestamp
 * @param {string} afterTimestamp - ISO timestamp to replay after
 * @returns {Promise<Array>} Array of WAL entries
 */
async function replayWalAfterSnapshot(afterTimestamp) {
  const entries = [];
  
  try {
    const walFiles = await getWalFiles();
    
    for (const walFile of walFiles) {
      const walPath = join(WAL_DIR, walFile);
      const content = await fs.readFile(walPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          // P3: Validate checksum if present
          if (entry._cs) {
            const { createHash } = await import('crypto');
            const { _cs, ...entryWithoutChecksum } = entry;
            const expectedCs = createHash('sha256')
              .update(JSON.stringify(entryWithoutChecksum))
              .digest('hex')
              .slice(0, 8);
            
            if (_cs !== expectedCs) {
              console.warn(`[queue-persistence] Checksum mismatch, entry may be corrupted: ${line.slice(0, 100)}`);
              continue; // Skip corrupted entry
            }
          }
          
          if (!afterTimestamp || new Date(entry.timestamp) > new Date(afterTimestamp)) {
            entries.push(entry);
          }
        } catch (parseError) {
          console.warn('[queue-persistence] Skipping malformed WAL entry:', parseError);
        }
      }
    }
  } catch (error) {
    console.error('[queue-persistence] Failed to replay WAL:', error);
  }
  
  return entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Get sorted list of WAL files
 * @returns {Promise<string[]>} Sorted WAL file names
 */
async function getWalFiles() {
  try {
    const files = await fs.readdir(WAL_DIR);
    return files
      .filter(f => f.endsWith('.log'))
      .sort((a, b) => {
        const numA = parseInt(a.split('.')[0]);
        const numB = parseInt(b.split('.')[0]);
        return numA - numB;
      });
  } catch (error) {
    console.error('[queue-persistence] Failed to list WAL files:', error);
    return [];
  }
}

/**
 * Sync SQLite index with reconstructed state
 * @param {Map<string, any[]>} state - Reconstructed queue state
 */
async function syncIndexWithState(state) {
  if (!db) return;
  
  try {
    // Clear existing pending entries
    await db.run("DELETE FROM queue_entries WHERE status = 'pending'");
    
    // Insert pending events from state
    for (const [peerName, events] of state) {
      for (const event of events) {
        const eventId = generateEventId(event);
        const exists = await db.get(
          'SELECT id FROM queue_entries WHERE eventId = ?',
          [eventId]
        );
        
        if (!exists) {
          await db.run(
            `INSERT INTO queue_entries (peerName, eventId, timestamp, status, eventData) 
             VALUES (?, ?, ?, 'pending', ?)`,
            [peerName, eventId, event.timestamp, JSON.stringify(event)]
          );
        }
      }
    }
  } catch (error) {
    console.error('[queue-persistence] Failed to sync index:', error);
  }
}

/**
 * Persist an event to the queue
 * @param {string} peerName - Target peer name
 * @param {Object} event - Event to persist
 * @returns {Promise<boolean>} Success status
 */
export async function persistEvent(peerName, event) {
  // Skip persistence if disabled
  if (!QUEUE_PERSISTENCE_ENABLED) {
    return true;
  }
  
  try {
    const timestamp = new Date().toISOString();
    const eventId = generateEventId(event);
    
    // 1. Append to WAL (fast, sequential write)
    const walEntry = {
      peerName,
      eventId,
      timestamp,
      event
    };
    
    await appendToWal(walEntry);
    
    // 2. WAL fsync() - ensure data is durable
    await fsyncWal();
    
    // 3. Insert into SQLite index (background)
    if (db) {
      await db.run(
        `INSERT INTO queue_entries (peerName, eventId, timestamp, status, eventData) 
         VALUES (?, ?, ?, 'pending', ?)`,
        [peerName, eventId, timestamp, JSON.stringify(event)]
      );
    }
    
    return true;
  } catch (error) {
    console.error('[queue-persistence] Failed to persist event:', error);
    return false;
  }
}

/**
 * Append entry to WAL (P1: Now uses write queue for thread safety)
 * @param {Object} entry - WAL entry
 */
async function appendToWal(entry) {
  // P3: Use write queue instead of direct write
  await walWriter.write(entry);
}

/**
 * Ensure WAL is fsynced to disk
 * FIXED: Now handled by write queue (fdatasyncSync for performance)
 * Kept for backwards compatibility
 */
async function fsyncWal() {
  // P2: fsync now happens inside write queue with fdatasyncSync
  // This function kept for API compatibility
  return true;
}

// WAL rotation state - DEPRECATED: Now handled by WALWriter class
let isRotating = false;
let rotationQueue = [];

/**
 * Rotate to a new WAL file
 * DEPRECATED: Now handled by WALWriter.rotate()
 * Kept for backwards compatibility with external callers
 */
async function rotateWalFile() {
  // P1: Delegate to WALWriter
  walWriter.pendingRotation = true;
  await walWriter.rotate();
}

/**
 * Start background WAL rotation timer
 */
function startWalRotation() {
  // Rotate WAL every 10 minutes or when size exceeds limit
  walRotationTimer = setInterval(async () => {
    try {
      const walFiles = await getWalFiles();
      if (walFiles.length > 0) {
        const currentWalPath = join(WAL_DIR, walFiles[walFiles.length - 1]);
        const stats = await fs.stat(currentWalPath);
        // Use configured max size
        if (stats.size > WAL_MAX_SIZE_MB * 1024 * 1024) {
          await rotateWalFile();
        }
      }
    } catch (error) {
      console.error('[queue-persistence] WAL rotation check failed:', error);
    }
  }, 10 * 60 * 1000); // Check every 10 minutes
  
  // Start snapshot creation timer (using configured interval)
  snapshotTimer = setInterval(async () => {
    try {
      await createSnapshot();
    } catch (error) {
      console.error('[queue-persistence] Snapshot creation failed:', error);
    }
  }, SNAPSHOT_INTERVAL_HOURS * 60 * 60 * 1000);
}

/**
 * Create a snapshot of current queue state
 */
async function createSnapshot() {
  try {
    const timestamp = new Date().toISOString();
    const snapshot = {
      timestamp,
      queues: {}
    };
    
    // Get current queue state from SQLite
    if (db) {
      const rows = await db.all(
        "SELECT peerName, eventData FROM queue_entries WHERE status = 'pending' ORDER BY timestamp"
      );
      
      for (const row of rows) {
        if (!snapshot.queues[row.peerName]) {
          snapshot.queues[row.peerName] = [];
        }
        snapshot.queues[row.peerName].push(JSON.parse(row.eventData));
      }
    }
    
    // Write snapshot file
    const snapshotFile = `snapshot-${timestamp.replace(/[:.]/g, '-')}.json`;
    const snapshotPath = join(SNAPSHOT_DIR, snapshotFile);
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
    
    console.log(`[queue-persistence] Created snapshot: ${snapshotFile}`);
    
    // Clean up old snapshots (keep last 30 days)
    await cleanupOldSnapshots();
    
    // Clean up old WAL files (keep last 7 days)
    await cleanupOldWalFiles();
    
  } catch (error) {
    console.error('[queue-persistence] Failed to create snapshot:', error);
  }
}

/**
 * Clean up old snapshots (keep last 30 days)
 */
async function cleanupOldSnapshots() {
  try {
    const files = await fs.readdir(SNAPSHOT_DIR);
    const snapshotFiles = files
      .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    // Keep last 30 snapshots (one per day = 30 days)
    const filesToDelete = snapshotFiles.slice(30);
    
    for (const file of filesToDelete) {
      const filePath = join(SNAPSHOT_DIR, file);
      await fs.unlink(filePath);
      console.log(`[queue-persistence] Deleted old snapshot: ${file}`);
    }
  } catch (error) {
    console.error('[queue-persistence] Failed to cleanup old snapshots:', error);
  }
}

/**
 * Clean up old WAL files (keep last RETENTION_DAYS worth)
 */
async function cleanupOldWalFiles() {
  try {
    const walFiles = await getWalFiles();
    
    // Keep last RETENTION_DAYS WAL files (assuming rotation every ~10MB or 10 minutes)
    const filesToDelete = walFiles.slice(0, -RETENTION_DAYS);
    
    for (const file of filesToDelete) {
      const filePath = join(WAL_DIR, file);
      await fs.unlink(filePath);
      console.log(`[queue-persistence] Deleted old WAL file: ${file}`);
    }
  } catch (error) {
    console.error('[queue-persistence] Failed to cleanup old WAL files:', error);
  }
}

/**
 * Generate unique event ID
 * @param {Object} event - Event object
 * @returns {string} Event ID hash
 */
function generateEventId(event) {
  const content = `${event.timestamp}-${event.role}-${event.content}`;
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Mark event as sent in the index
 * @param {string} eventId - Event ID
 * @returns {Promise<boolean>} Success status
 */
export async function markEventAsSent(eventId) {
  if (!db) return false;
  
  try {
    await db.run(
      "UPDATE queue_entries SET status = 'sent', updatedAt = CURRENT_TIMESTAMP WHERE eventId = ?",
      [eventId]
    );
    return true;
  } catch (error) {
    console.error('[queue-persistence] Failed to mark event as sent:', error);
    return false;
  }
}

/**
 * Mark event as failed in the index
 * @param {string} eventId - Event ID
 * @returns {Promise<boolean>} Success status
 */
export async function markEventAsFailed(eventId) {
  if (!db) return false;
  
  try {
    await db.run(
      "UPDATE queue_entries SET status = 'failed', updatedAt = CURRENT_TIMESTAMP WHERE eventId = ?",
      [eventId]
    );
    return true;
  } catch (error) {
    console.error('[queue-persistence] Failed to mark event as failed:', error);
    return false;
  }
}

/**
 * Get queue statistics
 * @returns {Promise<Object>} Queue statistics
 */
export async function getQueueStats() {
  if (!db) return { pending: 0, sent: 0, failed: 0 };
  
  try {
    const stats = await db.all(`
      SELECT status, COUNT(*) as count 
      FROM queue_entries 
      GROUP BY status
    `);
    
    const result = { pending: 0, sent: 0, failed: 0 };
    for (const row of stats) {
      result[row.status] = row.count;
    }
    
    return result;
  } catch (error) {
    console.error('[queue-persistence] Failed to get queue stats:', error);
    return { pending: 0, sent: 0, failed: 0 };
  }
}

/**
 * Gracefully shutdown queue persistence
 * FIXED: Properly drain write queue and shutdown WALWriter
 */
export async function shutdownQueuePersistence() {
  try {
    // Stop background timers
    if (walRotationTimer) {
      clearInterval(walRotationTimer);
      walRotationTimer = null;
    }
    if (snapshotTimer) {
      clearInterval(snapshotTimer);
      snapshotTimer = null;
    }
    
    // P1: Shutdown WAL writer (drains queue, fsyncs, closes)
    await walWriter.shutdown();
    
    // Close stream if it exists (backwards compat)
    if (walWriteStream) {
      await new Promise((resolve) => {
        walWriteStream.end(resolve);
      });
      walWriteStream = null;
    }
    
    // Close database
    if (db) {
      await db.close();
      db = null;
    }
    
    console.log('[queue-persistence] Shutdown complete');
  } catch (error) {
    console.error('[queue-persistence] Error during shutdown:', error);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await shutdownQueuePersistence();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdownQueuePersistence();
  process.exit(0);
});
