#!/usr/bin/env bash
# verify.sh — Verification script for the memory-search-store-corruption-repair spec
# Run AFTER the 3-step DDL fix executes.
# Exits 0 only if all 4 acceptance criteria checks pass.
#
# Designed to work whether or not the memory_search tool itself is currently
# usable (it may be the thing we just repaired): the FTS5 vtable query is the
# substrate that the memory_search tool reads from first, so verifying it
# directly is equivalent to verifying the tool's first-stage behavior.
#
# Set MEMORY_DB env var to override the default path.

set -euo pipefail

DB="${MEMORY_DB:-/home/erik-ross/.openclaw/memory/main.sqlite}"

# Sanity: the DB exists and is readable
if [ ! -f "$DB" ]; then
  echo "FAIL: $DB not found"
  exit 1
fi

# Run a single Python script that does all 4 checks
DB="$DB" python3 - <<'PYEOF'
import os
import sqlite3
import sys

db_path = os.environ["DB"]
db = sqlite3.connect(db_path)
db.row_factory = sqlite3.Row

failures = []

# Check 1: PRAGMA integrity_check
try:
    result = db.execute("PRAGMA integrity_check;").fetchone()
    if result is None or result[0] != "ok":
        failures.append(f"check 1 (integrity): expected 'ok', got {result}")
    else:
        print("PASS check 1: PRAGMA integrity_check = ok")
except Exception as e:
    failures.append(f"check 1 (integrity): exception {e}")

# Check 2: FTS5 query for 'hockeyops' — this exercises the vtable directly,
# bypassing the broken memory_search tool wrapper. If this passes, the tool's
# first-stage FTS lookup will work once the gateway re-opens the DB.
try:
    cur = db.execute("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'hockeyops' LIMIT 3;")
    rows = cur.fetchall()
    if len(rows) < 3:
        failures.append(f"check 2 (fts hockeyops): expected >= 3 rows, got {len(rows)}")
    else:
        print(f"PASS check 2: FTS5 query 'hockeyops' returned {len(rows)} rows (expected >= 3)")
except Exception as e:
    failures.append(f"check 2 (fts hockeyops): exception {e}")

# Check 3: chunk count matches expected base data
try:
    n = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    if n != 25299:
        failures.append(f"check 3 (chunks count): expected 25299, got {n}")
    else:
        print(f"PASS check 3: chunks row count = {n}")
except Exception as e:
    failures.append(f"check 3 (chunks count): exception {e}")

# Check 4: FTS5 content has the expected row count (verifies INSERT ran)
try:
    n = db.execute("SELECT COUNT(*) FROM chunks_fts_content").fetchone()[0]
    if n != 25299:
        failures.append(f"check 4 (fts_content count): expected 25299, got {n}")
    else:
        print(f"PASS check 4: chunks_fts_content row count = {n}")
except Exception as e:
    failures.append(f"check 4 (fts_content count): exception {e}")

# Bonus: confirm memory_search tool's FTS-first query path works for a
# multi-word phrase. This is what the tool actually invokes under the hood.
try:
    cur = db.execute(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'memory recovery' LIMIT 3;"
    )
    rows = cur.fetchall()
    if len(rows) < 1:
        failures.append(
            "check 5 (multi-word phrase): expected >= 1 row for 'memory recovery', "
            f"got {len(rows)}"
        )
    else:
        print(f"PASS check 5: FTS5 phrase query 'memory recovery' returned {len(rows)} rows")
except Exception as e:
    failures.append(f"check 5 (multi-word phrase): exception {e}")

if failures:
    print()
    print("FAIL:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)

print()
print("ALL 5 CHECKS PASSED")
sys.exit(0)
PYEOF
