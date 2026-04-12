/**
 * @file test-tunnel-publisher.mjs
 * @description Validation tests for tunnel-publisher.mjs
 */

import { TunnelPublisher, validateFact } from "./tunnel-publisher.mjs";

// Test results tracking
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;
const failures = [];

function test(name, fn) {
  testsRun++;
  try {
    fn();
    testsPassed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    testsFailed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, msg) {
  if (value !== true) {
    throw new Error(msg || "Expected true, got false");
  }
}

function assertFalse(value, msg) {
  if (value !== false) {
    throw new Error(msg || "Expected false, got true");
  }
}

console.log("\n========================================");
console.log("TUNNEL PUBLISHER TEST SUITE");
console.log("========================================\n");

// Test 1: Module import
test("Module imports successfully", () => {
  assertTrue(typeof TunnelPublisher === "function", "TunnelPublisher should be a class/function");
  assertTrue(typeof validateFact === "function", "validateFact should be exported");
});

// Test 2: Instantiate TunnelPublisher with mock config
test("TunnelPublisher instantiates with mock config", () => {
  const mockConfig = {
    peers: [{ url: "http://test.example.com", token: "test-token" }],
    localPort: 9999,
    token: "mock-token"
  };
  const publisher = new TunnelPublisher(mockConfig);
  assertEqual(publisher.peers.length, 1, "Should have 1 peer");
  assertEqual(publisher.localPort, 9999, "Should use provided port");
  assertEqual(publisher.token, "mock-token", "Should use provided token");
});

// Test 3: ValidateFact - valid fact passes
test("validateFact() - valid fact passes", () => {
  const validFact = {
    id: "test-fact-001",
    tier: "critical",
    type: "decision",
    content: { body: "Server restart completed successfully" },
    provenance: {
      source: "agent:test",
      timestamp: new Date().toISOString()
    }
  };
  const result = validateFact(validFact);
  assertTrue(result.valid, "Valid fact should pass validation");
  assertEqual(result.errors.length, 0, "Valid fact should have no errors");
});

// Test 4: ValidateFact - fact with "believes" keyword fails
test("validateFact() - fact with 'believes' keyword fails", () => {
  const beliefFact = {
    id: "test-fact-002",
    tier: "critical",
    type: "observation",
    content: { body: "Agent believes the system is stable" },
    provenance: {
      source: "agent:test",
      timestamp: new Date().toISOString()
    }
  };
  const result = validateFact(beliefFact);
  assertFalse(result.valid, "Fact with 'believes' should fail validation");
  assertTrue(result.errors.some(e => e.includes("interpretation")), "Should report interpretation keyword error");
});

// Test 5: ValidateFact - fact with "thinks" keyword fails
test("validateFact() - fact with 'thinks' keyword fails", () => {
  const thinkFact = {
    id: "test-fact-003",
    tier: "deep",
    type: "observation",
    content: { body: "The agent thinks this configuration will work" },
    provenance: {
      source: "agent:test",
      timestamp: new Date().toISOString()
    }
  };
  const result = validateFact(thinkFact);
  assertFalse(result.valid, "Fact with 'thinks' should fail validation");
  assertTrue(result.errors.some(e => e.includes("interpretation")), "Should report interpretation keyword error");
});

// Test 6: ValidateFact - missing provenance fails
test("validateFact() - missing provenance fails", () => {
  const noProvenanceFact = {
    id: "test-fact-004",
    tier: "critical",
    type: "decision",
    content: { body: "System configuration updated" }
    // Missing provenance
  };
  const result = validateFact(noProvenanceFact);
  assertFalse(result.valid, "Fact without provenance should fail validation");
  assertTrue(result.errors.some(e => e.includes("provenance")), "Should report missing provenance error");
});

// Test 7: isFact() equivalent - returns true for clean facts
test("isFact() equivalent - returns true for facts", () => {
  // The module doesn't export isFact(), but we can test via validateFact()
  // A valid fact should have no interpretation keywords
  const cleanFact = {
    id: "test-fact-005",
    tier: "critical",
    type: "event",
    content: { body: "Deployment completed at 14:30 UTC" },
    provenance: {
      source: "agent:test",
      timestamp: new Date().toISOString()
    }
  };
  const result = validateFact(cleanFact);
  assertTrue(result.valid, "Clean fact should be valid (isFact returns true)");
});

// Test 8: isFact() equivalent - returns false for interpretations
test("isFact() equivalent - returns false for interpretations", () => {
  // Test various interpretation keywords
  const interpretationKeywords = ["believes", "thinks", "probably", "likely", "seems", "feels"];
  
  for (const keyword of interpretationKeywords) {
    const interpretationFact = {
      id: `test-fact-${keyword}`,
      tier: "critical",
      type: "observation",
      content: { body: `This ${keyword} to be a good approach` },
      provenance: {
        source: "agent:test",
        timestamp: new Date().toISOString()
      }
    };
    const result = validateFact(interpretationFact);
    assertFalse(result.valid, `Fact containing '${keyword}' should be invalid (isFact returns false)`);
  }
});

// Test 9: TunnelPublisher with empty config
test("TunnelPublisher instantiates with empty config", () => {
  const publisher = new TunnelPublisher();
  assertEqual(publisher.peers.length, 0, "Should have no peers by default");
  assertEqual(publisher.localPort, 18803, "Should use default port");
  assertEqual(publisher.token, "replace-with-your-token", "Should use default token");
});

// Test 10: ValidateFact - missing required fields
test("validateFact() - missing required fields fails", () => {
  const incompleteFact = {
    id: "test-fact-006"
    // Missing tier, content, provenance
  };
  const result = validateFact(incompleteFact);
  assertFalse(result.valid, "Incomplete fact should fail validation");
  assertTrue(result.errors.length > 0, "Should have validation errors");
});

// Print summary
console.log("\n========================================");
console.log("TEST SUMMARY");
console.log("========================================");
console.log(`Total tests: ${testsRun}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
}

console.log("\n========================================");
console.log(`Result: ${testsFailed === 0 ? "PASS" : "FAIL"}`);
console.log("========================================\n");

// Exit with appropriate code
process.exit(testsFailed === 0 ? 0 : 1);
