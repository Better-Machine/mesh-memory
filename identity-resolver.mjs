/**
 * identity-resolver.mjs
 *
 * Resolves sender IDs AND conversation contexts (groups, channels, rooms)
 * to rich identity context for mesh-memory entries.
 *
 * Works across all OpenClaw-supported channels:
 *   Telegram, WhatsApp, Discord, Signal, Slack, iMessage, Matrix, IRC, etc.
 *
 * Identity keys:
 *   telegram:1234567890         → individual user
 *   group:telegram:-1001234567890  → Telegram group chat
 *   group:discord:222222222     → Discord channel
 *   group:whatsapp:+1555@g.us   → WhatsApp group
 *   group:signal:<uuid>         → Signal group
 *   agent:liz                   → AI agent
 *
 * Session key format (from OpenClaw):
 *   agent:<agentId>:<channel>:group:<id>     → group chat
 *   agent:<agentId>:<channel>:channel:<id>   → server channel (Discord/Slack)
 *   agent:<agentId>:<channel>:room:<id>      → room (Matrix/IRC)
 *   agent:<agentId>:main                     → DM / main session
 *
 * Usage:
 *   import { resolveIdentity, resolveContext, resolveConversation } from './identity-resolver.mjs';
 *
 *   const who  = resolveIdentity('telegram', '1234567890');
 *   const where = resolveContext('telegram', '-1001234567890');
 *   const full  = resolveConversation(message);
 *   // → { identity, context, identityTag, contextTag, fullTag }
 */

import { readFileSync, writeFileSync, watchFile } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTACTS_PATH = resolve(__dirname, 'mesh-memory.contacts.json');

// ─── Registry loading (hot-reload on file change) ────────────────────────────

let registry = null;

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

// ─── Session key parsing ─────────────────────────────────────────────────────

/**
 * Parse an OpenClaw session key into its components.
 *
 * Formats:
 *   agent:<agentId>:<channel>:group:<groupId>
 *   agent:<agentId>:<channel>:group:<groupId>:topic:<threadId>  (Telegram forum topics)
 *   agent:<agentId>:<channel>:channel:<channelId>               (Discord/Slack channels)
 *   agent:<agentId>:<channel>:room:<roomId>                     (Matrix/IRC)
 *   agent:<agentId>:main                                        (DM / main session)
 *   agent:<agentId>:<channel>:dm:<userId>                       (per-sender DM)
 *
 * @param {string} sessionKey
 * @returns {{ agentId, channel, contextType, contextId, threadId } | null}
 */
export function parseSessionKey(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return null;

  const parts = sessionKey.split(':');
  if (parts[0] !== 'agent' || parts.length < 3) return null;

  const agentId = parts[1];

  // agent:<agentId>:main
  if (parts[2] === 'main' && parts.length === 3) {
    return { agentId, channel: 'main', contextType: 'dm', contextId: null, threadId: null };
  }

  const channel = parts[2];
  const contextType = parts[3]; // group | channel | room | dm
  const contextId = parts[4] || null;
  const threadId = parts[5] === 'topic' ? parts[6] : null;

  return { agentId, channel, contextType, contextId, threadId };
}

// ─── Core identity resolution ────────────────────────────────────────────────

/**
 * Resolve a sender to their identity.
 *
 * @param {string} channel - e.g. 'telegram', 'discord', 'whatsapp', 'signal'
 * @param {string|number} userId
 * @returns {object|null}
 */
export function resolveIdentity(channel, userId) {
  const reg = getRegistry();
  const key = `${channel}:${userId}`;
  const contact = reg.contacts[key];

  if (contact) return { ...contact, _key: key, _resolved: true };

  // Unknown — flag for enrichment
  if ((reg.unknownBehavior || 'flag') === 'flag') {
    flagUnknown(key, channel, String(userId), 'sender', reg);
  }
  return null;
}

/**
 * Resolve a conversation context (group, channel, room).
 *
 * @param {string} channel - e.g. 'telegram', 'discord', 'whatsapp'
 * @param {string} contextId - the group/channel/room ID
 * @param {string} [contextType='group'] - group | channel | room
 * @returns {object|null}
 */
export function resolveContext(channel, contextId, contextType = 'group') {
  if (!contextId) return null;
  const reg = getRegistry();
  const key = `group:${channel}:${contextId}`;
  const entry = reg.contacts[key];

  if (entry) return { ...entry, _key: key, _resolved: true };

  // Unknown group — flag for enrichment
  if ((reg.unknownBehavior || 'flag') === 'flag') {
    flagUnknown(key, channel, String(contextId), contextType, reg);
  }
  return null;
}

/**
 * Resolve both sender identity and conversation context from a message.
 * This is the primary entry point for memory-watcher enrichment.
 *
 * @param {object} message - raw message from session JSONL
 * @returns {{ identity, context, identityTag, contextTag, fullTag }}
 */
export function resolveConversation(message) {
  if (!message || typeof message !== 'object') {
    return { identity: null, context: null, identityTag: '', contextTag: '', fullTag: '' };
  }

  // ── Extract sender identity ──────────────────────────────────────────────
  const channel = extractChannel(message);
  const senderId = extractUserId(message);
  const identity = (channel && senderId && message.role === 'user')
    ? resolveIdentity(channel, String(senderId))
    : null;

  // ── Extract conversation context ─────────────────────────────────────────
  const sessionKey = extractSessionKey(message);
  const parsed = parseSessionKey(sessionKey);
  let context = null;

  if (parsed && parsed.contextType && parsed.contextId && parsed.contextType !== 'dm') {
    context = resolveContext(parsed.channel, parsed.contextId, parsed.contextType);
  }

  // ── Format tags ──────────────────────────────────────────────────────────
  const identityTag = formatIdentityTag(identity);
  const contextTag = formatContextTag(context, parsed);
  const fullTag = [identityTag, contextTag].filter(Boolean).join(' ');

  return { identity, context, identityTag, contextTag, fullTag, parsed };
}

