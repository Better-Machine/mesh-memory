/**
 * @module memory-watcher
 * @description Watches session JSONL files for new messages and emits MemoryEvents.
 * Uses chokidar for reliable cross-platform file watching.
 */

import { watch } from "chokidar";
import { readFile, stat, mkdir, appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { relayEvent } from "./memory-relay.mjs";
import { loadConfig } from "./config.mjs";
import { evaluatePrivacy, privacySensitivityHints, resetSession } from "./privacy.mjs";
import { detectTags, taggingSuggestion, writeLessonEntry } from "./lesson-tagger.mjs";
import { resolveConversation } from "./identity-resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Write mesh output to workspace memory dir (where QMD indexes it), not project dir
const LOCAL_MESH_DIR = resolve(homedir(), ".openclaw/workspace/memory/mesh");

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
  // NOTE: do NOT advance fileOffsets here — caller advances per successfully-processed line (H3 fix)

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

    // ── Identity + context resolution ───────────────────────────────────
    // Attach sessionKey to msg so resolveConversation can parse group context
    const msgWithSession = { ...msg, sessionKey, role };
    const { identity, context, identityTag, contextTag, fullTag } =
      role === "user" ? resolveConversation(msgWithSession) : {};

    return {
      agentId: config.agentId,
      sessionKey,
      role,
      content,
      timestamp: msg.timestamp || new Date().toISOString(),
      ...(identity   ? { identity }   : {}),
      ...(context    ? { context }    : {}),
      ...(identityTag ? { identityTag } : {}),
      ...(contextTag  ? { contextTag }  : {}),
      ...(fullTag     ? { fullTag }     : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Formats a MemoryEvent as a markdown entry for local storage.
 * @param {Object} event - MemoryEvent
 * @returns {string} Formatted markdown string
 */
function formatEntry(event) {
  const date = new Date(event.timestamp);
  const time = date.toTimeString().slice(0, 8);

  const contextLine = event.fullTag
    ? ` ${event.fullTag}`
    : event.identityTag
      ? ` ${event.identityTag}${event.contextTag ? ` ${event.contextTag}` : ""}`
      : "";

  const tagLine = event.tags?.length
    ? `\n> tags: ${event.tags.map(t => `[${t}]`).join(" ")}`
    : "";

  return `## [${time}] ${event.agentId} (${event.role})${contextLine}${tagLine}\n${event.content}\n\n`;
}

/**
 * Writes a MemoryEvent to local mesh memory (memory/mesh/YYYY-MM-DD.md).
 * @param {Object} event - MemoryEvent
 */
async function writeLocal(event) {
  await mkdir(LOCAL_MESH_DIR, { recursive: true });
  const dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
  const filePath = resolve(LOCAL_MESH_DIR, `${dateStr}.md`);
  const entry = formatEntry(event);
  await appendFile(filePath, entry, "utf-8");
}

/**
 * Handles a file change event — reads delta, parses, writes locally, and relays.
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
        // ── Privacy filter ──────────────────────────────────────────────
        const privacy = evaluatePrivacy(sessionKey, event.content, config);

        if (privacy.action === "command") {
          console.log(`[watcher] Privacy command in session ${sessionKey}: ${privacy.reason}`);
          // H3: advance offset after successful processing
          fileOffsets.set(filePath, (fileOffsets.get(filePath) || 0) + Buffer.byteLength(line + "\n", "utf-8"));
          continue;
        }

        if (privacy.action === "suppress") {
          console.log(`[watcher] 🔒 Suppressed (${privacy.reason}): session ${sessionKey}`);
          // L6: Write a redacted notice locally so peers know a gap exists (matches documented intent)
          await writeLocal({ ...event, content: "[redacted — private message]", suppressed: true });
          // Do NOT relay suppressed messages
          // H3: advance offset after successful processing
          fileOffsets.set(filePath, (fileOffsets.get(filePath) || 0) + Buffer.byteLength(line + "\n", "utf-8"));
          continue;
        }

        // ── Privacy sensitivity hints (agent awareness) ─────────────────
        if (event.role === "user") {
          const hints = privacySensitivityHints(event.content);
          if (hints.shouldAsk) {
            console.log(`[watcher] 🔍 Sensitivity signals detected: ${hints.signals.join(", ")}`);
            // Attach hints to event for local agent awareness only — stripped before relay (M8 fix)
            event.privacyHints = hints.signals;
          }
        }

        // ── Lesson / correction tagging ─────────────────────────────────
        const tagResult = detectTags(event.content);
        if (tagResult.isTagged) {
          console.log(`[watcher] 🏷  Tags detected: [${tagResult.tags.join(", ")}]`);
          event.tags = tagResult.tags;
          event.content = tagResult.cleanContent;
        }

        // ── Tagging suggestion for assistant messages ────────────────────
        if (event.role === "assistant") {
          const suggestion = taggingSuggestion(event.content, event.role);
          if (suggestion.shouldTag) {
            console.log(`[watcher] 💡 Suggest tagging as [${suggestion.suggestedTag}]: ${suggestion.reason}`);
            event.suggestedTag = suggestion.suggestedTag;
          }
        }

        // ── Local write (primary use case) ──────────────────────────
        await writeLocal(event);

        // ── Write tagged entries to lessons log ──────────────────────
        if (event.tags?.length) {
          await writeLessonEntry(event, event.tags, event.content);
        }

        console.log(
          `[watcher] ${event.role} message from session ${sessionKey} (${event.content.length} chars)${event.fullTag ? ` ${event.fullTag}` : event.identityTag ? ` ${event.identityTag}` : ""}${event.tags ? ` [${event.tags.join(", ")}]` : ""}`
        );
        // Relay is opt-in only. relayEnabled must be explicitly true.
        // Default is false — each agent owns their own memory.
        // Cross-agent sharing happens through thread proposals or direct A2A, not automatic relay.
        if (config.relayEnabled === true) {
          // M8: Strip privacy hints and suggested tag before relaying to peers
          const { privacyHints: _ph, suggestedTag: _st, ...relayPayload } = event;
          await relayEvent(relayPayload, config);
        }
      }

      // H3: advance offset after each successfully-processed line
      fileOffsets.set(filePath, (fileOffsets.get(filePath) || 0) + Buffer.byteLength(line + "\n", "utf-8"));
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

  // Watch both flat files (sessions/*.jsonl) and nested (sessions/**/*.jsonl)
  const watchGlobs = watchPaths.flatMap((p) => [
    `${p}/*.jsonl`,
    `${p}/**/*.jsonl`,
  ]);
  const watcher = watch(watchGlobs, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  // L8: Attach .catch() to async event handlers to prevent unhandled promise rejections
  watcher.on("change", (filePath) =>
    handleFileChange(filePath, config).catch(err =>
      console.error("[watcher] Unhandled error on change:", err.message)
    )
  );
  watcher.on("add", (filePath) =>
    handleFileChange(filePath, config).catch(err =>
      console.error("[watcher] Unhandled error on add:", err.message)
    )
  );
  // L7: Hook unlink to clean up sessionPrivateMode when a session JSONL file is removed
  watcher.on("unlink", (filePath) => {
    const sessionKey = filePath.split("/").pop().replace(".jsonl", "");
    resetSession(sessionKey);
    console.log(`[watcher] Session ended, privacy state cleared: ${sessionKey}`);
  });
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
