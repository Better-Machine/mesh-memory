/**
 * @module a2a-palace-adapter-test
 * @description Unit tests for a2a-palace-adapter.mjs
 */

import { loadPalaceContext, publishToPeers } from "../a2a-palace-adapter.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

function assertDefined(value, message) {
  if (value === undefined || value === null) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function testLoadPalaceContext() {
  console.log("\n📋 Testing loadPalaceContext...");

  const ctx = await loadPalaceContext();

  // Check structure
  assertDefined(ctx, "Context should be defined");
  assertDefined(ctx.passport, "Context should have passport");
  assert(Array.isArray(ctx.facts), "Context should have facts array");
  assert(typeof ctx.tokenEstimate === "number", "Context should have tokenEstimate number");

  // Check passport fields
  const passport = ctx.passport;
  assert(passport.version, "Passport should have version");
  assert(passport.agent, "Passport should have agent");
  assert(passport.agent.id, "Passport should have agent.id");
  assert(passport.capabilities, "Passport should have capabilities");

  console.log("  ✅ loadPalaceContext returns valid palace data");
  console.log(`     - Agent: ${passport.agent.id} (${passport.agent.name})`);
  console.log(`     - Capabilities: ${passport.capabilities.length}`);
  console.log(`     - Critical facts: ${ctx.facts.length}`);
  console.log(`     - Token estimate: ${ctx.tokenEstimate}`);
}

async function testPublishToPeers() {
  console.log("\n📋 Testing publishToPeers...");

  // Create a valid test fact
  const testFact = {
    id: "test-fact-001",
    tier: "critical",
    category: "test",
    type: "observation",
    content: { title: "Test Fact", body: "This is a test fact for A2A adapter" },
    provenance: { source: "test", timestamp: new Date().toISOString() },
    updated_at: new Date().toISOString()
  };

  // Mock peer that will fail (no real server)
  const mockPeers = [
    { url: "http://192.0.2.1:18803", token: "test-token" }  // TEST-NET-1 address, won't respond
  ];

  const results = await publishToPeers(testFact, mockPeers);

  // Check structure
  assert(Array.isArray(results.success), "Results should have success array");
  assert(Array.isArray(results.failed), "Results should have failed array");

  // Should have 1 failed (mock peer won't respond)
  assertEqual(results.failed.length, 1, "Should have 1 failed publish to mock peer");
  assert(results.failed[0].url.includes("192.0.2.1"), "Failed entry should have peer URL");

  console.log("  ✅ publishToPeers handles failures gracefully");
}

async function testPublishWithNoPeers() {
  console.log("\n📋 Testing publishToPeers with no peers...");

  const testFact = {
    id: "test-fact-002",
    tier: "critical",
    content: { title: "Test", body: "Test" },
    provenance: { source: "test", timestamp: new Date().toISOString() }
  };

  const results = await publishToPeers(testFact, []);

  assertEqual(results.success.length, 0, "No peers should result in 0 successes");
  assertEqual(results.failed.length, 0, "No peers should result in 0 failures");

  console.log("  ✅ publishToPeers handles empty peers array");
}

async function testPublishWithInvalidFact() {
  console.log("\n📋 Testing publishToPeers with invalid fact...");

  const invalidFact = { invalid: true };  // Missing required fields
  const mockPeers = [{ url: "http://192.0.2.1:18803", token: "test" }];

  let threw = false;
  let errorMessage = "";
  try {
    await publishToPeers(invalidFact, mockPeers);
  } catch (err) {
    threw = true;
    errorMessage = err.message;
  }

  assert(threw, "Should throw for invalid fact");
  assert(errorMessage.includes("Invalid fact"), "Should report invalid fact error");

  console.log("  ✅ publishToPeers throws for invalid fact");
}

async function testFactStructureValidation() {
  console.log("\n📋 Testing fact validation...");

  const testCases = [
    { fact: null, shouldThrow: true, desc: "null fact" },
    { fact: {}, shouldThrow: true, desc: "empty object" },
    { fact: { id: "test" }, shouldThrow: true, desc: "missing tier" },
    { fact: { id: "test", tier: "critical" }, shouldThrow: true, desc: "missing content" },
    { fact: { id: "test", tier: "critical", content: {} }, shouldThrow: true, desc: "missing provenance" },
    { fact: { 
        id: "test", 
        tier: "critical", 
        content: {}, 
        provenance: {} 
      }, shouldThrow: true, desc: "provenance without source" },
  ];

  for (const tc of testCases) {
    try {
      await publishToPeers(tc.fact, []);
      if (tc.shouldThrow) {
        throw new Error(`Expected ${tc.desc} to throw`);
      }
    } catch (err) {
      if (!tc.shouldThrow) {
        throw new Error(`Expected ${tc.desc} NOT to throw, got: ${err.message}`);
      }
    }
  }

  console.log("  ✅ Fact validation works correctly");
}

// ── Main Test Runner ─────────────────────────────────────────────────────────
async function runTests() {
  console.log("🧪 Running a2a-palace-adapter tests...\n");

  try {
    await testLoadPalaceContext();
    await testPublishWithNoPeers();
    await testPublishWithInvalidFact();
    await testFactStructureValidation();
    await testPublishToPeers();

    console.log("\n✅ All tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
