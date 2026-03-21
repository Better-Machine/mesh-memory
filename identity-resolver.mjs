/**
 * identity-resolver.mjs
 * 
 * Resolves sender IDs to rich identity context for mesh-memory entries.
 * Maps channel:userId → name, role, relationship, projects.
 * 
 * Usage:
 *   import { resolveIdentity, enrichMessage } from './identity-resolver.mjs';
 * 
 *   const identity = resolveIdentity('telegram', '8362390464');
 *   // → { name: 'Erik Ross', role: 'founder', ... }
 * 
 *   const enriched = enrichMessage(rawMessage);
 *   // → rawMessage with identity context injected into metadata
 */

import { readFileSync, writeFileSync, watchFile } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTACTS_PATH = resolve(__dirname, 'mesh-memory.contacts.json');

// --- Registry loading (hot-reload on file change) ---

let registry = null;
let registryMtime = 0;

function loadRegistry() {
  try {
    const raw = readFileSync(CONTACTS_PATH, 'utf8');
    registry = JSON.parse(raw);
    return registry;
  } catch (err) {
    console.error('[identity-resolver] Failed to load contacts registry:', err.message);
    registry = { contacts: {}, unknownBehavior: 'flag', _flagged: [] };
    return registry;
  }
}

function getRegistry() {
  if (!registry) loadRegistry();
  return registry;
}

// Hot-reload: pick up manual edits without restart
watchFile(CONTACTS_PATH, { interval: 5000 }, () => {
  loadRegistry();
  console.log('[identity-resolver] Contacts registry reloaded');
});

// --- Core identity resolution ---

/**
 * Resolve a channel+userId pair to identity context.
 * Returns null if unknown.
 * 
 * @param {string} channel - e.g. 'telegram', 'discord', 'signal'
 * @param {string|number} userId - the platform user ID
 * @returns {object|null} identity object or null
 */
export function resolveIdentity(channel, userId) {
  const reg = getRegistry();
  const key = `${channel}:${userId}`;
  const contact = reg.contacts[key];

  if (contact) return { ...contact, _key: key, _resolved: true };

  // Unknown identity
  const behavior = reg.unknownBehavior || 'flag';

  if (behavior === 'flag') {
    flagUnknown(key, channel, userId, reg);
  }

  return null;
}

/**
 * Flag an unknown identity for future enrichment.
 * Writes back to contacts file with the unknown entry queued.
 */
function flagUnknown(key, channel, userId, reg) {
  const flagged = reg._flagged || [];
  const alreadyFlagged = flagged.some(f => f.key === key);

  if (!alreadyFlagged) {
    flagged.push({
      key,
      channel,
      userId: String(userId),
      firstSeen: new Date().toISOString(),
      status: 'unknown'
    });
    reg._flagged = flagged;

    // Write back asynchronously
    try {
      writeFileSync(CONTACTS_PATH, JSON.stringify(reg, null, 2), 'utf8');
      console.log(`[identity-resolver] Flagged unknown identity: ${key}`);
    } catch (err) {
      console.error('[identity-resolver] Failed to write flagged identity:', err.message);
    }
  }
}

/**
 * Register a new contact programmatically.
 * Use when a new user is added to the allowlist.
 * 
 * @param {string} channel
 * @param {string|number} userId
 * @param {object} contactData - { name, username, role, relationship, projects, notes }
 */
export function registerContact(channel, userId, contactData) {
  const reg = getRegistry();
  const key = `${channel}:${userId}`;

  reg.contacts[key] = {
    ...contactData,
    channel,
    _registeredAt: new Date().toISOString()
  };

  // Remove from flagged if present
  reg._flagged = (reg._flagged || []).filter(f => f.key !== key);

  try {
    writeFileSync(CONTACTS_PATH, JSON.stringify(reg, null, 2), 'utf8');
    console.log(`[identity-resolver] Registered contact: ${key} → ${contactData.name}`);
    return true;
  } catch (err) {
    console.error('[identity-resolver] Failed to register contact:', err.message);
    return false;
  }
}

