/**
 * @module intelligent-cache
 * @description Intelligent Caching with TTL Policies and Hit Ratio Optimization
 * 
 * Provides multi-tier caching with:
 * - TTL policies
 * - Cache invalidation
 * - Hit ratio optimization
 * - Memory pressure handling
 * 
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * Cache entry with metadata
 */
class CacheEntry {
  constructor(key, value, options = {}) {
    this.key = key;
    this.value = value;
    this.createdAt = Date.now();
    this.expiresAt = options.ttl ? this.createdAt + options.ttl : null;
    this.accessCount = 0;
    this.lastAccessed = this.createdAt;
    this.size = options.size || JSON.stringify(value).length;
    this.tags = options.tags || [];
    this.priority = options.priority || 0; // Higher = more important
  }
  
  isExpired() {
    return this.expiresAt !== null && Date.now() > this.expiresAt;
  }
  
  touch() {
    this.accessCount++;
    this.lastAccessed = Date.now();
    return this.value;
  }
  
  recalculateTTL(newTTL) {
    if (newTTL) {
      this.expiresAt = Date.now() + newTTL;
    }
  }
}

/**
 * Intelligent Cache
 * Multi-tier cache with eviction policies and hit ratio optimization
 */
export class IntelligentCache extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      // Size limits
      maxEntries: options.maxEntries || 10000,
      maxSize: options.maxSize || 100 * 1024 * 1024, // 100MB
      
      // TTL policies
      defaultTTL: options.defaultTTL || 5 * 60 * 1000, // 5 minutes
      ttlPolicies: options.ttlPolicies || {
        'token': 24 * 60 * 60 * 1000,      // 24 hours
        'policy': 5 * 60 * 1000,            // 5 minutes
        'peer': 10 * 60 * 1000,             // 10 minutes
        'context': 30 * 60 * 1000,          // 30 minutes
        'query': 2 * 60 * 1000,             // 2 minutes
        'default': 5 * 60 * 1000            // 5 minutes
      },
      
      // Eviction
      evictionPolicy: options.evictionPolicy || 'lru-lfu-hybrid', // lru | lfu | ttl | lru-lfu-hybrid
      evictionBatchSize: options.evictionBatchSize || 100,
      evictionThreshold: options.evictionThreshold || 0.9, // Evict when 90% full
      
      // Stats
      statsIntervalMs: options.statsIntervalMs || 60000,
      
      // Adaptive TTL
      adaptiveTTL: options.adaptiveTTL !== false, // Enabled by default
      hitThreshold: options.hitThreshold || 5, // Boost TTL after 5 hits
      missPenalty: options.missPenalty || 0.1, // Reduce TTL by 10% on miss
      
      ...options
    };
    
    // Cache storage
    this.cache = new Map();
    this.tags = new Map(); // tag -> Set<keys>
    
    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      sets: 0,
      deletes: 0,
      memoryReclaimed: 0,
      peakSize: 0,
      currentSize: 0
    };
    
    // Running state
    this.running = false;
    this.maintenanceInterval = null;
    this.statsInterval = null;
  }
  
  /**
   * Initialize the cache
   */
  initialize() {
    if (this.running) return;
    
    // Start maintenance tasks
    this.maintenanceInterval = setInterval(() => {
      this.performMaintenance();
    }, 60000); // Every minute
    
    // Stats emission
    this.statsInterval = setInterval(() => {
      this.emit('stats', this.getStats());
    }, this.config.statsIntervalMs);
    
    this.running = true;
    console.log('[intelligent-cache] Initialized');
  }
  
  /**
   * Get TTL for a category
   */
  getTTL(category = 'default') {
    return this.config.ttlPolicies[category] || this.config.defaultTTL;
  }
  
  /**
   * Set a cache entry
   */
  set(key, value, options = {}) {
    // Check if we need to evict
    if (this.cache.size >= this.config.maxEntries * this.config.evictionThreshold) {
      this.evictBatch();
    }
    
    // Calculate size
    const size = options.size || this.estimateSize(value);
    
    // Check if adding this would exceed size limit
    if (this.stats.currentSize + size > this.config.maxSize) {
      this.evictBatch();
    }
    
    // Determine TTL
    const category = options.category || 'default';
    let ttl = options.ttl || this.getTTL(category);
    
    // Apply adaptive TTL if enabled
    if (this.config.adaptiveTTL && this.cache.has(key)) {
      const oldEntry = this.cache.get(key);
      if (oldEntry.accessCount >= this.config.hitThreshold) {
        ttl = Math.min(ttl * 1.5, 24 * 60 * 60 * 1000); // Cap at 24 hours
      }
    }
    
    // Create entry
    const entry = new CacheEntry(key, value, {
      ...options,
      ttl,
      size
    });
    
    // Update stats
    const isUpdate = this.cache.has(key);
    if (!isUpdate) {
      this.stats.currentSize += size;
      this.stats.sets++;
      this.stats.peakSize = Math.max(this.stats.peakSize, this.stats.currentSize);
    } else {
      // Replace: adjust size
      const oldEntry = this.cache.get(key);
      this.stats.currentSize -= oldEntry.size;
      this.stats.currentSize += size;
    }
    
    // Store entry
    this.cache.set(key, entry);
    
    // Update tag index
    for (const tag of entry.tags) {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set());
      }
      this.tags.get(tag).add(key);
    }
    
    this.emit('set', { key, size, category });
    return entry;
  }
  
  /**
   * Get a cache entry
   */
  get(key, options = {}) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      this.emit('miss', { key });
      return undefined;
    }
    
    // Check expiration
    if (entry.isExpired()) {
      this.delete(key);
      this.stats.misses++;
      this.stats.expirations++;
      this.emit('miss', { key, reason: 'expired' });
      return options.stale ? entry.value : undefined;
    }
    
    // Touch the entry (update access stats)
    this.stats.hits++;
    this.emit('hit', { key, hits: entry.accessCount + 1 });
    return entry.touch();
  }
  
  /**
   * Check if key exists (without updating stats)
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.isExpired()) {
      this.delete(key);
      return false;
    }
    return true;
  }
  
  /**
   * Delete a cache entry
   */
  delete(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // Remove from cache
    this.cache.delete(key);
    this.stats.currentSize -= entry.size;
    this.stats.deletes++;
    
    // Remove from tag index
    for (const tag of entry.tags) {
      const keys = this.tags.get(tag);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.tags.delete(tag);
        }
      }
    }
    
    this.emit('delete', { key });
    return true;
  }
  
  /**
   * Invalidate by tag
   */
  invalidateTag(tag) {
    const keys = this.tags.get(tag);
    if (!keys) return 0;
    
    let count = 0;
    for (const key of keys) {
      if (this.delete(key)) {
        count++;
      }
    }
    this.tags.delete(tag);
    
    this.emit('invalidate:tag', { tag, count });
    return count;
  }
  
  /**
   * Invalidate by pattern (simple prefix/suffix matching)
   */
  invalidatePattern(pattern) {
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern) || key.startsWith(pattern) || key.endsWith(pattern)) {
        keysToDelete.push(key);
      }
    }
    
    let count = 0;
    for (const key of keysToDelete) {
      if (this.delete(key)) {
        count++;
      }
    }
    
    this.emit('invalidate:pattern', { pattern, count });
    return count;
  }
  
  /**
   * Clear all entries
   */
  clear() {
    const count = this.cache.size;
    
    this.cache.clear();
    this.tags.clear();
    this.stats.memoryReclaimed += this.stats.currentSize;
    this.stats.currentSize = 0;
    
    this.emit('clear', { count });
    return count;
  }
  
  /**
   * Evict a batch of entries based on policy
   */
  evictBatch() {
    const candidates = [];
    const now = Date.now();
    
    for (const entry of this.cache.values()) {
      let score;
      
      switch (this.config.evictionPolicy) {
        case 'lru':
          score = now - entry.lastAccessed;
          break;
        case 'lfu':
          score = -entry.accessCount;
          break;
        case 'ttl':
          score = entry.expiresAt ? entry.expiresAt - now : Infinity;
          break;
        case 'lru-lfu-hybrid':
        default:
          // Combined score: prioritize low access count and old last access
          const age = now - entry.lastAccessed;
          const frequency = Math.max(1, entry.accessCount);
          score = (age / 1000) / frequency; // Age in seconds divided by frequency
          break;
      }
      
      candidates.push({ key: entry.key, score, priority: entry.priority });
    }
    
    // Sort by score (higher = more eligible for eviction), but respect priority
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority first
      }
      return b.score - a.score;
    });
    
    // Evict batch
    const toEvict = candidates.slice(0, this.config.evictionBatchSize);
    let evictedSize = 0;
    
    for (const { key } of toEvict) {
      const entry = this.cache.get(key);
      if (entry) {
        evictedSize += entry.size;
        this.delete(key);
      }
    }
    
    this.stats.evictions += toEvict.length;
    this.stats.memoryReclaimed += evictedSize;
    
    this.emit('evict', { count: toEvict.length, size: evictedSize });
    return toEvict.length;
  }
  
  /**
   * Perform maintenance (cleanup expired entries)
   */
  performMaintenance() {
    const now = Date.now();
    const expired = [];
    
    for (const [key, entry] of this.cache) {
      if (entry.isExpired()) {
        expired.push(key);
      }
    }
    
    for (const key of expired) {
      this.delete(key);
      this.stats.expirations++;
    }
    
    if (expired.length > 0) {
      this.emit('maintenance:expired', { count: expired.length });
    }
    
    return expired.length;
  }
  
  /**
   * Estimate size of a value
   */
  estimateSize(value) {
    try {
      return JSON.stringify(value).length * 2; // UTF-16 = 2 bytes per char
    } catch {
      return 100; // Default estimate
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) : 0;
    
    return {
      entries: this.cache.size,
      size: this.stats.currentSize,
      sizeMB: (this.stats.currentSize / 1024 / 1024).toFixed(2),
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: (hitRate * 100).toFixed(2) + '%',
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      memoryReclaimedMB: (this.stats.memoryReclaimed / 1024 / 1024).toFixed(2),
      peakSizeMB: (this.stats.peakSize / 1024 / 1024).toFixed(2),
      tags: this.tags.size
    };
  }
  
  /**
   * Get entries by tag
   */
  getByTag(tag) {
    const keys = this.tags.get(tag);
    if (!keys) return [];
    
    const results = [];
    for (const key of keys) {
      const entry = this.get(key);
      if (entry !== undefined) {
        results.push({ key, value: entry });
      }
    }
    return results;
  }
  
  /**
   * Shutdown the cache
   */
  shutdown() {
    this.running = false;
    
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    
    this.clear();
    console.log('[intelligent-cache] Shutdown complete');
  }
}

/**
 * Singleton cache instances by name
 */
const caches = new Map();

export function createCache(name, options = {}) {
  if (caches.has(name)) {
    caches.get(name).shutdown();
  }
  
  const cache = new IntelligentCache(options);
  cache.initialize();
  caches.set(name, cache);
  return cache;
}

export function getCache(name) {
  if (!caches.has(name)) {
    // Auto-create with defaults
    return createCache(name);
  }
  return caches.get(name);
}

export function deleteCache(name) {
  const cache = caches.get(name);
  if (cache) {
    cache.shutdown();
    caches.delete(name);
  }
}

export function shutdownAllCaches() {
  for (const [name, cache] of caches) {
    cache.shutdown();
  }
  caches.clear();
}

export default {
  IntelligentCache,
  createCache,
  getCache,
  deleteCache,
  shutdownAllCaches
};
