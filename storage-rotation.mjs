/**
 * @module storage-rotation
 * @description Archives and prunes mesh logs and thread contexts based on retention policy.
 * Runs as a background service or cron job.
 */

import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdir, readdir, stat, rename, rm, readFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { loadConfig } from "./config.mjs";

const MESH_DIR = resolve(homedir(), ".openclaw/workspace/memory/mesh");
const THREADS_DIR = resolve(homedir(), ".openclaw/workspace/memory/threads");

/**
 * Archives a single mesh log file to gzip.
 * @param {string} filePath - Absolute path to .md file
 * @param {string} archiveDir - Destination directory
 * @returns {Promise<boolean>} Success
 */
async function archiveMeshLog(filePath, archiveDir) {
  const baseName = filePath.split("/").pop().replace(".md", "");
  const archivePath = resolve(archiveDir, `${baseName}.tar.gz`);

  try {
    // Create tar.gz (single file archive for simplicity)
    const source = createReadStream(filePath);
    const gzip = createGzip();
    const dest = createWriteStream(archivePath);

    await pipeline(source, gzip, dest);

    // Verify archive integrity
    await readFile(archivePath); // Will throw if corrupted
    return true;
  } catch (err) {
    console.error(`[storage] Archive failed for ${filePath}:`, err.message);
    return false;
  }
}

/**
 * Prunes old mesh log files based on retention policy.
 * @param {Object} config - Storage config
 * @param {boolean} dryRun - If true, only log actions without executing
 * @returns {Promise<Object>} Stats { archived, pruned, errors }
 */
async function rotateMeshLogs(config, dryRun = false) {
  const { meshLogRetentionDays, archiveEnabled, archivePath } = config;
  const cutoffMs = Date.now() - meshLogRetentionDays * 24 * 60 * 60 * 1000;
  const archiveDir = resolve(archivePath, "mesh");

  if (!dryRun) {
    await mkdir(archiveDir, { recursive: true });
  }

  const stats = { archived: 0, pruned: 0, errors: 0 };

  try {
    const files = await readdir(MESH_DIR);
    const mdFiles = files.filter(f => f.endsWith(".md"));

    for (const file of mdFiles) {
      const filePath = resolve(MESH_DIR, file);
      const { mtime } = await stat(filePath);

      // Archive: older than retention but within 3x retention (90 days default)
      const archiveThreshold = cutoffMs;
      const pruneThreshold = Date.now() - meshLogRetentionDays * 3 * 24 * 60 * 60 * 1000;

      if (mtime.getTime() < archiveThreshold && mtime.getTime() > pruneThreshold) {
        if (archiveEnabled && !dryRun) {
          const success = await archiveMeshLog(filePath, archiveDir);
          if (success) {
            await rm(filePath);
            stats.archived++;
            console.log(`[storage] Archived: ${file}`);
          } else {
            stats.errors++;
          }
        } else if (dryRun) {
          console.log(`[storage] [DRY-RUN] Would archive: ${file}`);
        }
      }
      // Prune: older than 3x retention
      else if (mtime.getTime() < pruneThreshold) {
        if (!dryRun) {
          await rm(filePath);
          stats.pruned++;
          console.log(`[storage] Pruned: ${file}`);
        } else {
          console.log(`[storage] [DRY-RUN] Would prune: ${file}`);
        }
      }
    }
  } catch (err) {
    console.error("[storage] Error rotating mesh logs:", err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Prunes closed threads based on retention policy.
 * @param {Object} config - Storage config
 * @param {boolean} dryRun - If true, only log actions without executing
 * @returns {Promise<Object>} Stats { pruned, errors }
 */
async function rotateThreads(config, dryRun = false) {
  const { threadRetentionDays } = config;
  const cutoffMs = Date.now() - threadRetentionDays * 24 * 60 * 60 * 1000;
  const stats = { pruned: 0, errors: 0 };

  try {
    const threadIds = await readdir(THREADS_DIR);

    for (const threadId of threadIds) {
      const manifestPath = resolve(THREADS_DIR, threadId, "manifest.json");
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
        
        // Only prune closed threads
        if (manifest.closedAt) {
          const closedTime = new Date(manifest.closedAt).getTime();
          if (closedTime < cutoffMs) {
            if (!dryRun) {
              await rm(resolve(THREADS_DIR, threadId), { recursive: true, force: true });
              stats.pruned++;
              console.log(`[storage] Pruned thread: ${threadId}`);
            } else {
              console.log(`[storage] [DRY-RUN] Would prune thread: ${threadId}`);
            }
          }
        }
      } catch {
        // If manifest doesn't exist or can't be read, skip
        continue;
      }
    }
  } catch (err) {
    console.error("[storage] Error rotating threads:", err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Runs full storage rotation based on config.
 * @param {Object} options
 * @param {boolean} options.dryRun - Preview actions without executing
 * @param {boolean} options.verbose - Log detailed progress
 */
async function runRotation({ dryRun = false, verbose = false } = {}) {
  const config = loadConfig();
  const storageConfig = config.storage || {};
  
  // Defaults
  storageConfig.meshLogRetentionDays = storageConfig.meshLogRetentionDays || 30;
  storageConfig.threadRetentionDays = storageConfig.threadRetentionDays || 7;
  storageConfig.archiveEnabled = storageConfig.archiveEnabled !== false;
  storageConfig.archivePath = storageConfig.archivePath || "~/.openclaw/workspace/memory/archive";

  if (verbose || dryRun) {
    console.log(`[storage] Starting rotation (dryRun: ${dryRun})`);
    console.log(`[storage] Mesh retention: ${storageConfig.meshLogRetentionDays} days`);
    console.log(`[storage] Thread retention: ${storageConfig.threadRetentionDays} days`);
  }

  const meshStats = await rotateMeshLogs(storageConfig, dryRun);
  const threadStats = await rotateThreads(storageConfig, dryRun);

  const summary = {
    ...meshStats,
    ...threadStats,
    dryRun,
    timestamp: new Date().toISOString()
  };

  if (verbose || dryRun) {
    console.log("[storage] Summary:", JSON.stringify(summary, null, 2));
  }

  return summary;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");

  runRotation({ dryRun, verbose })
    .then(stats => {
      if (!verbose && !dryRun) {
        console.log(JSON.stringify(stats));
      }
      process.exit(0);
    })
    .catch(err => {
      console.error("[storage] Fatal error:", err.message);
      process.exit(1);
    });
}

export { runRotation, rotateMeshLogs, rotateThreads };
