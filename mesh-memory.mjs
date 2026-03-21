#!/usr/bin/env node
/**
 * @module mesh-memory
 * @description Thin dispatcher for mesh-memory services.
 * Usage: node mesh-memory.mjs <receiver|bridge|watcher|threads|start>
 */

const command = process.argv[2];

const commands = {
  receiver: "./memory-receiver.mjs",
  bridge:   "./memory-bridge.mjs",
  watcher:  "./memory-watcher.mjs",
  threads:  "./thread-manager.mjs",
};

if (!command || command === "start") {
  // Start all services via concurrently (same as npm start)
  const { execSync } = await import("node:child_process");
  execSync("npx concurrently \"node memory-watcher.mjs\" \"node memory-receiver.mjs\" \"node memory-bridge.mjs\" \"node thread-manager.mjs\"", {
    stdio: "inherit",
    cwd: new URL(".", import.meta.url).pathname,
  });
} else if (commands[command]) {
  await import(commands[command]);
} else {
  console.error(`[mesh-memory] Unknown command: ${command}`);
  console.error("Usage: node mesh-memory.mjs <receiver|bridge|watcher|threads|start>");
  process.exit(1);
}
