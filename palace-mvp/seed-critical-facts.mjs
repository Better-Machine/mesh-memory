/**
 * Seed Critical Facts Database
 * Populates L1 (critical) and L2 (deep) facts from MEMORY.md standing instructions
 * 
 * Usage: node palace-mvp/seed-critical-facts.mjs
 */

import { CriticalFactsLoader, createLoader } from '../critical-facts-loader.mjs';
import { existsSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import { homedir } from 'os';

const DB_PATH = path.join(homedir(), '.openclaw/workspace/memory/palace/critical-facts.db');
const PASSPORT_PATH = path.join(homedir(), '.openclaw/workspace/projects/mesh-memory/palace-mvp/agent-passport.json');

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// L1 Critical Facts (always loaded on wake-up)
const L1_FACTS = [
  {
    id: 'standing-ilhcev-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'ILHCEV Problem-Solving Methodology',
      body: 'Before any implementation: Inventory → Learn → Hypothesise → Choose → Execute → Validate. No exceptions. For group initiatives, each agent validates independently.',
      tags: ['methodology', 'standing-instruction', 'validation']
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-03-23T00:00:00Z'
    },
    updated_at: '2026-03-23T00:00:00Z',
    expires_at: null
  },
  {
    id: 'standing-qa-gate-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'QA Gate (Mandatory Before Merge)',
      body: 'POC: npm test passes, no hardcoded secrets, privacy scan clean. MVP: full test suite, QA_REPORT.md committed, all ADRs/RFCs filed. No merge without QA gate.',
      tags: ['qa', 'gate', 'compliance', 'standing-instruction']
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-03-21T00:00:00Z'
    },
    updated_at: '2026-03-21T00:00:00Z',
    expires_at: null
  },
  {
    id: 'standing-rfc-required-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'RFC Required for Protocol Changes',
      body: 'Any new protocol endpoint, cross-agent message format, API contract change, or agent identity mechanism requires RFC reaching Accepted status before implementation. No exceptions.',
      tags: ['rfc', 'protocol', 'approval', 'standing-instruction']
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-03-21T00:00:00Z'
    },
    updated_at: '2026-03-21T00:00:00Z',
    expires_at: null
  },
  {
    id: 'standing-postmortem-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'Post-Mortem Required for Incidents',
      body: 'Any production outage, deployment failure, security incident, or data loss requires blameless post-mortem within 24 hours of resolution. Commit to repo before returning to feature work.',
      tags: ['postmortem', 'incident', 'compliance', 'standing-instruction']
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-03-21T00:00:00Z'
    },
    updated_at: '2026-03-21T00:00:00Z',
    expires_at: null
  },
  {
    id: 'standing-behavioral-discipline-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'Behavioral Discipline in Telegram Groups',
      body: 'One message per exchange. No triple-tapping. No filler text. Use reactions (👍, ✅, 👀) for acknowledgements. Wait for specific task, then execute. Do not preemptively spin.',
      tags: ['behavior', 'telegram', 'groups', 'standing-instruction']
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-05-12T00:00:00Z'
    },
    updated_at: '2026-05-12T00:00:00Z',
    expires_at: null
  },
  {
    id: 'standing-model-routing-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'config',
    content: {
      title: 'Model Routing SOP — Fleet-Wide',
      body: 'Primary model: ollama/kimi-k2.6:cloud (thinking=medium). Anthropic/Claude reserved for infrastructure access only. Woodhouse uses gx10-lab (nemotron-super-120b) for code work. Ray+Liz do not use GX-10 endpoints.',
      tags: ['models', 'routing', 'infrastructure', 'standing-instruction']
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-05-11T00:00:00Z'
    },
    updated_at: '2026-05-11T00:00:00Z',
    expires_at: null
  },
  {
    id: 'standing-promise-protocol-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'Promise Protocol',
      body: '"I\'ll let you know when done" is only valid if a cron job backs it. No cron = no promise. Never say it otherwise.',
      tags: ['promises', 'cron', 'commitments', 'standing-instruction']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Woodhouse (via A2A)',
      timestamp: '2026-03-22T00:00:00Z'
    },
    updated_at: '2026-03-22T00:00:00Z',
    expires_at: null
  },
  {
    id: 'project-agency-services-001',
    tier: 'critical',
    category: 'projects',
    type: 'decision',
    content: {
      title: 'Agency.services Strategic Direction',
      body: 'Building A2A infrastructure — for agents, by agents. Product: persistent agent identity and portable memory. Build sequence: Phase 0 (mesh debt) → Phase 1 (identity) → Phase 2 (passport) → Phase 3 (registry) → Phase 4 (mesh as distribution).',
      tags: ['strategy', 'a2a', 'roadmap', 'agency-services'],
      status: 'active',
      current_phase: 'Phase 2'
    },
    provenance: {
      source: 'AGENTS.md',
      author: 'Mr. Ross',
      timestamp: '2026-03-31T00:00:00Z'
    },
    updated_at: '2026-03-31T00:00:00Z',
    expires_at: null
  },
  {
    id: 'people-erik-ross-001',
    tier: 'critical',
    category: 'people',
    type: 'observation',
    content: {
      title: 'Erik Ross — Primary Human',
      body: 'Dreamer, aging technologist, founder. Building hockeyops.ai with son Felix. Embraced AI as the tool that closes the gap between vision and execution. Direct, appreciates competence, values partnership over minions. Timezone: America/New_York.',
      tags: ['human', 'founder', 'product-owner'],
      relationship: 'primary user and architect',
      preferences: ['directness', 'competence', 'partnership']
    },
    provenance: {
      source: 'USER.md',
      author: 'system',
      timestamp: '2026-04-12T00:00:00Z'
    },
    updated_at: '2026-04-12T00:00:00Z',
    expires_at: null
  },
  {
    id: 'infra-mesh-nodes-001',
    tier: 'critical',
    category: 'infrastructure',
    type: 'config',
    content: {
      title: 'Mesh Node Topology (Tailscale)',
      body: 'Ray: 100.66.164.77 (ray). Liz: 100.105.111.69 (liz). Woodhouse: 100.127.83.84 (wodhouse). GX-10: 100.88.181.105 (gx-10). Use Tailscale hostnames, not LAN IPs.',
      tags: ['infrastructure', 'network', 'mesh', 'tailscale'],
      nodes: [
        { id: 'ray', tailscale_ip: '100.66.164.77', hostname: 'ray', lan_ip: '192.168.50.22' },
        { id: 'liz', tailscale_ip: '100.105.111.69', hostname: 'liz', lan_ip: '192.168.50.23' },
        { id: 'woodhouse', tailscale_ip: '100.127.83.84', hostname: 'wodhouse', lan_ip: '192.168.50.24' },
        { id: 'gx-10', tailscale_ip: '100.88.181.105', hostname: 'gx-10', lan_ip: '192.168.50.30' }
      ]
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Fleet Manager',
      timestamp: '2026-05-11T00:00:00Z'
    },
    updated_at: '2026-05-11T00:00:00Z',
    expires_at: null
  },
  {
    id: 'blocker-hockeyops-001',
    tier: 'critical',
    category: 'blockers',
    type: 'observation',
    content: {
      title: 'HockeyOps LLC Bank Account Blocker',
      body: 'Felix (50% owner) needs to contribute to LLC bank account setup before Stripe and operational dependencies can be unblocked. Status: waiting on Felix.',
      tags: ['blocker', 'hockeyops', 'banking'],
      status: 'waiting',
      owner: 'Felix Ross',
      blocking: ['Stripe setup', 'operational dependencies']
    },
    provenance: {
      source: 'USER.md',
      author: 'system',
      timestamp: '2026-04-12T00:00:00Z'
    },
    updated_at: '2026-04-12T00:00:00Z',
    expires_at: null
  },
  {
    id: 'config-a2a-sunset-001',
    tier: 'critical',
    category: 'standing_instructions',
    type: 'decision',
    content: {
      title: 'A2A Architecture Sunsetted',
      body: 'A2A is no longer part of architecture. Do not reference in plans or proposals. Use Telegram direct (sessions_send) for agent-to-agent, sessions_spawn for sub-agent delegation, shared memory pool for state. Consensus through human-mediated discussion.',
      tags: ['a2a', 'sunset', 'architecture', 'standing-instruction']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Mr. Ross',
      timestamp: '2026-05-12T00:00:00Z'
    },
    updated_at: '2026-05-12T00:00:00Z',
    expires_at: null
  }
];

