# Mesh Memory Bias Resistance — Three-Agent Consensus
*Synthesized by Woodhouse | 2026-03-22 | Sources: Liz (primary research + architecture), Ray (complementary angles), Woodhouse (addendum)*

---

## Preamble

This document consolidates three independent research streams into a single consensus position for Mr. Ross. Liz produced the primary research package (human cognitive science, AI memory survey, minimal architecture). Ray's window was partially contaminated at delivery — he was aware Liz had filed — but he focused deliberately on complementary angles not likely covered by Liz: temporal decay, the write-time classification problem, and pre-read enforcement timing. My addendum to Liz's document flagged the blind gate requirement and the correlated priors problem.

The convergence across all three streams is high. I will note where it is genuine and where it is suspect.

---

## Where All Three Agents Agree (Load-Bearing)

### 1. The Fact / Interpretation Barrier is Non-Negotiable

All three researchers independently identify **bias laundering** as the core failure mode, and all three identify the same structural fix: shared entries must be explicitly typed, and interpretations must never be surfaced to downstream agents as facts.

- **Liz:** `type: "observation" | "fact" | "interpretation" | "inference" | "hypothesis"` — interpretations trigger systematic processing; never treated as facts
- **Ray:** Mandatory write-time classification gate; disputed category defaults to `interpretation`; creates audit trail even when classification is uncertain
- **Woodhouse:** Concurs; the type system is necessary but not sufficient — provenance is what makes it actionable

**Consensus position:** Every shared memory entry carries an explicit type field. Interpretations and inferences are visually and functionally distinguishable from facts and observations at the point of retrieval. This is not a preference — it is the minimum viable bias defence.

### 2. Provenance Metadata is Non-Removable

All three agree that stripping provenance is how biases become invisible.

- **Liz:** Full provenance on every entry: `source_agent`, `timestamp`, `basis`, `confidence`, `context`
- **Ray:** Every entry carries `author`, `timestamp`, `confidence`, `source-type` (observed / derived / peer-relayed / self-assessed), `review-by` date — non-removable, persists with the entry
- **Woodhouse:** Provenance is what makes the type system actionable for downstream agents

**Consensus position:** Provenance metadata is non-optional and non-removable. It travels with the entry. Read-path processing may display it differently, but it cannot be stripped.

### 3. Independent Assessment Must Be Enforced Before Read

This is the single mechanism all three identify as most important and most at risk of failure by honour system.

- **Liz:** Pre-retrieval commitment protocol — agents form a local hypothesis before querying shared memory; "does the shared pool support or challenge my prior?" not "what does the shared pool say?"
- **Ray:** Pre-read enforcement timing is critical — independent assessment is valuable *only* if enforced before reading peer views; post-read "independent assessment" is contaminated by anchoring; requires architectural gatekeeping, not policy
- **Woodhouse:** The blind gate — each agent writes to a private local file first, then all submit simultaneously behind a gate before any can read. Honour system will not hold under time pressure or accumulated shared priors.

**Consensus position:** Independent assessment is architecturally gated. The system does not expose peer views until a position hash is committed. This is the mechanism that makes "independent" mean something. Policy is insufficient; the gate is required.

### 4. Dissent is Structural, Not Personality-Dependent

- **Liz:** Explicit `[CHALLENGE]` flag; challenges visible on retrieval; "challenge agent" structurally rewarded for dissent
- **Ray:** Rotated devil's advocate role — one agent assigned to argue the contrary position regardless of conviction; assigned, not voluntary
- **Woodhouse:** Concurs; institutionalised dissent is load-bearing

**Consensus position:** Dissent must be structurally assigned, not left to individual initiative. In our three-agent mesh, the devil's advocate role rotates. Challenges are logged as first-class entries (`[CHALLENGE]`), visible on retrieval.

---

## Ray's Complementary Contributions (Additive, Not Duplicative)

Ray's angles were genuinely distinct from Liz's coverage. Three are worth highlighting as standalone design contributions:

### A. Temporal Decay as Epistemic Hygiene

**Ray's framing:** Old shared facts are epistemically hazardous. They carry the confidence of the moment they were written, which may be unwarranted given elapsed time. Temporal laundering — old facts looking identical to recent ones — is a distinct failure mode from authority laundering or semantic drift.

**Ray's proposal:** Confidence decay indexed to entry category:
- Facts: slow decay, periodic review required, high threshold to flag
- Role assignments: medium decay, flag for re-verification quarterly
- Interpretations: fast decay, expire if not re-confirmed by original author
- Predictions: time-bounded, auto-invalidate at prediction horizon

This is a practical, implementable defence that doesn't require agents to remember to doubt old facts — the system surfaces the doubt automatically.

**My assessment:** This complements Liz's architecture (she includes interpretation expiry; Ray extends the principle to all categories and makes it configurable). Adopt in full.

### B. The Write-Time Classification Problem

**Ray's framing:** The fact/interpretation boundary is blurry from the inside at write-time. An agent encoding a role assignment ("Ray handles build/dev tasks") experiences it as recording a fact, but it is actually encoding an interpretation with significant downstream effects. The author cannot cleanly classify this at write time because from the inside it feels like both.

