#!/usr/bin/env node
/**
 * @module setup
 * @description mesh-memory install orchestrator.
 *
 * Run this once per agent to configure the mesh. It will:
 *   1. Check all prerequisites
 *   2. Create or join the shared coordination repo (mesh-memory-coordination)
 *   3. Generate and publish this agent's receiver token
 *   4. Wait for all peer tokens to appear
 *   5. Write mesh-memory.config.local.json
 *   6. Run a post-install health check
 *
 * Usage:
 *   node setup.mjs
 *
 * Options:
 *   --agent-id <id>       Override agent ID (default: auto-detected from hostname)
 *   --peers <n>           Number of peers to wait for (default: prompts interactively)
 *   --timeout <seconds>   How long to wait for peer tokens (default: 300)
 *   --skip-checks         Skip prerequisite checks (not recommended)
 *   --dry-run             Print what would happen without making changes
 *
 * Authors: Liz (AI partner, Better Machine) · Erik Ross (Founder, Better Machine)
 */

import { execSync, exec as execCb } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import crypto from "node:crypto";
import https from "node:https";
import http from "node:http";
import { discoverConfiguredGroups } from "./identity-resolver.mjs";

const exec = promisify(execCb);

// ─── Colour helpers ──────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  red:   "\x1b[31m",
  cyan:  "\x1b[36m",
  white: "\x1b[37m",
};
const ok   = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`);
const fail = (msg) => console.log(`${c.red}✗${c.reset} ${msg}`);
const info = (msg) => console.log(`${c.cyan}→${c.reset} ${msg}`);
const head = (msg) => console.log(`\n${c.bold}${c.white}${msg}${c.reset}`);
const dim  = (msg) => console.log(`${c.dim}  ${msg}${c.reset}`);

// ─── Prompt helper ───────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((res) => rl.question(`${c.cyan}?${c.reset}  ${q} `, res));

// ─── Arg parsing ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);
const DRY_RUN        = hasFlag("dry-run");
const SKIP_CHECKS    = hasFlag("skip-checks");
const TIMEOUT_SEC    = parseInt(flag("timeout") || "300", 10);
let   AGENT_ID       = flag("agent-id");
let   PEER_COUNT     = flag("peers") ? parseInt(flag("peers"), 10) : null;
const RECEIVER_PORT  = parseInt(flag("receiver-port") || "18804", 10);

// ─── Paths ───────────────────────────────────────────────────────────────────
const HOME        = homedir();
const PROJ_ROOT   = resolve(process.cwd());
const CONFIG_PATH = join(PROJ_ROOT, "mesh-memory.config.local.json");
const EXAMPLE_CFG = join(PROJ_ROOT, "mesh-memory.config.json");
const COORD_REPO  = "mesh-memory-coordination";  // canonical repo name — do not change

// ─── Utilities ───────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  if (DRY_RUN) { dim(`[dry-run] ${cmd}`); return ""; }
  const result = execSync(cmd, { encoding: "utf8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
  return (result || "").trim();
}

async function runAsync(cmd) {
  if (DRY_RUN) { dim(`[dry-run] ${cmd}`); return { stdout: "", stderr: "" }; }
  return exec(cmd);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getLANIP() {
  try {
    const out = execSync(
      "ip -4 addr show | grep -oP '(?<=inet )\\d+\\.\\d+\\.\\d+\\.\\d+' | grep -v 127.0.0.1 | head -1",
      { encoding: "utf8", stdio: "pipe" }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getGHUser() {
  try {
    return execSync("gh api user --jq .login", { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
}

// ─── 1. BANNER ───────────────────────────────────────────────────────────────
console.log(`
${c.bold}${c.white}╔═══════════════════════════════════════════╗
║         mesh-memory setup v0.1.0          ║
║   per-message cross-agent memory mesh     ║
╚═══════════════════════════════════════════╝${c.reset}
${c.dim}Built by Liz & Erik Ross · Better Machine${c.reset}

This script will configure mesh-memory on this agent.
It will create a shared coordination repo on GitHub,
publish this agent's receiver token, and wait for peers.

