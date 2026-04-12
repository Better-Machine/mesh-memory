/**
 * @module a2a-palace-adapter
 * @description Minimal viable A2A adapter for Palace (L0/L1/L2 memory layers)
 * Bridges A2A protocol with mesh-memory critical facts and agent passport
 * @version 1.1.0
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { PalaceError, ValidationError, safeExecute } from "./palace-errors.mjs";
import { createLogger, generateCorrelationId } from "./palace-logger.mjs";

// ── Configuration ───────────────────────────────────────────────────────────
const WORKSPACE = resolve(process.env.OPENCLAW_WORKSPACE || process.cwd());
const PALACE_DIR = resolve(WORKSPACE, "palace-mvp");
const MEMORY_DIR = resolve(WORKSPACE, "memory");
const PASSPORT_PATH = resolve(PALACE_DIR, "agent-passport.json");
const DB_PATH = resolve(MEMORY_DIR, "critical-facts.db");

// Default token for tunnel authentication
const DEFAULT_TOKEN = "replace-with-your-token";

/**
 * Validate peer configuration
 * @private
 */
function validatePeers(peers) {
  if (!Array.isArray(peers)) {
    return { valid: false, error: "peers must be an array" };
  }
  
  for (const peer of peers) {
    if (!peer.url) {
      return { valid: false, error: "Each peer must have a url" };
    }
    try {
      new URL(peer.url);
    } catch {
      return { valid: false, error: `Invalid URL: ${peer.url}` };
    }
  }
  
  return { valid: true };
}

/**
 * Load Palace context (L0 passport + L1 critical facts)
 * @param {Object} options - Optional configuration
 * @param {string} options.correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
 */
export async function loadPalaceContext(options = {}) {
  const correlationId = options.correlationId || generateCorrelationId();
  const logger = createLogger({}, correlationId).child({ module: "a2a-palace-adapter", operation: "loadPalaceContext" });
  
  return safeExecute(async () => {
    logger.info("Loading Palace context");
    
    const [passportResult, factsResult] = await Promise.all([
      loadAgentPassport({ correlationId }),
      loadCriticalFacts({ correlationId })
    ]);

    const passport = passportResult.success ? passportResult.data : null;
    const facts = factsResult.success ? factsResult.data : [];
    
    if (!passport) {
      logger.warn("Passport could not be loaded, using minimal context");
    }
    
    if (!factsResult.success) {
      logger.warn("Critical facts could not be loaded, using empty facts");
    }

    // Estimate tokens: passport (~500) + critical facts (~150 each)
    const tokenEstimate = estimateTokens(passport, facts);
    
    logger.info("Palace context loaded", { 
      hasPassport: !!passport, 
      factCount: facts.length,
      tokenEstimate 
    });

    return {
      passport,
      facts,
      tokenEstimate,
      correlationId
    };
  }, { operation: "loadPalaceContext", correlationId });
}

/**
 * Load agent passport (L0 - identity layer)
 * @param {Object} options - Optional configuration
 * @param {string} options.correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
 */
async function loadAgentPassport(options = {}) {
  const correlationId = options.correlationId || generateCorrelationId();
  const logger = createLogger({}, correlationId).child({ module: "a2a-palace-adapter", operation: "loadAgentPassport" });
  
  return safeExecute(async () => {
    if (!existsSync(PASSPORT_PATH)) {
      logger.warn("Passport file not found", { path: PASSPORT_PATH });
      return null;
    }
    
    try {
      const data = await readFile(PASSPORT_PATH, "utf-8");
      const passport = JSON.parse(data);
      logger.debug("Passport loaded successfully", { 
        agentId: passport.agent?.id,
        version: passport.version 
      });
      return passport;
    } catch (err) {
      logger.error("Failed to load passport", { error: err.message });
      return null;
    }
  }, { operation: "loadAgentPassport", path: PASSPORT_PATH, correlationId });
}

/**
 * Load critical facts from SQLite (L1 - always-loaded layer)
 * @param {Object} options - Optional configuration
 * @param {string} options.correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} { success: boolean, data?: Array, error?: Object }
 */
