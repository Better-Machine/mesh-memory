/**
 * Search API Module
 * HTTP endpoint for L2+ search functionality
 * Provides REST API: GET /search?q=...&mode=fts|vector|hybrid
 * 
 * @version 1.0.0
 * @module search-api
 */

import http from 'http';
import url from 'url';
import { L2Search } from './l2-search.mjs';
import { VectorStore } from './vector-store.mjs';
import { PalaceError, ValidationError, safeExecute } from './palace-errors.mjs';
import { createLogger, generateCorrelationId } from './palace-logger.mjs';

// Default configuration
const DEFAULT_PORT = 3457;
const DEFAULT_HOST = '0.0.0.0';
const MAX_QUERY_LENGTH = 500;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // requests per window

/**
 * SearchAPI class
 * HTTP server providing search endpoints
 */
export class SearchAPI {
  /**
   * Create a new SearchAPI instance
   * @param {Object} options - Configuration options
   * @param {number} options.port - HTTP port (default: 3457)
   * @param {string} options.host - HTTP host (default: 0.0.0.0)
   * @param {string} options.dbPath - Path to critical-facts database
   * @param {boolean} options.useVectorStore - Enable vector search
   * @param {boolean} options.verbose - Enable verbose logging
   * @param {boolean} options.cors - Enable CORS (default: true)
   */
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.host = options.host || DEFAULT_HOST;
    this.dbPath = options.dbPath || './memory/critical-facts.db';
    this.useVectorStore = options.useVectorStore ?? true;
    this.verbose = options.verbose || false;
    this.cors = options.cors ?? true;
    
    this.correlationId = options.correlationId || generateCorrelationId();
    this.logger = createLogger({ minLevel: options.verbose ? 0 : 1 }, this.correlationId)
      .child({ module: 'search-api' });

    this.server = null;
    this.l2Search = null;
    this.rateLimiter = new Map(); // Simple in-memory rate limiter
    
