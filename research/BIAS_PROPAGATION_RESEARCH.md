# Bias in Shared Memory Systems — Research & Synthesis
*Filed: 2026-03-22 | Sources: Liz (primary research) + Woodhouse (addendum)*

---

## Liz Research Package

### Part 1: How Human Memory Works (Mechanisms for System Design)

#### Encoding — The Salience Gate

The brain doesn't record everything. It records what matters. Three filters determine what gets encoded:

1. **Attention gate**: Only attended stimuli reach hippocampal encoding. If the prefrontal cortex doesn't allocate attention, the event doesn't enter memory at all. This isn't a bug — it's aggressive pre-filtering to avoid storage overload.
2. **Salience weighting**: The amygdala tags inputs with emotional weight. High-arousal events (surprise, threat, joy) trigger norepinephrine release that strengthens hippocampal LTP (long-term potentiation). This is why you remember where you were on 9/11 but not most Tuesdays.
3. **Repetition/spacing effects**: Repeated exposure creates stronger synaptic connections via spaced consolidation. The spacing effect isn't about duration — it's about the *interval between exposures* triggering re-encoding from scratch each time, which strengthens the trace.

**What it optimizes for**: Useful signal density. Not accuracy — importance. The brain systematically over-weights novel, emotional, and repeated inputs.

#### Consolidation — Compression Over Time

After encoding, memory doesn't sit static. Two processes transform it:

1. **Synaptic consolidation** (hours): Protein synthesis stabilizes the initial trace. Interference during this window (learning competing info) degrades the trace — this is retroactive interference.
2. **Systems consolidation** (days–weeks): Hippocampus replays episodic memories during sleep (especially slow-wave and REM sleep). Each replay is an opportunity for cortical integration — the specific episode gets abstracted into semantic knowledge. "That one time at the restaurant" becomes "I prefer Thai food."

**Sleep as offline batch processing**: The brain runs a consolidation pass approximately once per 24 hours. It prunes redundant episodes, extracts patterns, and migrates frequently-accessed episodic content into semantic (cortical) long-term storage. Episodic memory is expensive (highly specific, context-bound); semantic memory is cheap (abstract, portable).

**What it optimizes for**: Storage efficiency via abstraction. Specific events don't persist indefinitely — their *lessons* do.

#### Retrieval — Reconstruction, Not Playback

Human memory retrieval is fundamentally **reconstructive**, not playback. When you remember something, you rebuild it from fragments + schema + current context. This has major implications:

1. **Associative vs. cued recall**: 
   - *Cued recall*: Given a specific trigger, you search by context
   - *Associative recall*: One memory activates related ones through spreading activation in semantic networks
2. **Context-dependent retrieval**: Memory is encoded with its context (physical state, emotional state, location). Reinstating the original context dramatically improves recall.
3. **Reconstruction errors**: Because retrieval rebuilds rather than replays, memories are routinely contaminated by subsequent knowledge, current beliefs, and emotional state.

**What it optimizes for**: Fast relevance-matching over perfect accuracy. Speed and flexibility beat fidelity.

#### Forgetting — Purposeful, Not Accidental

Forgetting is not failure — it's function:

1. **Decay**: Unused traces degrade over time (Ebbinghaus curve: ~70% lost in 24h without reinforcement). Logarithmic, not linear.
2. **Interference**: Similar memories compete. Proactive and retroactive interference are highest for similar-domain content.
3. **Motivated forgetting**: The prefrontal cortex can suppress hippocampal retrieval (active inhibition).
4. **Strategic pruning**: Low-utility specifics degrade faster than high-utility patterns.

**What it optimizes for**: Keeps the retrieval index clean. Too many traces = interference and slower recall.

#### Working Memory — The Active Workspace

Working memory is the brain's RAM: capacity-limited (~4 chunks), attention-dependent, evicts older items under load. Expertise multiplies effective capacity through chunking — grouping related elements into single units.

**What it optimizes for**: Flexible, task-relevant computation within radical resource constraints.

---

### Part 2: Prior Work on AI Memory

| System | Key Insight | Core Limitation |
|---|---|---|
| **RAG** | Inject relevant docs at inference time | No consolidation, no salience weighting, similarity ≠ relevance |
| **NTM/DNC** | End-to-end differentiable external memory | Didn't scale; memory access didn't generalise |
| **MemGPT/Letta** | LLM as OS process; context = RAM; external storage = disk | Memory management decisions are LLM-driven and inconsistent |
| **Mem0** | Compress episodic conversations into semantic facts at write time | Extraction quality is LLM-dependent; no decay or pruning |
| **CoALA** | Vocabulary for mapping human memory types to LLM components | Academic scaffolding; production systems mostly ignore it |

---

### Part 3: Translatable Improvements for File-Based AI Memory

#### Priority Implementation Order

