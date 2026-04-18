/**
 * @module config-deep-merge.test
 * @description Tests for config.mjs deep merge functionality
 * Phase 2: Configuration deep merge
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Deep merge function (copy from config.mjs for testing)
 * @param {Object} target - Base object
 * @param {Object} source - Object to merge in
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        source[key] !== null &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        // Deep merge objects
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        // Override primitives and arrays
        result[key] = source[key];
      }
    }
  }
  
  return result;
}

describe('Phase 2 - Config Deep Merge', () => {
  it('P1 - deep merge preserves nested base config', () => {
    const base = {
      agentId: 'agent-a',
      storage: {
        meshLogRetentionDays: 30,
        threadRetentionDays: 7,
        archiveEnabled: true
      }
    };
    const local = {};
    
    const merged = deepMerge(base, local);
    
    assert.strictEqual(merged.agentId, 'agent-a', 'Top-level preserved');
    assert.strictEqual(merged.storage.meshLogRetentionDays, 30, 'Nested base preserved');
    assert.strictEqual(merged.storage.archiveEnabled, true, 'Nested base preserved');
  });

  it('P2 - deep merge overrides nested local config', () => {
    const base = {
      storage: {
        meshLogRetentionDays: 30,
        threadRetentionDays: 7,
        archiveEnabled: true
      }
    };
    const local = {
      storage: {
        meshLogRetentionDays: 60,
        threadRetentionDays: 14
      }
    };
    
    const merged = deepMerge(base, local);
    
    assert.strictEqual(merged.storage.meshLogRetentionDays, 60, 'Local override applied');
    assert.strictEqual(merged.storage.threadRetentionDays, 14, 'Local override applied');
    assert.strictEqual(merged.storage.archiveEnabled, true, 'Base nested preserved');
  });

  it('P3 - deep merge handles deeply nested objects', () => {
    const base = {
      queue: {
        persistenceEnabled: true,
        walMaxSizeMB: 10,
        snapshotIntervalHours: 24
      }
    };
    const local = {
      queue: {
        walMaxSizeMB: 20
      }
    };
    
    const merged = deepMerge(base, local);
    
    assert.strictEqual(merged.queue.walMaxSizeMB, 20, 'Local override applied');
    assert.strictEqual(merged.queue.persistenceEnabled, true, 'Base deeply nested preserved');
  });

  it('P4 - shallow merge would fail this test (baseline)', () => {
    const base = {
      storage: {
        meshLogRetentionDays: 30,
        archiveEnabled: true
      }
    };
    const local = {
      storage: {
        meshLogRetentionDays: 60
      }
    };
    
    const shallow = { ...base, ...local };
    // With shallow merge, storage.archiveEnabled would be undefined
    assert.strictEqual(shallow.storage.archiveEnabled, undefined, 'Shallow merge loses sibling properties');
    
    const deep = deepMerge(base, local);
    // With deep merge, it's preserved
    assert.strictEqual(deep.storage.archiveEnabled, true, 'Deep merge preserves sibling properties');
  });

  it('P5 - arrays are replaced not merged', () => {
    const base = {
      peers: [
        { agentId: 'ray', url: 'http://192.168.1.101:18803' },
        { agentId: 'woodhouse', url: 'http://192.168.1.102:18803' }
      ]
    };
    const local = {
      peers: [
        { agentId: 'ray', url: 'http://192.168.50.22:18803' }
      ]
    };
    
    const merged = deepMerge(base, local);
    
    // Arrays should be replaced entirely, not merged
    assert.strictEqual(merged.peers.length, 1, 'Array replaced, not merged');
    assert.strictEqual(merged.peers[0].url, 'http://192.168.50.22:18803', 'Local array used');
  });

  it('P6 - primitives in local override base', () => {
    const base = {
      relayEnabled: false,
      relayMaxQueueDepth: 500
    };
    const local = {
      relayEnabled: true,
      relayMaxQueueDepth: 1000
    };
    
    const merged = deepMerge(base, local);
    
    assert.strictEqual(merged.relayEnabled, true, 'Primitive override');
    assert.strictEqual(merged.relayMaxQueueDepth, 1000, 'Primitive override');
  });
});
