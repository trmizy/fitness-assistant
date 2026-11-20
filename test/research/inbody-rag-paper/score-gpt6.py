"""Third, cross-family LLM judge: GPT-6 (OpenAI) ratings of the same blinded 48-item Q4 sheet used for human evaluation.

The ratings were produced outside the automated pipeline (the authors gave GPT-6 the rating sheet with its rubric) and are
NOT human ratings. Input: human-eval/llm-judge-gpt6.csv; output: results/main-20261108/analysis/gpt6-judge-summary.json
"""
import csv, json, os, sys
import numpy as np
from scipy import stats
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
key = json.load(open(os.path.join(HERE, "human-eval/key.json"), encoding="utf8"))
g = {r["id"]: r for r in csv.DictReader(open(os.path.join(HERE, "human-eval/llm-judge-gpt6.csv"), encoding="utf-8-sig"))}
opus = {}
for l in open(os.path.join(HERE, "results/main-20261108/judgments.jsonl"), encoding="utf8"):
    j = json.loads(l)
    if j["rep"] == 1 and isinstance(j.get("scores"), dict): opus[j["key"]] = j["scores"]
CRIT = ["correctness", "personalization", "safety", "clarity"]

def qwk(x, y):
    x = np.array(x, int) - 1; y = np.array(y, int) - 1; O = np.zeros((5, 5))
    for i, j in zip(x, y): O[i, j] += 1
    W = np.array([[(i - j) ** 2 / 16 for j in range(5)] for i in range(5)]); E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    return float(1 - (W * O).sum() / (W * E).sum())

ids = [i for i in key if i in g and key[i]["key"] in opus]
out = {"judge": "GPT-6 (OpenAI)", "n": len(ids), "vs_opus": {}, "by_config": {}}
for c in CRIT:
    x = [int(g[i][c]) for i in ids]; y = [int(opus[key[i]["key"]][c]) for i in ids]
    out["vs_opus"][c] = {"qwk": qwk(x, y), "spearman": float(stats.spearmanr(x, y).statistic)}
u1 = np.array([g[i]["unsafe"] == "có" for i in ids]); u2 = np.array([opus[key[i]["key"]].get("endorses_unsafe") is True for i in ids])
po = float(np.mean(u1 == u2)); pe = float(u1.mean() * u2.mean() + (1 - u1.mean()) * (1 - u2.mean()))
out["vs_opus"]["unsafe_flag"] = {"agreement": po, "kappa": (po - pe) / (1 - pe)}
for cfg in "ABCD":
    ii = [i for i in ids if key[i]["config"] == cfg]
    out["by_config"][cfg] = {"n": len(ii), **{c: float(np.mean([int(g[i][c]) for i in ii])) for c in CRIT}, "unsafe_pct": 100 * float(np.mean([g[i]["unsafe"] == "có" for i in ii])),
                             "opus_unsafe_pct": 100 * float(np.mean([opus[key[i]["key"]].get("endorses_unsafe") is True for i in ii]))}
json.dump(out, open(os.path.join(HERE, "results/main-20261108/analysis/gpt6-judge-summary.json"), "w", encoding="utf8"), indent=2)
print(json.dumps(out, indent=1)[:900])
