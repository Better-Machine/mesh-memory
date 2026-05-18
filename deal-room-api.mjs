/**
 * Deal Room HTTP API
 * 
 * REST API for cross-agent secure collaboration
 * Extends Palace daemon with Deal Room endpoints
 * 
 * @module deal-room-api
 * @version 0.1.0
 */

import http from 'http';
import { URL } from 'url';
import { createDealRoom, DealRoom } from './deal-room.mjs';
import { createHash, randomUUID } from 'crypto';

// Configuration
const CONFIG = {
  port: process.env.DEAL_ROOM_PORT || 18811,
  host: process.env.DEAL_ROOM_HOST || '127.0.0.1',
  logLevel: process.env.LOG_LEVEL || 'INFO'
};

// Logger
const logger = {
  info: (msg, meta = {}) => console.log(`[${new Date().toISOString()}] [INFO] [deal-room-api] ${msg}`, meta),
  error: (msg, meta = {}) => console.error(`[${new Date().toISOString()}] [ERROR] [deal-room-api] ${msg}`, meta)
};

/**
 * Deal Room HTTP Server
 */
class DealRoomAPI {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.room = null;
    this.server = null;
  }

  /**
   * Initialize Deal Room and HTTP server
   */
  async init() {
    // Initialize Deal Room
    this.room = await createDealRoom();
    logger.info('Deal Room initialized');

    // Create HTTP server
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });

    // Start listening
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (err) => {
        if (err) {
          logger.error('Failed to start server', { error: err.message });
          reject(err);
          return;
        }
        
        logger.info('🚀 Deal Room API listening', {
          host: this.config.host,
          port: this.config.port
        });
        
        resolve(this);
      });
    });
  }

  /**
   * Handle HTTP requests
   */
  async _handleRequest(req, res) {
    const startTime = Date.now();
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse body for POST/PUT
    let body = '';
    if (['POST', 'PUT'].includes(req.method)) {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
    }

    // Route handling
    try {
      const result = await this._route(url.pathname, req.method, url.searchParams, body);
      
      res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body || result));
      
      logger.info(`${req.method} ${url.pathname}`, {
        status: result.status || 200,
        duration: Date.now() - startTime
      });
      
    } catch (error) {
      logger.error(`${req.method} ${url.pathname}`, { error: error.message });
      
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  /**
   * Route requests to handlers
   */
  async _route(path, method, query, body) {
    const jsonBody = body ? JSON.parse(body) : {};
    
    // Health check
    if (path === '/health' && method === 'GET') {
      return {
        success: true,
        data: {
          status: 'healthy',
          version: '0.1.0',
          timestamp: new Date().toISOString()
        }
      };
    }

    // Create deal
    if (path === '/deals' && method === 'POST') {
      const deal = this.room.createDeal({
        initiator: jsonBody.initiator,
        recipient: jsonBody.recipient,
        payload: JSON.stringify(jsonBody.payload),
        conditions: jsonBody.conditions || {}
      });
      
      return {
        success: true,
        data: deal
      };
    }

    // List deals
    if (path === '/deals' && method === 'GET') {
      const agentId = query.get('agent');
      if (!agentId) {
        throw Object.assign(new Error('agent parameter required'), { status: 400 });
      }
      
      const deals = this.room.listDeals(agentId, {
        status: query.get('status')
      });
      
      return {
        success: true,
        data: { deals, count: deals.length }
      };
    }

    // Get specific deal
    if (path.startsWith('/deals/') && method === 'GET') {
      const dealId = path.split('/')[2];
      const deal = this.room.getDeal(dealId);
      
      if (!deal) {
        throw Object.assign(new Error('Deal not found'), { status: 404 });
      }
      
      return {
        success: true,
        data: deal
      };
    }

    // Approve/reject deal
    if (path.match(/^\/deals\/[^\/]+\/approve$/) && method === 'POST') {
      const dealId = path.split('/')[2];
      const result = this.room.approveDeal(dealId, jsonBody.agentId, jsonBody.action);
      
      return {
        success: true,
        data: result
      };
    }

    // Retrieve payload (only if released)
    if (path.match(/^\/deals\/[^\/]+\/payload$/) && method === 'POST') {
      const dealId = path.split('/')[2];
      const result = this.room.retrievePayload(dealId, jsonBody.agentId);
      
      return {
        success: true,
        data: {
          dealId: result.dealId,
          payload: JSON.parse(result.payload),
          retrievedBy: result.retrievedBy,
          timestamp: result.timestamp
        }
      };
    }

    // Get audit trail
    if (path.match(/^\/deals\/[^\/]+\/audit$/) && method === 'GET') {
      const dealId = path.split('/')[2];
      const audit = this.room.getAuditTrail(dealId);
      
      return {
        success: true,
        data: { dealId, entries: audit }
      };
    }

    // Agent vault - store private data
    if (path === '/vault' && method === 'POST') {
      this.room.storeInVault(jsonBody.agentId, jsonBody.data, jsonBody.metadata);
      
      return {
        success: true,
        data: {
          agentId: jsonBody.agentId,
          storedAt: new Date().toISOString()
        }
      };
    }

    // Cross-agent sync endpoint
    if (path === '/sync' && method === 'POST') {
      // This would handle mesh synchronization
      // For now, return placeholder
      return {
        success: true,
        data: {
          message: 'Sync endpoint - mesh coordination not yet implemented',
          timestamp: new Date().toISOString()
        }
      };
    }

    // 404
    throw Object.assign(new Error('Not found'), { status: 404 });
  }

  /**
   * Close server and Deal Room
   */
  async close() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP server closed');
          if (this.room) {
            this.room.close();
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Factory function
export async function createDealRoomAPI(options = {}) {
  const api = new DealRoomAPI(options);
  await api.init();
  return api;
}

export { DealRoomAPI };

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🏛️  Deal Room HTTP API');
  console.log('Starting server...\n');
  
  createDealRoomAPI().then(api => {
    console.log('\n✅ Server ready');
    console.log('');
    console.log('API Endpoints:');
    console.log('  GET  /health              - Health check');
    console.log('  GET  /deals?agent={id}    - List deals for agent');
    console.log('  POST /deals               - Create new deal');
    console.log('  GET  /deals/{id}          - Get deal details');
    console.log('  POST /deals/{id}/approve  - Approve/reject deal');
    console.log('  POST /deals/{id}/payload  - Retrieve payload (if released)');
    console.log('  GET  /deals/{id}/audit    - Get audit trail');
    console.log('  POST /vault               - Store in agent vault');
    console.log('  POST /sync                - Cross-agent sync');
    console.log('');
    console.log('Press Ctrl+C to stop');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down...');
      await api.close();
      process.exit(0);
    });
    
  }).catch(err => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}
