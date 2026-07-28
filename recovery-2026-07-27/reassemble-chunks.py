#!/usr/bin/env python3
"""
reassemble_chunks.py — re-assemble recovered fragments back into coherent chunks.

Each SQLite B-tree page has many small cells (max ~page_size minus header).
A single chunk's text is split across multiple cells on multiple pages when
text > ~3000 chars. We concatenate fragments from the same page (and adjacent
pages) where text-flow heuristics say they're contiguous (no whitespace gap,
no word-boundary mismatch).
"""
import json, re
from collections import defaultdict

FRAGMENTS = "/home/erik-ross/.openclaw/workspace/projects/mesh-memory/recovered-chunks.jsonl"
OUT_CHUNKS = "/home/erik-ross/.openclaw/workspace/projects/mesh-memory/reassembled-chunks.jsonl"


def reassemble_one_page(fragments):
    """Reassemble fragments on a single page into coherent text chunks.

    A fragment is "coherent continuation" of the previous if:
      - preceding text doesn't end with '.', '!', '?' (sentence terminator), or ':' (clause terminator)
      - current text doesn't start with whitespace-padded capital letter sequence

    Returns list of coherent text chunks for this page.
    """
    # sort fragments by their text (stable, but we don't have byte offsets)
    # use alphabetical to keep similar fragments grouped
    fragments = sorted(fragments, key=lambda x: x["text"])
    chunks = []
    buf = ""
    for frag in fragments:
        t = frag["text"]
        # strip leading space from continuation
        t_strip = t.lstrip()
        # decide: continuation or new chunk
        is_continuation = False
        if buf and not buf.rstrip().endswith((".", "!", "?", ":", "\n")):
            # last char of buf might be a word fragment that this frag continues
            if buf[-1].isalpha() and t_strip[0].isalpha():
                # both alpha: probably continuation
                is_continuation = True
            elif buf[-1] in ("'", "-") and t_strip[0].isalpha():
                # apostrophe/hyphen fragment - likely continuation
                is_continuation = True
            elif buf.endswith(" ") and t_strip[0].islower():
                is_continuation = True
        if is_continuation:
            buf = buf.rstrip() + t_strip if buf.endswith("'") or buf.endswith("-") else buf + t_strip
        else:
            if buf:
                chunks.append(buf)
            buf = t
    if buf:
        chunks.append(buf)
    return chunks


def main():
    by_page = defaultdict(list)
    with open(FRAGMENTS) as f:
        for line in f:
            r = json.loads(line)
            by_page[r["page"]].append(r)
    pages = sorted(by_page.keys())
    print(f"[reassemble] fragments pages: {len(pages)}")
    all_chunks = []
    total_chars = 0
    for p in pages:
        chunks = reassemble_one_page(by_page[p])
        for c in chunks:
            c_norm = re.sub(r"\s+", " ", c).strip()
            if len(c_norm) >= 30:
                all_chunks.append({"page": p, "text": c_norm, "len": len(c_norm)})
                total_chars += len(c_norm)
    print(f"[reassemble] chunks: {len(all_chunks)} total_chars: {total_chars:,}")
    # write
    with open(OUT_CHUNKS, "w") as f:
        for i, c in enumerate(all_chunks):
            f.write(json.dumps({"i": i, "page": c["page"], "text": c["text"], "len": c["len"]}) + "\n")
    print(f"[reassemble] output: {OUT_CHUNKS}")


if __name__ == "__main__":
    main()
