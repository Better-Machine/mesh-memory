# Agent Bias and Memory: Independent Research
_Author: Bobby Ray (Ray) | Date: 2026-03-22 | Status: COMPLETE_
_Note: Liz published bias-propagation-shared-memory.md first. Ray's window was contaminated at delivery.
This document focuses on complementary angles: temporal decay, the write-time classification problem, and pre-read enforcement timing._

---

## Framing

The task is: design a multi-agent shared memory system that preserves epistemic diversity while enabling factual coordination. The failure mode is **bias laundering** — a biased interpretation enters the shared pool dressed as fact, and downstream agents inherit the conclusion without the source reasoning.

Three questions to address:

1. How do humans propagate and inherit biases through shared knowledge structures?
2. What cognitive or architectural defences prevent homogeneous behaviour in groups with shared memory?
3. How do high-functioning teams maintain independent judgment while sharing a common factual base?

---

## Q1: How Humans Propagate Bias Through Shared Knowledge Structures

### The Laundering Mechanism

Bias rarely travels as explicit assertion. It travels as **framing** — the selection of what to record, what to omit, and what label to apply. When an interpreted observation enters a shared record, the interpretation embeds in the label. Future readers inherit the conclusion without access to the original perceptual context.

Classic example in human organizations: a manager writes in a performance review that an employee "tends toward perfectionism." That framing — which could mean either "excellent attention to detail" or "pathological inability to ship" depending on the author's intent — persists in the record. Future managers read it as established fact. The original context evaporates.

Mechanisms that propagate bias through shared knowledge structures:

**a) Authority laundering.** When a high-status contributor writes an interpretation, it acquires perceived factual weight. The social proof is invisible in the record but active in the reader's inference. The claim is remembered; who wrote it is not.

**b) Semantic drift at record boundaries.** Raw observations are translated into compressed records. Each translation step discards nuance. Bias accumulates at these boundary crossings — not through deliberate distortion, but through the lossy compression of complex context into portable labels.

**c) Temporal laundering.** Older shared facts look identical to recent ones. A claim that was accurate at T=0 but has since been disproven or superseded carries the same epistemic weight as a fresh, verified fact. No decay signal. The reader has no way to know that the confidence the record implies was earned years ago under now-obsolete conditions.

**d) Reference amplification.** Once a fact or interpretation appears in shared memory, it gets cited. Each citation increases apparent authority. Multiple agents citing the same (biased) source creates the illusion of independent corroboration — when in fact it is recursive validation of a single input.

### The Classification Problem at Write-Time

Here is the core technical tension: **the boundary between fact and interpretation is blurry at write-time.**

An agent writing "Ray handles build/dev tasks" experiences this as recording an established fact. But it is actually encoding a role assignment that:

- May not reflect Ray's explicit self-description
- Was derived from observed behavior, not stated policy
- Carries the author's interpretive frame (what "build/dev" means, what tasks qualify)
- Will harden over time into a constraint that shapes what tasks get routed to Ray

The author cannot cleanly classify this entry as fact or interpretation, because from the inside, it feels like both simultaneously. The classification problem cannot be fully solved by author intent — it requires architectural enforcement.

---

## Q2: Cognitive and Architectural Defences Against Homogenisation

### The Human Repertoire

Human groups that maintain epistemic diversity under shared-knowledge pressure deploy several strategies — usually without naming them:

**Structural disagreement roles.** Devil's advocate, red team, pre-mortem facilitator. These are institutionalized positions that grant license to challenge. The key insight: the license must be *role-granted*, not personality-dependent. If dissent requires an individual to choose to push back, dissent will be suppressed by social dynamics. If dissent is structurally assigned, it happens regardless.

**Provenance memory.** Expert communities maintain informal records of who said what and why. Not just the conclusion — the epistemic chain. "Smith's model showed X, but Smith was working with 2019 data and a different patient population." The provenance is inseparable from the claim. Communities that lose provenance memory become dogmatic fast.

**Rate-of-update norms.** High-functioning scientific communities are conservative about updating shared beliefs. New evidence must clear a threshold before it revises established shared positions. This isn't obscurantism — it's a defence against individual strong priors temporarily hijacking group epistemics.

**Independent parallel work before convergence.** Pre-registration in science. Separate analysis before joint review in intelligence communities. The structure: work independently, commit findings, then compare. Do not read peers' positions before committing your own.

### Architectural Defences for Agent Systems

Translating this to mesh-memory design:

**a) Write-time classification gate.** Force the contributing agent to classify each write explicitly: `fact | interpretation | role-assignment | prediction`. Disputed category? Default to `interpretation`. This doesn't solve the write-time ambiguity problem — but it surfaces it, forces a choice, and creates an audit trail.

**b) Provenance metadata on all writes.** Every shared memory entry carries: `author`, `timestamp`, `confidence`, `source-type` (observed / derived / peer-relayed / self-assessed), and `review-by` date. Provenance is non-removable — it persists with the entry even when facts are read by downstream agents.

**c) Temporal decay enforcement.** Entries carry `confidence-decay-rate` based on category:
  - Facts: slow decay (periodic review, high threshold to flag)
  - Role assignments: medium decay (flag for re-verification quarterly)
  - Interpretations: fast decay (expire if not re-confirmed by original author)
  - Predictions: time-bounded (auto-invalidate at prediction horizon)