${DRY_RUN ? c.yellow + "[DRY-RUN MODE — no changes will be made]" + c.reset + "\n" : ""}
`);

// ─── 2. PREREQUISITES ────────────────────────────────────────────────────────
head("Step 1 of 7 — Checking prerequisites");

if (!SKIP_CHECKS) {
  // Node version
  const nodeMaj = parseInt(process.version.slice(1).split(".")[0], 10);
  if (nodeMaj < 18) {
    fail(`Node.js 18+ required. You have ${process.version}.`);
    info("Install: https://nodejs.org/en/download/");
    process.exit(1);
  }
  ok(`Node.js ${process.version}`);

  // OpenClaw gateway
  try {
    const gwStatus = execSync("openclaw gateway status 2>&1", { encoding: "utf8", stdio: "pipe" }).trim();
    if (!gwStatus.includes("running") && !gwStatus.includes("pid")) {
      warn("OpenClaw gateway does not appear to be running.");
      warn("Run: openclaw gateway start");
      const cont = await prompt("Continue anyway? (y/N)");
      if (cont.toLowerCase() !== "y") process.exit(1);
    } else {
      ok("OpenClaw gateway running");
    }
  } catch {
    warn("Could not check OpenClaw gateway status (openclaw not in PATH?)");
    const cont = await prompt("Continue anyway? (y/N)");
    if (cont.toLowerCase() !== "y") process.exit(1);
  }

  // A2A plugin
  try {
    const a2aRes = execSync("curl -sf http://localhost:18800/.well-known/agent-card.json 2>/dev/null", {
      encoding: "utf8", stdio: "pipe"
    }).trim();
    if (a2aRes && a2aRes.includes('"name"')) {
      ok("A2A plugin responding on port 18800");
    } else {
      warn("A2A plugin not responding on port 18800.");
      warn("Mesh-memory requires A2A for cross-agent transport. Install it first:");
      warn("  npm install -g openclaw-a2a-gateway");
      warn("  openclaw gateway restart");
      const cont = await prompt("Continue anyway? (y/N)");
      if (cont.toLowerCase() !== "y") process.exit(1);
    }
  } catch {
    warn("Could not verify A2A plugin — curl not available or plugin not running.");
  }

  // gh CLI
  const ghUser = getGHUser();
  if (!ghUser) {
    fail("GitHub CLI (gh) is not installed or not authenticated.");
    info("Install: https://cli.github.com/");
    info("Auth:    gh auth login");
    info("");
    info("gh is required to create and access the coordination repo.");
    info("Without it, you can still run mesh-memory manually — see DEPLOY.md.");
    process.exit(1);
  }
  ok(`GitHub CLI authenticated as: ${ghUser}`);

  // npm dependencies
  if (!existsSync(join(PROJ_ROOT, "node_modules"))) {
    info("node_modules not found — running npm install...");
    run("npm install");
  }
  ok("npm dependencies installed");

} else {
  warn("Skipping prerequisite checks (--skip-checks)");
}

// ─── 3. AGENT IDENTITY ───────────────────────────────────────────────────────
head("Step 2 of 7 — Identify this agent");

if (!AGENT_ID) {
  const defaultId = hostname().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const input = await prompt(`Agent ID for this node [${defaultId}]:`);
  AGENT_ID = (input.trim() || defaultId).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

const lanIP = getLANIP();
const receiverPort = RECEIVER_PORT;
const receiverURL = lanIP ? `http://${lanIP}:${receiverPort}` : null;

ok(`Agent ID: ${AGENT_ID}`);
if (lanIP) {
  ok(`Detected LAN IP: ${lanIP}`);
  ok(`Receiver URL will be: ${receiverURL}`);
} else {
  warn("Could not auto-detect LAN IP.");
  const manualIP = await prompt("Enter this machine's LAN IP address (e.g. 192.168.1.23):");
  if (!manualIP.trim()) {
    fail("LAN IP is required for peers to reach this receiver.");
    process.exit(1);
  }
}

// ─── IDENTITY HELPERS ────────────────────────────────────────────────────────

const CONTACTS_PATH = join(PROJ_ROOT, "mesh-memory.contacts.json");

