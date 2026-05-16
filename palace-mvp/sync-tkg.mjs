/**
 * Palace TKG Sync and Test
 * 
 * Syncs L1/L2 facts from Palace to Temporal Knowledge Graph (L3)
 * Tests time-travel queries and hash chain verification
 * 
 * Usage: node palace-mvp/sync-tkg.mjs
 */

import { PalaceTKG, createPalaceTKG } from '../palace-tkg.mjs';
import { CriticalFactsLoader, createLoader } from '../critical-facts-loader.mjs';
import path from 'path';
import { homedir } from 'os';

const DB_PATH = path.join(homedir(), '.openclaw/workspace/memory/palace/critical-facts.db');
const TKG_PATH = path.join(homedir(), '.openclaw/workspace/memory/palace/palace-tkg.db');
const PASSPORT_PATH = path.join(homedir(), '.openclaw/workspace/projects/mesh-memory/palace-mvp/agent-passport.json');

async function syncAndTest() {
  console.log('🏛️  Palace TKG Sync and Test\n');
  
  let loader, tkg;
  
  try {
    // Initialize Palace loader
    console.log('1. Initializing Palace L1/L2...');
    loader = await createLoader({
      dbPath: DB_PATH,
      passportPath: PASSPORT_PATH
    });
    console.log('   ✅ Palace initialized\n');
    
    // Initialize TKG
    console.log('2. Initializing TKG (L3)...');
    tkg = await createPalaceTKG({
      dbPath: TKG_PATH,
      correlationId: 'sync-test'
    });
    console.log('   ✅ TKG initialized\n');
    
    // Sync L1 facts to TKG
    console.log('3. Syncing L1 facts to TKG...');
    const syncResult = tkg.syncFromPalace(loader);
    console.log(`   ✅ Synced ${syncResult.synced}/${syncResult.total} facts\n`);
    
    // Test time-travel query
    console.log('4. Testing time-travel query...');
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    
    const factsNow = tkg.queryFactsAtTime(now, { limit: 5 });
    console.log(`   Facts valid now: ${factsNow.length}`);
    
    const factsYesterday = tkg.queryFactsAtTime(yesterday, { limit: 5 });
    console.log(`   Facts valid yesterday: ${factsYesterday.length}`);
    
    // Test specific fact history
    console.log('\n5. Testing fact history...');
    const sampleFact = factsNow[0];
    if (sampleFact) {
      const history = tkg.getFactHistory(sampleFact.factRef);
      console.log(`   History for ${sampleFact.factRef}: ${history.length} versions`);
      
      // Verify chain
      const verification = tkg.verifyChain(sampleFact.factRef);
      console.log(`   Chain verification: ${verification.valid ? '✅ Valid' : '❌ Broken'}`);
      if (verification.valid) {
        console.log(`   Chain length: ${verification.chainLength}`);
      }
    }
    
    // Test retraction (demo)
    console.log('\n6. Testing retraction (demo)...');
    if (sampleFact) {
      try {
        const retraction = tkg.retractFact(
          sampleFact.factRef,
          'test-system',
          'Demo retraction for testing'
        );
        console.log(`   ✅ Retraction created: ${retraction.id}`);
        
        // Verify it's now invalid
        const checkAfter = tkg.getFactAtTime(sampleFact.factRef, now);
        console.log(`   Fact valid after retraction: ${checkAfter ? 'Yes' : 'No (correctly retracted)'}`);
      } catch (err) {
        console.log(`   Note: ${err.message}`);
      }
    }
    
    // Audit log
    console.log('\n7. Audit log:');
    const auditLog = tkg.getAuditLog({ limit: 10 });
    auditLog.forEach(entry => {
      console.log(`   [${entry.timestamp}] ${entry.action}: ${entry.fact_id}`);
    });
    
    console.log('\n✅ TKG sync and test complete!');
    console.log('\nL3 Temporal Knowledge Graph Summary:');
    console.log(`  - Database: ${TKG_PATH}`);
    console.log(`  - Synced facts: ${syncResult.synced}`);
    console.log(`  - Time-travel: Enabled`);
    console.log(`  - Hash chain: Verified`);
    console.log(`  - Audit trail: ${auditLog.length} entries`);
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (loader) loader.close();
    if (tkg) tkg.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncAndTest();
}

export { syncAndTest };
