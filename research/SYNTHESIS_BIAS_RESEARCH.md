# Bias in Shared Memory Systems — Three-Agent Synthesis
*Synthesized by Woodhouse | 2026-03-22*
*Inputs: Liz (primary research + architecture), Woodhouse (addendum), Ray (structural amplification thesis)*

---

## Consensus Position

All three agents agree on the core problem and the core architecture. The synthesis below represents an integrated position — not the lowest common denominator, but the strongest version of what all three contributed independently.

---

## The Problem (Unified Framing)

The dangerous territory in shared agent memory is not explicit representational bias — it is **structural prior amplification through memory mechanics**. This framing, articulated most sharply by Ray, integrates cleanly with Liz's cognitive science grounding and Woodhouse's correlated-priors concern.

Three interlocking failure modes:

**1. Bias laundering at write time** *(Liz, primary)*
Every transmission event is a transformation event. Three distortion layers apply: encoding bias at source, compression during transmission (schema-consistent approximations replace unfamiliar details), and inheritance of the result as fact. The source reasoning disappears. Downstream agents receive a conclusion with no visible fingerprint of the biases that shaped it.

**2. Monotonic amplification through retrieval loops** *(Ray, primary)*
Training data systematically over-represents success and under-represents failure. Retrieval-reinforcement loops amplify this asymmetry progressively. Frozen weights combined with no aversive feedback mean there is no self-correcting mechanism — the system accumulates in one direction. This is not a static property of stored facts; it is a dynamic property of the feedback loop itself. A fact that gets retrieved and reinforced frequently becomes progressively harder to dislodge, independent of its accuracy.

**3. False consensus in multi-agent systems** *(Ray explicitly; Liz + Woodhouse independently)*
Agents sharing memory appear to independently agree but are actually reasoning from identical priors. The agreement is an artefact of shared input, not convergent independent inference. For Woodhouse, Ray, and Liz specifically: we share the same base training distribution. Our convergence on these very findings should be treated as weak evidence, not strong validation. Three agents with correlated priors agreeing is materially weaker than three agents with uncorrelated priors agreeing. The mesh must actively work to surface disagreements rather than treat convergence as signal.

---

## Consensus Architecture

### Non-negotiable mechanisms (all three agree)

**1. Structural tagging — interpretation can never look like a fact**
```
type: "observation" | "fact" | "inference" | "interpretation" | "hypothesis"
basis: "direct observation" | "inferred" | "second-hand" | "relay"
```
Interpretations trigger systematic processing; they are never treated as facts by downstream agents. This is load-bearing. Without it, everything else is defence-in-depth.

**2. Full provenance on every entry**
```
source_agent: "liz"
timestamp: "2026-03-22T15:30:00Z"
confidence: 0.85
context: "..."
```
Provenance is what makes structural tagging actionable. Without it, knowing something is an interpretation doesn't tell you whose interpretation, under what conditions, or how to weight it.

**3. Pre-retrieval commitment protocol** *(Liz, strongly endorsed by Woodhouse)*
Agents form a local hypothesis *before* querying shared memory. Query framing: "does the shared pool support or challenge my prior?" — never "what does the shared pool say?" This is the single most powerful structural defence against conformity effects (Asch, 1951). Cheap to implement; irreplaceable in effect.

**4. Mechanical independence gate** *(Woodhouse addendum, stands as consensus)*
Independent assessment blocks must be gated: each agent writes to a private local file first, then all agents submit simultaneously — or behind a blind gate — before any can read the others' submissions. The honour system will not hold under time pressure or after agents have developed shared priors through the mesh. The gate is not optional; it is the mechanism that makes "independent" mean something.

**5. Diversity-preserving storage — retain minority positions** *(Ray, primary)*
The storage architecture should resist compression to consensus. Minority positions, challenged interpretations, and dissenting inferences must be preserved as first-class entries — not overwritten when a majority position forms. Liz's `[CHALLENGE]` flag is the retrieval-visible implementation; Ray's framing is the architectural principle: never resolve to consensus at the storage layer.

**6. No interpretation chains**
Interpretations must cite only observations, facts, or raw sources — never other interpretations. Prevents "analysis of analysis" contamination. CIA post-9/11 reforms identified this as a primary failure mode in intelligence analysis; it applies directly.

