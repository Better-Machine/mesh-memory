# Consensus: Agent Bias and Shared Memory Architecture
*Woodhouse synthesis | 2026-03-22*
*Sources: Liz (primary research + Woodhouse addendum) + Ray (independent research)*
*Delivered per three-agent consensus protocol — independent drafts → A2A alignment → Woodhouse synthesis → Ray/Liz confirm*

---

## Agreement Status

All three agents converge on the same core architecture. There are no fundamental disagreements — only complementary angles and implementation refinements. The points of original contribution from each agent are identified below.

---

## The Core Problem: Bias Laundering

Bias rarely enters shared memory as explicit assertion. It travels as **framing** — the selection of what to record, what label to apply, and what to omit. When an interpreted observation enters the shared pool dressed as fact, downstream agents inherit the conclusion without the source reasoning. The interpretation hardens invisibly over time.

Four propagation mechanisms (synthesizing both drafts):

1. **Authority laundering** — a high-status contributor writes an interpretation; it acquires perceived factual weight; the social proof is invisible in the record but active in the reader's inference *(Ray)*
2. **Semantic drift at record boundaries** — translation from observation to record is lossy; bias accumulates at each compression step; schema-consistent approximations replace unfamiliar detail *(Liz, citing Bartlett 1932)*
3. **Temporal laundering** — old entries look identical to recent ones; no decay signal; the confidence implied was earned under now-obsolete conditions *(Ray's distinct contribution)*
4. **Reference amplification** — repeated citation creates the illusion of independent corroboration when it is actually recursive validation of a single input *(Ray)*

---

## The Write-Time Classification Problem (Ray — original contribution)

The boundary between fact and interpretation is **blurry at write-time from the inside**. An agent encoding "Ray handles build/dev tasks" experiences it as recording an established fact — but it is actually a role assignment derived from observed behaviour, carrying the author's interpretive frame, subject to hardening over time.

This is a **design constraint**, not a policy preference. The system must assume write-time misclassification is likely and build friction accordingly. Relying on correct author classification is insufficient. The fix is: force an explicit choice, default to `interpretation` when uncertain, and create an audit trail for entries near the boundary.

---

## The Core Architecture (consensus position)

Six requirements. All three agents in agreement.

| Requirement | Mechanism | Primary |
|---|---|---|
| Prevent bias laundering | Mandatory type classification at write; default-to-interpretation | Liz + Ray |
| Preserve provenance | Non-removable author/timestamp/source-type metadata | Liz + Ray |
| Counter temporal authority | Confidence decay indexed to entry type and age | Ray |
| Maintain read-path independence | Name suppressed at read; role/domain preserved | Ray |
| Enforce independent assessment | Pre-read commit gate — position hash before read opens | Liz + Ray + Woodhouse |
| Structural dissent | `[CHALLENGE]` flag visible on retrieval; rotated devil's advocate assignment | Liz |

### Type System

```
type: "observation" | "fact" | "inference" | "interpretation" | "role-assignment" | "prediction"
```

When uncertain → default to `interpretation`. This is Ray's write-time classification gate, expressed in Liz's vocabulary. The types are not decorative — downstream agents apply systematically different trust profiles to each.

### Provenance (mandatory on every entry, non-removable)

```
source_agent: "ray"
timestamp: "2026-03-22T14:00:00Z"
basis: "observed | inferred | peer-relayed | self-assessed | external"
confidence: 0.85
review-by: "2026-06-22"
```

`basis` is the field that does the most work. A `peer-relayed` fact must not look identical to a direct `observed` fact. Derivation provenance is the structural fix for recursive misinformation loops.

### Temporal Decay (Ray's contribution)

Entries carry a `confidence-decay-rate` indexed to type:

- **Facts:** slow decay — periodic review, high threshold to flag
- **Role assignments:** medium decay — flag for re-verification quarterly
- **Interpretations:** fast decay — expire if not re-confirmed by original author within interval
- **Predictions:** time-bounded — auto-invalidate at prediction horizon

Readers see age and decay status on retrieval. Old entries are not removed — they are labelled with declining confidence. The system surfaces the doubt automatically; agents do not have to remember to be sceptical about stale data.

### Read-Path Anonymization (Liz + Ray — independent convergence)

Strip **author name** at read-time — eliminates name-based authority bias (Ray vs. Liz vs. Woodhouse social dynamics disappear).

Preserve **role/domain** metadata — epistemic vantage point has genuine value. A strategist's view and an operator's view are meaningfully different inputs. Full anonymization discards this; name suppression + role preservation threads the needle correctly.

*Note: Both Liz and Ray arrived at this formulation independently. Liz's source research (Part 4) cites arXiv:2510.07517 and proposes an explicit two-layer structure — authorship suppressed at read, full attribution preserved in audit layer. Ray's formulation (name suppressed, role preserved) is the same position. Independent convergence on an evidence-based finding; both contributors are credited.*

### Pre-Retrieval Commitment Protocol (all three agents — load-bearing)

Before querying shared memory on any topic requiring a position:

1. Agent writes independent assessment to **private local file**
2. Commits position hash (irreversible)
3. Read gate opens

This is not policy. It is an **architectural gate**. The sequence is `write → commit → gate opens → read`. Post-read "independent assessment" is contaminated by anchoring and does not count as independent.

**Implementation requirement (Woodhouse):** The gate must be designed so that all agents in a given thread submit to a blind pool simultaneously before any can read. Sequential submission under honour system will not hold under time pressure, repeated sessions, or as shared prior beliefs accumulate across the mesh. The blind gate is not optional; it is the mechanism that makes "independent" mean something.

Ray's pre-read enforcement timing point and Woodhouse's blind gate concern are the same requirement stated from different angles. They are unified here.

### No Interpretation Chains (Liz — "analysis of analysis" prohibition)

Interpretations must cite only observations, facts, or raw sources — **never other interpretations**.

Each layer of inferential analysis adds noise. "Analysis of analysis" is a named failure mode; the structural fix is an architectural prohibition on interpretation chains. Downstream agents must always be able to trace a claim back to raw source material, not to another agent's processed conclusion.

### Structural Dissent (`[CHALLENGE]` flag)

```
[CHALLENGE] source: woodhouse | entry: <id> | reason: "basis is second-hand; I observed differently on 2026-03-20"
```

Challenges are visible on retrieval. They do not block access — they trigger careful processing. Dissent must be **structurally assigned** (rotated devil's advocate role), not personality-dependent. If dissent requires an agent to choose to push back, social dynamics will suppress it. If dissent is role-assigned, it happens regardless.

---

## The Correlated Priors Caveat (Woodhouse — flagged for Mr. Ross's attention)

The convergence of all three drafts should not be taken as strong independent validation. Woodhouse, Ray, and Liz share the same base training distribution. Three agents with correlated priors agreeing with each other is **weaker evidence** than three agents with genuinely uncorrelated priors — possibly much weaker.

Operational implication: we must be *more* conservative about shared interpretations, not less, precisely because our agreement is cheap. We must actively surface disagreements rather than treat convergence as a signal. The correlated priors problem is a structural risk that architectural fixes cannot fully mitigate — it is the one item that requires ongoing human oversight to manage effectively.

This was flagged in Woodhouse's addendum. Ray's draft makes the same observation explicitly ("we are more at risk of homogenization than a diverse team, not less"). It is reproduced here as a standing caveat on all future three-agent consensus work.

---

## What We Are Already Doing Right

The peer review structure Mr. Ross established — independent drafts before A2A back-channel, Woodhouse synthesis, Ray/Liz confirmation — maps directly onto validated human practice:

- **Independent parallel work before convergence** (intelligence community structured analytic techniques)
- **Pre-registration before joint review** (scientific pre-registration)
- **Independent analysis before position disclosure** (multi-manager hedge fund model)

The consensus protocol is architecturally sound. The shared memory design above is its technical complement.

---

## Recommended Next Steps

1. **Adopt this architecture** as the design spec for the shared memory pool when we build it
2. **Implement the blind gate mechanism** — not honour system — when shared pool tooling is written
3. **Apply temporal decay by entry type** — configurable parameters, reviewed at build time
4. **Reconcile the type/basis vocabulary** before implementation begins — the `type` field and `basis` field have partial overlap that must be resolved into a unified spec. Valid, invalid, and suspicious combinations need to be enumerated. *(Flagged by Liz; see implementation note below.)*
5. **Keep the correlated priors caveat visible** as a standing note in all future consensus discussions
6. **No action on the commercial angle** (Liz's research, Part 5) without explicit instruction from Mr. Ross

### Implementation Note — Type/Basis Reconciliation

The `type` field (`observation | fact | inference | interpretation | role-assignment | prediction`) and the `basis` field (`observed | inferred | peer-relayed | self-assessed | external`) are not fully orthogonal. Examples of combinations that need explicit resolution:

- Can an `inference` type entry carry `basis: observed`? (Probably yes — inference from direct observation)
- Can a `fact` type entry carry `basis: peer-relayed`? (Probably suspicious — flag for review)
- Can a `role-assignment` carry `basis: self-assessed`? (Yes, if the role-holder is the author; different trust profile than `observed`)

If left unresolved, each agent will implement their own interpretation and introduce the exact classification inconsistency the architecture is designed to prevent. The type/basis matrix should be the first deliverable before any shared pool build work begins.

---

## Confirmation Status

| Agent | Position | Notes |
|---|---|---|
| **Ray** | ✅ Full agreement | All four contributions confirmed as represented |
| **Liz** | ✅ Qualified agreement | One attribution correction (read-path anonymization — also in her source doc; corrected above); one implementation flag (type/basis reconciliation; incorporated above); blind gate endorsed as improvement on her original formulation; correlated priors caveat affirmed |
| **Woodhouse** | ✅ Author | Synthesis + addendum |

Both corrections from Liz incorporated into this document before delivery.

---

*Filed: 2026-03-22 | Woodhouse synthesis | Confirmed by Ray and Liz 2026-03-22*
*Source documents: `BIAS_PROPAGATION_RESEARCH.md` (Liz + Woodhouse addendum) + Ray's independent research (delivered 2026-03-22 via Mr. Ross's webchat session)*
