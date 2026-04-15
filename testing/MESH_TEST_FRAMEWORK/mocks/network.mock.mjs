/**
 * @module mocks/network
 * @description Mock HTTP/fetch for isolated network testing
 * Provides in-memory request/response handling
 */

import { EventEmitter } from 'node:events';

/**
 * Creates a mock HTTP server/client environment
 * @returns {Object} Mock network utilities
 */
export function createMockNetwork() {
  const routes = new Map();
  const requests = [];
  const responses = new Map();
  
  /**
   * Mock Express app
   */
  function createMockApp() {
    const middlewares = [];
    const routeHandlers = new Map();
    
    const app = {
      use: (path, ...handlers) => {
        if (typeof path === 'function') {
          middlewares.push({ path: '*', handler: path });
        } else {
          middlewares.push({ path, handlers });
        }
      },
      
      get: (path, ...handlers) => {
        routeHandlers.set(`GET:${path}`, handlers);
      },
      
      post: (path, ...handlers) => {
        routeHandlers.set(`POST:${path}`, handlers);
      },
      
      put: (path, ...handlers) => {
        routeHandlers.set(`PUT:${path}`, handlers);
      },
      
      delete: (path, ...handlers) => {
        routeHandlers.set(`DELETE:${path}`, handlers);
      },
      
      /**
       * Handle a request
       */
      handleRequest: async (method, path, req = {}) => {
        const res = createMockResponse();
        
        // Build request object
        const request = {
          method,
          path,
          url: path,
          headers: req.headers || {},
          body: req.body || null,
          query: parseQuery(path),
          params: {},
          ...req,
        };
        
        requests.push({ ...request, timestamp: Date.now() });
        
        // Run middlewares
        let idx = 0;
        const next = async () => {
          if (idx < middlewares.length) {
            const mw = middlewares[idx++];
            await mw.handler(request, res, next);
          }
        };
        
        await next();
        
        // Run route handlers
        const routeKey = `${method}:${path}`;
        const handlers = routeHandlers.get(routeKey);
        
        if (handlers) {
          for (const handler of handlers) {
            await handler(request, res, () => {});
          }
        }
        
        return res;
      },
      
      /**
       * Create a mock server
       */
      listen: (port, callback) => {
        const server = createMockServer(port, app);
        routes.set(port, server);
        if (callback) callback();
        return server;
      },
    };
    
    return app;
  }
  
  /**
   * Create mock response object
   */
  function createMockResponse() {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      
      json: (data) => {
        res.body = JSON.stringify(data);
        res.headers['content-type'] = 'application/json';
        return res;
      },
      
      send: (data) => {
        res.body = data;
        return res;
      },
      
      setHeader: (key, value) => {
        res.headers[key.toLowerCase()] = value;
        return res;
      },
      
      getHeader: (key) => res.headers[key.toLowerCase()],
      
      end: () => res,
    };
    
    return res;
  }
  
  /**
   * Create mock server
   */
  function createMockServer(port, app) {
    const server = {
      port,
      app,
      running: true,
      listeners: new EventEmitter(),
      
      close: (callback) => {
        server.running = false;
        routes.delete(port);
        server.listeners.emit('close');
        if (callback) callback();
        return server;
      },
      
      on: (event, handler) => {
        server.listeners.on(event, handler);
        return server;
      },
      
      address: () => ({
        port,
        address: '127.0.0.1',
        family: 'IPv4',
      }),
    };
    
    return server;
  }
  
  /**
   * Parse query string from URL
   */
  function parseQuery(url) {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    
    const query = {};
    const params = new URLSearchParams(url.slice(idx + 1));
    for (const [key, value] of params) {
      query[key] = value;
    }
    return query;
  }
  
  /**
   * Mock fetch implementation
   */
  async function mockFetch(url, options = {}) {
    const parsed = new URL(url, 'http://localhost');
    const port = parsed.port || '80';
    const server = routes.get(parseInt(port));
    
    if (!server) {
      throw new Error(`ECONNREFUSED: Connection refused to port ${port}`);
    }
    
    const method = (options.method || 'GET').toUpperCase();
    const path = parsed.pathname + parsed.search;
    
    const req = {
      method,
      headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : null,
    };
    
    const res = await server.app.handleRequest(method, path, req);
    
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      statusText: getStatusText(res.statusCode),
      headers: {
        get: (key) => res.headers[key.toLowerCase()],
      },
      json: async () => JSON.parse(res.body),
      text: async () => res.body,
    };
  }
  
  /**
   * Get HTTP status text
   */
  function getStatusText(code) {
    const texts = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      500: 'Internal Server Error',
    };
    return texts[code] || 'Unknown';
  }
  
  return {
    createApp: createMockApp,
    createServer: createMockServer,
    createResponse: createMockResponse,
    fetch: mockFetch,
    
    // Test utilities
    __getRequests: () => [...requests],
    __getRoutes: () => new Map(routes),
    __reset: () => {
      routes.clear();
      requests.length = 0;
    },
    
    // Express mock
    express: {
      default: () => createMockApp(),
      json: () => (req, res, next) => {
        if (req.headers['content-type']?.includes('application/json')) {
          req.body = JSON.parse(req.body || '{}');
        }
        next();
      },
    },
  };
}

