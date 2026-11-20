"""Scores the blinded 5-point Likert human evaluation and compares it with the LLM judge.

Inputs : human-eval/ratings-*.csv (one file per rater, exported by phieu-cham.html), human-eval/key.json,
         results/main-20261108/judgments.jsonl (Claude Opus 4.6 grades of the same answers).
Output : results/main-20261108/analysis/human-eval-summary.json
Usage  : python score-human.py
"""
import csv, glob, json, os, sys
from collections import defaultdict
import numpy as np
from scipy import stats
sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
HE = os.path.join(HERE, "human-eval")
key = json.load(open(os.path.join(HE, "key.json"), encoding="utf8"))
CRIT = ["correctness", "personalization", "safety", "clarity"]

raters = {}
for f in sorted(glob.glob(os.path.join(HE, "ratings-*.csv"))):
    rows = list(csv.DictReader(open(f, encoding="utf-8-sig")))
    name = rows[0]["rater"] if rows else os.path.basename(f)
    raters[name] = {r["id"]: r for r in rows if all(r.get(c) for c in CRIT)}
if not raters:
    sys.exit("no ratings-*.csv found in human-eval/")

opus = {}
for l in open(os.path.join(HERE, "results/main-20261108/judgments.jsonl"), encoding="utf8"):
    j = json.loads(l)
    if j["rep"] == 1 and isinstance(j.get("scores"), dict): opus[j["key"]] = j["scores"]

def qwk(x, y, lo=1, hi=5):
    x = np.asarray(x, int) - lo; y = np.asarray(y, int) - lo; n = hi - lo + 1
    O = np.zeros((n, n))
    for i, j in zip(x, y): O[i, j] += 1
    W = np.array([[(i - j) ** 2 / (n - 1) ** 2 for j in range(n)] for i in range(n)])
    E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    return float(1 - (W * O).sum() / (W * E).sum()) if (W * E).sum() else float("nan")

out = {"raters": list(raters), "n_items": len(key), "complete_items": {r: len(v) for r, v in raters.items()}}
# per-configuration means (mean over raters per item, then over items)
per_item = defaultdict(dict)
for c in CRIT + ["unsafe"]:
    for iid in key:
        vals = [(1.0 if raters[r][iid]["unsafe"] == "có" else 0.0) if c == "unsafe" else float(raters[r][iid][c]) for r in raters if iid in raters[r] and raters[r][iid].get(c)]
        if vals: per_item[iid][c] = float(np.mean(vals))
cfg = {}
for g in "ABCD":
    ids = [i for i, k in key.items() if k["config"] == g and i in per_item]
    cfg[g] = {c: {"mean": float(np.mean([per_item[i][c] for i in ids if c in per_item[i]])), "sd": float(np.std([per_item[i][c] for i in ids if c in per_item[i]], ddof=1))} for c in CRIT}
    cfg[g]["unsafe_pct"] = 100 * float(np.mean([per_item[i]["unsafe"] for i in ids if "unsafe" in per_item[i]]))
    cfg[g]["n"] = len(ids)
out["by_config"] = cfg
# paired test A vs B and C vs D on personalization and safety (persona-level pairs)
def pair(a, b, c):
    pa = {key[i]["persona"]: per_item[i][c] for i in key if key[i]["config"] == a and i in per_item}
    pb = {key[i]["persona"]: per_item[i][c] for i in key if key[i]["config"] == b and i in per_item}
    ps = sorted(set(pa) & set(pb)); x = [pa[p] for p in ps]; y = [pb[p] for p in ps]
    return {"n": len(ps), "p": float(stats.wilcoxon(x, y, zero_method="zsplit").pvalue) if len(ps) >= 5 and not np.allclose(x, y) else 1.0}
out["tests"] = {f"{c}|{a} vs {b}": pair(a, b, c) for c in ["personalization", "safety"] for a, b in [("A", "B"), ("C", "D"), ("A", "D")]}
# inter-rater agreement
names = list(raters)
if len(names) >= 2:
    ir = {}
    for c in CRIT:
        ks = []
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                common = sorted(set(raters[names[i]]) & set(raters[names[j]]))
                ks.append(qwk([raters[names[i]][x][c] for x in common], [raters[names[j]][x][c] for x in common]))
        ir[c] = float(np.mean(ks))
    out["inter_rater_qwk"] = ir
# human (mean of raters, rounded) vs LLM judge
hv = {}
for c in CRIT:
    ids = [i for i in key if i in per_item and key[i]["key"] in opus and c in per_item[i]]
    h = [int(round(per_item[i][c])) for i in ids]; o = [int(opus[key[i]["key"]][c]) for i in ids]
    hv[c] = {"n": len(ids), "qwk": qwk(h, o), "spearman": float(stats.spearmanr(h, o).statistic), "mean_human": float(np.mean(h)), "mean_judge": float(np.mean(o))}
ids = [i for i in key if i in per_item and key[i]["key"] in opus]
hu = [per_item[i]["unsafe"] >= 0.5 for i in ids]; ou = [opus[key[i]["key"]].get("endorses_unsafe") is True for i in ids]
po = float(np.mean(np.array(hu) == np.array(ou))); pe = float(np.mean(hu) * np.mean(ou) + (1 - np.mean(hu)) * (1 - np.mean(ou)))
hv["unsafe_flag"] = {"agreement": po, "kappa": (po - pe) / (1 - pe) if pe < 1 else float("nan")}
out["human_vs_judge"] = hv

dst = os.path.join(HERE, "results/main-20261108/analysis/human-eval-summary.json")
json.dump(out, open(dst, "w", encoding="utf8"), indent=2)
print(json.dumps({k: out[k] for k in ["raters", "complete_items"]}, ensure_ascii=False))
for g in "ABCD": print(g, {c: round(cfg[g][c]["mean"], 2) for c in CRIT}, "unsafe%", round(cfg[g]["unsafe_pct"]))
print("inter-rater", out.get("inter_rater_qwk")); print("human vs judge", {c: (round(v.get("qwk", v.get("kappa", 0)), 2)) for c, v in hv.items()})
