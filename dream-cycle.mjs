/**
 * @module dream-cycle
 * @description Nightly memory consolidation. Reads recent mesh and LCM markdown,
 * generates MEMORY.md update suggestions via OpenClaw agent API.
 * Designed to run via cron at 2-3 AM.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";

const MEMORY_BASE = resolve(homedir(), ".openclaw/workspace/memory");
const MESH_DIR = resolve(MEMORY_BASE, "mesh");
const LCM_DIR = resolve(MEMORY_BASE, "lcm");

/**
 * Reads all markdown files from a directory modified in the last 24 hours.
 * @param {string} dir - Directory path
 * @returns {Promise<string[]>} Array of file contents
 */
async function readRecentFiles(dir) {
  const contents = [];
  try {
    const files = await readdir(dir);
    // Build a set of recent date strings (today + yesterday in local time)
    // Comparing by date string avoids UTC-midnight off-by-one errors when
    // the machine's local time is ahead of UTC (e.g., EDT at 23:xx = UTC 03:xx+1).
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA"); // YYYY-MM-DD local
    const yd = new Date(now); yd.setDate(yd.getDate() - 1);
    const yesterdayStr = yd.toLocaleDateString("en-CA");
    const recentDates = new Set([todayStr, yesterdayStr]);

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      // Extract date from filename (YYYY-MM-DD.md)
      const dateStr = file.replace(".md", "");
      if (!recentDates.has(dateStr)) continue;

      const content = await readFile(resolve(dir, file), "utf-8");
      if (content.trim()) {
        contents.push(`### Source: ${dir}/${file}\n\n${content}`);
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return contents;
}

/**
 * Builds the consolidation prompt from recent memory files.
 * @param {string[]} meshContents - Recent mesh memory entries
 * @param {string[]} lcmContents - Recent LCM summary entries
 * @returns {string} Structured prompt for the agent
 */
function buildPrompt(meshContents, lcmContents) {
  return `You are performing a nightly memory consolidation ("dream cycle") for an OpenClaw agent mesh.

Below are all memory entries from the last 24 hours — both real-time mesh events (cross-agent messages) and LCM summaries (local conversation memory).

Your task:
1. Identify the most important themes, decisions, and context from these entries
2. Suggest specific additions or updates to MEMORY.md
3. Flag any contradictions or stale information you notice
4. Prioritize actionable context that will help agents in future conversations

Format your output as a series of suggested MEMORY.md entries, each with:
- A clear heading
- The suggested content
- Why this should be remembered (brief justification)

---

## Mesh Events (cross-agent messages)

${meshContents.length > 0 ? meshContents.join("\n\n---\n\n") : "(No mesh events in the last 24 hours)"}

---

## LCM Summaries (local conversation memory)

${lcmContents.length > 0 ? lcmContents.join("\n\n---\n\n") : "(No LCM summaries in the last 24 hours)"}
`;
}

/**
 * Calls the OpenClaw agent API to generate consolidation suggestions.
 * Uses `openclaw agent --local --agent main --json` which runs the agent
 * in-process and returns the full text response.
 * @param {string} prompt - The consolidation prompt
 * @param {Object} config - Config object
 * @returns {Promise<string>} Agent response text
 */
async function callAgent(prompt, config) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  try {
    const { stdout, stderr } = await exec("openclaw", [
      "agent",
      "--local",
      "--agent", "main",
      "--message", prompt,
      "--json",
    ], { timeout: 300000, maxBuffer: 1024 * 1024 * 10 });

    // openclaw agent --local --json emits the JSON result to stderr
    // (plugin log lines also go there, so we find the first { in stderr)
    const raw = stderr || stdout;
    const jsonStart = raw.indexOf("{");
    if (jsonStart === -1) throw new Error("No JSON in agent response");
    const result = JSON.parse(raw.slice(jsonStart));
    const text = result?.payloads?.[0]?.text;
    if (!text) throw new Error("No text payload in agent response");
    return text;
  } catch (err) {
    // Fallback: write the prompt as output so the dream cycle still produces a file
    console.warn(`[dream] Agent API error (${err.message}), falling back to raw prompt`);
    return `# Dream Cycle — API Unavailable\n\nThe consolidation prompt was generated but the agent API could not be reached.\nManual review of the raw entries below is recommended.\n\n${prompt}`;
  }
}

/**
 * Runs the dream cycle consolidation.
 */
async function main() {
  const config = loadConfig();
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[dream] Agent: ${config.agentId}`);
  console.log(`[dream] Running dream cycle for ${today}`);

  const meshContents = await readRecentFiles(MESH_DIR);
  const lcmContents = await readRecentFiles(LCM_DIR);

  const totalEntries = meshContents.length + lcmContents.length;
  console.log(
    `[dream] Found ${meshContents.length} mesh files, ${lcmContents.length} LCM files`
  );

  if (totalEntries === 0) {
    console.log("[dream] No recent entries — skipping consolidation");
    return;
  }

  const prompt = buildPrompt(meshContents, lcmContents);
  console.log(`[dream] Prompt length: ${prompt.length} chars`);

  const suggestions = await callAgent(prompt, config);

  const outputPath = resolve(MEMORY_BASE, `dream-cycle-${today}.md`);
  await mkdir(MEMORY_BASE, { recursive: true });
  await writeFile(
    outputPath,
    `# Dream Cycle — ${today}\n\n_Generated by mesh-memory dream-cycle for agent: ${config.agentId}_\n\n${suggestions}\n`,
    "utf-8"
  );

  console.log(`[dream] Suggestions written to ${outputPath}`);
  console.log("[dream] Done. Review and approve before merging into MEMORY.md.");
}

main();
