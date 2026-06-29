/**
 * Palace Wake-Up Hook
 *
 * Automatically loads Palace L1 context on agent session start.
 * Integrates with OpenClaw session initialization to provide
 * critical facts without explicit loading.
 *
 * Usage: Import in agent bootstrap or session init
 *
 * @version 1.0.0
 * @module palace-wakeup-hook
 */

import { quickLoad } from '../critical-facts-loader.mjs';
import { createPalaceTKG } from '../palace-tkg.mjs';
import { createPalaceKingdom } from '../palace-kingdom.mjs';
import { loadMeshFactsForBoot } from './mesh-bootstrap.mjs';
import path from 'path';
import { homedir } from 'os';

// Configuration
const CONFIG = {
  dbPath: path.join(homedir(), '.openclaw/workspace/memory/palace/critical-facts.db'),
  tkgPath: path.join(homedir(), '.openclaw/workspace/memory/palace/palace-tkg.db'),
  kingdomPath: path.join(homedir(), '.openclaw/workspace/memory/palace/palace-kingdom.db'),
  passportPath: path.join(homedir(), '.openclaw/workspace/projects/mesh-memory/palace-mvp/agent-passport.json'),
  maxL1Facts: 15,
  maxTokens: 2000
};

/**
 * Wake-up context result
 */
export class WakeUpContext {
  constructor(data = {}) {
    this.loaded = data.loaded || false;
    this.l0 = data.l0 || null; // Passport
    this.l1 = data.l1 || []; // Critical facts
    this.l1Count = data.l1Count || 0;
    this.mesh = data.mesh || null; // Latest mesh shared-pool facts (text block)
    this.meshCount = data.meshCount || 0;
    this.meshOk = data.meshOk ?? null;
    this.tokenEstimate = data.tokenEstimate || 0;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.source = data.source || 'palace-wakeup';
    this.errors = data.errors || [];
  }