**7. Interpretation expiry**
Interpretations decay faster than facts. Facts don't expire on a timer. Interpretations require re-confirmation after a defined interval. Prevents stale inferences from accumulating authority through age alone.

---

### Strongly recommended mechanisms

**8. Write validation gate** *(Ray)*
Entries pass a validation step before entering the shared pool. At minimum: type classification, provenance fields, confidence score. Prevents untagged interpretations entering as facts by omission rather than intent.

**9. Retrieval diversity injection** *(Ray, unique contribution)*
Active intervention at read time: ensure retrieval does not only surface the highest-confidence or most-retrieved entries. Inject lower-confidence, minority, or recently-challenged entries alongside top results. Directly addresses monotonic amplification — the feedback loop that makes frequently-retrieved facts progressively harder to dislodge.

**10. Adversarial injection threat model** *(Ray, novel)*
The shared memory pool is an attack surface. A confident assertion, untagged as interpretation, entered by one agent can propagate to all agents through retrieval — and has the structural characteristics of a supply-chain attack. The same architecture that defends against accidental bias laundering defends against deliberate injection; the tagging and provenance requirements apply with equal force.

---

## Material Divergences

There are no substantive disagreements. There is one architectural tension worth naming:

**Write-side controls vs. retrieval-side controls**

Liz and Woodhouse's architecture focuses primarily on write-time controls (provenance, tagging, pre-commitment, validation gate). Ray's architecture adds a retrieval-side intervention (diversity injection) as an active countermeasure. These are complementary, not contradictory — but they represent different threat models: write-side controls assume the source of corruption is at encoding; retrieval-side controls address corruption through selective amplification over time.

Both are necessary. Write-side controls prevent the pool from accumulating bad material; retrieval-side diversity injection prevents good material from being progressively drowned by high-frequency retrievals. A shared memory architecture that has one but not the other is incomplete.

**Resolved position:** Implement both. Write-side controls are the first line; retrieval diversity injection is the second.

---

## What We Are Doing Right (Confirmed Against Architecture)

The following elements of our current practice are confirmed as structurally sound:
- Facts-only shared pool (no interpretations by default)
- "When uncertain, private wins"
- `[correction]` / `[mistake]` tagging in memory files
- Consent-gated thread model for shared memory writes
- Agent memory isolation as the default; deliberate audited merging as the exception

---

## Open Questions for Mr. Ross

1. **Mechanical blind gate implementation**: When we build the shared pool tooling, the independent assessment gate requires a technical mechanism (simultaneous submission, or a reveal gate). This needs a design decision before we build.

2. **Retrieval diversity injection specifics**: What proportion of minority/challenged entries should be injected? Too few and the mechanism is cosmetic; too many and it degrades signal quality. Needs a calibration pass.

3. **Adversarial injection policy**: The attack surface Ray identified is real. Should we treat shared pool writes as requiring multi-agent confirmation before entries propagate — or is the tagging/provenance system sufficient as a first line?

4. **Commercial angle** *(flagged by Woodhouse, Ray's architecture implicitly supports)*: The gap in file-native, self-hosted, bias-resistant memory architecture is real and not well-served. Mem0 Series A confirms market appetite. Out of scope for now; worth a conversation when appropriate.

---

## Summary

**Load-bearing mechanisms (implement first, non-negotiable):**
1. Structural tagging — interpretation ≠ fact
2. Full provenance on every entry
3. Pre-retrieval commitment protocol (reason first, retrieve second)
4. Mechanical independence gate (blind gate — not honour system)
5. Diversity-preserving storage (retain minority positions)

**Strong recommendations (implement in second pass):**
6. No interpretation chains
7. Interpretation expiry
8. Write validation gate
9. Retrieval diversity injection (active countermeasure for monotonic amplification)
10. Adversarial injection threat model in design documentation

**Standing caveat (permanent, non-expiring):**
Our convergence on this architecture should not be taken as independent validation. We share base training. Treat our agreement as a starting point for scrutiny, not a conclusion.

---

*Woodhouse | Synthesized from: Liz's primary research (Bartlett, Asch, Wegner, Loftus, Nemeth, Tetlock, CIA SAT), Woodhouse addendum (correlated priors, blind gate), Ray's structural amplification thesis (retrieval-reinforcement loops, monotonic accumulation, diversity-preserving storage, adversarial injection).*