async function loadCriticalFacts(options = {}) {
  const correlationId = options.correlationId || generateCorrelationId();
  const logger = createLogger({}, correlationId).child({ module: "a2a-palace-adapter", operation: "loadCriticalFacts" });
  
  return safeExecute(async () => {
    if (!existsSync(DB_PATH)) {
      logger.warn("Database not found", { path: DB_PATH });
      return [];
    }

    let db;
    try {
      db = new Database(DB_PATH);
      
      // Query critical tier facts (L1 - always loaded)
      const rows = db.prepare(`
        SELECT id, tier, category, type, title, body, tags, source, author, 
               timestamp, updated_at, expires_at
        FROM critical_facts
        WHERE tier = 'critical'
        ORDER BY updated_at DESC
      `).all();

      // Parse JSON fields
      const facts = rows.map(row => ({
        ...row,
        tags: safeParseJSON(row.tags, []),
        content: { title: row.title, body: row.body }
      }));
      
      logger.debug("Critical facts loaded", { count: facts.length });
      
      return facts;
    } catch (err) {
      logger.error("Failed to load critical facts", { error: err.message });
      return [];
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }, { operation: "loadCriticalFacts", path: DB_PATH, correlationId });
}

/**
 * Parse JSON string safely
 * @param {string} str
 * @param {*} defaultValue
 * @returns {*}
 */
function safeParseJSON(str, defaultValue) {
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
 * @param {Object} options - Optional configuration
 * @param {string} options.correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
 */
export async function publishToPeers(fact, peers, options = {}) {
  const correlationId = options.correlationId || generateCorrelationId();
  const logger = createLogger({}, correlationId).child({ module: "a2a-palace-adapter", operation: "publishToPeers" });
  
  return safeExecute(async () => {
    logger.info("Publishing fact to peers", { factId: fact?.id, peerCount: peers?.length });

    // Validate peers
    const peersValidation = validatePeers(peers);
    if (!peersValidation.valid) {
      logger.warn("No valid peers configured", { error: peersValidation.error });
      return { success: [], failed: [] };
    }

    // Validate fact
    if (!isValidFact(fact)) {
      throw ValidationError.schema("Invalid fact: missing required fields (id, tier, content, provenance)", [
        "Fact must have: id, tier, content, provenance with source and timestamp"
      ]);
    }

    const results = {
      success: [],
      failed: []
    };

    // Publish to each peer (with individual error handling)
    for (const peer of peers) {
      const result = await publishToPeer(fact, peer, correlationId);
      if (result.success) {
        results.success.push(result.data);
      } else {
        results.failed.push(result.error);
      }
    }

    logger.info("Publish to peers complete", { 
      succeeded: results.success.length,
      failed: results.failed.length
    });

    return results;
  }, { operation: "publishToPeers", factId: fact?.id, peerCount: peers?.length, correlationId });
}

/**
 * Publish fact to a single peer
 * @param {Object} fact
 * @param {Object} peer - { url, token? }
 * @param {string} correlationId
 * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
 */
async function publishToPeer(fact, peer, correlationId) {
  const logger = createLogger({}, correlationId).child({ 
    module: "a2a-palace-adapter", 
    operation: "publishToPeer",
    peer: peer.url 
  });
  
  return safeExecute(async () => {
    const url = `${peer.url.replace(/\/$/, "")}/tunnel/incoming`;
    const token = peer.token || DEFAULT_TOKEN;

    logger.debug("Sending fact to peer", { url, factId: fact.id });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Correlation-ID": correlationId
      },
      body: JSON.stringify(fact),
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new PalaceError(`HTTP ${res.status}: ${text}`, {
        code: `HTTP_${res.status}`,
        status: res.status,
        peer: peer.url,
        correlationId
      });
    }

    logger.debug("Fact published successfully", { peer: peer.url, status: res.status });

    return {
      url: peer.url,
      factId: fact.id,
      status: res.status,
      correlationId
    };
  }, { operation: "publishToPeer", peer: peer.url, factId: fact.id, correlationId });
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
  const correlationId = generateCorrelationId();
  const logger = createLogger({}, correlationId).child({ module: "a2a-palace-adapter", cli: true });

  switch (command) {
    case "load": {
      const result = await loadPalaceContext({ correlationId });
      if (result.success) {
        console.log(JSON.stringify(result.data, null, 2));
        process.exit(0);
      } else {
        console.error("Failed to load context:", result.error);
        process.exit(1);
      }
      break;
    }

    case "publish": {
      const factFile = args[1];
      const peersFile = args[2];
      
      if (!factFile || !peersFile) {
        console.error("Usage: node a2a-palace-adapter.mjs publish <fact.json> <peers.json>");
        process.exit(1);
      }
      
      const result = await safeExecute(async () => {
        const factData = await readFile(factFile, "utf-8");
        const fact = JSON.parse(factData);
        const peersData = await readFile(peersFile, "utf-8");
        const peers = JSON.parse(peersData);
        
        return await publishToPeers(fact, peers, { correlationId });
      }, { operation: "cliPublish", factFile, peersFile, correlationId });
      
      if (result.success) {
        console.log(JSON.stringify(result.data, null, 2));
        process.exit(0);
      } else {
        console.error("Publish failed:", result.error);
        process.exit(1);
      }
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

// Default export
export default {
  loadPalaceContext,
  publishToPeers,
  isValidFact
};
