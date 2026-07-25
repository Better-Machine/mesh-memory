/**
 * @module fleet-accuracy
 * @description Phase 2.6 — fleet-wide verification helpers for the recurring
 * cron jobs.
 *
 * Companion to REQUIREMENTS-fleet-audit.md.
 *
 * Reuses the Phase 2.5 verification pattern (lib/dream-cycle-accuracy.mjs) and
 * adds new helpers for the other high-risk cron jobs:
 *   - verifyDaemon(port)
 *   - verifyCronJob(jobId)
 *   - verifyPR(repo, number)
 *   - verifyProcess(pid)
 *   - checkGatewayRestartMarker()
 *   - detectStaleConsolidationEntries({oldDaily, newDaily})
 *
 * Test surface: tests/fleet-accuracy.test.mjs
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

const execFileP = promisify(execFile);

// ============================================================
// verifyDaemon: check that a port is listening
// ============================================================

/**
 * @param {number} port
 * @returns {Promise<{status: "ok"|"stale", port: number, listener: string|null, error?: string}>}
 */
export async function verifyDaemon(port) {
  try {
    const { stdout } = await execFileP("ss", ["-tlnp"], { timeout: 3000 });
    const line = stdout.toString().split("\n").find(l => l.includes(`:${port}`));
    if (!line) {
      return { status: "stale", port, listener: null };
    }
    // Extract the PID from the "users:((\"node\",pid=4169961,fd=21))" pattern
    const pidMatch = /pid=(\d+)/.exec(line);
    const listener = pidMatch ? `pid=${pidMatch[1]}` : "unknown";
    return { status: "ok", port, listener };
  } catch (e) {
    return { status: "stale", port, listener: null, error: e.message };
  }
}

// ============================================================
// verifyProcess: check that a PID is running
// ============================================================

/**
 * @param {number} pid
 * @returns {Promise<{status: "ok"|"stale", pid: number, error?: string}>}
 */
export async function verifyProcess(pid) {
  try {
    const { stdout } = await execFileP("ps", ["-p", String(pid), "-o", "pid="], { timeout: 3000 });
    const found = stdout.toString().trim();
    if (found === String(pid)) {
      return { status: "ok", pid };
    }
    return { status: "stale", pid };
  } catch {
    return { status: "stale", pid };
  }
}

// ============================================================
// verifyCronJob: check the state of a cron job
// ============================================================

/**
 * @param {string} jobId
 * @returns {Promise<{status: "ok"|"stale"|"error", lastRunAt?: string, lastStatus?: string, error?: string}>}
 */
export async function verifyCronJob(jobId) {
  try {
    const { stdout } = await execFileP("openclaw", ["cron", "get", jobId], { timeout: 5000 });
    const job = JSON.parse(stdout.toString());
    const state = job.state || {};
    const lastStatus = state.lastStatus || state.lastRunStatus;
    if (lastStatus === "ok") {
      return {
        status: "ok",
        lastRunAt: state.lastRunAtMs ? new Date(state.lastRunAtMs).toISOString() : null,
        lastStatus,
      };
    }
    return {
      status: "stale",
      lastRunAt: state.lastRunAtMs ? new Date(state.lastRunAtMs).toISOString() : null,
      lastStatus,
    };
  } catch (e) {
    return { status: "error", error: e.message };
  }
}

// ============================================================
// verifyPR: check the state of a GitHub PR
// ============================================================

const TOKEN_PATHS = [
  "/home/erik-ross/.openclaw/secrets/liz-better-machine-token.txt",
  "/home/erik-ross/.config/gh/hosts.yml",
];

