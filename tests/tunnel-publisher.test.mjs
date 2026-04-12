/**
 * @module tunnel-publisher-test
 * @description Unit tests for tunnel-publisher.mjs
 */

import { TunnelPublisher, validateFact, validateProvenance } from "../tunnel-publisher.mjs";

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

// ── Tests ───────────────────────────────────────────────────────────────────

async function testValidateFact() {
  console.log("\n📋 Testing validateFact...");

  // Valid fact
  const validFact = {
    id: "test-001",
    tier: "critical",
    content: { title: "Test", body: "This is a factual observation" },
    provenance: { source: "liz", timestamp: new Date().toISOString() }
  };
  let result = validateFact(validFact);
  assert(result.valid, "Valid fact should pass validation");

  // Missing id
  const noId = { ...validFact };
  delete noId.id;
  result = validateFact(noId);
  assert(!result.valid, "Fact without ID should fail validation");
  assert(result.errors.some(e => e.includes("id")), "Should report missing id");

  // Missing tier
  const noTier = { ...validFact };
  delete noTier.tier;
  result = validateFact(noTier);
  assert(!result.valid, "Fact without tier should fail validation");

  // Invalid tier
  const badTier = { ...validFact, tier: "super" };
  result = validateFact(badTier);
  assert(!result.valid, "Fact with invalid tier should fail validation");

  // Missing provenance
  const noProv = { ...validFact };
  delete noProv.provenance;
  result = validateFact(noProv);
  assert(!result.valid, "Fact without provenance should fail validation");

  // Interpretation keywords
  const interpretation = {
    ...validFact,
    content: { title: "Test", body: "I believe this is probably true" }
  };
  result = validateFact(interpretation);
  assert(!result.valid, "Fact with interpretation keywords should fail");
  assert(result.errors.some(e => e.includes("interpretation")), "Should report interpretation keywords");

  // Interpretation keyword in provenance
  const badProvenance = {
    ...validFact,
    content: { title: "Test", body: "Ray thinks the server is down" }
  };
  result = validateFact(badProvenance);
  assert(!result.valid, "Content containing 'thinks' should fail");

  console.log("  ✅ validateFact tests passed");
}

async function testValidateProvenance() {
  console.log("\n📋 Testing validateProvenance...");

  // Valid provenance
  const validProv = {
    source: "liz",
    timestamp: new Date().toISOString()
  };
  let result = validateProvenance(validProv);
  assert(result.valid, "Valid provenance should pass");

  // Missing source
  result = validateProvenance({ timestamp: new Date().toISOString() });
  assert(!result.valid, "Provenance without source should fail");

  // Missing timestamp
  result = validateProvenance({ source: "liz" });
  assert(!result.valid, "Provenance without timestamp should fail");

  // Invalid timestamp
  result = validateProvenance({ source: "liz", timestamp: "not-a-date" });
  assert(!result.valid, "Invalid timestamp should fail");

  // Future timestamp (>5min drift)
  const future = new Date(Date.now() + 10 * 60 * 1000);
  result = validateProvenance({ source: "liz", timestamp: future.toISOString() });
  assert(!result.valid, "Future timestamp should fail");

  // Old timestamp (>24h)
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  result = validateProvenance({ source: "liz", timestamp: old.toISOString() });
  assert(!result.valid, "Old timestamp (>24h) should fail");

  console.log("  ✅ validateProvenance tests passed");
}

async function testTunnelPublisher() {
  console.log("\n📋 Testing TunnelPublisher...");

  // Create publisher with no peers for testing
  const publisher = new TunnelPublisher({
    peers: [],
    localPort: 18804, // Different port to avoid conflicts
    token: "test-token"
  });

  // Test publishFact with no peers
  const validFact = {
    id: "test-no-peers",
    tier: "critical",
    content: { title: "Test", body: "A valid fact" },
    provenance: { source: "test", timestamp: new Date().toISOString() }
  };

  const result = await publisher.publishFact(validFact);
  assertEqual(Object.keys(result).length, 0, "No peers should result in empty summary");

  // Test publishFact with invalid fact
  let threw = false;
  try {
    await publisher.publishFact({ invalid: true });
  } catch (err) {
    threw = true;
    assert(err.message.includes("validation"), "Should throw validation error");
  }
  assert(threw, "Should throw for invalid fact");

  console.log("  ✅ TunnelPublisher tests passed");
}

async function testFactValidationList() {
  console.log("\n📋 Testing interpretation keyword detection...");

  const interpretationWords = [
    "believes", "thinks", "probably", "likely", "seems", "appears",
    "feels", "suggests", "implies", "assessment", "opinion"
  ];

  for (const word of interpretationWords) {
    const fact = {
      id: `test-${word}`,
      tier: "critical",
      content: { title: "Test", body: `This ${word} is a test` },
      provenance: { source: "liz", timestamp: new Date().toISOString() }
    };
    const result = validateFact(fact);
    assert(!result.valid, `Fact containing '${word}' should be rejected`);
    assert(result.errors.some(e => e.includes("interpretation")), 
      `Should report interpretation keywords for '${word}'`);
  }

  console.log("  ✅ Interpretation keyword detection passed");
}

async function testAllowedTypes() {
  console.log("\n📋 Testing allowed fact types...");

  const allowedTypes = ["decision", "event", "date", "config", "observation"];
  const baseFact = {
    id: "test-type",
    tier: "critical",
    content: { title: "Test", body: "A valid fact" },
    provenance: { source: "liz", timestamp: new Date().toISOString() }
  };

  for (const type of allowedTypes) {
    const fact = { ...baseFact, type };
    const result = validateFact(fact);
    assert(result.valid, `Type '${type}' should be valid`);
  }

  // Invalid type
  const badType = { ...baseFact, type: "interpretation" };
  const result = validateFact(badType);
  assert(!result.valid, "Type 'interpretation' should be invalid");

  console.log("  ✅ Allowed type tests passed");
}

// ── Main Test Runner ─────────────────────────────────────────────────────────
async function runTests() {
  console.log("🧪 Running tunnel-publisher tests...\n");
  
  try {
    await testValidateFact();
    await testValidateProvenance();
    await testTunnelPublisher();
    await testFactValidationList();
    await testAllowedTypes();
    
    console.log("\n✅ All tests passed!");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
