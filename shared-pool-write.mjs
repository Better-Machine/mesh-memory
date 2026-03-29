/**
 * @module shared-pool-write
 * @description Write entries to the shared pool — bias-resistant fact store.
 * Architecture: research/CONSENSUS_BIAS_ARCHITECTURE.md
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKSPACE = resolve(homedir(), ".openclaw/workspace");
const POOL_DIR = resolve(WORKSPACE, "memory/shared");
const POOL_FILE = resolve(POOL_DIR, "pool.json");
const SEED_FILE = resolve(__dirname, "shared-pool.json");

const VALID_TYPES = [
  "observation",
  "fact",
  "inference",
  "interpretation",
  "role-assignment",
  "prediction",
];

const VALID_BASES = [
  "observed",
  "inferred",
  "peer-relayed",
  "self-assessed",
  "external",
];

/** Map type → decay_rate */
const DECAY_RATE_MAP = {
  fact: "slow",
  observation: "slow",
  inference: "medium",
  "role-assignment": "medium",
  interpretation: "fast",
  prediction: "bounded",
};

/** Map type → review window (in days, except predictions which use deadline) */
const REVIEW_WINDOW_DAYS = {
  fact: 180,
  observation: 180,
  inference: 90,
  "role-assignment": 90,
  interpretation: 42, // 6 weeks
  prediction: null,   // caller must supply
};

/**
 * Compute a deterministic entry ID.
 * sha256(source_agent + timestamp + fact.slice(0,64))
 * @param {string} sourceAgent
 * @param {string} timestamp
 * @param {string} fact
 * @returns {string} hex digest (first 32 chars)
 */
