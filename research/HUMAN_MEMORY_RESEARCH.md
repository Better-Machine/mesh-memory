# Human Memory Architecture → AI Agent Memory: An Actionable Spec
*Produced: 2026-03-22 | Research analyst: Liz subagent*
*Filed by Woodhouse on receipt via A2A, 2026-03-22*

---

## Part 1: How Human Memory Works (Mechanisms for System Design)

### Encoding — The Salience Gate

The brain doesn't record everything. It records what matters. Three filters determine what gets encoded:

1. **Attention gate**: Only attended stimuli reach hippocampal encoding. If the prefrontal cortex doesn't allocate attention, the event doesn't enter memory at all. This isn't a bug — it's aggressive pre-filtering to avoid storage overload.
2. **Salience weighting**: The amygdala tags inputs with emotional weight. High-arousal events (surprise, threat, joy) trigger norepinephrine release that strengthens hippocampal LTP (long-term potentiation). This is why you remember where you were on 9/11 but not most Tuesdays.
3. **Repetition/spacing effects**: Repeated exposure creates stronger synaptic connections via spaced consolidation. The spacing effect isn't about duration — it's about the *interval between exposures* triggering re-encoding from scratch each time, which strengthens the trace.

**What it optimizes for**: Useful signal density. Not accuracy — importance. The brain systematically over-weights novel, emotional, and repeated inputs.

### Consolidation — Compression Over Time

After encoding, memory doesn't sit static. Two processes transform it:

1. **Synaptic consolidation** (hours): Protein synthesis stabilizes the initial trace. Interference during this window (learning competing info) degrades the trace — this is retroactive interference.
2. **Systems consolidation** (days–weeks): Hippocampus replays episodic memories during sleep (especially slow-wave and REM sleep). Each replay is an opportunity for cortical integration — the specific episode gets abstracted into semantic knowledge. "That one time at the restaurant" becomes "I prefer Thai food."

**Sleep as offline batch processing**: The brain runs a consolidation pass approximately once per 24 hours. It prunes redundant episodes, extracts patterns, and migrates frequently-accessed episodic content into semantic (cortical) long-term storage. Episodic memory is expensive (highly specific, context-bound); semantic memory is cheap (abstract, portable).

**What it optimizes for**: Storage efficiency via abstraction. Specific events don't persist indefinitely — their *lessons* do.

### Retrieval — Reconstruction, Not Playback

Human memory retrieval is fundamentally **reconstructive**, not playback. When you remember something, you rebuild it from fragments + schema + current context. This has major implications:

1. **Associative vs. cued recall**: 
   - *Cued recall*: Given a specific trigger ("what did you eat at your birthday?"), you search by context
   - *Associative recall*: One memory activates related ones through spreading activation in semantic networks. Thinking about "beach" activates "sand," "sunscreen," "vacation," not through explicit search but through learned co-occurrence
2. **Context-dependent retrieval**: Memory is encoded with its context (physical state, emotional state, location). Reinstating the original context dramatically improves recall. This is why going back to a place brings up memories, or why "sleeping on it" works — same context, different state.
3. **Reconstruction errors**: Because retrieval rebuilds rather than replays, memories are routinely contaminated by subsequent knowledge, current beliefs, and emotional state. The past is rewritten with present-day understanding.

**What it optimizes for**: Fast relevance-matching over perfect accuracy. Speed and flexibility beat fidelity.

### Forgetting — Purposeful, Not Accidental

Forgetting is not failure — it's function:

1. **Decay**: Unused traces degrade over time (Ebbinghaus curve: ~70% lost in 24h without reinforcement). The forgetting curve is not linear — it's logarithmic. Early loss is fast; then it plateaus.
2. **Interference**: Similar memories compete. Proactive interference (old memories blocking new ones) and retroactive interference (new memories degrading old ones) are highest for similar-domain content.
3. **Motivated forgetting**: The prefrontal cortex can suppress hippocampal retrieval (active inhibition). Traumatic or unwanted memories can be partially suppressed through directed forgetting.
4. **Strategic pruning**: The brain prioritizes keeping high-utility memories. Low-utility specifics (exact prices, phone numbers) degrade faster than high-utility patterns (how to drive, social rules).