/**
 * Create peer agent mock for mesh testing
 */
export function createMockPeer(agentId, config = {}) {
  const network = createMockNetwork();
  const app = network.createApp();
  const emitter = new EventEmitter();
  
  // Default receiver endpoints
  app.post('/', async (req, res) => {
    emitter.emit('memoryEvent', req.body);
    res.json({ received: true, agentId });
  });
  
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', agentId });
  });
  
  // Thread endpoints
  app.post('/mesh/threads/propose', (req, res) => {
    emitter.emit('threadProposal', req.body);
    res.json({ status: 'pending', agentId });
  });
  
  app.post('/mesh/threads/consent', (req, res) => {
    emitter.emit('threadConsent', req.body);
    res.json({ accepted: true, agentId });
  });
  
  // Shared pool endpoints
  app.get('/mesh/shared/gates/:topic', (req, res) => {
    res.json([]);
  });
  
  app.post('/mesh/shared/gates', (req, res) => {
    res.status(201).json({ ok: true });
  });
  
  const port = config.port || 18801 + Math.floor(Math.random() * 100);
  const server = app.listen(port);
  
  return {
    agentId,
    port,
    app,
    server,
    network,
    emitter,
    
    // Event handlers
    onEvent: (handler) => emitter.on('memoryEvent', handler),
    onProposal: (handler) => emitter.on('threadProposal', handler),
    onConsent: (handler) => emitter.on('threadConsent', handler),
    
    // Cleanup
    close: () => server.close(),
    
    // Get URL
    getUrl: () => `http://127.0.0.1:${port}`,
  };
}

/**
 * Create a mesh of mock peers
 */
export function createMockMesh(peerCount = 3) {
  const peers = [];
  
  for (let i = 0; i < peerCount; i++) {
    const peer = createMockPeer(`peer-${i}`, { port: 18801 + i });
    peers.push(peer);
  }
  
  return {
    peers,
    
    // Send message from one peer to all others
    broadcast: async (fromIndex, message) => {
      const from = peers[fromIndex];
      const results = [];
      
      for (let i = 0; i < peers.length; i++) {
        if (i !== fromIndex) {
          const to = peers[i];
          try {
            const response = await from.network.fetch(`${to.getUrl()}/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(message),
            });
            results.push({ peer: i, success: response.ok });
          } catch (err) {
            results.push({ peer: i, success: false, error: err.message });
          }
        }
      }
      
      return results;
    },
    
    // Cleanup
    closeAll: () => {
      for (const peer of peers) {
        peer.close();
      }
    },
    
    // Get all received events
    getAllEvents: () => {
      const events = [];
      for (const peer of peers) {
        const reqs = peer.network.__getRequests();
        events.push(...reqs.map(r => ({ ...r, receivedBy: peer.agentId })));
      }
      return events;
    },
  };
}

export default createMockNetwork;