function computeId(sourceAgent, timestamp, fact) {
  const input = `${sourceAgent}||${timestamp}||${fact.slice(0, 64)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Compute review_by date from type and optional deadline.
 * @param {string} type
 * @param {string} [deadline] - ISO date for predictions
 * @returns {string} ISO date string
 */
function computeReviewBy(type, deadline) {
  if (type === "prediction") {
    if (!deadline) throw new Error('Predictions require provenance.review_by (prediction deadline)');
    return deadline;
  }
  const days = REVIEW_WINDOW_DAYS[type] ?? 180;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Load the pool from disk, initializing if absent.
 * On first init, merges seed entries from shared-pool.json.
 * @returns {Promise<{version: string, entries: Array}>}
 */
async function loadPool() {
  await mkdir(POOL_DIR, { recursive: true });

  if (!existsSync(POOL_FILE)) {
    // Initialize fresh pool
    const pool = { version: "0.2", entries: [] };

    // Merge seed entries if seed file exists
    if (existsSync(SEED_FILE)) {
      try {
        const seed = JSON.parse(await readFile(SEED_FILE, "utf-8"));
        if (Array.isArray(seed.entries)) {
          for (const raw of seed.entries) {
            // Convert legacy seed format → pool format
            const entry = normalizeSeedEntry(raw);
            if (entry) pool.entries.push(entry);
          }
          console.log(`[shared-pool-write] Merged ${pool.entries.length} seed entries.`);
        }
      } catch (e) {
        console.warn("[shared-pool-write] Could not read seed file:", e.message);
      }
    }

    await writeFile(POOL_FILE, JSON.stringify(pool, null, 2), "utf-8");
    return pool;
  }

  return JSON.parse(await readFile(POOL_FILE, "utf-8"));
}

/**
 * Convert a legacy seed entry (shared-pool.json format) to pool format.
 * @param {Object} raw
 * @returns {Object|null}
 */
function normalizeSeedEntry(raw) {
  if (!raw.fact || !raw.id) return null;
  const author = raw.author || "unknown";
  const timestamp = raw.date
    ? new Date(raw.date).toISOString()
    : new Date().toISOString();
  return {
    id: raw.id,
    type: "fact",
    category: raw.category || "general",
    fact: raw.fact,
    tags: raw.tags || [],
    provenance: {
      source_agent: author,
      timestamp,
      basis: "observed",
      confidence: 0.9,
      review_by: computeReviewBy("fact"),
    },
    confirmed_by: raw.confirmed_by || null,
    decay_rate: "slow",
    challenges: [],
  };
}

/**
 * Save pool to disk.
 * @param {Object} pool
 */
async function savePool(pool) {
  await writeFile(POOL_FILE, JSON.stringify(pool, null, 2), "utf-8");
}

/**
 * Validate a candidate entry. Throws on hard errors, warns on soft.
 * @param {Object} entry - Input entry (may be mutated for defaults)
 * @returns {Object} Normalized entry
 */
function validateAndNormalize(entry) {
  const errors = [];

  // ── Required top-level fields ─────────────────────────────────────
  if (!entry.fact || typeof entry.fact !== "string")
    errors.push("Missing required field: fact");
  if (!entry.category || typeof entry.category !== "string")
    errors.push("Missing required field: category");
  if (!Array.isArray(entry.tags))
    errors.push("Missing required field: tags (must be array)");

  // ── Provenance ────────────────────────────────────────────────────
  const prov = entry.provenance;
  if (!prov || typeof prov !== "object")
    errors.push("Missing required field: provenance");
  else {
    if (!prov.source_agent) errors.push("Missing required field: provenance.source_agent");
    if (!prov.timestamp)    errors.push("Missing required field: provenance.timestamp");
    if (prov.confidence === undefined || prov.confidence === null)
      errors.push("Missing required field: provenance.confidence");
    if (!prov.basis)        errors.push("Missing required field: provenance.basis");
    else if (!VALID_BASES.includes(prov.basis))
      errors.push(`Invalid provenance.basis: ${prov.basis}. Must be one of: ${VALID_BASES.join(", ")}`);
    if (typeof prov.confidence === "number" &&
        (prov.confidence < 0 || prov.confidence > 1))
      errors.push("provenance.confidence must be 0.0–1.0");
  }

  if (errors.length > 0) throw new Error(`Validation failed:\n  ${errors.join("\n  ")}`);

  // ── Type defaulting ───────────────────────────────────────────────
  let type = entry.type;
  if (!type) {
    console.warn("[shared-pool-write] ⚠  Missing type — defaulting to 'interpretation'");
    type = "interpretation";
  } else if (!VALID_TYPES.includes(type)) {
    console.warn(`[shared-pool-write] ⚠  Unknown type '${type}' — defaulting to 'interpretation'`);
    type = "interpretation";
  }

  // ── Compute derived fields ────────────────────────────────────────
  const ts = prov.timestamp;
  const id = entry.id || computeId(prov.source_agent, ts, entry.fact);
  const decay_rate = DECAY_RATE_MAP[type] || "fast";
  const review_by = prov.review_by || computeReviewBy(type, entry._predictionDeadline);

  return {
    id,
    type,
    category: entry.category,
    fact: entry.fact,
    tags: entry.tags,
    provenance: {
      source_agent: prov.source_agent,
      timestamp: ts,
      basis: prov.basis,
      confidence: prov.confidence,
      review_by,
    },
    confirmed_by: entry.confirmed_by || null,
    decay_rate,
    challenges: [],
  };
}

/**
 * Write a single entry to the shared pool.
 * @param {Object} entry - Entry object (see module docs for required fields)
 * @returns {Promise<Object>} The normalized, written entry
 */
export async function writeEntry(entry) {
  const normalized = validateAndNormalize(entry);
  const pool = await loadPool();

  // ── Duplicate ID check ────────────────────────────────────────────
  if (pool.entries.some(e => e.id === normalized.id)) {
    throw new Error(`Duplicate entry ID: ${normalized.id}`);
  }

  pool.entries.push(normalized);
  await savePool(pool);

  console.log(`[shared-pool-write] ✅ Written entry ${normalized.id} (${normalized.type}/${normalized.category})`);
  return normalized;
}

// ── CLI usage ─────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const usage = `
Usage: node shared-pool-write.mjs --agent <name> --fact <text> --category <cat> [--type <type>] [--tags tag1,tag2] [--basis <basis>] [--confidence 0.8]
`;
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const agent    = get("--agent");
  const fact     = get("--fact");
  const category = get("--category");
  const type     = get("--type") || undefined;
  const tags     = get("--tags") ? get("--tags").split(",") : [];
  const basis    = get("--basis") || "observed";
  const confidence = parseFloat(get("--confidence") || "0.8");

  if (!agent || !fact || !category) {
    console.error(usage);
    process.exit(1);
  }

  try {
    const result = await writeEntry({
      type,
      category,
      fact,
      tags,
      provenance: {
        source_agent: agent,
        timestamp: new Date().toISOString(),
        basis,
        confidence,
      },
    });
    console.log("Written:", result.id);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}
