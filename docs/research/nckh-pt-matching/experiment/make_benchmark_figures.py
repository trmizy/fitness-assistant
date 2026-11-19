"""Biểu đồ cho benchmark 20 PT × 30 client. Chạy: python make_benchmark_figures.py"""
import json
from pathlib import Path
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
ROOT = Path(__file__).resolve().parent.parent
D = json.loads((ROOT / "benchmark" / "benchmark_results.json").read_text(encoding="utf-8"))
FIG = ROOT / "figures"
SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, GRAY = "#2a78d6", "#eb6834", "#a3a29c"
plt.rcParams.update({"figure.facecolor": SURF, "axes.facecolor": SURF, "savefig.facecolor": SURF, "font.size": 10, "axes.edgecolor": GRID,
    "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "font.family": "DejaVu Sans"})
R, G0, G1 = D["random"], D["methods"][0], D["methods"][1]
metrics = [("valid3", "Valid@3"), ("top1Validity", "Top-1 Validity"), ("caseSuccess", "Case Success")]
series = [("R: ngẫu nhiên 3/20", R, GRAY), ("G0: Gymini hiện tại", G0, ORANGE), ("G1: Gymini + ràng buộc giờ/quận/giá buổi", G1, BLUE)]
fig, ax = plt.subplots(figsize=(9, 4.3)); w = 0.26
for j, (lab, m, col) in enumerate(series):
    xs = [i + (j - 1) * w for i in range(len(metrics))]; vs = [m[k] * 100 for k, _ in metrics]
    ax.bar(xs, vs, width=w - 0.03, color=col, label=lab)
    for x, v in zip(xs, vs): ax.text(x, v + 1.5, f"{v:.1f}%", ha="center", fontsize=8.5)
ax.set_xticks(range(len(metrics))); ax.set_xticklabels([l for _, l in metrics]); ax.set_ylim(0, 115); ax.set_ylabel("%")
ax.legend(frameon=False, fontsize=8.5, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=3); ax.grid(axis="x", visible=False)
fig.suptitle("Hình 7. Benchmark 20 PT × 30 client: tỉ lệ đề xuất hợp lệ theo H0–H5", x=0.01, ha="left", fontsize=11)
fig.tight_layout(); fig.savefig(FIG / "fig7_benchmark_validity.png", dpi=200); plt.close(fig)

v = G0["violations"]; labels = {"H5": "H5 sai quận phục vụ", "H2": "H2 không trùng giờ rảnh", "H1": "H1 thiếu chuyên môn bắt buộc", "H3": "H3 vượt ngân sách/buổi", "H4": "H4 sai hình thức"}
keys = sorted(labels, key=lambda k: -v[k])
fig, ax = plt.subplots(figsize=(8, 3.2))
ax.barh(range(len(keys)), [v[k] for k in keys], color=ORANGE, height=0.6)
for i, k in enumerate(keys): ax.text(v[k] + 0.3, i, str(v[k]), va="center", fontsize=9)
ax.set_yticks(range(len(keys))); ax.set_yticklabels([labels[k] for k in keys]); ax.invert_yaxis(); ax.grid(axis="y", visible=False)
ax.set_xlabel(f"Số vị trí vi phạm (trên {G0['invalidPositions']} vị trí không hợp lệ; một vị trí có thể vi phạm nhiều điều kiện)")
fig.suptitle("Hình 8. Vì sao Gymini hiện tại đề xuất sai: phân rã theo điều kiện", x=0.01, ha="left", fontsize=11)
fig.tight_layout(); fig.savefig(FIG / "fig8_benchmark_violations.png", dpi=200); plt.close(fig)
print("ok")
