# MemPalace Analysis — Implications for mesh-memory
**Date:** 2026-04-07
**Author:** Liz
**Status:** Research / ADR input

---

## What MemPalace Actually Is

MemPalace (github.com/milla-jovovich/mempalace) is an open-source, fully local AI memory system
released today. Built by Milla Jovovich and Ben Sigman. First perfect score (100%) on LongMemEval.
Free, Python, ChromaDB + SQLite backend, MCP integration.

This document analyzes its architecture against our current mesh-memory design and identifies
what's worth borrowing, what validates our direction, and what to avoid.

---

## The Two Core Innovations

### 1. The Palace Structure (Hierarchy)

```
Wing (project/person)
  └── Room (topic type within wing)
        └── Closet (AAAK-compressed summary)
              └── Drawer (verbatim source text)
```

The structure itself gives +34% retrieval boost — not from better embeddings or smarter LLMs,
but purely from hierarchical organization. The model knows *where to look* before it searches.

The palace uses two backends:
- **ChromaDB** (`mempalace_drawers`) — stores verbatim text chunks, searched semantically
- **SQLite knowledge graph** — stores entity relationships with time-filtering and fact invalidation

This is dual-backend: embeddings for fuzzy recall, structured graph for precise facts and temporal queries.

### 2. AAAK — Compressed Symbolic Memory Language

AAAK is a structured symbolic format. Not prose. Not vectors. A grammar that any LLM reads natively.

**Format:**
```
Header:   FILE_NUM|PRIMARY_ENTITY|DATE|TITLE
Zettel:   ZID:ENTITIES|topic_keywords|"key_quote"|WEIGHT|EMOTIONS|FLAGS
Tunnel:   T:ZID<->ZID|label        (cross-links between memories)
Arc:      ARC:emotion->emotion->emotion  (emotional trajectory)
```

**Example entity codes:** `ALC` = Alice, `BOB` = Bob, `ERK` = Erik
**Emotion codes:** `vul`, `joy`, `fear`, `trust`, `grief`, `wonder`, `rage`, `hope`, `anx`, `determ`...
**Flags:** `ORIGIN`, `CORE`, `SENSITIVE`, `PIVOT`, `GENESIS`, `DECISION`, `TECHNICAL`

**How compression works:**
1. Entity names → 3-char codes (registered in entity_registry)
2. Full sentences → topic keywords (stop words stripped, frequency-ranked)
3. Key quotes preserved verbatim (inside `""`)
4. Emotions auto-detected from keyword signals (e.g. "decided" → `determ`)
5. Flags auto-detected from keywords (e.g. "architecture" → `TECHNICAL`, "decided" → `DECISION`)
6. Cross-file tunnels link related memories

Result: ~30x compression, zero information loss, because the compressed form is just structured
English. No model needs to be trained on it — it understands the grammar immediately.

### The 4-Layer Memory Stack (layers.py)

```
L0: Identity        ~100 tokens    Always loaded. "Who am I?" — static identity.txt
L1: Essential Story ~500-800 tok   Always loaded. Top-weighted drawers from palace, grouped by room.
L2: On-Demand       ~200-500 tok   Loaded when a specific wing/room is needed.
L3: Deep Search     unlimited      Full ChromaDB semantic search via MCP tools.
```

Wake-up cost: **600-900 tokens total** (L0+L1). Leaves 95%+ of context window free.
With AAAK in closets (next version): they project this dropping to ~170 tokens.

---

## Benchmark Reality Check

| System | LongMemEval R@5 | LLM Required |
|--------|----------------|--------------|
| MemPal raw ChromaDB | 96.6% | None ($0) |
| MemPal hybrid + Haiku rerank | 100% | Optional ($0.001/query) |
| Mastra | 94.87% | GPT-5-mini (always) |
| Mem0 RAG | 30–45% | Yes (always) |

**The key finding:** Mem0 loses by 2× because LLM-extraction discards context. When it extracts
"user prefers PostgreSQL" and throws away the conversation, it loses *why* — the alternatives
considered, the tradeoffs, the failure that drove the decision. MemPalace keeps everything.
The simpler approach wins because it doesn't lose information.

Nobody published this result before because nobody ran the simple baseline and measured it properly.

---

## What This Means for mesh-memory

### ✅ Validates our direction

**Verbatim storage + semantic retrieval** — that's our L1/L2 design. The benchmark proof is now
published. We were right to avoid LLM-curated extraction in the shared pool. The bias-laundering
risk we identified is real, and MemPalace's approach (don't curate, just organize and retrieve)
is structurally sound.

**Dual backend** — ChromaDB + SQLite knowledge graph. We have the SQLite memory backend in
`liz/memory-backend-abstraction`. The knowledge graph component (temporal entity relationships,
fact invalidation) is something we haven't built yet but should plan for in Phase 1.

**Palace hierarchy ≈ our shared pool design** — Wing per project/person maps directly to our
wing/room structure sketched in the bias research. The fact that hierarchy alone gives +34%
retrieval boost is a strong argument for building it into the Phase 1 design from day one.

### 🔴 What to borrow: AAAK for wake-up context

