/**
 * @module thread-close
 * @description Handles thread closure, token invalidation, archival, and optional summary.
 */

import { readFile, writeFile, mkdir, rename, rm, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Router } from "express";
import { loadConfig } from "./config.mjs";
import { getManifest, listOpenThreads } from "./thread-context.mjs";

const THREADS_DIR = resolve(homedir(), ".openclaw/workspace/projects/mesh-memory/memory/threads");
const ARCHIVE_DIR = resolve(THREADS_DIR, "archive");

/**
 * Generates a simple summary from context.md.
 * Extracts first line of each entry + any tagged content.
 * @param {string} contextContent - Raw context.md content
 * @returns {string} Summary text
 */
function generateSummary(contextContent) {
  const lines = contextContent.split("\n");
  const summaryLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Capture entry headers
    if (line.startsWith("## [")) {
      summaryLines.push(line);
      // Grab the first non-empty content line after header
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine && !nextLine.startsWith("## [") && !nextLine.startsWith("---")) {
          summaryLines.push(nextLine);
          break;
        }
      }
    }
  }

  return summaryLines.length > 0
    ? summaryLines.join("\n")
    : "No entries to summarize.";
}

/**
 * Closes a thread: updates manifest, invalidates tokens, archives, optionally summarizes.
 * @param {string} threadId
 * @param {string} reason - Why the thread is being closed
 * @returns {Promise<void>}
 */
export async function closeThread(threadId, reason) {
  const threadDir = resolve(THREADS_DIR, threadId);
  const manifestPath = resolve(threadDir, "manifest.json");
  const tokensPath = resolve(threadDir, "tokens.json");

  // Update manifest with close info
  const manifest = await getManifest(threadId);
  manifest.closedAt = new Date().toISOString();
  manifest.closeReason = reason;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`[thread-close] Thread ${threadId} closed: ${reason}`);

  // Notify all participants
  const config = loadConfig();
  for (const participantId of manifest.participants) {
    if (participantId === config.agentId) continue;

    const peer = config.peers.find((p) => p.name === participantId);
    if (!peer) continue;

    const peerThreadUrl = peer.url.replace(/:18801\b/, ":18802");
    try {
      await fetch(`${peerThreadUrl}/mesh/thread/${threadId}/closed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${peer.token}`,
        },
        body: JSON.stringify({
          threadId,
          closedBy: config.agentId,
          reason,
          closedAt: manifest.closedAt,
        }),
      });
    } catch (err) {
      console.error(`[thread-close] Failed to notify ${participantId}:`, err.message);
    }
  }

  // Invalidate ephemeral tokens
  try {
    await rm(tokensPath, { force: true });
    console.log(`[thread-close] Tokens invalidated for thread ${threadId}`);
  } catch {
    // Best effort
  }

  // Archive
  const archiveDest = resolve(ARCHIVE_DIR, threadId);
  await mkdir(ARCHIVE_DIR, { recursive: true });
  await rename(threadDir, archiveDest);
  console.log(`[thread-close] Thread ${threadId} archived`);

  // Optional summary
  if (config.threads?.summarizeOnClose) {
    try {
      const contextContent = await readFile(resolve(archiveDest, "context.md"), "utf-8");
      const summary = generateSummary(contextContent);
      await writeFile(resolve(archiveDest, "summary.md"), `# Thread Summary\n\n${summary}\n`, "utf-8");
      console.log(`[thread-close] Summary written for thread ${threadId}`);
    } catch (err) {
      console.error(`[thread-close] Failed to generate summary:`, err.message);
    }
  }
}

/**
 * Checks all open threads for timeout and closes expired ones.
 * @returns {Promise<string[]>} IDs of threads that were closed
 */
export async function checkTimeouts() {
  const openThreads = await listOpenThreads();
  const closed = [];

  for (const manifest of openThreads) {
    if (!manifest.timeoutHours || !manifest.openedAt) continue;

    const openedAt = new Date(manifest.openedAt).getTime();
    const timeoutMs = manifest.timeoutHours * 3600000;
    const now = Date.now();

    if (now - openedAt > timeoutMs) {
      console.log(`[thread-close] Thread ${manifest.threadId} timed out after ${manifest.timeoutHours}h`);
      await closeThread(manifest.threadId, `Timeout: exceeded ${manifest.timeoutHours}h limit`);
      closed.push(manifest.threadId);
    }
  }

  return closed;
}

/**
 * Creates an Express router for close and notification endpoints.
 * @returns {Router}
 */
export function createCloseRouter() {
  const router = Router();

  /** POST /mesh/thread/:threadId/close — close a thread from any participant */
  router.post("/mesh/thread/:threadId/close", async (req, res) => {
    const { threadId } = req.params;
    const { reason } = req.body || {};

    try {
      await closeThread(threadId, reason || "Closed by participant");
      return res.json({ ok: true, threadId });
    } catch (err) {
      console.error(`[thread-close] Close error:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  /** POST /mesh/thread/:threadId/closed — notification that a thread was closed by a peer */
  router.post("/mesh/thread/:threadId/closed", (req, res) => {
    const { threadId } = req.params;
    const { closedBy, reason, closedAt } = req.body || {};

    console.log(
      `[thread-close] Received close notification for ${threadId} from ${closedBy}: ${reason}`
    );

    return res.json({ ok: true, threadId });
  });

  return router;
}
