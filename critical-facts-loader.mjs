/**
 * Critical Facts Loader
 * Loads L1 (critical) facts and L2 (deep) facts from SQLite
 * Generates wake-up context for session initialization
 *
 * @version 1.0.0
 * @module critical-facts-loader
 */

import Database from 'better-sqlite3';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

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
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || './memory/critical-facts.db';
    this.passportPath = options.passportPath || './palace-mvp/agent-passport.json';
    this.verbose = options.verbose || false;
    this.db = null;
  }

  /**
   * Initialize the database connection and create tables
   * @returns {Promise<void>}
   */
  async init() {
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      await fs.mkdir(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this._createTables();

    // Create FTS5 index for deep facts
    this._createFTSIndex();

    if (this.verbose) {
      console.log(`[critical-facts-loader] Initialized database at ${this.dbPath}`);
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
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
      // FTS5 might not be available, log but continue
      if (this.verbose) {
        console.log(`[critical-facts-loader] FTS5 not available: ${err.message}`);
      }
    }
  }

  /**
   * Insert a new fact into the database
   * @param {Object} fact - Fact object matching critical-facts.schema.json
   * @returns {Object} - Inserted fact with id
   */
  insertFact(fact) {
    this._ensureDb();

    // Validate required fields
    const requiredFields = ['id', 'tier', 'category', 'content', 'provenance', 'updated_at'];
    for (const field of requiredFields) {
      if (!fact[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate tier
    if (!['critical', 'deep'].includes(fact.tier)) {
      throw new Error(`Invalid tier: ${fact.tier}. Must be 'critical' or 'deep'`);
    }

    // Validate category
    const validCategories = ['standing_instructions', 'projects', 'people', 'infrastructure', 'blockers', 'events'];
    if (!validCategories.includes(fact.category)) {
      throw new Error(`Invalid category: ${fact.category}`);
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

    const stmt = this.db.prepare(sql);
    const result = stmt.run(params);

    if (this.verbose) {
      console.log(`[critical-facts-loader] Inserted fact: ${fact.id} (${fact.tier})`);
    }

    return { ...fact, _rowid: result.lastInsertRowid };
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
   * @returns {Array<Object>} - Array of critical facts
   */
  getCriticalFacts() {
    this._ensureDb();

    const now = new Date().toISOString();
    const sql = `
      SELECT * FROM critical_facts
      WHERE tier = 'critical'
        AND (expires_at IS NULL OR expires_at > @now)
      ORDER BY updated_at DESC
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ now });

    return rows.map(row => this._rowToFact(row));
  }

  /**
   * Search deep (L2) facts using full-text search
   * @param {string} query - Search query
   * @param {number} limit - Maximum results
   * @returns {Array<Object>} - Array of matching deep facts
   */
  searchDeepFacts(query, limit = 20) {
    this._ensureDb();

    const now = new Date().toISOString();

    // Check if FTS table exists
    const ftsExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'critical_facts_fts'"
    ).get();

    let rows;
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
      // Fallback to LIKE search
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

    return rows.map(row => this._rowToFact(row));
  }

  /**
   * Get all deep (L2) facts (for bulk operations)
   * @param {Object} options - Query options
   * @param {string} options.category - Filter by category
   * @param {number} options.limit - Maximum results
   * @returns {Array<Object>} - Array of deep facts
   */
  getDeepFacts(options = {}) {
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
      sql += ' LIMIT @limit';
      params.limit = options.limit;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params);

    return rows.map(row => this._rowToFact(row));
  }

  /**
   * Get expired facts for cleanup
   * @returns {Array<Object>} - Array of expired facts
   */
  getExpiredFacts() {
    this._ensureDb();

    const now = new Date().toISOString();
    const sql = `
      SELECT * FROM critical_facts
      WHERE expires_at IS NOT NULL AND expires_at < @now
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all({ now });

    return rows.map(row => this._rowToFact(row));
  }

  /**
   * Delete expired facts
   * @returns {number} - Number of deleted facts
   */
  deleteExpiredFacts() {
    this._ensureDb();

    const now = new Date().toISOString();
    const sql = `
      DELETE FROM critical_facts
      WHERE expires_at IS NOT NULL AND expires_at < @now
    `;

    const stmt = this.db.prepare(sql);
    const result = stmt.run({ now });

    if (this.verbose && result.changes > 0) {
      console.log(`[critical-facts-loader] Deleted ${result.changes} expired facts`);
    }

    return result.changes;
  }

  /**
   * Get a fact by ID
   * @param {string} id - Fact ID
   * @returns {Object|null} - Fact object or null
   */
  getFactById(id) {
    this._ensureDb();

    const sql = 'SELECT * FROM critical_facts WHERE id = @id';
    const stmt = this.db.prepare(sql);
    const row = stmt.get({ id });

    return row ? this._rowToFact(row) : null;
  }

  /**
   * Delete a fact by ID
   * @param {string} id - Fact ID
   * @returns {boolean} - True if deleted
   */
  deleteFact(id) {
    this._ensureDb();

    const sql = 'DELETE FROM critical_facts WHERE id = @id';
    const stmt = this.db.prepare(sql);
    const result = stmt.run({ id });

    return result.changes > 0;
  }

  /**
   * Load agent passport (L0 context)
   * @returns {Promise<Object>} - Passport object
   * @private
   */
  async _loadPassport() {
    try {
      const content = await fs.readFile(this.passportPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      if (this.verbose) {
        console.log(`[critical-facts-loader] Could not load passport: ${err.message}`);
      }
      return {
        agent: { id: 'unknown', name: 'unknown' },
        error: 'passport not found'
      };
    }
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
        tags: JSON.parse(row.tags || '[]')
      },
      provenance: {
        source: row.source,
        author: row.author,
        timestamp: row.timestamp,
        source_version: row.source_version
      },
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      relations: JSON.parse(row.relations || '[]')
    };

    // Merge extra content fields
    if (row.content_extra && row.content_extra !== '{}') {
      try {
        const extra = JSON.parse(row.content_extra);
        Object.assign(fact.content, extra);
      } catch {
        // Ignore parse errors
      }
    }

    return fact;
  }

  /**
   * Ensure database is initialized
   * @private
   */
  _ensureDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
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
   * @returns {Promise<Object>} - Wake-up context object
   * @property {Object} l0 - Agent passport (L0 context)
   * @property {Array<Object>} l1 - Critical facts (L1 context)
   * @property {number} tokenEstimate - Estimated token count
   * @property {number} l1Count - Number of L1 facts loaded
   * @property {Array<string>} expiredFactIds - IDs of expired facts found
   */
  async generateWakeUpContext() {
    // Initialize if not already done
    if (!this.db) {
      await this.init();
    }

    // Load L0: Agent passport
    const passport = await this._loadPassport();

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
    const criticalFacts = this.getCriticalFacts();

    // Check for expired facts
    const expiredFacts = this.getExpiredFacts();
    const expiredFactIds = expiredFacts.map(f => f.id);

    if (expiredFacts.length > 0 && this.verbose) {
      console.log(`[critical-facts-loader] Found ${expiredFacts.length} expired facts:`, expiredFactIds);
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
      generatedAt: new Date().toISOString()
    };

    // Final estimate with result structure overhead
    result.tokenEstimate = this._estimateTokens(JSON.stringify(result));

    return result;
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
  await loader.init();
  return loader;
}

/**
 * Quick-load function for session startup
 * Creates loader, initializes, and returns wake-up context
 *
 * @param {Object} options - Configuration options
 * @param {string} options.dbPath - Path to SQLite database
 * @param {string} options.passportPath - Path to agent-passport.json
 * @returns {Promise<Object>} - Wake-up context
 */
export async function quickLoad(options = {}) {
  const loader = await createLoader(options);
  const context = await loader.generateWakeUpContext();
  loader.close();
  return context;
}

// Default export
export default { CriticalFactsLoader, createLoader, quickLoad };
