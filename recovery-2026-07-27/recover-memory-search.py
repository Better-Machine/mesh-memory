#!/usr/bin/env python3
"""
recover_memory_search.py — salvage text content from corrupted main.sqlite.

Strategy: B-tree table pages (type 0x0d leaf, 0x0a interior) hold the actual `chunks.text`
content in their cells. SQLite corruption has broken the B-tree links but the cell data
is still on the pages. We scan every page for text runs >= 30 chars, dedupe by hash,
write to JSONL.

Read-only against main.sqlite.
"""
import os, re, json, hashlib
from datetime import datetime

DB = "/home/erik-ross/.openclaw/memory/main.sqlite"
OUT = "/home/erik-ross/.openclaw/workspace/projects/mesh-memory/recovered-chunks.jsonl"

# Match long ASCII text runs (lowercase init, lowercase/punct end).
ENGLISH_RUN = re.compile(rb"[a-z][a-z'\-\s,;:.!?]{30,500}?[a-z\.\!\?]\s")

# Reject pure vector blobs: long sequence of comma-separated floats.
VECTOR_BLOB = re.compile(rb"^[-+]?\d+\.?\d+(?:,\s*[-+]?\d+\.?\d*){50,}\s*$")

PAGE_SIZE = 4096

def main():
    size = os.path.getsize(DB)
    n_pages = size // PAGE_SIZE
    started = datetime.now()
    print(f"[recover] DB={DB} pages={n_pages} size={size/1e9:.2f}GB")

    seen = set()
    recovered = 0
    skipped_vector = 0

    with open(DB, "rb") as fin, open(OUT, "wb") as fout:
        for page_no in range(n_pages):
            if page_no < 2:
                continue
            fin.seek(page_no * PAGE_SIZE)
            page = fin.read(PAGE_SIZE)
            # Only B-tree table pages have user data
            if page[0] not in (0x0d, 0x0a):
                continue
            for m in ENGLISH_RUN.finditer(page):
                frag = m.group(0)
                if VECTOR_BLOB.match(frag):
                    skipped_vector += 1
                    continue
                text = frag.decode("utf-8", errors="replace").strip()
                if len(text) < 30:
                    continue
                # normalize whitespace
                text_norm = re.sub(r"\s+", " ", text).strip()
                if len(text_norm) < 30:
                    continue
                h = hashlib.blake2b(text_norm.encode("utf-8"), digest_size=16).hexdigest()
                if h in seen:
                    continue
                seen.add(h)
                obj = {
                    "page": page_no,
                    "hash": h,
                    "text": text_norm[:500],
                    "len": len(text_norm),
                }
                fout.write((json.dumps(obj) + "\n").encode())
                recovered += 1
            if page_no and page_no % 50000 == 0:
                elapsed = (datetime.now() - started).total_seconds()
                pct = page_no / n_pages * 100
                print(f"[recover] {page_no:,}/{n_pages:,} pages ({pct:.1f}%) recovered={recovered} elapsed={elapsed:.1f}s")

    elapsed = (datetime.now() - started).total_seconds()
    print(f"[recover] DONE recovered={recovered} skipped_vec={skipped_vector} elapsed={elapsed:.1f}s")
    print(f"[recover] output: {OUT}")

if __name__ == "__main__":
    main()
