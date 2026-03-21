/**
 * @module lesson-tagger
 * @description Tags messages as lessons, corrections, or mistakes before relay.
 *
 * ## How tagging works
 *
 * Any agent or user can tag a message using bracket syntax. Tags can appear
 * anywhere in the message content.
 *
 * ### Available tags
 *
 *   [lesson]      — a takeaway, insight, or principle worth preserving
 *   [correction]  — corrects a wrong assumption or previous error
 *   [mistake]     — acknowledges an error made by an agent (self-tagging)
 *   [decision]    — records a deliberate choice and its rationale
 *   [warning]     — flags a known risk, gotcha, or "don't do this"
 *
 * Tags are case-insensitive. They can be inline or standalone:
 *
 *   "[lesson] Never use fallback model chains with Ollama."
 *   "We should use branch-based PRs for clean-sl8. [decision]"
 *   "[mistake] I assumed the wrong port. The correct port is 18801."
 *   "The ARP approach is blocked on iOS. [correction] Earlier I said it was possible."
 *
 * ### What happens to tagged messages
 *
 *   1. The message is relayed to peers normally (unless also marked private)
 *   2. A structured entry is written to memory/mesh/lessons/YYYY-MM-DD.md
 *   3. The entry includes: tag type, source agent, timestamp, full content
 *   4. Lessons files are QMD-indexed and searchable via memory_search
 *
 * ### Dream cycle integration
 * The dream-cycle prioritises lessons/corrections/mistakes when consolidating
 * to MEMORY.md. A [mistake] from any agent is always included in the next
 * dream cycle run.
 *
 * ### Agent self-tagging
 * Agents are encouraged to self-tag mistakes and corrections rather than
 * leaving them as untagged context. This creates an auditable correction trail.
 *
 * Example agent self-correction:
 *   "[correction] I said the receiver runs on port 18800 — that's A2A.
 *    The mesh-memory receiver runs on port 18801. These are different services."
 */

import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

const LESSONS_DIR = resolve(homedir(), ".openclaw/workspace/memory/mesh/lessons");

/** All recognised tag types */
export const TAG_TYPES = {
  lesson:     { label: "LESSON",     emoji: "💡", priority: "high" },
  correction: { label: "CORRECTION", emoji: "🔧", priority: "high" },
  mistake:    { label: "MISTAKE",    emoji: "⚠️",  priority: "high" },
  decision:   { label: "DECISION",   emoji: "📌", priority: "medium" },
  warning:    { label: "WARNING",    emoji: "🚨", priority: "medium" },
};

/** Regex patterns per tag */
const TAG_PATTERNS = Object.fromEntries(
  Object.keys(TAG_TYPES).map((tag) => [
    tag,
    new RegExp(`\\[${tag}\\]`, "i"),
  ])
);

/**
 * @typedef {Object} TagResult
 * @property {string[]} tags - List of tag names found (e.g. ["lesson", "correction"])
 * @property {boolean} isTagged - True if any tags were found
 * @property {string} cleanContent - Content with tag markers removed
 */

/**
 * Detects tags in message content and returns match info.
 * @param {string} content
 * @returns {TagResult}
 */
export function detectTags(content) {
  const tags = [];
  for (const [tag, pattern] of Object.entries(TAG_PATTERNS)) {
    if (pattern.test(content)) tags.push(tag);
  }

  // Strip all tag markers from content for clean storage
  let cleanContent = content;
  for (const pattern of Object.values(TAG_PATTERNS)) {
    cleanContent = cleanContent.replace(pattern, "").trim();
  }

  return {
    tags,
    isTagged: tags.length > 0,
    cleanContent,
  };
}

/**
 * Formats a tagged entry for the lessons file.
 * @param {Object} event - MemoryEvent
 * @param {string[]} tags - Detected tags
 * @param {string} cleanContent - Tag-stripped content
 * @returns {string}
 */
function formatLessonEntry(event, tags, cleanContent) {
  const date = new Date(event.timestamp);
  const time = date.toTimeString().slice(0, 8);

  const tagLabels = tags.map((t) => {
    const td = TAG_TYPES[t];
    return `${td.emoji} **${td.label}**`;
  }).join("  ");

  return [
    `---`,
    `### ${time} — ${event.agentId} (${event.role})`,
    `${tagLabels}`,
    ``,
    cleanContent,
    ``,
    `_Session: ${event.sessionKey} · ${event.timestamp}_`,
    ``,
  ].join("\n");
}

/**
 * Returns the lessons file path for a given date.
 * @param {Date} date
 * @returns {string}
 */
function getLessonsFilePath(date) {
  const dateStr = date.toISOString().slice(0, 10);
  return resolve(LESSONS_DIR, `${dateStr}.md`);
}

/**
 * Writes a tagged event to the lessons log.
 * Called by memory-receiver after tag detection.
 *
 * @param {Object} event - MemoryEvent (must include agentId, role, content, timestamp, sessionKey)
 * @param {string[]} tags - Detected tag names
 * @param {string} cleanContent - Content with tags stripped
 * @returns {Promise<void>}
 */
export async function writeLessonEntry(event, tags, cleanContent) {
  await mkdir(LESSONS_DIR, { recursive: true });

  const filePath = getLessonsFilePath(new Date(event.timestamp));
  const entry = formatLessonEntry(event, tags, cleanContent);

  // Write header on first entry of the day
  const dayStr = new Date(event.timestamp).toISOString().slice(0, 10);
  let header = "";
  try {
    const { stat } = await import("node:fs/promises");
    await stat(filePath);
  } catch {
    header = `# Lessons · Corrections · Mistakes\n_${dayStr}_\n\n`;
  }

  await appendFile(filePath, header + entry, "utf-8");
}

/**
 * Returns heuristic signals that an agent should self-tag a message.
 * Called during agent response generation to surface tagging opportunities.
 *
 * @param {string} content
 * @param {string} role - "user" or "assistant"
 * @returns {{ shouldTag: boolean, suggestedTag: string|null, reason: string|null }}
 */
export function taggingSuggestion(content, role) {
  // Only suggest for assistant messages — user can tag their own
  if (role !== "assistant") return { shouldTag: false, suggestedTag: null, reason: null };

  const patterns = [
    [/\b(i was wrong|i made an error|i got that wrong|that was incorrect|i apologise|my mistake|i misspoke)\b/i, "mistake", "self-acknowledged error detected"],
    [/\b(actually|to correct|correction|i should clarify|to clarify that was wrong)\b/i, "correction", "correction language detected"],
    [/\b(lesson|key takeaway|what this means|important to note|remember this|don't forget|going forward)\b/i, "lesson", "lesson/takeaway language detected"],
    [/\b(we've decided|the decision is|going with|confirmed approach|final answer)\b/i, "decision", "decision language detected"],
    [/\b(warning|be careful|gotcha|watch out|don't do this|avoid|never)\b/i, "warning", "warning language detected"],
  ];

  for (const [re, tag, reason] of patterns) {
    if (re.test(content)) {
      return { shouldTag: true, suggestedTag: tag, reason };
    }
  }

  return { shouldTag: false, suggestedTag: null, reason: null };
}
