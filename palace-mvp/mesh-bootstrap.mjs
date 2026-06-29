#!/usr/bin/env node
/**
 * mesh-bootstrap.mjs — Pull latest mesh shared-pool facts at session start.
 *
 * Closes the cross-session awareness gap: without this, mesh facts written
 * by other agents after the last session close are invisible to the next
 * session. With this, the next session boot surfaces them as part of the
 * palace-bootstrap context.
 *
 * Usage:
 *   import { loadMeshFactsForBoot } from './mesh-bootstrap.mjs';
 *   const mesh = await loadMeshFactsForBoot({ limit: 10, sinceHours: 48 });
 *
 * @module mesh-bootstrap
 */

import { request } from 'node:http';

// Configuration
const CONFIG = {
  host: process.env.MESH_HOST || 'localhost',
  port: parseInt(process.env.MESH_PORT || '18805', 10),
  defaultLimit: parseInt(process.env.MESH_BOOTSTRAP_LIMIT || '10', 10),
  defaultSinceHours: parseInt(process.env.MESH_BOOTSTRAP_SINCE_HOURS || '48', 10),
  timeoutMs: parseInt(process.env.MESH_BOOTSTRAP_TIMEOUT_MS || '5000', 10),
  logger: process.env.MESH_BOOTSTRAP_LOG_LEVEL || 'INFO'
};

const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
const LOG_THRESHOLD = LOG_LEVELS.indexOf(CONFIG.logger);

function log(level, msg, meta = {}) {
  if (LOG_LEVELS.indexOf(level) > LOG_THRESHOLD) return;
  const ts = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${ts}] [${level}] [mesh-bootstrap] ${msg}${metaStr}`);
}

/**
 * Fetch mesh facts via HTTP GET.
 * Returns parsed JSON or throws on connection failure.
 */
function fetchMeshFacts(path) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: CONFIG.host,
      port: CONFIG.port,
      path,
      method: 'GET',
      timeout: CONFIG.timeoutMs,
      headers: { 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${CONFIG.timeoutMs}ms`));
    });
    req.end();
  });
}

/**
 * Format mesh facts as a bootstrap-friendly text block.
 * Compact — designed to fit within ~600 tokens for 10 facts.
 */
function formatMeshFactsForBootstrap(facts, sinceHours) {
  if (!facts || facts.length === 0) {
    return `## Mesh Shared Pool (last ${sinceHours}h)\n\n_No new facts._\n`;
  }
  const lines = [];
  lines.push(`## Mesh Shared Pool (last ${sinceHours}h) — ${facts.length} facts`);
  lines.push('');
  lines.push('> Facts from across the fleet. Surface these in this session: questions, requests, async handoffs.');
  lines.push('');
  for (const f of facts) {
    const ts = (f.timestamp || '').slice(0, 19);
    const agent = f.agent_id || '?';
    const type = f.fact_type || '?';
    const content = (f.content || '').slice(0, 240);
    lines.push(`- **[${ts}] ${agent}/${type}** (id=${f.id.slice(0, 12)}…): ${content}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Filter facts by recency and type.
 * Priority: questions > requests > woodhouse-ping > everything else.
 */
function selectBootstrapFacts(facts, sinceMs, limit) {
  const cutoff = Date.now() - sinceMs;
  const recent = facts.filter(f => {
    const ts = new Date(f.timestamp || 0).getTime();
    return ts >= cutoff;
  });
  
  // Score for ordering: questions and direct requests first.
  const scored = recent.map(f => {
    let score = 0;
    const content = (f.content || '').toLowerCase();
    const tags = JSON.stringify(f.tags || []).toLowerCase();
    if (content.includes('?') || content.includes('question') || tags.includes('question')) score += 10;
    if (content.includes('please reply') || content.includes('please respond') || tags.includes('request')) score += 8;
    if (f.fact_type === 'answer') score += 5;
    if (f.agent_id !== 'liz') score += 3; // Surface cross-agent traffic
    if (tags.includes('woodhouse') || tags.includes('cross-agent')) score += 2;
    return { ...f, _score: score };
  });
  
  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  
  return scored.slice(0, limit);
}

/**
 * Main entry point — load mesh facts suitable for session bootstrap.
 *
 * @param {Object} options
 * @param {number} options.limit - max facts to return (default 10)
 * @param {number} options.sinceHours - only facts from this many hours ago (default 48)
 * @returns {Promise<{ok: boolean, content: string, count: number, error?: string}>}
 */
export async function loadMeshFactsForBoot(options = {}) {
  const limit = options.limit ?? CONFIG.defaultLimit;
  const sinceHours = options.sinceHours ?? CONFIG.defaultSinceHours;
  const sinceMs = sinceHours * 60 * 60 * 1000;
  
  try {
    log('INFO', 'Fetching mesh shared pool', { host: CONFIG.host, port: CONFIG.port, limit, sinceHours });
    
    // /mesh/shared-pool returns all facts; we filter client-side.
    // The /facts endpoint returned 404 in our environment, but /mesh/shared-pool works.
    const poolResp = await fetchMeshFacts('/mesh/shared-pool');
    const allFacts = poolResp.facts || [];
    
    const selected = selectBootstrapFacts(allFacts, sinceMs, limit);
    const content = formatMeshFactsForBootstrap(selected, sinceHours);
    
    log('INFO', 'Mesh facts loaded', { available: allFacts.length, selected: selected.length });
    return { ok: true, content, count: selected.length };
    
  } catch (err) {
    log('WARN', 'Mesh bootstrap fetch failed', { error: err.message });
    return {
      ok: false,
      content: `## Mesh Shared Pool (last ${sinceHours}h)\n\n_Mesh unavailable: ${err.message}_\n`,
      count: 0,
      error: err.message
    };
  }
}

// CLI mode for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  loadMeshFactsForBoot().then(result => {
    console.log(result.content);
    console.log(`\n[count=${result.count} ok=${result.ok}]`);
    if (result.error) console.error(`[error: ${result.error}]`);
  });
}