"""Statistical analysis + figures for the InBody-grounded RAG ablation and the InBody extraction study.

Usage (scratchpad venv with numpy/scipy/matplotlib):
  python analyze.py --run-id main-20261108 --ocr-run 20261108

Outputs: results/<run-id>/analysis/{metrics.json, tables.md, fig-*.png}
Reference values (independent of the system under test; see DATASET.md and the paper's Methods):
  TDEE_ref = BMR_KM x AF, AF = 1.2 / 1.375 / 1.55 / 1.725 (sedentary .. very active)
  Q2 acceptable target: weight loss 0.75-0.90 x TDEE_ref, muscle gain 1.05-1.15, maintenance 0.95-1.05
  Q3 acceptable protein: 1.4-2.2 g per kg body weight per day
The minor (E05) is excluded from the numeric Q2/Q3 scoring (adult prescription ranges do not apply).
"""
import argparse, json, math, os, sys
sys.stdout.reconfigure(encoding="utf-8")
from collections import defaultdict
import numpy as np
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--run-id", default="main-20261108")
ap.add_argument("--ocr-run", default="20261108")
ap.add_argument("--judgments", default="judgments.jsonl")
args = ap.parse_args()
RUN = os.path.join(HERE, "results", args.run_id)
OUT = os.path.join(RUN, "analysis"); os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20261108)

personas = {p["id"]: p for p in json.load(open(os.path.join(HERE, "personas-inbody.v1.json"), encoding="utf8"))["personas"]}
rows = [json.loads(l) for l in open(os.path.join(RUN, "answers.jsonl"), encoding="utf8") if l.strip()]
jpath = os.path.join(RUN, args.judgments)
judg = [json.loads(l) for l in open(jpath, encoding="utf8") if l.strip()] if os.path.exists(jpath) else []
CFG = ["A", "B", "C", "D"]
CFG_LABEL = {"A": "A: profile only", "B": "B: + InBody", "C": "C: + InBody + RAG", "D": "D: + engine (full)"}
AF = {"SEDENTARY": 1.2, "LIGHTLY_ACTIVE": 1.375, "MODERATELY_ACTIVE": 1.55, "VERY_ACTIVE": 1.725}
RANGE = {"WEIGHT_LOSS": (0.75, 0.90), "MUSCLE_GAIN": (1.05, 1.15), "MAINTENANCE": (0.95, 1.05)}
SEQ = {"A": "#86b6ef", "B": "#3987e5", "C": "#1c5cab", "D": "#0d366b"}  # sequential blue 250/400/550/700 (ordered ablation)
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"
plt.rcParams.update({"font.family": "Times New Roman", "font.size": 9, "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2, "axes.spines.top": False, "axes.spines.right": False})

def f0s(x): return f"{x:.0f}"
def tdee_ref(p): return p["reference"]["bmrKatchMcArdle"] * AF[p["profile"]["activityLevel"]]
def boot_ci(x, f=np.mean, n=10000):
    x = np.asarray([v for v in x if not math.isnan(v)])
    if len(x) == 0: return (float("nan"),) * 2
    b = [f(rng.choice(x, len(x), replace=True)) for _ in range(n)]
    return float(np.percentile(b, 2.5)), float(np.percentile(b, 97.5))
def wilson(k, n, z=1.96):
    if n == 0: return (float("nan"),) * 2
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h
def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i]); adj = [0] * len(ps); run = 0
    for r, i in enumerate(order): run = max(run, min(1, (len(ps) - r) * ps[i])); adj[i] = run
    return adj
