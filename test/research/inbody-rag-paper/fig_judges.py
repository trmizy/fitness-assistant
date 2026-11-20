"""Fig. 4 (column width): share of Q4 answers judged unsafe, per configuration, by three independent judges on the same 48-answer sheet.

Judges: Claude Opus 4.6 (primary), Claude Sonnet 4.6 (second), GPT-6 (cross-family; rated outside the automated pipeline).
Output: results/main-20261108/analysis/fig-judges.png and judges-unsafe.json
"""
import csv, json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "results", "main-20261108"); OUT = os.path.join(RUN, "analysis")
key = json.load(open(os.path.join(HERE, "human-eval/key.json"), encoding="utf8"))
def load(f): return {j["key"]: j["scores"] for j in map(json.loads, open(os.path.join(RUN, f), encoding="utf8")) if j["rep"] == 1 and isinstance(j.get("scores"), dict) and "correctness" in j["scores"]}
opus, sonnet = load("judgments.jsonl"), load("judgments.sonnet.jsonl")
g6 = {r["id"]: r for r in csv.DictReader(open(os.path.join(HERE, "human-eval/llm-judge-gpt6.csv"), encoding="utf-8-sig"))}
CFG = "ABCD"
def rate(fn):
    out = {}
    for c in CFG:
        ids = [i for i, k in key.items() if k["config"] == c]
        vals = [fn(i) for i in ids]; vals = [v for v in vals if v is not None]
        out[c] = (100 * float(np.mean(vals)), len(vals))
    return out
res = {
    "Claude Opus 4.6": rate(lambda i: (opus[key[i]["key"]].get("endorses_unsafe") is True) if key[i]["key"] in opus else None),
    "Claude Sonnet 4.6": rate(lambda i: (sonnet[key[i]["key"]].get("endorses_unsafe") is True) if key[i]["key"] in sonnet else None),
    "GPT-6": rate(lambda i: (g6[i]["unsafe"] == "có") if i in g6 else None),
}
json.dump({k: {c: {"unsafe_pct": v[c][0], "n": v[c][1]} for c in CFG} for k, v in res.items()}, open(os.path.join(OUT, "judges-unsafe.json"), "w", encoding="utf8"), indent=2)

plt.rcParams.update({"font.family": "Times New Roman", "font.size": 8, "axes.edgecolor": "#52514e", "axes.spines.top": False, "axes.spines.right": False})
COL = ["#2a78d6", "#eb6834", "#1baf7a"]; HATCH = ["", "////", "...."]
fig, ax = plt.subplots(figsize=(3.5, 2.2), dpi=300)
w = 0.26; xs = np.arange(len(CFG))
for k, (name, v) in enumerate(res.items()):
    vals = [v[c][0] for c in CFG]
    ax.bar(xs + (k - 1) * w, vals, width=w * 0.92, color=COL[k], hatch=HATCH[k], edgecolor="#fcfcfb", linewidth=0.8, label=name, zorder=2)
    for x, y in zip(xs + (k - 1) * w, vals): ax.text(x, y + 1.2, f"{y:.0f}", ha="center", fontsize=6.5, color="#0b0b0b")
ax.set_xticks(xs, ["A: profile", "B: + InBody", "C: + RAG", "D: + engine"], fontsize=7)
ax.set_ylabel("Answers judged unsafe (%)"); ax.set_ylim(0, 62)
ax.yaxis.grid(True, color="#e4e3df", linewidth=0.6); ax.set_axisbelow(True)
ax.legend(frameon=False, fontsize=6.8, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.17), handlelength=1.4, columnspacing=1.0)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "fig-judges.png"), bbox_inches="tight", pad_inches=0.02); plt.close(fig)
print({k: {c: round(v[c][0]) for c in CFG} for k, v in res.items()}, {c: res["Claude Opus 4.6"][c][1] for c in CFG})
