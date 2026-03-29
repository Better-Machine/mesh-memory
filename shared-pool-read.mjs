/**
 * @module shared-pool-read
 * @description Read from the shared pool with mandatory anonymization and confidence decay.
 * Architecture: research/CONSENSUS_BIAS_ARCHITECTURE.md
 *
 * READ-PATH ANONYMIZATION IS MANDATORY — see architecture doc.
 * Full attribution is written to audit.jsonl for human review only.
 */

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKSPACE = resolve(homedir(), ".openclaw/workspace");
const POOL_DIR = resolve(WORKSPACE, "memory/shared");
const POOL_FILE = resolve(POOL_DIR, "pool.json");
const AUDIT_FILE = resolve(POOL_DIR, "audit.jsonl");
const CONTACTS_FILE = resolve(__dirname, "mesh-memory.contacts.json");

/** Decay rates per day */
const DECAY_PER_DAY = {
  slow:    0.995,
  medium:  0.985,
  fast:    0.97,
  bounded: null, // special logic
};

const STALE_THRESHOLD = 0.5;

/** Load contacts registry for agent→role mapping */
let _contacts = null;
async function loadContacts() {
  if (_contacts) return _contacts;
  if (!existsSync(CONTACTS_FILE)) {
    _contacts = {};
    return _contacts;
  }
  try {
    const data = JSON.parse(await readFile(CONTACTS_FILE, "utf-8"));
    _contacts = data.contacts || {};
  } catch {
    _contacts = {};
  }
  return _contacts;
}

/**
 * Map a source_agent name to an anonymized role/domain label.
 * @param {string} sourceAgent
 * @param {Object} contacts
 * @returns {string} anonymized label
 */
function anonymizeAgent(sourceAgent, contacts) {
  // Try to find matching contact by name field
  for (const [, contact] of Object.entries(contacts)) {
    if (
      contact.name &&
      contact.name.toLowerCase().includes(sourceAgent.toLowerCase())
    ) {
      return contact.role || "agent";
    }
  }
  // Try direct key match (e.g. "agent:liz")
  const byKey = contacts[`agent:${sourceAgent.toLowerCase()}`];
  if (byKey) return byKey.role || "agent";
  return "agent";
}

/**
 * Calculate effective confidence with temporal decay.
 * @param {Object} entry
 * @returns {{effective_confidence: number, stale: boolean}}
 */
function applyDecay(entry) {
  const { confidence, review_by } = entry.provenance;
  const decayRate = entry.decay_rate;
  const writtenAt = new Date(entry.provenance.timestamp);
  const now = new Date();
  const ageInDays = Math.max(0, (now - writtenAt) / (1000 * 60 * 60 * 24));

  let effective_confidence;

  if (decayRate === "bounded") {
    // 1.0 until review_by, then 0.0
    if (review_by && now > new Date(review_by)) {
      effective_confidence = 0.0;
    } else {
      effective_confidence = confidence;
    }
  } else {
    const ratePerDay = DECAY_PER_DAY[decayRate] ?? DECAY_PER_DAY.fast;
    const multiplier = Math.pow(ratePerDay, ageInDays);
    effective_confidence = confidence * multiplier;
  }

  return {
    effective_confidence: Math.max(0, Math.min(1, effective_confidence)),
    stale: effective_confidence < STALE_THRESHOLD,
  };
}

/**
 * Write a full-attribution record to audit log (never shown to reading agent).
 * @param {Object} rawEntry - Full entry with real source_agent
 * @param {string} readerId - Who is reading (for audit trail)
 */
async function writeAudit(rawEntry, readerId) {
  await mkdir(POOL_DIR, { recursive: true });
  const record = {
    event: "read",
    entry_id: rawEntry.id,
    full_source_agent: rawEntry.provenance.source_agent,
    reader: readerId || "unknown",
    read_at: new Date().toISOString(),
  };
  await appendFile(AUDIT_FILE, JSON.stringify(record) + "\n", "utf-8");
}

/**
 * Load and parse the pool file.
 * @returns {Promise<Array>} entries array
 */
async function loadPoolEntries() {
  if (!existsSync(POOL_FILE)) return [];
  const raw = JSON.parse(await readFile(POOL_FILE, "utf-8"));
  return raw.entries || [];
}

