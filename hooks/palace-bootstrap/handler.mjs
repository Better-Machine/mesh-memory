/**
 * Palace Bootstrap Hook Handler (ESM/JavaScript)
 * 
 * Loads Palace Memory context (L0-L4) into agent bootstrap on session start.
 * Fires on `agent:bootstrap` event, modifies bootstrapFiles array.
 */

import { spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

// Configuration
const CONFIG = {
  useDaemon: process.env.PALACE_USE_DAEMON !== 'false',
  daemonUrl: process.env.PALACE_DAEMON_URL || 'http://localhost:18810',
  maxFacts: parseInt(process.env.PALACE_MAX_FACTS || '15', 10),
  logLevel: process.env.PALACE_LOG_LEVEL || 'INFO',
  workspaceDir: process.env.WORKSPACE_DIR || path.join(homedir(), '.openclaw/workspace'),
  meshMemoryPath: process.env.MESH_MEMORY_PATH || path.join(homedir(), '.openclaw/workspace/projects/mesh-memory')
};

// Logger
const logger = {
  debug: (msg, meta) => log('DEBUG', msg, meta),
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta)
};

function log(level, msg, meta) {
  const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
  const configLevel = levels.indexOf(CONFIG.logLevel);
  if (levels.indexOf(level) <= configLevel) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] [${level}] [palace-bootstrap] ${msg}${metaStr}`);
  }
}

/**
 * Fetch Palace context from daemon
 */
async function fetchFromDaemon() {
  const url = `${CONFIG.daemonUrl}/wake-up-context`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Daemon returned ${response.status}`);
    }
    
    return await response.json();
  } catch (err) {
    throw new Error(`Daemon fetch failed: ${err.message}`);
  }
}

/**
 * Fetch Palace context via direct module import
 */
async function fetchViaDirectImport() {
  const hookPath = path.join(CONFIG.meshMemoryPath, 'palace-mvp/wakeup-hook.mjs');
  
  // Check if file exists
  if (!existsSync(hookPath)) {
    throw new Error(`Wake-up hook not found at ${hookPath}`);
  }
  
  // Import and call
  const { loadWakeUpContext } = await import(hookPath);
  const context = await loadWakeUpContext({
    dbPath: path.join(CONFIG.workspaceDir, 'memory/palace/critical-facts.db'),
    passportPath: path.join(CONFIG.meshMemoryPath, 'palace-mvp/agent-passport.json')
  });
  
  return {
    l0: context.l0,
    l1: context.l1,
    l1Count: context.l1Count,
    tokenEstimate: context.tokenEstimate,
    loaded: context.loaded
  };
}

/**
 * Load Palace context
 */
async function loadPalaceContext() {
  // Try daemon first
  if (CONFIG.useDaemon) {
    try {
      logger.debug('Fetching from Palace Daemon');
      const context = await fetchFromDaemon();
      logger.info('Loaded Palace context from daemon', { l1Count: context.l1Count });
      return context;
    } catch (err) {
      logger.warn('Daemon unavailable, falling back to direct import', { error: err.message });
    }
  }
  
  // Fallback to direct import
  try {
    logger.debug('Fetching via direct import');
    const context = await fetchViaDirectImport();
    logger.info('Loaded Palace context via import', { l1Count: context.l1Count });
    return context;
  } catch (err) {
    logger.error('Failed to load Palace context', { error: err.message });
    throw err;
  }
}

/**
 * Format Palace context as bootstrap file content
 */
