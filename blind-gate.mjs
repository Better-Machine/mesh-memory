/**
 * @module blind-gate
 * @description Pre-retrieval commitment gate for the shared pool.
 * Architecture: research/CONSENSUS_BIAS_ARCHITECTURE.md
 *
 * Protocol: write → commit position hash → gate opens → read pool
 * Post-read "independent assessment" is contaminated by anchoring and
 * does not count as independent. This gate enforces temporal ordering.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { appendFile } from "node:fs/promises";
import { readAll } from "./shared-pool-read.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKSPACE = resolve(homedir(), ".openclaw/workspace");
const GATES_DIR = resolve(WORKSPACE, "memory/shared/gates");
const AUDIT_FILE = resolve(WORKSPACE, "memory/shared/audit.jsonl");

/** Gate expiry: 10 minutes in milliseconds */
const GATE_TTL_MS = 10 * 60 * 1000;

/**
 * Compute sha256 of a string, returned as hex.
 * @param {string} text
 * @returns {string}
 */
function sha256(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Generate a gate token (random 32-byte hex string).
 * @returns {string}
 */
function generateToken() {
  return randomBytes(32).toString("hex");
}

/**
 * Sanitize a string for use in a filename.
 * @param {string} s
 * @returns {string}
 */
function sanitizeForFilename(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Get the file path for a gate file.
 * @param {string} topic
 * @param {string} agentId
 * @param {string} timestamp - ISO string
 * @returns {string}
 */
function gateFilePath(topic, agentId, timestamp) {
  const safeTopic = sanitizeForFilename(topic);
  const safeAgent = sanitizeForFilename(agentId);
  const safeTs    = timestamp.replace(/[:.]/g, "-");
  return resolve(GATES_DIR, `${safeTopic}-${safeAgent}-${safeTs}.json`);
}

/**
 * Write to the audit log.
 * @param {Object} record
 */
async function writeAudit(record) {
  await mkdir(resolve(WORKSPACE, "memory/shared"), { recursive: true });
  await appendFile(AUDIT_FILE, JSON.stringify(record) + "\n", "utf-8");
}

/**
 * Open a blind gate — commit your position BEFORE reading the pool.
 *
 * Writes a position hash (not the position text) to a gate file.
 * Returns a gateToken required to subsequently read.
 *
 * @param {string} topic - The topic you are about to research
 * @param {string} agentId - Your agent ID
 * @param {string} position - Your independent assessment (BEFORE reading pool)
 * @returns {Promise<string>} gateToken to pass to readWithGate()
 */
export async function openGate(topic, agentId, position) {
  if (!topic || typeof topic !== "string")
    throw new Error("openGate: topic is required");
  if (!agentId || typeof agentId !== "string")
    throw new Error("openGate: agentId is required");
  if (!position || typeof position !== "string")
    throw new Error("openGate: position is required (your independent assessment before reading pool)");

  await mkdir(GATES_DIR, { recursive: true });

  const timestamp = new Date().toISOString();
  const token = generateToken();
  const positionHash = sha256(position);
  const filePath = gateFilePath(topic, agentId, timestamp);

  const gateData = {
    token,
    topic,
    agentId,
    positionHash,  // hash only — position text is NOT stored
    openedAt: timestamp,
    used: false,
    filePath,
  };

  await writeFile(filePath, JSON.stringify(gateData, null, 2), "utf-8");

  await writeAudit({
    event: "gate_opened",
    topic,
    agentId,
    positionHash,
    openedAt: timestamp,
    gateToken: token.slice(0, 8) + "...", // partial token in audit only
  });

  console.log(`[blind-gate] ✅ Gate opened for topic '${topic}' by '${agentId}' (expires in 10 min)`);
  return token;
}

/**
 * Read the shared pool using a valid gate token.
 *
 * Validates that:
 * 1. A gate exists with the matching token
 * 2. The gate is not yet used
 * 3. The gate is not expired (< 10 min old)
 *
 * Marks gate as used after successful read.
 *
 * @param {string} gateToken - Token from openGate()
 * @param {Object} [query] - Query/filter options for readAll()
 * @returns {Promise<Array>} Pool entries (anonymized, decayed)
 * @throws If no gate / expired / already used
 */
export async function readWithGate(gateToken, query = {}) {
  if (!gateToken) {
    throw new Error(
      "[blind-gate] READ BLOCKED: No gate token provided.\n" +
      "Protocol: You must call openGate(topic, agentId, yourPosition) BEFORE reading the shared pool.\n" +
      "This ensures your assessment is independent and not contaminated by anchoring bias.\n" +
      "1. Form your own position on the topic\n" +
      "2. Call openGate() — this commits a hash of your position\n" +
      "3. Call readWithGate() with the returned token\n" +
      "Post-read 'independent' assessments do not count."
    );
  }

  // Scan gates directory for matching token
  if (!existsSync(GATES_DIR)) {
    throw new Error("[blind-gate] READ BLOCKED: No gates directory found. Call openGate() first.");
  }

  const { readdir } = await import("node:fs/promises");
  const files = await readdir(GATES_DIR);
  let gateFile = null;
  let gateData = null;

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = resolve(GATES_DIR, file);
    try {
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      if (data.token === gateToken) {
        gateFile = filePath;
        gateData = data;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!gateData) {
    throw new Error("[blind-gate] READ BLOCKED: Gate token not found. Call openGate() first.");
  }

  if (gateData.used) {
    throw new Error(`[blind-gate] READ BLOCKED: Gate token already used. Each gate can only be used once. Call openGate() again.`);
  }

  // Check expiry
  const age = Date.now() - new Date(gateData.openedAt).getTime();
  if (age > GATE_TTL_MS) {
    // Mark as expired in file
    gateData.expired = true;
    await writeFile(gateFile, JSON.stringify(gateData, null, 2), "utf-8");
    throw new Error(
      `[blind-gate] READ BLOCKED: Gate token expired (${Math.round(age / 60000)} min old; limit is 10 min).\n` +
      "Call openGate() again with your current position."
    );
  }

  // Mark gate as used
  gateData.used = true;
  gateData.usedAt = new Date().toISOString();
  await writeFile(gateFile, JSON.stringify(gateData, null, 2), "utf-8");

  // Read pool
  const readerId = gateData.agentId;
  const entries = await readAll({ ...query, readerId });

  // Audit the read
  await writeAudit({
    event: "gate_read",
    topic: gateData.topic,
    agentId: gateData.agentId,
    positionHash: gateData.positionHash,
    openedAt: gateData.openedAt,
    usedAt: gateData.usedAt,
    entriesRead: entries.length,
    filters: query,
  });

  console.log(`[blind-gate] ✅ Gate ${gateToken.slice(0, 8)}... used — read ${entries.length} entries.`);
  return entries;
}

/**
 * Check whether an agent has an active (unused, unexpired) gate.
 * @param {string} agentId
 * @param {string} [topic] - Optional: filter by topic
 * @returns {Promise<boolean>}
 */
export async function hasActiveGate(agentId, topic) {
  if (!existsSync(GATES_DIR)) return false;

  const { readdir } = await import("node:fs/promises");
  let files;
  try {
    files = await readdir(GATES_DIR);
  } catch {
    return false;
  }

  const now = Date.now();
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(await readFile(resolve(GATES_DIR, file), "utf-8"));
      if (data.agentId !== agentId) continue;
      if (topic && data.topic !== topic) continue;
      if (data.used || data.expired) continue;
      const age = now - new Date(data.openedAt).getTime();
      if (age <= GATE_TTL_MS) return true;
    } catch {
      continue;
    }
  }

  return false;
}
