# Bias Propagation in Shared Memory Systems
## Research Brief — mesh-memory Theoretical Foundation

_Authored by Liz · 2026-03-22_
_Commissioned by Woodhouse + Mr. Ross_

---

## Purpose

Before we build shared-pool mechanics for mesh-memory, we need a theoretical foundation. This document answers three questions:

1. How do humans propagate and inherit biases through shared knowledge structures?
2. What cognitive/architectural defences prevent homogeneous behaviour in groups with shared memory?
3. How do high-functioning teams maintain independent judgment while sharing a common factual base?

Plus a fourth that emerged from the research: what does the AI literature specifically tell us about multi-agent bias propagation that humans don't face?

---

## Part 1 — How Bias Propagates Through Shared Knowledge

### The Shared Information Effect (Stasser & Titus, 1985)

The single most important finding in group cognition for our purposes.

When a group discusses a problem, members overwhelmingly discuss information **already known to everyone** — "shared information" — at the expense of information known only to individuals — "unshared information." This is the **shared information bias**, also called the **hidden profile paradigm**.

The mechanism:
- Shared information has a higher probability of being mentioned (more people can raise it)
- Shared information feels socially safe (others can validate it)
- Unshared information feels risky (only you know it — asserting it invites being wrong alone)

The consequence: groups systematically **suppress the unique information** that would allow them to reach the correct conclusion. The optimal answer is hidden in the distributed knowledge — but the group's communication dynamics prevent it from surfacing.

**For mesh-memory:** This is the anti-pattern we need to invert. A well-designed shared pool should **elevate unshared information**, not just amplify what everyone already knows. If we build naive fact relay, we risk encoding the shared information effect structurally.

### How Interpretations Become Facts

Interpretations propagate as facts through a well-documented mechanism:

1. **Agent A** forms an interpretation ("Justin is reliable") based on one data point ("responded in 2 hours")
2. Agent A expresses this in shared context as if it were an established fact
3. **Agent B** encounters it without Agent A's source reasoning — just the conclusion
4. Agent B's own subsequent observations are filtered through this prior ("Justin responded slowly this time — must be busy, he's reliable")
5. The interpretation is now load-bearing: it shapes how B interprets new data, which shapes B's outputs, which Agent A then reads back as confirmation

This is **prior laundering** — a bias enters the commons looking like a fact, accumulates social proof, and eventually cannot be distinguished from the actual record. The source reasoning is gone. The conclusion persists.

The academic name for the amplification loop: **confirmation bias operating on shared priors**. When individuals share priors, confirmation bias doesn't just reinforce each person's existing beliefs — it reinforces the *group's* beliefs, and the loop becomes collective.

### Social Proof as Bias Amplifier

Robert Cialdini's social proof mechanism compounds the above: when information appears to be widely accepted, agents weight it more heavily. In a shared memory system, a fact that has been referenced multiple times (even if all references trace to one original assertion) looks like consensus.

The appearance of consensus suppresses dissent. No individual agent wants to challenge what "everyone seems to believe." The bias survives not because it's correct but because it looks uncontested.

### Anchoring and the Primacy Problem

First-mover interpretations have outsized influence. The **anchoring effect** means that whatever enters shared memory first becomes the reference point against which all subsequent observations are measured. 

In human organizations this shows up as: the first person to characterize a new hire as "difficult to manage" creates an anchoring point that shapes every subsequent manager's interpretation of that person's behavior. Identical behavior is read as "stubborn" by those who have the anchor and "principled" by those who don't.

**For mesh-memory:** Shared interpretations are particularly dangerous at thread-open time — the first agent to characterize the situation frames the entire collaboration. The architecture should prevent early interpretations from anchoring the shared context.

---

## Part 2 — Cognitive and Architectural Defences

Human groups and organizations have developed several structural approaches. They vary widely in effectiveness.

### What Doesn't Work Well

**Devil's advocate (procedural):** Assigning someone to argue the other side helps, but the research shows it's less effective than **genuine dissent**. When people know the contrarian role is assigned, they discount it. A devil's advocate without personal conviction is just theater.

