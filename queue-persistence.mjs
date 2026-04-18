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
 * Append entry to WAL
 * @param {Object} entry - WAL entry
 */
async function appendToWal(entry) {
  if (!currentWalFile || walFd === null) {
    await rotateWalFile();
  }
  
  const line = JSON.stringify(entry) + '\n';
  // Use synchronous write for durability
  writeSync(walFd, line);
}

/**
 * Ensure WAL is fsynced to disk
 * FIXED: Uses fs.fsyncSync for actual durability
 */
async function fsyncWal() {
  if (walFd !== null) {
    fsyncSync(walFd);
    return true;
  }
  return false;
}

// WAL rotation state
let isRotating = false;
let rotationQueue = [];

/**
 * Rotate to a new WAL file
 * FIXED: Uses openSync for durability
 */
async function rotateWalFile() {
  if (isRotating) {
    // Queue this rotation request
    return new Promise((resolve, reject) => {
      rotationQueue.push({ resolve, reject });
    });
  }
  
  isRotating = true;
  
  try {
    // Close current WAL file descriptor
    if (walFd !== null) {
      fsyncSync(walFd);
      closeSync(walFd);
      walFd = null;
    }
    
    // Close stream if it exists (backwards compat)
    if (walWriteStream) {
      await new Promise((resolve, reject) => {
        walWriteStream.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      walWriteStream = null;
    }
    
    // Generate new WAL file name
    const walFiles = await getWalFiles();
    const nextNumber = walFiles.length > 0 
      ? parseInt(walFiles[walFiles.length - 1].split('.')[0]) + 1 
      : 1;
    
    currentWalFile = `${String(nextNumber).padStart(6, '0')}.log`;
    const walPath = join(WAL_DIR, currentWalFile);
    
    // Open file descriptor synchronously for durability
    walFd = openSync(walPath, 'a');
    
    console.log(`[queue-persistence] Rotated to new WAL file: ${currentWalFile}`);
    
    // Process any queued rotation requests
    isRotating = false;
    if (rotationQueue.length > 0) {
      const nextRequest = rotationQueue.shift();
      try {
        await rotateWalFile();
        nextRequest.resolve();
      } catch (error) {
        nextRequest.reject(error);
      }
    }
  } catch (error) {
    isRotating = false;
    // Reject all queued requests
    while (rotationQueue.length > 0) {
      const request = rotationQueue.shift();
      request.reject(error);
    }
    throw error;
  }
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
 * FIXED: Properly fsync and close file descriptor
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
    
    // Close WAL file descriptor with fsync
    if (walFd !== null) {
      fsyncSync(walFd);
      closeSync(walFd);
      walFd = null;
    }
    
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
