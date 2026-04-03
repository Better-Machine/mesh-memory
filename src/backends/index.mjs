/**
 * @module backends
 * @description Factory for creating memory backend instances.
 *
 * Reads the backend type from config and returns the appropriate adapter.
 * Supported backends: 'local' (default), 'mem0'.
 */

import { createLocalAdapter } from "./local-adapter.mjs";

/**
 * Creates a memory backend instance based on configuration.
 *
 * @param {Object} config - The memory configuration block
 * @param {string} [config.backend='local'] - Backend type: 'local' | 'mem0'
 * @param {Object} [config.mem0={}] - Mem0-specific config (apiKey, userId, selfHostUrl)
 * @param {Object} [config.local={}] - Local adapter config (storageDir)
 * @returns {Promise<Object>} MemoryBackend implementation
 * @throws {Error} If the backend type is unknown
 */
export async function createMemoryBackend(config = {}) {
  const backend = config.backend || "local";

  switch (backend) {
    case "local":
      return createLocalAdapter(config.local || {});

    case "mem0": {
      // Dynamic import so mem0-adapter.mjs (and mem0ai) are only loaded when needed
      const { createMem0Adapter } = await import("./mem0-adapter.mjs");
      return createMem0Adapter(config.mem0 || {});
    }

    default:
      throw new Error(
        `Unknown memory backend: "${backend}". Supported: local, mem0`
      );
  }
}
