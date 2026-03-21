/**
 * @module privacy
 * @description Per-message and session-scoped privacy filter for mesh-memory.
 *
 * ## How privacy works
 *
 * ### Per-message private flag
 * Add the word "private" anywhere in a message to suppress just that message
 * from being relayed to peer agents. It is processed locally only.
 *
 *   Example: "private — what's the Localzon revenue model again?"
 *   Example: "Can you keep this private? I'm worried about X."
 *
 * ### Session-scope private mode
 * Use block commands to mark an entire section of a conversation private.
 * Once private mode is active, ALL messages are suppressed until closed.
 *
 *   [private]          — opens private mode (alias: [private start])
 *   [/private]         — closes private mode (alias: [private end], [end private])
 *
 *   Example flow:
 *     User:      "[private]"
 *     User:      "Let's talk about the Localzon revenue model."
 *     Assistant: "The model is 2-3% of CC processing fees..."
 *     User:      "[/private]"
 *     User:      "Now let's talk about the door$ pitch."  ← relayed again
 *
 * ### Confidential keyword matching
 * You can configure additional keywords in mesh-memory.config.local.json:
 *   { "privacy": { "keywords": ["confidential", "salary", "nda"] } }
 * Any message containing one of these keywords is auto-suppressed.
 *
 * ### What "suppressed" means
 * Suppressed messages are NOT relayed to peer agents via A2A.
 * They are NOT written to memory/mesh/*.md on any agent.
 * They ARE processed normally by the local agent — nothing is lost locally.
 * A redacted notice IS written to the local mesh log so agents know a gap exists.
 *
 * ## Lesson / correction tagging
 * See lesson-tagger.mjs for [lesson], [correction], [mistake] tag handling.
 */

/** @type {Map<string, boolean>} Per-session private mode state */
const sessionPrivateMode = new Map();

/** Patterns that open private mode */
const OPEN_PATTERNS = [
  /^\[private\]$/i,
  /^\[private start\]$/i,
  /^\[start private\]$/i,
];

/** Patterns that close private mode */
const CLOSE_PATTERNS = [
  /^\[\/private\]$/i,
  /^\[private end\]$/i,
  /^\[end private\]$/i,
];

/** Per-message private flag — word "private" standalone or as a tag */
const PER_MESSAGE_PATTERNS = [
  /\bprivate\b/i,
  /\[private\]/i,
];

/**
 * Checks if a content string is a session-scope open command.
 * @param {string} content
 * @returns {boolean}
 */
function isOpenCommand(content) {
  const trimmed = content.trim();
  return OPEN_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Checks if a content string is a session-scope close command.
 * @param {string} content
 * @returns {boolean}
 */
function isCloseCommand(content) {
  const trimmed = content.trim();
  return CLOSE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Checks if a message has a per-message private flag.
 * @param {string} content
 * @param {string[]} keywords - Additional keywords from config
 * @returns {boolean}
 */
function hasPerMessageFlag(content, keywords = []) {
  if (PER_MESSAGE_PATTERNS.some((p) => p.test(content))) return true;
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(content)) return true;
  }
  return false;
}

/**
 * @typedef {Object} PrivacyDecision
 * @property {"relay"|"suppress"|"command"} action
 *   - relay:    message should be relayed to peers
 *   - suppress: message is private, do not relay
 *   - command:  message was a privacy command ([private]/[/private]), do not relay
 * @property {string} reason - Human-readable explanation
 * @property {boolean} privateModeActive - Current private mode state after this message
 */

/**
 * Evaluates a message's privacy status and updates session state.
 *
 * @param {string} sessionKey - Session identifier
 * @param {string} content - Message content
 * @param {Object} [config] - Optional config with privacy settings
 * @returns {PrivacyDecision}
 */
export function evaluatePrivacy(sessionKey, content, config = {}) {
  const keywords = config?.privacy?.keywords || [];
  const currentlyPrivate = sessionPrivateMode.get(sessionKey) || false;

  // Check for session close command first (allow exit even in private mode)
  if (isCloseCommand(content)) {
    sessionPrivateMode.set(sessionKey, false);
    return {
      action: "command",
      reason: "Private mode closed",
      privateModeActive: false,
    };
  }

  // Check for session open command
  if (isOpenCommand(content)) {
    sessionPrivateMode.set(sessionKey, true);
    return {
      action: "command",
      reason: "Private mode opened",
      privateModeActive: true,
    };
  }

  // Session-scope: already in private mode
  if (currentlyPrivate) {
    return {
      action: "suppress",
      reason: "Session private mode active",
      privateModeActive: true,
    };
  }

  // Per-message flag
  if (hasPerMessageFlag(content, keywords)) {
    return {
      action: "suppress",
      reason: "Per-message private flag detected",
      privateModeActive: false,
    };
  }

  // All clear
  return {
    action: "relay",
    reason: "No privacy flags",
    privateModeActive: false,
  };
}

/**
 * Returns true if a session is currently in private mode.
 * @param {string} sessionKey
 * @returns {boolean}
 */
export function isSessionPrivate(sessionKey) {
  return sessionPrivateMode.get(sessionKey) || false;
}

/**
 * Returns a map of all sessions with their current private mode state.
 * Useful for agent awareness / status reporting.
 * @returns {Object}
 */
export function getAllSessionStates() {
  const result = {};
  for (const [key, value] of sessionPrivateMode.entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Resets private mode for a session (e.g. when a session ends).
 * @param {string} sessionKey
 */
export function resetSession(sessionKey) {
  sessionPrivateMode.delete(sessionKey);
}

/**
 * Returns heuristic signals that a message MIGHT warrant privacy.
 * Used by agents to decide whether to ask the user about privacy.
 *
 * These are suggestions only — the agent should use judgment, not hard-block.
 *
 * @param {string} content
 * @returns {{ shouldAsk: boolean, signals: string[] }}
 */
export function privacySensitivityHints(content) {
  const signals = [];

  const patterns = [
    [/\b(salary|compensation|equity|raise|bonus)\b/i, "financial/compensation topic"],
    [/\b(nda|non-disclosure|confidential agreement)\b/i, "NDA or legal sensitivity"],
    [/\b(health|medical|diagnosis|prescription|therapy)\b/i, "health topic"],
    [/\b(password|secret|token|credential|api key)\b/i, "credential or secret"],
    [/\b(personal|relationship|family|divorce|kids|spouse)\b/i, "personal/relationship topic"],
    [/\b(lawsuit|litigation|legal|attorney|lawyer)\b/i, "legal matter"],
    [/\b(investor|term sheet|valuation|cap table)\b/i, "investor-sensitive"],
    [/\b(revenue model|unit economics|margin|burn rate)\b/i, "confidential business metrics"],
  ];

  for (const [re, label] of patterns) {
    if (re.test(content)) signals.push(label);
  }

  return {
    shouldAsk: signals.length > 0,
    signals,
  };
}