/**
 * Anonymize and enrich a single entry for reading.
 * @param {Object} rawEntry
 * @param {Object} contacts
 * @param {string} [readerId]
 * @returns {Object} Safe, decayed entry
 */
async function presentEntry(rawEntry, contacts, readerId) {
  const { effective_confidence, stale } = applyDecay(rawEntry);
  const anonymizedRole = anonymizeAgent(rawEntry.provenance.source_agent, contacts);

  // Write audit trail BEFORE returning to reader
  await writeAudit(rawEntry, readerId);

  const entry = {
    id: rawEntry.id,
    type: rawEntry.type,
    category: rawEntry.category,
    fact: rawEntry.fact,
    tags: rawEntry.tags,
    provenance: {
      // source_agent is STRIPPED — replaced with role
      source: anonymizedRole,
      timestamp: rawEntry.provenance.timestamp,
      basis: rawEntry.provenance.basis,
      review_by: rawEntry.provenance.review_by,
    },
    confirmed_by: rawEntry.confirmed_by,
    decay_rate: rawEntry.decay_rate,
    effective_confidence,
    stale,
    challenges: rawEntry.challenges || [],
  };

  // Prepend challenge warning if any challenges exist
  if (entry.challenges.length > 0) {
    entry._warning = `[CHALLENGE] This entry has ${entry.challenges.length} challenge(s). Review challenges before relying on this fact.`;
  }

  return entry;
}

/**
 * Read all entries from the shared pool.
 * @param {Object} [opts] - Filter options
 * @param {boolean} [opts.includeStale=false] - Include stale entries
 * @param {string}  [opts.category] - Filter by category
 * @param {string[]} [opts.tags] - Filter by tags (any match)
 * @param {string}  [opts.type] - Filter by type
 * @param {string}  [opts.readerId] - ID of the reading agent (for audit)
 * @returns {Promise<Array>}
 */
export async function readAll(opts = {}) {
  const {
    includeStale = false,
    category,
    tags,
    type,
    readerId,
  } = opts;

  const [rawEntries, contacts] = await Promise.all([
    loadPoolEntries(),
    loadContacts(),
  ]);

  const results = [];
  for (const raw of rawEntries) {
    const entry = await presentEntry(raw, contacts, readerId);
    if (!includeStale && entry.stale) continue;
    if (category && entry.category !== category) continue;
    if (type && entry.type !== type) continue;
    if (tags && tags.length > 0) {
      const hasTag = tags.some(t => entry.tags.includes(t));
      if (!hasTag) continue;
    }
    results.push(entry);
  }

  return results;
}

/**
 * Read a single entry by ID.
 * @param {string} id
 * @param {string} [readerId]
 * @returns {Promise<Object|null>}
 */
export async function readOne(id, readerId) {
  const [rawEntries, contacts] = await Promise.all([
    loadPoolEntries(),
    loadContacts(),
  ]);

  const raw = rawEntries.find(e => e.id === id);
  if (!raw) return null;

  return presentEntry(raw, contacts, readerId);
}

/**
 * Search entries by query string (matches fact, category, tags).
 * @param {string} query
 * @param {Object} [opts]
 * @param {boolean} [opts.includeStale=false]
 * @param {string}  [opts.readerId]
 * @returns {Promise<Array>}
 */
export async function search(query, opts = {}) {
  const { includeStale = false, readerId } = opts;
  const q = query.toLowerCase();

  const [rawEntries, contacts] = await Promise.all([
    loadPoolEntries(),
    loadContacts(),
  ]);

  const results = [];
  for (const raw of rawEntries) {
    const entry = await presentEntry(raw, contacts, readerId);
    if (!includeStale && entry.stale) continue;

    const inFact     = entry.fact.toLowerCase().includes(q);
    const inCategory = entry.category.toLowerCase().includes(q);
    const inTags     = entry.tags.some(t => t.toLowerCase().includes(q));
    const inType     = entry.type.toLowerCase().includes(q);

    if (inFact || inCategory || inTags || inType) {
      results.push(entry);
    }
  }

  return results;
}
