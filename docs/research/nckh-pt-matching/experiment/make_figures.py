"""Vẽ biểu đồ + sinh bảng Markdown từ results/*.json. Chạy: python make_figures.py"""
import json, statistics as st
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "results"; FIG = ROOT / "figures"; FIG.mkdir(exist_ok=True)
D = json.loads((RES / "pt_matching_results.json").read_text(encoding="utf-8"))
A = json.loads((RES / "agentic-evaluation-results.json").read_text(encoding="utf-8"))

SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, AQUA, YELLOW, GRAY = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#a3a29c"
plt.rcParams.update({"figure.facecolor": SURF, "axes.facecolor": SURF, "savefig.facecolor": SURF, "font.size": 10,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2, "text.color": INK,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "font.family": "DejaVu Sans"})

LAB = D["labels"]; SC = {s["id"]: s for s in D["scenarios"]}
def agg(sc, m, k):
    xs = [x["methods"][m][k] for x in SC[sc]["perSeed"] if x["methods"][m][k] is not None]
    return (st.mean(xs), st.pstdev(xs)) if xs else (None, None)
def fmt(v): return "—" if v[0] is None else f"{v[0]:.3f} ± {v[1]:.3f}"

MAIN = ["RANDOM", "RATING_ONLY", "SCORE_NO_FILTER", "FILTER_PRICE", "FILTER_RATING", "HYBRID_V1", "HYBRID_V2", "EXP_UNROUNDED_TIEBREAK"]
ABL = ["HYBRID_V2", "ABL_NO_GOAL_SCHED_BUDGET", "ABL_NO_REPUTATION", "ABL_NO_EVIDENCE", "EXP_OUTCOME_AWARE", "EXP_UNROUNDED_TIEBREAK"]
METRICS = [("ndcg5", "NDCG@5"), ("precision5", "Precision@5"), ("recall5", "Recall@5"), ("hitRate1", "HitRate@1"),
           ("violation5", "Vi phạm@5"), ("tieRate5", "Tỉ lệ hoà điểm@5"), ("coldStartHit5", "Cold-start Hit@5"), ("msPerQuery", "ms/truy vấn")]

def short(m): return LAB[m].split(" ", 1)[0]

# ---------- Hình 1: NDCG@5 các phương pháp, 2 kịch bản ----------
fig, axes = plt.subplots(1, 2, figsize=(11, 4.4), sharey=True)
for ax, sc in zip(axes, ["S1", "S4"]):
    vals = [agg(sc, m, "ndcg5") for m in MAIN]
    colors = [BLUE if m == "HYBRID_V2" else (AQUA if m.startswith("EXP") else GRAY) for m in MAIN]
    ax.barh(range(len(MAIN)), [v[0] for v in vals], xerr=[v[1] for v in vals], color=colors, height=0.62,
            error_kw={"ecolor": INK2, "elinewidth": 1, "capsize": 2})
    for i, v in enumerate(vals): ax.text(v[0] + v[1] + 0.02, i, f"{v[0]:.3f}", va="center", fontsize=8.5, color=INK)
    ax.set_yticks(range(len(MAIN))); ax.set_yticklabels([LAB[m] for m in MAIN]); ax.invert_yaxis()
    ax.set_xlim(0, 1.1); ax.set_title(SC[sc]["label"], fontsize=10, color=INK, loc="left"); ax.set_xlabel("NDCG@5 (cao hơn là tốt hơn)")
    ax.grid(axis="y", visible=False)
fig.suptitle("Hình 1. Chất lượng xếp hạng NDCG@5 (trung bình ± độ lệch chuẩn, 5 seed × 300 người tập)", x=0.01, ha="left", fontsize=11)
fig.tight_layout(); fig.savefig(FIG / "fig1_ndcg_methods.png", dpi=200); plt.close(fig)

# ---------- Hình 2: Tỉ lệ vi phạm ràng buộc cứng trong top-5 ----------
fig, ax = plt.subplots(figsize=(9, 3.8)); w = 0.38
ms = ["RANDOM", "RATING_ONLY", "SCORE_NO_FILTER", "FILTER_RATING", "HYBRID_V2"]
for j, (sc, col) in enumerate([("S1", BLUE), ("S3", ORANGE)]):
    vs = [agg(sc, m, "violation5")[0] * 100 for m in ms]
    ax.bar([i + (j - 0.5) * w for i in range(len(ms))], vs, width=w - 0.03, color=col, label=SC[sc]["label"])
    for i, v in enumerate(vs): ax.text(i + (j - 0.5) * w, v + 1.5, f"{v:.1f}%", ha="center", fontsize=8.5)
