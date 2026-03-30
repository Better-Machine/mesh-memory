/**
 * @module memory-receiver
 * @description Express HTTP server that accepts MemoryEvents from peers
 * and writes them to QMD-indexed markdown files.
 */

import express from "express";
import { mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";
import { detectTags, writeLessonEntry } from "./lesson-tagger.mjs";
import { receiveFromPeer } from "./shared-pool-sync.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

const MESH_DIR = resolve(homedir(), ".openclaw/workspace/memory/mesh");
const SHARED_GATES_DIR = resolve(homedir(), ".openclaw/workspace/memory/shared/gates");

/**
 * Validates incoming MemoryEvent structure.
 * @param {Object} body - Request body
 * @returns {string|null} Error message or null if valid
 */
function validateEvent(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object";
  if (!body.agentId || typeof body.agentId !== "string")
    return "Missing or invalid agentId";
  if (!body.role || typeof body.role !== "string")
    return "Missing or invalid role";
  if (!body.content || typeof body.content !== "string")
    return "Missing or invalid content";
  if (!body.timestamp || typeof body.timestamp !== "string")
    return "Missing or invalid timestamp";
  // M6: Validate timestamp is parseable ISO 8601
  const ts = new Date(body.timestamp);
  if (isNaN(ts.getTime())) return "Invalid timestamp — must be ISO 8601";
  return null;
}

/**
 * Formats a MemoryEvent as a markdown entry.
 * @param {Object} event - Validated MemoryEvent
 * @returns {string} Formatted markdown string
 */
function formatEntry(event) {
  const date = new Date(event.timestamp);
  const time = date.toTimeString().slice(0, 8);

  // Full context tag — who said it, where they said it
  const contextLine = event.fullTag
    ? ` ${event.fullTag}`
    : event.identityTag
      ? ` ${event.identityTag}${event.contextTag ? ` ${event.contextTag}` : ""}`
      : event.identity
        ? ` [${event.identity.name || "unknown"} / ${event.identity.role || "?"}]`
        : "";

  const tagLine = event.tags?.length
    ? `\n> tags: ${event.tags.map(t => `[${t}]`).join(" ")}`
    : "";

  return `## [${time}] ${event.agentId} (${event.role})${contextLine}${tagLine}\n${event.content}\n\n`;
}

/**
 * Returns the markdown file path for a given date.
 * @param {Date} date
 * @returns {string} Absolute file path
 */
function getFilePath(date) {
  const dateStr = date.toISOString().slice(0, 10);
  return resolve(MESH_DIR, `${dateStr}.md`);
}

/**
 * Starts the memory receiver HTTP server.
 */
async function main() {
  const config = loadConfig();
  const port = config.receiverPort;
  const token = config.receiverToken;

  await mkdir(MESH_DIR, { recursive: true });

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  /** Bearer token authentication middleware */
  app.use("/", (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${token}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });

  /** POST / — Receive a MemoryEvent */
  app.post("/", async (req, res) => {
    const error = validateEvent(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    try {
      const event = req.body;
      const filePath = getFilePath(new Date(event.timestamp));

      // ── Lesson / correction tagging ────────────────────────────────
      // Tags may have been detected at the source watcher, or we re-detect
      // here for events from agents that don't run the watcher.
      const tagResult = event.tags
        ? { tags: event.tags, isTagged: true, cleanContent: event.content }
        : detectTags(event.content);

      if (tagResult.isTagged) {
        // Write to lessons log
        await writeLessonEntry(
          { ...event, content: event.content },
          tagResult.tags,
          tagResult.cleanContent
        );
        console.log(
          `[receiver] 🏷  Lesson entry written: [${tagResult.tags.join(", ")}] from ${event.agentId}`
        );
      }

      // ── Write to main mesh log ─────────────────────────────────────
      const entry = formatEntry(event);
      await appendFile(filePath, entry, "utf-8");

      // ── Privacy hint logging ───────────────────────────────────────
      if (event.privacyHints && event.privacyHints.length > 0) {
        console.log(
          `[receiver] 🔍 Privacy signals from ${event.agentId}: ${event.privacyHints.join(", ")}`
        );
      }

      // ── Suggested tag logging ──────────────────────────────────────
      if (event.suggestedTag) {
        console.log(
          `[receiver] 💡 Source watcher suggests tagging as [${event.suggestedTag}]`
        );
      }

      console.log(
        `[receiver] Wrote ${event.agentId} (${event.role}) → ${filePath}`
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[receiver] Write error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /mesh/shared-pool — Receive a shared pool entry from a peer agent.
   * Returns 201 on success, 409 on duplicate ID, 400 on invalid entry.
   */
  app.post("/mesh/shared-pool", async (req, res) => {
    try {
      const entry = await receiveFromPeer(req.body);
      console.log(`[receiver] 🗂  Shared pool entry received: ${entry.id} (${entry.type})`);
      return res.status(201).json({ ok: true, id: entry.id });
    } catch (err) {
      if (err.code === "DUPLICATE") {
        return res.status(409).json({ error: "Duplicate entry ID", id: req.body?.id });
      }
      if (err.code === "INVALID") {
        return res.status(400).json({ error: err.message });
      }
      console.error("[receiver] Shared pool write error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /mesh/shared/gates — Publish a gate commitment for blind-gate protocol.
   * Peers write their gate commitments here instead of relaying tokens via chat.
   * Returns 201 on success, 409 if gate already exists for that agent+topic.
   */
  app.post("/mesh/shared/gates", async (req, res) => {
    try {
      const { topic, agentId, positionHash, token, expiresAt } = req.body || {};
      if (!topic || !agentId || !positionHash || !token) {
        return res.status(400).json({ error: "Missing required fields: topic, agentId, positionHash, token" });
      }

      const safeTopic = topic.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const safeAgent = agentId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const topicDir = resolve(SHARED_GATES_DIR, safeTopic);
      await mkdir(topicDir, { recursive: true });

      const gatePath = resolve(topicDir, `${safeAgent}.json`);

      if (existsSync(gatePath)) {
        return res.status(409).json({ error: "Gate already exists for this agent+topic" });
      }

      const gateData = {
        agentId,
        positionHash,
        token,
        expiresAt: expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        committed: true,
        committedAt: new Date().toISOString(),
      };

      await writeFile(gatePath, JSON.stringify(gateData, null, 2), "utf-8");
      console.log(`[receiver] Gate commitment published: ${agentId} on topic '${topic}'`);
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error("[receiver] Gate publish error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /mesh/shared/gates/:topic — List all committed gates for a topic.
   * Returns committed gates, filters out expired ones. Never returns position text.
   */
  app.get("/mesh/shared/gates/:topic", async (req, res) => {
    try {
      const safeTopic = req.params.topic.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const topicDir = resolve(SHARED_GATES_DIR, safeTopic);

      if (!existsSync(topicDir)) {
        return res.json([]);
      }

      const files = await readdir(topicDir);
      const now = Date.now();
      const gates = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const data = JSON.parse(await readFile(resolve(topicDir, file), "utf-8"));
          if (data.expiresAt && new Date(data.expiresAt).getTime() < now) continue;
          gates.push({
            agentId: data.agentId,
            positionHash: data.positionHash,
            token: data.token,
            expiresAt: data.expiresAt,
            committed: true,
          });
        } catch {
          continue;
        }
      }

      return res.json(gates);
    } catch (err) {
      console.error("[receiver] Gate list error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /** Health check — L1: omit agentId to avoid info disclosure on public probes */
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // M7: Attach error handler for port-in-use and other listen errors
  const srv = app.listen(port, () => {
    console.log(`[receiver] Agent: ${config.agentId}`);
    console.log(`[receiver] Listening on port ${port}`);
  });
  srv.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[receiver] Port ${port} is already in use. Is another receiver running?`);
    } else {
      console.error("[receiver] Server error:", err.message);
    }
    process.exit(1);
  });
}

main();