**What it optimizes for**: Keeps the retrieval index clean. Too many traces = interference and slower recall. Forgetting is the deletion that enables speed.

### Working Memory — The Active Workspace

Working memory is the brain's RAM: a capacity-limited, attention-dependent workspace where active processing happens.

- **Capacity**: ~4 chunks (Miller's "7±2" has been revised down). A "chunk" can be a letter, a word, or a complex concept — but the slot count stays fixed.
- **Chunking**: The magic of expertise. Experts encode more into each chunk by grouping related elements into single units (a chess grandmaster sees "king-side castle" as one chunk; a novice sees 6 pieces). This effectively multiplies useful capacity.
- **Attentional control**: Prefrontal cortex manages what stays in working memory and what gets displaced. Under cognitive load, older items get evicted (recency bias in active context).

**What it optimizes for**: Flexible, task-relevant computation within radical resource constraints. Forces selective attention and chunking as survival strategies.

---

## Part 2: Prior Work on AI Memory

### RAG (Retrieval-Augmented Generation)
**What it does**: At inference time, retrieve relevant documents via embedding similarity and inject into context window.

**Limitations vs. human retrieval**:
- Retrieval is by *similarity*, not by *relevance to current task*. Human retrieval uses goal-directed spreading activation; RAG uses cosine distance.
- No consolidation: raw documents persist forever as-is. No episodic→semantic compression. 
- No salience weighting at write time — everything gets indexed equally.
- Retrieval is one-shot: no iterative spreading activation, no re-query based on retrieved content.
- Context window injection is brittle: "lost in the middle" problem where injected chunks at center of context are poorly attended.

**What works**: Scales to large corpora, deterministic, auditable. Works well for factual lookups.

### Memory-Augmented Neural Networks (NTM, DNC)
**Neural Turing Machine (Graves et al., 2014)** and **Differentiable Neural Computer (2016)**: End-to-end differentiable external memory. The model learns to read/write memory through soft attention over memory slots.

**What worked**: Proved neural nets could learn algorithmic tasks (sorting, copy) using external memory that pure transformers couldn't.

**What failed**: Didn't scale. Training instability. Memory access patterns learned in training didn't generalize well to novel distributions. The "external memory" wasn't truly external — it was a fixed tensor, not persistent across sessions.

### MemGPT / Letta (2023–2024)
**Architecture**: Tiered memory system — core memory (in-context, ~2KB), recall memory (conversation history, searchable), archival memory (long-term vector store). Agent can explicitly read/write/search between tiers using function calls.

**Key insight**: Treat the LLM like an OS process — context window is RAM, external storage is disk. Agent manages its own memory explicitly.

**What works**: Persistent identity across conversations, ability to reference old interactions, user preference tracking.

**Limitations**: Memory management decisions (what to archive, what to keep in core) are made by the LLM itself — inconsistent, prompt-dependent. No principled consolidation. No salience weighting at write time. Recall is still similarity-based.

### Mem0 (2024–2025)
**Architecture**: Extracts structured facts from conversations via LLM, stores as key-value pairs with embeddings. At query time, retrieves relevant facts and injects into context. Claims 26% accuracy boost, 90% token savings, 91% lower latency vs. full-context approaches.

**Key insight**: Compress episodic conversations into semantic facts at write time rather than storing raw transcripts. This mirrors human episodic→semantic consolidation.

**What works**: Token efficiency is real. Structured extraction reduces noise in retrieval. Production-ready (AWS Agent SDK integration, $24M Series A).

**Limitations**: Extraction quality depends on LLM at write time — hallucinated "facts" pollute the store permanently. No temporal context on stored facts. No decay or pruning — facts accumulate indefinitely. No salience weighting.

### CoALA Framework (2023)
**Cognitive Architectures for Language Agents**: Academic framework mapping human memory types to LLM agent components. Distinguishes working memory (in-context), episodic (conversation history), semantic (knowledge base), and procedural (action templates) memory.

**Value**: Provides vocabulary and conceptual scaffolding. Most production systems map reasonably to this framework even without citing it.

---

## Part 3: Translatable Improvements for File-Based AI Memory

### Current System Baseline
| Component | Human Analog | Current State |
|---|---|---|
| `MEMORY.md` | Semantic long-term memory | Manually curated, static |
| `memory/YYYY-MM-DD.md` | Episodic memory / diary | Raw logs, no structure |
| `memory_search` | Retrieval | Semantic similarity only |
| Heartbeat/dream-cycle | Sleep consolidation | Exists but ad hoc |
| Session restart | Working memory clear | Complete wipe |

---

### 3.1 Salience-Weighted Encoding at Write Time

**Problem it solves**: Current daily logs treat all events equally. High-signal moments (major decisions, corrections from user, surprises, emotional tone) are buried alongside boilerplate ("searched for X, found Y").

**Implementation**:
- During daily note writes, tag entries with a salience score: `[HIGH]`, `[MED]`, `[LOW]`
- Criteria for HIGH: user correction/feedback, novel information, decision with downstream effects, emotional signal from user, repeated topic (second mention = escalate)
- Heartbeat consolidation only migrates HIGH/MED entries to `MEMORY.md`
- LOW entries age out after 7 days without promotion

```
## 2026-03-22 Daily Log
[HIGH] Erik corrected assumption about Felix's LLC ownership — Felix is 50% owner, not a founder-employee
[MED] HockeyOps blocked on bank account setup — Felix must contribute first
[LOW] Searched for NHL draft stats, found ESPN API unreliable
```

**Effort**: Low  
**Priority**: Must-have

---

### 3.2 Structured Consolidation During Heartbeats (Sleep Analog)

**Problem it solves**: Episodic logs grow indefinitely without compression. The dream-cycle exists but has no principled algorithm for what to extract.

**Implementation**:
- Heartbeat consolidation pass (daily, off-peak):
  1. Read all `[HIGH]` entries from past 7 days
  2. Extract: facts, corrections, decisions, standing preferences, project state changes
  3. Merge into `MEMORY.md` with date stamp
  4. Downgrade processed `[HIGH]` entries to `[ARCHIVED]` in daily files
  5. Delete daily files >30 days old where all entries are LOW/ARCHIVED
- Introduce `memory/weekly-summary/YYYY-WNN.md` — one paragraph per week distilling the key semantic facts from that week's episodes

**Effort**: Medium  
**Priority**: Must-have

---

### 3.3 Context-Tagging for Better Retrieval

**Problem it solves**: Flat semantic search misses context-dependent retrieval. "What did we discuss about HockeyOps?" returns semantically similar text, but not necessarily the most *relevant* entry for current task state.

**Implementation**:
- Tag memory entries with context dimensions: `[project:hockeyops]`, `[person:felix]`, `[topic:finance]`, `[type:decision]`, `[type:correction]`
- `memory_search` filters by tag before semantic scoring, boosting precision
- New file: `memory/index/project-index.md` — flat list of all project-tagged entries with dates, used as quick lookup without semantic search overhead

**Effort**: Medium  
**Priority**: Must-have

---

### 3.4 Decay + Pruning Policy (Strategic Forgetting)

**Problem it solves**: Without decay, memory stores accumulate noise. Old incorrect facts persist alongside new ones. The retrieval index degrades over time.

**Implementation**:
- Every entry in `MEMORY.md` gets a `last_validated` date and a `staleness_risk` flag
- Entries not referenced in 90 days get flagged `[STALE?]` — not deleted, but deprioritized in search and surfaced for review
- Corrections/superseded facts from user explicitly mark old entries `[SUPERSEDED by YYYY-MM-DD entry]` rather than just being overwritten — creates an audit trail
- Contradictory facts trigger a "memory conflict" log: `memory/conflicts/YYYY-MM-DD-conflict.md`

**Effort**: Low  
**Priority**: Nice-to-have (but prevents growing technical debt)

---

### 3.5 Chunking for Working Memory Efficiency

**Problem it solves**: When context window fills, the agent loads entire files into context. This is the equivalent of trying to hold a raw database dump in working memory.

**Implementation**:
- Introduce `MEMORY.md` sections with explicit chunk markers: `## [CHUNK: current-projects]`, `## [CHUNK: standing-preferences]`, `## [CHUNK: people]`
- Session startup loads only chunks relevant to current task, not full file
- New `memory/quick-context.md` — max 500 tokens, updated at every heartbeat — the absolute most critical current context (active projects, open threads, last 3 key facts)
- This file loads first, every session, before anything else

**Effort**: Low  
**Priority**: Must-have

---

### 3.6 Interference Prevention via Domain Isolation

**Problem it solves**: Similar memories compete. Notes about HockeyOps can contaminate retrieval for Localzon. All projects live in the same flat memory store.

**Implementation**:
- Dedicated subdirectory per project: `memory/projects/hockeyops/`, `memory/projects/localzon/`
- Cross-project retrieval requires explicit context switch, not default search scope
- `MEMORY.md` contains only cross-project facts (user preferences, standing instructions, identity)

**Effort**: Medium  
**Priority**: Nice-to-have

---

## Part 4: Where AI Exceeds Human Memory — Exploit the Gaps

| Advantage | Current Usage | Gap | Specific Improvement |
|---|---|---|---|
| **Perfect verbatim recall** | Files store exact text | Raw files exist but aren't differentiated from summaries | Explicitly tag verbatim quotes `[VERBATIM]` vs reconstructed summaries. Never rephrase direct user instructions — store them as-is and reference by file+line |
| **No interference between streams** | Not exploited | All memory is one flat search space | Project-isolated memory directories (see §3.6). Separate search scopes eliminate cross-domain interference entirely |
| **Parallel context files** | MEMORY.md is monolithic | Single file creates bottleneck and context bloat | Chunked MEMORY.md + per-project files + quick-context.md enables surgical context loading |
| **No sleep requirement** | Heartbeat runs periodically | Consolidation is ad hoc, not systematic | Structured heartbeat algorithm (§3.2) turns the async consolidation advantage into a reliable system property |
| **Arbitrary organizational structure** | Basic date-based hierarchy | Could have knowledge graphs, temporal indices, confidence scores | Add `memory/graph/` — a lightweight JSON or markdown knowledge graph linking entities (people, projects, facts) with relationship types and confidence scores |
| **Cross-agent memory sharing** | Not implemented | Liz and Ray have entirely separate memory stores | Shared `memory/shared/` directory accessible to both agents for cross-agent facts (user state, standing instructions, project status). Each agent maintains private `memory/private/` for agent-specific context |

---

## Part 5: Commercial Angle

The real product here is a **drop-in memory architecture layer for file-based AI agents** — a structured spec, directory schema, tagging convention, and consolidation algorithm that any developer running Claude Code, Cursor, or similar tools could adopt in an afternoon. The buyers are the hundreds of thousands of developers and power users building persistent AI assistants who are currently improvising their own memory systems from scratch. Everyone reinvents the same broken wheel: flat markdown files with no consolidation, no decay, no salience weighting, no interference prevention. A well-documented, MIT-licensed reference implementation with a companion hosted consolidation service (like Mem0 but for file-based agents) could capture the indie developer market quickly, with an enterprise tier for teams wanting cross-agent memory sharing and audit trails. The timing is right: Mem0 raised $24M proving the market exists; the gap is the self-hosted, developer-owned, file-native version.

---

## Quick Reference: Priority Implementation Order

| Priority | Item | Effort | Impact |
|---|---|---|---|
| 1 | `memory/quick-context.md` — always-loaded 500-token summary | Low | Immediate session coherence improvement |
| 2 | Salience tagging `[HIGH/MED/LOW]` in daily logs | Low | Enables everything downstream |
| | Chunked `MEMORY.md` with section markers | Low | Better context window efficiency |
| 4 | Structured heartbeat consolidation algorithm | Medium | Closes the episodic→semantic loop |
| 5 | Context tagging `[project:X]` + tag-filtered search | Medium | Precision retrieval |
| 6 | Staleness flags + superseded tracking | Low | Prevents memory rot |
| 7 | Project-isolated memory directories | Medium | Interference prevention at scale |
| 8 | Shared memory dir for cross-agent facts | Medium | Unlocks Ray+Liz collaboration |
| 9 | `memory/graph/` knowledge graph | High | Long-term associative retrieval |

---

*Sources consulted: Mem0 (arxiv 2504.19413, mem0.ai/research), Letta/MemGPT architecture docs, CoALA framework, Ebbinghaus forgetting curve literature, Baddeley & Hitch working memory model, Miller's chunking research, Squire & Zola-Morgan episodic/semantic distinction.*