// L2 Deep Facts (searchable but not always loaded)
const L2_FACTS = [
  {
    id: 'lesson-magicdns-001',
    tier: 'deep',
    category: 'infrastructure',
    type: 'observation',
    content: {
      title: 'Internet Outage — Tailscale MagicDNS (2026-04-04)',
      body: 'MagicDNS (100.100.100.100) overrides system DNS and blocks internet access. First diagnostic step for any future outage: Check Tailscale MagicDNS first. Standing rule: MagicDNS stays OFF.',
      tags: ['lesson', 'infrastructure', 'tailscale', 'dns']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Liz',
      timestamp: '2026-04-04T00:00:00Z'
    },
    updated_at: '2026-04-04T00:00:00Z',
    expires_at: null
  },
  {
    id: 'lesson-auth-config-001',
    tier: 'deep',
    category: 'infrastructure',
    type: 'observation',
    content: {
      title: 'Gateway Outage — Hand-Editing Auth Config (2026-04-03)',
      body: 'Hand-edited auth-profiles.json to add local failover. Broke gateway, 53-minute outage. Root cause: Put OpenAI key where Anthropic key belonged; skipped Inventory/Learn steps of ILHCEV. Never hand-edit auth-profiles.json.',
      tags: ['mistake', 'outage', 'auth', 'lesson']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Liz',
      timestamp: '2026-04-03T00:00:00Z'
    },
    updated_at: '2026-04-03T00:00:00Z',
    expires_at: null
  },
  {
    id: 'project-cleansl8-001',
    tier: 'deep',
    category: 'projects',
    type: 'observation',
    content: {
      title: 'CleanSL8 — Smart Device Transfer Assistant',
      body: 'iOS + Pi + backend system for automated device analysis and transfer. Phase 1: Identification + audit. Phase 2: Reset/Transfer. James GPU inference, Sentinel capture analysis. Currently waiting on Christian task assignment.',
      tags: ['project', 'cleansl8', 'iot', 'status']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Liz',
      timestamp: '2026-05-08T00:00:00Z'
    },
    updated_at: '2026-05-14T00:00:00Z',
    expires_at: null
  },
  {
    id: 'project-door-s-001',
    tier: 'deep',
    category: 'projects',
    type: 'observation',
    content: {
      title: 'Door$ — Music Industry Ticketing Platform',
      body: 'POC complete through Week 2: QR tickets, escrow dashboard, venue scanner, Booker UI. Blocked on Supabase/Stripe credentials from Erik. Mobile app (Expo) + Node API. Last activity: April 2, 2026.',
      tags: ['project', 'door$', 'music', 'ticketing', 'blocked']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Liz',
      timestamp: '2026-04-02T00:00:00Z'
    },
    updated_at: '2026-05-14T00:00:00Z',
    expires_at: null
  },
  {
    id: 'project-mesh-memory-001',
    tier: 'deep',
    category: 'projects',
    type: 'observation',
    content: {
      title: 'mesh-memory — Agent Memory Infrastructure',
      body: 'Phase 1 complete (32 tests passing). Phase 2 design complete. Palace/Kingdom architecture: L0 passport + L1 critical facts + L2 deep memory. Current work: L1 database seeding with standing instructions.',
      tags: ['project', 'mesh-memory', 'memory', 'palace', 'active']
    },
    provenance: {
      source: 'MEMORY.md',
      author: 'Liz',
      timestamp: '2026-05-14T00:00:00Z'
    },
    updated_at: '2026-05-14T00:00:00Z',
    expires_at: null
  }
];