// ─── Contact registration ────────────────────────────────────────────────────

/**
 * Register a contact (person, agent, group, or channel).
 *
 * @param {string} key - e.g. 'telegram:1234567890' or 'group:telegram:-1001234567890'
 * @param {object} data
 */
export function registerContact(key, data) {
  const reg = getRegistry();
  reg.contacts[key] = { ...data, _registeredAt: new Date().toISOString() };
  reg._flagged = (reg._flagged || []).filter(f => f.key !== key);
  saveRegistry(reg);
  console.log(`[identity-resolver] Registered: ${key} → ${data.name}`);
  return true;
}

/**
 * Register a group/channel context.
 *
 * @param {string} channel - 'telegram', 'discord', etc.
 * @param {string} contextId - the group/channel ID
 * @param {object} data - { name, purpose, members, projects, notes }
 */
export function registerGroup(channel, contextId, data) {
  const key = `group:${channel}:${contextId}`;
  return registerContact(key, { ...data, channel, contextType: 'group' });
}

function flagUnknown(key, channel, id, type, reg) {
  const flagged = reg._flagged || [];
  if (flagged.some(f => f.key === key)) return;
  flagged.push({
    key, channel, id, type,
    firstSeen: new Date().toISOString(),
    status: 'unknown'
  });
  reg._flagged = flagged;
  saveRegistry(reg);
  console.log(`[identity-resolver] Flagged unknown ${type}: ${key}`);
}

function saveRegistry(reg) {
  try {
    writeFileSync(CONTACTS_PATH, JSON.stringify(reg, null, 2), 'utf8');
  } catch (err) {
    console.error('[identity-resolver] Failed to save registry:', err.message);
  }
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format sender identity as a tag string.
 * e.g. "[Christian / co-founder / clean-sl8]"
 */
export function formatIdentityTag(identity) {
  if (!identity) return '';
  if (!identity._resolved) return `[Unknown / ${identity._key || '?'}]`;

  const projects = identity.projects?.length
    ? identity.projects.slice(0, 3).join(', ')
    : null;

  const parts = [identity.name, identity.role];
  if (projects) parts.push(projects);
  return `[${parts.join(' / ')}]`;
}

/**
 * Format conversation context as a tag string.
 * e.g. "in [Clean-SL8 Group / project collaboration / telegram]"
 *
 * Falls back gracefully to session key components if context unknown.
 */
export function formatContextTag(context, parsed) {
  if (!context && !parsed) return '';

  if (context && context._resolved) {
    const parts = [context.name];
    if (context.purpose) parts.push(context.purpose);
    if (context.channel) parts.push(context.channel);
    return `in [${parts.join(' / ')}]`;
  }

  // Graceful fallback — show what we know from the session key
  if (parsed && parsed.contextId) {
    const type = parsed.contextType || 'group';
    return `in [${parsed.channel} ${type} ${parsed.contextId}]`;
  }

  return '';
}

/**
 * Get a concise display name for a sender.
 * Falls back to channel:userId if unknown.
 */
export function displayName(channel, userId) {
  const identity = resolveIdentity(channel, userId);
  return identity ? identity.name : `${channel}:${userId}`;
}

/**
 * List all flagged (unknown) identities and groups.
 */
export function listFlagged() {
  return getRegistry()._flagged || [];
}

/**
 * List all registered contacts and groups.
 */
export function listAll() {
  return getRegistry().contacts || {};
}

// ─── Legacy enrichMessage (backwards compat) ─────────────────────────────────

/**
 * Enrich a raw message with resolved identity + context.
 * @param {object} message
 * @returns {object} enriched message
 */
export function enrichMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const resolved = resolveConversation(message);
  return { ...message, ...resolved };
}

// ─── Extraction helpers ───────────────────────────────────────────────────────

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

function extractSessionKey(message) {
  return (
    message?.sessionKey ||
    message?.session_key ||
    message?.metadata?.session_key ||
    null
  );
}

// ─── OpenClaw config sync ─────────────────────────────────────────────────────

/**
 * Discover all groups/channels configured across all OpenClaw channel configs.
 * Returns an array of { key, channel, contextId, contextType } for unknowns.
 *
 * Supports: telegram, discord, whatsapp, signal, slack, msteams, irc, matrix
 *
 * @param {object} channelsConfig - openclaw.json channels object
 * @returns {Array<{ key, channel, contextId, contextType }>}
 */
export function discoverConfiguredGroups(channelsConfig) {
  if (!channelsConfig) return [];
  const reg = getRegistry();
  const unknown = [];

  const channelGroupKeys = {
    telegram: 'groups',
    discord:  'guilds',     // discord uses guilds + channels
    whatsapp: 'groups',
    signal:   'groups',
    slack:    'channels',
    msteams:  'channels',
    irc:      'channels',
    matrix:   'rooms',
  };

  for (const [channel, groupKey] of Object.entries(channelGroupKeys)) {
    const cfg = channelsConfig[channel];
    if (!cfg || !cfg[groupKey]) continue;

    for (const contextId of Object.keys(cfg[groupKey])) {
      const key = `group:${channel}:${contextId}`;
      if (!reg.contacts[key]) {
        unknown.push({
          key,
          channel,
          contextId,
          contextType: groupKey === 'rooms' ? 'room' : groupKey === 'channels' ? 'channel' : 'group',
          config: cfg[groupKey][contextId],
        });
      }
    }
  }

  return unknown;
}