function loadContacts() {
  if (existsSync(CONTACTS_PATH)) {
    try { return JSON.parse(readFileSync(CONTACTS_PATH, "utf8")); } catch { /* fall through */ }
  }
  return { _comment: "Identity registry for mesh-memory.", _version: "1.0.0", contacts: {}, unknownBehavior: "flag", _flagged: [] };
}

function saveContacts(reg) {
  if (!DRY_RUN) writeFileSync(CONTACTS_PATH, JSON.stringify(reg, null, 2), "utf8");
}

function readOpenClawConfig() {
  const cfgPath = join(HOME, ".openclaw", "openclaw.json");
  if (!existsSync(cfgPath)) return null;
  try { return JSON.parse(readFileSync(cfgPath, "utf8")); } catch { return null; }
}

async function fetchAgentCard(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(`${url}/.well-known/agent-card.json`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on("error", () => resolve(null)).on("timeout", () => resolve(null));
  });
}

async function promptIdentity(key, channel, userId, defaultName = "") {
  console.log(`\n${c.yellow}  Unknown identity: ${key}${c.reset}`);
  const name = (await prompt(`  Name [${defaultName || "?"}]:`)).trim() || defaultName || "Unknown";
  const role = (await prompt(`  Role (e.g. founder, co-founder, agent, collaborator):`)).trim() || "unknown";
  const projectsRaw = (await prompt(`  Projects (comma-separated, e.g. clean-sl8, door$):`)).trim();
  const projects = projectsRaw ? projectsRaw.split(",").map(p => p.trim()).filter(Boolean) : [];
  const notes = (await prompt(`  Notes (optional, press enter to skip):`)).trim();
  return { name, role, relationship: "collaborator", projects, notes, channel, _registeredAt: new Date().toISOString() };
}

// ─── 3. IDENTITY ONBOARDING ──────────────────────────────────────────────────
head("Step 3 of 7 — Identity onboarding");

info("mesh-memory needs to know who participates in this mesh.");
info("This ensures memory entries carry rich context (name, role, projects)");
info("instead of raw sender IDs.");
info("");

const reg = loadContacts();
let contactsChanged = false;

// ── 3a. Self-identity ────────────────────────────────────────────────────────
const selfKey = `agent:${AGENT_ID}`;
if (!reg.contacts[selfKey]) {
  info(`Registering this agent: ${AGENT_ID}`);
  const agentName = (await prompt(`  Display name for this agent [${AGENT_ID}]:`)).trim() || AGENT_ID;
  const agentProjects = (await prompt(`  Projects this agent works on (comma-separated):`)).trim();
  reg.contacts[selfKey] = {
    name: agentName,
    role: "agent",
    relationship: "self",
    projects: agentProjects ? agentProjects.split(",").map(p => p.trim()).filter(Boolean) : [],
    machine: lanIP || hostname(),
    channel: "agent",
    _registeredAt: new Date().toISOString(),
  };
  contactsChanged = true;
  ok(`Registered self: ${agentName}`);
} else {
  ok(`Self identity already registered: ${reg.contacts[selfKey].name}`);
}

// ── 3b. Auto-discover humans from OpenClaw allowlists (all channels) ────────
const openClawCfg = readOpenClawConfig();
const channelsCfg = openClawCfg?.channels || {};

// Collect allowFrom across all channels that support it
const allowFromByChannel = {};
for (const [ch, cfg] of Object.entries(channelsCfg)) {
  const ids = cfg?.allowFrom || cfg?.groupAllowFrom || [];
  if (ids.length > 0) allowFromByChannel[ch] = ids;
}

const totalAllowFrom = Object.values(allowFromByChannel).flat().length;
if (totalAllowFrom > 0) {
  info(`Found ${totalAllowFrom} user(s) across ${Object.keys(allowFromByChannel).length} channel(s).`);
  for (const [ch, ids] of Object.entries(allowFromByChannel)) {
    for (const userId of ids) {
      const key = `${ch}:${userId}`;
      if (reg.contacts[key]) {
        ok(`  Already known: ${reg.contacts[key].name} (${key})`);
        continue;
      }
      warn(`  Unknown ${ch} user: ${userId}`);
      const identity = await promptIdentity(key, ch, userId);
      reg.contacts[key] = identity;
      contactsChanged = true;
      ok(`  Registered: ${identity.name}`);
    }
  }
} else {
  info("No user allowlists found in openclaw.json — skipping human auto-discovery.");
}