function formatPalaceContent(context) {
  const lines = [];
  
  lines.push('# Palace Memory (Auto-Loaded)');
  lines.push('');
  lines.push('> Agent memory context loaded from Palace L0-L4');
  lines.push('');
  
  // L0: Identity
  if (context.l0?.agent) {
    lines.push('## Agent Identity (L0)');
    lines.push(`- **Name:** ${context.l0.agent.name}`);
    lines.push(`- **ID:** ${context.l0.agent.id}`);
    lines.push(`- **Role:** ${context.l0.agent.role || 'Not set'}`);
    if (context.l0.capabilities?.length) {
      lines.push(`- **Capabilities:** ${context.l0.capabilities.slice(0, 5).join(', ')}`);
    }
    lines.push('');
  }
  
  // L1: Critical Facts
  if (context.l1?.length) {
    lines.push('## Critical Facts (L1)');
    lines.push(`*${Math.min(context.l1.length, CONFIG.maxFacts)} standing instructions loaded*`);
    lines.push('');
    
    context.l1.slice(0, CONFIG.maxFacts).forEach((fact) => {
      // Handle both flat and nested structures
      const title = fact.content?.title || fact.title;
      const body = fact.content?.body || fact.body;
      const tags = fact.content?.tags || fact.tags;
      
      if (title) {
        lines.push(`**${title}**`);
        if (body) {
          const bodyText = body.length > 200 
            ? body.substring(0, 200) + '...'
            : body;
          lines.push(`> ${bodyText.split('\n').join('\n> ')}`);
        }
        if (tags?.length) {
          lines.push(`*Tags: ${tags.slice(0, 5).join(', ')}*`);
        }
        lines.push('');
      }
    });
  }
  
  // Stats
  lines.push('---');
  lines.push(`*Context: ${context.l1Count || context.l1?.length || 0} L1 facts, ~${context.tokenEstimate || 0} tokens*`);
  lines.push(`*Loaded: ${new Date().toISOString()}*`);
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Main handler
 */
const handler = async (event) => {
  // Filter: only process agent:bootstrap
  if (event.type !== 'agent:bootstrap') {
    return;
  }
  
  logger.info('Processing agent:bootstrap', { agentId: event.context?.agentId });
  
  try {
    // Load Palace context
    const palaceContext = await loadPalaceContext();
    
    if (!palaceContext.loaded) {
      logger.warn('Palace context not loaded, skipping injection');
      return;
    }
    
    // Format as content
    const palaceContent = formatPalaceContent(palaceContext);
    
    // Create temporary file path for bootstrap injection
    const tmpDir = path.join(CONFIG.workspaceDir, '.palace-tmp');
    await fs.mkdir(tmpDir, { recursive: true }).catch(() => {});
    
    const palaceFile = path.join(tmpDir, `palace-context-${Date.now()}.md`);
    await fs.writeFile(palaceFile, palaceContent, 'utf-8');
    
    // Inject into bootstrap files (prepend so it loads first)
    const bootstrapFiles = event.context?.bootstrapFiles || [];
    
    // Look for existing Palace file and replace, or insert at beginning
    const palaceIndex = bootstrapFiles.findIndex((f) => 
      f.includes('palace-context-') || f.endsWith('PALACE_CONTEXT.md')
    );
    
    if (palaceIndex >= 0) {
      // Replace existing
      bootstrapFiles[palaceIndex] = palaceFile;
      logger.debug('Replaced existing Palace context file');
    } else {
      // Insert after AGENTS.md if present, otherwise at beginning
      const agentsIndex = bootstrapFiles.findIndex((f) => 
        f.endsWith('AGENTS.md')
      );
      const insertIndex = agentsIndex >= 0 ? agentsIndex + 1 : 0;
      bootstrapFiles.splice(insertIndex, 0, palaceFile);
      logger.debug('Inserted Palace context file', { insertIndex });
    }
    
    // Cleanup old temp files
    try {
      const files = await fs.readdir(tmpDir);
      const oldFiles = files
        .filter(f => f.startsWith('palace-context-'))
        .filter(f => f !== path.basename(palaceFile))
        .slice(0, -5); // Keep last 5
      
      for (const file of oldFiles) {
        await fs.unlink(path.join(tmpDir, file)).catch(() => {});
      }
    } catch {
      // Ignore cleanup errors
    }
    
    logger.info('Palace bootstrap complete', { 
      file: palaceFile,
      facts: palaceContext.l1Count || palaceContext.l1?.length || 0
    });
    
    // Optionally notify user (disabled by default)
    // event.messages.push('🏰 Palace Memory loaded');
    
  } catch (err) {
    logger.error('Palace bootstrap failed', { error: err.message });
    // Non-fatal: agent continues without Palace context
  }
};

// Export for OpenClaw
export default handler;

// Run if called directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Simulate event
  const testEvent = {
    type: 'agent:bootstrap',
    context: {
      agentId: 'main',
      bootstrapFiles: [
        '/home/erik-ross/.openclaw/workspace/AGENTS.md',
        '/home/erik-ross/.openclaw/workspace/SOUL.md'
      ]
    }
  };
  
  handler(testEvent).then(() => {
    console.log('\n=== Test complete ===');
    console.log('Bootstrap files:', testEvent.context.bootstrapFiles);
  }).catch(err => {
    console.error('Test failed:', err);
  });
}