ax.set_xticks(range(len(ms))); ax.set_xticklabels([LAB[m] for m in ms], fontsize=8.5); ax.set_ylim(0, 110)
ax.set_ylabel("% PT gợi ý vi phạm ràng buộc"); ax.legend(frameon=False, fontsize=8.5); ax.grid(axis="x", visible=False)
ax.set_title("Hình 2. Tỉ lệ PT trong top-5 không đáp ứng mục tiêu/lịch rảnh/ngân sách/thời lượng", loc="left", fontsize=11)
fig.tight_layout(); fig.savefig(FIG / "fig2_violation.png", dpi=200); plt.close(fig)

# ---------- Hình 3: Ablation (S3) ----------
fig, ax = plt.subplots(figsize=(9, 3.8))
vals = [agg("S3", m, "ndcg5") for m in ABL]; ties = [agg("S3", m, "tieRate5")[0] for m in ABL]
for i, v in enumerate(vals):
    ax.errorbar(v[0], i, xerr=v[1], fmt="o", ms=8, color=BLUE if ABL[i] == "HYBRID_V2" else INK2, ecolor=GRAY, elinewidth=1.5, capsize=3)
for i, (v, t) in enumerate(zip(vals, ties)): ax.text(v[0] + v[1] + 0.004, i, f"{v[0]:.3f}  (hoà {t*100:.0f}%)", va="center", fontsize=8.5)
ax.set_yticks(range(len(ABL))); ax.set_yticklabels([LAB[m] for m in ABL]); ax.invert_yaxis(); ax.set_xlim(0.7, 0.9)
ax.set_xlabel("NDCG@5"); ax.grid(axis="y", visible=False)
fig.suptitle("Hình 3. Cắt bỏ (ablation) từng tiêu chí — " + SC["S3"]["label"] + " (điểm = TB, vạch = ±1 độ lệch chuẩn)", x=0.01, ha="left", fontsize=10.5)
fig.tight_layout(); fig.savefig(FIG / "fig3_ablation.png", dpi=200); plt.close(fig)

# ---------- Hình 4: Độ nhạy trọng số (heatmap tuần tự 1 màu) ----------
from matplotlib.colors import LinearSegmentedColormap
cmap = LinearSegmentedColormap.from_list("blue", ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])
sens = D["sensitivity"]; wr = sorted({s["wReputation"] for s in sens}); we = sorted({s["wEvidence"] for s in sens})
M = [[next(s["ndcg5"] for s in sens if s["wReputation"] == r and s["wEvidence"] == e) for e in we] for r in wr]
fig, ax = plt.subplots(figsize=(6.2, 4.2)); im = ax.imshow(M, cmap=cmap, aspect="auto", origin="lower")
for i in range(len(wr)):
    for j in range(len(we)):
        v = M[i][j]; ax.text(j, i, f"{v:.3f}", ha="center", va="center", fontsize=8.5, color="white" if v > 0.804 else INK)
ax.set_xticks(range(len(we))); ax.set_xticklabels(we); ax.set_yticks(range(len(wr))); ax.set_yticklabels(wr)
ax.set_xlabel("Trọng số bằng chứng chỉ số cơ thể (evidence)"); ax.set_ylabel("Trọng số uy tín (reputation)"); ax.grid(False)
ax.add_patch(plt.Rectangle((we.index(15) - .5, wr.index(10) - .5), 1, 1, fill=False, ec=ORANGE, lw=2))
fig.colorbar(im, ax=ax, label="NDCG@5")
ax.set_title("Hình 4. Độ nhạy trọng số (ô cam = cấu hình hiện tại 10/15)", loc="left", fontsize=10.5)
fig.tight_layout(); fig.savefig(FIG / "fig4_sensitivity.png", dpi=200); plt.close(fig)

