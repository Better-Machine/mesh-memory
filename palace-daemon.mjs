/**
 * Palace Daemon
 * Lightweight HTTP service for Palace memory management
 * Provides wake-up context API, background cleanup, health monitoring
 * 
 * @version 1.0.0
 * @module palace-daemon
 */

import http from 'http';
import { URL } from 'url';
import { CriticalFactsLoader, createLoader, quickLoad } from './critical-facts-loader.mjs';
import { PalaceLogger, LogLevel } from './palace-logger.mjs';
import { PalaceError } from './palace-errors.mjs';
import { existsSync, readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import { homedir } from 'os';

// Configuration
const DEFAULT_CONFIG = {
  port: 18810,
  host: '127.0.0.1',
  dbPath: path.join(homedir(), '.openclaw/workspace/memory/palace/critical-facts.db'),
  passportPath: path.join(homedir(), '.openclaw/workspace/projects/mesh-memory/palace-mvp/agent-passport.json'),
  logLevel: 'INFO',
  cleanupIntervalMinutes: 60, // Cleanup expired facts every hour
  maxWakeUpFacts: 15,       // Max L1 facts to include in wake-up context
  maxWakeUpTokens: 900      // Target token limit for wake-up context
};

// Load config from environment or use defaults
const config = {
  port: parseInt(process.env.PALACE_PORT) || DEFAULT_CONFIG.port,
  host: process.env.PALACE_HOST || DEFAULT_CONFIG.host,
  dbPath: process.env.PALACE_DB_PATH || DEFAULT_CONFIG.dbPath,
  passportPath: process.env.PALACE_PASSPORT_PATH || DEFAULT_CONFIG.passportPath,
  logLevel: process.env.PALACE_LOG_LEVEL || DEFAULT_CONFIG.logLevel,
  cleanupIntervalMinutes: parseInt(process.env.PALACE_CLEANUP_INTERVAL) || DEFAULT_CONFIG.cleanupIntervalMinutes,
  maxWakeUpFacts: parseInt(process.env.PALACE_MAX_WAKEUP_FACTS) || DEFAULT_CONFIG.maxWakeUpFacts,
  maxWakeUpTokens: parseInt(process.env.PALACE_MAX_WAKEUP_TOKENS) || DEFAULT_CONFIG.maxWakeUpTokens
};

// Ensure directories exist
const dbDir = path.dirname(config.dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Logger
const logger = new PalaceLogger({
  minLevel: LogLevel[config.logLevel] || LogLevel.INFO,
  logDir: path.join(dbDir, 'logs'),
  logFile: 'palace-daemon.log'
});

// State
let loader = null;
let cleanupTimer = null;
let server = null;
let isShuttingDown = false;

// Metrics
const metrics = {
  requests: 0,
  errors: 0,
  wakeUpContexts: 0,
  lastCleanup: null,
  startTime: new Date().toISOString()
};

/**
 * Initialize the daemon
 */
async function initialize() {
  logger.info('🏛️  Palace Daemon starting...', { config: { ...config, dbPath: config.dbPath } });

  try {
    // Create and initialize loader
    loader = new CriticalFactsLoader({
      dbPath: config.dbPath,
      passportPath: config.passportPath,
      verbose: config.logLevel === 'DEBUG',
      correlationId: 'daemon-init'
    });

    const initResult = await loader.init();
    if (!initResult.success) {
      throw new PalaceError('Failed to initialize database', { cause: initResult.error });
    }

    logger.info('Database initialized', { dbPath: config.dbPath });

    // Schedule cleanup
    startCleanupScheduler();

    // Start HTTP server
    server = http.createServer(handleRequest);
    server.listen(config.port, config.host, () => {
      logger.info(`🚀 Palace Daemon listening on http://${config.host}:${config.port}`);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      gracefulShutdown();
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise });
    });

  } catch (err) {
    logger.error('Initialization failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req, res) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  metrics.requests++;
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;
  
  logger.debug('Request received', { requestId, route, remoteAddress: req.socket.remoteAddress });

  try {
    let result;
    
    switch (route) {
      case 'GET /.well-known/agent.json':
        result = await handleAgentCard();
        break;
        
      case 'GET /a2a/':
        result = await handleA2ARoot();
        break;
        
      case 'GET /health':
        result = await handleHealth();
        break;
        
      case 'GET /wake-up-context':
        result = await handleWakeUpContext(url);
        break;
        
      case 'GET /facts/critical':
        result = await handleGetCriticalFacts(url);
        break;
        
      case 'GET /facts/search':
        result = await handleSearchFacts(url);
        break;
        
      case 'POST /facts/cleanup':
        result = await handleCleanup();
        break;
        
      case 'GET /metrics':
        result = await handleMetrics();
        break;
        
      default:
        result = { 
          success: false, 
          error: { code: 'NOT_FOUND', message: `Route not found: ${route}` },
          statusCode: 404 
        };
    }

    const duration = Date.now() - startTime;
    const statusCode = result.statusCode || (result.success ? 200 : 400);
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...result,
      requestId,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    }, null, 2));

    logger.debug('Request completed', { requestId, route, statusCode, duration });

  } catch (err) {
    metrics.errors++;
    const duration = Date.now() - startTime;
    
    logger.error('Request failed', { requestId, route, error: err.message, duration });
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId
      },
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    }, null, 2));
  }
}

