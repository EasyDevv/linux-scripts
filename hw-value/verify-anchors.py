#!/usr/bin/env python3
"""verify-anchors.py — pre-edit anchor check and post-edit presence gate.

Usage:
  python3 verify-anchors.py <file> <anchors.txt>

anchors.txt: candidate oldText blocks separated by a line containing only ---
Each block must occur EXACTLY ONCE in <file>.
Prints OK / MISS / AMBIG per block with line numbers.
Exit 0 only if every block is OK (safe to batch-edit).
Use the same file post-edit with single-line MUST anchors as a presence gate.

Why: batch file edits fail atomically on one bad anchor; re-guessing anchors
wastes more rounds than one mechanical check. Never re-guess an anchor twice —
on MISS, byte-inspect (xxd) or widen the anchor instead.
"""
import sys

def blocks(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    parts = [b for b in raw.split("\n---\n")]
    return [b.strip("\n") for b in parts if b.strip("\n")]

def lineno(text, pos):
    return text.count("\n", 0, pos) + 1

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    fpath, apath = sys.argv[1], sys.argv[2]
    with open(fpath, encoding="utf-8") as f:
        text = f.read()
    bad = 0
    for i, b in enumerate(blocks(apath), 1):
        occ = []
        start = 0
        while True:
            j = text.find(b, start)
            if j < 0:
                break
            occ.append(lineno(text, j))
            start = j + 1
        if len(occ) == 1:
            print(f"OK    [{i}] line {occ[0]}")
        elif not occ:
            print(f"MISS  [{i}] no match — byte-inspect, do not re-guess")
            bad += 1
        else:
            print(f"AMBIG [{i}] {len(occ)} matches at lines {occ} — widen anchor")
            bad += 1
    print("ALL OK — safe to edit" if not bad else f"{bad} BAD — fix anchors first")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
