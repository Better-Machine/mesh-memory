/**
 * @module tunnel-publisher
 * @description Tunnel protocol integration for mesh-memory.
 * Publishes facts to mesh peers and receives facts from peers.
 * Facts CAN traverse tunnels; interpretations CANNOT.
 * Every tunnel packet includes provenance (who, when, source).
 */

import express from "express";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ───────────────────────────────────────────────────────────
const WORKSPACE = resolve(homedir(), ".openclaw/workspace");
const TUNNEL_DIR = resolve(WORKSPACE, "memory/tunnel");
const QUEUE_DIR = resolve(TUNNEL_DIR, "queue");
const LOG_FILE = resolve(TUNNEL_DIR, "tunnel.log");
const CRITICAL_FACTS_FILE = resolve(WORKSPACE, "memory/critical-facts.json");

// Rate limiting and retry configuration
const RATE_LIMIT_MS = 1000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 5000, 15000]; // Exponential backoff: 1s, 5s, 15s

// Interpretation keywords that disqualify content from tunnel transmission
const INTERPRETATION_KEYWORDS = [
  "believes",
  "thinks",
  "probably",
  "likely",
  "seems",
  "appears",
  "feels",
  "suggests",
  "implies",
  "assessment",
  "opinion",
  "judgment",
  "unreliable",
  "frustrated",
  "annoyed",
  "concerned",
  "worried",
  "confident",
  "doubtful"
];

// Allowed fact types per TUNNEL_PROTOCOL.md
const ALLOWED_TYPES = [
  "decision",
  "event",
  "date",
  "config",
  "observation"
];

// Required provenance fields
const REQUIRED_PROVENANCE_FIELDS = [
  "source",
  "timestamp"
];

// ── Logging ──────────────────────────────────────────────────────────────────
async function logTunnel(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${level}] ${message}${Object.keys(meta).length ? " " + JSON.stringify(meta) : ""}\n`;
  await mkdir(TUNNEL_DIR, { recursive: true });
  await appendFile(LOG_FILE, entry, "utf-8");
  console.log(`[tunnel] ${level}: ${message}`, meta);
}

// ── Queue Management ─────────────────────────────────────────────────────────
async function loadQueue() {
  const queueFile = resolve(QUEUE_DIR, "failed-publishes.json");
  if (!existsSync(queueFile)) {
    return [];
  }
  return JSON.parse(await readFile(queueFile, "utf-8"));
}

async function saveQueue(queue) {
  await mkdir(QUEUE_DIR, { recursive: true });
  const queueFile = resolve(QUEUE_DIR, "failed-publishes.json");
  await writeFile(queueFile, JSON.stringify(queue, null, 2), "utf-8");
}

async function queueFailedPublish(fact, peer, error) {
  const queue = await loadQueue();
  queue.push({
    fact,
    peer,
    error: error.message || String(error),
    failedAt: new Date().toISOString(),
    retryCount: 0
  });
  await saveQueue(queue);
  await logTunnel("WARN", `Failed publish queued for retry`, { peer: peer.url, factId: fact.id });
}

// ── Validation ───────────────────────────────────────────────────────────────
export function containsInterpretationKeywords(content) {
  if (!content || typeof content !== "string") return false;
  const lowerContent = content.toLowerCase();
  return INTERPRETATION_KEYWORDS.some(kw => lowerContent.includes(kw.toLowerCase()));
}

export function validateFact(fact) {
  const errors = [];

  // Check required fields
  if (!fact.id) errors.push("Missing required field: id");
  if (!fact.tier) errors.push("Missing required field: tier");
  if (!fact.content) errors.push("Missing required field: content");
  if (!fact.provenance) errors.push("Missing required field: provenance");

  // Validate tier
  if (fact.tier && !["critical", "deep"].includes(fact.tier)) {
    errors.push(`Invalid tier: ${fact.tier}. Must be 'critical' or 'deep'`);
  }

  // Validate provenance
  if (fact.provenance) {
    for (const field of REQUIRED_PROVENANCE_FIELDS) {
      if (!fact.provenance[field]) {
        errors.push(`Missing required provenance field: ${field}`);
      }
    }
    
    // Validate timestamp is parseable
    if (fact.provenance.timestamp) {
      const ts = new Date(fact.provenance.timestamp);
      if (isNaN(ts.getTime())) {
        errors.push("Invalid provenance.timestamp: must be ISO 8601");
      }
    }
  }

  // Validate content structure
  if (fact.content) {
    const contentBody = typeof fact.content === "string" 
      ? fact.content 
      : fact.content.body || "";
    
    if (containsInterpretationKeywords(contentBody)) {
      errors.push("Content contains interpretation keywords (believes, thinks, probably, etc.)");
    }
  }

  // Validate type if present
  if (fact.type && !ALLOWED_TYPES.includes(fact.type)) {
    errors.push(`Invalid type: ${fact.type}. Must be one of: ${ALLOWED_TYPES.join(", ")}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") {
    return { valid: false, error: "Provenance must be an object" };
  }

  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    if (!provenance[field]) {
      return { valid: false, error: `Missing required provenance field: ${field}` };
    }
  }

  const ts = new Date(provenance.timestamp);
  if (isNaN(ts.getTime())) {
    return { valid: false, error: "Invalid timestamp: must be ISO 8601" };
  }

  // Check timestamp is not in future (allow 5min drift) and not too old (>24h)
  const now = Date.now();
  const driftMs = 5 * 60 * 1000;
  if (ts.getTime() > now + driftMs) {
    return { valid: false, error: "Timestamp is in the future" };
  }
  if (ts.getTime() < now - 24 * 60 * 60 * 1000) {
    return { valid: false, error: "Timestamp is older than 24 hours" };
  }

  return { valid: true };
}

