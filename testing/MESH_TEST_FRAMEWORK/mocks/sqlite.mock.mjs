/**
 * @module mocks/sqlite
 * @description Mock better-sqlite3 for isolated database testing
 * Provides in-memory SQLite operations
 */

/**
 * Creates a mock SQLite database for testing
 * @returns {Object} Mock database instance
 */
export function createMockSQLite() {
  const tables = new Map();
  let transactionFn = null;
  
  function parseSQL(sql) {
    // Simple SQL parser for common operations
    const createMatch = sql.match(/CREATE TABLE (\w+)\s*\((.+?)\)/is);
    const insertMatch = sql.match(/INSERT INTO (\w+)\s*\((.+?)\)\s*VALUES\s*\((.+?)\)/is);
    const selectMatch = sql.match(/SELECT (.+?) FROM (\w+)(?: WHERE (.+))?/is);
    const updateMatch = sql.match(/UPDATE (\w+) SET (.+?)(?: WHERE (.+))?/is);
    const deleteMatch = sql.match(/DELETE FROM (\w+)(?: WHERE (.+))?/is);
    
    return { createMatch, insertMatch, selectMatch, updateMatch, deleteMatch };
  }
  
  return {
    /**
     * Execute SQL (for CREATE TABLE, etc.)
     */
    exec: (sql) => {
      const parsed = parseSQL(sql);
      
      if (parsed.createMatch) {
        const tableName = parsed.createMatch[1];
        if (!tables.has(tableName)) {
          tables.set(tableName, {
            rows: [],
            columns: [],
            lastId: 0,
          });
        }
      }
    },
    
    /**
     * Prepare a statement
     */
    prepare: (sql) => {
      const parsed = parseSQL(sql);
      const tableName = parsed.insertMatch?.[1] || 
                       parsed.selectMatch?.[2] || 
                       parsed.updateMatch?.[1] || 
                       parsed.deleteMatch?.[1];
      
      if (!tableName || !tables.has(tableName)) {
        // Return a no-op statement for non-existent tables
        return {
          run: () => ({ lastInsertRowid: 0, changes: 0 }),
          get: () => undefined,
          all: () => [],
        };
      }
      
      const table = tables.get(tableName);
      
      return {
        /**
         * Execute a mutation
         */
        run: (params) => {
          // Handle INSERT
          if (parsed.insertMatch) {
            table.lastId++;
            const columns = parsed.insertMatch[2].split(',').map(c => c.trim());
            const row = { id: table.lastId };
            
            // Map positional params or named params
            if (Array.isArray(params)) {
              columns.forEach((col, i) => {
                row[col] = params[i];
              });
            } else {
              Object.assign(row, params);
            }
            
            table.rows.push(row);
            return { lastInsertRowid: table.lastId, changes: 1 };
          }
          
          // Handle UPDATE
          if (parsed.updateMatch) {
            const whereClause = parsed.updateMatch[3];
            let changes = 0;
            
            for (const row of table.rows) {
              if (!whereClause || matchesWhere(row, whereClause, params)) {
                Object.assign(row, params);
                changes++;
              }
            }
            return { changes };
          }
          
          // Handle DELETE
          if (parsed.deleteMatch) {
            const whereClause = parsed.deleteMatch[2];
            const originalLength = table.rows.length;
            
            table.rows = table.rows.filter(row => {
              if (!whereClause) return false;
              return !matchesWhere(row, whereClause, params);
            });
            
            return { changes: originalLength - table.rows.length };
          }
          
          return { lastInsertRowid: 0, changes: 0 };
        },
        
        /**
         * Get single row
         */
        get: (params) => {
          const whereClause = parsed.selectMatch?.[3];
          
          for (const row of table.rows) {
            if (!whereClause || matchesWhere(row, whereClause, params)) {
              return filterColumns(row, parsed.selectMatch[1]);
            }
          }
          return undefined;
        },
        
        /**
         * Get all matching rows
         */
        all: (params) => {
          const whereClause = parsed.selectMatch?.[3];
          const results = [];
          
          for (const row of table.rows) {
            if (!whereClause || matchesWhere(row, whereClause, params)) {
              results.push(filterColumns(row, parsed.selectMatch[1]));
            }
          }
          
          return results;
        },
        
        /**
         * Iterate over results
         */
        iterate: function*(params) {
          const rows = this.all(params);
          for (const row of rows) {
            yield row;
          }
        },
      };
    },
    
    /**
     * Run a transaction
     */
    transaction: (fn) => {
      transactionFn = fn;
      return (...args) => {
        return fn(...args);
      };
    },
    
    /**
     * Close the database
     */
    close: () => {
      // No-op for mock
    },
    
    // Test utilities
    __getTable: (name) => tables.get(name),
    __getAllTables: () => new Map(tables),
    __reset: () => tables.clear(),
  };
}

/**
 * Check if a row matches WHERE clause
 */
function matchesWhere(row, whereClause, params) {
  // Simple WHERE clause matching
  // Supports: col = ?, col = :name, col LIKE ?, id IN (...)
  
  if (whereClause.includes('=')) {
    const match = whereClause.match(/(\w+)\s*=\s*\?/);
    if (match) {
      const col = match[1];
      const val = Array.isArray(params) ? params[0] : Object.values(params)[0];
      return row[col] === val;
    }
    
    const namedMatch = whereClause.match(/(\w+)\s*=\s*:(\w+)/);
    if (namedMatch) {
      const col = namedMatch[1];
      const paramName = namedMatch[2];
      return row[col] === params[paramName];
    }
  }
  
  if (whereClause.includes('LIKE')) {
    const match = whereClause.match(/(\w+)\s+LIKE\s+\?/i);
    if (match) {
      const col = match[1];
      const pattern = Array.isArray(params) ? params[0] : Object.values(params)[0];
      const regex = pattern.replace(/%/g, '.*').replace(/_/g, '.');
      return new RegExp(regex, 'i').test(String(row[col]));
    }
  }
  
  return true;
}

/**
 * Filter columns based on SELECT clause
 */
function filterColumns(row, selectClause) {
  if (selectClause === '*') return { ...row };
  
  const cols = selectClause.split(',').map(c => c.trim().split(/\s+as\s+/i)[0]);
  const filtered = {};
  
  for (const col of cols) {
    if (row.hasOwnProperty(col)) {
      filtered[col] = row[col];
    }
  }
  
  return filtered;
}

/**
 * Create a mock better-sqlite3 module
 */
export function createMockSQLiteModule() {
  const databases = new Map();
  
  return {
    /**
     * Mock Database constructor
     */
    default: class MockDatabase {
      constructor(path, options = {}) {
        this.path = path;
        this.options = options;
        this.mockDb = createMockSQLite();
        
        // Copy methods from mockDb
        Object.assign(this, this.mockDb);
        
        databases.set(path, this);
      }
    },
    
    /**
     * Create a new mock database instance
     */
    createMock: (path) => {
      return new (createMockSQLiteModule().default)(path);
    },
    
    // Test utilities
    __getDatabase: (path) => databases.get(path),
    __getAllDatabases: () => new Map(databases),
    __reset: () => databases.clear(),
  };
}

export default createMockSQLite;