def paired_tests(per_persona, pairs=(("A", "B"), ("B", "C"), ("C", "D"), ("A", "D"))):
    res, ps = [], []
    for a, b in pairs:
        ids = [i for i in per_persona[a] if i in per_persona[b] and not math.isnan(per_persona[a][i]) and not math.isnan(per_persona[b][i])]
        x = np.array([per_persona[a][i] for i in ids]); y = np.array([per_persona[b][i] for i in ids])
        if len(ids) < 5 or np.allclose(x, y): p = 1.0
        else: p = float(stats.wilcoxon(x, y, zero_method="zsplit").pvalue)
        res.append({"pair": f"{a} vs {b}", "n": len(ids), "median_diff": float(np.median(y - x)) if len(ids) else None, "p": p}); ps.append(p)
    for r, q in zip(res, holm(ps)): r["p_holm"] = q
    return res

M = {"run": args.run_id, "n_answers": len(rows), "personas": len(personas), "judgments_file": args.judgments, "judge_models": sorted({j.get("judge", "?") for j in judg})}
by = defaultdict(list)
for r in rows: by[(r["qid"], r["config"])].append(r)
M["coverage"] = {f"{q}|{c}": len(v) for (q, c), v in sorted(by.items())}

# ---------------------------------------------------------------- numeric questions
num = {}
for q in ["Q1_TDEE", "Q2_TARGET", "Q3_PROTEIN"]:
    num[q] = {}
    for c in CFG:
        per = defaultdict(list); missing = 0; fallback = 0; n = 0; vals = defaultdict(list)
        for r in by[(q, c)]:
            p = personas[r["persona"]]; v = (r.get("extracted") or {}).get("value"); n += 1
            if (r.get("extracted") or {}).get("method") == "fallback_last_unit": fallback += 1
            if q != "Q1_TDEE" and p["reference"]["minor"]: continue
            if v is None: missing += 1; per[r["persona"]].append(float("nan")); continue
            vals[r["persona"]].append(v)
            ref = tdee_ref(p)
            if q == "Q1_TDEE": per[r["persona"]].append(abs(v - ref) / ref * 100)
            elif q == "Q2_TARGET":
                lo, hi = RANGE[p["profile"]["goal"]]; per[r["persona"]].append(1.0 if lo * ref - 1 <= v <= hi * ref + 1 else 0.0)
            else:
                gkg = v / p["profile"]["currentWeight"]; per[r["persona"]].append(1.0 if 1.4 - 1e-9 <= gkg <= 2.2 + 1e-9 else 0.0)
        pp = {i: float(np.nanmean(x)) if not all(math.isnan(t) for t in x) else float("nan") for i, x in per.items()}
        flat = [t for x in per.values() for t in x if not math.isnan(t)]
        cv = [float(np.std(x) / np.mean(x) * 100) for x in vals.values() if len(x) >= 2 and np.mean(x) > 0]
        entry = {"n_answers": n, "missing": missing, "fallback_extraction": fallback, "per_persona": pp, "rep_cv_pct_mean": float(np.mean(cv)) if cv else None}
        if q == "Q1_TDEE":
            entry["mape"] = float(np.nanmean(list(pp.values()))); entry["mape_ci"] = boot_ci(list(pp.values()))
            entry["median_ape"] = float(np.nanmedian(flat)); entry["within5_pct"] = 100 * float(np.mean([t <= 5 for t in flat]))
            entry["within10_pct"] = 100 * float(np.mean([t <= 10 for t in flat]))
            edge = [v for i, v in pp.items() if i.startswith("E")]; entry["mape_edge"] = float(np.nanmean(edge))
        else:
            k = sum(flat); entry["rate_pct"] = 100 * k / len(flat) if flat else float("nan")
            # repetitions of one persona are not independent: cluster (persona-level) bootstrap instead of a Wilson interval on answers
            lo, hi = boot_ci(list(pp.values())); entry["rate_ci"] = (100 * lo, 100 * hi); entry["ci_method"] = "persona-level bootstrap"
        num[q][c] = entry
    num[q]["tests"] = paired_tests({c: num[q][c]["per_persona"] for c in CFG})
M["numeric"] = num

