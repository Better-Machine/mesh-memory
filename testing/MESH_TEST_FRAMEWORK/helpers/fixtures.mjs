/**
 * @module helpers/fixtures
 * @description Test data factories and fixtures for mesh-memory testing
 */

import { randomUUID } from 'node:crypto';

// ───────────────────────────────────────────────────────────────────────────────
// Memory Event Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock memory event
 * @param {Object} overrides - Properties to override
 * @returns {Object} Memory event
 */
export function createMemoryEvent(overrides = {}) {
  const timestamp = overrides.timestamp || new Date().toISOString();
  
  return {
    agentId: overrides.agentId || `agent-${randomUUID().slice(0, 8)}`,
    role: overrides.role || 'test',
    content: overrides.content || `Test message ${randomUUID().slice(0, 8)}`,
    timestamp,
    tags: overrides.tags || ['test'],
    identity: overrides.identity || {
      name: 'Test Agent',
      role: 'tester',
    },
    identityTag: overrides.identityTag || '[Test Agent / tester]',
    fullTag: overrides.fullTag,
    privacyHints: overrides.privacyHints || [],
    suggestedTag: overrides.suggestedTag,
    ...overrides,
  };
}

/**
 * Creates a private memory event
 * @param {Object} overrides - Properties to override
 * @returns {Object} Private memory event
 */
export function createPrivateEvent(overrides = {}) {
  return createMemoryEvent({
    content: 'This is private information',
    privacyHints: ['contains "private" keyword'],
    ...overrides,
  });
}

/**
 * Creates multiple memory events
 * @param {number} count - Number of events to create
 * @param {Object} baseOverrides - Base properties for all events
 * @returns {Object[]} Array of memory events
 */
