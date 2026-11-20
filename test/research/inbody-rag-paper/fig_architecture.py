"""Fig. 1 (column width, 3.5 in): pipeline of the InBody-grounded assistant as implemented in Gymini (KLTN), and the four ablation configurations.

Inputs -> three service lanes (user-service with the user's confirmation step / deterministic engine / ai-service retriever)
-> context assembly drawn as four stacked blocks A..D (same sequential blues as Fig. 2) -> LLM -> production-only safeguards (dashed).
"""
import os, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", sys.argv[1] if len(sys.argv) > 1 else "main-20261108", "analysis")
os.makedirs(OUT, exist_ok=True)
plt.rcParams.update({"font.family": "Times New Roman"})
INK, INK2, EDGE = "#0b0b0b", "#52514e", "#8a8984"
SURF, INPUT, LANE, BOX = "#fcfcfb", "#f0efec", "#eef4fc", "#ffffff"
SEQ = {"A": "#86b6ef", "B": "#3987e5", "C": "#1c5cab", "D": "#0d366b"}  # identical to Fig. 2

fig, ax = plt.subplots(figsize=(3.5, 4.75), dpi=300)
fig.patch.set_facecolor("white")
ax.set_xlim(0, 100); ax.set_ylim(-2, 148); ax.axis("off")

def rbox(x, y, w, h, fc, ec=EDGE, lw=0.6, r=1.6, z=1, ls="-"):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fc, ec=ec, lw=lw, zorder=z, linestyle=ls))

def text(x, y, s, size=7, color=INK, weight="normal", style="normal", ha="center", va="center", z=5):
    ax.text(x, y, s, fontsize=size, color=color, fontweight=weight, fontstyle=style, ha=ha, va=va, zorder=z, linespacing=1.12)

def arrow(x1, y1, x2, y2, color=INK2, lw=0.7):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=6.5, lw=lw, color=color, shrinkA=0, shrinkB=0, zorder=4))

def tag(x, y, letter):
    rbox(x - 3.2, y - 2.6, 6.4, 5.2, SEQ[letter], ec="none", r=1.2, z=6)
    text(x, y, letter, size=6.8, color="white" if letter != "A" else INK, weight="bold", z=7)

L = [(1, 31), (34.5, 31), (68, 31)]  # three lanes: x, width
CX = [x + w / 2 for x, w in L]

# ---- inputs (y 132-146)
for (x, w), lines in zip(L, [("InBody printout", "(smartphone photo)"), ("User profile", "(age, sex, height,\nweight, goal, activity)"), ("User question", "(Vietnamese)")]):
    rbox(x, 132, w, 14, INPUT)
    text(x + w / 2, 141.6, lines[0], size=7.2, weight="bold")
    text(x + w / 2, 135.9, lines[1], size=6, color=INK2)

# ---- service lanes (y 68-128)
for (x, w), t in zip(L, ["user-service", "fitness / AI engine", "ai-service"]):
    rbox(x, 68, w, 60, LANE, ec="#c5d6ee", lw=0.5, r=2.2, z=0)
    text(x + w / 2, 125.2, t, size=6.2, color="#1c5cab", style="italic")
# lane 1: extraction -> user confirmation -> record
rbox(L[0][0] + 2, 108, L[0][1] - 4, 13, BOX)
text(CX[0], 117.6, "Vision-language", size=6.8, weight="bold"); text(CX[0], 112.4, "extraction\n(JSON tool schema)", size=6, color=INK2)
rbox(L[0][0] + 2, 94, L[0][1] - 4, 10, BOX)
text(CX[0], 101.2, "User checks", size=6.8, weight="bold"); text(CX[0], 96.8, "and corrects values", size=6, color=INK2)
rbox(L[0][0] + 2, 72, L[0][1] - 4, 17, BOX)
text(CX[0], 84.4, "InBody record", size=6.8, weight="bold"); text(CX[0], 77.4, "W, BFM, FFM,\nPBF, SMM, BMR", size=6, color=INK2)
tag(L[0][0] + L[0][1] - 3.5, 89, "B")
# lane 2: deterministic engine
rbox(L[1][0] + 2, 72, L[1][1] - 4, 49, BOX)
text(CX[1], 114.2, "Deterministic", size=6.8, weight="bold"); text(CX[1], 109.6, "engine", size=6.8, weight="bold")
text(CX[1], 92.0, "BMR × AF = TDEE\nE = TDEE (1 + δ)\nP, F, C targets", size=6, color=INK2)
tag(L[1][0] + L[1][1] - 3.5, 121, "D")
# lane 3: retriever
rbox(L[2][0] + 2, 72, L[2][1] - 4, 49, BOX)
text(CX[2], 114.2, "Retriever", size=6.8, weight="bold")
text(CX[2], 94.0, "Cohere multilingual\nembedding\n+ vector search\ntop-5 (cosine ≥ 0.35)", size=6, color=INK2)
tag(L[2][0] + L[2][1] - 3.5, 121, "C")

# ---- arrows: inputs -> lanes, inside lanes
for cx, y_top in zip(CX, (121.4, 121.4, 121.4)): arrow(cx, 132, cx, y_top)
arrow(CX[0], 108, CX[0], 104.4); arrow(CX[0], 94, CX[0], 89.4)
arrow(L[0][0] + L[0][1] - 2, 80, L[1][0] + 2, 80)
text(33.25, 83.6, "BMR", size=5.6, color=INK2, style="italic")

# ---- context assembly: four stacked configuration blocks (y 31-63)
rbox(1, 31, 98, 32, SURF, ec=EDGE)
text(50, 59.6, "Context assembly (each configuration adds one block)", size=6.8, weight="bold")
rows = [("A", "Profile + question", "always included"), ("B", "InBody measurement block", "configurations B, C, D"),
        ("C", "Retrieved evidence passages", "configurations C, D"), ("D", "Engine values (authoritative)", "configuration D")]
for k, (letter, label, scope) in enumerate(rows):
    y = 51.2 - k * 6.4
    rbox(4, y, 92, 5.4, SEQ[letter], ec="none", r=1.2, z=2)
    fg = INK if letter == "A" else "white"
    text(8, y + 2.7, letter, size=6.8, color=fg, weight="bold", z=6)
    text(13, y + 2.7, label, size=6.4, color=fg, ha="left", z=6)
    text(93, y + 2.7, scope, size=5.8, color=fg, ha="right", style="italic", z=6)
for cx in CX: arrow(cx, 68, cx, 63.3)

# ---- LLM, then the production-only safeguards (dashed, not part of the ablation)
rbox(18, 15, 64, 11, "#cde2fb", ec=EDGE)
text(50, 22.8, "LLM: Amazon Nova Pro (temperature 0)", size=6.9, weight="bold")
text(50, 18.1, "personalized answer in Vietnamese", size=6.1, color=INK2)
arrow(50, 31, 50, 26.4)
rbox(4, -1.5, 92, 12.5, "white", ec=INK2, lw=0.7, ls=(0, (3, 2)))
text(50, 8.9, "Production only, not in the ablation:", size=6.2, weight="bold")
text(50, 3.6, "safety filter · answer check against computed numbers\n· deterministic fallback", size=5.9, color=INK2)
arrow(50, 15, 50, 11.4)

fig.savefig(os.path.join(OUT, "fig-architecture.png"), bbox_inches="tight", pad_inches=0.03, facecolor="white")
print("ok", OUT)