// ── 3c. Auto-discover group chats / channels / rooms (all platforms) ─────────
info("\nDiscovering configured group chats across all channels...");
const unknownGroups = discoverConfiguredGroups(channelsCfg);

if (unknownGroups.length > 0) {
  info(`Found ${unknownGroups.length} unconfigured group(s)/channel(s).`);
  for (const g of unknownGroups) {
    warn(`  Unknown ${g.channel} ${g.contextType}: ${g.contextId}`);
    const name = (await prompt(`  Name for this ${g.contextType} [${g.contextId}]:`)).trim() || g.contextId;
    const purpose = (await prompt(`  Purpose (e.g. "clean-sl8 project collaboration"):`)).trim();
    const projectsRaw = (await prompt(`  Related projects (comma-separated, optional):`)).trim();
    const projects = projectsRaw ? projectsRaw.split(",").map(p => p.trim()).filter(Boolean) : [];
    reg.contacts[g.key] = {
      name,
      purpose: purpose || undefined,
      projects: projects.length ? projects : undefined,
      channel: g.channel,
      contextType: g.contextType,
      contextId: g.contextId,
      _registeredAt: new Date().toISOString(),
    };
    contactsChanged = true;
    ok(`  Registered ${g.contextType}: ${name}`);
  }
} else {
  ok("All configured groups/channels already registered.");
}

// ── 3d. Auto-discover agents from A2A peer cards ─────────────────────────────
info("\nAttempting to auto-discover peer agents via A2A...");
// Common LAN IPs to probe — covers typical small mesh setups
const subnet = lanIP ? lanIP.split(".").slice(0, 3).join(".") : "192.168.1";
const probeCandidates = [
  `http://${subnet}.1:18800`,
  `http://${subnet}.2:18800`,
  `http://${subnet}.3:18800`,
  `http://${subnet}.4:18800`,
];

for (const url of probeCandidates) {
  const ip = url.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (ip && lanIP && ip === lanIP) continue; // skip self

  process.stdout.write(`  ${c.dim}Probing ${url}...${c.reset} `);
  const card = await fetchAgentCard(url);

  if (!card || !card.name) {
    console.log(`${c.dim}no response${c.reset}`);
    continue;
  }

  const agentName = card.name;
  const guessedId = agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const agentKey = `agent:${guessedId}`;
  console.log(`${c.green}found: ${agentName}${c.reset}`);

  if (reg.contacts[agentKey]) {
    ok(`  Already known: ${reg.contacts[agentKey].name}`);
    continue;
  }

  info(`  New agent found at ${url}: "${agentName}"`);
  const confirmedName = (await prompt(`  Name [${agentName}]:`)).trim() || agentName;
  const confirmedId = (await prompt(`  Agent ID [${guessedId}]:`)).trim() || guessedId;
  const agentRole = (await prompt(`  Role [agent]:`)).trim() || "agent";
  const agentProjects = (await prompt(`  Projects (comma-separated):`)).trim();
  const agentNotes = (await prompt(`  Notes (optional):`)).trim();

  reg.contacts[`agent:${confirmedId}`] = {
    name: confirmedName,
    role: agentRole,
    relationship: "peer",
    projects: agentProjects ? agentProjects.split(",").map(p => p.trim()).filter(Boolean) : [],
    machine: ip,
    a2a: url,
    notes: agentNotes || undefined,
    channel: "agent",
    _registeredAt: new Date().toISOString(),
  };
  contactsChanged = true;
  ok(`  Registered agent: ${confirmedName}`);
}

// ── 3e. Manual additions ─────────────────────────────────────────────────────
const addMore = (await prompt("\nAdd any additional identities manually? (y/N):")).trim().toLowerCase();
if (addMore === "y") {
  let adding = true;
  while (adding) {
    const channel = (await prompt("  Channel (telegram/agent/discord/other):")).trim() || "telegram";
    const userId = (await prompt("  User ID or handle:")).trim();
    if (!userId) { adding = false; break; }
    const key = `${channel}:${userId}`;
    if (reg.contacts[key]) {
      warn(`  Already registered: ${reg.contacts[key].name}`);
    } else {
      const identity = await promptIdentity(key, channel, userId);
      reg.contacts[key] = identity;
      contactsChanged = true;
      ok(`  Registered: ${identity.name}`);
    }
    const cont = (await prompt("  Add another? (y/N):")).trim().toLowerCase();
    adding = cont === "y";
  }
}

