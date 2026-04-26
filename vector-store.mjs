/**
 * Vector Store Module
 * Manages embeddings storage and vector similarity search using SQLite
 * Integrates with GX-10 Nomic endpoint for embedding generation
 * 
 * @version 1.0.0
 * @module vector-store
 */

import Database from 'better-sqlite3';
import { PalaceError, ValidationError, DatabaseError, safeExecute, safeExecuteSync } from './palace-errors.mjs';
import { createLogger, generateCorrelationId } from './palace-logger.mjs';

// GX-10 Nomic endpoint configuration
const NOMIC_ENDPOINT = 'http://<LAN_IP_GX10>:8082/embedding';
const VECTOR_DIMENSION = 768; // Nomic embed text dimension

/**
 * VectorStore class
 * Manages vector embeddings for semantic similarity search
 */
export class VectorStore {
  /**
   * Create a new VectorStore instance
   * @param {Object} options - Configuration options
   * @param {string} options.dbPath - Path to SQLite database
   * @param {string} options.nomicEndpoint - Custom Nomic endpoint URL
   * @param {boolean} options.verbose - Enable verbose logging
   * @param {string} options.correlationId - Correlation ID for tracing
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || './memory/vectors.db';
    this.nomicEndpoint = options.nomicEndpoint || NOMIC_ENDPOINT;
    this.verbose = options.verbose || false;
    this.db = null;
    this.correlationId = options.correlationId || generateCorrelationId();
    this.logger = createLogger({ minLevel: options.verbose ? 0 : 1 }, this.correlationId)
      .child({ module: 'vector-store' });
    this.vectorDimension = options.vectorDimension || VECTOR_DIMENSION;
  }

  /**
   * Initialize the database and create tables
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  async init() {
    return safeExecute(async () => {
      this.logger.info('Initializing VectorStore', { dbPath: this.dbPath });

      // Open database
      try {
        this.db = new Database(this.dbPath);
      } catch (err) {
        throw DatabaseError.connection(this.dbPath, err, { correlationId: this.correlationId });
      }

      // Enable WAL mode
      try {
        this.db.pragma('journal_mode = WAL');
      } catch (err) {
        this.logger.warn('Could not enable WAL mode', { error: err.message });
      }

      // Create tables
      const tableResult = safeExecuteSync(() => {
        this._createTables();
        return true;
      }, { operation: 'createVectorTables' });

      if (!tableResult.success) {
        throw DatabaseError.query('CREATE TABLE vectors', tableResult.error, { correlationId: this.correlationId });
      }

      this.logger.info('VectorStore initialized successfully');
      return { initialized: true, dbPath: this.dbPath, dimension: this.vectorDimension };
    }, { operation: 'VectorStore.init' });
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
        this.logger.info('VectorStore database connection closed');
      }
      return { closed: true };
    }, { operation: 'VectorStore.close' });
  }

  /**
   * Create vector embeddings table
   * @private
   */
  _createTables() {
    // Main vectors table
    const createVectorsSQL = `
      CREATE TABLE IF NOT EXISTS fact_embeddings (
        fact_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL, -- Stored as JSON array string for portability
        text_hash TEXT NOT NULL, -- Hash of source text for cache invalidation
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (fact_id) REFERENCES critical_facts(id) ON DELETE CASCADE
      )
    `;

    // Metadata table for tracking
    const createMetaSQL = `
      CREATE TABLE IF NOT EXISTS vector_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;

    this.db.exec(createVectorsSQL);
    this.db.exec(createMetaSQL);

    // Store version info
    this._setMetadata('version', '1.0.0');
    this._setMetadata('dimension', String(this.vectorDimension));

    this.logger.debug('Vector tables created');
  }

  /**
   * Set metadata value
   * @private
   */
  _setMetadata(key, value) {
    const sql = `
      INSERT OR REPLACE INTO vector_metadata (key, value, updated_at)
      VALUES (@key, @value, @now)
    `;
    const stmt = this.db.prepare(sql);
    stmt.run({ key, value, now: new Date().toISOString() });
  }

  /**
   * Get metadata value
   * @private
   */
  _getMetadata(key) {
    const sql = 'SELECT value FROM vector_metadata WHERE key = @key';
    const stmt = this.db.prepare(sql);
    const row = stmt.get({ key });
    return row?.value;
  }

  /**
   * Generate embedding via Nomic endpoint
   * @param {string} text - Text to embed
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  async generateEmbedding(text) {
    return safeExecute(async () => {
      if (!text || typeof text !== 'string') {
        throw ValidationError.invalid('text', text, 'non-empty string');
      }

      this.logger.debug('Generating embedding', { textLength: text.length });

      const response = await fetch(this.nomicEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text })
      });

      if (!response.ok) {
        throw new PalaceError(`Embedding generation failed: ${response.status}`, {
          code: 'EMBEDDING_FAILED',
          context: { status: response.status, endpoint: this.nomicEndpoint },
          correlationId: this.correlationId
        });
      }

      const result = await response.json();
      
      if (!result.embedding || !Array.isArray(result.embedding)) {
        throw new PalaceError('Invalid embedding response format', {
          code: 'EMBEDDING_INVALID',
          context: { hasEmbedding: !!result.embedding },
          correlationId: this.correlationId
        });
      }

      this.logger.debug('Embedding generated', { dimension: result.embedding.length });
      return result.embedding;
    }, { operation: 'generateEmbedding', textLength: text?.length });
  }

  /**
   * Store embedding for a fact
   * @param {string} factId - Fact ID
   * @param {string} text - Source text (for hash calculation)
   * @param {Array} embedding - Vector embedding array
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  storeEmbedding(factId, text, embedding) {
    return safeExecuteSync(() => {
      this._ensureDb();

      if (!factId || typeof factId !== 'string') {
        throw ValidationError.invalid('factId', factId, 'non-empty string');
      }
      if (!embedding || !Array.isArray(embedding)) {
        throw ValidationError.invalid('embedding', embedding, 'Array');
      }

      const textHash = this._hashText(text);
      const now = new Date().toISOString();

      const sql = `
        INSERT OR REPLACE INTO fact_embeddings 
        (fact_id, embedding, text_hash, created_at, updated_at)
        VALUES (@factId, @embedding, @textHash, @createdAt, @updatedAt)
      `;

      const stmt = this.db.prepare(sql);
      const result = stmt.run({
        factId,
        embedding: JSON.stringify(embedding),
        textHash,
        createdAt: now,
        updatedAt: now
      });

      this.logger.debug('Embedding stored', { factId, textHash });
      return { stored: true, factId, textHash };
    }, { operation: 'storeEmbedding', factId });
  }

  /**
   * Get embedding by fact ID
   * @param {string} factId - Fact ID
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  getEmbedding(factId) {
    return safeExecuteSync(() => {
      this._ensureDb();

      if (!factId || typeof factId !== 'string') {
        throw ValidationError.invalid('factId', factId, 'non-empty string');
      }

      const sql = 'SELECT * FROM fact_embeddings WHERE fact_id = @factId';
      const stmt = this.db.prepare(sql);
      const row = stmt.get({ factId });

      if (!row) {
        return null;
      }

      return {
        factId: row.fact_id,
        embedding: JSON.parse(row.embedding),
        textHash: row.text_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }, { operation: 'getEmbedding', factId });
  }

  /**
   * Get embeddings for multiple facts (batch)
   * @param {Array<string>} factIds - Array of fact IDs
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  getEmbeddingsBatch(factIds) {
    return safeExecuteSync(() => {
      this._ensureDb();

      if (!Array.isArray(factIds) || factIds.length === 0) {
        throw ValidationError.invalid('factIds', factIds, 'non-empty Array');
      }

      const placeholders = factIds.map(() => '?').join(',');
      const sql = `SELECT * FROM fact_embeddings WHERE fact_id IN (${placeholders})`;
      
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...factIds);

      return rows.map(row => ({
        factId: row.fact_id,
        embedding: JSON.parse(row.embedding),
        textHash: row.text_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    }, { operation: 'getEmbeddingsBatch', count: factIds?.length });
  }

  /**
   * Get all stored embeddings
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  getAllEmbeddings() {
    return safeExecuteSync(() => {
      this._ensureDb();

      const sql = 'SELECT * FROM fact_embeddings';
      const stmt = this.db.prepare(sql);
      const rows = stmt.all();

      return rows.map(row => ({
        factId: row.fact_id,
        embedding: JSON.parse(row.embedding),
        textHash: row.text_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    }, { operation: 'getAllEmbeddings' });
  }

  /**
   * Delete embedding by fact ID
   * @param {string} factId - Fact ID
   * @returns {Object} { success: boolean, data?: boolean, error?: Object }
   */
  deleteEmbedding(factId) {
    return safeExecuteSync(() => {
      this._ensureDb();

      const sql = 'DELETE FROM fact_embeddings WHERE fact_id = @factId';
      const stmt = this.db.prepare(sql);
      const result = stmt.run({ factId });

      this.logger.debug('Embedding deleted', { factId, deleted: result.changes > 0 });
      return result.changes > 0;
    }, { operation: 'deleteEmbedding', factId });
  }

  /**
   * Search for similar vectors using cosine similarity
   * @param {Array} queryVector - Query embedding vector
   * @param {number} topK - Number of results (default: 10)
   * @param {number} minScore - Minimum similarity score (default: 0.5)
   * @returns {Object} { success: boolean, data?: Array, error?: Object }
   */
  searchSimilar(queryVector, topK = 10, minScore = 0.5) {
    return safeExecuteSync(() => {
      this._ensureDb();

      if (!queryVector || !Array.isArray(queryVector)) {
        throw ValidationError.invalid('queryVector', queryVector, 'Array');
      }

      // Get all embeddings and compute similarity
      // Note: For production, use a proper vector DB like pgvector or FAISS
      const sql = 'SELECT fact_id, embedding FROM fact_embeddings';
      const stmt = this.db.prepare(sql);
      const rows = stmt.all();

      const results = rows
        .map(row => {
          const embedding = JSON.parse(row.embedding);
          const score = this._cosineSimilarity(queryVector, embedding);
          return {
            factId: row.fact_id,
            score,
            embedding
          };
        })
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      this.logger.debug('Vector search completed', { 
        candidates: rows.length, 
        results: results.length 
      });

      return results;
    }, { operation: 'searchSimilar', topK });
  }

  /**
   * Compute cosine similarity between two vectors
   * @private
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Check if embedding needs regeneration (text changed)
   * @param {string} factId - Fact ID
   * @param {string} currentText - Current text content
   * @returns {Object} { success: boolean, data?: boolean, error?: Object }
   */
  needsUpdate(factId, currentText) {
    return safeExecuteSync(() => {
      this._ensureDb();

      const currentHash = this._hashText(currentText);
      const stored = this.getEmbedding(factId);

      if (!stored.success || !stored.data) {
        return true; // No existing embedding
      }

      return stored.data.textHash !== currentHash;
    }, { operation: 'needsUpdate', factId });
  }

  /**
   * Get store statistics
   * @returns {Object} { success: boolean, data?: Object, error?: Object }
   */
  getStats() {
    return safeExecuteSync(() => {
      this._ensureDb();

      const countSql = 'SELECT COUNT(*) as count FROM fact_embeddings';
      const countStmt = this.db.prepare(countSql);
      const { count } = countStmt.get();

      const oldestSql = 'SELECT MIN(created_at) as oldest FROM fact_embeddings';
      const oldestStmt = this.db.prepare(oldestSql);
      const { oldest } = oldestStmt.get();

      const newestSql = 'SELECT MAX(updated_at) as newest FROM fact_embeddings';
      const newestStmt = this.db.prepare(newestSql);
      const { newest } = newestStmt.get();

      return {
        count,
        dimension: this.vectorDimension,
        oldestEmbedding: oldest,
        newestEmbedding: newest
      };
    }, { operation: 'getStats' });
  }

  /**
   * Simple hash function for text
   * @private
   */
  _hashText(text) {
    if (!text) return '';
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
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
}

/**
 * Factory function to create and initialize a VectorStore
 * @param {Object} options - Same as constructor options
 * @returns {Promise<VectorStore>} - Initialized VectorStore instance
 */
export async function createVectorStore(options = {}) {
  const store = new VectorStore(options);
  const result = await store.init();
  if (!result.success) {
    throw new PalaceError('Failed to create VectorStore', {
      code: 'VECTORSTORE_CREATE_FAILED',
      cause: result.error
    });
  }
  return store;
}

export default { VectorStore, createVectorStore, VECTOR_DIMENSION, NOMIC_ENDPOINT };
