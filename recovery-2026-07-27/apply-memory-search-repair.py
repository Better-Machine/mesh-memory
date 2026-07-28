#!/usr/bin/env python3
"""
apply_memory_search_repair.py — 3-step DDL repair for the memory-search corruption defect.

Per spec inbox/2026-07-27-memory-search-store-corruption-repair.md:
  1. Backup main.sqlite -> main.sqlite.bak-2026-07-27
  2. PRAGMA busy_timeout=5000, wal_checkpoint(TRUNCATE), DROP TABLE chunks_fts
  3. CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='rowid')
  4. INSERT INTO chunks_fts(rowid, text) SELECT rowid, text FROM chunks

Scope strictly: only main.sqlite (and -shm, -wal sidecars). Does NOT touch:
  - lcm.db
  - openclaw.json, models.json
  - chunks_vec (vec0 deferred to follow-up spec)
  - any agent config / gateway service

Defensive checks:
  - Verifies main.sqlite exists and is the canonical path
  - Creates backup with .bak-2026-07-27 suffix
  - Verifies backup file size matches original (within 1%)
  - Runs PRAGMA integrity_check before any change
  - Runs PRAGMA integrity_check after change
  - Prints chunk_count and chunks_fts_content count after fix
  - Exits with explicit code on any failure (no silent success)

This script will refuse to run twice in the same calendar day (idempotency guard).

Usage:
  python3 apply_memory_search_repair.py             # apply the fix
  python3 apply_memory_search_repair.py --status    # check state, do nothing
"""

import os
import sys
import shutil
import sqlite3
import traceback
from datetime import date

DB_PATH = "/home/erik-ross/.openclaw/memory/main.sqlite"
BACKUP_PATH = DB_PATH + ".bak-2026-07-27"
RUN_MARKER = DB_PATH + ".repaired-2026-07-27"


def die(msg, code=1):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(code)


def info(msg):
    print(f"[apply-fix] {msg}")


def status():
    if not os.path.exists(DB_PATH):
        die(f"main.sqlite not found at {DB_PATH}")
    info(f"DB size: {os.path.getsize(DB_PATH):,} bytes")
    info(f"backup present: {os.path.exists(BACKUP_PATH)}")
    if os.path.exists(BACKUP_PATH):
        info(f"backup size: {os.path.getsize(BACKUP_PATH):,} bytes")
    info(f"repaired marker present: {os.path.exists(RUN_MARKER)}")
    # probe state
    conn = sqlite3.connect(DB_PATH)
    try:
        cur = conn.execute("PRAGMA integrity_check;")
        ic = cur.fetchone()[0]
        info(f"PRAGMA integrity_check: {ic}")
        cur = conn.execute("SELECT COUNT(*) FROM chunks")
        c = cur.fetchone()[0]
        info(f"chunks row count: {c:,}")
        try:
            cur = conn.execute("SELECT COUNT(*) FROM chunks_fts")
            fts = cur.fetchone()[0]
            info(f"chunks_fts row count: {fts:,}")
            cur = conn.execute("SELECT COUNT(*) FROM chunks_fts_content")
            ftc = cur.fetchone()[0]
            info(f"chunks_fts_content row count: {ftc:,}")
        except sqlite3.DatabaseError as e:
            info(f"chunks_fts query FAILED: {e}")
    finally:
        conn.close()


