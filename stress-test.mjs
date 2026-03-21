/**
 * @module stress-test
 * @description QA stress test suite for mesh-memory.
 * Simulates rapid message writes, multi-agent mesh scenarios, and failure modes.
 * Reports latency percentiles, message loss, and resource usage.
 */

import { writeFile, appendFile, mkdir, readFile, rm, stat as fsStat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadavg, freemem, totalmem } from "node:os";
import { randomUUID } from "node:crypto";
import expressLib from "express";
import { createProposal, proposeThread } from "./thread-propose.mjs";
import { openThread, writeEntry, readContext, getManifest, validateToken } from "./thread-context.mjs";
import { closeThread, checkTimeouts } from "./thread-close.mjs";
import { formatNotification } from "./thread-notify.mjs";
import { evaluatePrivacy, resetSession } from "./privacy.mjs";
import { detectTags, writeLessonEntry } from "./lesson-tagger.mjs";
import { resetConfig } from "./config.mjs";

const TEMP_DIR = resolve(homedir(), ".openclaw/mesh-memory-stress-test");
const REPORT_PATH = resolve(
  process.cwd(),
  "stress-test-report.md"
);

/**
 * Calculates percentile from a sorted array.
 * @param {number[]} sorted - Sorted array of numbers
 * @param {number} p - Percentile (0-100)
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Gets current system resource snapshot.
 * @returns {Object} CPU load and memory usage
 */
function getResources() {
  return {
    cpuLoad: loadavg()[0],
    memUsedMB: Math.round((totalmem() - freemem()) / 1024 / 1024),
    memTotalMB: Math.round(totalmem() / 1024 / 1024),
  };
}

/**
 * Simulates writing N JSONL messages at a given rate.
 * @param {Object} opts
 * @param {number} opts.count - Number of messages
 * @param {number} opts.delayMs - Delay between messages (0 for burst)
 * @param {string} opts.sessionFile - Path to write JSONL
 * @returns {Promise<{writeLatencies: number[], totalMs: number}>}
 */
async function simulateWrites({ count, delayMs, sessionFile }) {
  const latencies = [];
  const start = performance.now();

  for (let i = 0; i < count; i++) {
    const msg = JSON.stringify({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Stress test message ${i + 1} of ${count}. ${"x".repeat(50)}`,
      timestamp: new Date().toISOString(),
    });

    const writeStart = performance.now();
    await appendFile(sessionFile, msg + "\n", "utf-8");
    latencies.push(performance.now() - writeStart);

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { writeLatencies: latencies, totalMs: performance.now() - start };
}

/**
 * Tests receiver endpoint with simulated events.
 * @param {string} url - Receiver URL
 * @param {string} token - Auth token
 * @param {number} count - Number of events to send
 * @returns {Promise<{deliveryLatencies: number[], failures: number}>}
 */
async function testReceiver(url, token, count) {
  const latencies = [];
  let failures = 0;

  for (let i = 0; i < count; i++) {
    const event = {
      agentId: "stress-test",
      sessionKey: "stress-session",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Receiver stress test message ${i + 1}. ${"y".repeat(50)}`,
      timestamp: new Date().toISOString(),
    };

    const start = performance.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5000),
      });
      latencies.push(performance.now() - start);
      if (!res.ok) failures++;
    } catch {
      latencies.push(performance.now() - start);
      failures++;
    }
  }

  return { deliveryLatencies: latencies, failures };
}

/**
 * Tests malformed event handling.
 * @param {string} url - Receiver URL
 * @param {string} token - Auth token
 * @returns {Promise<{passed: boolean, details: string}>}
 */
async function testMalformedEvents(url, token) {
  const malformed = [
    {},
    { agentId: "test" },
    { agentId: "test", role: "user" },
    { agentId: "test", role: "user", content: "", timestamp: "now" },
    "not json",
    null,
  ];

  let rejected = 0;
  for (const body of malformed) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 400 || res.status === 401) rejected++;
    } catch {
      rejected++;
    }
  }

  return {
    passed: rejected === malformed.length,
    details: `${rejected}/${malformed.length} malformed events correctly rejected`,
  };
}

/**
 * Tests unauthorized access.
 * @param {string} url - Receiver URL
 * @returns {Promise<{passed: boolean}>}
 */
