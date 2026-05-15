/**
 * Palace Bootstrap Hook Handler
 * 
 * Loads Palace Memory context (L0-L4) into agent bootstrap on session start.
 * Fires on `agent:bootstrap` event, modifies bootstrapFiles array.
 */

import { spawn } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';

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
  debug: (msg: string, meta?: any) => log('DEBUG', msg, meta),
  info: (msg: string, meta?: any) => log('INFO', msg, meta),
  warn: (msg: string, meta?: any) => log('WARN', msg, meta),
  error: (msg: string, meta?: any) => log('ERROR', msg, meta)
};

function log(level: string, msg: string, meta?: any) {
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
async function fetchFromDaemon(): Promise<any> {
  const url = `${CONFIG.daemonUrl}/wake-up-context`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      throw new Error(`Daemon returned ${response.status}`);
    }
    
    return await response.json();
  } catch (err) {
    throw new Error(`Daemon fetch failed: ${err.message}`);
  }
}

/**
 * Fetch Palace context via Node.js script (fallback)
 */
async function fetchViaNodeScript(): Promise<any> {
  const scriptPath = path.join(CONFIG.meshMemoryPath, 'palace-mvp/wakeup-hook.mjs');
  
  return new Promise((resolve, reject) => {
    const node = spawn('node', [
      scriptPath,
      '--quick-load',
      '--json-output'
    ], {
      cwd: CONFIG.meshMemoryPath,
      env: {
        ...process.env,
        PALACE_DB_PATH: path.join(CONFIG.workspaceDir, 'memory/palace/critical-facts.db'),
        PALACE_PASSPORT_PATH: path.join(CONFIG.meshMemoryPath, 'palace-mvp/agent-passport.json')
      }
    });
    
    let stdout = '';
    let stderr = '';
    
    node.stdout.on('data', (data) => stdout += data.toString());
    node.stderr.on('data', (data) => stderr += data.toString());
    
    node.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Script exited ${code}: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse script output: ${err.message}`));
      }
    });
    
    node.on('error', (err) => {
      reject(new Error(`Failed to spawn Node: ${err.message}`));
    });
  });
}

/**
 * Load Palace context
 */
async function loadPalaceContext(): Promise<any> {
  // Try daemon first
  if (CONFIG.useDaemon) {
    try {
      logger.debug('Fetching from Palace Daemon');
      const context = await fetchFromDaemon();
      logger.info('Loaded Palace context from daemon', { l1Count: context.l1Count });
      return context;
    } catch (err) {
      logger.warn('Daemon unavailable, falling back to Node script', { error: err.message });
    }
  }
  
  // Fallback to direct Node execution
  try {
    logger.debug('Fetching via Node script');
    const context = await fetchViaNodeScript();
    logger.info('Loaded Palace context via script', { l1Count: context.l1Count });
    return context;
  } catch (err) {
    logger.error('Failed to load Palace context', { error: err.message });
    throw err;
  }
}

/**
 * Format Palace context as bootstrap file content
 */
function formatPalaceContent(context: any): string {
  const lines: string[] = [];
  
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
    
    context.l1.slice(0, CONFIG.maxFacts).forEach((fact: any) => {
      if (fact.content?.title) {
        lines.push(`**${fact.content.title}**`);
        if (fact.content?.body) {
          const body = fact.content.body.length > 200 
            ? fact.content.body.substring(0, 200) + '...'
            : fact.content.body;
          lines.push(`> ${body.split('\n').join('\n> ')}`);
        }
        if (fact.content?.tags?.length) {
          lines.push(`*Tags: ${fact.content.tags.slice(0, 5).join(', ')}*`);
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
const handler = async (event: any) => {
  // Filter: only process agent:bootstrap
  if (event.type !== 'agent:bootstrap') {
    return;
  }
  
  logger.info('Processing agent:bootstrap', { agentId: event.context?.agentId });
  
  try {
    // Load Palace context
    const palaceContext = await loadPalaceContext();
    
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
    const palaceIndex = bootstrapFiles.findIndex((f: string) => 
      f.includes('palace-context-') || f.endsWith('PALACE_CONTEXT.md')
    );
    
    if (palaceIndex >= 0) {
      // Replace existing
      bootstrapFiles[palaceIndex] = palaceFile;
      logger.debug('Replaced existing Palace context file');
    } else {
      // Insert after AGENTS.md if present, otherwise at beginning
      const agentsIndex = bootstrapFiles.findIndex((f: string) => 
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

export default handler;
