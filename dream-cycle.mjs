/**
 * @module dream-cycle
 * @description Nightly memory consolidation. Reads recent mesh and LCM markdown,
 * generates MEMORY.md update suggestions via local prompt generation.
 * Designed to run via cron at 2-3 AM.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";

const MEMORY_BASE = resolve(homedir(), ".openclaw/workspace/memory");
const LCM_DIR = MEMORY_BASE; // YYYY-MM-DD.md daily logs

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

async function fetchMeshFacts() {
  try {
    const res = await fetch("http://127.0.0.1:18805/mesh/shared-pool");
    if (!res.ok) throw new Error(`mesh API ${res.status}`);
    const { facts } = await res.json();
    if (!facts?.length) return [];
    return facts.map(f=>`### Mesh [${f.id}] ${f.agent_id}\n\n${f.content}`);
  } catch(e){
    console.warn("[dream] mesh: "+e.message);return [];
  }
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
 * Generates a consolidation prompt from recent mesh and LCM entries.
 * @param {string[]} meshContents - Recent mesh markdown contents
 * @param {string[]} lcmContents - Recent LCM markdown contents
 * @returns {string} Consolidation prompt for manual review
 */
function generateConsolidationPrompt(meshContents, lcmContents) {
  const sections = [];
  
  if (meshContents.length > 0) {
    sections.push(`## Mesh Entries (${meshContents.length} files)\n\n${meshContents.join("\n\n---\n\n")}`);
  }
  
  if (lcmContents.length > 0) {
    sections.push(`## LCM Summaries (${lcmContents.length} files)\n\n${lcmContents.join("\n\n---\n\n")}`);
  }
  
  if (sections.length === 0) {
    return "# Dream Cycle — No Entries\n\nNo recent mesh or LCM entries found for consolidation.";
  }
  
  return `# Dream Cycle — Manual Review Required\n\n${sections.join("\n\n")}\n\n---\n\n## Instructions\n\nReview the entries above and update MEMORY.md with any high-priority information that should be preserved long-term.`;
}

/**
 * Runs the dream cycle consolidation.
 */
async function main() {
  const config = loadConfig();
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[dream] Agent: ${config.agentId}`);
  console.log(`[dream] Running dream cycle for ${today}`);

  const meshContents = await fetchMeshFacts();
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

  const suggestions = generateConsolidationPrompt(meshContents, lcmContents);

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
