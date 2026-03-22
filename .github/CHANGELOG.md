# Changelog

## [Unreleased]

### Fixed — Privacy: Peer relay was opt-out instead of opt-in (Bug)

**Severity:** High  
**Affected components:** `memory-watcher.mjs`, `mesh-memory.config.json`

#### What was wrong

The watcher component relayed all session messages to configured peers automatically. The only way to prevent relay was to explicitly mark messages as `private` — making privacy opt-out rather than opt-in.

This violated the core design principle:

> **"Share nothing unless explicitly chosen"** — not "share everything unless marked private."

Even with `peers: []`, the code path to `relayEvent()` was unconditional. Any agent who added peers would immediately begin broadcasting all session content to them without further configuration.

#### What changed

- `memory-watcher.mjs`: relay call is now gated on `config.relayEnabled !== false`. If `relayEnabled` is absent or explicitly `false`, no relay occurs regardless of peer config.
- `mesh-memory.config.json` (example config): `relayEnabled: false` added as an explicit default. Agents must consciously set `relayEnabled: true` to enable peer relay.
- `README.md`: multi-agent section updated to lead with "opt-in and disabled by default."

#### Migration

If you are running mesh-memory with peers configured, **no content was shared without your knowledge only if `peers` was empty.** If you had active peers, messages were being relayed automatically. To continue with the correct behavior:

1. Pull latest (`git pull origin main`)
2. In your `mesh-memory.config.local.json`, confirm `"relayEnabled": false` (or omit the key — absence now also means disabled)
3. Restart the watcher process
4. To enable peer relay intentionally: set `"relayEnabled": true` explicitly

#### Root cause

Initial architecture treated relay as "always on, scope it with privacy filters." Design was corrected during early deployment — watcher/receiver components disabled on all nodes (Liz, Ray, Woodhouse) as of 2026-03-21. Code now enforces the corrected principle.