// ── Fact Storage ─────────────────────────────────────────────────────────────
async function loadCriticalFacts() {
  if (!existsSync(CRITICAL_FACTS_FILE)) {
    return { schema_version: "1.0.0", facts: [] };
  }
  return JSON.parse(await readFile(CRITICAL_FACTS_FILE, "utf-8"));
}

async function saveCriticalFacts(data) {
  await mkdir(dirname(CRITICAL_FACTS_FILE), { recursive: true });
  await writeFile(CRITICAL_FACTS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function storeIncomingFact(fact) {
  const data = await loadCriticalFacts();
  
  // Check for duplicate ID
  if (data.facts.some(f => f.id === fact.id)) {
    throw Object.assign(new Error(`Duplicate fact ID: ${fact.id}`), { code: "DUPLICATE" });
  }

  // Add the fact
  data.facts.push(fact);
  await saveCriticalFacts(data);
  await logTunnel("INFO", "Incoming fact stored", { factId: fact.id, source: fact.provenance?.source });
}

// ── HTTP Helpers ────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postFactToPeer(fact, peer, token) {
  const res = await fetch(`${peer.url}/tunnel/incoming`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(fact),
    signal: AbortSignal.timeout(10000)
  });

  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? await res.json().catch(() => ({})) : await res.text()
  };
}

// ── TunnelPublisher Class ───────────────────────────────────────────────────
export class TunnelPublisher {
  constructor(options = {}) {
    this.peers = options.peers || [];
    this.localPort = options.localPort || 18803;
    this.token = options.token || "replace-with-your-token";
    this.app = null;
    this.server = null;
  }