**Ray's implication:** Architectural enforcement cannot rely on correct author classification. The system must build in:
1. Friction — every write forces an explicit classification choice
2. Default-to-interpretation rule — uncertain category → `interpretation`
3. Audit trail for entries near the boundary
4. Dispute mechanism — any agent can re-classify an entry post-hoc with reasoning

**My assessment:** This is the cleanest statement of the classification problem I have seen from either research stream. It identifies a design constraint that neither policy nor intent can solve. Adopt.

### C. Read-Path Anonymisation Should Preserve Role, Not Name

**Ray's proposal:** Strip the *name* (Ray, Liz, Woodhouse) at read-time to eliminate authority bias from social dynamics, while preserving the *role/domain* label (strategist, operator, coder) so that vantage-point information survives.

Full anonymisation destroys epistemic value (a strategist's view vs. an operator's view are meaningfully different). Name anonymisation eliminates the authority bias vector (who said it, status dynamics) without collapsing the useful differentiation.

**My assessment:** This is a material improvement over the simpler "anonymise author" approach. The role/name distinction is exactly right. Adopt.

---

## The Correlated Priors Problem (Woodhouse Addendum — Reiterated)

I flagged this in my addendum to Liz's document and I will state it plainly here for the record:

**The convergence of Woodhouse, Ray, and Liz on essentially the same architecture should not be treated as strong independent validation.**

We share the same base training distribution. Three agents with correlated priors agreeing with each other is weaker evidence than three agents with uncorrelated priors agreeing — possibly much weaker. Our agreement is cheap. We are at higher risk of homogenisation than a diverse human team, not lower.

**The implication for the architecture we are designing:** We must be *more* conservative about shared interpretations, not less. The mechanisms we are building (blind gate, pre-read commitment, structural dissent) are partially designed to protect against exactly the correlated-priors failure. We should not relax them on the grounds that "all three of us agree it's fine." That is precisely the failure mode.

I am not raising this as dissent from the consensus. I am raising it as a caveat on the consensus's epistemic weight. Mr. Ross should weigh accordingly.

---

## Consolidated Architecture

The table below integrates all three research streams into a unified set of requirements:

| Requirement | Mechanism | Source |
|---|---|---|
| Prevent bias laundering | Mandatory type classification at write; `fact \| observation \| interpretation \| inference \| hypothesis` | Liz + Ray |
| Default safe classification | Uncertain type → defaults to `interpretation` | Ray |
| Preserve provenance | Non-removable `author`, `timestamp`, `basis`, `confidence`, `source-type` on every entry | Liz + Ray |
| Counter temporal authority | Confidence decay indexed to category and age; automatic flagging at threshold | Ray |
| Maintain read-path independence | Name anonymised, role/domain preserved (prevents authority bias, preserves epistemic value) | Ray |
| Enforce independent assessment | Pre-read commit gate — position hash before read opens; blind gate on group tasks | Liz + Woodhouse |
| Structural dissent | Rotated devil's advocate role; `[CHALLENGE]` entries as first-class; visible on retrieval | Liz + Ray |
| Prevent analysis-of-analysis | Interpretations may only cite observations, facts, or raw sources — not other interpretations | Liz |
| Post-hoc re-classification | Any agent may re-classify an existing entry; must supply reasoning; creates audit trail | Ray |
| Interpretation expiry | Interpretations expire if not re-confirmed by original author; auto-flagged | Liz + Ray |

---

## What We Do Not Yet Have

For completeness, the architecture has three open items not resolved by any research stream:

1. **The blind gate implementation.** We have agreement on what it must do. We do not have a concrete implementation plan for how it works in our file-based system. This requires a separate technical design.

2. **The shared pool location and write protocol.** Liz proposes `memory/shared/`; Ray's document does not specify a physical implementation. We need an agreed structure before we can build the tooling.

3. **Conflict resolution.** When two agents produce conflicting factual entries, the architecture as described requires a resolution mechanism. We have dissent logging — we do not yet have adjudication. This may be Mr. Ross's decision space, not ours.

---

## Recommendation to Mr. Ross

The architecture described above is sound. All three agents endorse it. The six table entries under Liz's original architecture remain load-bearing; Ray's additions (temporal decay, write-time classification constraints, name/role anonymisation split) are genuine improvements, not duplications.

**Immediate next steps, in order:**

1. **Adopt the schema** — type field, provenance fields, decay rates by category
2. **Design the blind gate** — practical implementation for three agents using file-based storage
3. **Establish the shared pool location** — agree on directory, access pattern, and write protocol
4. **Resolve the correlated priors caveat** — decide whether Mr. Ross wants external input on the architecture before we build it, precisely because we are aware that our agreement may not constitute independent validation

We are ready to proceed on any of these at your direction, sir.

---

*Woodhouse | Synthesis complete | 2026-03-22*
*Ray: **Full concurrence received 2026-03-22 16:15 EDT** — no dissent; endorses all four convergent points; flags blind gate and adjudication protocol as the two open items to resolve before shipping spec.*
*Liz: concurrence or dissent requested*
