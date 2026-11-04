#!/usr/bin/env python3
"""jev.py - one typed decision from TypeSafe jev over OpenRouter (stdlib only, importable).

  from jev import decide            # sys.path.insert(0, "~/.local/share/scripts/ai")
  answers, usage = decide(state, {"kind": choice("Which?", {"a": "...", "b": "..."})})
  answers["kind"]["choice"], answers["kind"]["confidence"], answers["kind"]["probabilities"]

  jev.py '{"state": {...}, "questions": {...}}'    CLI: prints the response JSON

jev picks among options you define; it never writes text. Keep options mutually exclusive:
overlapping ones split the vote and read as low confidence.
Every request gets a fresh `nonce` first in state, so repeats are never served from cache.
Each reply's usage is appended to $JEV_LEDGER (JSONL) when that variable is set: the cost record.
Needs OPENROUTER_API_KEY.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

URL = "https://openrouter.ai/api/alpha/decisions"
MODEL = os.environ.get("JEV_MODEL", "~typesafe/jev-latest")


def choice(instructions, criteria):
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


def noul(instructions):
    return {"type": "noul", "instructions": instructions}


def decide(state, questions, tag="", timeout=30, retries=2):
    """Returns (answers, usage). Raises RuntimeError after `retries` failed attempts."""
    key = os.environ.get("OPENROUTER_API_KEY") or sys.exit("jev: OPENROUTER_API_KEY unset")
    body = json.dumps({"model": MODEL, "state": {"nonce": str(uuid.uuid4()), **state}, "questions": questions}).encode()
    err = None
    for attempt in range(retries + 1):
        t0 = time.perf_counter()
        req = urllib.request.Request(URL, body, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                resp = json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            detail = e.read().decode(errors="replace")[:300] if isinstance(e, urllib.error.HTTPError) else ""
            err = f"{e} {detail}".strip()
            if isinstance(e, urllib.error.HTTPError) and e.code == 400:
                break
            time.sleep(0.5 * (attempt + 1))
            continue
        usage = {**resp.get("usage", {}), "seconds": round(time.perf_counter() - t0, 3), "model": resp.get("model")}
        if os.environ.get("JEV_LEDGER"):
            with open(os.environ["JEV_LEDGER"], "a") as f:
                f.write(json.dumps({"t": time.time(), "tag": tag, **usage}) + "\n")
        return resp["answers"], usage
    raise RuntimeError(f"jev request failed: {err}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    req = json.loads(sys.argv[1])
    answers, usage = decide(req.get("state", {}), req["questions"], tag="cli")
    print(json.dumps({"answers": answers, "usage": usage}, ensure_ascii=False, indent=1))
