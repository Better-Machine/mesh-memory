/**
 * @module memory-watcher
 * @description Watches session JSONL files for new messages and emits MemoryEvents.
 * Uses chokidar for reliable cross-platform file watching.
 */

import { watch } from "chokidar";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { relayEvent } from "./memory-relay.mjs";
import { loadConfig } from "./config.mjs";

/**
 * @typedef {Object} MemoryEvent
 * @property {string} agentId - Source agent identifier
 * @property {string} sessionKey - Session file identifier
 * @property {string} role - Message role (user or assistant)
 * @property {string} content - Text content of the message
 * @property {string} timestamp - ISO 8601 timestamp
 */

/** @type {Map<string, number>} Tracks byte offset per file for delta reads */
const fileOffsets = new Map();

/**
 * Reads new lines appended to a JSONL file since last read.
 * @param {string} filePath - Absolute path to the JSONL file
 * @returns {Promise<string[]>} Array of new JSON lines
 */
async function readDelta(filePath) {
  const offset = fileOffsets.get(filePath) || 0;
  const fileStat = await stat(filePath);
  if (fileStat.size <= offset) return [];

  const buf = await readFile(filePath);
  const delta = buf.subarray(offset).toString("utf-8");
  fileOffsets.set(filePath, fileStat.size);

  return delta.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * Parses a JSONL line into a MemoryEvent if it passes filters.
 * @param {string} line - Raw JSON line
 * @param {string} sessionKey - Session identifier
 * @param {Object} config - Config object
 * @returns {MemoryEvent|null} Parsed event or null if filtered out
 */
function parseMessage(line, sessionKey, config) {
  try {
    const msg = JSON.parse(line);
    const role = msg.role;

    if (!role || config.filter.skipRoles.includes(role)) return null;

    // Extract text content — handle both string and array content formats
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }

    if (!content || content.length < config.filter.minContentLength) return null;

    return {
      agentId: config.agentId,
      sessionKey,
      role,
      content,
      timestamp: msg.timestamp || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Handles a file change event — reads delta, parses, and relays.
 * @param {string} filePath - Path to the changed file
 * @param {Object} config - Config object
 */
async function handleFileChange(filePath, config) {
  const sessionKey = filePath.split("/").pop().replace(".jsonl", "");
  try {
    const lines = await readDelta(filePath);
    for (const line of lines) {
      const event = parseMessage(line, sessionKey, config);
      if (event) {
        console.log(
          `[watcher] ${event.role} message from session ${sessionKey} (${event.content.length} chars)`
        );
        await relayEvent(event, config);
      }
    }
  } catch (err) {
    console.error(`[watcher] Error processing ${filePath}:`, err.message);
  }
}

/**
 * Starts the memory watcher daemon.
 */
async function main() {
  const config = loadConfig();
  const watchPaths = config.watchPaths.map((p) =>
    resolve(p.replace("~", homedir()))
  );

  console.log(`[watcher] Agent: ${config.agentId}`);
  console.log(`[watcher] Watching: ${watchPaths.join(", ")}`);

  const watcher = watch(
    watchPaths.map((p) => `${p}/**/*.jsonl`),
    {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    }
  );

  watcher.on("change", (filePath) => handleFileChange(filePath, config));
  watcher.on("add", (filePath) => handleFileChange(filePath, config));
  watcher.on("error", (err) =>
    console.error("[watcher] Watch error:", err.message)
  );

  console.log("[watcher] Daemon started. Waiting for session writes...");

  process.on("SIGINT", () => {
    console.log("\n[watcher] Shutting down...");
    watcher.close();
    process.exit(0);
  });
}

main();