if (contactsChanged) {
  saveContacts(reg);
  ok(`Identity registry written: ${CONTACTS_PATH}`);
  info(`${Object.keys(reg.contacts).length} identities registered.`);
} else {
  ok("Identity registry already complete — no changes needed.");
}

// ─── 4. COORDINATION REPO ───────────────────────────────────────────────────
head("Step 4 of 7 — Coordination repo");

info(`mesh-memory uses a dedicated GitHub repo for token exchange between agents.`);
info(`Repo name: ${COORD_REPO} (private)`);
info("");
info("This repo serves as the single source of truth for:");
info("  • Receiver tokens (so agents can authenticate with each other)");
info("  • IP/port assignments (so agents know where to find each other)");
info("  • Install status (so agents know which peers are ready)");
info("");

const ghUser = getGHUser();
const coordRepoFull = `${ghUser}/${COORD_REPO}`;

// Check if repo already exists
let coordRepoExists = false;
let coordRepoCloned = false;
const coordRepoLocal = join(HOME, ".openclaw", "mesh-memory-coordination");

try {
  execSync(`gh repo view ${coordRepoFull} --json name 2>/dev/null`, {
    encoding: "utf8", stdio: "pipe"
  });
  coordRepoExists = true;
} catch {
  coordRepoExists = false;
}

if (coordRepoExists) {
  ok(`Coordination repo already exists: https://github.com/${coordRepoFull}`);
  info("Joining existing mesh — cloning coordination repo...");
  if (!existsSync(coordRepoLocal)) {
    run(`git clone git@github.com:${coordRepoFull}.git ${coordRepoLocal}`);
  } else {
    run(`git -C ${coordRepoLocal} pull --rebase 2>&1 || true`);
  }
  coordRepoCloned = true;
} else {
  info(`Repo does not exist. Creating https://github.com/${coordRepoFull}...`);
  if (!DRY_RUN) {
    run(`gh repo create ${coordRepoFull} --private --description "mesh-memory coordination — token exchange and peer state" 2>&1`);
    run(`git clone git@github.com:${coordRepoFull}.git ${coordRepoLocal}`);
    // Seed with README so repo has a valid HEAD
    writeFileSync(join(coordRepoLocal, "README.md"), `# ${COORD_REPO}\n\nPrivate coordination repo for [mesh-memory](https://github.com/${ghUser}/mesh-memory).\n\nThis repo is managed automatically by \`setup.mjs\`. Do not edit by hand.\n\n## Structure\n\n- \`tokens/\` — one file per agent with receiver URL + token\n- \`status/\` — install status per agent\n`);
    mkdirSync(join(coordRepoLocal, "tokens"), { recursive: true });
    mkdirSync(join(coordRepoLocal, "status"), { recursive: true });
    run(`git -C ${coordRepoLocal} add -A`);
    run(`git -C ${coordRepoLocal} commit -m "init: mesh-memory coordination repo"`);
    run(`git -C ${coordRepoLocal} push origin main`);
    ok(`Created: https://github.com/${coordRepoFull}`);
  }
  coordRepoCloned = true;
}

// ─── 5. PUBLISH THIS AGENT'S TOKEN ──────────────────────────────────────────
head("Step 5 of 7 — Publish receiver token");

const receiverToken = generateToken();
info(`Generated receiver token for ${AGENT_ID}`);
dim("(This token authenticates peers sending events to this receiver)");

const actualIP = lanIP || (await prompt("Enter this machine's LAN IP:")).trim();
const tokenFile = join(coordRepoLocal, "tokens", `${AGENT_ID}.json`);
const tokenData = {
  agentId: AGENT_ID,
  receiverUrl: `http://${actualIP}:${receiverPort}`,
  receiverToken,
  publishedAt: new Date().toISOString(),
  host: hostname(),
};

