/**
 * Mesh-Memory Plugin - OpenClaw Plugin Entry Point
 * Phase 1: Foundation Hardening
 * 
 * Features:
 * - OpenClaw plugin lifecycle integration
 * - Register mesh-memory as OpenClaw-managed service
 * - Mount API routes: /mesh/send, /mesh/threads, /mesh/memory/*
 * - Health endpoint: GET /mesh/health
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTokenManager } from './token-manager.mjs';
import { getQueueManager } from './queue-manager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plugin configuration
const PLUGIN_NAME = 'mesh-memory';
const REQUIRED_OPENCLAW_VERSION = '>=2026.4.9';

/**
 * Mesh-Memory Plugin class
 */
export class MeshMemoryPlugin {
  constructor(options = {}) {
    this.config = options.config || {};
    this.logger = options.logger || console;
    this.agentId = this.config.agentId || process.env.MESH_AGENT_ID || 'unknown';
    this.router = null;
    this.tokenManager = null;
    this.queueManager = null;
    this.initialized = false;
    this.health = {
      status: 'initializing',
      services: {}
    };
  }

  /**
   * Plugin initialization - called by OpenClaw during startup
   * @param {Object} ctx - Plugin context from OpenClaw
   */
  async initialize(ctx = {}) {
    try {
      this.logger.log('Initializing mesh-memory plugin...');

      // Initialize token manager
      this.tokenManager = await getTokenManager({
        agentId: this.agentId,
        auditLogPath: path.join(process.env.HOME, '.openclaw/workspace/projects/mesh-memory/logs/token-audit.jsonl')
      });

      // Initialize queue manager
      this.queueManager = await getQueueManager({
        dbPath: path.join(process.env.HOME, '.openclaw/workspace/projects/mesh-memory/queue.db')
      });

      // Create Express router
      this.router = this.createRouter();

      // Register with OpenClaw if ctx provided
      if (ctx.api) {
        ctx.api.mount('/mesh', this.router);
      }

      // Set health status
      this.health = {
        status: 'healthy',
        services: {
          tokenManager: 'ok',
          queueManager: 'ok'
        }
      };

      this.initialized = true;
      this.logger.log('Mesh-memory plugin initialized successfully');

      return {
        status: 'healthy',
        capabilities: {
          mesh: true,
          memory: true,
          tokens: true,
          queue: true
        }
      };
    } catch (err) {
      this.logger.error('Failed to initialize mesh-memory plugin:', err.message);
      this.health = {
        status: 'unhealthy',
        error: err.message,
        services: {}
      };
      throw err;
    }
  }

  /**
   * Create Express router with all mesh endpoints
   */
  createRouter() {
    const router = express.Router();

    // Apply JSON parsing middleware
    router.use(express.json());

    // Token validation middleware (exempt health endpoint)
    router.use(this.tokenManager?.middleware({
      exemptPaths: ['/mesh/health', '/mesh/health/ready', '/mesh/health/live'],
      logAccess: false
    }) || ((req, res, next) => next()));

    // Health endpoints
    router.get('/health', (req, res) => this.handleHealth(req, res));
    router.get('/health/ready', (req, res) => this.handleReadiness(req, res));
    router.get('/health/live', (req, res) => this.handleLiveness(req, res));

    // Mesh message endpoints
    router.post('/send', (req, res) => this.handleSend(req, res));
    router.post('/send/async', (req, res) => this.handleSendAsync(req, res));

    // Thread endpoints
    router.get('/threads', (req, res) => this.handleListThreads(req, res));
    router.get('/threads/:id', (req, res) => this.handleGetThread(req, res));
    router.post('/threads', (req, res) => this.handleCreateThread(req, res));

    // Memory endpoints
    router.get('/memory/search', (req, res) => this.handleSearchMemory(req, res));
    router.post('/memory/write', (req, res) => this.handleWriteMemory(req, res));
    router.get('/memory/:id', (req, res) => this.handleGetMemory(req, res));

    // Token management endpoints
    router.post('/tokens', (req, res) => this.handleCreateToken(req, res));
    router.get('/tokens', (req, res) => this.handleListTokens(req, res));
    router.get('/tokens/:id', (req, res) => this.handleGetToken(req, res));
    router.post('/tokens/:id/rotate', (req, res) => this.handleRotateToken(req, res));
    router.post('/tokens/:id/revoke', (req, res) => this.handleRevokeToken(req, res));
    router.post('/tokens/check-rotation', (req, res) => this.handleCheckRotation(req, res));

    // Queue management endpoints
    router.get('/metrics/queue', (req, res) => this.handleQueueMetrics(req, res));
    router.get('/queue/dlq', (req, res) => this.handleGetDlq(req, res));
    router.post('/queue/dlq/:id/retry', (req, res) => this.handleRetryDlq(req, res));
    router.delete('/queue/dlq/:id', (req, res) => this.handleDeleteDlq(req, res));

    // Error handler
    router.use((err, req, res, next) => {
      this.logger.error('Mesh API error:', err.message);
      res.status(500).json({
        error: 'Internal server error',
        message: err.message
      });
    });

    return router;
  }