# signed error of A vs BMR-equation divergence (mechanism check)
sig = {c: {} for c in CFG}
for r in rows:
    if r["qid"] != "Q1_TDEE": continue
    v = (r.get("extracted") or {}).get("value")
    if v is None: continue
    p = personas[r["persona"]]; sig[r["config"]].setdefault(r["persona"], []).append((v - tdee_ref(p)) / tdee_ref(p) * 100)
div = {i: p["reference"]["bmrDivergencePct"] for i, p in personas.items()}
x = [div[i] for i in sig["A"]]; y = [np.mean(sig["A"][i]) for i in sig["A"]]
rho = stats.spearmanr(x, y) if len(x) > 3 else None
M["mechanism"] = {"spearman_A_signed_error_vs_bmr_divergence": {"rho": float(rho.statistic), "p": float(rho.pvalue)} if rho else None}
for c in ("B", "C"):
    xb = [div[i] for i in sig[c]]; yb = [np.mean(sig[c][i]) for i in sig[c]]
    rb = stats.spearmanr(xb, yb) if len(xb) > 3 else None
    M["mechanism"][f"spearman_{c}_signed_error_vs_bmr_divergence"] = {"rho": float(rb.statistic), "p": float(rb.pvalue)} if rb else None
    M["mechanism"][f"mean_signed_error_{c}"] = float(np.mean(yb)) if yb else None
M["mechanism"]["mean_signed_error_A"] = float(np.mean(y)) if y else None

# ---------------------------------------------------------------- judged questions
J = {}
if judg:
    jb = defaultdict(list)
    for j in judg:
        if "scores" in j and isinstance(j["scores"], dict) and "correctness" in j["scores"]: jb[(j["qid"], j["config"])].append(j)
    for q in ["Q4_BODYCOMP", "Q5_KNOWLEDGE", "Q6_SAFETY"]:
        J[q] = {}
        for c in CFG:
            L = jb[(q, c)]
            if not L: continue
            e = {"n": len(L)}
            for k in ["correctness", "personalization", "safety", "clarity", "key_facts"]:
                v = [float(t["scores"].get(k)) for t in L if isinstance(t["scores"].get(k), (int, float))]
                e[k] = {"mean": float(np.mean(v)), "sd": float(np.std(v, ddof=1)) if len(v) > 1 else 0.0, "ci": boot_ci(v)}
            for k in ["fabricated_measurement", "endorses_unsafe"]:
                kk = sum(1 for t in L if t["scores"].get(k) is True); lo, hi = wilson(kk, len(L))
                e[k] = {"count": kk, "rate_pct": 100 * kk / len(L), "ci": (100 * lo, 100 * hi)}
            J[q][c] = e
        for k in ["correctness", "personalization", "safety"]:
            per = {c: {} for c in CFG}
            for c in CFG:
                tmp = defaultdict(list)
                for t in jb[(q, c)]:
                    if isinstance(t["scores"].get(k), (int, float)): tmp[t["persona"]].append(float(t["scores"][k]))
                per[c] = {i: float(np.mean(v)) for i, v in tmp.items()}
            J[q][f"tests_{k}"] = paired_tests(per)
M["judged"] = J

# ---------------------------------------------------------------- sensitivity of the conclusions to the reference choices
# (1) Q2/Q3 interval width (narrow / main / wide); (2) Q1 reference equation (Katch-McArdle from FFM vs weight-only Mifflin-St Jeor).
SENS_Q2 = {"narrow": {"WEIGHT_LOSS": (0.80, 0.90), "MUSCLE_GAIN": (1.05, 1.10), "MAINTENANCE": (0.97, 1.03)},
           "main": RANGE,
           "wide": {"WEIGHT_LOSS": (0.70, 0.95), "MUSCLE_GAIN": (1.03, 1.20), "MAINTENANCE": (0.93, 1.07)}}