async function loadGitHubToken() {
  for (const p of TOKEN_PATHS) {
    if (!existsSync(p)) continue;
    try {
      if (p.endsWith(".yml")) {
        const yaml = await import("yaml").catch(() => null);
        if (yaml) {
          const d = yaml.default ? yaml.default.parse(await readFile(p, "utf-8")) : yaml.parse(await readFile(p, "utf-8"));
          return d?.github?.com?.oauth_token || null;
        }
        // Fall back to a simple line-based parse for hosts.yml
        const text = await readFile(p, "utf-8");
        const m = /oauth_token:\s*(\S+)/.exec(text);
        return m ? m[1] : null;
      }
      return (await readFile(p, "utf-8")).trim();
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * @param {string} repo
 * @param {number} number
 * @returns {Promise<{status: "ok"|"stale", state?: string, html_url?: string, mergedAt?: string, error?: string}>}
 */
export async function verifyPR(repo, number) {
  const token = await loadGitHubToken();
  if (!token) {
    return { status: "stale", error: "no GitHub token available" };
  }
  try {
    const { stdout } = await execFileP("curl", [
      "-sS", "-m", "5",
      "-H", `Authorization: Bearer ${token}`,
      "-H", "Accept: application/vnd.github+json",
      "-H", "X-GitHub-Api-Version: 2022-11-28",
      `https://api.github.com/repos/${repo}/pulls/${number}`,
    ], { timeout: 6000 });
    const pr = JSON.parse(stdout.toString());
    if (pr.state === "open") {
      return { status: "ok", state: "open", html_url: pr.html_url };
    }
    if (pr.state === "closed" && pr.merged) {
      return { status: "stale", state: "merged", mergedAt: pr.merged_at, html_url: pr.html_url };
    }
    if (pr.state === "closed" && !pr.merged) {
      return { status: "stale", state: "closed", html_url: pr.html_url };
    }
    return { status: "stale", error: `unknown state: ${pr.state}` };
  } catch (e) {
    return { status: "stale", error: e.message };
  }
}

// ============================================================
// checkGatewayRestartMarker: detect if a recent restart happened
// ============================================================

/**
 * @returns {Promise<{markerExists: boolean, path: string}>}
 */
export async function checkGatewayRestartMarker() {
  const path = "/tmp/gateway-restart-marker";
  return {
    markerExists: existsSync(path),
    path,
  };
}

// ============================================================
// detectStaleConsolidationEntries: find [HIGH] entries that are
// contradicted by a more recent daily
// ============================================================

/**
 * @param {Object} input
 * @param {string} input.oldDaily   - Content of the older daily log
 * @param {string} input.newDaily   - Content of the newer daily log
 * @returns {Promise<string[]>}     - Array of stale [HIGH] entry bodies
 */
export async function detectStaleConsolidationEntries(input) {
  const { oldDaily, newDaily } = input;
  const oldEntries = parseHighEntries(oldDaily);
  const newEntries = parseHighEntries(newDaily);
  const stale = [];

  for (const old of oldEntries) {
    // Check if the new daily mentions the same topic. Two heuristics:
    //  1. Same first 30 chars of the heading (case-insensitive)
    //  2. Same key noun (e.g., "PID 7332" mentioned in new, contradicting
    //     a "PID 7332 is X" claim in old)
    const oldKey = old.heading.toLowerCase().slice(0, 30);
    const oldPids = extractPids(old.heading + " " + old.body);
    const newPids = extractPids(newDaily);

    const contradicted =
      newEntries.some(n => n.heading.toLowerCase().slice(0, 30) === oldKey) ||
      oldPids.some(pid => newDaily.toLowerCase().includes(`${pid} is not running`) ||
                          newDaily.toLowerCase().includes(`killed ${pid}`) ||
                          newDaily.toLowerCase().includes(`killed pid ${pid}`));

    if (contradicted) {
      stale.push(old.body.trim() || old.heading);
    }
  }
  return stale;
}

function extractPids(text) {
  const out = new Set();
  const re = /PID\s+(\d+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.add(Number(m[1]));
  }
  return [...out];
}

function parseHighEntries(log) {
  const entries = [];
  const lines = log.split("\n");
  let current = null;
  for (const line of lines) {
    const m = /^##\s+\[HIGH\]\s+(.+)$/.exec(line);
    if (m) {
      if (current) entries.push(current);
      current = { heading: m[1], body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) entries.push(current);
  return entries;
}