  // Health check handlers

  async handleHealth(req, res) {
    const tokenStatus = await this.tokenManager?.getActiveToken() || null;
    const queueStatus = await this.queueManager?.getStatus() || { healthy: false };

    const health = {
      status: this.health.status,
      agentId: this.agentId,
      timestamp: new Date().toISOString(),
      services: {
        tokenManager: tokenStatus ? 'ok' : 'down',
        queueManager: queueStatus.healthy ? 'ok' : 'degraded'
      },
      tokens: {
        active: tokenStatus ? {
          id: tokenStatus.id,
          agentId: tokenStatus.agentId,
          expiresAt: new Date(tokenStatus.expiresAt).toISOString()
        } : null
      },
      queue: {
        healthy: queueStatus.healthy,
        depth: queueStatus.queue?.depth || 0
      }
    };

    const statusCode = this.health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  }

  async handleReadiness(req, res) {
    const isReady = this.initialized && 
                   this.health.status === 'healthy' &&
                   this.tokenManager &&
                   this.queueManager;

    if (isReady) {
      res.json({ ready: true });
    } else {
      res.status(503).json({
        ready: false,
        reason: this.health.error || 'Initializing'
      });
    }
  }

  async handleLiveness(req, res) {
    // Simple liveness check - is the process running?
    res.json({ alive: true });
  }

  // Message handlers