/**
 * List all flagged (unknown) identities.
 * Useful for periodic review — who's been talking that we don't know?
 */
export function listFlagged() {
  const reg = getRegistry();
  return reg._flagged || [];
}

// --- Message enrichment ---

/**
 * Enrich a raw message object with resolved identity context.
 * 
 * Expects message to have one of:
 *   - message.metadata.channel + message.metadata.sender_id
 *   - message.channel + message.sender_id
 *   - message.from.channel + message.from.id
 * 
 * Returns enriched copy — does not mutate original.
 * 
 * @param {object} message - raw message from session JSONL or relay
 * @returns {object} enriched message with _identity field
 */
export function enrichMessage(message) {
  if (!message || typeof message !== 'object') return message;

  // Try to extract channel + userId from various message shapes
  const channel = extractChannel(message);
  const userId = extractUserId(message);

  if (!channel || !userId) {
    return { ...message, _identity: null };
  }

  const identity = resolveIdentity(channel, userId);

  if (!identity) {
    return {
      ...message,
      _identity: {
        _resolved: false,
        channel,
        userId: String(userId),
        _note: 'Unknown sender — flagged for enrichment'
      }
    };
  }

  return {
    ...message,
    _identity: identity
  };
}

/**
 * Format identity context as a readable prefix for memory log entries.
 * 
 * Examples:
 *   "[Erik Ross / founder / better-machine, door$]"
 *   "[Christian / co-founder / clean-sl8]"
 *   "[Unknown / telegram:6167756653]"
 */
export function formatIdentityTag(identity) {
  if (!identity) return '';
  if (!identity._resolved) return `[Unknown / ${identity.channel}:${identity.userId}]`;

  const projects = identity.projects?.length
    ? identity.projects.slice(0, 3).join(', ')
    : null;

  const parts = [identity.name, identity.role];
  if (projects) parts.push(projects);

  return `[${parts.join(' / ')}]`;
}

/**
 * Get a concise display name for a sender.
 * Falls back to channel:userId if unknown.
 */
export function displayName(channel, userId) {
  const identity = resolveIdentity(channel, userId);
  if (identity) return identity.name;
  return `${channel}:${userId}`;
}

// --- Extraction helpers ---

function extractChannel(message) {
  return (
    message?.metadata?.channel ||
    message?.channel ||
    message?.from?.channel ||
    message?.inbound?.channel ||
    null
  );
}

function extractUserId(message) {
  return (
    message?.metadata?.sender_id ||
    message?.sender_id ||
    message?.from?.id ||
    message?.userId ||
    null
  );
}

// --- Utility: auto-register from OpenClaw config ---

/**
 * Sync contacts from OpenClaw's Telegram allowlist.
 * Call this when openclaw.json changes to pre-populate unknowns.
 * Note: only adds entries that don't already exist.
 * 
 * @param {object} telegramConfig - channels.telegram from openclaw.json
 */
export function syncFromOpenClawConfig(telegramConfig) {
  if (!telegramConfig) return;

  const allowFrom = telegramConfig.groupAllowFrom || [];
  const reg = getRegistry();
  let changed = false;

  for (const userId of allowFrom) {
    const key = `telegram:${userId}`;
    if (!reg.contacts[key]) {
      // Flag as known-but-unenriched
      const flagged = reg._flagged || [];
      const alreadyFlagged = flagged.some(f => f.key === key);
      if (!alreadyFlagged) {
        flagged.push({
          key,
          channel: 'telegram',
          userId: String(userId),
          firstSeen: new Date().toISOString(),
          status: 'unenriched',
          _note: 'Added from OpenClaw groupAllowFrom — needs name/role enrichment'
        });
        reg._flagged = flagged;
        changed = true;
      }
    }
  }

  if (changed) {
    try {
      writeFileSync(CONTACTS_PATH, JSON.stringify(reg, null, 2), 'utf8');
      console.log('[identity-resolver] Synced contacts from OpenClaw config');
    } catch (err) {
      console.error('[identity-resolver] Failed to sync from OpenClaw config:', err.message);
    }
  }
}
