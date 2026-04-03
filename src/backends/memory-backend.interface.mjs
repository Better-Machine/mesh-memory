/**
 * @module memory-backend.interface
 * @description Provider-agnostic memory backend interface for mesh-memory.
 *
 * All memory backends must implement this contract. The interface abstracts
 * storage and retrieval so mesh-memory can swap between providers (Mem0, local
 * JSON, future backends) without changing coordination logic.
 *
 * Implementations should throw on unrecoverable errors and return null/empty
 * arrays for "not found" cases.
 */

/**
 * @typedef {Object} MemoryEntry
 * @property {string} id - Unique identifier for the memory
 * @property {string} memory - The memory content text
 * @property {Object} [metadata] - Arbitrary metadata attached to the memory
 * @property {string} [created_at] - ISO 8601 creation timestamp
 * @property {string} [updated_at] - ISO 8601 last-update timestamp
 */

/**
 * @typedef {Object} SearchResult
 * @property {MemoryEntry[]} results - Matching memories ordered by relevance
 */

/**
 * @typedef {Object} AddResult
 * @property {MemoryEntry[]} results - The memories that were created
 */

/**
 * @typedef {Object} SearchOptions
 * @property {number} [limit=10] - Max results to return
 */

/**
 * @typedef {Object} GetAllOptions
 * @property {number} [limit=100] - Max results to return
 * @property {number} [offset=0] - Pagination offset
 */

/**
 * @interface MemoryBackend
 * @description Contract that all memory backend adapters must implement.
 */

/**
 * Validates that an object implements the MemoryBackend interface.
 * Throws if any required method is missing or not a function.
 *
 * @param {Object} backend - The backend instance to validate
 * @throws {Error} If the backend does not implement all required methods
 */
export function validateBackend(backend) {
  const required = ["add", "search", "getAll", "delete", "deleteAll", "update"];
  for (const method of required) {
    if (typeof backend[method] !== "function") {
      throw new Error(
        `MemoryBackend: missing required method "${method}". ` +
          `All backends must implement: ${required.join(", ")}`
      );
    }
  }
}

/**
 * @method add
 * @description Store one or more memories for an agent.
 * @param {string} agentId - The agent storing memories
 * @param {string[]} messages - Array of message strings to store
 * @param {Object} [metadata={}] - Arbitrary metadata to attach
 * @returns {Promise<AddResult>} The created memory entries
 */

/**
 * @method search
 * @description Semantic search over an agent's memories.
 * @param {string} agentId - The agent whose memories to search
 * @param {string} query - The search query string
 * @param {SearchOptions} [options={}] - Search options
 * @returns {Promise<SearchResult>} Matching memories ordered by relevance
 */

/**
 * @method getAll
 * @description Retrieve all memories for an agent (paginated).
 * @param {string} agentId - The agent whose memories to retrieve
 * @param {GetAllOptions} [options={}] - Pagination options
 * @returns {Promise<MemoryEntry[]>} Array of memory entries
 */

/**
 * @method delete
 * @description Delete a specific memory by ID.
 * @param {string} agentId - The owning agent
 * @param {string} memoryId - The memory ID to delete
 * @returns {Promise<void>}
 */

/**
 * @method deleteAll
 * @description Delete all memories for an agent.
 * @param {string} agentId - The agent whose memories to wipe
 * @returns {Promise<void>}
 */

/**
 * @method update
 * @description Update an existing memory entry.
 * @param {string} agentId - The owning agent
 * @param {string} memoryId - The memory ID to update
 * @param {Object} data - Fields to update (e.g. { memory: "new text" })
 * @returns {Promise<MemoryEntry>} The updated memory entry
 */
