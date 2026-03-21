/**
 * @module config
 * @description Loads mesh-memory configuration from mesh-memory.config.json.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "mesh-memory.config.json");
const LOCAL_CONFIG_PATH = resolve(__dirname, "mesh-memory.config.local.json");

/** @type {Object|null} Cached config */
let _config = null;

/**
 * Loads and returns the mesh-memory config.
 * Merges mesh-memory.config.local.json (if present) over the base config.
 * Local config is gitignored and should contain real tokens and per-agent settings.
 * @returns {Object} Parsed config object
 */
export function loadConfig() {
  if (_config) return _config;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const base = JSON.parse(raw);
    let local = {};
    try {
      local = JSON.parse(readFileSync(LOCAL_CONFIG_PATH, "utf-8"));
    } catch (_) {
      // No local override — that's fine
    }
    _config = { ...base, ...local };
    return _config;
  } catch (err) {
    console.error(`[config] Failed to load ${CONFIG_PATH}:`, err.message);
    process.exit(1);
  }
}

/**
 * Resets the cached config so the next loadConfig() re-reads from disk.
 * Used by tests that swap config files.
 */
export function resetConfig() {
  _config = null;
}
