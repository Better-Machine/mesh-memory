/**
 * Critical Facts Loader
 * Loads L1 (critical) facts and L2 (deep) facts from SQLite
 * Generates wake-up context for session initialization
 *
 * @version 1.1.0
 * @module critical-facts-loader
 */

import Database from 'better-sqlite3';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PalaceError, ValidationError, DatabaseError, safeExecute, safeExecuteSync } from './palace-errors.mjs';
import { createLogger, generateCorrelationId } from './palace-logger.mjs';

/**
 * CriticalFactsLoader class
 * Manages critical (L1) and deep (L2) facts for mesh-memory
 */
export class CriticalFactsLoader {
  /**
   * Create a new CriticalFactsLoader instance
   * @param {Object} options - Configuration options
   * @param {string} options.dbPath - Path to SQLite database
   * @param {string} options.passportPath - Path to agent-passport.json
   * @param {boolean} options.verbose - Enable verbose logging
   * @param {string} options.correlationId - Correlation ID for request tracing
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || './memory/critical-facts.db';
    this.passportPath = options.passportPath || './palace-mvp/agent-passport.json';
    this.verbose = options.verbose || false;
    this.db = null;
    this.correlationId = options.correlationId || generateCorrelationId();
    this.logger = createLogger({ minLevel: options.verbose ? 0 : 1 }, this.correlationId)
      .child({ module: 'critical-facts-loader' });
  }

  /**
   * Initialize the database connection and create tables
   * @returns {Promise<Object>} { success: boolean, data?: any, error?: Object }
   */
  async init() {
    return safeExecute(async () => {
      this.logger.info('Initializing CriticalFactsLoader', { dbPath: this.dbPath });

      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      const dirResult = await safeExecute(async () => {
        if (!existsSync(dbDir)) {
          await fs.mkdir(dbDir, { recursive: true });
        }
        return true;
      }, { operation: 'createDirectory', path: dbDir });

      if (!dirResult.success) {
        throw new PalaceError('Failed to create database directory', {
          code: 'INIT_FAILED',
          context: { dbDir },
          correlationId: this.correlationId
        });
      }

      // Open database with error handling
      try {
        this.db = new Database(this.dbPath);
      } catch (err) {
        throw DatabaseError.connection(this.dbPath, err, { correlationId: this.correlationId });
      }

      // Enable WAL mode for better concurrency
      try {
        this.db.pragma('journal_mode = WAL');
      } catch (err) {
        this.logger.warn('Could not enable WAL mode', { error: err.message });
        // Non-fatal: continue without WAL
      }

      // Create tables
      const tableResult = safeExecuteSync(() => {
        this._createTables();
        this._createFTSIndex();
        return true;
      }, { operation: 'createTables' });

      if (!tableResult.success) {
        throw DatabaseError.query('CREATE TABLE', tableResult.error, { correlationId: this.correlationId });
      }

      this.logger.info('Database initialized successfully');
      return { initialized: true, dbPath: this.dbPath };
    }, { operation: 'CriticalFactsLoader.init' });
  }

  /**
   * Close database connection
   * @returns {Object} { success: boolean, error?: Object }
   */
  close() {
    return safeExecuteSync(() => {
      if (this.db) {
        this.db.close();
        this.db = null;
        this.logger.info('Database connection closed');
      }
      return { closed: true };
    }, { operation: 'close' });
  }

