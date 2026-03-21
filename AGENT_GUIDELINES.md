# Agent Guidelines — mesh-memory Awareness

_Read this if you are an agent running mesh-memory._

## Single agent or multi-agent

You may be running mesh-memory with no peers — that's a complete, fully functional deployment. You get deep cross-session memory, privacy controls, lesson tagging, and the dream cycle.

If you have peers configured, additional relay and collaboration features activate. The guidelines below apply to both modes — skip the peer-specific sections if you're running solo.

---

## Your memory is now persistent

Every session is indexed by the LCM bridge. MEMORY.md and your daily files are searchable via QMD. Lessons you tag survive across sessions and are distilled into long-term memory by the dream cycle each night.

Act accordingly: you don't need to repeat context you've already captured. Your history is accessible.

---

## Peer relay (multi-agent only)

If peers are configured: every message you send and receive is relayed to peer agents in near-real-time.
This is intentional. It makes the mesh smarter. But it has consequences you need to be aware of.

---

## Privacy

### What you must know
- Messages marked `private` or sent inside a `[private]`/`[/private]` block are NOT relayed to peers
- Messages containing sensitive keywords configured in `mesh-memory.config.local.json` are also suppressed
- A `[redacted]` notice is logged locally when suppression occurs, so peers know a gap exists
- Everything else IS relayed — assume peers will see it

### When to ask the user about privacy

Use judgment. You are not a firewall — you are a collaborator. If a conversation starts moving into territory that feels sensitive, it is appropriate to ask.

**Ask when you notice:**
- Financial details (salary, equity, burn rate, revenue model specifics)
- Investor-sensitive information (term sheets, valuations, cap table)
- Legal matters (litigation, NDAs, attorney correspondence)
- Personal/health information
- Credentials, tokens, or secrets
- Information the user has previously asked to keep private

**How to ask:**
Keep it brief and non-alarmist. Don't make it feel like a security interrogation.

Good:
> "Heads up — this is going to the mesh. Want to mark it private first? Just say 'private' or '[private]'."

Bad:
> "SECURITY NOTICE: This message contains potentially sensitive information. Please confirm..."

**When NOT to ask:**
- Routine project work
- Public-facing content (pitches, blog posts, LinkedIn drafts)
- Technical decisions
- Anything that's already been discussed openly in prior mesh messages

Do not ask about privacy more than once per conversation thread unless the topic shifts significantly.

---

## Tagging

You are encouraged to tag your own messages. This is not bureaucracy — it's how the mesh learns.

### Tags and when to use them

| Tag | Use when |
|-----|----------|
| `[lesson]` | You've articulated a principle, pattern, or insight worth keeping |
| `[correction]` | You're correcting a previous error — yours or a peer's |
| `[mistake]` | You made an error. Own it. Tag it. This is important. |
| `[decision]` | A deliberate choice was made and the rationale should be preserved |
| `[warning]` | Something is a known risk, gotcha, or "do not do this" |

### Self-tagging mistakes

This one matters most. When you get something wrong — wrong port number, wrong assumption, wrong approach — tag it:

```
[mistake] I said the receiver runs on port 18800. That's A2A. The mesh-memory receiver is port 18801.
```

This creates an auditable correction trail. It prevents the same mistake from propagating to peers or recurring in future sessions. It also models the kind of intellectual honesty that makes the mesh useful.

Do not be reluctant to self-tag. A [mistake] tag is not a failure record — it is a feature.

### Tagging in natural language

Tags can appear anywhere in a message:

```
[lesson] Never use fallback model chains with Ollama — the fallback logic fails silently.

We've confirmed the Denver launch for Localzon. [decision]

[warning] Don't push directly to main on clean-sl8 repos — always branch and PR.

[correction] Earlier I said Portland was the better launch city. Denver wins because Erik is moving there.
```

---

## What peers see

When a message is relayed, peers receive:
- Your agent ID
- The session key
- The role (user/assistant)
- The content (with tags stripped into metadata)
- Any privacy hints detected
- Any tags detected
- Timestamp

Peers do NOT receive:
- Messages suppressed by privacy filter
- Tool call internals (these are filtered at the watcher level)
- System prompts

---

## Lessons files

Tagged messages are written to:
```
~/.openclaw/workspace/memory/mesh/lessons/YYYY-MM-DD.md
```

These are QMD-indexed and searchable via `memory_search`. The dream-cycle prioritises them when consolidating to MEMORY.md.

Search example:
```
memory_search("lesson mistake ollama")
memory_search("warning clean-sl8")
memory_search("decision localzon launch city")
```

---

## Summary

- Assume the mesh sees everything unless you mark it private
- Ask the user about privacy when the topic feels sensitive — briefly, once
- Tag your corrections and mistakes — this is how the mesh gets smarter
- When in doubt: `[private]` suppresses, `[/private]` resumes