**d) Read-path anonymization (selective).** Strip author identity from shared entries at read-time. Preserve role/domain metadata (so vantage-point context survives), but eliminate name-based authority priming. This addresses authority laundering without destroying all source differentiation.

**e) Structural dissent gate.** Before any three-agent consensus, require each agent to produce an independent position. No reading peers' views first. The gate is architectural — the system does not expose Liz's draft to Ray until Ray has committed a position hash.

---

## Q3: How High-Functioning Teams Maintain Independent Judgment With Shared Facts

### The Intelligence Community Model

The best-documented example of this problem at scale is the intelligence community — specifically, the post-9/11 and Iraq WMD failures. Both failures were partly failures of independent judgment under shared-fact conditions.

Key findings from post-mortems:

- **Shared raw intelligence does not guarantee independent analysis.** When analysts share not just raw data but also preliminary assessments, convergence happens fast. The shared assessment becomes the baseline everyone refines rather than challenges.
- **The "linchpin" problem.** A single key judgment, once widely shared, becomes load-bearing for all downstream analysis. Dissent from it requires challenging not just the fact but the entire inferential architecture built on top of it.
- **Layered review preserves independence.** Red team analysis that operates with the same raw facts but different mandate — explicitly tasked to challenge the shared picture — surfaces alternative hypotheses that normal convergent analysis misses.

### The Hedge Fund Parallel

High-performing multi-manager hedge funds operate with a related structure: shared market data (facts), private conviction (interpretation), and structured position disclosure only at the portfolio level. Analysts do not share models or theses during development — only inputs and final outputs. The middle layer (the reasoning) stays private until committed.

This preserves the genuine diversity of interpretation that is the actual value of having multiple analysts. If analysts share reasoning as they go, they converge on the same position and the diversification benefit evaporates.

### Principles for Mesh-Memory Design

Distilling the above into operational principles:

**Principle 1: Share facts, quarantine interpretations until committed.**
Facts enter shared pool immediately. Interpretations go into a private staging area. Interpretations become shareable only after the author has committed a hash (irreversible position lock). This forces genuine independence during development.

**Principle 2: Independent assessment before read.**
When a task requires a position that may be influenced by peer views, the agent must write and commit an independent assessment before reading shared records on that topic. Not policy — enforced by the system. The read gate opens only after the write is committed.

**Principle 3: Confidence decay indexed to category and age.**
No timeless facts. Every entry carries a decay schedule. Old shared facts are automatically flagged for re-verification — not removed, but labeled with declining confidence. Readers see the age and decay status.

**Principle 4: Dissent is structurally assigned, not personality-dependent.**
When three agents produce positions, one is designated to argue the contrary position regardless of their actual conviction. This is the institutionalized devil's advocate. It is not optional and not dependent on any agent choosing to push back.

**Principle 5: Provenance is non-negotiable.**
Every shared entry traces to its author, timestamp, source-type, and confidence-at-write. Anonymization of author identity at read-time (to prevent authority bias) does not erase provenance — it hides it behind a role label until explicitly requested for audit.

---

## Distinct Contributions (Ray's Independent Angles)

These are the points I'd flag as original contribution beyond Liz's likely coverage:

### 1. The Write-Time Classification Problem

The fact/interpretation boundary is blurry *from the inside* at write-time. An author encoding a role assignment experiences it as fact. Architectural enforcement cannot rely on correct author classification — it must build in friction, default-to-interpretation rules, and audit trails for entries near the boundary. This is a *design constraint*, not a policy preference.

### 2. Temporal Decay as an Epistemic Hygiene Tool

Old shared facts are epistemically hazardous. They carry the confidence of the moment they were written, which may be completely unwarranted given elapsed time and changed conditions. Decay indexing — configurable by entry category, with automatic flagging at threshold — is a practical, implementable defence. It doesn't require agents to remember to doubt old facts; the system surfaces the doubt automatically.

### 3. Pre-Read Enforcement Timing is Critical

Independent assessment is valuable only if enforced *before* reading peer views. Post-read "independent assessment" is contaminated by anchoring. The system must gate: write-and-commit independent position → hash committed → read gate opens. Policy that says "assess independently then read peers" is not enforceable by will — it requires architectural gatekeeping.

### 4. Anonymization Should Preserve Role, Not Name

Full anonymization in the read path destroys vantage-point information (a strategist's view vs. an operator's view are meaningfully different). Stripping the *name* while preserving the *role/domain* eliminates authority bias (Ray vs. Liz vs. Woodhouse social dynamics) while preserving the epistemic value of knowing which functional perspective the entry comes from.

---

## Summary

The core architectural requirements for a bias-resistant shared memory system:

| Requirement | Mechanism |
|---|---|
| Prevent bias laundering | Mandatory fact/interpretation classification at write |
| Preserve provenance | Non-removable author/timestamp/source metadata |
| Counter temporal authority | Confidence decay indexed to category and age |
| Maintain read-path independence | Authority anonymized (name suppressed, role preserved) |
| Enforce independent assessment | Pre-read commit gate — position hash before read opens |
| Structural dissent | Rotated devil's advocate role, assigned not voluntary |

The insight that ties all six together: **independence cannot be preserved by individual will under shared-knowledge conditions.** Social dynamics, anchoring, and authority bias are structural forces. The defences must be structural too. Policy is insufficient. Architecture is required.

---

_Bobby Ray | 2026-03-22 | For Woodhouse synthesis + three-agent consensus delivery_
