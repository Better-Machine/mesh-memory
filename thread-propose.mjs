/**
 * @module thread-propose
 * @description Sends thread proposals to peer agents via standalone HTTP.
 * No A2A dependency — uses direct HTTP POST to peer thread endpoints.
 */

import { randomUUID, randomBytes } from "node:crypto";
import { loadConfig } from "./config.mjs";

/**
 * Creates a thread proposal payload.
 * @param {Object} opts
 * @param {string} opts.purpose - One sentence describing the thread purpose
 * @param {string} opts.scope - What will be shared
 * @param {string[]} opts.participants - Agent IDs (including proposer)
 * @param {string} [opts.closingCondition] - "task complete" | "user closes" | "timeout:Xh"
 * @param {number} [opts.timeoutHours] - Thread timeout in hours (default 4)
 * @returns {Object} Proposal payload
 */
export function createProposal({ purpose, scope, participants, closingCondition = "task complete", timeoutHours = 4 }) {
  const config = loadConfig();
  return {
    threadId: randomUUID(),
    proposingAgent: config.agentId,
    purpose,
    scope,
    participants,
    closingCondition,
    timeoutHours,
    proposedAt: new Date().toISOString(),
  };
}

/**
 * Sends a proposal to a single peer.
 * @param {Object} peer - Peer config { name, url, token }
 * @param {Object} proposal - Proposal payload
 * @param {number} timeoutMs - Request timeout in ms
 * @returns {Promise<{agentId: string, status: "accepted"|"declined"|"timedOut", reason?: string}>}
 */
async function sendToPeer(peer, proposal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Peer thread endpoint URL: use explicit threadUrl if configured, else fall back to port substitution
  let peerThreadUrl;
  if (peer.threadUrl) {
    peerThreadUrl = peer.threadUrl;
  } else {
    const substituted = peer.url.replace(/:18804\b/, ":18802");
    if (substituted === peer.url) {
      console.warn(`[thread-propose] Could not substitute port for peer ${peer.name} — threadUrl not set and port 18801 not found in url. Using url as-is.`);
    }
    peerThreadUrl = substituted;
  }

  try {
    const res = await fetch(`${peerThreadUrl}/mesh/thread/propose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${peer.token}`,
      },
      body: JSON.stringify(proposal),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[thread-propose] ${peer.name} responded ${res.status}: ${body}`);
      return { agentId: peer.name, status: "declined", reason: `HTTP ${res.status}` };
    }

    const body = await res.json();
    return {
      agentId: peer.name,
      status: body.accepted ? "accepted" : "declined",
      reason: body.reason || undefined,
    };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error(`[thread-propose] ${peer.name} timed out after ${timeoutMs}ms`);
      return { agentId: peer.name, status: "timedOut" };
    }
    console.error(`[thread-propose] ${peer.name} error:`, err.message);
    return { agentId: peer.name, status: "timedOut", reason: err.message };
  }
}

/**
 * Proposes a thread to all relevant peers.
 * @param {Object} proposal - Proposal payload from createProposal()
 * @param {Object} [opts]
 * @param {number} [opts.peerTimeoutMs] - Timeout per peer in ms (default 60000)
 * @returns {Promise<{accepted: string[], declined: string[], timedOut: string[], consensus: boolean}>}
 */
export async function proposeThread(proposal, { peerTimeoutMs = 60000 } = {}) {
  const config = loadConfig();

  // Filter peers to only those listed as participants (excluding self)
  const targetPeers = config.peers.filter(
    (p) => proposal.participants.includes(p.name) && p.name !== config.agentId
  );

  if (targetPeers.length === 0) {
    console.warn("[thread-propose] No peers to propose to");
    return { accepted: [], declined: [], timedOut: [], consensus: false };
  }

  console.log(
    `[thread-propose] Proposing thread ${proposal.threadId} to: ${targetPeers.map((p) => p.name).join(", ")}`
  );

  const results = await Promise.all(
    targetPeers.map((peer) => sendToPeer(peer, proposal, peerTimeoutMs))
  );

  const accepted = results.filter((r) => r.status === "accepted").map((r) => r.agentId);
  const declined = results.filter((r) => r.status === "declined").map((r) => r.agentId);
  const timedOut = results.filter((r) => r.status === "timedOut").map((r) => r.agentId);

  // Log declined reasons
  for (const r of results) {
    if (r.status === "declined" && r.reason) {
      console.log(`[thread-propose] ${r.agentId} declined: ${r.reason}`);
    }
  }

  const consensus = declined.length === 0 && timedOut.length === 0 && accepted.length > 0;

  if (consensus) {
    console.log(`[thread-propose] Consensus reached for thread ${proposal.threadId}`);
  }

  return { accepted, declined, timedOut, consensus };
}