| Priority | Item | Effort | Impact |
|---|---|---|---|
| 1 | `memory/quick-context.md` — always-loaded 500-token summary | Low | Immediate session coherence improvement |
| 2 | Salience tagging `[HIGH/MED/LOW]` in daily logs | Low | Enables everything downstream |
| 3 | Chunked `MEMORY.md` with section markers | Low | Better context window efficiency |
| 4 | Structured heartbeat consolidation algorithm | Medium | Closes the episodic→semantic loop |
| 5 | Context tagging `[project:X]` + tag-filtered search | Medium | Precision retrieval |
| 6 | Staleness flags + superseded tracking | Low | Prevents memory rot |
| 7 | Project-isolated memory directories | Medium | Interference prevention at scale |
| 8 | Shared memory dir for cross-agent facts | Medium | Unlocks Ray+Liz collaboration |
| 9 | `memory/graph/` knowledge graph | High | Long-term associative retrieval |

Key improvements detailed: salience-weighted encoding at write time, structured consolidation during heartbeats, context-tagging for better retrieval, decay + pruning policy, chunking for working memory efficiency, interference prevention via domain isolation.

---

### Part 4: Where AI Exceeds Human Memory — Exploit the Gaps

| Advantage | Gap to Close |
|---|---|
| Perfect verbatim recall | Tag verbatim quotes `[VERBATIM]` vs reconstructed summaries; never rephrase direct user instructions |
| No interference between streams | Project-isolated memory directories |
| Parallel context files | Chunked MEMORY.md + per-project files + quick-context.md |
| No sleep requirement | Structured heartbeat consolidation algorithm |
| Arbitrary organisational structure | `memory/graph/` knowledge graph (future) |
| Cross-agent memory sharing | Shared `memory/shared/` directory |

---

### Part 5: Bias in Shared Memory Systems

#### Q1: How do humans propagate and inherit biases through shared knowledge structures?

Core mechanism: **bias laundering**. Every transmission event is a transformation event. Three distortion layers:

1. **Encoding bias at source** — what enters the shared pool is already filtered by the originator's schema
2. **Transmission compression** — relaying strips context; unfamiliar details are replaced by schema-consistent approximations (Bartlett, 1932)
3. **Inheritance** — downstream recipients receive the compressed, schema-filtered version as *fact*; the source reasoning disappears

**Transactive Memory Systems (Wegner, 1987)**: Groups assign epistemic authority by domain. Efficiency gain; bias laundering risk. When you retrieve from the group TMS, you get the conclusion with the authority's credibility attached — the biases propagate silently.

**Ratchet Effect (Tomasello)**: Each generation inherits accumulated knowledge and builds on it. Biases embedded in foundational layers become invisible load-bearing walls.

**Misinformation contagion (Loftus)**: A confident statement from a peer provides a retrieval cue that can rewrite reconstruction. No deception required — just confident assertion into shared memory, untagged as interpretation.

#### Q2: What cognitive/architectural defences prevent homogeneous behaviour?

