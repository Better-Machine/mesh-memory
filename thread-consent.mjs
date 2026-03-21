/**
 * @module thread-consent
 * @description Express router handling inbound thread proposals from peer agents.
 * Evaluates proposals and responds with accept/decline.
 */

import { Router } from "express";

/** @type {Map<string, Object>} In-memory store of pending/active proposals */
const proposals = new Map();

/**
 * Creates the thread consent router.
 * @param {Object} config - Mesh-memory config
 * @returns {Router} Express router
 */
export function createConsentRouter(config) {
  const router = Router();

  /** POST /mesh/thread/propose — receive and evaluate a proposal */
  router.post("/mesh/thread/propose", (req, res) => {
    const proposal = req.body;

    if (!proposal || !proposal.threadId || !proposal.proposingAgent || !proposal.purpose) {
      return res.status(400).json({ error: "Invalid proposal payload" });
    }

    if (proposals.has(proposal.threadId)) {
      return res.status(409).json({ error: "Proposal already exists", threadId: proposal.threadId });
    }

    // Store proposal with metadata
    proposals.set(proposal.threadId, {
      ...proposal,
      receivedAt: new Date().toISOString(),
      status: "pending",
      respondedAt: null,
    });

    console.log(
      `[thread-consent] Received proposal ${proposal.threadId} from ${proposal.proposingAgent}: "${proposal.purpose}"`
    );

    // Consent logic: auto-accept all proposals for now (placeholder)
    // Future: check purpose against known project scopes in config,
    // queue for manual review if no match
    const accepted = true;

    const entry = proposals.get(proposal.threadId);
    entry.status = accepted ? "accepted" : "pending-review";
    entry.respondedAt = new Date().toISOString();

    console.log(
      `[thread-consent] Auto-accepted proposal ${proposal.threadId}`
    );

    return res.json({
      threadId: proposal.threadId,
      accepted,
      agentId: config.agentId,
    });
  });

  /** POST /mesh/thread/accept — peer confirms acceptance */
  router.post("/mesh/thread/accept", (req, res) => {
    const { threadId, agentId } = req.body || {};

    if (!threadId || !agentId) {
      return res.status(400).json({ error: "Missing threadId or agentId" });
    }

    const entry = proposals.get(threadId);
    if (!entry) {
      return res.status(404).json({ error: "Unknown thread", threadId });
    }

    if (!entry.acceptances) entry.acceptances = [];
    if (!entry.acceptances.includes(agentId)) {
      entry.acceptances.push(agentId);
    }

    console.log(`[thread-consent] ${agentId} accepted thread ${threadId}`);
    return res.json({ ok: true, threadId });
  });

  /** POST /mesh/thread/decline — peer declines with reason */
  router.post("/mesh/thread/decline", (req, res) => {
    const { threadId, agentId, reason } = req.body || {};

    if (!threadId || !agentId) {
      return res.status(400).json({ error: "Missing threadId or agentId" });
    }

    const entry = proposals.get(threadId);
    if (!entry) {
      return res.status(404).json({ error: "Unknown thread", threadId });
    }

    entry.status = "declined";
    entry.declinedBy = agentId;
    entry.declineReason = reason || "No reason given";

    console.log(`[thread-consent] ${agentId} declined thread ${threadId}: ${entry.declineReason}`);
    return res.json({ ok: true, threadId });
  });

  /** GET /mesh/thread/status/:threadId — returns current thread state */
  router.get("/mesh/thread/status/:threadId", (req, res) => {
    const entry = proposals.get(req.params.threadId);
    if (!entry) {
      return res.status(404).json({ error: "Unknown thread", threadId: req.params.threadId });
    }
    return res.json(entry);
  });

  return router;
}

/**
 * Returns the in-memory proposals map (for use by other modules).
 * @returns {Map<string, Object>}
 */
export function getProposals() {
  return proposals;
}
