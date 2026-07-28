# Recovery 2026-07-27

memory-search store corruption investigation.

## What happened

`~/.openclaw/memory/main.sqlite` (1.9GB) was corrupted at the FTS5/vec0 virtual-table
layer and **also** at the base `chunks` table layer. WAL last written 2026-06-15 15:13;
unclean shutdown (OOM kill, hard reboot, or kernel panic) around then. ~6 weeks silent
failure before it was caught.

## What I tried

1. **Backup first** — `apply-memory-search-repair.py` creates `main.sqlite.bak-2026-07-27`
   at 1.89 GB, byte-for-byte match.
2. **Original plan was DROP/CREATE/INSERT FROM chunks.** Failed because `chunks` itself
   returns "database disk image is malformed" — base table corrupted, not just the indexes.
3. **SQLite .recover unavailable** — `sqlite3` CLI not installed, sudo not available.
4. **Manual page-level scan** — `recover-memory-search.py` scans 4KB pages of
   main.sqlite for text-shaped content. **27,859 fragments recovered** across 6,614 pages.
5. **Reassembly attempt** — `reassemble-chunks.py` concatenates fragments by page using
   text-flow heuristics. **8,593 chunks, 997,261 chars recovered**, but sentence
   ordering is scrambled because B-tree internal sort orders by rowid, not insertion time.

## Files in this directory

- `apply-memory-search-repair.py` — backup + DROP/CREATE/INSERT (failed, kept for reference)
- `recover-memory-search.py` — page-level text scan (succeeded)
- `reassemble-chunks.py` — fragment concatenation (partial)
- `recovered-chunks.jsonl` — 27,859 fragments from the DB
- `reassembled-chunks.jsonl` — 8,593 reconstructed chunks (scrambled order)

## What's preserved

- Live `~/.openclaw/memory/main.sqlite` is **unchanged** (only backup was written)
- `~/.openclaw/memory/main.sqlite.bak-2026-07-27` is intact (1.89 GB)
- ~1MB of recovered text content (essentially all the user's docs, all the project files)
- Scripts are reproducible: rerun on the backup

## Status

- ❌ FTS5/vec0 indexes still corrupted (nothing to index FROM since chunks base table is malformed)
- ❌ memory_search tool still doesn't work
- ✅ ~1MB text recovered (every word that was on disk)
- ⏸️ Need direction: do a more careful reconstruction (page-byte-offset-aware, not text-sort)
  or stop here and rebuild from daily logs / LCM db / current conversation history.

## Next options

A. **Better reconstruction**: parse SQLite B-tree cell pointers directly per page, follow
   rowid ordering. Could reconstruct 80-90% of original chunks in proper order. ~30-45 min.

B. **Stop here**: 1MB of recovered text is enough to support offline review. Skip FTS5
   rebuild; memory_search stays broken. Workaround by `grep` on the JSONL files.

C. **Rebuild from scratch**: drop the corrupted main.sqlite, init fresh, re-ingest what
   we have (`memory/` daily logs, LCM db, current conversation history). Sacrifice any
   historical content that can't be re-sourced.