    // Request tracking
    this.requestCount = 0;
    this.startTime = null;
  }

  /**
   * Initialize and start the HTTP server
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
   */
  async start() {
    return safeExecute(async () => {
      this.logger.info('Starting SearchAPI', { port: this.port, host: this.host });

      // Initialize L2Search
      this.l2Search = new L2Search({
        dbPath: this.dbPath,
        useVectorStore: this.useVectorStore,
        useCache: true,
        verbose: this.verbose,
        correlationId: this.correlationId
      });

      const initResult = await this.l2Search.init();
      if (!initResult.success) {
        throw new PalaceError('Failed to initialize L2Search', {
          code: 'INIT_FAILED',
          cause: initResult.error,
          correlationId: this.correlationId
        });
      }

      // Create HTTP server
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      // Start server
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, this.host, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.startTime = new Date();
      this.logger.info('SearchAPI server started', { 
        port: this.port, 
        host: this.host,
        l2Initialized: initResult.data 
      });

      return {
        started: true,
        port: this.port,
        host: this.host,
        url: `http://${this.host}:${this.port}`,
        endpoints: ['/search', '/health', '/stats', '/clear-cache']
      };
    }, { operation: 'SearchAPI.start' });
  }

  /**
   * Stop the HTTP server
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
   */
  async stop() {
    return safeExecute(async () => {
      this.logger.info('Stopping SearchAPI');

      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
        this.server = null;
      }

      if (this.l2Search) {
        this.l2Search.close();
        this.l2Search = null;
      }

      this.logger.info('SearchAPI stopped');
      return { stopped: true };
    }, { operation: 'SearchAPI.stop' });
  }

  /**
   * Handle HTTP request
   * @private
   */
  _handleRequest(req, res) {
    const requestId = generateCorrelationId();
    const startTime = Date.now();
    this.requestCount++;

    // Set CORS headers
    if (this.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse URL
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    const query = parsedUrl.query;

    this.logger.debug('Request received', { 
      method: req.method, 
      path, 
      requestId 
    });

    // Route requests
    try {
      switch (path) {
        case '/search':
          this._handleSearch(req, res, query, requestId);
          break;
        case '/health':
          this._handleHealth(req, res, startTime);
          break;
        case '/stats':
          this._handleStats(req, res);
          break;
        case '/clear-cache':
          this._handleClearCache(req, res);
          break;
        case '/':
          this._handleRoot(req, res);
          break;
        default:
          this._sendError(res, 404, 'Not Found', 'ENDPOINT_NOT_FOUND', requestId);
      }
    } catch (err) {
      this.logger.error('Request handler error', { error: err.message, requestId });
      this._sendError(res, 500, 'Internal Server Error', 'INTERNAL_ERROR', requestId);
    }

    // Log response time
    const duration = Date.now() - startTime;
    this.logger.debug('Request completed', { 
      method: req.method, 
      path, 
      duration, 
      requestId 
    });
  }

  /**
   * Handle search request
   * @private
   */
  _handleSearch(req, res, queryParams, requestId) {
    // Only accept GET
    if (req.method !== 'GET') {
      this._sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', requestId);
      return;
    }

    // Rate limit check
    const clientIp = req.socket.remoteAddress;
    if (this._isRateLimited(clientIp)) {
      this._sendError(res, 429, 'Too Many Requests', 'RATE_LIMITED', requestId, {
        retryAfter: RATE_LIMIT_WINDOW / 1000
      });
      return;
    }

    // Validate query
    const query = queryParams.q || queryParams.query;
    if (!query || typeof query !== 'string') {
      this._sendError(res, 400, 'Missing required parameter: q', 'MISSING_QUERY', requestId);
      return;
    }

    if (query.length > MAX_QUERY_LENGTH) {
      this._sendError(res, 400, 'Query too long', 'QUERY_TOO_LONG', requestId, {
        maxLength: MAX_QUERY_LENGTH
      });
      return;
    }

    // Parse options
    const options = {
      mode: this._parseMode(queryParams.mode),
      limit: this._parseLimit(queryParams.limit),
      minScore: this._parseMinScore(queryParams.minScore),
      category: queryParams.category,
      highlight: queryParams.highlight !== 'false'
    };

    this.logger.info('Executing search', { 
      query: query.slice(0, 50), 
      mode: options.mode,
      requestId 
    });

    // Execute search (handle async vector search)
    const executeSearch = async () => {
      try {
        let result;
        
        // Vector search requires async, but hybrid/FTS are sync
        if (options.mode === 'vector') {
          // For vector mode, we need to handle async
          result = await this._searchVectorAsync(query, options);
        } else {
          // For FTS and hybrid, use sync search
          result = this.l2Search.search(query, options);
        }

        if (!result.success) {
          throw new PalaceError(result.error?.message || 'Search failed', {
            code: result.error?.code || 'SEARCH_FAILED',
            correlationId: requestId
          });
        }

        this._sendJson(res, 200, {
          success: true,
          data: result.data,
          requestId
        });
      } catch (err) {
        this.logger.error('Search error', { error: err.message, requestId });
        this._sendError(res, 500, 'Search failed', 'SEARCH_ERROR', requestId, {
          details: err.message
        });
      }
    };

    executeSearch();
  }

  /**
   * Async wrapper for vector search
   * @private
   */
  async _searchVectorAsync(query, options) {
    // Access the vector store directly for async operation
    if (!this.l2Search.useVectorStore || !this.l2Search.vectorStore) {
      return {
        success: false,
        error: { message: 'Vector search not available', code: 'VECTOR_NOT_AVAILABLE' }
      };
    }

    try {
      // Generate query embedding
      const embeddingResult = await this.l2Search.vectorStore.generateEmbedding(query);
      if (!embeddingResult.success) {
        return embeddingResult;
      }

      // Search for similar vectors
      const searchResult = this.l2Search.vectorStore.searchSimilar(
        embeddingResult.data,
        options.limit * 2,
        options.minScore
      );

      if (!searchResult.success) {
        return searchResult;
      }

      // Fetch full facts
      const factIds = searchResult.data.map(r => r.factId);
      if (factIds.length === 0) {
        return {
          success: true,
          data: { results: [], metadata: { mode: 'vector', query, limit: options.limit } }
        };
      }

      const placeholders = factIds.map(() => '?').join(',');
      const now = new Date().toISOString();
      const sql = `
        SELECT * FROM critical_facts
        WHERE id IN (${placeholders})
          AND tier = 'deep'
          AND (expires_at IS NULL OR expires_at > ?)
      `;

      const stmt = this.l2Search.db.prepare(sql);
      const rows = stmt.all(...factIds, now);

      const scoreMap = new Map(searchResult.data.map(r => [r.factId, r.score]));
      
      const results = rows
        .map(row => ({
          id: row.id,
          tier: row.tier,
          category: row.category,
          type: row.type,
          title: row.title,
          body: row.body,
          tags: this._safeParseJSON(row.tags, []),
          source: row.source,
          author: row.author,
          timestamp: row.timestamp,
          updatedAt: row.updated_at,
          score: scoreMap.get(row.id) || 0,
          searchSource: 'vector',
          vectorScore: scoreMap.get(row.id) || 0
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.limit);

      // Apply highlighting
      if (options.highlight) {
        const highlighted = this.l2Search._applyHighlighting(results, query);
        return {
          success: true,
          data: {
            results: highlighted,
            metadata: {
              mode: 'vector',
              query,
              limit: options.limit,
              resultCount: highlighted.length,
              minScore: options.minScore,
              timestamp: new Date().toISOString()
            }
          }
        };
      }

      return {
        success: true,
        data: {
          results,
          metadata: {
            mode: 'vector',
            query,
            limit: options.limit,
            resultCount: results.length,
            minScore: options.minScore,
            timestamp: new Date().toISOString()
          }
        }
      };
    } catch (err) {
      return {
        success: false,
        error: { message: err.message, code: 'VECTOR_SEARCH_FAILED' }
      };
    }
  }

  /**
   * Parse search mode
   * @private
   */
  _parseMode(mode) {
    const validModes = ['fts', 'vector', 'hybrid'];
    if (validModes.includes(mode)) {
      return mode;
    }
    return 'hybrid'; // Default
  }

  /**
   * Parse limit parameter
   * @private
   */
  _parseLimit(limit) {
    const parsed = parseInt(limit, 10);
    if (isNaN(parsed) || parsed < 1) {
      return 20; // Default
    }
    return Math.min(parsed, 100); // Max 100
  }

  /**
   * Parse minScore parameter
   * @private
   */
  _parseMinScore(minScore) {
    const parsed = parseFloat(minScore);
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      return 0.1; // Default
    }
    return parsed;
  }

  /**
   * Handle health check
   * @private
   */
  _handleHealth(req, res, startTime) {
    const stats = this.l2Search ? this.l2Search.getStats() : { success: false };
    
    this._sendJson(res, 200, {
      success: true,
      status: 'healthy',
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      requestCount: this.requestCount,
      search: stats.success ? stats.data : { error: 'Not initialized' },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle stats request
   * @private
   */
  _handleStats(req, res) {
    if (!this.l2Search) {
      this._sendError(res, 503, 'Service Unavailable', 'NOT_INITIALIZED', null);
      return;
    }

    const stats = this.l2Search.getStats();
    
    if (!stats.success) {
      this._sendError(res, 500, 'Failed to get stats', 'STATS_ERROR', null);
      return;
    }

    this._sendJson(res, 200, {
      success: true,
      data: {
        ...stats.data,
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
        requestCount: this.requestCount
      }
    });
  }

  /**
   * Handle clear cache request
   * @private
   */
  _handleClearCache(req, res) {
    if (req.method !== 'POST') {
      this._sendError(res, 405, 'Method Not Allowed', 'METHOD_NOT_ALLOWED', null);
      return;
    }

    if (!this.l2Search) {
      this._sendError(res, 503, 'Service Unavailable', 'NOT_INITIALIZED', null);
      return;
    }

    const result = this.l2Search.clearCache();
    
    if (!result.success) {
      this._sendError(res, 500, 'Failed to clear cache', 'CACHE_ERROR', null);
      return;
    }

    this._sendJson(res, 200, {
      success: true,
      data: result.data
    });
  }

  /**
   * Handle root endpoint
   * @private
   */
  _handleRoot(req, res) {
    this._sendJson(res, 200, {
      name: 'Palace L2+ Search API',
      version: '1.0.0',
      endpoints: {
        '/search': {
          method: 'GET',
          description: 'Search facts',
          parameters: {
            q: { type: 'string', required: true, description: 'Search query' },
            mode: { type: 'string', enum: ['fts', 'vector', 'hybrid'], default: 'hybrid' },
            limit: { type: 'integer', min: 1, max: 100, default: 20 },
            minScore: { type: 'number', min: 0, max: 1, default: 0.1 },
            category: { type: 'string', description: 'Filter by category' },
            highlight: { type: 'boolean', default: true }
          }
        },
        '/health': {
          method: 'GET',
          description: 'Health check'
        },
        '/stats': {
          method: 'GET',
          description: 'Search statistics'
        },
        '/clear-cache': {
          method: 'POST',
          description: 'Clear search cache'
        }
      }
    });
  }

  /**
   * Check rate limit
   * @private
   */
  _isRateLimited(clientIp) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    // Clean old entries
    for (const [ip, data] of this.rateLimiter) {
      if (data.firstRequest < windowStart) {
        this.rateLimiter.delete(ip);
      }
    }

    const data = this.rateLimiter.get(clientIp);
    if (!data) {
      this.rateLimiter.set(clientIp, { count: 1, firstRequest: now });
      return false;
    }

    if (data.firstRequest < windowStart) {
      // Reset window
      data.count = 1;
      data.firstRequest = now;
      return false;
    }

    if (data.count >= RATE_LIMIT_MAX) {
      return true;
    }

    data.count++;
    return false;
  }

  /**
   * Send JSON response
   * @private
   */
  _sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   * @private
   */
  _sendError(res, status, message, code, requestId, extra = {}) {
    this._sendJson(res, status, {
      success: false,
      error: {
        code,
        message,
        requestId,
        ...extra
      }
    });
  }

  /**
   * Safely parse JSON
   * @private
   */
  _safeParseJSON(str, defaultValue) {
    try {
      return str ? JSON.parse(str) : defaultValue;
    } catch {
      return defaultValue;
    }
  }
}

/**
 * Start the search API server
 * @param {Object} options - Configuration options
 * @returns {Promise<SearchAPI>} - Running SearchAPI instance
 */
export async function startSearchAPI(options = {}) {
  const api = new SearchAPI(options);
  const result = await api.start();
  
  if (!result.success) {
    throw new PalaceError('Failed to start SearchAPI', {
      code: 'API_START_FAILED',
      cause: result.error
    });
  }
  
  return api;
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.SEARCH_API_PORT, 10) || DEFAULT_PORT;
  const host = process.env.SEARCH_API_HOST || DEFAULT_HOST;
  const dbPath = process.env.DB_PATH || './memory/critical-facts.db';
  const verbose = process.env.VERBOSE === 'true';

  const api = new SearchAPI({ port, host, dbPath, verbose });
  
  api.start().then(result => {
    if (result.success) {
      console.log(`Search API running at ${result.data.url}`);
      console.log('Endpoints:', result.data.endpoints.join(', '));
    } else {
      console.error('Failed to start:', result.error);
      process.exit(1);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await api.stop();
    process.exit(0);
  });
}

export default { SearchAPI, startSearchAPI, DEFAULT_PORT };
