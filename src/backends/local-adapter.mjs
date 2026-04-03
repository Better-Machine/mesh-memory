/**
 * @module local-adapter
 * @description Local JSON file memory backend — no external dependencies.
 *
 * Stores memories as a JSON file per agent under a configurable directory.
 * Suitable for development, offline use, and as a fallback when no cloud
 * provider is configured. Search is basic substring/keyword matching (no
 * semantic search — use Mem0 for that).
 *
 * Storage format per agent: <storageDir>/<agentId>.memories.json
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { validateBackend } from "./memory-backend.interface.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_DIR = resolve(__dirname, "../../memory/local");

/**
 * Creates a local JSON file memory backend adapter.
 *
 * @param {Object} [config={}]
 * @param {string} [config.storageDir] - Directory to store memory JSON files
 * @returns {Object} MemoryBackend implementation
 */
export function createLocalAdapter(config = {}) {
  const storageDir = config.storageDir || DEFAULT_STORAGE_DIR;

  function filePath(agentId) {
    return resolve(storageDir, `${agentId}.memories.json`);
  }

  async function loadMemories(agentId) {
    const fp = filePath(agentId);
    if (!existsSync(fp)) return [];
    try {
      const raw = await readFile(fp, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async function saveMemories(agentId, memories) {
    await mkdir(storageDir, { recursive: true });
    await writeFile(filePath(agentId), JSON.stringify(memories, null, 2));
  }

  const adapter = {
    /** @type {string} */
    name: "local",

    async add(agentId, messages, metadata = {}) {
      const memories = await loadMemories(agentId);
      const now = new Date().toISOString();
      const created = messages.map((msg) => {
        const entry = {
          id: randomUUID(),
          memory: msg,
          metadata: { ...metadata },
          created_at: now,
          updated_at: now,
        };
        memories.push(entry);
        return entry;
      });
      await saveMemories(agentId, memories);
      return { results: created };
    },

    async search(agentId, query, options = {}) {
      const memories = await loadMemories(agentId);
      const limit = options.limit || 10;
      const queryLower = query.toLowerCase();
      const terms = queryLower.split(/\s+/).filter(Boolean);

      // Score by number of query terms found in the memory text
      const scored = memories
        .map((entry) => {
          const text = entry.memory.toLowerCase();
          const score = terms.reduce(
            (acc, term) => acc + (text.includes(term) ? 1 : 0),
            0
          );
          return { entry, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return { results: scored.map((s) => s.entry) };
    },

    async getAll(agentId, options = {}) {
      const memories = await loadMemories(agentId);
      const offset = options.offset || 0;
      const limit = options.limit || 100;
      return memories.slice(offset, offset + limit);
    },

    async delete(agentId, memoryId) {
      const memories = await loadMemories(agentId);
      const idx = memories.findIndex((m) => m.id === memoryId);
      if (idx === -1) {
        throw new Error(`Memory not found: ${memoryId}`);
      }
      memories.splice(idx, 1);
      await saveMemories(agentId, memories);
    },

    async deleteAll(agentId) {
      const fp = filePath(agentId);
      if (existsSync(fp)) {
        await rm(fp);
      }
    },

    async update(agentId, memoryId, data) {
      const memories = await loadMemories(agentId);
      const entry = memories.find((m) => m.id === memoryId);
      if (!entry) {
        throw new Error(`Memory not found: ${memoryId}`);
      }
      if (data.memory !== undefined) entry.memory = data.memory;
      if (data.metadata !== undefined) {
        entry.metadata = { ...entry.metadata, ...data.metadata };
      }
      entry.updated_at = new Date().toISOString();
      await saveMemories(agentId, memories);
      return entry;
    },
  };

  validateBackend(adapter);
  return adapter;
}