/**
 * GET /health - Health check endpoint
 */
async function handleHealth() {
  const dbHealthy = loader && loader.db !== null;
  const uptime = process.uptime();
  
  return {
    success: true,
    data: {
      status: dbHealthy ? 'healthy' : 'degraded',
      version: '1.0.0',
      uptime: `${Math.floor(uptime)}s`,
      database: dbHealthy ? 'connected' : 'disconnected',
      lastCleanup: metrics.lastCleanup,
      requestsServed: metrics.requests,
      errors: metrics.errors
    }
  };
}

/**
 * GET /wake-up-context - Generate wake-up context for agent initialization
 */
async function handleWakeUpContext(url) {
  const maxFacts = parseInt(url.searchParams.get('maxFacts')) || config.maxWakeUpFacts;
  const maxTokens = parseInt(url.searchParams.get('maxTokens')) || config.maxWakeUpTokens;
  
  const result = await loader.generateWakeUpContext();
  
  if (!result.success) {
    return { success: false, error: result.error, statusCode: 500 };
  }
  
  metrics.wakeUpContexts++;
  
  const ctx = result.data;
  
  // Apply limits
  const limitedResult = {
    ...ctx,
    l1: ctx.l1.slice(0, maxFacts),
    l1Truncated: ctx.l1.length > maxFacts || ctx.l1Truncated,
    limits: { maxFacts, maxTokens },
    tokenEstimate: ctx.tokenEstimate // Recalculate if truncated
  };
  
  return { success: true, data: limitedResult };
}

/**
 * GET /facts/critical - Get all L1 critical facts
 */
async function handleGetCriticalFacts(url) {
  const limit = parseInt(url.searchParams.get('limit')) || 100;
  const category = url.searchParams.get('category') || null;
  
  const result = loader.getCriticalFacts();
  
  if (!result.success) {
    return { success: false, error: result.error, statusCode: 500 };
  }
  
  let facts = result.data;
  
  // Filter by category if specified
  if (category) {
    facts = facts.filter(f => f.category === category);
  }
  
  // Apply limit
  facts = facts.slice(0, limit);
  
  return { success: true, data: { facts, count: facts.length } };
}

/**
 * GET /facts/search - Search L2 deep facts
 */
async function handleSearchFacts(url) {
  const query = url.searchParams.get('q') || '';
  const limit = parseInt(url.searchParams.get('limit')) || 20;
  
  if (!query) {
    return { 
      success: false, 
      error: { code: 'MISSING_QUERY', message: 'Query parameter "q" is required' },
      statusCode: 400 
    };
  }
  
  const result = loader.searchDeepFacts(query, limit);
  
  if (!result.success) {
    return { success: false, error: result.error, statusCode: 500 };
  }
  
  return { success: true, data: { facts: result.data, query, count: result.data.length } };
}

/**
 * POST /facts/cleanup - Manually trigger expired fact cleanup
 */
async function handleCleanup() {
  const result = loader.deleteExpiredFacts();
  
  if (!result.success) {
    return { success: false, error: result.error, statusCode: 500 };
  }
  
  metrics.lastCleanup = new Date().toISOString();
  const deletedCount = result.data;
  
  logger.info('Cleanup completed', { deletedCount });
  
  return { success: true, data: { deleted: deletedCount, timestamp: metrics.lastCleanup } };
}

/**
 * GET /metrics - Get daemon metrics
 */
