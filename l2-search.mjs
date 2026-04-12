/**
 * L2 Search Module
 * Advanced search & retrieval for Palace mesh-memory
 * Features: FTS5 with BM25 ranking, vector search, hybrid search, result highlighting
 * 
 * @version 1.0.0
 * @module l2-search
 */

import Database from 'better-sqlite3';
import { PalaceError, ValidationError, DatabaseError, safeExecute, safeExecuteSync } from './palace-errors.mjs';
import { createLogger, generateCorrelationId } from './palace-logger.mjs';
import { VectorStore } from './vector-store.mjs';

/**
 * L2Search class
 * Advanced search with FTS5, BM25 ranking, vector similarity, and hybrid scoring
 */
export class L2Search {
  /**
   * Create a new L2Search instance
   * @param {Object} options - Configuration options
   * @param {Database} options.db - Better-sqlite3 database instance
   * @param {string} options.dbPath - Path to SQLite database (if db not provided)
   * @param {boolean} options.useVectorStore - Enable vector search (default: true)
   * @param {string} options.vectorDbPath - Path to vector database
   * @param {boolean} options.useCache - Enable query caching (default: true)
   * @param {string} options.cacheDbPath - Path to cache database
   * @param {boolean} options.verbose - Enable verbose logging
   * @param {string} options.correlationId - Correlation ID for tracing
   */
  constructor(options = {}) {
    this.db = options.db || null;
    this.dbPath = options.dbPath || './memory/critical-facts.db';
    this.useVectorStore = options.useVectorStore ?? true;
    this.useCache = options.useCache ?? true;
    this.verbose = options.verbose || false;
    this.correlationId = options.correlationId || generateCorrelationId();
    this.logger = createLogger({ minLevel: options.verbose ? 0 : 1 }, this.correlationId)
      .child({ module: 'l2-search' });
    
    // Default search weights
    this.hybridWeights = options.hybridWeights || {
      fts: 0.4,    // Full-text search weight
      vector: 0.6  // Vector similarity weight
    };

    // Sub-components
    this.vectorStore = null;
    this.cacheStore = null;
    this.ftsTableName = 'critical_facts_fts';
    this.factsTableName = 'critical_facts';
  }

  /**
   * Initialize the search module
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  async init() {
    return safeExecute(async () => {
      this.logger.info('Initializing L2Search');

      // Initialize database connection if not provided
      if (!this.db) {
        try {
          this.db = new Database(this.dbPath);
          this.db.pragma('journal_mode = WAL');
        } catch (err) {
          throw DatabaseError.connection(this.dbPath, err, { correlationId: this.correlationId });
        }
      }

      // Verify FTS5 is available
      const ftsAvailable = this._checkFTSAvailable();
      if (!ftsAvailable) {
        this.logger.warn('FTS5 not available, using fallback search');
      }

      // Initialize vector store if enabled
      if (this.useVectorStore) {
        const vectorDbPath = this.dbPath.replace(/\.db$/, '.vectors.db');
        this.vectorStore = new VectorStore({
          dbPath: vectorDbPath,
          verbose: this.verbose,
          correlationId: this.correlationId
        });
        const vectorInit = await this.vectorStore.init();
        if (!vectorInit.success) {
          this.logger.warn('Vector store initialization failed, disabling vector search', 
            { error: vectorInit.error });
          this.useVectorStore = false;
        }
      }

      // Initialize cache if enabled
      if (this.useCache) {
        const cacheDbPath = this.dbPath.replace(/\.db$/, '.search-cache.db');
        this.cacheStore = new SearchCache({
          dbPath: cacheDbPath,
          verbose: this.verbose,
          correlationId: this.correlationId
        });
        const cacheInit = await this.cacheStore.init();
        if (!cacheInit.success) {
          this.logger.warn('Cache store initialization failed, disabling caching',
            { error: cacheInit.error });
          this.useCache = false;
        }
      }

      this.logger.info('L2Search initialized successfully', {
        ftsAvailable,
        vectorEnabled: this.useVectorStore,
        cacheEnabled: this.useCache
      });

      return {
        initialized: true,
        ftsAvailable,
        vectorEnabled: this.useVectorStore,
        cacheEnabled: this.useCache
      };
    }, { operation: 'L2Search.init' });
  }

  /**
   * Close all resources
   * @returns {Object} { success: boolean, error?: Object }
   */
  close() {
    return safeExecuteSync(() => {
      if (this.vectorStore) {
        this.vectorStore.close();
      }
      if (this.cacheStore) {
        this.cacheStore.close();
      }
      if (this.db && this.dbPath) {
        // Only close if we created the connection
        this.db.close();
      }
      this.logger.info('L2Search resources closed');
      return { closed: true };
    }, { operation: 'L2Search.close' });
  }

