# mesh-memory — Deploy runbook
**Read this before every deploy, merge to the default branch, rollback or environment change. Do not deploy from memory.** Last verified: never — draft 2026-11-17.

## How it actually works (one line)
Merge to `main` triggers GitHub Actions `ci.yml` for tests, then deploys via systemd user units (`mesh-memory.service`, `mesh-memory-receiver.service`, `mesh-memory-bridge.service`, `mesh-memory-watcher.service`) all running `mesh-memory.mjs`.

## Who merges / approves
Erik decides; Woodhouse may merge after approval. Sub-agents never merge or push to the default branch.

## Steps
1. Branch from `main`, make changes
2. Tests: GitHub Actions `ci.yml` runs on push/PR — verify tests pass
3. PR: base `main`
4. Merge/deploy: Deploy via systemd user units on the host. Units: `mesh-memory.service`, `mesh-memory-receiver.service`, `mesh-memory-bridge.service`, `mesh-memory-watcher.service`. All run `mesh-memory.mjs`. After merge, deploy to host and restart units.
5. Verify: Check systemd unit status (`systemctl --user status mesh-memory*`) and service health endpoints

## Rollback
Revert the merge commit: `git revert HEAD && git push origin main`
Then restart affected units on the host: `systemctl --user restart mesh-memory*`

## Environment / secrets
Systemd user-level services. Secrets managed via environment files for each unit. Node.js application running `mesh-memory.mjs`.

## Data / migrations
N/A — data persistence handled by the application layer.
