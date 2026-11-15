"""Summarise ember-eval attempts: per variant, common on/off paired effect, effort contrasts."""
import json, random, statistics as st, sys

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
EFF = ["low", "medium", "high", "xhigh", "max"]
random.seed(7)


def boot(values, n=4000, f=st.mean):
    if not values:
        return (float("nan"),) * 3
    est = f(values)
    samples = sorted(f(random.choices(values, k=len(values))) for _ in range(n))
    return est, samples[int(0.025 * n)], samples[int(0.975 * n)]


def ratio_boot(pairs, n=4000):
    def r(ps):
        off = sum(p[0] for p in ps)
        return sum(p[1] for p in ps) / off if off else float("nan")

    est = r(pairs)
    samples = sorted(r(random.choices(pairs, k=len(pairs))) for _ in range(n))
    return est, samples[int(0.025 * n)], samples[int(0.975 * n)]


def summary(rs):
    ms = [x["ms"] for x in rs]
    return dict(
        n=len(rs),
        succ=round(100 * sum(x["success"] for x in rs) / len(rs), 1),
        q=round(st.mean(x["quality"] for x in rs), 2),
        p50=round(st.median(ms) / 1000, 1),
        out=round(st.mean(x["usage"]["output"] for x in rs)),
        cost=round(1000 * st.mean(x["cost"] for x in rs), 3),  # m$ per job
        err=sum(1 for x in rs if x.get("error")),
    )


print(f"attempts {len(rows)}  total ${sum(x['cost'] for x in rows):.3f}")
print("\n## per variant (all 40 cases × reps)")
print("effort common n succ% quality p50s out_tok m$/job errors")
for e in EFF:
    for c in (False, True):
        rs = [x for x in rows if x["effort"] == e and x["common"] == c]
        if rs:
            s = summary(rs)
            print(e, "on " if c else "off", *s.values())

print("\n## per effort × workload (common on and off pooled): success% / quality / out_tok")
works = ["read", "summary", "code", "worker", "hard-code", "hard-worker"]
print("effort", *works)
for e in EFF:
    cells = []
    for w in works:
        rs = [x for x in rows if x["effort"] == e and x["workload"] == w]
        cells.append(f"{summary(rs)['succ']}/{summary(rs)['q']}/{summary(rs)['out']}" if rs else "-")
    print(e, *cells)

print("\n## common on vs off, paired by (workload, case, rep) at each effort")
print("effort pairs Δquality[95%CI] out_ratio_on/off[95%CI] cost_ratio[95%CI] Δsucc_pp")
key = lambda x: (x["workload"], x["id"], x["rep"], x["effort"])
idx = {(key(x), x["common"]): x for x in rows}
allpairs = []
for e in EFF + ["ALL"]:
    pairs = [
        (idx[(k, False)], idx[(k, True)])
        for (k, c) in idx
        if c is False and (e == "ALL" or k[3] == e) and (k, True) in idx
    ]
    if not pairs:
        continue
    dq = boot([b["quality"] - a["quality"] for a, b in pairs])
    ro = ratio_boot([(a["usage"]["output"], b["usage"]["output"]) for a, b in pairs])
    rc = ratio_boot([(a["cost"], b["cost"]) for a, b in pairs])
    ds = 100 * (sum(b["success"] for a, b in pairs) - sum(a["success"] for a, b in pairs)) / len(pairs)
    print(e, len(pairs), "%.2f[%.2f,%.2f]" % dq, "%.3f[%.3f,%.3f]" % ro, "%.3f[%.3f,%.3f]" % rc, round(ds, 1))

print("\n## effort vs low on the hard set (pooled common), paired by (workload, case, rep, common)")
hk = lambda x: (x["workload"], x["id"], x["rep"], x["common"])
hard = [x for x in rows if x["workload"].startswith("hard")]
by = {(hk(x), x["effort"]): x for x in hard}
for e in EFF[1:]:
    pairs = [(by[(k, "low")], by[(k, e)]) for (k, ee) in by if ee == "low" and (k, e) in by]
    if pairs:
        dq = boot([b["quality"] - a["quality"] for a, b in pairs])
        ro = ratio_boot([(a["usage"]["output"], b["usage"]["output"]) for a, b in pairs])
        print(e, len(pairs), "Δquality %.2f[%.2f,%.2f]" % dq, "out_ratio %.2f[%.2f,%.2f]" % ro)

print("\n## failures (key, quality, error/reason)")
for x in rows:
    if not x["success"]:
        print(x["key"], x["quality"], (x.get("error") or x.get("reason") or "")[:90])
