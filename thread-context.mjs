/**
 * @module thread-context
 * @description Manages shared context files for open collaboration threads.
 * Handles thread lifecycle: open, read, write, manifest management.
 */

import { mkdir, readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { Router } from "express";

const THREADS_DIR = resolve(homedir(), ".openclaw/workspace/projects/mesh-memory/memory/threads");

/**
 * Opens a new thread — creates directory structure, manifest, ephemeral tokens.
 * @param {Object} proposal - Thread proposal payload
 * @returns {Promise<Object>} Thread manifest
 */
export async function openThread(proposal) {
  const threadDir = resolve(THREADS_DIR, proposal.threadId);
  await mkdir(threadDir, { recursive: true });

  // Generate ephemeral tokens per participant
  const tokens = {};
  for (const agentId of proposal.participants) {
    tokens[agentId] = randomBytes(24).toString("hex");
  }

  const manifest = {
    threadId: proposal.threadId,
    purpose: proposal.purpose,
    scope: proposal.scope,
    participants: proposal.participants,
    proposingAgent: proposal.proposingAgent,
    closingCondition: proposal.closingCondition,
    timeoutHours: proposal.timeoutHours,
    openedAt: new Date().toISOString(),
    closedAt: null,
  };

  await writeFile(resolve(threadDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  await writeFile(resolve(threadDir, "tokens.json"), JSON.stringify(tokens, null, 2), "utf-8");
  await writeFile(
    resolve(threadDir, "context.md"),
    `# Thread: ${proposal.purpose}\n\nOpened: ${manifest.openedAt}\nParticipants: ${proposal.participants.join(", ")}\n\n---\n\n`,
    "utf-8"
  );

  console.log(`[thread-context] Thread ${proposal.threadId} opened`);
  return manifest;
}

/**
 * Appends an entry to the thread's shared context log.
 * @param {string} threadId
 * @param {string} agentId
 * @param {string} role - e.g. "observation", "decision", "question", "update"
 * @param {string} content
 * @param {string[]} [tags] - Optional tags
 */
export async function writeEntry(threadId, agentId, role, content, tags = []) {
  const contextPath = resolve(THREADS_DIR, threadId, "context.md");
  const timestamp = new Date().toISOString();
  const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";

  const entry = `## [${timestamp}] ${agentId} (${role})${tagStr}\n${content}\n\n`;
  await appendFile(contextPath, entry, "utf-8");

  console.log(`[thread-context] ${agentId} wrote to thread ${threadId}`);
}

/**
 * Reads the full context log for a thread.
 * @param {string} threadId
 * @returns {Promise<string>}
 */
export async function readContext(threadId) {
  const contextPath = resolve(THREADS_DIR, threadId, "context.md");
  return readFile(contextPath, "utf-8");
}

/**
 * Returns the manifest for a thread.
 * @param {string} threadId
 * @returns {Promise<Object>}
 */
export async function getManifest(threadId) {
  const manifestPath = resolve(THREADS_DIR, threadId, "manifest.json");
  const raw = await readFile(manifestPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Lists all open threads (those without a closedAt timestamp).
 * @returns {Promise<Object[]>} Array of manifest objects
 */
export async function listOpenThreads() {
  const open = [];
  let entries;

  try {
    entries = await readdir(THREADS_DIR, { withFileTypes: true });
  } catch {
    return open;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "archive" || entry.name === "pending") continue;

    try {
      const manifest = await getManifest(entry.name);
      if (!manifest.closedAt) {
        open.push(manifest);
      }
    } catch {
      // Skip directories without valid manifests
    }
  }

  return open;
}

/**
 * Validates an ephemeral token for a thread + agent.
 * @param {string} threadId
 * @param {string} agentId
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function validateToken(threadId, agentId, token) {
  try {
    const tokensPath = resolve(THREADS_DIR, threadId, "tokens.json");
    const raw = await readFile(tokensPath, "utf-8");
    const tokens = JSON.parse(raw);
    return tokens[agentId] === token;
  } catch {
    return false;
  }
}

/**
 * Creates an Express router for the thread write endpoint.
 * @returns {Router}
 */
export function createContextRouter() {
  const router = Router();

  /** POST /mesh/thread/:threadId/write — write to thread context */
  router.post("/mesh/thread/:threadId/write", async (req, res) => {
    const { threadId } = req.params;
    const { agentId, token, role, content, tags } = req.body || {};

    if (!agentId || !token || !content) {
      return res.status(400).json({ error: "Missing agentId, token, or content" });
    }

    const valid = await validateToken(threadId, agentId, token);
    if (!valid) {
      return res.status(401).json({ error: "Invalid ephemeral token" });
    }

    // Check thread is still open
    try {
      const manifest = await getManifest(threadId);
      if (manifest.closedAt) {
        return res.status(410).json({ error: "Thread is closed" });
      }
    } catch {
      return res.status(404).json({ error: "Thread not found" });
    }

    try {
      await writeEntry(threadId, agentId, role || "update", content, tags || []);
      return res.json({ ok: true, threadId });
    } catch (err) {
      console.error(`[thread-context] Write error:`, err.message);
      return res.status(500).json({ error: "Failed to write entry" });
    }
  });

  return router;
}
