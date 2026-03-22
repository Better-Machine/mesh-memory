/**
 * @module memory-bridge
 * @description Exports LCM summaries from SQLite into QMD-searchable markdown.
 * Runs on a configurable interval, tracking its cursor position between runs.
 */

import Database from "better-sqlite3";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";

const LCM_DB_PATH = resolve(homedir(), ".openclaw/lcm.db");
const LCM_DIR = resolve(homedir(), ".openclaw/workspace/memory/lcm");
const CURSOR_PATH = resolve(homedir(), ".openclaw/mesh-memory-cursor.json");

/**
 * Reads the last export cursor (timestamp string).
 * @returns {Promise<string>} ISO timestamp of last export, or epoch if none
 */
async function readCursor() {
  try {
    const data = await readFile(CURSOR_PATH, "utf-8");
    const cursor = JSON.parse(data);
    return cursor.lastExport || "1970-01-01T00:00:00.000Z";
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

/**
 * Writes the export cursor.
 * @param {string} timestamp - ISO timestamp to save
 */
async function writeCursor(timestamp) {
  await writeFile(
    CURSOR_PATH,
    JSON.stringify({ lastExport: timestamp }, null, 2),
    "utf-8"
  );
}

/**
 * Formats a summary row as a markdown entry.
 * @param {Object} row - Database row with timestamp and summary fields
 * @returns {string} Formatted markdown
 */
function formatSummary(row) {
  const ts = row.timestamp || row.created_at || new Date().toISOString();
  const date = new Date(ts);
  const time = date.toTimeString().slice(0, 8);
  return `## [${time}] Summary\n${row.summary || row.content}\n\n`;
}

/**
 * Returns the markdown file path for a given date.
 * @param {Date} date
 * @returns {string} Absolute file path
 */
function getFilePath(date) {
  const dateStr = date.toISOString().slice(0, 10);
  return resolve(LCM_DIR, `${dateStr}.md`);
}

/**
 * Runs a single bridge export cycle.
 * @returns {Promise<number>} Number of summaries exported
 */
async function exportCycle() {
  await mkdir(LCM_DIR, { recursive: true });

  let db;
  try {
    db = new Database(LCM_DB_PATH, { readonly: true });
  } catch (err) {
    console.error("[bridge] Cannot open LCM database:", err.message);
    return 0;
  }

  try {
    const cursor = await readCursor();

    // Try common table/column names for LCM summaries
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name);

    let rows = [];
    const timestampCol = "timestamp";

    for (const table of ["summaries", "summary", "lcm_summaries", "entries"]) {
      if (!tables.includes(table)) continue;
      try {
        const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
        const tsCol = cols.includes("timestamp")
          ? "timestamp"
          : cols.includes("created_at")
            ? "created_at"
            : null;
        const contentCol = cols.includes("summary")
          ? "summary"
          : cols.includes("content")
            ? "content"
            : null;

        if (!tsCol || !contentCol) continue;

        rows = db
          .prepare(
            `SELECT ${tsCol} as timestamp, ${contentCol} as summary FROM ${table} WHERE ${tsCol} > ? ORDER BY ${tsCol} ASC`
          )
          .all(cursor);
        if (rows.length > 0) break;
      } catch {
        continue;
      }
    }

    if (rows.length === 0) {
      return 0;
    }

    let latestTimestamp = cursor;
    for (const row of rows) {
      const ts = row.timestamp;
      const date = new Date(ts);
      const filePath = getFilePath(date);
      await appendFile(filePath, formatSummary(row), "utf-8");
      if (ts > latestTimestamp) latestTimestamp = ts;
    }

    await writeCursor(latestTimestamp);
    console.log(`[bridge] Exported ${rows.length} summaries (cursor: ${latestTimestamp})`);
    return rows.length;
  } finally {
    db.close();
  }
}

/**
 * Starts the bridge daemon with interval-based polling.
 */
async function main() {
  const config = loadConfig();
  const interval = (config.bridgeInterval || 60) * 1000;

  console.log(`[bridge] Agent: ${config.agentId}`);
  console.log(`[bridge] LCM DB: ${LCM_DB_PATH}`);
  console.log(`[bridge] Export interval: ${config.bridgeInterval}s`);

  // Run once immediately
  const count = await exportCycle();
  console.log(`[bridge] Initial export: ${count} summaries`);

  // L5: Store interval ref so it can be cleared on shutdown
  const intervalId = setInterval(async () => {
    try {
      await exportCycle();
    } catch (err) {
      console.error("[bridge] Export cycle error:", err.message);
    }
  }, interval);

  process.on("SIGINT", () => {
    console.log("\n[bridge] Shutting down...");
    clearInterval(intervalId);
    process.exit(0);
  });
}

main();