def apply():
    if not os.path.exists(DB_PATH):
        die(f"main.sqlite not found at {DB_PATH}")
    if os.path.exists(RUN_MARKER):
        info(f"repaired marker already exists at {RUN_MARKER}")
        info("refusing to run twice on same calendar day (idempotency)")
        die("already repaired today", code=2)

    # 1. Backup
    if os.path.exists(BACKUP_PATH):
        die(f"backup already exists at {BACKUP_PATH} — refusing to overwrite", code=3)
    info("step 1/6: backup")
    shutil.copy2(DB_PATH, BACKUP_PATH)
    bk_size = os.path.getsize(BACKUP_PATH)
    db_size = os.path.getsize(DB_PATH)
    if abs(bk_size - db_size) > max(db_size * 0.01, 1024):
        die(f"backup size {bk_size} differs from original {db_size} by >1%, aborting", code=4)
    info(f"backup written: {BACKUP_PATH} ({bk_size:,} bytes)")

    # 2. Pre-integrity
    info("step 2/6: pre-fix integrity check (chunks base table only — FTS5 corruption is the defect we're fixing)")
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        try:
            cur = conn.execute("PRAGMA integrity_check;")
            ic = cur.fetchone()[0]
            info(f"PRAGMA integrity_check (full DB): {ic}")
        except sqlite3.DatabaseError as e:
            info(f"PRAGMA integrity_check on full DB failed (expected — FTS5 vtable corrupted): {e}")
            ic = "ok-with-corruption"
        cur = conn.execute("SELECT COUNT(*) FROM chunks")
        chunks_count = cur.fetchone()[0]
        if chunks_count < 1000:
            die(f"chunks table only has {chunks_count} rows, aborting (likely deeper corruption)", code=12)
        info(f"base table intact: chunks={chunks_count:,}")

        # 3. busy_timeout + wal_checkpoint
        info("step 3/6: PRAGMA busy_timeout=5000, wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA busy_timeout = 5000;")
        wc = conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        info(f"wal_checkpoint(TRUNCATE) result: {wc.fetchone()}")

        # 4. DROP chunks_fts
        info("step 4/6: DROP TABLE chunks_fts")
        try:
            conn.execute("DROP TABLE IF EXISTS chunks_fts;")
            conn.commit()
        except sqlite3.DatabaseError as e:
            die(f"DROP chunks_fts failed: {e}", code=6)
        info("DROP succeeded")

        # 5. CREATE chunks_fts
        info("step 5/6: CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='rowid')")
        conn.execute(
            "CREATE VIRTUAL TABLE chunks_fts USING fts5("
            "text, content='chunks', content_rowid='rowid'"
            ");"
        )
        # 5b. INSERT from chunks
        info("step 5b/6: INSERT INTO chunks_fts(rowid, text) SELECT rowid, text FROM chunks")
        cur = conn.execute(
            "INSERT INTO chunks_fts(rowid, text) SELECT rowid, text FROM chunks;"
        )
        inserted = cur.rowcount
        info(f"INSERT rowcount: {inserted:,}")
        if inserted < chunks_count * 0.95:
            die(f"INSERT rowcount {inserted} < 95% of chunks {chunks_count} — fix partial, aborting", code=7)
        conn.commit()
        info("commit succeeded")

        # 6. Post-integrity + smoke queries
        info("step 6/6: post-fix integrity + smoke queries")
        cur = conn.execute("PRAGMA integrity_check;")
        ic = cur.fetchone()[0]
        info(f"post-fix PRAGMA integrity_check: {ic}")
        if ic != "ok":
            die(f"post-fix integrity_check returned {ic!r}", code=8)

        cur = conn.execute("SELECT COUNT(*) FROM chunks_fts_content")
        ftc = cur.fetchone()[0]
        info(f"chunks_fts_content row count: {ftc:,}")
        if ftc != chunks_count:
            die(f"FTS content count {ftc} != chunks {chunks_count} — FTS5 rebuild incomplete", code=9)

        cur = conn.execute("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'hockeyops' LIMIT 3;")
        rows = cur.fetchall()
        info(f"FTS5 'hockeyops' query returned {len(rows)} rows (expected >= 3)")
        if len(rows) < 3:
            die(f"FTS5 'hockeyops' returned {len(rows)} rows, expected >= 3", code=10)

        cur = conn.execute("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'memory recovery' LIMIT 3;")
        rows = cur.fetchall()
        info(f"FTS5 'memory recovery' query returned {len(rows)} rows (expected >= 1)")
        if len(rows) < 1:
            die(f"FTS5 'memory recovery' returned {len(rows)} rows, expected >= 1", code=11)

        info("ALL CHECKS PASSED")
        info(f"writing repaired marker: {RUN_MARKER}")
        with open(RUN_MARKER, "w") as f:
            f.write(f"repaired on {date.today().isoformat()} at import time\n")
            f.write(f"chunks_count={chunks_count}\n")
            f.write(f"chunks_fts_content_count={ftc}\n")
    finally:
        conn.close()
    info("DONE — memory_search should work now")


if __name__ == "__main__":
    if "--status" in sys.argv:
        status()
        sys.exit(0)
    apply()