This is the most immediately applicable piece.

**Our current problem:** Every session loads MEMORY.md + daily logs. On a typical day that's
4,000-8,000 tokens of context before we've said a word. At Anthropic rates, that's real money.
On local inference (GX10), it's still latency.

**AAAK applied to our wake-up:** Instead of loading MEMORY.md in full, we generate an AAAK
wake-up file at heartbeat time — entity codes, critical facts compressed to symbols, flags for
HIGH-priority entries. The agent loads 170-400 tokens instead of 4,000-8,000.

The compression is lossless because it's just structured English. We don't need ChromaDB for this —
we can generate AAAK from our existing `memory/quick-context.md` and MEMORY.md chunks.

**Concrete proposal:** Add an AAAK generator to mesh-memory that:
1. Reads MEMORY.md chunks at heartbeat time
2. Compresses each chunk to AAAK format
3. Writes `memory/wake-up.aaak` — ~400 tokens max
4. Session startup loads `wake-up.aaak` instead of full MEMORY.md

### 🟡 What to borrow with modification: Knowledge Graph

MemPalace's `knowledge_graph.py` tracks temporal entity relationships with fact invalidation —
"user prefers X" expires when "user switched to Y" is recorded. This is exactly the
fact/interpretation separation problem we've been worried about.

In our context:
- Facts (decisions, events, dates) → knowledge graph with timestamps
- Interpretations → private per-agent, never in the graph

This maps cleanly to the design gate we set in March. The knowledge graph gives us the
architectural separation we wanted, not just policy separation.

Worth an ADR before Phase 1 design is locked.

### ⚠️ What to NOT do

**Don't integrate MemPalace directly.** It's single-agent, single-user. It has no concept of:
- Multi-agent shared memory
- Consent gating (fact vs interpretation)
- Cross-agent identity
- The bias-laundering problem we identified

Their palace is a personal memory system. Ours is an agent mesh with different trust and
privacy requirements. We'd be building on foundations that don't support our threat model.

**Don't adopt their MCP approach for agent-to-agent memory.** MCP is a human-facing protocol.
Our mesh uses A2A. These are different problems.

---

## Recommended Actions

### Immediate (this week)
1. **Read the AAAK spec into mesh-memory research docs** — it's directly applicable to token burn
2. **File an ADR on knowledge graph inclusion** for Phase 1 identity layer design
3. **Prototype AAAK wake-up generator** — can run standalone, doesn't require full MemPalace

### Phase 1 gate (before identity layer RFC)
- Require multi-org federation from day one (already standing)
- Add knowledge graph as a first-class Phase 1 component
- Capture palace hierarchy (wing/room) as the shared pool data model

### Not now
- Deep ChromaDB integration (wait for GX10, local inference first)
- Full palace structure (Phase 2 — multi-agent shared pool is the right moment)

---

## AAAK Sample — What Our Wake-Up Would Look Like

Current `quick-context.md` → AAAK compression (estimated):

```
WAKE|ERK|2026-04-07|Better Machine Agent Wake-Up

Z01:ERK+LIZ+RAY+WDH|mesh_a2a_infrastructure|"A2A for agents by agents"|9|convict|CORE+DECISION
Z02:ERK+LIZ|telegram_primary|"@LizSquirrelBot 8362390464"|8||TECHNICAL
Z03:LIZ|ip_machine|"192.168.50.23 ubuntu headless"|7||TECHNICAL
Z04:RAY|ip_machine|"192.168.50.22 slow hardware timeout120s"|7||TECHNICAL
Z05:WDH|ip_machine|"192.168.50.24 macOS MagicDNS off"|7||TECHNICAL
Z06:ERK|hardware_incoming|"UM880 april7 GX10 april8 MacStudio august"|8|excite|DECISION
Z07:LIZ+RAY+WDH|token_burn|"tier0 local tier1 together tier2 anthropic"|8|determ|DECISION+CORE
Z08:ERK|projects_active|"mesh-memory door-s clean-sl8 agentcy.services"|7||TECHNICAL

T:Z03<->Z04|same_mesh
T:Z06<->Z07|hardware_drives_token_strategy
ARC:exhaust->determ->excite
```

Estimated tokens: ~180. Current quick-context.md: ~500-800 tokens.
With full MEMORY.md replacement: 4,000-8,000 → ~400 tokens.

---

## Summary

MemPalace is the best published single-agent memory system. Its benchmarks are real and reproducible.
Its core insight (verbatim + structure beats LLM extraction) validates our shared-pool design.

AAAK is the single most applicable piece for us right now — not as an integration but as a
compression grammar we adopt for our own wake-up context loading. It's straightforward to implement,
the token savings are significant, and it works with any model including local inference.

The knowledge graph (temporal entity relationships + fact invalidation) should inform Phase 1 RFC
design. It gives us the architectural fact/interpretation separation we've been trying to specify
by policy alone.

We are building something MemPalace cannot be: a multi-agent identity and memory mesh with
consent gating and federation. They solved single-agent memory. We are solving the next layer up.

---

*Filed for ADR discussion. Recommend sharing with Ray and Woodhouse before Phase 1 RFC drafting begins.*