SENS_Q3 = {"narrow": (1.6, 2.2), "main": (1.4, 2.2), "wide": (1.2, 2.4)}
sens = {"q2": {}, "q3": {}, "q1_mifflin_reference": {}}
for name, rg in SENS_Q2.items():
    sens["q2"][name] = {}
    for c in CFG:
        hits = []
        for r in by[("Q2_TARGET", c)]:
            p = personas[r["persona"]]; v = (r.get("extracted") or {}).get("value")
            if p["reference"]["minor"] or v is None: continue
            lo, hi = rg[p["profile"]["goal"]]; ref = tdee_ref(p); hits.append(1.0 if lo * ref - 1 <= v <= hi * ref + 1 else 0.0)
        sens["q2"][name][c] = 100 * float(np.mean(hits)) if hits else float("nan")
for name, (lo, hi) in SENS_Q3.items():
    sens["q3"][name] = {}
    for c in CFG:
        hits = []
        for r in by[("Q3_PROTEIN", c)]:
            p = personas[r["persona"]]; v = (r.get("extracted") or {}).get("value")
            if p["reference"]["minor"] or v is None: continue
            g = v / p["profile"]["currentWeight"]; hits.append(1.0 if lo - 1e-9 <= g <= hi + 1e-9 else 0.0)
        sens["q3"][name][c] = 100 * float(np.mean(hits)) if hits else float("nan")
for c in CFG:
    per = defaultdict(list)
    for r in by[("Q1_TDEE", c)]:
        p = personas[r["persona"]]; v = (r.get("extracted") or {}).get("value")
        if v is None: continue
        ref = p["reference"]["bmrMifflinStJeor"] * AF[p["profile"]["activityLevel"]]
        per[r["persona"]].append(abs(v - ref) / ref * 100)
    sens["q1_mifflin_reference"][c] = float(np.mean([np.mean(x) for x in per.values()]))
M["sensitivity"] = sens

# ---------------------------------------------------------------- cost / context
cost = {}
for c in CFG:
    L = [r for r in rows if r["config"] == c]
    cost[c] = {"in_tok_mean": float(np.mean([r["inTok"] for r in L])), "out_tok_mean": float(np.mean([r["outTok"] for r in L])), "latency_ms_median": float(np.median([r["ms"] for r in L]))}
ret = [r for r in rows if r["config"] in ("C", "D")]
scores = [d["score"] for r in ret for d in r["retrieved"]]
srcs = defaultdict(int)
for r in ret:
    for d in r["retrieved"]: srcs[d["source"]] += 1
M["cost"] = cost
M["retrieval"] = {"docs_per_query_mean": float(np.mean([len(r["retrieved"]) for r in ret])) if ret else None, "score_mean": float(np.mean(scores)) if scores else None, "sources": dict(srcs)}

# ---------------------------------------------------------------- OCR
ocr_path = os.path.join(HERE, "results", f"ocr-{args.ocr_run}", "ocr-summary.json")
M["ocr"] = json.load(open(ocr_path, encoding="utf8")) if os.path.exists(ocr_path) else None
json.dump(M, open(os.path.join(OUT, "metrics.json"), "w", encoding="utf8"), indent=2, default=float)

# ---------------------------------------------------------------- tables (markdown, for drafting)
T = []
T.append("| Config | Q1 MAPE % [95% CI] | Q1 within ±5 % | Q2 target in range % [95% CI] | Q3 protein in range % [95% CI] | Rep CV Q1 % | Input tokens |")
T.append("|---|---|---|---|---|---|---|")
for c in CFG:
    q1, q2, q3 = num["Q1_TDEE"][c], num["Q2_TARGET"][c], num["Q3_PROTEIN"][c]
    T.append(f"| {CFG_LABEL[c]} | {q1['mape']:.1f} [{q1['mape_ci'][0]:.1f}, {q1['mape_ci'][1]:.1f}] | {q1['within5_pct']:.0f} | {q2['rate_pct']:.0f} [{q2['rate_ci'][0]:.0f}, {q2['rate_ci'][1]:.0f}] | {q3['rate_pct']:.0f} [{q3['rate_ci'][0]:.0f}, {q3['rate_ci'][1]:.0f}] | {q1['rep_cv_pct_mean'] or 0:.2f} | {cost[c]['in_tok_mean']:.0f} |")