  /**
   * Publishes a single fact to all configured peers.
   * Validates the fact before sending.
   * Retries failed publishes with exponential backoff.
   * Queues permanently failed publishes for later retry.
   * @param {Object} fact - The fact to publish
   * @returns {Promise<Object>} Summary of publish results per peer
   */
  async publishFact(fact) {
    // Validate the fact first
    const validation = validateFact(fact);
    if (!validation.valid) {
      await logTunnel("ERROR", "Fact validation failed", { factId: fact.id, errors: validation.errors });
      throw new Error(`Fact validation failed: ${validation.errors.join("; ")}`);
    }

    if (this.peers.length === 0) {
      await logTunnel("WARN", "No peers configured, fact not published", { factId: fact.id });
      return {};
    }

    const summary = {};

    for (const peer of this.peers) {
      let success = false;
      let lastError = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await logTunnel("DEBUG", `Publishing to peer (attempt ${attempt + 1})`, { peer: peer.url, factId: fact.id });
          
          const result = await postFactToPeer(fact, peer, peer.token || this.token);
          
          if (result.ok) {
            await logTunnel("INFO", "Fact published successfully", { peer: peer.url, factId: fact.id });
            success = true;
            summary[peer.url] = { sent: true, attempts: attempt + 1 };
            break;
          } else if (result.status === 409) {
            // Duplicate - treat as success
            await logTunnel("INFO", "Fact already exists on peer", { peer: peer.url, factId: fact.id });
            success = true;
            summary[peer.url] = { sent: true, duplicate: true, attempts: attempt + 1 };
            break;
          } else {
            lastError = new Error(`HTTP ${result.status}: ${result.data}`);
            await logTunnel("WARN", `Publish failed (attempt ${attempt + 1})`, { peer: peer.url, status: result.status });
          }
        } catch (err) {
          lastError = err;
          await logTunnel("WARN", `Publish error (attempt ${attempt + 1})`, { peer: peer.url, error: err.message });
        }

        // Exponential backoff before retry
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BACKOFF_MS[attempt] || 15000);
        }
      }

      if (!success) {
        await logTunnel("ERROR", `Failed to publish after ${MAX_RETRIES} attempts`, { peer: peer.url, factId: fact.id });
        await queueFailedPublish(fact, peer, lastError);
        summary[peer.url] = { sent: false, error: lastError?.message, queued: true };
      }

      // Rate limit between peers
      await sleep(RATE_LIMIT_MS);
    }

    return summary;
  }

  /**
   * Publishes multiple facts to all peers.
   * @param {Object[]} facts - Array of facts to publish
   * @returns {Promise<Object[]>} Array of summaries per fact
   */
  async publishFacts(facts) {
    if (!Array.isArray(facts) || facts.length === 0) {
      return [];
    }

    const results = [];
    for (const fact of facts) {
      try {
        const summary = await this.publishFact(fact);
        results.push({ factId: fact.id, success: true, summary });
      } catch (err) {
        results.push({ factId: fact.id, success: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * Starts the Express listener for incoming tunnel facts.
   * @returns {Promise<void>}
   */
  async startListener() {
    if (this.server) {
      throw new Error("Listener already started");
    }

    await mkdir(TUNNEL_DIR, { recursive: true });

    this.app = express();
    this.app.use(express.json({ limit: "1mb" }));

    // Bearer token authentication middleware
    this.app.use("/tunnel", (req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${this.token}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      next();
    });

    /**
     * POST /tunnel/incoming - Receive a fact from a peer
     * Validates provenance before accepting.
     * Stores valid facts to local critical_facts table.
     */
    this.app.post("/tunnel/incoming", async (req, res) => {
      try {
        const fact = req.body;

        // Validate fact structure
        const validation = validateFact(fact);
        if (!validation.valid) {
          await logTunnel("WARN", "Incoming fact validation failed", { errors: validation.errors });
          return res.status(400).json({ error: "Validation failed", details: validation.errors });
        }

        // Validate provenance (timestamp drift, etc.)
        const provenanceCheck = validateProvenance(fact.provenance);
        if (!provenanceCheck.valid) {
          await logTunnel("WARN", "Provenance validation failed", { error: provenanceCheck.error });
          return res.status(400).json({ error: "Provenance validation failed", details: [provenanceCheck.error] });
        }

        // Store the fact
        try {
          await storeIncomingFact(fact);
          return res.status(201).json({ ok: true, id: fact.id });
        } catch (err) {
          if (err.code === "DUPLICATE") {
            return res.status(409).json({ error: "Duplicate fact ID", id: fact.id });
          }
          throw err;
        }
      } catch (err) {
        await logTunnel("ERROR", "Error processing incoming fact", { error: err.message });
        return res.status(500).json({ error: "Internal server error" });
      }
    });

    // Health check endpoint (no auth required for health)
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", module: "tunnel-publisher" });
    });

    // Start server with error handling
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.localPort, () => {
        logTunnel("INFO", "Tunnel listener started", { port: this.localPort });
        resolve();
      });

      this.server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          logTunnel("ERROR", `Port ${this.localPort} already in use`);
        } else {
          logTunnel("ERROR", "Server error", { error: err.message });
        }
        reject(err);
      });
    });
  }

  /**
   * Stops the listener.
   * @returns {Promise<void>}
   */
  async stopListener() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logTunnel("INFO", "Tunnel listener stopped");
          this.server = null;
          this.app = null;
          resolve();
        });
      });
    }
  }

  /**
   * Retries failed publishes from the queue.
   * @returns {Promise<Object>} Summary of retry results
   */
  async retryFailedPublishes() {
    const queue = await loadQueue();
    const results = { retried: 0, succeeded: 0, failed: 0, remaining: 0 };

    if (queue.length === 0) {
      return results;
    }

    const remaining = [];

    for (const item of queue) {
      if (item.retryCount >= MAX_RETRIES) {
        await logTunnel("WARN", "Max retries exceeded, dropping from queue", { factId: item.fact.id, peer: item.peer.url });
        results.failed++;
        continue;
      }

      results.retried++;
      item.retryCount++;

      try {
        const result = await postFactToPeer(item.fact, item.peer, item.peer.token || this.token);
        
        if (result.ok || result.status === 409) {
          await logTunnel("INFO", "Retry succeeded", { factId: item.fact.id, peer: item.peer.url });
          results.succeeded++;
        } else {
          throw new Error(`HTTP ${result.status}`);
        }
      } catch (err) {
        await logTunnel("WARN", "Retry failed", { factId: item.fact.id, peer: item.peer.url, error: err.message });
        remaining.push(item);
        results.remaining++;
      }

      await sleep(RATE_LIMIT_MS);
    }

    await saveQueue(remaining);
    return results;
  }
}

