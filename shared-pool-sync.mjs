/**
 * @module shared-pool-sync
 * @description Sync shared pool entries to/from peer agents.
 * Architecture: research/CONSENSUS_BIAS_ARCHITECTURE.md
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { writeEntry } from "./shared-pool-write.mjs";
import { loadConfig } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKSPACE = resolve(homedir(), ".openclaw/workspace");
const POOL_DIR = resolve(WORKSPACE, "memory/shared");
const SYNC_STATE_FILE = resolve(POOL_DIR, "sync-state.json");

/** Rate limit: max 1 request/sec/peer */
const RATE_LIMIT_MS = 1000;

/**
 * Load sync state (cursor per peer).
 * @returns {Promise<Object>}
 */
async function loadSyncState() {
  if (!existsSync(SYNC_STATE_FILE)) {
    return { cursors: {}, lastSync: {} };
  }
  return JSON.parse(await readFile(SYNC_STATE_FILE, "utf-8"));
}

/**
 * Save sync state.
 * @param {Object} state
 */
async function saveSyncState(state) {
  await mkdir(POOL_DIR, { recursive: true });
  await writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POST a single entry to a peer's /mesh/shared-pool endpoint.
 * @param {Object} entry
 * @param {Object} peer - { url, token }
 * @returns {Promise<{ok: boolean, status: number, duplicate: boolean}>}
 */
async function postEntryToPeer(entry, peer) {
  const config = loadConfig();
  const token = peer.token || config.receiverToken;

  let res;
  try {
    res = await fetch(`${peer.url}/mesh/shared-pool`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn(`[shared-pool-sync] Peer ${peer.url} unreachable:`, e.message);
    return { ok: false, status: 0, duplicate: false };
  }

  return {
    ok: res.status === 201,
    status: res.status,
    duplicate: res.status === 409,
  };
}

/**
 * Sync new entries to a list of peer receivers.
 * Rate limited: max 1 req/sec/peer.
 *
 * @param {Object[]} entries - Entries to sync
 * @param {Object[]} peers - Array of { url, token } objects
 * @returns {Promise<Object>} Summary: { sent, duplicates, errors } per peer
 */
export async function syncToPeers(entries, peers) {
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log("[shared-pool-sync] No entries to sync.");
    return {};
  }
  if (!Array.isArray(peers) || peers.length === 0) {
    console.log("[shared-pool-sync] No peers configured.");
    return {};
  }

  const state = await loadSyncState();
  const summary = {};

  for (const peer of peers) {
    const peerKey = peer.url;
    const cursor = state.cursors[peerKey] || 0;
    const toSend = entries.slice(cursor);

    if (toSend.length === 0) {
      console.log(`[shared-pool-sync] Peer ${peerKey}: already up to date.`);
      summary[peerKey] = { sent: 0, duplicates: 0, errors: 0 };
      continue;
    }

    console.log(`[shared-pool-sync] Syncing ${toSend.length} entries to ${peerKey}...`);

    let sent = 0;
    let duplicates = 0;
    let errors = 0;

    for (let i = 0; i < toSend.length; i++) {
      const entry = toSend[i];
      const result = await postEntryToPeer(entry, peer);

      if (result.ok) {
        sent++;
        state.cursors[peerKey] = cursor + i + 1;
      } else if (result.duplicate) {
        duplicates++;
        state.cursors[peerKey] = cursor + i + 1;
      } else {
        errors++;
        console.warn(`[shared-pool-sync] Failed to sync entry ${entry.id} to ${peerKey} (status ${result.status})`);
      }

      // Rate limit: 1 req/sec/peer
      if (i < toSend.length - 1) {
        await sleep(RATE_LIMIT_MS);
      }
    }

    state.lastSync[peerKey] = new Date().toISOString();
    summary[peerKey] = { sent, duplicates, errors };
    console.log(`[shared-pool-sync] ${peerKey}: sent=${sent} duplicates=${duplicates} errors=${errors}`);
  }

  await saveSyncState(state);
  return summary;
}

/**
 * Validate a pool entry received from a peer.
 * @param {Object} entry
 * @returns {string|null} Error message or null if valid
 */
function validatePeerEntry(entry) {
  if (!entry || typeof entry !== "object") return "Entry must be a JSON object";
  if (!entry.id) return "Missing required field: id";
  if (!entry.fact) return "Missing required field: fact";
  if (!entry.category) return "Missing required field: category";
  if (!Array.isArray(entry.tags)) return "Missing required field: tags";
  if (!entry.provenance || typeof entry.provenance !== "object")
    return "Missing required field: provenance";
  if (!entry.provenance.source_agent) return "Missing required field: provenance.source_agent";
  if (!entry.provenance.timestamp)    return "Missing required field: provenance.timestamp";
  if (entry.provenance.confidence === undefined || entry.provenance.confidence === null)
    return "Missing required field: provenance.confidence";
  return null;
}

/**
 * Receive a pool entry from a peer agent.
 * - Validates the entry structure
 * - Checks for duplicate IDs
 * - Forces provenance.basis to "peer-relayed"
 *
 * @param {Object} entry - Entry from peer
 * @returns {Promise<Object>} Written entry
 * @throws If invalid or duplicate
 */
export async function receiveFromPeer(entry) {
  const error = validatePeerEntry(entry);
  if (error) {
    throw Object.assign(new Error(`Invalid peer entry: ${error}`), { code: "INVALID" });
  }

  // Force basis to "peer-relayed" regardless of what peer sent
  const normalized = {
    ...entry,
    provenance: {
      ...entry.provenance,
      basis: "peer-relayed",
    },
  };

  // writeEntry handles duplicate ID rejection
  try {
    return await writeEntry(normalized);
  } catch (e) {
    if (e.message && e.message.startsWith("Duplicate entry ID")) {
      throw Object.assign(e, { code: "DUPLICATE" });
    }
    throw e;
  }
}
