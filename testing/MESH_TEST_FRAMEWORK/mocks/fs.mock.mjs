/**
 * @module mocks/fs
 * @description Mock file system for isolated testing
 * Provides in-memory file operations without touching real disk
 */

import { EventEmitter } from 'node:events';

/**
 * Creates a mock file system for testing
 * @returns {Object} Mock fs module
 */
export function createMockFs() {
  const files = new Map();
  const directories = new Set();
  const watchers = new Map();
  
  // Initialize root
  directories.add('/');
  
  function normalizePath(p) {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/');
  }
  
  function parentDir(p) {
    const normalized = normalizePath(p);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return normalized.slice(0, lastSlash) || '/';
  }
  
  function baseName(p) {
    const normalized = normalizePath(p);
    const lastSlash = normalized.lastIndexOf('/');
    return normalized.slice(lastSlash + 1);
  }
  
  function* walkDir(dir) {
    const normalizedDir = normalizePath(dir);
    for (const [path] of files) {
      if (path.startsWith(normalizedDir + '/') || path === normalizedDir) {
        yield path;
      }
    }
  }
  
  function triggerWatchers(path, event) {
    const normalized = normalizePath(path);
    for (const [watchPath, emitter] of watchers) {
      if (normalized.startsWith(watchPath) || watchPath === normalized) {
        emitter.emit(event, normalized);
      }
    }
  }
  
  return {
    // Sync methods
    existsSync: (path) => {
      const normalized = normalizePath(path);
      return files.has(normalized) || directories.has(normalized);
    },
    
    readFileSync: (path, encoding) => {
      const normalized = normalizePath(path);
      if (!files.has(normalized)) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      const content = files.get(normalized);
      return encoding === 'utf-8' || encoding === 'utf8' 
        ? content 
        : Buffer.from(content);
    },
    
    writeFileSync: (path, data) => {
      const normalized = normalizePath(path);
      const parent = parentDir(normalized);
      if (!directories.has(parent)) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      const content = Buffer.isBuffer(data) ? data.toString('utf-8') : data;
      files.set(normalized, content);
      triggerWatchers(normalized, 'change');
    },
    
    mkdirSync: (path, options) => {
      const normalized = normalizePath(path);
      if (options?.recursive) {
        let current = '/';
        const parts = normalized.split('/').filter(Boolean);
        for (const part of parts) {
          current = current === '/' ? `/${part}` : `${current}/${part}`;
          directories.add(current);
        }
      } else {
        const parent = parentDir(normalized);
        if (!directories.has(parent)) {
          const err = new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
          err.code = 'ENOENT';
          throw err;
        }
        directories.add(normalized);
      }
    },
    
    rmSync: (path, options) => {
      const normalized = normalizePath(path);
      if (options?.recursive) {
        for (const filePath of Array.from(files.keys())) {
          if (filePath.startsWith(normalized)) {
            files.delete(filePath);
          }
        }
        for (const dirPath of Array.from(directories)) {
          if (dirPath.startsWith(normalized) && dirPath !== normalized) {
            directories.delete(dirPath);
          }
        }
      }
      files.delete(normalized);
      directories.delete(normalized);
      triggerWatchers(normalized, 'unlink');
    },
    
    readdirSync: (path) => {
      const normalized = normalizePath(path);
      if (!directories.has(normalized)) {
        const err = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      const entries = new Set();
      const prefix = normalized === '/' ? '' : normalized;
      
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix + '/') || filePath === prefix) {
          const relative = filePath.slice(prefix.length + 1);
          const firstPart = relative.split('/')[0];
          if (firstPart) entries.add(firstPart);
        }
      }
      
      for (const dirPath of directories) {
        if (dirPath.startsWith(prefix + '/') && dirPath !== prefix) {
          const relative = dirPath.slice(prefix.length + 1);
          const firstPart = relative.split('/')[0];
          if (firstPart) entries.add(firstPart);
        }
      }
      
      return Array.from(entries);
    },
    
    statSync: (path) => {
      const normalized = normalizePath(path);
      const isFile = files.has(normalized);
      const isDir = directories.has(normalized);
      
      if (!isFile && !isDir) {
        const err = new Error(`ENOENT: no such file or directory, stat '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      
      return {
        isFile: () => isFile,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
        size: isFile ? files.get(normalized).length : 0,
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      };
    },
    
    // Async methods
    readFile: async (path, encoding) => {
      return Promise.resolve().then(() => {
        return createMockFs().readFileSync(path, encoding);
      });
    },
    
    writeFile: async (path, data) => {
      return Promise.resolve().then(() => {
        createMockFs().writeFileSync(path, data);
      });
    },
    
    mkdir: async (path, options) => {
      return Promise.resolve().then(() => {
        createMockFs().mkdirSync(path, options);
      });
    },
    
    rm: async (path, options) => {
      return Promise.resolve().then(() => {
        createMockFs().rmSync(path, options);
      });
    },
    
    readdir: async (path) => {
      return Promise.resolve().then(() => {
        return createMockFs().readdirSync(path);
      });
    },
    
    access: async (path, mode) => {
      return Promise.resolve().then(() => {
        const normalized = normalizePath(path);
        if (!files.has(normalized) && !directories.has(normalized)) {
          const err = new Error(`ENOENT: no such file or directory, access '${path}'`);
          err.code = 'ENOENT';
          throw err;
        }
      });
    },
    
    // Watch support
    watch: (path, options) => {
      const normalized = normalizePath(path);
      const emitter = new EventEmitter();
      watchers.set(normalized, emitter);
      
      return {
        on: (event, handler) => emitter.on(event, handler),
        close: () => watchers.delete(normalized),
      };
    },
    
    // Test utilities
    __getFiles: () => new Map(files),
    __getDirs: () => new Set(directories),
    __reset: () => {
      files.clear();
      directories.clear();
      directories.add('/');
      watchers.clear();
    },
    
    // Create a mock fs module that can be used with module mocking
    createMockModule: () => ({
      existsSync: (...args) => createMockFs().existsSync(...args),
      readFileSync: (...args) => createMockFs().readFileSync(...args),
      writeFileSync: (...args) => createMockFs().writeFileSync(...args),
      mkdirSync: (...args) => createMockFs().mkdirSync(...args),
      rmSync: (...args) => createMockFs().rmSync(...args),
      readdirSync: (...args) => createMockFs().readdirSync(...args),
      statSync: (...args) => createMockFs().statSync(...args),
      promises: {
        readFile: (...args) => createMockFs().readFile(...args),
        writeFile: (...args) => createMockFs().writeFile(...args),
        mkdir: (...args) => createMockFs().mkdir(...args),
        rm: (...args) => createMockFs().rm(...args),
        readdir: (...args) => createMockFs().readdir(...args),
        access: (...args) => createMockFs().access(...args),
      },
      __reset: () => createMockFs().__reset(),
    }),
  };
}

export default createMockFs;