// ── CLI Usage ─────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const usage = `
Usage: node tunnel-publisher.mjs <command> [options]

Commands:
  listen              Start the tunnel listener server
  publish <file>      Publish facts from JSON file to peers
  retry               Retry failed publishes from queue
  validate <file>     Validate facts in JSON file (dry run)
  status              Show tunnel status and queue length

Environment:
  TUNNEL_TOKEN        Bearer token for authentication
  TUNNEL_PORT         Local port for listener (default: 18803)
`;

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.error(usage);
    process.exit(1);
  }

  const token = process.env.TUNNEL_TOKEN || "replace-with-your-token";
  const port = parseInt(process.env.TUNNEL_PORT, 10) || 18803;

  // Load peers from config if available
  let peers = [];
  try {
    const configPath = resolve(__dirname, "mesh-memory.config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(await readFile(configPath, "utf-8"));
      peers = config.peers?.map(p => ({ url: p.url, token: p.token })) || [];
    }
  } catch (e) {
    console.warn("Could not load peers from config:", e.message);
  }

  const publisher = new TunnelPublisher({ peers, localPort: port, token });

  switch (command) {
    case "listen": {
      await publisher.startListener();
      console.log(`Tunnel listener started on port ${port}`);
      // Keep running
      process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await publisher.stopListener();
        process.exit(0);
      });
      break;
    }

    case "publish": {
      const file = args[1];
      if (!file) {
        console.error("Usage: publish <file>");
        process.exit(1);
      }
      const data = JSON.parse(await readFile(file, "utf-8"));
      const facts = Array.isArray(data) ? data : data.facts || [data];
      const results = await publisher.publishFacts(facts);
      console.log("Publish results:", JSON.stringify(results, null, 2));
      break;
    }

    case "retry": {
      const results = await publisher.retryFailedPublishes();
      console.log("Retry results:", JSON.stringify(results, null, 2));
      break;
    }

    case "validate": {
      const file = args[1];
      if (!file) {
        console.error("Usage: validate <file>");
        process.exit(1);
      }
      const data = JSON.parse(await readFile(file, "utf-8"));
      const facts = Array.isArray(data) ? data : data.facts || [data];
      let valid = 0;
      let invalid = 0;
      for (const fact of facts) {
        const result = validateFact(fact);
        if (result.valid) {
          console.log(`✓ ${fact.id}: VALID`);
          valid++;
        } else {
          console.log(`✗ ${fact.id}: INVALID - ${result.errors.join(", ")}`);
          invalid++;
        }
      }
      console.log(`\nSummary: ${valid} valid, ${invalid} invalid`);
      break;
    }

    case "status": {
      const queue = await loadQueue();
      console.log(`Queue length: ${queue.length} failed publishes`);
      if (queue.length > 0) {
        console.log("Queued items:");
        for (const item of queue) {
          console.log(`  - ${item.fact.id} to ${item.peer.url} (${item.retryCount} retries)`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n${usage}`);
      process.exit(1);
  }
}
