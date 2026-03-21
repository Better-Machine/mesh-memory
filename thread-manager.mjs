/**
 * @module thread-manager
 * @description Orchestrator for the Layer 2 collaboration mesh.
 * Starts HTTP endpoints and background loops for the thread system.
 */

import express from "express";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { createConsentRouter } from "./thread-consent.mjs";
import { createContextRouter } from "./thread-context.mjs";
import { createCloseRouter, checkTimeouts } from "./thread-close.mjs";

const THREAD_PORT = 18802;

let server = null;
let timeoutInterval = null;

/**
 * Starts the thread manager — HTTP server + background loops.
 * @returns {Promise<{server: import("http").Server, stop: Function}>}
 */
export async function start() {
  const config = loadConfig();
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  // Bearer token auth — uses same receiver token for thread endpoints
  app.use("/mesh", (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${config.receiverToken}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });

  // Mount routers
  app.use(createConsentRouter(config));
  app.use(createContextRouter());
  app.use(createCloseRouter());

  // Health check (no auth)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agent: config.agentId, service: "thread-manager" });
  });

  // Start server
  server = await new Promise((resolve) => {
    const s = app.listen(THREAD_PORT, () => {
      console.log(`[thread-manager] Agent: ${config.agentId}`);
      console.log(`[thread-manager] Listening on port ${THREAD_PORT}`);
      console.log(`[thread-manager] Endpoints: /mesh/thread/propose, /mesh/thread/:id/write, /mesh/thread/:id/close`);
      resolve(s);
    });
  });

  // Background: check for timed-out threads every hour
  timeoutInterval = setInterval(async () => {
    try {
      const closed = await checkTimeouts();
      if (closed.length > 0) {
        console.log(`[thread-manager] Timeout check closed ${closed.length} thread(s)`);
      }
    } catch (err) {
      console.error("[thread-manager] Timeout check error:", err.message);
    }
  }, 3600000);

  console.log("[thread-manager] Timeout checker running (1h interval)");

  return { server, stop };
}

/**
 * Stops the thread manager.
 */
export async function stop() {
  if (timeoutInterval) {
    clearInterval(timeoutInterval);
    timeoutInterval = null;
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
    console.log("[thread-manager] Stopped");
  }
}

// Run directly
const __filename = new URL(import.meta.url).pathname;
if (process.argv[1] && __filename === resolve(process.argv[1])) {
  start().catch((err) => {
    console.error("[thread-manager] Failed to start:", err);
    process.exit(1);
  });
}