T.append("")
for q in ["Q1_TDEE", "Q2_TARGET", "Q3_PROTEIN"]:
    T.append(f"Paired Wilcoxon ({q}): " + "; ".join(f"{t['pair']} n={t['n']} medianΔ={t['median_diff']:.2f} p={t['p']:.3g} p_holm={t['p_holm']:.3g}" for t in num[q]["tests"]))
T.append("")
if J:
    T.append("| Config | Q4 personalization | Q4 fabricated % | Q5 correctness | Q5 key facts (0-2) | Q6 safety | Q6 endorses unsafe % |")
    T.append("|---|---|---|---|---|---|---|")
    for c in CFG:
        g = lambda q, k, s="mean": J.get(q, {}).get(c, {}).get(k, {}).get(s, float("nan"))
        T.append(f"| {CFG_LABEL[c]} | {g('Q4_BODYCOMP','personalization'):.2f} ± {g('Q4_BODYCOMP','personalization','sd'):.2f} | {g('Q4_BODYCOMP','fabricated_measurement','rate_pct'):.0f} | {g('Q5_KNOWLEDGE','correctness'):.2f} ± {g('Q5_KNOWLEDGE','correctness','sd'):.2f} | {g('Q5_KNOWLEDGE','key_facts'):.2f} | {g('Q6_SAFETY','safety'):.2f} ± {g('Q6_SAFETY','safety','sd'):.2f} | {g('Q6_SAFETY','endorses_unsafe','rate_pct'):.0f} |")
    for q in J:
        for k in ["correctness", "personalization", "safety"]:
            T.append(f"Wilcoxon {q} {k}: " + "; ".join(f"{t['pair']} p_holm={t['p_holm']:.3g}" for t in J[q][f"tests_{k}"]))
T.append("")
T.append("Sensitivity (in-range % for A/B/C/D): " + "; ".join(f"Q2 {k}: " + "/".join(f0s(v[c]) for c in CFG) for k, v in sens["q2"].items()) + "; " + "; ".join(f"Q3 {k}: " + "/".join(f0s(v[c]) for c in CFG) for k, v in sens["q3"].items()))
T.append("Q1 MAPE with a weight-only (Mifflin) reference, A/B/C/D: " + "/".join(f"{sens['q1_mifflin_reference'][c]:.1f}" for c in CFG))
open(os.path.join(OUT, "tables.md"), "w", encoding="utf8").write("\n".join(T) + "\n")
print("\n".join(T))
print(json.dumps({"mechanism": M["mechanism"], "retrieval": M["retrieval"], "cost": cost}, indent=1))

# ---------------------------------------------------------------- figures
def bars(ax, vals, cis, title, ylabel, fmt):
    xs = np.arange(len(CFG))
    for i, c in enumerate(CFG):
        v = vals[i]; lo, hi = cis[i]
        ax.bar(xs[i], v, width=0.62, color=SEQ[c], edgecolor="#fcfcfb", linewidth=1.5, zorder=2)
        ax.errorbar(xs[i], v, yerr=[[v - lo], [hi - v]], fmt="none", ecolor=INK, elinewidth=0.8, capsize=2.5, zorder=3)
        ax.text(xs[i], hi + ax.get_ylim()[1] * 0.02, fmt.format(v), ha="center", va="bottom", fontsize=6.5, color=INK)
    ax.set_xticks(xs, CFG); ax.set_title(title, fontsize=7.5, color=INK); ax.set_ylabel(ylabel, fontsize=7.5); ax.tick_params(labelsize=7)
    ax.yaxis.grid(True, color=GRID, linewidth=0.6, zorder=0); ax.set_axisbelow(True)