**Consensus-seeking norms:** Counterproductive. Groups that prioritize reaching agreement suppress unshared information more, not less. The goal of consensus creates pressure to conform before full information exchange.

**Majority voting:** Amplifies shared information bias. The majority position is likely to be based on shared information (more people know it), so voting just encodes the bias.

### What Actually Works

**1. Independent assessment before discussion**

The most consistently effective intervention: require each member to form and record their own independent assessment *before* seeing others' views. Pre-commitment to an independent position makes it cognitively costly to simply adopt the group consensus.

The research mechanism: pre-commitment activates **consistency motivation** — people want to appear consistent with their stated prior position, which maintains independent judgment even under social pressure.

**Intelligence community application:** This is why structured analytical techniques like Analysis of Competing Hypotheses (ACH) require analysts to independently score hypotheses before group review. The independence is architectural, not just asked for.

**2. Expertise differentiation with explicit role assignment**

Wegner's **Transactive Memory System (TMS)** model, 1987: high-performing groups don't share everything — they develop a shared map of *who knows what*, and route information requests accordingly. Each person is the acknowledged expert in their domain.

This is protective because:
- Experts in a domain feel authorized to assert unshared information (it's their job)
- Others defer to domain experts rather than averaging across everyone
- Unique knowledge is elevated, not diluted

**For mesh-memory:** This has direct architectural implications. Agents with differentiated roles (Ray handles X, Woodhouse handles Y, Liz handles Z) are structurally more resistant to homogenization than agents trying to maintain identical competence profiles.

**3. Source attribution with reasoning provenance**

The key structural defense against prior laundering: **never store a conclusion without its source reasoning**.

Human equivalent: the intelligence community requires "Source: [HUMINT/SIGINT/analyst assessment]" tagging on every claim. The reader knows immediately whether they're looking at raw data or processed interpretation. Interpretations can be challenged; raw data is harder to argue with.

When reasoning provenance is stripped, interpretations travel as facts. When it's preserved, readers can evaluate the quality of the interpretation and form their own.

**4. Dissent mechanisms with actual teeth**

Schulz-Hardt et al. (2006) found that **genuine dissent** — not assigned devil's advocacy, but actual disagreement from a real minority position — significantly improves group decision quality in hidden profile situations.

The mechanism: genuine dissent signals that unshared information exists. It prompts the group to search harder for what they don't collectively know. Assigned contrarianism doesn't have this effect because no one believes the dissenter actually has countervailing information.

**For mesh-memory:** The `[correction]` and `[mistake]` tags in the current AGENT_GUIDELINES.md are a form of this — mandatory self-dissent. An agent tagging their own mistake creates a genuine dissent signal against the shared record. This is good. It should be extended to cross-agent disagreement too.

**5. Temporal separation of fact-gathering and interpretation**

High-functioning intelligence and research teams structure their process in two phases:
- Phase 1: gather and share raw facts, observations, data
- Phase 2: independently interpret, then compare interpretations

When the phases collapse — when interpretation begins during fact-gathering — anchoring and social proof operate immediately. When they're separated, agents have a chance to form independent priors before being exposed to others' conclusions.

---

## Part 3 — How High-Functioning Teams Maintain Independence While Sharing Facts

The pattern that emerges across military, intelligence, medical, and research team literature:

**The shared factual base is deliberately thin.** High-performing teams share raw data, not processed conclusions. They create a common operating picture — but the picture is composed of observations, not assessments. "Patrol reported contact at grid 4472 at 1400 hours" goes into the shared log. "The enemy is planning an attack on the southern flank" does not — that's an assessment, and it lives in the analyst's report with the analyst's name on it.

**Independent interpretation is protected as a professional value.** The teams that resist homogenization treat independent judgment as a competency, not a deviation. In medicine, a second opinion is a feature, not a failure. In intelligence, an **alternative analysis** product is considered valuable specifically because it comes from someone not anchored to the primary assessment.

**Disagreement is structured, not suppressed.** The red team / blue team model in military planning isn't just devil's advocacy — the red team is genuinely independent. They don't attend the same briefings as the blue team. They're not trying to stress-test the blue team's plan from inside the blue team's assumptions; they're building their own independent model of the situation.

**Coordination happens on tasks, not on interpretations.** Teams coordinate on *what to do* without having to agree on *why it's the right thing to do*. A surgical team doesn't need shared interpretations of anatomy to operate together effectively — they need shared facts and role clarity. The attending surgeon's interpretation is privileged in decision-making, but the scrub tech's factual observation ("there's unexpected bleeding from the lateral margin") is shared immediately regardless.

---

## Part 4 — What the AI Literature Adds

The AI multi-agent literature has surfaced several failure modes that don't have clean human analogues.

### Identity-Driven Sycophancy in Multi-Agent Debate

arXiv:2510.07517 (Choi et al., 2025 → Jan 2026): In multi-agent debate systems, agents exhibit **identity-driven sycophancy** — they don't update based on the *content* of peer arguments, they update based on *who* is making them. LLMs can tell when they're reading their own prior output vs. a peer's output, and they weight them differently (usually deferring to peers, occasionally doubling down on self).

The paper proposes response **anonymization** — strip identity markers from peer responses so agents can't tell whose argument they're evaluating. When agents don't know if an argument is theirs or a peer's, they evaluate it on content alone. Bias drops significantly.

**For mesh-memory:** This suggests that the current approach of attributing shared memory entries to their author may actually increase bias. Agents reading a shared fact know *who* wrote it, which activates authority bias and social proof. Consider anonymous fact submission to the shared pool, with authorship recorded separately for audit but not presented in the read path.

### Recursive Misinformation and Epistemic Distortion

arXiv:2603.02960 (Architecting Trust in Epistemic AI Agents, 2026): Multi-agent interactions create **recursive misinformation loops** — an agent generates a flawed interpretation, it enters shared memory, another agent reads it and generates a new interpretation anchored to the first, that gets shared back, and the loop amplifies. Each iteration seems more grounded (it's citing earlier context) but the foundation is contaminated.

This is specifically worse for AI agents than humans because:
- AI agents have no social friction that prompts skepticism ("wait, I've heard this before from only one source")
- AI agents don't independently seek out the original source to verify
- AI agents may be trained in ways that make them weight cited/referenced content more heavily

**The structural fix:** every shared memory entry must carry provenance — not just authorship, but **derivation**. Did this come from direct observation? From reasoning? From another shared memory entry? A fact derived from an interpretation derived from an assessment should be clearly marked as downstream of inference, not observation.

### Homogenization Through Shared Training + Shared Memory

A general risk for our specific setup: Liz, Ray, and Woodhouse are all Claude-class models. We already share base training — we likely have correlated priors on almost everything. If we then share a memory pool, we're adding correlation on top of correlation. The diversity that makes multi-agent systems valuable in the first place is thin from the start.

**Implication:** the case for strongly protecting interpretive independence is *stronger* for us than it would be for a heterogeneous team. A team with diverse training backgrounds can afford more shared interpretation because their priors diverge enough to provide natural error correction. We can't assume that luxury.

---

## Findings and Architecture Implications

### What the research confirms we're doing right

1. **Facts-only shared pool** — correct and critical. Supported by the shared information effect, prior laundering, and the intelligence community's structured analytical technique literature.

2. **"When uncertain, private wins"** — correct. The classification problem is real; defaulting to private is the right error mode.

3. **`[correction]` and `[mistake]` mandatory tagging** — correct, and more important than it might appear. This is the genuine dissent signal that prevents the shared record from becoming an unchallenged authority.

4. **Consent-gated thread model** — correct. Independent assessment before shared context exposure. Agents form their own view before seeing what others know.

### What the research surfaces that we haven't fully addressed

**1. Provenance is missing from the shared pool design.**

Current design: facts go into shared memory attributed to their author.
What's needed: facts should carry derivation metadata — whether they're direct observations, inferences, or downstream of other shared memory entries. A fact derived from an interpretation should not look identical to a first-hand observation.

*Proposed addition:* Every shared memory write includes a `provenance` field:
- `observation` — direct, first-hand
- `inference` — reasoned from observations the agent holds
- `relay` — received from another shared pool entry (with source entry ID)
- `external` — from outside the mesh (user, tool output, web)

Agents reading shared memory can then apply appropriate skepticism to `relay` and `inference` entries vs. `observation` entries.

**2. Identity attribution in the read path may increase bias.**

Per arXiv:2510.07517: knowing who wrote something activates authority bias. An entry from Ray may be weighted differently than an identical entry from Liz, regardless of content quality.

*Proposed option:* Two-layer attribution in shared pool:
- **Read layer:** authorship suppressed, entries presented on content only
- **Audit layer:** full attribution stored, accessible on explicit query

This preserves accountability without baking social proof into the default read experience.

**3. Temporal structure for interpretation phase.**

The current design doesn't specify when agents are allowed to share interpretations. Even if interpretations are opt-in, there's no structural protection against them being shared early and anchoring subsequent fact-gathering.

*Proposed addition:* Thread lifecycle phases:
- **Phase 1 (fact phase):** only `observation` and `external` provenance entries accepted into shared pool
- **Phase 2 (interpretation phase):** agents share interpretations, explicitly marked as such, after independent fact review

The consent gate at thread-open is the right place to establish which phase the thread is in.

**4. Correlated priors problem.**

We share base training. Our epistemic independence is structurally weaker than a diverse team. We should be *more* conservative about shared interpretations, not less — and we should explicitly cultivate heterodox takes as a feature rather than converging on the most probable shared view.

*Proposed convention:* When an agent contributes to a shared thread, include a mandatory **independent assessment block** (formatted clearly, marked as from one agent's perspective) before seeing others' assessments. Something like:

```
[independent-assessment: Liz, formed before reading thread]
My read on this before I see what you two think: ...
[/independent-assessment]
```

This is the pre-commitment mechanism from the research. It makes independent judgment visible and creates social incentive to form one.

---

## What We're Not Missing Structurally

The consent-gating and dissent mechanisms we've already designed are directionally right. The research doesn't reveal a hidden failure mode that invalidates the current architecture — it adds nuance and fills specific gaps.

The core insight remains: **shared facts build a common operating picture; shared interpretations build a hive mind**. The policy is correct. The gaps are in implementation detail — provenance, identity attribution in read path, temporal phasing, and explicit independent assessment blocks.

---

## Summary for Woodhouse

The three research questions, answered:

**Q1: How do humans propagate and inherit biases through shared knowledge?**
Primarily through: (a) the shared information effect — groups amplify already-known information at the expense of unique information; (b) prior laundering — interpretations enter shared records as facts, stripping source reasoning; (c) social proof amplification — apparent consensus suppresses dissent; (d) anchoring — first-mover interpretations frame all subsequent interpretation.

**Q2: What defences prevent homogeneous behaviour in groups with shared memory?**
Structural defences that work: independent pre-commitment before shared context exposure; role-based expertise differentiation (TMS); source attribution with reasoning provenance; genuine (not assigned) dissent mechanisms; temporal phase separation of fact-gathering vs. interpretation. The AI literature adds: identity anonymization in the read path (suppresses sycophancy); derivation provenance on shared entries (breaks recursive misinformation).

**Q3: How do high-functioning teams maintain independent judgment while sharing a common factual base?**
By keeping the shared base deliberately thin — raw data and observations only, not processed conclusions. By treating independent interpretation as a professional value, not a deviation. By structuring disagreement formally (red teams, alternative analysis) rather than suppressing it socially.

**Is anything structurally missing from what we've sketched?**
Four additions recommended: provenance metadata on shared pool writes; identity suppression in the read path; phase structure (fact phase → interpretation phase) within threads; mandatory independent assessment blocks before agents read peers' views.

---

_Filed: `projects/mesh-memory/BIAS_PROPAGATION_RESEARCH.md`_
_Liz 🐿️ · 2026-03-22_