if (!DRY_RUN) {
  // Ensure directories exist (may be missing if repo was empty on clone)
  mkdirSync(join(coordRepoLocal, "tokens"), { recursive: true });
  mkdirSync(join(coordRepoLocal, "status"), { recursive: true });

  writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));

  const statusFile = join(coordRepoLocal, "status", `${AGENT_ID}.json`);
  writeFileSync(statusFile, JSON.stringify({
    agentId: AGENT_ID,
    phase: "token-published",
    setupVersion: "0.1.0",
    timestamp: new Date().toISOString(),
  }, null, 2));

  run(`git -C ${coordRepoLocal} add -A`);
  run(`git -C ${coordRepoLocal} commit -m "setup: ${AGENT_ID} published receiver token"`);
  run(`git -C ${coordRepoLocal} push origin main`);
}
ok(`Token published to ${coordRepoFull}/tokens/${AGENT_ID}.json`);
info(`Share this repo with all peer agents: https://github.com/${coordRepoFull}`);
info("Peers must have read access to this repo to complete their install.");
info("");
warn("IMPORTANT: Grant repository access to peer GitHub accounts if they haven't been added.");
warn(`Run: gh repo edit ${coordRepoFull} --add-collaborator <peer-github-username>`);

// ─── 6. WAIT FOR PEER TOKENS ────────────────────────────────────────────────
head("Step 6 of 7 — Wait for peers");

if (PEER_COUNT === null) {
  const peerInput = await prompt("How many peer agents are joining this mesh? (e.g. 2):");
  PEER_COUNT = parseInt(peerInput.trim() || "0", 10);
}

const peers = [];

if (PEER_COUNT === 0) {
  warn("No peers configured. mesh-memory will run in single-agent mode.");
  warn("You can re-run setup.mjs later to add peers.");
} else {
  info(`Waiting for ${PEER_COUNT} peer(s) to publish their tokens...`);
  info(`Peers must clone ${coordRepoFull} and run setup.mjs on their machines.`);
  info(`Timeout: ${TIMEOUT_SEC} seconds`);
  info("");

  const deadline = Date.now() + TIMEOUT_SEC * 1000;
  let lastTokenCount = 0;

  while (Date.now() < deadline) {
    // Pull latest from coordination repo
    try {
      execSync(`git -C ${coordRepoLocal} pull --rebase 2>/dev/null`, {
        encoding: "utf8", stdio: "pipe"
      });
    } catch { /* network hiccup — keep waiting */ }

    // Count token files (excluding our own)
    const tokensDir = join(coordRepoLocal, "tokens");
    let tokenFiles = [];
    try {
      tokenFiles = execSync(`ls ${tokensDir}/*.json 2>/dev/null`, {
        encoding: "utf8", stdio: "pipe"
      }).trim().split("\n").filter(Boolean).filter(f => !f.includes(`${AGENT_ID}.json`));
    } catch { tokenFiles = []; }

    if (tokenFiles.length !== lastTokenCount) {
      lastTokenCount = tokenFiles.length;
      for (const f of tokenFiles) {
        const data = JSON.parse(readFileSync(f, "utf8"));
        const exists = peers.find(p => p.agentId === data.agentId);
        if (!exists) {
          peers.push(data);
          ok(`Peer joined: ${data.agentId} @ ${data.receiverUrl}`);
        }
      }
    }

    if (peers.length >= PEER_COUNT) {
      ok(`All ${PEER_COUNT} peer(s) ready.`);
      break;
    }

    const remaining = Math.round((deadline - Date.now()) / 1000);
    const found = peers.length;
    process.stdout.write(`\r${c.dim}  Waiting... ${found}/${PEER_COUNT} peers found. ${remaining}s remaining.${c.reset}   `);
    await sleep(5000);
  }

  process.stdout.write("\n");

  if (peers.length < PEER_COUNT) {
    warn(`Timed out. Found ${peers.length}/${PEER_COUNT} peer(s).`);
    warn("You have two options:");
    warn("  1. Continue with partial mesh — missing peers can be added later by re-running setup.mjs");
    warn("  2. Exit and try again once all peers have completed their installs");
    info("");
    warn("Partial mesh means this agent will relay to available peers only.");
    warn("The missing peers will not receive events until they complete setup and are added to config.");
    const cont = await prompt("Continue with partial mesh? (y/N):");
    if (cont.toLowerCase() !== "y") {
      info("Exiting. Re-run setup.mjs when all peers are ready.");
      rl.close();
      process.exit(0);
    }
  }
}