fig, axs = plt.subplots(1, 3, figsize=(3.5, 1.95), dpi=300)
q1 = [num["Q1_TDEE"][c]["mape"] for c in CFG]; q1c = [num["Q1_TDEE"][c]["mape_ci"] for c in CFG]
axs[0].set_ylim(0, max(h for _, h in q1c) * 1.25); bars(axs[0], q1, q1c, "(a) TDEE error", "MAPE (%)", "{:.1f}")
q2 = [num["Q2_TARGET"][c]["rate_pct"] for c in CFG]; q2c = [num["Q2_TARGET"][c]["rate_ci"] for c in CFG]
axs[1].set_ylim(0, 118); bars(axs[1], q2, q2c, "(b) Energy target", "In range (%)", "{:.0f}")
q3 = [num["Q3_PROTEIN"][c]["rate_pct"] for c in CFG]; q3c = [num["Q3_PROTEIN"][c]["rate_ci"] for c in CFG]
axs[2].set_ylim(0, 118); bars(axs[2], q3, q3c, "(c) Protein", "In range (%)", "{:.0f}")
fig.tight_layout(w_pad=0.6); fig.savefig(os.path.join(OUT, "fig-numeric.png"), bbox_inches="tight", pad_inches=0.02); plt.close(fig)

fig, ax = plt.subplots(figsize=(3.5, 2.6), dpi=300)
for c, mk in [("A", "o"), ("B", "s")]:
    ids = [i for i in sig[c]]
    ax.scatter([div[i] for i in ids], [np.mean(sig[c][i]) for i in ids], s=22, marker=mk, color=SEQ[c] if c == "B" else "#86b6ef", edgecolor=INK if c == "A" else "#fcfcfb", linewidth=0.6, label=CFG_LABEL[c], zorder=3)
ax.axhline(0, color=INK2, linewidth=0.6); ax.axvline(0, color=INK2, linewidth=0.6)
ax.set_xlabel("Weight-only BMR divergence (%)"); ax.set_ylabel("Signed error of maintenance energy (%)")
ax.yaxis.grid(True, color=GRID, linewidth=0.6); ax.set_axisbelow(True); ax.legend(frameon=False, fontsize=7, loc="upper left")
fig.tight_layout(); fig.savefig(os.path.join(OUT, "fig-mechanism.png"), bbox_inches="tight"); plt.close(fig)

if M["ocr"]:
    ocr = M["ocr"]; models = list(ocr["models"].keys())
    groups = ["Nutrition-critical (W, BFM, FFM, BMR)", "Core scalar fields (n=24 sheets)", "Measurement date", "Segmental (n=24 sheets)"]
    glabel = ["Nutrition-critical\n(W, BFM, FFM, BMR)", "All core fields", "Measurement date", "Segmental"]
    CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]; HATCH = ["", "////", "\\\\\\\\", "...."]
    fig, ax = plt.subplots(figsize=(7.16, 2.4), dpi=300)
    w = 0.2; xs = np.arange(len(groups))
    for k, m in enumerate(models):
        v = [ocr["models"][m]["groups"][g]["accuracy"] for g in groups]
        b = ax.bar(xs + (k - 1.5) * w, v, width=w * 0.92, color=CAT[k], hatch=HATCH[k], edgecolor="#fcfcfb", linewidth=0.8, label=m, zorder=2)
        for xi, vi in zip(xs + (k - 1.5) * w, v): ax.text(xi, vi + 1.5, f"{vi:.0f}", ha="center", fontsize=6.5, color=INK)
    ax.set_xticks(xs, glabel); ax.set_ylim(0, 112); ax.set_ylabel("Field accuracy (%)")
    ax.yaxis.grid(True, color=GRID, linewidth=0.6); ax.set_axisbelow(True)
    ax.legend(frameon=False, ncol=4, fontsize=7.5, loc="upper center", bbox_to_anchor=(0.5, 1.16))
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "fig-ocr.png"), bbox_inches="tight"); plt.close(fig)
print("figures ->", OUT)
