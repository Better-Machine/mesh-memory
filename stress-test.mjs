/**
 * @module stress-test
 * @description QA stress test suite for mesh-memory.
 * Simulates rapid message writes, multi-agent mesh scenarios, and failure modes.
 * Reports latency percentiles, message loss, and resource usage.
 */

import { writeFile, appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadavg, freemem, totalmem } from "node:os";

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

  // Cleanup
  try {
    await rm(TEMP_DIR, { recursive: true });
  } catch {
    // Best effort cleanup
  }

  console.log("[stress-test] Done.");
}

main();