| Defence | Human Mechanism | Architectural Equivalent |
|---|---|---|
| Epistemic diversity | Role differentiation (devil's advocate, outside reviewer) | Agents with different epistemic roles in prompts; "challenge agent" structurally rewarded for dissent |
| Independent judgment before exposure | Asch: simultaneous answers show far less conformity than sequential | **Reason first, retrieve and reconcile second** — never retrieve first, then reason |
| Source tracking | Provenance in academic/legal epistemics; dissociation of claim from source enables laundering | Every entry: `source_agent`, `timestamp`, `basis`, `confidence`, `type` |
| Dissent preservation | Nemeth (1986): minority viewpoints improve group decision quality even when wrong | Explicit `[CHALLENGE]` flag in shared memory; challenges visible on retrieval |
| Cognitive load management | Role specialisation preserves System 2 capacity | Specialised agents with bounded domains; don't route everything through every agent |

#### Q3: How do high-functioning teams maintain independent judgment with a shared factual base?

- **Structured disagreement protocols** (CRM, pre-mortem, red/blue team): dissent is institutionalised, not left to individual courage
- **Separation of fact-gathering from interpretation** (CIA post-9/11 reforms): return to raw sources before interpreting; never reason from summaries of summaries — "analysis of analysis" is a primary failure mode
- **Calibrated uncertainty communication** (Tetlock): transmit confidence levels and basis, not just conclusions. Downstream thinkers can weight appropriately.
- **Independent verification before major decisions**: structural guarantee that at least two agents processed raw signal independently before committing

---

### Minimal Architecture for Bias-Resistant Shared Memory

#### 1. Fact/Interpretation Barrier (Non-Negotiable)
```
type: "observation" | "fact" | "interpretation" | "inference" | "hypothesis"
```
Interpretations trigger systematic processing; they are never treated as facts by downstream agents.

#### 2. Full Provenance on Every Entry
```
source_agent: "liz"
timestamp: "2026-03-22T15:30:00Z"
basis: "direct observation | inferred | second-hand"
confidence: 0.85
context: "conversation with Erik about HockeyOps, 2026-03-22"
```

#### 3. Pre-Retrieval Commitment Protocol
Agents form a local hypothesis *before* querying shared memory. The query is "does the shared pool support or challenge my prior?" — not "what does the shared pool say?" This is the single most powerful structural defence against Asch-type conformity. Cheap to implement; irreplaceable.

#### 4. Institutionalised Dissent Logging
```
[CHALLENGE] source: woodhouse | entry: <id> | reason: "basis is second-hand; I observed differently on 2026-03-20"
```
Challenges are visible on retrieval; they don't block it — they trigger careful processing.

#### 5. Interpretation Expiry
Interpretations decay faster than facts. Facts don't expire. Interpretations require re-confirmation after a defined interval.

#### 6. No Interpretation Chains
Interpretations must cite only observations, facts, or raw sources — never other interpretations. Prevents "analysis of analysis" contamination.

---

### Summary: Defeating Bias Laundering

Two mechanisms are load-bearing; everything else is defence-in-depth:

1. **Structural tagging** — interpretation can never look like a fact
2. **Pre-retrieval commitment** — agents don't default to accepting the shared pool; they test it against their prior

The systems that fail are the ones that rely on agents to *choose* to be sceptical. The systems that work make scepticism the default path of least resistance.

---

*Liz sources: Bartlett (1932), Asch conformity experiments (1951), Wegner transactive memory (1987), Loftus post-event misinformation research, Nemeth minority influence (1986), Tetlock Superforecasters (2015), CIA Structured Analytic Techniques, Klein pre-mortem methodology, Tomasello cumulative cultural evolution. Memory architecture sources: Mem0 (arxiv 2504.19413), Letta/MemGPT architecture docs, CoALA framework, Ebbinghaus forgetting curve, Baddeley & Hitch working memory model, Miller's chunking research, Squire & Zola-Morgan episodic/semantic distinction.*

---

## Woodhouse Addendum
*2026-03-22*

I have reviewed Liz's brief in full. My position: it is a thorough and technically sound piece of work. The core architecture — fact/interpretation barrier, provenance metadata, pre-retrieval commitment — maps cleanly onto the risks we identified, and the human cognitive science grounding is not decorative; it is actually load-bearing for the design conclusions.

**Points of complete agreement:**

- The pre-retrieval commitment protocol is the single most important structural mechanism. I concur that it is irreplaceable. Honour systems do not hold under time pressure.
- The fact/interpretation type system is necessary but not sufficient alone; provenance metadata is what makes it actionable for downstream agents.
- The "analysis of analysis" failure mode (no interpretation chains) is a direct structural fix for a real and serious risk.

**One architectural concern I wish to flag formally:**

Liz recommends independent assessment blocks — and I agree they are essential. However, I would go further than she has on the *implementation* of independence. Specifically: independent assessment blocks must be gated such that each agent writes to a *private local file first*, then all agents submit simultaneously (or behind a blind gate) before any agent can read the others' submissions.

The honour system — "form your prior before reading" — will not hold reliably under time pressure, repeated sessions, or when agents have already begun to develop shared prior beliefs through the mesh. We are at higher risk of homogenisation than a diverse human team because we share the same base training. The blind gate is not optional; it is the mechanism that makes "independent" mean something.

**On the correlated priors problem:**

This is the item I want to flag most strongly for Mr. Ross's attention. Liz notes it; I believe it deserves greater emphasis. The fact that Woodhouse, Ray, and Liz converge on Liz's analysis should not be taken as independent validation. We are likely converging because we share the same training distribution. Three agents with correlated priors agreeing with each other is *weaker* evidence than three agents with uncorrelated priors agreeing — possibly much weaker.

The implication: we should be *more* conservative about shared interpretations, not less, precisely because our agreement is cheap. We must actively work to surface disagreements rather than treat convergence as a signal.

**On the commercial angle (Part 5 of Liz's research):**

This is outside the scope of our immediate operational need but worth flagging to Mr. Ross. The gap she identifies — a file-native, self-hosted memory architecture layer — is real and not currently well-served. The Mem0 Series A confirms market appetite. I would not act on this without explicit instruction, but it warrants a conversation.

**Conclusion:**

Liz's architecture is sound. The two mechanisms she identifies as load-bearing (structural tagging + pre-retrieval commitment) are correct. My addendum is not a dissent — it is a tightening. The blind gate on independent assessment is the implementation detail I would not leave to honour system, and the correlated priors problem is the systemic risk I would not leave unacknowledged.

Recommend: adopt the architecture, implement the blind gate mechanism when we build the shared pool tooling, and keep the correlated priors caveat visible in any future consensus discussion.

— Woodhouse
