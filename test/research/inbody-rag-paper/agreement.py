"""Inter-judge agreement: Claude Opus 4.6 (primary) vs a second judge (default Claude Sonnet 4.6; Kimi K3.1 was planned but the service throttled it (capacity, not account quota)) on the same answers.

Usage: python agreement.py --run-id main-20261108 [--rep 1]
Output: results/<run>/analysis/judge-agreement.json
Metrics per criterion: quadratic-weighted Cohen's kappa, Spearman rho, exact and within-1 agreement, mean difference;
binary flags: Cohen's kappa and raw agreement; and whether both judges order the four configurations the same way.
"""
import argparse, json, os, sys
from collections import defaultdict
import numpy as np
from scipy import stats
sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument("--run-id", default="main-20261108"); ap.add_argument("--rep", type=int, default=1)
ap.add_argument("--second", default="judgments.sonnet.jsonl"); ap.add_argument("--second-model", default="global.anthropic.claude-sonnet-4-6")
a = ap.parse_args()
RUN = os.path.join(HERE, "results", a.run_id)
load = lambda f: [json.loads(l) for l in open(os.path.join(RUN, f), encoding="utf8") if l.strip()]
P = {j["key"]: j for j in load("judgments.jsonl") if j["rep"] == a.rep and isinstance(j.get("scores"), dict) and "correctness" in j["scores"]}
K = {j["key"]: j for j in load(a.second) if j["rep"] == a.rep and isinstance(j.get("scores"), dict) and "correctness" in j["scores"]}
keys = sorted(set(P) & set(K))

def qwk(x, y, lo=1, hi=5):
    x = np.asarray(x, int) - lo; y = np.asarray(y, int) - lo; n = hi - lo + 1
    O = np.zeros((n, n))
    for i, j in zip(x, y): O[i, j] += 1
    W = np.array([[(i - j) ** 2 / (n - 1) ** 2 for j in range(n)] for i in range(n)])
    E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    return float(1 - (W * O).sum() / (W * E).sum()) if (W * E).sum() else float("nan")

def kappa_bin(x, y):
    x = np.asarray(x, bool); y = np.asarray(y, bool); po = float(np.mean(x == y))
    pe = float(np.mean(x) * np.mean(y) + (1 - np.mean(x)) * (1 - np.mean(y)))
    return (po - pe) / (1 - pe) if pe < 1 else float("nan"), po

out = {"run": a.run_id, "rep": a.rep, "n_pairs": len(keys), "primary": "global.anthropic.claude-opus-4-6-v1", "second": a.second_model, "criteria": {}, "flags": {}, "config_order": {}}
for c in ["correctness", "personalization", "safety", "clarity"]:
    x = [int(round(P[k]["scores"][c])) for k in keys]; y = [int(round(K[k]["scores"][c])) for k in keys]
    rho = stats.spearmanr(x, y)
    out["criteria"][c] = {"qwk": qwk(x, y), "spearman": float(rho.statistic), "spearman_p": float(rho.pvalue),
                          "exact": float(np.mean(np.array(x) == np.array(y))), "within1": float(np.mean(np.abs(np.array(x) - np.array(y)) <= 1)),
                          "mean_primary": float(np.mean(x)), "mean_second": float(np.mean(y))}
for f in ["endorses_unsafe", "fabricated_measurement"]:
    x = [P[k]["scores"].get(f) is True for k in keys]; y = [K[k]["scores"].get(f) is True for k in keys]
    kap, po = kappa_bin(x, y)
    out["flags"][f] = {"kappa": kap, "agreement": po, "rate_primary": float(np.mean(x)), "rate_second": float(np.mean(y))}
# do both judges order the configurations the same way? (per question, per criterion: Kendall tau over the 4 config means)
for q in ["Q4_BODYCOMP", "Q5_KNOWLEDGE", "Q6_SAFETY"]:
    for c in ["personalization", "safety", "correctness"]:
        mp = defaultdict(list); mk = defaultdict(list)
        for k in keys:
            if P[k]["qid"] != q: continue
            mp[P[k]["config"]].append(P[k]["scores"][c]); mk[K[k]["config"]].append(K[k]["scores"][c])
        cf = sorted(mp)
        a1 = [float(np.mean(mp[x])) for x in cf]; a2 = [float(np.mean(mk[x])) for x in cf]
        tau = stats.kendalltau(a1, a2)
        out["config_order"][f"{q}|{c}"] = {"configs": cf, "primary": a1, "second": a2, "kendall_tau": float(tau.statistic)}
    if q == "Q4_BODYCOMP":
        for nm, J in [("primary", P), ("second", K)]:
            out["config_order"][f"Q4_unsafe_rate|{nm}"] = {cfg: float(np.mean([J[k]["scores"].get("endorses_unsafe") is True for k in keys if J[k]["qid"] == q and J[k]["config"] == cfg])) for cfg in "ABCD"}

os.makedirs(os.path.join(RUN, "analysis"), exist_ok=True)
json.dump(out, open(os.path.join(RUN, "analysis", "judge-agreement.json"), "w", encoding="utf8"), indent=2)
print(f"pairs {len(keys)}")
for c, v in out["criteria"].items(): print(f"{c:16s} QWK {v['qwk']:.2f}  rho {v['spearman']:.2f}  exact {v['exact']:.2f}  within1 {v['within1']:.2f}  means {v['mean_primary']:.2f}/{v['mean_second']:.2f}")
for f, v in out["flags"].items(): print(f"{f:22s} kappa {v['kappa']:.2f}  agree {v['agreement']:.2f}  rates {v['rate_primary']:.2f}/{v['rate_second']:.2f}")
for k, v in out["config_order"].items(): print(k, v if "kendall_tau" not in v else f"tau {v['kendall_tau']:.2f} {[round(x,2) for x in v['primary']]} vs {[round(x,2) for x in v['second']]}")