  /**
   * Create critical_facts table
   * @private
   */
  _createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS critical_facts (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL CHECK(tier IN ('critical', 'deep')),
        category TEXT NOT NULL CHECK(category IN ('standing_instructions', 'projects', 'people', 'infrastructure', 'blockers', 'events')),
        type TEXT CHECK(type IN ('decision', 'event', 'date', 'config', 'observation')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT, -- JSON array
        source TEXT NOT NULL,
        author TEXT,
        timestamp TEXT NOT NULL,
        source_version TEXT,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        relations TEXT, -- JSON array
        content_extra TEXT -- JSON for additional content fields
      )
    `;

    this.db.exec(createTableSQL);

    // Create indexes
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tier ON critical_facts(tier)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_category ON critical_facts(category)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_expires_at ON critical_facts(expires_at)`);
  }

  /**
   * Create FTS5 index for full-text search on deep facts
   * @private
   */
  _createFTSIndex() {
    const createFTSSQL = `
      CREATE VIRTUAL TABLE IF NOT EXISTS critical_facts_fts USING fts5(
        title,
        body,
        tags,
        content='critical_facts',
        content_rowid='rowid'
      )
    `;

    // Triggers to keep FTS index in sync
    const createTriggersSQL = `
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON critical_facts BEGIN
        INSERT INTO critical_facts_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON critical_facts BEGIN
        INSERT INTO critical_facts_fts(critical_facts_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON critical_facts BEGIN
        INSERT INTO critical_facts_fts(critical_facts_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, old.tags);
        INSERT INTO critical_facts_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, new.tags);
      END;
    `;

    try {
      this.db.exec(createFTSSQL);
      this.db.exec(createTriggersSQL);
    } catch (err) {
      // FTS5 might not be available, log but continue (graceful degradation)
      this.logger.warn('FTS5 not available, using fallback search', { error: err.message });
    }
  }

  /**
   * Validate fact structure
   * @private
   * @param {Object} fact - Fact to validate
   * @returns {ValidationError|null} - Validation error or null if valid
   */
  _validateFact(fact) {
    if (!fact || typeof fact !== 'object') {
      return ValidationError.schema('Fact must be an object');
    }

    // Validate required fields
    const requiredFields = ['id', 'tier', 'category', 'content', 'provenance', 'updated_at'];
    for (const field of requiredFields) {
      if (!fact[field]) {
        return ValidationError.required(field, { factId: fact.id });
      }
    }

    // Validate tier
    if (!['critical', 'deep'].includes(fact.tier)) {
      return ValidationError.invalid('tier', fact.tier, "'critical' or 'deep'", { factId: fact.id });
    }

    // Validate category
    const validCategories = ['standing_instructions', 'projects', 'people', 'infrastructure', 'blockers', 'events'];
    if (!validCategories.includes(fact.category)) {
      return ValidationError.invalid('category', fact.category, `one of: ${validCategories.join(', ')}`, { factId: fact.id });
    }

    // Validate content structure
    if (fact.content && typeof fact.content === 'object') {
      if (!fact.content.title) {
        return ValidationError.required('content.title', { factId: fact.id });
      }
      if (!fact.content.body) {
        return ValidationError.required('content.body', { factId: fact.id });
      }
    }

    return null;
  }

  /**
   * Insert a new fact into the database
   * @param {Object} fact - Fact object matching critical-facts.schema.json
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  insertFact(fact) {
    return safeExecuteSync(() => {
      this._ensureDb();

      // Validate input
      const validationError = this._validateFact(fact);
      if (validationError) {
        this.logger.warn('Fact validation failed', { 
          factId: fact?.id, 
          errors: validationError.message 
        });
        throw validationError;
      }

      const sql = `
        INSERT OR REPLACE INTO critical_facts (
          id, tier, category, type, title, body, tags,
          source, author, timestamp, source_version,
          updated_at, expires_at, relations, content_extra
        ) VALUES (
          @id, @tier, @category, @type, @title, @body, @tags,
          @source, @author, @timestamp, @source_version,
          @updated_at, @expires_at, @relations, @content_extra
        )
      `;

      const params = {
        id: fact.id,
        tier: fact.tier,
        category: fact.category,
        type: fact.type || null,
        title: fact.content?.title || '',
        body: fact.content?.body || '',
        tags: fact.content?.tags ? JSON.stringify(fact.content.tags) : '[]',
        source: fact.provenance?.source || 'unknown',
        author: fact.provenance?.author || null,
        timestamp: fact.provenance?.timestamp || new Date().toISOString(),
        source_version: fact.provenance?.source_version || '1.0.0',
        updated_at: fact.updated_at,
        expires_at: fact.expires_at || null,
        relations: fact.relations ? JSON.stringify(fact.relations) : '[]',
        content_extra: this._extractExtraContent(fact.content)
      };

      try {
        const stmt = this.db.prepare(sql);
        const result = stmt.run(params);
        
        this.logger.info('Fact inserted', { factId: fact.id, tier: fact.tier, rowId: result.lastInsertRowid });
        
        return { ...fact, _rowid: result.lastInsertRowid };
      } catch (err) {
        throw DatabaseError.query('INSERT', err, { 
          factId: fact.id, 
          correlationId: this.correlationId 
        });
      }
    }, { operation: 'insertFact', factId: fact?.id });
  }

  /**
   * Extract extra content fields (non-standard fields in content object)
   * @private
   */
  _extractExtraContent(content) {
    if (!content) return '{}';
    const standardFields = ['title', 'body', 'tags'];
    const extra = {};
    for (const [key, value] of Object.entries(content)) {
      if (!standardFields.includes(key)) {
        extra[key] = value;
      }
    }
    return Object.keys(extra).length > 0 ? JSON.stringify(extra) : '{}';
  }

  /**
   * Get all critical (L1) facts that are not expired
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  getCriticalFacts() {
    return safeExecuteSync(() => {
      this._ensureDb();

      const now = new Date().toISOString();
      const sql = `
        SELECT * FROM critical_facts
        WHERE tier = 'critical'
          AND (expires_at IS NULL OR expires_at > @now)
        ORDER BY updated_at DESC
      `;

      try {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all({ now });
        
        this.logger.debug('Retrieved critical facts', { count: rows.length });
        
        return rows.map(row => this._rowToFact(row));
      } catch (err) {
        throw DatabaseError.query('SELECT critical_facts', err, { correlationId: this.correlationId });
      }
    }, { operation: 'getCriticalFacts' });
  }

  /**
   * Search deep (L2) facts using full-text search
   * @param {string} query - Search query
   * @param {number} limit - Maximum results (default: 20)
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  searchDeepFacts(query, limit = 20) {
    return safeExecuteSync(() => {
      this._ensureDb();

      // Validate inputs
      if (!query || typeof query !== 'string') {
        throw ValidationError.invalid('query', query, 'non-empty string');
      }
      if (typeof limit !== 'number' || limit < 1 || limit > 100) {
        throw ValidationError.invalid('limit', limit, 'number between 1 and 100');
      }

      const now = new Date().toISOString();

      // Check if FTS table exists
      const ftsExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE name = 'critical_facts_fts'"
      ).get();

      let rows;
      try {
        if (ftsExists) {
          // Use FTS5 - use bm25 ranking for better relevance
          const sql = `
            SELECT f.* FROM critical_facts f
            JOIN critical_facts_fts ON f.rowid = critical_facts_fts.rowid
            WHERE critical_facts_fts MATCH @query
              AND f.tier = 'deep'
              AND (f.expires_at IS NULL OR f.expires_at > @now)
            ORDER BY bm25(critical_facts_fts)
            LIMIT @limit
          `;
          const stmt = this.db.prepare(sql);
          rows = stmt.all({ query, now, limit });
        } else {
          // Fallback to LIKE search (graceful degradation)
          const fallbackSql = `
            SELECT * FROM critical_facts
            WHERE tier = 'deep'
              AND (expires_at IS NULL OR expires_at > @now)
              AND (title LIKE @pattern OR body LIKE @pattern)
            ORDER BY updated_at DESC
            LIMIT @limit
          `;
          const fallbackStmt = this.db.prepare(fallbackSql);
          rows = fallbackStmt.all({
            pattern: `%${query}%`,
            now,
            limit
          });
        }

        this.logger.debug('Searched deep facts', { query, results: rows.length });
        
        return rows.map(row => this._rowToFact(row));
      } catch (err) {
        throw DatabaseError.query('searchDeepFacts', err, { 
          query, 
          limit, 
          correlationId: this.correlationId 
        });
      }
    }, { operation: 'searchDeepFacts', query, limit });
  }

  /**
   * Get all deep (L2) facts (for bulk operations)
   * @param {Object} options - Query options
   * @param {string} options.category - Filter by category
   * @param {number} options.limit - Maximum results
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  getDeepFacts(options = {}) {
    return safeExecuteSync(() => {
      this._ensureDb();

      const now = new Date().toISOString();
      let sql = `
        SELECT * FROM critical_facts
        WHERE tier = 'deep'
          AND (expires_at IS NULL OR expires_at > @now)
      `;

      const params = { now };

      if (options.category) {
        sql += ' AND category = @category';
        params.category = options.category;
      }

      sql += ' ORDER BY updated_at DESC';

      if (options.limit) {
        if (typeof options.limit !== 'number' || options.limit < 1) {
          throw ValidationError.invalid('options.limit', options.limit, 'positive number');
        }
        sql += ' LIMIT @limit';
        params.limit = options.limit;
      }

      try {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all(params);
        
        this.logger.debug('Retrieved deep facts', { count: rows.length, category: options.category });
        
        return rows.map(row => this._rowToFact(row));
      } catch (err) {
        throw DatabaseError.query('getDeepFacts', err, { 
          options, 
          correlationId: this.correlationId 
        });
      }
    }, { operation: 'getDeepFacts', options });
  }

  /**
   * Get expired facts for cleanup
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  getExpiredFacts() {
    return safeExecuteSync(() => {
      this._ensureDb();

      const now = new Date().toISOString();
      const sql = `
        SELECT * FROM critical_facts
        WHERE expires_at IS NOT NULL AND expires_at < @now
      `;

      try {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all({ now });
        return rows.map(row => this._rowToFact(row));
      } catch (err) {
        throw DatabaseError.query('getExpiredFacts', err, { correlationId: this.correlationId });
      }
    }, { operation: 'getExpiredFacts' });
  }

  /**
   * Delete expired facts
   * @returns {Object} { success: boolean, data?: number, error?: Object }
   */
  deleteExpiredFacts() {
    return safeExecuteSync(() => {
      this._ensureDb();

      const now = new Date().toISOString();
      const sql = `
        DELETE FROM critical_facts
        WHERE expires_at IS NOT NULL AND expires_at < @now
      `;

      try {
        const stmt = this.db.prepare(sql);
        const result = stmt.run({ now });
        
        if (result.changes > 0) {
          this.logger.info('Deleted expired facts', { count: result.changes });
        }
        
        return result.changes;
      } catch (err) {
        throw DatabaseError.query('deleteExpiredFacts', err, { correlationId: this.correlationId });
      }
    }, { operation: 'deleteExpiredFacts' });
  }

  /**
   * Get a fact by ID
   * @param {string} id - Fact ID
   * @returns {Object} { success: boolean, data?: Object|null, error?: Object }
   */
  getFactById(id) {
    return safeExecuteSync(() => {
      this._ensureDb();

      if (!id || typeof id !== 'string') {
        throw ValidationError.invalid('id', id, 'non-empty string');
      }

      const sql = 'SELECT * FROM critical_facts WHERE id = @id';
      
      try {
        const stmt = this.db.prepare(sql);
        const row = stmt.get({ id });
        
        this.logger.debug('Retrieved fact by ID', { id, found: !!row });
        
        return row ? this._rowToFact(row) : null;
      } catch (err) {
        throw DatabaseError.query('getFactById', err, { id, correlationId: this.correlationId });
      }
    }, { operation: 'getFactById', id });
  }

  /**
   * Delete a fact by ID
   * @param {string} id - Fact ID
   * @returns {Object} { success: boolean, data?: boolean, error?: Object }
   */
  deleteFact(id) {
    return safeExecuteSync(() => {
      this._ensureDb();

      if (!id || typeof id !== 'string') {
        throw ValidationError.invalid('id', id, 'non-empty string');
      }

      const sql = 'DELETE FROM critical_facts WHERE id = @id';
      
      try {
        const stmt = this.db.prepare(sql);
        const result = stmt.run({ id });
        
        if (result.changes > 0) {
          this.logger.info('Fact deleted', { id });
        }
        
        return result.changes > 0;
      } catch (err) {
        throw DatabaseError.query('deleteFact', err, { id, correlationId: this.correlationId });
      }
    }, { operation: 'deleteFact', id });
  }

  /**
   * Load agent passport (L0 context)
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
   * @private
   */
  async _loadPassport() {
    const result = await safeExecute(async () => {
      const content = await fs.readFile(this.passportPath, 'utf-8');
      return JSON.parse(content);
    }, { operation: '_loadPassport', path: this.passportPath });

    if (!result.success) {
      this.logger.warn('Could not load passport, using defaults', { 
        path: this.passportPath,
        error: result.error?.message 
      });
      return {
        success: true,
        data: {
          agent: { id: 'unknown', name: 'unknown' },
          error: 'passport not found'
        }
      };
    }

    return result;
  }

  /**
   * Convert database row to fact object
   * @private
   */
  _rowToFact(row) {
    const fact = {
      id: row.id,
      tier: row.tier,
      category: row.category,
      type: row.type,
      content: {
        title: row.title,
        body: row.body,
        tags: this._safeParseJSON(row.tags, [])
      },
      provenance: {
        source: row.source,
        author: row.author,
        timestamp: row.timestamp,
        source_version: row.source_version
      },
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      relations: this._safeParseJSON(row.relations, [])
    };

    // Merge extra content fields
    if (row.content_extra && row.content_extra !== '{}') {
      const extra = this._safeParseJSON(row.content_extra, {});
      Object.assign(fact.content, extra);
    }

    return fact;
  }

  /**
   * Safely parse JSON with fallback
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
   * Ensure database is initialized
   * @private
   */
  _ensureDb() {
    if (!this.db) {
      throw new PalaceError('Database not initialized. Call init() first.', {
        code: 'DB_NOT_INITIALIZED',
        correlationId: this.correlationId
      });
    }
  }

  /**
   * Estimate token count from text
   * Rough approximation: 1 token ≈ 4 characters for English
   * @private
   */
  _estimateTokens(text) {
    if (!text) return 0;
    // Simple approximation: ~4 chars per token for typical English
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate wake-up context for session initialization
   * Loads L0 (agent passport) + L1 (critical facts)
   * Target: under 900 tokens total
   *
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: Object }
   */
  async generateWakeUpContext() {
    return safeExecute(async () => {
      this.logger.info('Generating wake-up context');

      // Initialize if not already done
      if (!this.db) {
        const initResult = await this.init();
        if (!initResult.success) {
          throw new PalaceError('Failed to initialize database for wake-up context', {
            code: 'WAKEUP_INIT_FAILED',
            cause: initResult.error,
            correlationId: this.correlationId
          });
        }
      }

      // Load L0: Agent passport
      const passportResult = await this._loadPassport();
      const passport = passportResult.success ? passportResult.data : { agent: { id: 'unknown', name: 'unknown' } };

      // Compact passport for context (remove examples, etc.)
      const compactPassport = {
        version: passport.version,
        agent: passport.agent,
        capabilities: passport.capabilities,
        hardware_profile: {
          host: passport.hardware_profile?.host,
          gpu: passport.hardware_profile?.gpu,
          local_inference: passport.hardware_profile?.local_inference
        },
        mesh_identity: {
          receiver_url: passport.mesh_identity?.receiver_url
        }
      };

      // Load L1: Critical facts
      const factsResult = this.getCriticalFacts();
      const criticalFacts = factsResult.success ? factsResult.data : [];

      // Check for expired facts (graceful: don't fail if this errors)
      let expiredFactIds = [];
      try {
        const expiredResult = this.getExpiredFacts();
        if (expiredResult.success) {
          expiredFactIds = expiredResult.data.map(f => f.id);
        }
      } catch (err) {
        this.logger.warn('Could not check for expired facts', { error: err.message });
      }

      if (expiredFactIds.length > 0) {
        this.logger.info(`Found ${expiredFactIds.length} expired facts`, { ids: expiredFactIds });
      }

      // Compact facts for context
      const compactFacts = criticalFacts.map(fact => ({
        id: fact.id,
        tier: fact.tier,
        category: fact.category,
        title: fact.content.title,
        body: this._truncateBody(fact.content.body, 200), // Limit body length
        tags: fact.content.tags?.slice(0, 5) || [] // Limit tags
      }));

      // Calculate token estimate
      const l0Tokens = this._estimateTokens(JSON.stringify(compactPassport));
      const l1Tokens = this._estimateTokens(JSON.stringify(compactFacts));
      const totalTokens = l0Tokens + l1Tokens;

      // Build compact result
      const result = {
        l0: compactPassport,
        l1: compactFacts.slice(0, 15), // Hard limit to stay under 900 tokens
        l1Count: criticalFacts.length,
        l1Truncated: criticalFacts.length > 15,
        tokenEstimate: totalTokens,
        expiredFactIds: expiredFactIds,
        generatedAt: new Date().toISOString(),
        correlationId: this.correlationId
      };

      // Final estimate with result structure overhead
      result.tokenEstimate = this._estimateTokens(JSON.stringify(result));

      this.logger.info('Wake-up context generated', { 
        l1Count: result.l1Count, 
        tokenEstimate: result.tokenEstimate,
        expiredCount: expiredFactIds.length
      });

      return result;
    }, { operation: 'generateWakeUpContext' });
  }

  /**
   * Truncate body text to limit
   * @private
   */
  _truncateBody(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}