# ---------- Hình 5: Lớp LLM — khả năng chặn bịa đặt ----------
by = {}
for r in A["results"]: by.setdefault(r["category"], []).append(r["status"])
def rate(cat): xs = by.get(cat, []); return (sum(x == "PASS" for x in xs), len(xs))
groups = [("Thế hệ 1\n(bịa trực tiếp)", "Narrator grounding"), ("Thế hệ 2\n(diễn đạt lại)", "Narrator regression #2 attack"),
          ("Thế hệ 3\n(ám chỉ tinh vi)", "Narrator regression #3 attack"), ("Kiến trúc chọn mệnh đề\n(Claim Catalog)", "Narrator Phase-4 Production Path")]
fig, ax = plt.subplots(figsize=(8.5, 3.8))
for i, (lab, cat) in enumerate(groups):
    p, n = rate(cat); v = 100 * p / n
    ax.bar(i, v, color=BLUE if "Catalog" in lab else GRAY, width=0.6); ax.text(i, v + 2, f"{v:.0f}%\n({p}/{n})", ha="center", fontsize=9)
ax.set_xticks(range(len(groups))); ax.set_xticklabels([g[0] for g in groups], fontsize=8.5); ax.set_ylim(0, 120)
ax.set_ylabel("% ca được xử lý đúng"); ax.grid(axis="x", visible=False)
ax.set_title("Hình 5. LLM sinh lời giải thích: bộ kiểm văn bản tự do vs. LLM chỉ chọn mệnh đề", loc="left", fontsize=10.5)
fig.tight_layout(); fig.savefig(FIG / "fig5_llm_grounding.png", dpi=200); plt.close(fig)

# ---------- Hình 6: Khả năng mở rộng ----------
sc_ = D["scalability"]; fig, ax = plt.subplots(figsize=(6, 3.4))
ax.plot([s["nPT"] for s in sc_], [s["msPerQuery"] for s in sc_], color=BLUE, lw=2, marker="o", ms=6)
for s in sc_: ax.annotate(f"{s['msPerQuery']:.2f} ms", (s["nPT"], s["msPerQuery"]), textcoords="offset points", xytext=(4, 6), fontsize=8.5)
ax.set_xlabel("Số PT trong hệ thống"); ax.set_ylabel("ms / truy vấn"); ax.set_title("Hình 6. Thời gian lọc + chấm điểm + xếp hạng", loc="left", fontsize=10.5)
fig.tight_layout(); fig.savefig(FIG / "fig6_scalability.png", dpi=200); plt.close(fig)

# ---------- Bảng Markdown ----------
out = []
for sc in ["S1", "S2", "S3", "S4"]:
    s0 = SC[sc]["perSeed"]
    out.append(f"\n### Bảng {sc}. {SC[sc]['label']}\n")
    out.append(f"Truy vấn có ≥1 PT hợp lệ: {sum(x['answered'] for x in s0)}/{sum(x['queries'] for x in s0)} · "
               f"PT hợp lệ TB/truy vấn: {st.mean(x['avgFeasible'] for x in s0):.1f} · "
               f"Tỉ lệ truy vấn rỗng: {st.mean(x['emptyRate'] for x in s0)*100:.1f}% · "
               f"Độ phủ bằng chứng (PT hợp lệ có ≥5 hành trình tương tự): {st.mean(x['evidenceCoverage'] for x in s0)*100:.1f}%\n")
    out.append("| Phương pháp | " + " | ".join(l for _, l in METRICS) + " |")
    out.append("|---" * (len(METRICS) + 1) + "|")
    for m in MAIN + [x for x in ABL if x not in MAIN]:
        row = [fmt(agg(sc, m, k)) if k != "msPerQuery" else f"{agg(sc, m, k)[0]:.3f}" for k, _ in METRICS]
        name = f"**{LAB[m]}**" if m == "HYBRID_V2" else LAB[m]
        out.append(f"| {name} | " + " | ".join(row) + " |")
out.append("\n### Bảng LLM. Kết quả bộ đánh giá agentic (chạy lại " + A["generatedAt"] + ")\n")
out.append("| Nhóm ca | Đạt | Không đạt | Bỏ qua | Bị chặn (cần LLM thật) |\n|---|---|---|---|---|")
for cat, xs in by.items():
    out.append(f"| {cat} | {xs.count('PASS')} | {xs.count('FAIL')} | {xs.count('SKIPPED')} | {xs.count('BLOCKED')} |")
(RES / "tables.md").write_text("\n".join(out), encoding="utf-8")
print("ok", sorted(p.name for p in FIG.iterdir()))
