/**
 * @module rotate-storage
 * @description Storage rotation for mesh-memory. Deletes stale markdown files
 * from memory directories according to configurable retention windows.
 *
 * Retention policy (defaults):
 *   memory/mesh/   — 30 days
 *   memory/lcm/    — 14 days
 *   memory/        — dream-cycle-*.md files older than 7 days
 *
 * Safe to run as a cron job. Logs everything it deletes, does nothing silently.
 * Dry-run mode available: set DRY_RUN=1 to preview without deleting.
 */

import { readdir, unlink, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const MEMORY_BASE = resolve(homedir(), ".openclaw/workspace/memory");

const RULES = [
  {
    dir: resolve(MEMORY_BASE, "mesh"),
    pattern: /^\d{4}-\d{2}-\d{2}\.md$/,
    maxAgeDays: 30,
    label: "mesh",
  },
  {
    dir: resolve(MEMORY_BASE, "lcm"),
    pattern: /^\d{4}-\d{2}-\d{2}\.md$/,
    maxAgeDays: 14,
    label: "lcm",
  },
  {
    dir: MEMORY_BASE,
    pattern: /^dream-cycle-\d{4}-\d{2}-\d{2}\.md$/,
    maxAgeDays: 7,
    label: "dream-cycle",
  },
];

const DRY_RUN = process.env.DRY_RUN === "1";

/**
 * Deletes files in a directory that match a pattern and exceed maxAgeDays.
 * @param {Object} rule - Rotation rule
 * @returns {Promise<{deleted: string[], errors: string[]}>}
 */
async function rotateDir(rule) {
  const { dir, pattern, maxAgeDays, label } = rule;
  const deleted = [];
  const errors = [];
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  let files;
  try {
    files = await readdir(dir);
  } catch {
    // Directory may not exist — skip silently
    return { deleted, errors };
  }

  for (const file of files) {
    if (!pattern.test(file)) continue;

    const filePath = join(dir, file);
    let mtime;
    try {
      const s = await stat(filePath);
      mtime = s.mtimeMs;
    } catch {
      continue;
    }

    if (mtime >= cutoffMs) continue;

    const ageDays = Math.floor((Date.now() - mtime) / (24 * 60 * 60 * 1000));
    if (DRY_RUN) {
      console.log(`[rotate] [DRY-RUN] Would delete [${label}] ${file} (${ageDays}d old)`);
      deleted.push(filePath);
    } else {
      try {
        await unlink(filePath);
        console.log(`[rotate] Deleted [${label}] ${file} (${ageDays}d old)`);
        deleted.push(filePath);
      } catch (err) {
        console.error(`[rotate] Failed to delete ${filePath}: ${err.message}`);
        errors.push(filePath);
      }
    }
  }

  return { deleted, errors };
}

async function main() {
  if (DRY_RUN) {
    console.log("[rotate] DRY-RUN mode — no files will be deleted");
  }
  console.log(`[rotate] Starting storage rotation (${new Date().toISOString()})`);

  let totalDeleted = 0;
  let totalErrors = 0;

  for (const rule of RULES) {
    const { deleted, errors } = await rotateDir(rule);
    totalDeleted += deleted.length;
    totalErrors += errors.length;
  }

  if (totalDeleted === 0) {
    console.log("[rotate] Nothing to delete — all files within retention window");
  } else {
    console.log(`[rotate] Done. ${totalDeleted} file(s) deleted, ${totalErrors} error(s).`);
  }

  if (totalErrors > 0) process.exit(1);
}

main();