/**
 * Factory function to create and initialize a loader
 * @param {Object} options - Same as constructor options
 * @returns {Promise<CriticalFactsLoader>} - Initialized loader instance
 */
export async function createLoader(options = {}) {
  const loader = new CriticalFactsLoader(options);
  const result = await loader.init();
  if (!result.success) {
    throw new PalaceError('Failed to create loader', {
      code: 'LOADER_CREATE_FAILED',
      cause: result.error
    });
  }
  return loader;
}

/**
 * Quick-load function for session startup
 * Creates loader, initializes, and returns wake-up context
 *
 * @param {Object} options - Configuration options
 * @param {string} options.dbPath - Path to SQLite database
 * @param {string} options.passportPath - Path to agent-passport.json
 * @returns {Promise<Object>} Wake-up context or error object
 */
export async function quickLoad(options = {}) {
  let loader;
  try {
    loader = await createLoader(options);
    const result = await loader.generateWakeUpContext();
    return result.success ? result.data : result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof PalaceError ? err.toResponse().error : {
        code: 'QUICKLOAD_FAILED',
        message: err.message,
        correlationId: generateCorrelationId()
      }
    };
  } finally {
    if (loader) {
      loader.close();
    }
  }
}

// Default export
export default { CriticalFactsLoader, createLoader, quickLoad };
