/**
 * @module mem0-adapter
 * @description Memory backend adapter for Mem0 (mem0ai npm package).
 *
 * Supports both Mem0 Cloud (apiKey) and self-hosted OSS (selfHostUrl).
 * Uses dynamic import so mem0ai is only required at runtime — users must
 * install it themselves: npm install mem0ai
 */

import { validateBackend } from "./memory-backend.interface.mjs";

/** @type {Object|null} Lazily loaded Mem0 client */
let _client = null;

/**
 * Creates a Mem0 memory backend adapter.
 *
 * @param {Object} config
 * @param {string} [config.apiKey] - Mem0 Cloud API key
 * @param {string} [config.userId] - Mem0 Cloud user ID
 * @param {string} [config.selfHostUrl] - Self-hosted Mem0 base URL (e.g. http://localhost:8080)
 * @returns {Object} MemoryBackend implementation
 */
export function createMem0Adapter(config = {}) {
  const { apiKey, userId, selfHostUrl } = config;

  async function getClient() {
    if (_client) return _client;
    let MemoryClient;
    try {
      const mod = await import("mem0ai");
      MemoryClient = mod.default || mod.MemoryClient || mod;
    } catch (err) {
      throw new Error(
        "mem0ai package not found. Install it with: npm install mem0ai\n" +
          err.message
      );
    }

    const opts = {};
    if (selfHostUrl) {
      opts.host = selfHostUrl;
    } else if (apiKey) {
      opts.apiKey = apiKey;
    }

    _client = new MemoryClient(opts);
    return _client;
  }

  const adapter = {
    /** @type {string} */
    name: "mem0",

    async add(agentId, messages, metadata = {}) {
      const client = await getClient();
      const formatted = messages.map((m) => ({ role: "user", content: m }));
      const result = await client.add(formatted, {
        user_id: userId || agentId,
        agent_id: agentId,
        metadata,
      });
      return { results: Array.isArray(result) ? result : result?.results || [result] };
    },

    async search(agentId, query, options = {}) {
      const client = await getClient();
      const result = await client.search(query, {
        user_id: userId || agentId,
        agent_id: agentId,
        limit: options.limit || 10,
      });
      return { results: Array.isArray(result) ? result : result?.results || [] };
    },

    async getAll(agentId, options = {}) {
      const client = await getClient();
      const result = await client.getAll({
        user_id: userId || agentId,
        agent_id: agentId,
        ...(options.limit && { limit: options.limit }),
        ...(options.offset && { offset: options.offset }),
      });
      return Array.isArray(result) ? result : result?.results || [];
    },

    async delete(agentId, memoryId) {
      const client = await getClient();
      await client.delete(memoryId);
    },

    async deleteAll(agentId) {
      const client = await getClient();
      await client.deleteAll({
        user_id: userId || agentId,
        agent_id: agentId,
      });
    },

    async update(agentId, memoryId, data) {
      const client = await getClient();
      const result = await client.update(memoryId, data.memory || data);
      return result;
    },
  };

  validateBackend(adapter);
  return adapter;
}
