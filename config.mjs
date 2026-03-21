/**
 * @module config
 * @description Loads mesh-memory configuration from mesh-memory.config.json.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "mesh-memory.config.json");

/** @type {Object|null} Cached config */
let _config = null;

/**
 * Loads and returns the mesh-memory config.
 * @returns {Object} Parsed config object
 */
export function loadConfig() {
  if (_config) return _config;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    _config = JSON.parse(raw);
    return _config;
  } catch (err) {
    console.error(`[config] Failed to load ${CONFIG_PATH}:`, err.message);
    process.exit(1);
  }
}
