/**
 * @module thread-notify
 * @description Generates user notification after agent consensus on a thread proposal.
 * Sends via openclaw system event and polls for user response.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { openThread } from "./thread-context.mjs";

const execFileAsync = promisify(execFile);

const THREADS_DIR = resolve(homedir(), ".openclaw/workspace/projects/mesh-memory/memory/threads");

/**
 * Formats a human-readable notification for the user.
 * @param {Object} proposal - Thread proposal
 * @param {string[]} acceptedAgents - Agents that accepted
 * @returns {string} Notification text
 */
export function formatNotification(proposal, acceptedAgents) {
  const agents = acceptedAgents.join(", ");
  return [
    `${agents} and ${proposal.proposingAgent} want to open a collaboration thread.`,
    `Purpose: ${proposal.purpose}`,
    `Scope: ${proposal.scope}`,
    `Participants: ${proposal.participants.join(", ")}`,
    `Closes when: ${proposal.closingCondition}`,
    `Approve? Reply YES or NO.`,
  ].join("\n");
}

/**
 * Sends notification via openclaw system event.
 * Uses execFile (no shell) to prevent shell injection via proposal fields.
 * @param {string} text - Notification text
 * @returns {Promise<void>}
 */
async function sendSystemEvent(text) {
  try {
    await execFileAsync("openclaw", ["system", "event", "--text", text, "--mode", "now"]);
    console.log("[thread-notify] System event sent");
  } catch (err) {
    console.error("[thread-notify] Failed to send system event:", err.message);
    throw err;
  }
}

/**
 * Polls for user response in the response file.
 * @param {string} threadId
 * @param {number} [timeoutMs] - Timeout in ms (default 24h)
 * @param {number} [pollIntervalMs] - Poll interval in ms (default 10s)
 * @returns {Promise<"YES"|"NO"|"TIMEOUT">}
 */
async function pollForResponse(threadId, timeoutMs = 86400000, pollIntervalMs = 10000) {
  const pendingDir = resolve(THREADS_DIR, "pending", threadId);
  const responseFile = resolve(pendingDir, "response.txt");

  await mkdir(pendingDir, { recursive: true });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const content = await readFile(responseFile, "utf-8");
      const trimmed = content.trim().toUpperCase();
      if (trimmed === "YES" || trimmed === "NO") {
        return trimmed;
      }
    } catch {
      // File doesn't exist yet — keep polling
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return "TIMEOUT";
}

/**
 * Notifies all participants of a decline/timeout.
 * @param {Object} proposal
 * @param {string} reason
 */
async function notifyDecline(proposal, reason) {
  const config = (await import("./config.mjs")).loadConfig();

  for (const participantId of proposal.participants) {
    if (participantId === config.agentId) continue;

    const peer = config.peers.find((p) => p.name === participantId);
    if (!peer) continue;

    let peerThreadUrl;
    if (peer.threadUrl) {
      peerThreadUrl = peer.threadUrl;
    } else {
      const substituted = peer.url.replace(/:18801\b/, ":18802");
      if (substituted === peer.url) {
        console.warn(`[thread-notify] Could not substitute port for peer ${participantId} — threadUrl not set and port 18801 not found in url. Using url as-is.`);
      }
      peerThreadUrl = substituted;
    }

    try {
      await fetch(`${peerThreadUrl}/mesh/thread/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${peer.token}`,
        },
        body: JSON.stringify({
          threadId: proposal.threadId,
          agentId: config.agentId,
          reason,
        }),
      });
    } catch (err) {
      console.error(`[thread-notify] Failed to notify ${participantId} of decline:`, err.message);
    }
  }
}

/**
 * Cleans up pending proposal directory.
 * @param {string} threadId
 */
async function cleanupPending(threadId) {
  const { rm } = await import("node:fs/promises");
  const pendingDir = resolve(THREADS_DIR, "pending", threadId);
  try {
    await rm(pendingDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

/**
 * Full notification flow: notify user, poll for response, act on result.
 * @param {Object} proposal - Thread proposal
 * @param {string[]} acceptedAgents - Agents that accepted
 * @returns {Promise<{approved: boolean, thread?: Object}>}
 */
export async function notifyAndAwaitApproval(proposal, acceptedAgents) {
  const text = formatNotification(proposal, acceptedAgents);

  console.log(`[thread-notify] Notifying user for thread ${proposal.threadId}`);
  await sendSystemEvent(text);

  // Write the notification to a file so it's visible in the filesystem too
  const pendingDir = resolve(THREADS_DIR, "pending", proposal.threadId);
  await mkdir(pendingDir, { recursive: true });
  await writeFile(resolve(pendingDir, "notification.txt"), text, "utf-8");

  const response = await pollForResponse(proposal.threadId);

  if (response === "YES") {
    console.log(`[thread-notify] User approved thread ${proposal.threadId}`);
    const thread = await openThread(proposal);
    await cleanupPending(proposal.threadId);
    return { approved: true, thread };
  }

  const reason = response === "TIMEOUT" ? "User approval timed out" : "User declined";
  console.log(`[thread-notify] ${reason} for thread ${proposal.threadId}`);
  await notifyDecline(proposal, reason);
  await cleanupPending(proposal.threadId);
  return { approved: false };
}