  /**
   * Search facts using the specified mode
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} options.mode - 'fts', 'vector', 'hybrid' (default: 'hybrid')
   * @param {number} options.limit - Maximum results (default: 20)
   * @param {number} options.minScore - Minimum relevance score (default: 0.1)
   * @param {string} options.category - Filter by category
   * @param {boolean} options.highlight - Enable result highlighting (default: true)
   * @param {boolean} options.useCache - Use query cache (default: true)
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  search(query, options = {}) {
    return safeExecuteSync(() => {
      const mode = options.mode || 'hybrid';
      const limit = Math.min(options.limit || 20, 100);
      const minScore = options.minScore ?? 0.1;
      const highlight = options.highlight ?? true;
      const useCache = options.useCache ?? this.useCache;

      this._ensureInitialized();

      // Validate inputs
      if (!query || typeof query !== 'string') {
        throw ValidationError.invalid('query', query, 'non-empty string');
      }
      if (!['fts', 'vector', 'hybrid'].includes(mode)) {
        throw ValidationError.invalid('mode', mode, "'fts', 'vector', or 'hybrid'");
      }

      this.logger.info('Executing search', { query, mode, limit });

      // Check cache first
      if (useCache && this.cacheStore && mode !== 'vector') {
        const cached = this.cacheStore.get(query, mode, limit, options.category);
        if (cached && cached.success && cached.data) {
          this.logger.debug('Cache hit', { query, mode });
          return cached.data;
        }
      }

      let results;
      let searchMetadata = { mode, query, limit };

      switch (mode) {
        case 'fts':
          results = this._searchFTS(query, limit, minScore, options.category);
          break;
        case 'vector':
          results = this._searchVector(query, limit, minScore);
          break;
        case 'hybrid':
          results = this._searchHybrid(query, limit, minScore, options.category);
          break;
      }

      // Apply highlighting if requested
      if (highlight && results.length > 0) {
        results = this._applyHighlighting(results, query);
      }

      const response = {
        results,
        metadata: {
          ...searchMetadata,
          resultCount: results.length,
          minScore,
          highlight,
          timestamp: new Date().toISOString()
        }
      };

      // Cache the result
      if (useCache && this.cacheStore && mode !== 'vector') {
        this.cacheStore.set(query, mode, limit, options.category, response);
      }

      return response;
    }, { operation: 'search', query: query?.slice(0, 50) });
  }

  /**
   * Full-text search with BM25 ranking
   * @private
   */
  _searchFTS(query, limit, minScore, category) {
    const ftsAvailable = this._checkFTSAvailable();
    const now = new Date().toISOString();

    let sql;
    let params = { query, now, limit };

    if (ftsAvailable) {
      // Use FTS5 with BM25 ranking
      // BM25 returns values < 0 (more negative = less relevant, 0 = most relevant)
      // We normalize to 0-1 scale
      sql = `
        SELECT 
          f.*,
          bm25(${this.ftsTableName}) as bm25_score,
          CASE 
            WHEN bm25(${this.ftsTableName}) < -10 THEN 0.1
            WHEN bm25(${this.ftsTableName}) < -5 THEN 0.3
            WHEN bm25(${this.ftsTableName}) < -2 THEN 0.6
            ELSE 0.9
          END as normalized_score
        FROM ${this.factsTableName} f
        JOIN ${this.ftsTableName} ON f.rowid = ${this.ftsTableName}.rowid
        WHERE ${this.ftsTableName} MATCH @query
          AND f.tier = 'deep'
          AND (f.expires_at IS NULL OR f.expires_at > @now)
          ${category ? 'AND f.category = @category' : ''}
        ORDER BY bm25(${this.ftsTableName}) ASC
        LIMIT @limit
      `;
    } else {
      // Fallback to LIKE search with basic ranking
      sql = `
        SELECT 
          *,
          0.5 as normalized_score,
          CASE 
            WHEN title LIKE @exactPattern THEN 3
            WHEN body LIKE @exactPattern THEN 2
            WHEN title LIKE @pattern THEN 1.5
            ELSE 1
          END as match_boost
        FROM ${this.factsTableName}
        WHERE tier = 'deep'
          AND (expires_at IS NULL OR expires_at > @now)
          AND (title LIKE @pattern OR body LIKE @pattern)
          ${category ? 'AND category = @category' : ''}
        ORDER BY match_boost DESC, updated_at DESC
        LIMIT @limit
      `;
      params = {
        pattern: `%${query}%`,
        exactPattern: query,
        now,
        limit
      };
    }

    if (category) {
      params.category = category;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params);

    return rows.map(row => this._rowToResult(row, 'fts', row.normalized_score || 0.5));
  }