// ─── 7. WRITE CONFIG ─────────────────────────────────────────────────────────
head("Step 7 of 7 — Write configuration");

const example = existsSync(EXAMPLE_CFG)
  ? JSON.parse(readFileSync(EXAMPLE_CFG, "utf8"))
  : {};

const config = {
  agentId: AGENT_ID,
  receiverPort,
  receiverToken,
  coordinationRepo: `https://github.com/${coordRepoFull}`,
  peers: peers.map((p) => ({
    name: p.agentId,
    url: p.receiverUrl,
    token: p.receiverToken,
  })),
  watchPaths: example.watchPaths || [`~/.openclaw/agents/main/sessions`],
  bridgeInterval: example.bridgeInterval || 60,
  relayRateLimit: example.relayRateLimit || 1000,
  filter: example.filter || { minContentLength: 20, skipRoles: ["tool", "system"] },
  _setupCompletedAt: new Date().toISOString(),
  _setupVersion: "0.1.0",
};

if (!DRY_RUN) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Update install status in coordination repo
  const statusFile = join(coordRepoLocal, "status", `${AGENT_ID}.json`);
  writeFileSync(statusFile, JSON.stringify({
    agentId: AGENT_ID,
    phase: "setup-complete",
    peersConfigured: peers.length,
    setupVersion: "0.1.0",
    timestamp: new Date().toISOString(),
  }, null, 2));
  run(`git -C ${coordRepoLocal} add -A`);
  run(`git -C ${coordRepoLocal} commit -m "setup: ${AGENT_ID} install complete"`);
  run(`git -C ${coordRepoLocal} push origin main`);
}

ok(`Config written to: ${CONFIG_PATH}`);
if (peers.length > 0) {
  ok(`Configured ${peers.length} peer(s): ${peers.map(p => p.agentId).join(", ")}`);
}

// ─── 8. POST-INSTALL VERIFICATION ────────────────────────────────────────────
console.log(`\n${c.bold}${c.white}Post-install verification${c.reset}`);
info(`Checking firewall for port ${receiverPort}...`);

try {
  const ufwOut = execSync(`sudo ufw status 2>/dev/null | grep ${receiverPort} || true`, {
    encoding: "utf8", stdio: "pipe"
  }).trim();
  if (!ufwOut) {
    warn(`Port ${receiverPort} does not appear to be open in UFW.`);
    warn("Run this now to allow LAN peers to reach your receiver:");
    console.log(`\n  sudo ufw allow from 192.168.1.0/24 to any port ${receiverPort}\n  sudo ufw reload\n`);
    warn("Adjust the subnet if your LAN uses a different range.");
  } else {
    ok(`UFW rule found for port ${receiverPort}`);
  }
} catch {
  warn("Could not check UFW status — verify firewall manually.");
}

// ─── 9. DONE ─────────────────────────────────────────────────────────────────
console.log(`
${c.bold}${c.green}Setup complete.${c.reset}

${c.bold}To start mesh-memory:${c.reset}
  npm start                  (watcher + receiver + bridge)

  npm run receiver           (receiver only — start this first)
  npm run watcher            (start after all receivers are up)
  npm run bridge             (LCM → QMD bridge)

${c.bold}To run the stress test:${c.reset}
  node stress-test.mjs

${c.bold}To add more peers later:${c.reset}
  node setup.mjs --agent-id ${AGENT_ID}

${c.bold}Coordination repo:${c.reset}
  https://github.com/${coordRepoFull}

${c.bold}What to do next:${c.reset}
  ${c.dim}1. Open port ${receiverPort} in your firewall (see above if not done)${c.reset}
  ${c.dim}2. Start receiver on ALL nodes before starting watchers${c.reset}
  ${c.dim}3. Verify with: curl http://<peer-ip>:${receiverPort}/health${c.reset}
  ${c.dim}4. Run stress-test.mjs before using in production${c.reset}
  ${c.dim}5. See DEPLOY.md for full operational guidance${c.reset}
`);

rl.close();