export function createMemoryEvents(count, baseOverrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    createMemoryEvent({
      content: `Test message ${i + 1}`,
      ...baseOverrides,
    })
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Thread Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock thread context
 * @param {Object} overrides - Properties to override
 * @returns {Object} Thread context
 */
export function createThreadContext(overrides = {}) {
  const id = overrides.id || randomUUID();
  const now = new Date().toISOString();
  
  return {
    id,
    purpose: overrides.purpose || 'Test collaboration thread',
    scope: overrides.scope || ['test-data', 'shared-context'],
    participants: overrides.participants || ['alice', 'bob', 'charlie'],
    createdBy: overrides.createdBy || 'alice',
    createdAt: overrides.createdAt || now,
    expiresAt: overrides.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: overrides.status || 'open',
    tokens: overrides.tokens || {
      alice: `token-${randomUUID().slice(0, 8)}`,
      bob: `token-${randomUUID().slice(0, 8)}`,
      charlie: `token-${randomUUID().slice(0, 8)}`,
    },
    ...overrides,
  };
}

/**
 * Creates a thread proposal
 * @param {Object} overrides - Properties to override
 * @returns {Object} Thread proposal
 */
export function createThreadProposal(overrides = {}) {
  const id = overrides.id || randomUUID();
  
  return {
    id,
    proposingAgent: overrides.proposingAgent || 'alice',
    purpose: overrides.purpose || 'Test collaboration purpose',
    scope: overrides.scope || ['test-data'],
    participants: overrides.participants || ['alice', 'bob', 'charlie'],
    durationMinutes: overrides.durationMinutes || 10,
    closeCondition: overrides.closeCondition || 'manual',
    proposedAt: overrides.proposedAt || new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a thread consent response
 * @param {Object} overrides - Properties to override
 * @returns {Object} Thread consent response
 */
export function createThreadConsent(overrides = {}) {
  return {
    threadId: overrides.threadId || randomUUID(),
    agentId: overrides.agentId || 'bob',
    accepted: overrides.accepted ?? true,
    respondedAt: overrides.respondedAt || new Date().toISOString(),
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Shared Pool Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock pool entry
 * @param {Object} overrides - Properties to override
 * @returns {Object} Pool entry
 */
export function createPoolEntry(overrides = {}) {
  const timestamp = overrides.provenance?.timestamp || new Date().toISOString();
  const sourceAgent = overrides.provenance?.source_agent || `agent-${randomUUID().slice(0, 8)}`;
  
  return {
    id: overrides.id || randomUUID().replace(/-/g, '').slice(0, 32),
    type: overrides.type || 'fact',
    category: overrides.category || 'test',
    fact: overrides.fact || `Test fact ${randomUUID().slice(0, 8)}`,
    tags: overrides.tags || ['test'],
    provenance: {
      source_agent: sourceAgent,
      timestamp,
      basis: overrides.provenance?.basis || 'observed',
      confidence: overrides.provenance?.confidence ?? 0.9,
      review_by: overrides.provenance?.review_by || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      ...overrides.provenance,
    },
    confirmed_by: overrides.confirmed_by || null,
    decay_rate: overrides.decay_rate || 'slow',
    challenges: overrides.challenges || [],
    ...overrides,
  };
}

/**
 * Creates a pool entry with specific type
 * @param {string} type - Entry type (fact, observation, inference, interpretation, role-assignment, prediction)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Typed pool entry
 */
export function createTypedPoolEntry(type, overrides = {}) {
  const typeSpecificDefaults = {
    fact: { decay_rate: 'slow', basis: 'observed' },
    observation: { decay_rate: 'slow', basis: 'observed' },
    inference: { decay_rate: 'medium', basis: 'inferred' },
    interpretation: { decay_rate: 'fast', basis: 'inferred' },
    'role-assignment': { decay_rate: 'medium', basis: 'self-assessed' },
    prediction: { 
      decay_rate: 'bounded', 
      basis: 'inferred',
      provenance: { review_by: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }
    },
  };
  
  const defaults = typeSpecificDefaults[type] || {};
  
  return createPoolEntry({
    type,
    ...defaults,
    ...overrides,
  });
}

/**
 * Creates multiple pool entries
 * @param {number} count - Number of entries to create
 * @param {Object} baseOverrides - Base properties for all entries
 * @returns {Object[]} Array of pool entries
 */
export function createPoolEntries(count, baseOverrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    createPoolEntry({
      fact: `Test fact ${i + 1}`,
      ...baseOverrides,
    })
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Blind Gate Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock gate
 * @param {Object} overrides - Properties to override
 * @returns {Object} Gate data
 */
export function createGate(overrides = {}) {
  const openedAt = overrides.openedAt || new Date().toISOString();
  const expiresAt = overrides.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
  
  return {
    token: overrides.token || randomUUID(),
    topic: overrides.topic || 'test-topic',
    agentId: overrides.agentId || `agent-${randomUUID().slice(0, 8)}`,
    positionHash: overrides.positionHash || randomUUID().replace(/-/g, '').slice(0, 16),
    position: overrides.position || 'Test independent position',
    openedAt,
    expiresAt,
    used: overrides.used ?? false,
    usedAt: overrides.usedAt || null,
    ...overrides,
  };
}

/**
 * Creates multiple gates for consensus testing
 * @param {number} count - Number of gates
 * @param {string} topic - Common topic
 * @returns {Object[]} Array of gates
 */
export function createConsensusGates(count, topic = 'test-consensus') {
  return Array.from({ length: count }, (_, i) =>
    createGate({
      topic,
      agentId: `agent-${i}`,
      positionHash: `hash-${i}-${randomUUID().slice(0, 8)}`,
    })
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Configuration Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates a valid mesh config
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mesh config
 */
export function createMeshConfig(overrides = {}) {
  return {
    agentId: overrides.agentId || `agent-${randomUUID().slice(0, 8)}`,
    agentName: overrides.agentName || 'Test Agent',
    receiverPort: overrides.receiverPort || 18801,
    receiverToken: overrides.receiverToken || `token-${randomUUID().slice(0, 16)}`,
    threadPort: overrides.threadPort || 18802,
    threadToken: overrides.threadToken || `thread-token-${randomUUID().slice(0, 16)}`,
    relayEnabled: overrides.relayEnabled ?? true,
    relayMaxQueueDepth: overrides.relayMaxQueueDepth || 500,
    peers: overrides.peers || [],
    storageDir: overrides.storageDir || `/tmp/mesh-test-${randomUUID().slice(0, 8)}`,
    privacyKeywords: overrides.privacyKeywords || ['private', 'confidential'],
    features: {
      relayPipeline: true,
      threadManager: true,
      dreamCycle: true,
      sharedPool: true,
      blindGate: true,
      ...overrides.features,
    },
    ...overrides,
  };
}

/**
 * Creates a 3-node mesh configuration
 * @returns {Object[]} Array of 3 configs
 */
export function create3NodeMeshConfig() {
  const ports = [18801, 18802, 18803];
  const tokens = [
    'token-alice-mesh-001',
    'token-bob-mesh-002', 
    'token-charlie-mesh-003',
  ];
  const names = ['alice', 'bob', 'charlie'];
  
  return names.map((name, i) => {
    const peers = names
      .filter((_, idx) => idx !== i)
      .map((peerName, peerIdx) => {
        const actualIdx = names.indexOf(peerName);
        return {
          agentId: peerName,
          receiverUrl: `http://127.0.0.1:${ports[actualIdx]}`,
          token: tokens[actualIdx],
        };
      });
    
    return createMeshConfig({
      agentId: name,
      agentName: name.charAt(0).toUpperCase() + name.slice(1),
      receiverPort: ports[i],
      receiverToken: tokens[i],
      threadPort: ports[i] + 100,
      peers,
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// Error Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Common error patterns for testing
 */
export const ErrorFixtures = {
  /**
   * Creates a validation error
   */
  validationError: (field) => ({
    code: 'VALIDATION_ERROR',
    message: `Missing required field: ${field}`,
    field,
  }),
  
  /**
   * Creates an auth error
   */
  authError: () => ({
    code: 'AUTH_ERROR',
    message: 'Unauthorized',
    status: 401,
  }),
  
  /**
   * Creates a not found error
   */
  notFoundError: (resource) => ({
    code: 'NOT_FOUND',
    message: `${resource} not found`,
    status: 404,
  }),
  
  /**
   * Creates a duplicate error
   */
  duplicateError: (field) => ({
    code: 'DUPLICATE',
    message: `Duplicate entry for ${field}`,
    field,
    status: 409,
  }),
  
  /**
   * Creates a timeout error
   */
  timeoutError: (operation) => ({
    code: 'TIMEOUT',
    message: `Operation timed out: ${operation}`,
    operation,
  }),
};

// ───────────────────────────────────────────────────────────────────────────────
// Stress Test Fixtures
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Creates stress test parameters
 * @param {string} level - 'low', 'medium', 'high', 'extreme'
 * @returns {Object} Stress test parameters
 */
export function createStressParams(level = 'medium') {
  const params = {
    low: {
      messageCount: 100,
      batchSize: 10,
      intervalMs: 100,
      concurrent: 2,
    },
    medium: {
      messageCount: 500,
      batchSize: 50,
      intervalMs: 50,
      concurrent: 5,
    },
    high: {
      messageCount: 1000,
      batchSize: 100,
      intervalMs: 10,
      concurrent: 10,
    },
    extreme: {
      messageCount: 10000,
      batchSize: 500,
      intervalMs: 1,
      concurrent: 50,
    },
  };
  
  return params[level] || params.medium;
}

// ───────────────────────────────────────────────────────────────────────────────
// Export All
// ───────────────────────────────────────────────────────────────────────────────

export default {
  // Memory events
  createMemoryEvent,
  createPrivateEvent,
  createMemoryEvents,
  
  // Threads
  createThreadContext,
  createThreadProposal,
  createThreadConsent,
  
  // Pool
  createPoolEntry,
  createTypedPoolEntry,
  createPoolEntries,
  
  // Gates
  createGate,
  createConsensusGates,
  
  // Config
  createMeshConfig,
  create3NodeMeshConfig,
  
  // Errors
  ErrorFixtures,
  
  // Stress
  createStressParams,
};