  /**
   * Vector similarity search
   * @private
   */
  async _searchVector(query, limit, minScore) {
    if (!this.useVectorStore || !this.vectorStore) {
      throw new PalaceError('Vector search not available', {
        code: 'VECTOR_NOT_AVAILABLE',
        correlationId: this.correlationId
      });
    }

    // Generate embedding for query
    const embeddingResult = await this.vectorStore.generateEmbedding(query);
    if (!embeddingResult.success) {
      throw new PalaceError('Failed to generate query embedding', {
        code: 'EMBEDDING_FAILED',
        cause: embeddingResult.error,
        correlationId: this.correlationId
      });
    }

    const queryVector = embeddingResult.data;

    // Search for similar vectors
    const searchResult = this.vectorStore.searchSimilar(queryVector, limit * 2, minScore);
    if (!searchResult.success) {
      throw new PalaceError('Vector search failed', {
        code: 'VECTOR_SEARCH_FAILED',
        cause: searchResult.error,
        correlationId: this.correlationId
      });
    }

    // Fetch full facts for matched vectors
    const factIds = searchResult.data.map(r => r.factId);
    if (factIds.length === 0) {
      return [];
    }

    const placeholders = factIds.map(() => '?').join(',');
    const now = new Date().toISOString();
    const sql = `
      SELECT * FROM ${this.factsTableName}
      WHERE id IN (${placeholders})
        AND tier = 'deep'
        AND (expires_at IS NULL OR expires_at > ?)
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...factIds, now);

    // Map vectors scores to results
    const scoreMap = new Map(searchResult.data.map(r => [r.factId, r.score]));
    
    return rows
      .map(row => ({
        ...this._rowToResult(row, 'vector', scoreMap.get(row.id) || 0),
        vectorScore: scoreMap.get(row.id) || 0
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Hybrid search combining FTS and vector scores
   * @private
   */
  _searchHybrid(query, limit, minScore, category) {
    // Get FTS results
    const ftsResults = this._searchFTS(query, limit * 3, 0, category);
    const ftsMap = new Map(ftsResults.map(r => [r.id, { ...r, ftsScore: r.score }]));

    // Get vector results (if available)
    let vectorResults = [];
    if (this.useVectorStore && this.vectorStore) {
      try {
        // Generate embedding and search
        const embeddingResult = this.vectorStore.generateEmbedding(query);
        if (embeddingResult.success) {
          const searchResult = this.vectorStore.searchSimilar(
            embeddingResult.data, 
            limit * 3, 
            0
          );
          if (searchResult.success) {
            // Fetch full facts
            const factIds = searchResult.data.map(r => r.factId);
            if (factIds.length > 0) {
              const placeholders = factIds.map(() => '?').join(',');
              const now = new Date().toISOString();
              const sql = `
                SELECT * FROM ${this.factsTableName}
                WHERE id IN (${placeholders})
                  AND tier = 'deep'
                  AND (expires_at IS NULL OR expires_at > ?)
              `;
              const stmt = this.db.prepare(sql);
              const rows = stmt.all(...factIds, now);
              
              const scoreMap = new Map(searchResult.data.map(r => [r.factId, r.score]));
              vectorResults = rows.map(row => ({
                ...this._rowToResult(row, 'vector', scoreMap.get(row.id) || 0),
                vectorScore: scoreMap.get(row.id) || 0
              }));
            }
          }
        }
      } catch (err) {
        this.logger.warn('Vector search failed in hybrid mode, using FTS only', 
          { error: err.message });
      }
    }

    // Build vector map
    const vectorMap = new Map(vectorResults.map(r => [r.id, r]));

    // Combine results using Reciprocal Rank Fusion (RRF)
    const k = 60; // RRF constant
    const combinedScores = new Map();

    // Process FTS rankings
    ftsResults.forEach((result, rank) => {
      const id = result.id;
      const score = 1 / (k + rank + 1);
      combinedScores.set(id, {
        id,
        ftsScore: result.score,
        vectorScore: 0,
        rrfScore: score * this.hybridWeights.fts,
        ftsRank: rank + 1,
        vectorRank: null,
        result
      });
    });

    // Process vector rankings
    vectorResults.forEach((result, rank) => {
      const id = result.id;
      const score = 1 / (k + rank + 1);
      const existing = combinedScores.get(id);
      
      if (existing) {
        existing.rrfScore += score * this.hybridWeights.vector;
        existing.vectorScore = result.vectorScore;
        existing.vectorRank = rank + 1;
      } else {
        combinedScores.set(id, {
          id,
          ftsScore: 0,
          vectorScore: result.vectorScore,
          rrfScore: score * this.hybridWeights.vector,
          ftsRank: null,
          vectorRank: rank + 1,
          result
        });
      }
    });

    // Sort by combined RRF score and filter
    const sorted = Array.from(combinedScores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .filter(r => r.rrfScore >= minScore)
      .slice(0, limit);

    // Enrich with full data
    return sorted.map(item => ({
      ...item.result,
      score: item.rrfScore,
      scores: {
        combined: item.rrfScore,
        fts: item.ftsScore,
        vector: item.vectorScore,
        ftsRank: item.ftsRank,
        vectorRank: item.vectorRank
      }
    }));
  }

  /**
   * Apply highlighting to search results
   * @private
   */
  _applyHighlighting(results, query) {
    if (!query || results.length === 0) return results;

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return results;

    return results.map(result => {
      const highlighted = { ...result };
      
      // Highlight in title
      if (result.title) {
        highlighted.highlightedTitle = this._highlightText(result.title, terms);
      }
      
      // Highlight in body (truncate and show snippet around match)
      if (result.body) {
        highlighted.highlightedBody = this._highlightSnippet(result.body, terms, 200);
      }

      // Highlight in tags
      if (result.tags && Array.isArray(result.tags)) {
        highlighted.highlightedTags = result.tags.map(tag => 
          this._highlightText(tag, terms)
        );
      }

      return highlighted;
    });
  }

  /**
   * Highlight terms in text with markdown
   * @private
   */
  _highlightText(text, terms) {
    if (!text) return text;
    let highlighted = text;
    
    // Sort by length (longest first) to avoid partial replacements
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
    
    for (const term of sortedTerms) {
      const regex = new RegExp(`(${this._escapeRegex(term)})`, 'gi');
      highlighted = highlighted.replace(regex, '**$1**');
    }
    
    return highlighted;
  }

  /**
   * Extract snippet with highlighting around matches
   * @private
   */
  _highlightSnippet(text, terms, maxLength = 200) {
    if (!text) return text;
    if (text.length <= maxLength) {
      return this._highlightText(text, terms);
    }

    // Find first match position
    const lowerText = text.toLowerCase();
    let bestPos = -1;
    let bestTerm = '';
    
    for (const term of terms) {
      const pos = lowerText.indexOf(term);
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
        bestPos = pos;
        bestTerm = term;
      }
    }

    if (bestPos === -1) {
      // No match found, return start of text
      const snippet = text.slice(0, maxLength - 3) + '...';
      return this._highlightText(snippet, terms);
    }

    // Calculate snippet window
    const contextSize = Math.floor((maxLength - bestTerm.length) / 2);
    const start = Math.max(0, bestPos - contextSize);
    const end = Math.min(text.length, bestPos + bestTerm.length + contextSize);

    let snippet = text.slice(start, end);
    
    // Add ellipsis
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return this._highlightText(snippet, terms);
  }

  /**
   * Escape special regex characters
   * @private
   */
  _escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert database row to search result
   * @private
   */
  _rowToResult(row, source, score) {
    return {
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
      score: score,
      searchSource: source
    };
  }

  /**
   * Check if FTS5 is available
   * @private
   */
  _checkFTSAvailable() {
    try {
      const result = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(this.ftsTableName);
      return !!result;
    } catch {
      return false;
    }
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

  /**
   * Ensure initialized
   * @private
   */
  _ensureInitialized() {
    if (!this.db) {
      throw new PalaceError('L2Search not initialized. Call init() first.', {
        code: 'NOT_INITIALIZED',
        correlationId: this.correlationId
      });
    }
  }

  /**
   * Get search statistics
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  getStats() {
    return safeExecuteSync(() => {
      this._ensureInitialized();

      const stats = {
        ftsAvailable: this._checkFTSAvailable(),
        vectorEnabled: this.useVectorStore,
        cacheEnabled: this.useCache,
        hybridWeights: this.hybridWeights
      };

      // Get counts
      const countSql = `
        SELECT COUNT(*) as count FROM ${this.factsTableName} WHERE tier = 'deep'
      `;
      const { count } = this.db.prepare(countSql).get();
      stats.totalDeepFacts = count;

      if (this.vectorStore) {
        const vectorStats = this.vectorStore.getStats();
        if (vectorStats.success) {
          stats.vectorStore = vectorStats.data;
        }
      }

      if (this.cacheStore) {
        const cacheStats = this.cacheStore.getStats();
        if (cacheStats.success) {
          stats.cacheStore = cacheStats.data;
        }
      }

      return stats;
    }, { operation: 'getStats' });
  }

  /**
   * Clear search cache
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  clearCache() {
    return safeExecuteSync(() => {
      if (this.cacheStore) {
        return this.cacheStore.clear();
      }
      return { cleared: false, reason: 'cache not enabled' };
    }, { operation: 'clearCache' });
  }
}

/**
 * Search Cache class
 * SQLite-backed cache for repeated searches
 */
class SearchCache {
  constructor(options = {}) {
    this.dbPath = options.dbPath || './memory/search-cache.db';
    this.verbose = options.verbose || false;
    this.correlationId = options.correlationId || generateCorrelationId();
    this.logger = createLogger({ minLevel: options.verbose ? 0 : 1 }, this.correlationId)
      .child({ module: 'search-cache' });
    this.db = null;
    this.ttlMinutes = options.ttlMinutes || 60; // Default 1 hour TTL
  }

  async init() {
    return safeExecute(async () => {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS query_cache (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          mode TEXT NOT NULL,
          limit_count INTEGER NOT NULL,
          category TEXT,
          result TEXT NOT NULL, -- JSON serialized
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cache_lookup 
        ON query_cache(query, mode, limit_count, category)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cache_expiry ON query_cache(expires_at)
      `);