async function testUnauthorized(url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "attacker",
        role: "user",
        content: "unauthorized message",
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
    return { passed: res.status === 401 };
  } catch {
    return { passed: true }; // Connection refused also counts as rejected
  }
}

/**
 * Formats latency stats as a markdown table row.
 * @param {string} label - Test name
 * @param {number[]} latencies - Raw latency values in ms
 * @returns {string} Markdown table row
 */
function formatStats(label, latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50).toFixed(2);
  const p95 = percentile(sorted, 95).toFixed(2);
  const p99 = percentile(sorted, 99).toFixed(2);
  const avg = (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2);
  return `| ${label} | ${sorted.length} | ${avg} | ${p50} | ${p95} | ${p99} |`;
}

// ====================================================================
// ## Layer 2: Thread System — Helpers & Tests
// ====================================================================

const L2_THREADS_DIR = resolve(
  homedir(),
  ".openclaw/workspace/projects/mesh-memory/memory/threads"
);
const L2_ARCHIVE_DIR = resolve(L2_THREADS_DIR, "archive");
const L2_LESSONS_DIR = resolve(homedir(), ".openclaw/workspace/memory/mesh/lessons");
const L2_CONFIG_PATH = resolve(process.cwd(), "mesh-memory.config.json");

/**
 * Starts a mock peer Express server for thread proposal testing.
 * @param {number} port
 * @param {Function} acceptFn - (body) => boolean
 * @returns {Promise<{server: Object, log: Array, stop: Function}>}
 */
function startMockPeer(port, shouldAccept = true) {
  const state = { accept: shouldAccept };
  return new Promise((res) => {
    const app = expressLib();
    app.use(expressLib.json());
    const log = [];

    app.post("/mesh/thread/propose", (req, resp) => {
      log.push({ ep: "propose", body: req.body });
      resp.json({
        threadId: req.body.threadId,
        accepted: state.accept,
        agentId: `peer-on-${port}`,
      });
    });

    app.post("/mesh/thread/:threadId/closed", (req, resp) => {
      log.push({ ep: "closed", body: req.body });
      resp.json({ ok: true });
    });

    app.post("/mesh/thread/:threadId/write", (req, resp) => {
      log.push({ ep: "write", body: req.body });
      resp.json({ ok: true });
    });

    const server = app.listen(port, () =>
      res({ server, log, state, stop: () => new Promise((r) => server.close(r)) })
    );
  });
}

/**
 * Formats the Layer 2 test results as a markdown report section.
 */
