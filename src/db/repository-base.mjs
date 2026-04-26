/**
 * @module repository-base
 * @description Shared SQLite repository abstraction
 * 
 * Provides a base class for all SQLite-based repositories:
 * - Automatic schema initialization
 * - Transaction support with automatic rollback
 * - Query helper with parameter binding
 * - Connection lifecycle management
 * 
 * Eliminates ~500 lines of duplicated SQLite init code across modules.
 * 
 * @version 1.0.0
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { dirname } from 'path';

/**
 * SQLite Repository Base Class
 * 
 * @example
 * const schema = {
 *   tables: {
 *     items: `id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL`
 *   },
 *   indexes: {
 *     idx_items_name: `items(name)`
 *   }
 * };
 * 
 * const repo = new SQLiteRepository('/path/to/db.db', schema);
 * await repo.init();
 * 
 * const result = await repo.transaction(async (db) => {
 *   await repo.query('INSERT INTO items VALUES (?, ?, ?)', [id, name, now]);
 *   return { inserted: true };
 * });
 */
export class SQLiteRepository {
  /**
   * @param {string} dbPath - Path to SQLite database file
   * @param {Object} schema - Schema definition { tables: {}, indexes: {} }
   * @param {Object} options - Repository options
   * @param {boolean} options.verbose - Enable verbose logging (default: false)
   */
  constructor(dbPath, schema = {}, options = {}) {
    this.dbPath = dbPath;
    this.schema = schema;
    this.options = { verbose: false, ...options };
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the repository
   * - Creates parent directories
   * - Opens database
   * - Applies schema
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;

    // Ensure parent directory exists
    const dbDir = dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    // Open database
    this.db = new sqlite3.Database(this.dbPath);
    
    // Promisify methods
    this.db.run = promisify(this.db.run.bind(this.db));
    this.db.get = promisify(this.db.get.bind(this.db));
    this.db.all = promisify(this.db.all.bind(this.db));
    this.db.exec = promisify(this.db.exec.bind(this.db));

    // Apply schema
    await this.applySchema();

    this.initialized = true;
    
    if (this.options.verbose) {
      console.log(`[SQLiteRepository] Initialized at ${this.dbPath}`);
    }
  }

  /**
   * Apply schema to database
   * @private
   */
  async applySchema() {
    const { tables = {}, indexes = {} } = this.schema;

    // Create tables
    for (const [tableName, definition] of Object.entries(tables)) {
      await this.db.run(
        `CREATE TABLE IF NOT EXISTS ${tableName} (${definition})`
      );
    }

    // Create indexes
    for (const [indexName, definition] of Object.entries(indexes)) {
      await this.db.run(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${definition}`
      );
    }
  }

  /**
   * Execute a query with parameters
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result (for INSERT/UPDATE/DELETE)
   */
  async query(sql, params = []) {
    this.ensureInitialized();
    return this.db.run(sql, params);
  }

  /**
   * Execute a SELECT query and return a single row
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object|null>} Single row or null
   */
  async queryOne(sql, params = []) {
    this.ensureInitialized();
    return this.db.get(sql, params);
  }

  /**
   * Execute a SELECT query and return all rows
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} All matching rows
   */
  async queryMany(sql, params = []) {
    this.ensureInitialized();
    return this.db.all(sql, params);
  }

  /**
   * Execute a transaction with automatic rollback on error
   * @param {Function} callback - Async function receiving db connection
   * @returns {Promise<*>} Result from callback
   */
  async transaction(callback) {
    this.ensureInitialized();
    
    await this.db.run('BEGIN TRANSACTION');
    
    try {
      const result = await callback(this.db);
      await this.db.run('COMMIT');
      return result;
    } catch (err) {
      await this.db.run('ROLLBACK');
      throw err;
    }
  }

  /**
   * Get the number of rows changed by last operation
   * @returns {Promise<number>}
   */
  async changes() {
    this.ensureInitialized();
    const result = await this.db.get('SELECT changes() as count');
    return result ? result.count : 0;
  }

  /**
   * Get the last inserted row ID
   * @returns {Promise<number>}
   */
  async lastID() {
    this.ensureInitialized();
    const result = await this.db.get('SELECT last_insert_rowid() as id');
    return result ? result.id : null;
  }

  /**
   * Close the database connection
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.db) return;
    
    await new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    this.db = null;
    this.initialized = false;
  }

  /**
   * Check if repository is initialized
   * @private
   */
  ensureInitialized() {
    if (!this.initialized || !this.db) {
      throw new Error('Repository not initialized. Call init() first.');
    }
  }

  /**
   * Check database health
   * @returns {Promise<Object>} Health status
   */
  async health() {
    this.ensureInitialized();
    
    try {
      const result = await this.db.get('SELECT 1 as ok');
      return {
        healthy: result && result.ok === 1,
        path: this.dbPath,
        initialized: this.initialized
      };
    } catch (err) {
      return {
        healthy: false,
        path: this.dbPath,
        error: err.message
      };
    }
  }
}

export default SQLiteRepository;