  async handleSend(req, res) {
    try {
      const { peerId, message, priority = 'normal' } = req.body;

      if (!peerId || !message) {
        return res.status(400).json({
          error: 'Missing required fields: peerId, message'
        });
      }

      // Look up peer configuration
      const peer = this.config.peers?.find(p => p.agentId === peerId);
      if (!peer) {
        return res.status(404).json({
          error: `Peer ${peerId} not found`
        });
      }

      // Attempt to send
      const result = await this.sendToPeer(peer, message, { priority });

      res.json({
        status: result.success ? 'sent' : 'queued',
        messageId: result.messageId,
        peerStatus: result.peerStatus
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async handleSendAsync(req, res) {
    // Accept message and queue for async delivery
    try {
      const { peerId, message } = req.body;

      if (!peerId || !message) {
        return res.status(400).json({
          error: 'Missing required fields: peerId, message'
        });
      }

      const peer = this.config.peers?.find(p => p.agentId === peerId);
      if (!peer) {
        return res.status(404).json({
          error: `Peer ${peerId} not found`
        });
      }

      // Always queue for async processing
      const result = await this.queueManager.enqueue({
        message,
        peerId,
        endpoint: peer.url
      });

      res.status(202).json({
        status: 'queued',
        queueId: result.id
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Thread handlers (placeholders for Phase 2+)

  async handleListThreads(req, res) {
    res.json({
      threads: [],
      total: 0,
      note: 'Thread management implementation in progress'
    });
  }

  async handleGetThread(req, res) {
    res.status(501).json({
      error: 'Not implemented',
      note: 'Thread management implementation in progress'
    });
  }

  async handleCreateThread(req, res) {
    res.status(501).json({
      error: 'Not implemented',
      note: 'Thread management implementation in progress'
    });
  }

  // Memory handlers (placeholders for Phase 2+)

  async handleSearchMemory(req, res) {
    const { q, scope = 'all', limit = 20 } = req.query;

    res.json({
      results: [],
      query: q,
      scope,
      note: 'Memory search implementation in progress'
    });
  }

  async handleWriteMemory(req, res) {
    res.status(501).json({
      error: 'Not implemented',
      note: 'Memory write implementation in progress'
    });
  }

  async handleGetMemory(req, res) {
    res.status(501).json({
      error: 'Not implemented',
      note: 'Memory read implementation in progress'
    });
  }

  // Token handlers

  async handleCreateToken(req, res) {
    const result = await this.tokenManager.createToken({
      agentId: req.body?.agentId || this.agentId,
      ttlHours: req.body?.ttlHours,
      actor: req.tokenInfo?.agentId || this.agentId,
      ipAddress: req.ip
    });

    res.status(result.success ? 201 : 400).json(result);
  }

  async handleListTokens(req, res) {
    const tokens = await this.tokenManager.getAllTokens();
    res.json({ tokens, count: tokens.length });
  }

  async handleGetToken(req, res) {
    const result = await this.tokenManager.getTokenStatus(req.params.id);
    res.status(result.found ? 200 : 404).json(result);
  }

  async handleRotateToken(req, res) {
    const result = await this.tokenManager.rotateToken(req.params.id, {
      actor: req.tokenInfo?.agentId || this.agentId,
      ipAddress: req.ip
    });
    res.status(result.success ? 200 : 400).json(result);
  }

  async handleRevokeToken(req, res) {
    const result = await this.tokenManager.revokeToken(req.params.id, {
      actor: req.tokenInfo?.agentId || this.agentId,
      reason: req.body?.reason || 'manual',
      ipAddress: req.ip
    });
    res.status(result.success ? 200 : 404).json(result);
  }

  async handleCheckRotation(req, res) {
    const result = await this.tokenManager.checkAndRotateTokens();
    res.json(result);
  }

  // Queue handlers

  async handleQueueMetrics(req, res) {
    const metrics = await this.queueManager.getMetrics();
    res.json(metrics);
  }

  async handleGetDlq(req, res) {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const result = await this.queueManager.getDlq(limit, offset);
    res.json(result);
  }

  async handleRetryDlq(req, res) {
    const result = await this.queueManager.retryDlqEntry(req.params.id);
    res.status(result.success ? 200 : 404).json(result);
  }

  async handleDeleteDlq(req, res) {
    const result = await this.queueManager.deleteDlqEntry(req.params.id);
    res.status(result.success ? 200 : 404).json(result);
  }

  // Internal methods

  async sendToPeer(peer, message, options = {}) {
    try {
      const response = await fetch(peer.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${peer.token}`
        },
        body: JSON.stringify(message)
      });

      if (response.ok) {
        return {
          success: true,
          messageId: crypto.randomUUID(),
          peerStatus: 'online'
        };
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      // Queue for retry
      await this.queueManager.enqueue({
        message,
        peerId: peer.agentId,
        endpoint: peer.url
      });

      return {
        success: false,
        messageId: null,
        peerStatus: 'offline',
        queued: true
      };
    }
  }

  // Lifecycle hooks for OpenClaw

  /**
   * Gateway startup hook
   */
  async onGatewayStartup(ctx) {
    return await this.initialize(ctx);
  }

  /**
   * Gateway shutdown hook
   */
  async onGatewayShutdown(ctx) {
    this.logger.log('Shutting down mesh-memory plugin...');

    if (this.tokenManager) {
      this.tokenManager.stopRotationTimer();
    }

    if (this.queueManager) {
      await this.queueManager.close();
    }

    this.health.status = 'shutdown';
    this.initialized = false;
  }

  /**
   * Config reload hook
   */
  async onConfigReload(ctx, newConfig) {
    this.logger.log('Reloading mesh-memory configuration...');
    this.config = newConfig;
    
    // Trigger hot reload on managers
    if (this.tokenManager) {
      await this.tokenManager.hotReload();
    }

    return { status: 'applied' };
  }

  /**
   * Health check hook
   */
  async onHealthCheck(ctx) {
    return this.health;
  }
}

// Plugin factory function for OpenClaw
export async function createMeshMemoryPlugin(options = {}) {
  const plugin = new MeshMemoryPlugin(options);
  return plugin;
}

// Default export for direct import
export default MeshMemoryPlugin;