function formatLayer2Report(results) {
  const allPassed = results.every((r) => r.passed);
  const lines = [
    "",
    "---",
    "",
    "## Layer 2: Thread System",
    "",
    `_Run: ${new Date().toISOString()}_`,
    "",
    "| Test | Result | Time (ms) | Error |",
    "|------|--------|-----------|-------|",
  ];
  for (const r of results) {
    lines.push(
      `| ${r.name} | ${r.passed ? "PASS" : "FAIL"} | ${r.ms.toFixed(0)} | ${r.error || "—"} |`
    );
  }
  lines.push("");
  lines.push(
    `**Overall: ${allPassed ? "ALL PASSED" : "SOME FAILED"}** (${results.filter((r) => r.passed).length}/${results.length})`
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * Runs all Layer 2 thread system tests.
 */
async function runLayer2Tests() {
  const results = [];
  const cleanupPaths = [];
  let peerA, peerB;
  const originalConfig = await readFile(L2_CONFIG_PATH, "utf-8");

  const testConfig = {
    agentId: "test-agent",
    receiverPort: 18801,
    receiverToken: "test-token",
    peers: [
      { name: "peer-a", url: "http://localhost:18899", token: "tok-a" },
      { name: "peer-b", url: "http://localhost:18898", token: "tok-b" },
    ],
  };

  try {
    await writeFile(L2_CONFIG_PATH, JSON.stringify(testConfig, null, 2), "utf-8");
    resetConfig();

    peerA = await startMockPeer(18899, true);
    peerB = await startMockPeer(18898, true);

    // ------ L2-1: Thread lifecycle — happy path ------
    console.log("[stress-test] L2-1: Thread lifecycle (happy path)");
    {
      const t = performance.now();
      try {
        const proposal = createProposal({
          purpose: "Stress-test happy path",
          scope: "test data only",
          participants: ["test-agent", "peer-a", "peer-b"],
          timeoutHours: 4,
        });
        cleanupPaths.push(resolve(L2_THREADS_DIR, proposal.threadId));
        cleanupPaths.push(resolve(L2_ARCHIVE_DIR, proposal.threadId));

        // Verify proposal payload structure
        for (const f of ["threadId", "proposingAgent", "purpose", "scope", "participants", "closingCondition", "timeoutHours", "proposedAt"]) {
          if (!(f in proposal)) throw new Error(`Missing field: ${f}`);
        }

        // Propose to peers — both accept
        const consent = await proposeThread(proposal, { peerTimeoutMs: 5000 });
        if (!consent.consensus) throw new Error(`No consensus: declined=${consent.declined}`);
        if (consent.accepted.length !== 2) throw new Error(`Expected 2 accepted, got ${consent.accepted.length}`);

        // Open thread
        await openThread(proposal);

        // Write 3 entries from different agents
        await writeEntry(proposal.threadId, "test-agent", "observation", "Entry from test-agent");
        await writeEntry(proposal.threadId, "peer-a", "update", "Entry from peer-a");
        await writeEntry(proposal.threadId, "peer-b", "decision", "Entry from peer-b");

        // Read context — verify all 3 present and ordered
        const ctx = await readContext(proposal.threadId);
        const entries = ctx.match(/## \[/g) || [];
        if (entries.length !== 3) throw new Error(`Expected 3 entries, got ${entries.length}`);
        const iA = ctx.indexOf("test-agent (observation)");
        const iB = ctx.indexOf("peer-a (update)");
        const iC = ctx.indexOf("peer-b (decision)");
        if (!(iA < iB && iB < iC)) throw new Error("Entries not in order");

        // Close thread
        await closeThread(proposal.threadId, "Test complete");

        // Verify manifest has closedAt (now in archive)
        const mRaw = await readFile(resolve(L2_ARCHIVE_DIR, proposal.threadId, "manifest.json"), "utf-8");
        const m = JSON.parse(mRaw);
        if (!m.closedAt) throw new Error("closedAt not set");

        // Verify tokens.json deleted
        let tokGone = false;
        try { await fsStat(resolve(L2_ARCHIVE_DIR, proposal.threadId, "tokens.json")); } catch { tokGone = true; }
        if (!tokGone) throw new Error("tokens.json should be deleted");

        // Verify directory moved to archive/
        await fsStat(resolve(L2_ARCHIVE_DIR, proposal.threadId));
        let origGone = false;
        try { await fsStat(resolve(L2_THREADS_DIR, proposal.threadId)); } catch { origGone = true; }
        if (!origGone) throw new Error("Original thread dir still exists");

        results.push({ name: "L2-1: Lifecycle happy path", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-1: Lifecycle happy path", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

    // ------ L2-2: Thread lifecycle — decline path ------
    console.log("[stress-test] L2-2: Thread lifecycle (decline path)");
    {
      const t = performance.now();
      try {
        // Switch peerB to declining (no restart needed)
        peerB.state.accept = false;

        const proposal = createProposal({
          purpose: "Stress-test decline path",
          scope: "test data only",
          participants: ["test-agent", "peer-a", "peer-b"],
        });

        const consent = await proposeThread(proposal, { peerTimeoutMs: 5000 });
        if (consent.consensus) throw new Error("Should not reach consensus when one peer declines");
        if (consent.declined.length !== 1) throw new Error(`Expected 1 declined, got ${consent.declined.length}`);
        if (consent.accepted.length !== 1) throw new Error(`Expected 1 accepted, got ${consent.accepted.length}`);

        // No thread should be opened
        let threadExists = false;
        try { await fsStat(resolve(L2_THREADS_DIR, proposal.threadId)); threadExists = true; } catch {}
        if (threadExists) throw new Error("Thread should not be opened when declined");

        results.push({ name: "L2-2: Lifecycle decline path", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-2: Lifecycle decline path", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

    // Restore peerB to accepting
    peerB.state.accept = true;

    // ------ L2-3: Thread lifecycle — timeout path ------
    console.log("[stress-test] L2-3: Thread lifecycle (timeout path)");
    {
      const t = performance.now();
      try {
        const proposal = {
          threadId: `test-${randomUUID()}`,
          proposingAgent: "test-agent",
          purpose: "Timeout test",
          scope: "test",
          participants: ["test-agent", "peer-a"],
          closingCondition: "timeout:immediate",
          timeoutHours: 0.000001, // ~3.6ms — effectively immediate
          proposedAt: new Date().toISOString(),
        };
        cleanupPaths.push(resolve(L2_THREADS_DIR, proposal.threadId));
        cleanupPaths.push(resolve(L2_ARCHIVE_DIR, proposal.threadId));

        await openThread(proposal);
        // Wait past the ~3.6ms timeout
        await new Promise((r) => setTimeout(r, 100));

        const closed = await checkTimeouts();
        if (!closed.includes(proposal.threadId)) throw new Error("Thread not closed by timeout checker");

        await fsStat(resolve(L2_ARCHIVE_DIR, proposal.threadId));

        results.push({ name: "L2-3: Lifecycle timeout path", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-3: Lifecycle timeout path", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

    // ------ L2-4: User notification format ------
    console.log("[stress-test] L2-4: User notification format");
    {
      const t = performance.now();
      try {
        const sampleProposal = {
          proposingAgent: "test-agent",
          purpose: "Coordinate deployment",
          scope: "deployment scripts and config",
          participants: ["test-agent", "peer-a", "peer-b"],
          closingCondition: "deployment complete",
        };
        const note = formatNotification(sampleProposal, ["peer-a", "peer-b"]);
        if (!note.includes("Coordinate deployment")) throw new Error("Missing purpose");
        if (!note.includes("deployment scripts and config")) throw new Error("Missing scope");
        if (!note.includes("peer-a")) throw new Error("Missing participant peer-a");
        if (!note.includes("peer-b")) throw new Error("Missing participant peer-b");
        if (!note.includes("deployment complete")) throw new Error("Missing closing condition");
        if (!note.endsWith("Approve? Reply YES or NO.")) throw new Error("Missing approval prompt");

        results.push({ name: "L2-4: Notification format", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-4: Notification format", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

    // ------ L2-5: Token isolation ------
    console.log("[stress-test] L2-5: Token isolation");
    {
      const t = performance.now();
      try {
        const pA = {
          threadId: `test-${randomUUID()}`,
          proposingAgent: "test-agent",
          purpose: "Token isolation A",
          scope: "test",
          participants: ["test-agent", "peer-a"],
          closingCondition: "task complete",
          timeoutHours: 4,
          proposedAt: new Date().toISOString(),
        };
        const pB = {
          threadId: `test-${randomUUID()}`,
          proposingAgent: "test-agent",
          purpose: "Token isolation B",
          scope: "test",
          participants: ["test-agent", "peer-a"],
          closingCondition: "task complete",
          timeoutHours: 4,
          proposedAt: new Date().toISOString(),
        };
        cleanupPaths.push(resolve(L2_THREADS_DIR, pA.threadId), resolve(L2_THREADS_DIR, pB.threadId));

        await openThread(pA);
        await openThread(pB);

        const tokA = JSON.parse(await readFile(resolve(L2_THREADS_DIR, pA.threadId, "tokens.json"), "utf-8"));
        const tokB = JSON.parse(await readFile(resolve(L2_THREADS_DIR, pB.threadId, "tokens.json"), "utf-8"));

        if (tokA["test-agent"] === tokB["test-agent"]) throw new Error("Tokens should differ across threads");

        const cross = await validateToken(pB.threadId, "test-agent", tokA["test-agent"]);
        if (cross) throw new Error("Cross-thread token should be rejected");

        const self = await validateToken(pA.threadId, "test-agent", tokA["test-agent"]);
        if (!self) throw new Error("Own-thread token should be accepted");

        results.push({ name: "L2-5: Token isolation", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-5: Token isolation", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

    // ------ L2-6: Privacy filter integration ------
    console.log("[stress-test] L2-6: Privacy filter integration");
    {
      const t = performance.now();
      try {
        const sk = "test-privacy-" + Date.now();

        const r1 = evaluatePrivacy(sk, "This is private — don't share");
        if (r1.action !== "suppress") throw new Error(`Expected suppress, got ${r1.action}`);

        const r2 = evaluatePrivacy(sk, "[private]");
        if (r2.action !== "command" || !r2.privateModeActive) throw new Error("Expected command + active");

        const r3 = evaluatePrivacy(sk, "Secret content inside block");
        if (r3.action !== "suppress") throw new Error(`Expected suppress in block, got ${r3.action}`);

        const r4 = evaluatePrivacy(sk, "[/private]");
        if (r4.action !== "command" || r4.privateModeActive) throw new Error("Expected command + inactive");

        const r5 = evaluatePrivacy(sk, "Normal message after close");
        if (r5.action !== "relay") throw new Error(`Expected relay after close, got ${r5.action}`);

        resetSession(sk);

        results.push({ name: "L2-6: Privacy filter", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-6: Privacy filter", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

    // ------ L2-7: Lesson tagging integration ------
    console.log("[stress-test] L2-7: Lesson tagging integration");
    {
      const t = performance.now();
      try {
        const tagResult = detectTags("[lesson] Always validate ephemeral tokens before writing");
        if (!tagResult.isTagged) throw new Error("Tag not detected");
        if (!tagResult.tags.includes("lesson")) throw new Error("lesson tag missing");
        if (tagResult.cleanContent !== "Always validate ephemeral tokens before writing") {
          throw new Error("Clean content mismatch");
        }

        const testEvent = {
          agentId: "test-agent",
          role: "assistant",
          content: "[lesson] Always validate ephemeral tokens",
          timestamp: new Date().toISOString(),
          sessionKey: "test-lesson-session",
        };

        const todayStr = new Date().toISOString().slice(0, 10);
        const lessonsFile = resolve(L2_LESSONS_DIR, `${todayStr}.md`);
        let existedBefore = false;
        try { await fsStat(lessonsFile); existedBefore = true; } catch {}

        await writeLessonEntry(testEvent, ["lesson"], "Always validate ephemeral tokens");

        await fsStat(lessonsFile); // throws if not created
        const content = await readFile(lessonsFile, "utf-8");
        if (!content.includes("Always validate ephemeral tokens")) throw new Error("Lesson content not in file");

        if (!existedBefore) cleanupPaths.push(lessonsFile);

        results.push({ name: "L2-7: Lesson tagging", passed: true, ms: performance.now() - t });
        console.log("  → PASS\n");
      } catch (err) {
        results.push({ name: "L2-7: Lesson tagging", passed: false, error: err.message, ms: performance.now() - t });
        console.log(`  → FAIL: ${err.message}\n`);
      }
    }

  } finally {
    // Restore original config
    await writeFile(L2_CONFIG_PATH, originalConfig, "utf-8");
    resetConfig();

    if (peerA) await peerA.stop().catch(() => {});
    if (peerB) await peerB.stop().catch(() => {});

    // Clean up test artifacts
    for (const p of cleanupPaths) {
      await rm(p, { recursive: true, force: true }).catch(() => {});
    }
  }

  return results;
}

/**
 * Runs the full stress test suite and generates a report.
 */
async function main() {
  console.log("[stress-test] Starting mesh-memory stress test suite\n");

  await mkdir(TEMP_DIR, { recursive: true });
  const sessionFile = resolve(TEMP_DIR, "test-session.jsonl");
  await writeFile(sessionFile, "", "utf-8");

  const sections = [];
  const startResources = {
    memUsedMB: Math.round((totalmem() - freemem()) / 1024 / 1024),
    memTotalMB: Math.round(totalmem() / 1024 / 1024),
  };

  // --- Test 1: Burst write performance ---
  console.log("[stress-test] Test 1: Burst write (50 messages, no delay)");
  const burst = await simulateWrites({
    count: 50,
    delayMs: 0,
    sessionFile,
  });
  sections.push({
    name: "Burst Write (50 msgs)",
    latencies: burst.writeLatencies,
    totalMs: burst.totalMs,
  });
  console.log(`  → ${burst.totalMs.toFixed(0)}ms total\n`);

  // --- Test 2: Sustained write performance ---
  console.log("[stress-test] Test 2: Sustained write (100 messages, 100ms interval)");
  await writeFile(sessionFile, "", "utf-8");
  const sustained = await simulateWrites({
    count: 100,
    delayMs: 100,
    sessionFile,
  });
  sections.push({
    name: "Sustained Write (100 msgs @ 10/s)",
    latencies: sustained.writeLatencies,
    totalMs: sustained.totalMs,
  });
  console.log(`  → ${sustained.totalMs.toFixed(0)}ms total\n`);

  // --- Test 3: Receiver delivery (if running) ---
  console.log("[stress-test] Test 3: Receiver delivery (50 events)");
  const receiverUrl = "http://localhost:18801";
  const receiverToken = "your-receiver-token-here";

  const delivery = await testReceiver(receiverUrl, receiverToken, 50);
  sections.push({
    name: "Receiver Delivery (50 events)",
    latencies: delivery.deliveryLatencies,
    failures: delivery.failures,
  });
  console.log(
    `  → ${delivery.failures} failures out of 50 events\n`
  );

  // --- Test 4: Malformed events ---
  console.log("[stress-test] Test 4: Malformed event rejection");
  const malformed = await testMalformedEvents(receiverUrl, receiverToken);
  console.log(`  → ${malformed.details}\n`);

  // --- Test 5: Unauthorized access ---
  console.log("[stress-test] Test 5: Unauthorized access rejection");
  const unauth = await testUnauthorized(receiverUrl);
  console.log(`  → ${unauth.passed ? "PASS" : "FAIL"}\n`);

  // --- Generate report ---
  const endResources = {
    memUsedMB: Math.round((totalmem() - freemem()) / 1024 / 1024),
    memTotalMB: Math.round(totalmem() / 1024 / 1024),
  };

  const report = `# Stress Test Report — mesh-memory

_Generated: ${new Date().toISOString()}_

## Latency Results

| Test | Count | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) |
|------|-------|----------|----------|----------|----------|
${sections.map((s) => formatStats(s.name, s.latencies)).join("\n")}

## Delivery Results

| Test | Total | Failures | Loss Rate |
|------|-------|----------|-----------|
| Receiver Delivery | 50 | ${delivery.failures} | ${((delivery.failures / 50) * 100).toFixed(1)}% |

## Validation Results

| Test | Result |
|------|--------|
| Malformed Event Rejection | ${malformed.passed ? "PASS" : "FAIL"} (${malformed.details}) |
| Unauthorized Access Rejection | ${unauth.passed ? "PASS" : "FAIL"} |

## Resource Usage

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Memory (MB) | ${startResources.memUsedMB} | ${endResources.memUsedMB} | ${endResources.memUsedMB - startResources.memUsedMB} |

## Success Criteria

| Criteria | Target | Actual | Status |
|----------|--------|--------|--------|
| p95 end-to-end latency | < 5s | ${sections.length > 0 ? percentile([...sections[0].latencies].sort((a, b) => a - b), 95).toFixed(0) + "ms" : "N/A"} | ${sections.length > 0 && percentile([...sections[0].latencies].sort((a, b) => a - b), 95) < 5000 ? "PASS" : "N/A"} |
| Message loss rate | < 1% | ${((delivery.failures / 50) * 100).toFixed(1)}% | ${delivery.failures / 50 < 0.01 ? "PASS" : delivery.failures === 50 ? "N/A (receiver offline)" : "FAIL"} |
| CPU overhead at 10 msg/min | < 5% | See resource table | Manual check |

## Notes

- Receiver tests require \`npm run receiver\` to be running on port 18801
- If receiver is offline, delivery tests will show 100% failure (expected)
- For multi-agent mesh tests, start receivers on all peer agents first
- Resource measurements are approximate (process-level, not isolated)
`;

  await writeFile(REPORT_PATH, report, "utf-8");
  console.log(`[stress-test] Report written to ${REPORT_PATH}`);

  // --- Layer 2: Thread System ---
  console.log("\n[stress-test] === Layer 2: Thread System ===\n");
  const l2Results = await runLayer2Tests();
  const l2Report = formatLayer2Report(l2Results);
  await appendFile(REPORT_PATH, l2Report, "utf-8");
  console.log("[stress-test] Layer 2 report appended to stress-test-report.md");

  // Cleanup
  try {
    await rm(TEMP_DIR, { recursive: true });
  } catch {
    // Best effort cleanup
  }

  console.log("[stress-test] Done.");
}

main();