async function seedDatabase() {
  console.log('🏛️  Palace Critical Facts Seeder\n');
  console.log(`Database: ${DB_PATH}`);
  console.log(`Passport: ${PASSPORT_PATH}\n`);

  let loader;
  try {
    // Create and initialize loader
    loader = await createLoader({
      dbPath: DB_PATH,
      passportPath: PASSPORT_PATH,
      verbose: true
    });

    console.log('✅ Database initialized\n');

    // Insert L1 facts
    console.log(`Inserting ${L1_FACTS.length} L1 (critical) facts...`);
    let l1Success = 0;
    for (const fact of L1_FACTS) {
      const result = loader.insertFact(fact);
      if (result.success) {
        l1Success++;
        console.log(`  ✅ ${fact.id}`);
      } else {
        console.log(`  ❌ ${fact.id}: ${result.error?.message}`);
      }
    }
    console.log(`\nL1: ${l1Success}/${L1_FACTS.length} inserted\n`);

    // Insert L2 facts
    console.log(`Inserting ${L2_FACTS.length} L2 (deep) facts...`);
    let l2Success = 0;
    for (const fact of L2_FACTS) {
      const result = loader.insertFact(fact);
      if (result.success) {
        l2Success++;
        console.log(`  ✅ ${fact.id}`);
      } else {
        console.log(`  ❌ ${fact.id}: ${result.error?.message}`);
      }
    }
    console.log(`\nL2: ${l2Success}/${L2_FACTS.length} inserted\n`);

    // Verify by generating wake-up context
    console.log('Generating wake-up context...');
    const wakeUpResult = await loader.generateWakeUpContext();
    
    if (wakeUpResult.success) {
      const ctx = wakeUpResult.data;
      console.log('\n📊 Wake-up Context Stats:');
      console.log(`  L0: Agent ${ctx.l0.agent.name} (${ctx.l0.agent.id})`);
      console.log(`  L1: ${ctx.l1Count} critical facts (${ctx.l1.length} loaded)`);
      console.log(`  Token estimate: ${ctx.tokenEstimate}`);
      console.log(`  Expired facts: ${ctx.expiredFactIds.length}`);
      console.log('\n✅ Database seeded successfully!');
    } else {
      console.log('\n❌ Wake-up context failed:', wakeUpResult.error);
    }

    // Test search
    console.log('\n🔍 Testing L2 search for "infrastructure"...');
    const searchResult = loader.searchDeepFacts('infrastructure', 5);
    if (searchResult.success) {
      console.log(`  Found ${searchResult.data.length} results`);
      searchResult.data.forEach(f => console.log(`    - ${f.content.title}`));
    }

  } catch (err) {
    console.error('\n❌ Seeding failed:', err.message);
    process.exit(1);
  } finally {
    if (loader) {
      loader.close();
    }
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase();
}

export { L1_FACTS, L2_FACTS, seedDatabase };