      return { initialized: true };
    }, { operation: 'SearchCache.init' });
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  get(query, mode, limit, category) {
    return safeExecuteSync(() => {
      this._cleanupExpired();

      const sql = `
        SELECT result FROM query_cache
        WHERE query = @query AND mode = @mode 
          AND limit_count = @limit
          AND (category IS NULL OR category = @category)
          AND expires_at > @now
        LIMIT 1
      `;

      const stmt = this.db.prepare(sql);
      const row = stmt.get({
        query,
        mode,
        limit,
        category: category || null,
        now: new Date().toISOString()
      });

      if (row) {
        return { success: true, data: JSON.parse(row.result) };
      }
      return { success: false };
    }, { operation: 'SearchCache.get' });
  }

  set(query, mode, limit, category, result) {
    return safeExecuteSync(() => {
      const id = `${query}::${mode}::${limit}::${category || 'all'}`;
      const now = new Date();
      const expires = new Date(now.getTime() + this.ttlMinutes * 60000);

      const sql = `
        INSERT OR REPLACE INTO query_cache 
        (id, query, mode, limit_count, category, result, created_at, expires_at)
        VALUES (@id, @query, @mode, @limit, @category, @result, @createdAt, @expiresAt)
      `;

      const stmt = this.db.prepare(sql);
      stmt.run({
        id,
        query,
        mode,
        limit,
        category: category || null,
        result: JSON.stringify(result),
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString()
      });

      return { cached: true };
    }, { operation: 'SearchCache.set' });
  }

  clear() {
    return safeExecuteSync(() => {
      const sql = 'DELETE FROM query_cache';
      const stmt = this.db.prepare(sql);
      const result = stmt.run();
      return { cleared: true, count: result.changes };
    }, { operation: 'SearchCache.clear' });
  }

  getStats() {
    return safeExecuteSync(() => {
      const countSql = 'SELECT COUNT(*) as count FROM query_cache';
      const { count } = this.db.prepare(countSql).get();

      const expiredSql = `
        SELECT COUNT(*) as count FROM query_cache 
        WHERE expires_at < @now
      `;
      const { count: expired } = this.db.prepare(expiredSql).get({
        now: new Date().toISOString()
      });

      return { count, expiredEntries: expired, ttlMinutes: this.ttlMinutes };
    }, { operation: 'SearchCache.getStats' });
  }

  _cleanupExpired() {
    const sql = 'DELETE FROM query_cache WHERE expires_at < @now';
    const stmt = this.db.prepare(sql);
    stmt.run({ now: new Date().toISOString() });
  }
}

/**
 * Factory function to create and initialize L2Search
 * @param {Object} options - Same as constructor options
 * @returns {Promise<L2Search>} - Initialized L2Search instance
 */
export async function createL2Search(options = {}) {
  const search = new L2Search(options);
  const result = await search.init();
  if (!result.success) {
    throw new PalaceError('Failed to create L2Search', {
      code: 'L2SEARCH_CREATE_FAILED',
      cause: result.error
    });
  }
  return search;
}

export default { L2Search, createL2Search };