async function handleMetrics() {
  const uptime = process.uptime();
  const memory = process.memoryUsage();
  
  return {
    success: true,
    data: {
      daemon: {
        version: '1.0.0',
        startTime: metrics.startTime,
        uptime: `${Math.floor(uptime)}s`,
        memory: {
          rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`
        }
      },
      requests: {
        total: metrics.requests,
        wakeUpContexts: metrics.wakeUpContexts,
        errors: metrics.errors,
        errorRate: metrics.requests > 0 ? `${((metrics.errors / metrics.requests) * 100).toFixed(2)}%` : '0%'
      },
      maintenance: {
        lastCleanup: metrics.lastCleanup,
        cleanupIntervalMinutes: config.cleanupIntervalMinutes
      },
      config: {
        dbPath: config.dbPath,
        maxWakeUpFacts: config.maxWakeUpFacts,
        maxWakeUpTokens: config.maxWakeUpTokens
      }
    }
  };
}

/**
 * GET /.well-known/agent.json - A2A v1.0 Agent Card endpoint
 */
async function handleAgentCard() {
  // Load passport data if available
  let passportData = null;
  try {
    if (existsSync(config.passportPath)) {
      passportData = JSON.parse(readFileSync(config.passportPath, 'utf8'));
    }
  } catch (err) {
    logger.warn('Failed to load passport for Agent Card', { error: err.message });
  }

  // Build A2A v1.0 Agent Card
  const agentCard = {
    name: passportData?.agentId || 'PalaceAgent',
    description: passportData?.description || 'Palace memory daemon - L0-L4 hierarchical agent memory',
    url: `http://${config.host}:${config.port}/a2a/`,
    version: '1.0.0',
    capabilities: {
      a2aVersion: '1.0.0',
      supportsStreaming: true,
      supportsPushNotifications: false
    },
    skills: [
      {
        id: 'palace-memory-l1',
        name: 'Critical Facts (L1)',
        description: 'Always-loaded critical facts and preferences',
        tags: ['memory', 'l1', 'critical-facts'],
        examples: [
          'What are your critical facts?',
          'Store this as critical: project deadline is Friday'
        ]
      },
      {
        id: 'palace-memory-l2',
        name: 'Deep Memory (L2)',
        description: 'Searchable deep memory with semantic retrieval',
        tags: ['memory', 'l2', 'search', 'semantic'],
        examples: [
          'Search memory for past decisions about architecture',
          'What do you remember about project X?'
        ]
      },
      {
        id: 'palace-memory-l3',
        name: 'Temporal Knowledge Graph (L3)',
        description: 'Time-travel knowledge graph with audit trails and retraction',
        tags: ['memory', 'l3', 'temporal', 'kg', 'audit'],
        examples: [
          'What did we decide on March 15?',
          'Show me the history of this fact'
        ]
      },
      {
        id: 'palace-memory-l4',
        name: 'Kingdom (L4)',
        description: 'Multi-agent coordination with vector clocks and consensus',
        tags: ['memory', 'l4', 'kingdom', 'multi-agent', 'consensus'],
        examples: [
          'Coordinate with other agents on this task',
          'What is the fleet consensus on X?'
        ]
      }
    ],
    authentication: {
      schemes: ['none'],
      credentials: null
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    // Palace-specific extensions
    extensions: {
      palace: {
        l0Passport: passportData?.passport || null,
        l1FactCount: loader?.db ? 'available' : 'unavailable',
        apiEndpoints: [
          '/health',
          '/wake-up-context',
          '/facts/critical',
          '/facts/search',
          '/metrics'
        ]
      }
    }
  };

  return {
    success: true,
    data: agentCard
  };
}

/**
 * GET /a2a/ - A2A protocol root endpoint
 */
async function handleA2ARoot() {
  return {
    success: true,
    data: {
      protocol: 'A2A',
      version: '1.0.0',
      status: 'active',
      endpoints: {
        agentCard: '/.well-known/agent.json',
        health: '/health',
        wakeUp: '/wake-up-context'
      },
      capabilities: ['memory', 'coordination'],
      layers: ['L0', 'L1', 'L2', 'L3', 'L4']
    }
  };
}

/**
 * Start background cleanup scheduler
 */
function startCleanupScheduler() {
  const intervalMs = config.cleanupIntervalMinutes * 60 * 1000;
  
  cleanupTimer = setInterval(async () => {
    if (isShuttingDown) return;
    
    logger.info('Running scheduled cleanup...');
    
    try {
      const result = loader.deleteExpiredFacts();
      if (result.success) {
        metrics.lastCleanup = new Date().toISOString();
        if (result.data > 0) {
          logger.info('Cleanup completed', { deletedCount: result.data });
        } else {
          logger.debug('Cleanup completed - no expired facts');
        }
      } else {
        logger.error('Cleanup failed', { error: result.error });
      }
    } catch (err) {
      logger.error('Cleanup error', { error: err.message });
    }
  }, intervalMs);
  
  logger.info('Cleanup scheduler started', { intervalMinutes: config.cleanupIntervalMinutes });
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  logger.info('Shutting down Palace Daemon...');
  
  // Stop cleanup timer
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  
  // Close HTTP server
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }
  
  // Close database
  if (loader) {
    loader.close();
    logger.info('Database connection closed');
  }
  
  logger.info('👋 Palace Daemon stopped');
  
  // Give logger time to flush
  setTimeout(() => process.exit(0), 100);
}

// Start if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initialize();
}

export { initialize, gracefulShutdown, config };
