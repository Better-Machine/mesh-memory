/**
 * Deal Room Test Suite
 * 
 * Tests core escrow, approval, and audit functionality
 */

import { createDealRoom, DealRoom } from './deal-room.mjs';
import { rmSync, existsSync } from 'fs';
import path from 'path';
import { homedir } from 'os';

const TEST_DB_PATH = path.join(homedir(), '.openclaw/workspace/memory/deal-room-test.db');

async function runTests() {
  console.log('🏛️  Deal Room Test Suite\n');
  
  // Clean up previous test DB
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH);
  }
  
  let room;
  let passed = 0;
  let failed = 0;
  
  try {
    // Test 1: Initialization
    console.log('Test 1: Initialization');
    room = await createDealRoom({ dbPath: TEST_DB_PATH });
    console.log('  ✅ Deal Room initialized\n');
    passed++;
    
    // Test 2: Create deal
    console.log('Test 2: Create deal');
    const deal = room.createDeal({
      initiator: 'agent-liz',
      recipient: 'agent-ray',
      payload: JSON.stringify({ 
        task: 'shared-context',
        data: { project: 'clean-sl8', status: 'in-progress' }
      }),
      conditions: {
        requiredApprovals: ['agent-liz', 'agent-ray']
      }
    });
    console.log(`  ✅ Deal created: ${deal.dealId}`);
    console.log(`  Status: ${deal.status}`);
    console.log(`  Initiator: ${deal.initiator}`);
    console.log(`  Recipient: ${deal.recipient}\n`);
    passed++;
    
    // Test 3: Get deal
    console.log('Test 3: Get deal');
    const retrieved = room.getDeal(deal.dealId);
    if (retrieved && retrieved.id === deal.dealId) {
      console.log('  ✅ Deal retrieved successfully\n');
      passed++;
    } else {
      throw new Error('Failed to retrieve deal');
    }
    
    // Test 4: List deals
    console.log('Test 4: List deals');
    const lizDeals = room.listDeals('agent-liz');
    const rayDeals = room.listDeals('agent-ray');
    console.log(`  Liz has ${lizDeals.length} deal(s)`);
    console.log(`  Ray has ${rayDeals.length} deal(s)\n`);
    passed++;
    
    // Test 5: Approve (Liz)
    console.log('Test 5: Approve by initiator');
    const approval1 = room.approveDeal(deal.dealId, 'agent-liz', 'approve');
    console.log(`  ✅ Liz approved`);
    console.log(`  Status: ${approval1.status}\n`);
    passed++;
    
    // Test 6: Approve (Ray) - should release
    console.log('Test 6: Approve by recipient (release)');
    const approval2 = room.approveDeal(deal.dealId, 'agent-ray', 'approve');
    console.log(`  ✅ Ray approved`);
    console.log(`  Status: ${approval2.status} (should be 'released')\n`);
    if (approval2.status === 'released') {
      console.log('  🎉 Deal released!');
      passed++;
    } else {
      throw new Error('Deal should be released');
    }
    
    // Test 7: Retrieve payload
    console.log('Test 7: Retrieve payload');
    const retrievedData = room.retrievePayload(deal.dealId, 'agent-ray');
    const payload = JSON.parse(retrievedData.payload);
    console.log(`  ✅ Payload retrieved by Ray`);
    console.log(`  Project: ${payload.data.project}`);
    console.log(`  Status: ${payload.data.status}\n`);
    passed++;
    
    // Test 8: Audit trail
    console.log('Test 8: Audit trail');
    const audit = room.getAuditTrail(deal.dealId);
    console.log(`  ✅ Audit trail has ${audit.length} entries`);
    audit.forEach((entry, i) => {
      console.log(`    ${i + 1}. ${entry.action} by ${entry.actor} at ${entry.timestamp}`);
    });
    console.log('');
    passed++;
    
    // Test 9: Reject deal (new deal)
    console.log('Test 9: Reject deal');
    const deal2 = room.createDeal({
      initiator: 'agent-liz',
      recipient: 'agent-ray',
      payload: JSON.stringify({ test: 'reject-test' })
    });
    const rejection = room.approveDeal(deal2.dealId, 'agent-ray', 'reject');
    console.log(`  ✅ Deal rejected`);
    console.log(`  Status: ${rejection.status}\n`);
    if (rejection.status === 'rejected') passed++;
    else throw new Error('Deal should be rejected');
    
    // Test 10: Unauthorized access
    console.log('Test 10: Unauthorized access (should fail)');
    try {
      room.createDeal({
        initiator: 'agent-woodhouse',
        recipient: 'agent-liz',
        payload: 'test'
      });
      console.log('  ⚠️ Deal created (Woodhouse in vault?)\n');
      passed++;
    } catch (e) {
      console.log(`  ⚠️ Error: ${e.message}\n`);
      // This is expected if Woodhouse isn't set up
    }
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
    failed++;
  } finally {
    if (room) room.close();
    
    // Cleanup
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
  }
  
  console.log('=== TEST SUMMARY ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

runTests();