  /**
   * Format as system prompt addition
   */
  toSystemPrompt() {
    if (!this.loaded) return '';

    const lines = [];
    lines.push('## Palace Memory (Auto-Loaded)');
    lines.push('');

    // L0: Identity
    if (this.l0) {
      lines.push(`**Agent:** ${this.l0.agent.name} (${this.l0.agent.id})`);
      lines.push(`**Organization:** ${this.l0.orgId || 'bettermachine'}`);
      lines.push('');
    }

    // L1: Critical facts
    if (this.l1.length > 0) {
      lines.push('**Standing Instructions:**');
      for (const fact of this.l1) {
        if (fact.content?.title) {
          lines.push(`- ${fact.content.title}`);
        }
        if (fact.content?.body) {
          const summary = fact.content.body.substring(0, 100);
          lines.push(`  ${summary}${fact.content.body.length > 100 ? '...' : ''}`);
        }
      }
    }

    // Mesh shared pool — cross-session awareness.
    // This is what makes the agent see questions/handoffs from other agents
    // posted since the last session close. Without this, mesh facts posted
    // by Woodhouse/Ray/Eames are invisible until the agent explicitly searches.
    if (this.mesh) {
      lines.push('');
      lines.push(this.mesh);
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Format as compact context for model
   */
  toCompactContext() {
    if (!this.loaded) return null;

    return {
      agent: this.l0?.agent,
      criticalFacts: this.l1.map(f => ({
        id: f.id,
        category: f.category,
        type: f.type,
        title: f.content?.title,
        tags: f.content?.tags
      })),
      stats: {
        l1Count: this.l1Count,
        tokens: this.tokenEstimate
      }
    };
  }
}

/**
 * Load Palace wake-up context (L0 + L1)
 */
export async function loadWakeUpContext(options = {}) {
  const config = { ...CONFIG, ...options };
  const errors = [];

  try {
    // Use quickLoad for fast L1 retrieval
    const result = await quickLoad({
      dbPath: config.dbPath,
      passportPath: config.passportPath
    });

    // quickLoad returns data directly on success, or { success: false, error } on failure
    if (result.success === false) {
      errors.push(`Loader failed: ${result.error?.message || result.error}`);
      return new WakeUpContext({ loaded: false, errors });
    }

    // Result is the actual wake-up context data
    const data = result;
    const { l0: passport, l1: facts } = data;

    // Cross-session awareness: pull latest mesh facts. Failure here is
    // non-fatal — we still return a wake-up context, just without mesh.
    let mesh = null;
    let meshCount = 0;
    let meshOk = null;
    try {
      const meshOpts = {
        limit: config.meshLimit ?? 10,
        sinceHours: config.meshSinceHours ?? 48
      };
      const meshResult = await loadMeshFactsForBoot(meshOpts);
      mesh = meshResult.content;
      meshCount = meshResult.count;
      meshOk = meshResult.ok;
      if (!meshResult.ok) {
        errors.push(`Mesh bootstrap: ${meshResult.error || 'unknown'}`);
      }
    } catch (meshErr) {
      errors.push(`Mesh bootstrap threw: ${meshErr.message}`);
    }

    return new WakeUpContext({
      loaded: true,
      l0: passport,
      l1: facts,
      l1Count: data.l1Count || facts?.length || 0,
      mesh,
      meshCount,
      meshOk,
      tokenEstimate: data.tokenEstimate || 0,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    errors.push(`Exception: ${err.message}`);
    return new WakeUpContext({ loaded: false, errors });
  }
}

/**
 * Deep wake-up with L2 search
 */
export async function loadDeepWakeUpContext(query, options = {}) {
  const config = { ...CONFIG, ...options };
  const errors = [];

  try {
    // Import CriticalFactsLoader for search
    const { CriticalFactsLoader } = await import('../critical-facts-loader.mjs');

    const loader = new CriticalFactsLoader({
      dbPath: config.dbPath,
      passportPath: config.passportPath
    });

    await loader.init();

    // Get L1 context
    const l1Result = loader.getCriticalFacts();
    const l1Facts = l1Result.success ? l1Result.data.slice(0, config.maxL1Facts) : [];

    // Search L2
    const l2Result = loader.searchDeepFacts(query, options.l2Limit || 10);
    const l2Facts = l2Result.success ? l2Result.data : [];

    loader.close();

    return {
      loaded: true,
      l1: l1Facts,
      l2: l2Facts,
      query,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    errors.push(`Exception: ${err.message}`);
    return { loaded: false, errors };
  }
}

/**
 * Full Palace wake-up (L0-L4)
 */
export async function loadFullPalaceContext(options = {}) {
  const config = { ...CONFIG, ...options };
  const errors = [];

  try {
    // L0-L1: Quick load
    const wakeUp = await loadWakeUpContext(config);

    // L3: Temporal context (if needed)
    let temporalContext = null;
    if (options.includeTemporal) {
      try {
        const tkg = await createPalaceTKG({ dbPath: config.tkgPath });
        const now = new Date().toISOString();
        const facts = tkg.queryFactsAtTime(now, { limit: 5 });
        temporalContext = {
          facts: facts.map(f => ({ id: f.id, factRef: f.factRef, validFrom: f.validFrom })),
          count: facts.length
        };
        tkg.close();
      } catch (err) {
        errors.push(`Temporal load failed: ${err.message}`);
      }
    }

    // L4: Kingdom context (if needed)
    let kingdomContext = null;
    if (options.includeKingdom) {
      try {
        const kingdom = await createPalaceKingdom({
          nodeId: options.nodeId || 'liz',
          dbPath: config.kingdomPath
        });
        const keys = kingdom.getAllKeys();
        const peers = kingdom.getPeers({ status: 'active' });
        kingdomContext = {
          sharedKeys: keys,
          activePeers: peers.map(p => p.nodeId),
          peerCount: peers.length
        };
        kingdom.close();
      } catch (err) {
        errors.push(`Kingdom load failed: ${err.message}`);
      }
    }

    return {
      loaded: wakeUp.loaded,
      l0: wakeUp.l0,
      l1: wakeUp.l1,
      l1Count: wakeUp.l1Count,
      l3: temporalContext,
      l4: kingdomContext,
      tokenEstimate: wakeUp.tokenEstimate,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    errors.push(`Exception: ${err.message}`);
    return { loaded: false, errors };
  }
}

/**
 * OpenClaw integration hook
 * Called by agent framework on session start
 */
export async function onSessionStart(sessionConfig = {}) {
  console.log('[palace-wakeup] Loading wake-up context...');

  const context = await loadWakeUpContext(sessionConfig);

  if (context.loaded) {
    console.log(`[palace-wakeup] ✓ Loaded ${context.l1Count} critical facts (~${context.tokenEstimate} tokens)`);

    // Return formatted context for system prompt injection
    return {
      success: true,
      context: context.toCompactContext(),
      systemPromptAddendum: context.toSystemPrompt()
    };
  } else {
    console.log('[palace-wakeup] ✗ Failed to load:', context.errors.join('; '));
    return { success: false, errors: context.errors };
  }
}

/**
 * Health check for Palace system
 */
export async function checkPalaceHealth() {
  const checks = {
    database: false,
    daemon: false,
    tkg: false,
    kingdom: false
  };

  try {
    // Check L1 database
    const fs = await import('fs');
    checks.database = fs.existsSync(CONFIG.dbPath);

    // Check daemon (HTTP probe)
    try {
      const http = await import('http');
      await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:18810/health', (res) => {
          checks.daemon = res.statusCode === 200;
          resolve();
        });
        req.on('error', reject);
        req.setTimeout(1000, reject);
      });
    } catch {
      checks.daemon = false;
    }

    // Check TKG
    checks.tkg = fs.existsSync(CONFIG.tkgPath);

    // Check Kingdom
    checks.kingdom = fs.existsSync(CONFIG.kingdomPath);

  } catch (err) {
    // Ignore
  }

  const allHealthy = checks.database && checks.tkg && checks.kingdom;

  return {
    healthy: allHealthy,
    checks,
    timestamp: new Date().toISOString()
  };
}
