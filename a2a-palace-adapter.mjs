/**
 * @module a2a-palace-adapter
 * @description Minimal viable A2A adapter for Palace (L0/L1/L2 memory layers)
 * Bridges A2A protocol with mesh-memory critical facts and agent passport
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

// ── Configuration ───────────────────────────────────────────────────────────
const WORKSPACE = resolve(process.env.OPENCLAW_WORKSPACE || process.cwd());
const PALACE_DIR = resolve(WORKSPACE, "palace-mvp");
const MEMORY_DIR = resolve(WORKSPACE, "memory");
const PASSPORT_PATH = resolve(PALACE_DIR, "agent-passport.json");
const DB_PATH = resolve(MEMORY_DIR, "critical-facts.db");

// Default token for tunnel authentication
const DEFAULT_TOKEN = "replace-with-your-token";

/**
 * Load Palace context (L0 passport + L1 critical facts)
 * @returns {Promise<Object>} { passport, facts, tokenEstimate }
 */
export async function loadPalaceContext() {
  const [passport, facts] = await Promise.all([
    loadAgentPassport(),
    loadCriticalFacts()
  ]);

  // Estimate tokens: passport (~500) + critical facts (~150 each)
  const tokenEstimate = estimateTokens(passport, facts);

  return {
    passport,
    facts,
    tokenEstimate
  };
}

/**
 * Load agent passport (L0 - identity layer)
 * @returns {Promise<Object|null>}
 */
async function loadAgentPassport() {
  try {
    if (!existsSync(PASSPORT_PATH)) {
      console.warn(`[a2a-palace-adapter] Passport not found: ${PASSPORT_PATH}`);
      return null;
    }
    const data = await readFile(PASSPORT_PATH, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`[a2a-palace-adapter] Failed to load passport: ${err.message}`);
    return null;
  }
}

/**
 * Load critical facts from SQLite (L1 - always-loaded layer)
 * @returns {Promise<Array>}
 */
async function loadCriticalFacts() {
  try {
    if (!existsSync(DB_PATH)) {
      console.warn(`[a2a-palace-adapter] Database not found: ${DB_PATH}`);
      return [];
    }

    const db = new Database(DB_PATH);
    
    // Query critical tier facts (L1 - always loaded)
    const rows = db.prepare(`
      SELECT id, tier, category, type, title, body, tags, source, author, 
             timestamp, updated_at, expires_at
      FROM critical_facts
      WHERE tier = 'critical'
      ORDER BY updated_at DESC
    `).all();

    db.close();

    // Parse JSON fields
    return rows.map(row => ({
      ...row,
      tags: parseJSON(row.tags, []),
      content: { title: row.title, body: row.body }
    }));
  } catch (err) {
    console.error(`[a2a-palace-adapter] Failed to load critical facts: ${err.message}`);
    return [];
  }
}

/**
 * Parse JSON string safely
 * @param {string} str
 * @param {*} defaultValue
 * @returns {*}
 */
function parseJSON(str, defaultValue) {
  try {
    return str ? JSON.parse(str) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 chars)
 * @param {Object} passport
 * @param {Array} facts
 * @returns {number}
 */
function estimateTokens(passport, facts) {
  const passportTokens = passport ? JSON.stringify(passport).length / 4 : 0;
  const factsTokens = facts.reduce((sum, f) => {
    const content = f.body || (f.content?.body) || "";
    const title = f.title || (f.content?.title) || "";
    return sum + (content.length + title.length) / 4;
  }, 0);
  return Math.round(passportTokens + factsTokens);
}

/**
 * Publish a fact to all peers via tunnel/incoming endpoint
 * @param {Object} fact - Fact to publish
 * @param {Array} peers - Array of { url, token? } peer objects
 * @returns {Promise<Object>} { success: [], failed: [] }
 */
export async function publishToPeers(fact, peers) {
  const results = {
    success: [],
    failed: []
  };

  if (!peers || peers.length === 0) {
    console.warn("[a2a-palace-adapter] No peers configured");
    return results;
  }

  if (!isValidFact(fact)) {
    throw new Error("Invalid fact: missing required fields (id, tier, content, provenance)");
  }

  const publishPromises = peers.map(peer => publishToPeer(fact, peer));
  const peerResults = await Promise.allSettled(publishPromises);

  for (let i = 0; i < peers.length; i++) {
    const peer = peers[i];
    const result = peerResults[i];

    if (result.status === "fulfilled" && result.value.ok) {
      results.success.push({
        url: peer.url,
        factId: fact.id,
        status: result.value.status
      });
    } else {
      results.failed.push({
        url: peer.url,
        factId: fact.id,
        error: result.reason?.message || result.value?.error || "Unknown error"
      });
    }
  }

  return results;
}

/**
 * Publish fact to a single peer
 * @param {Object} fact
 * @param {Object} peer - { url, token? }
 * @returns {Promise<Object>}
 */
async function publishToPeer(fact, peer) {
  const url = `${peer.url.replace(/\/$/, "")}/tunnel/incoming`;
  const token = peer.token || DEFAULT_TOKEN;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(fact),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return { ok: true, status: res.status };
}

/**
 * Minimal fact validation
 * @param {Object} fact
 * @returns {boolean}
 */
function isValidFact(fact) {
  if (!fact || typeof fact !== "object") return false;
  if (!fact.id) return false;
  if (!fact.tier) return false;
  if (!fact.content) return false;
  if (!fact.provenance || !fact.provenance.source || !fact.provenance.timestamp) {
    return false;
  }
  return true;
}

// ── CLI Usage ───────────────────────────────────────────────────────────────
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "load": {
      const ctx = await loadPalaceContext();
      console.log(JSON.stringify(ctx, null, 2));
      break;
    }

    case "publish": {
      const factFile = args[1];
      const peersFile = args[2];
      if (!factFile || !peersFile) {
        console.error("Usage: node a2a-palace-adapter.mjs publish <fact.json> <peers.json>");
        process.exit(1);
      }
      const fact = JSON.parse(await readFile(factFile, "utf-8"));
      const peers = JSON.parse(await readFile(peersFile, "utf-8"));
      const results = await publishToPeers(fact, peers);
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    default: {
      console.log(`
A2A Palace Adapter CLI

Commands:
  load                          Load palace context (passport + critical facts)
  publish <fact.json> <peers.json>  Publish fact to peers

Examples:
  node a2a-palace-adapter.mjs load
  node a2a-palace-adapter.mjs publish ./test-fact.json ./peers.json
`);
    }
  }
}
