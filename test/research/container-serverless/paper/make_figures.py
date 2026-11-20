"""Single-column (3.45 in) figures for the SSRC/IEEE manuscript, drawn from results/analysis/summary.json.

Usage: python make_figures.py   (writes paper/fig-*.png)
Palette = the validated dataviz palette used by analysis/analyze.py; every series also has its own marker and line style.
"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from matplotlib.ticker import FuncFormatter, NullFormatter
PLAIN = FuncFormatter(lambda v, _: f"{v:g}")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
S = json.load(open(os.path.join(ROOT, "results", "analysis", "summary.json"), encoding="utf8"))
PR = json.load(open(os.path.join(ROOT, "analysis", "prices.json"), encoding="utf8"))
COLOR = {"lambda": "#2a78d6", "container": "#eb6834", "container-r2": "#1baf7a", "container-r3": "#eda100"}
MARK = {"lambda": "o", "container": "s", "container-r2": "^", "container-r3": "D"}
STYLE = {"lambda": "-", "container": "--", "container-r2": "-.", "container-r3": ":"}
NAME = {"lambda": "Serverless", "container": "Container ×1", "container-r2": "Container ×2", "container-r3": "Container ×3"}
plt.rcParams.update({"font.family": "Times New Roman", "font.size": 8, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#e5e5e5", "grid.linewidth": 0.6, "legend.frameon": False})
W = 3.45


def pts(arm, wl):
    out = sorted((g["offered_rate"], g) for k, g in S["phases"].items() if k.startswith(f"{arm}|{wl}|steps|step-"))
    return [p[0] for p in out], [p[1] for p in out]


# ---------------------------------------------------------------- Fig. 1 architecture
def architecture():
    fig, ax = plt.subplots(figsize=(W, 2.45)); ax.set_xlim(0, 100); ax.set_ylim(0, 80); ax.axis("off")
    def box(x, y, w, h, text, fc="#ffffff", ec="#333333", ls="-", fs=6.6, bold=False):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.5", fc=fc, ec=ec, lw=0.8, ls=ls))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs, weight="bold" if bold else "normal", linespacing=1.15)
    def arrow(x1, y1, x2, y2, c="#333333"):
        ax.annotate("", (x2, y2), (x1, y1), arrowprops=dict(arrowstyle="-|>", lw=0.8, color=c, shrinkA=0, shrinkB=0))
    box(33, 70, 34, 8, "Open-loop load generator\n(c7i.xlarge, same region)", fc="#f2f2f2")
    # serverless arm
    box(2, 47, 40, 15, "", fc="#eaf2fc", ec=COLOR["lambda"])
    ax.text(22, 59.3, "Serverless deployment", ha="center", fontsize=6.8, weight="bold", color=COLOR["lambda"])
    box(5, 49, 15, 7.5, "API Gateway\n(HTTP API)", fs=6.2)
    box(24, 49, 15, 7.5, "Lambda ×N\n1024 MB", fs=6.2)
    arrow(20.4, 52.7, 23.6, 52.7)
    # container arm
    box(58, 47, 40, 15, "", fc="#fdf0ea", ec=COLOR["container"])
    ax.text(78, 59.3, "Container-based deployment", ha="center", fontsize=6.8, weight="bold", color=COLOR["container"])
    box(61, 49, 12, 7.5, "ALB", fs=6.2)
    box(76.5, 49, 19, 7.5, "EC2 m7i.large\nDocker ×1–3", fs=6.2)
    arrow(73.4, 52.7, 76.1, 52.7)
    arrow(45, 69.6, 22, 62.6, COLOR["lambda"]); arrow(55, 69.6, 78, 62.6, COLOR["container"])
    # shared
    box(20, 26, 60, 12, "Same deployment artifact (fitness-service zip)\nsame OS image and Node.js 22 build\n0.58 vCPU and 1 GB per instance or replica", fc="#ffffff", ls="--", fs=6.2)
    arrow(31.5, 46.6, 38, 38.4); arrow(86, 46.6, 62, 38.4)
    box(6, 3, 42, 13, "Aurora PostgreSQL\nServerless v2 (0.5–2 ACU)\nshared by both arms", fc="#f2f2f2", fs=6.2)
    box(54, 3, 40, 13, "Secrets Manager endpoint\nprivate subnets, same\nsecurity group", fc="#f2f2f2", fs=6.2)
    arrow(40, 25.6, 30, 16.4); arrow(60, 25.6, 70, 16.4)
    fig.tight_layout(pad=0.2); fig.savefig(os.path.join(HERE, "fig-architecture.png"), dpi=300); plt.close(fig)


# ---------------------------------------------------------------- Fig. 2 latency
def latency():
    fig, axes = plt.subplots(2, 1, figsize=(W, 3.35))
    for ax, wl, title in ((axes[0], "overhead", "(a) Platform path: 401 response, no database"),
                          (axes[1], "read", "(b) Catalogue reads from PostgreSQL")):
        for arm in ("lambda", "container"):
            x, gs = pts(arm, wl)
            for q, lw, alpha in (("p50", 1.0, 1.0), ("p99", 2.0, 1.0)):
                y = [g[q]["mean"] for g in gs]; e = [g[q]["sd"] for g in gs]
                ax.errorbar(x, y, yerr=e, fmt=STYLE[arm], marker=MARK[arm], ms=3.5, lw=lw, color=COLOR[arm], capsize=2, elinewidth=0.7,
                            label=f"{NAME[arm]} {q}")
        ax.set_xscale("log"); ax.set_yscale("log"); ax.set_title(title, fontsize=8)
        ax.set_xlabel("Offered load (requests/s)"); ax.set_ylabel("Latency (ms)")
        ax.yaxis.set_major_formatter(PLAIN); ax.yaxis.set_minor_formatter(NullFormatter()); ax.xaxis.set_major_formatter(PLAIN)
    axes[0].set_yticks([2, 3, 5, 10, 20, 30])
    h, l = axes[0].get_legend_handles_labels()
    fig.legend(h, l, loc="upper center", ncol=2, fontsize=6.8)
    fig.tight_layout(rect=(0, 0, 1, 0.88), h_pad=0.6); fig.savefig(os.path.join(HERE, "fig-latency.png"), dpi=300); plt.close(fig)


# ---------------------------------------------------------------- Fig. 3 scaling (reads)
def scaling():
    arms = ("lambda", "container", "container-r2", "container-r3")
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(W, 3.35), sharex=True)
    for arm in arms:
        x, gs = pts(arm, "read")
        a1.plot(x, [g["goodput_rps"]["mean"] for g in gs], STYLE[arm], marker=MARK[arm], ms=3.5, lw=1.4, color=COLOR[arm], label=NAME[arm])
        a2.plot(x, [g["p99"]["mean"] for g in gs], STYLE[arm], marker=MARK[arm], ms=3.5, lw=1.4, color=COLOR[arm])
    a1.plot([10, 200], [10, 200], color="#8a8a8a", lw=0.8, ls=":"); a1.text(120, 135, "ideal", fontsize=6.5, color="#555555", rotation=33)
    a2.axhline(1000, color="#8a8a8a", lw=0.8, ls=":"); a2.text(10.5, 1150, "SLO: p99 = 1 s", fontsize=6.5, color="#555555")
    for ax in (a1, a2):
        ax.set_xscale("log"); ax.set_yscale("log")
        for axis in (ax.xaxis, ax.yaxis): axis.set_major_formatter(PLAIN); axis.set_minor_formatter(NullFormatter())
    a1.set_xticks([10, 25, 50, 100, 200]); a1.set_yticks([10, 25, 50, 100, 200])
    a1.set_ylabel("Successful requests/s"); a2.set_ylabel("p99 latency (ms)"); a2.set_xlabel("Offered load (requests/s)")
    a1.set_title("(a) Goodput", fontsize=8); a2.set_title("(b) Tail latency", fontsize=8)
    h, l = a1.get_legend_handles_labels()
    fig.legend(h, l, loc="upper center", ncol=2, fontsize=6.8)
    fig.tight_layout(rect=(0, 0, 1, 0.88), h_pad=0.6); fig.savefig(os.path.join(HERE, "fig-scaling.png"), dpi=300); plt.close(fig)


# ---------------------------------------------------------------- cost model (shared with build_paper.py)
def cost_model():
    """Eq. (2)-(4): Lambda cost per successful request from measured billed duration; container cost per hour; break-even."""
    def lam_cost(billed_ms):
        return PR["lambda_request_usd"] + PR["apigw_http_request_usd"] + PR["lambda_gb_second_usd_x86_tier1"] * PR["lambda_memory_gb"] * billed_ms / 1000
    def billed(wl, rates):
        v = [S["phases"][f"lambda|{wl}|steps|step-{r}"]["cost"]["billed_ms_avg"] for r in rates]
        return float(np.mean(v))
    b_ovh = billed("overhead", (10, 25, 50, 100, 200, 400))
    b_read = billed("read", (10, 25, 50))          # steps the serverless arm sustained (error <= 1 %)
    c_ovh, c_read = lam_cost(b_ovh), lam_cost(b_read)
    host_cap_read = max(v for k, v in S["sustainable_offered_rps"].items() if k.startswith("container") and k.endswith("|read") and v)
    host_cap_ovh = S["sustainable_offered_rps"]["container|overhead"]
    fixed_h = PR["alb_hour_usd"] + PR["alb_lcu_hour_usd"] + 2 * PR["public_ipv4_hour_usd"]   # 1 LCU minimum, 2 public IPv4 (ALB, 2 AZ)
    host_h = PR["ec2_hour_usd"]["m7i.large"]
    one_host_h = host_h + fixed_h
    be_read = one_host_h / (3600 * c_read)
    return dict(b_ovh=b_ovh, b_read=b_read, c_ovh=c_ovh, c_read=c_read, host_cap_read=host_cap_read, host_cap_ovh=host_cap_ovh,
                fixed_h=fixed_h, host_h=host_h, one_host_h=one_host_h, be_read=be_read,
                cont_read_per_req_at_cap=one_host_h / (3600 * host_cap_read),
                cont_ovh_per_req_at_cap=one_host_h / (3600 * host_cap_ovh))


def cost():
    m = cost_model()
    x = np.logspace(-1, 3, 400); sec = 30 * 24 * 3600
    lam = m["c_read"] * x * sec
    cont = (np.ceil(x / m["host_cap_read"]) * m["host_h"] + m["fixed_h"]) * 720
    fig, ax = plt.subplots(figsize=(W, 2.05))
    ax.plot(x, lam, "-", color=COLOR["lambda"], lw=1.8, label="Serverless (measured cost per request)")
    ax.plot(x, cont, "--", color=COLOR["container"], lw=1.8, label=f"Container (one host per {m['host_cap_read']:.0f} requests/s)")
    ax.axvline(m["be_read"], color="#8a8a8a", lw=0.8, ls=":")
    ax.annotate(f"break-even ≈ {m['be_read']:.0f} requests/s", (m["be_read"], 1.0), xytext=(4, 0), textcoords="offset points", fontsize=6.5, color="#333333")
    ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlabel("Average traffic (requests/s)"); ax.set_ylabel("Cost per month (USD)")
    ax.legend(fontsize=6.5, loc="upper left")
    fig.tight_layout(pad=0.3); fig.savefig(os.path.join(HERE, "fig-cost.png"), dpi=300); plt.close(fig)
    return m


if __name__ == "__main__":
    architecture(); latency(); scaling(); m = cost()
    print(json.dumps(m, indent=1))
