"""Analyze container-vs-serverless load runs.

Inputs : ../results/*.csv            (one row per request, from loadgen.mjs)
         ../results/aws.json         (optional, from collect_aws.py)
         ../results/container_start.json (optional, container cold-start timings)
         prices.json
Outputs: ../results/analysis/summary.json, steps.csv, fig-*.png

Usage: python analyze.py [--results ../results] [--trim 15] [--slo-ms 1000]
       [--container-hosts 1] [--host-type m7i.large]
"""
import argparse, csv, glob, json, math, os
from collections import defaultdict

import numpy as np

ARMS = ("lambda", "container")
# validated palette (dataviz); r2/r3 have low contrast -> markers + direct labels
COLOR = {"lambda": "#2a78d6", "container": "#eb6834", "container-r2": "#1baf7a", "container-r3": "#eda100"}
MARK = {"lambda": "o", "container": "s", "container-r2": "^", "container-r3": "D"}
STYLE = {"lambda": "-", "container": "--", "container-r2": "-.", "container-r3": ":"}
SHORT = {"lambda": "Serverless", "container": "Container ×1", "container-r2": "Container ×2", "container-r3": "Container ×3"}


def load(results):
    rows = defaultdict(list)
    for p in sorted(glob.glob(os.path.join(results, "*.csv"))):
        with open(p, newline="") as f:
            for r in csv.DictReader(f):
                if r["profile"] == "smoke":  # sanity checks only, never results
                    continue
                rows[(r["arm"], r["workload"], r["profile"], r["phase"], int(r["rep"]))].append(r)
    return rows


def pct(a, q):
    return float(np.percentile(a, q)) if len(a) else None


def phase_stats(rs, trim_s):
    sched = np.array([float(r["sched_ms"]) for r in rs])
    t0 = sched.min()
    keep = [r for r in rs if float(r["sched_ms"]) - t0 >= trim_s * 1000] or rs
    # n scheduled requests span (n-1)/rate seconds; add one interval so goodput == rate when nothing fails
    dur = (max(float(r["sched_ms"]) for r in keep) - min(float(r["sched_ms"]) for r in keep)) / 1000 + 1 / float(rs[0]["rate"])
    ok = [r for r in keep if r["ok"] == "1"]
    lat = np.array([float(r["latency_ms"]) for r in ok])
    lat_s = np.array([float(r["latency_sched_ms"]) for r in ok])
    errs = defaultdict(int)
    for r in keep:
        if r["ok"] != "1":
            errs[r["error"] or f"http_{r['status']}"] += 1
    return {
        "offered_rate": float(rs[0]["rate"]), "n": len(keep), "ok": len(ok),
        "error_rate": 1 - len(ok) / len(keep), "goodput_rps": len(ok) / dur,
        "p50": pct(lat, 50), "p95": pct(lat, 95), "p99": pct(lat, 99), "max": float(lat.max()) if len(lat) else None,
        "p99_from_schedule": pct(lat_s, 99), "errors": dict(errs),
        "_lat": lat,
    }


def agg(reps):
    out = {}
    for k in ("goodput_rps", "error_rate", "p50", "p95", "p99", "p99_from_schedule"):
        v = [r[k] for r in reps if r[k] is not None]
        out[k] = {"mean": float(np.mean(v)) if v else None, "sd": float(np.std(v, ddof=1)) if len(v) > 1 else 0.0,
                  "min": min(v) if v else None, "max": max(v) if v else None}
    pooled = np.concatenate([r["_lat"] for r in reps]) if reps else np.array([])
    out["pooled"] = {"n": int(len(pooled)), "p50": pct(pooled, 50), "p95": pct(pooled, 95), "p99": pct(pooled, 99)}
    out["reps"] = len(reps)
    out["offered_rate"] = reps[0]["offered_rate"]
    return out


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--results", default=os.path.join(here, "..", "results"))
    ap.add_argument("--trim", type=float, default=15.0, help="seconds dropped at the start of each phase")
    ap.add_argument("--slo-ms", type=float, default=1000.0, help="p99 latency objective for 'sustainable'")
    ap.add_argument("--max-error", type=float, default=0.01)
    ap.add_argument("--container-hosts", type=int, default=1)
    ap.add_argument("--host-type", default="m7i.large")
    # container read rep 1 started right after the Lambda run had saturated Aurora
    # (CPU 100 %, ~280 idle Lambda connections) -> carry-over; replaced by rep 4.
    ap.add_argument("--exclude", nargs="*", default=["container|read|steps|1"],
                    help="arm|workload|profile|rep runs to leave out (documented in README)")
    a = ap.parse_args()
    prices = json.load(open(os.path.join(here, "prices.json")))
    aws = {}
    if os.path.exists(os.path.join(a.results, "aws.json")):
        aws = json.load(open(os.path.join(a.results, "aws.json")))
    outdir = os.path.join(a.results, "analysis"); os.makedirs(outdir, exist_ok=True)

    rows = load(a.results)
    per = defaultdict(list)  # (arm, workload, profile, phase) -> [rep stats]
    for (arm, wl, prof, phase, rep), rs in rows.items():
        if f"{arm}|{wl}|{prof}|{rep}" in a.exclude:
            continue
        trim = a.trim if prof in ("steps", "spike", "custom") and phase not in ("warmup",) else 0
        st = phase_stats(rs, trim)
        st["rep"] = rep
        rep_aws = aws.get("|".join([arm, wl, prof, str(rep), phase]), {})
        if rep_aws.get("report"):
            st["lambda_report"] = rep_aws["report"]
        st["metrics"] = rep_aws.get("metrics")
        per[(arm, wl, prof, phase)].append(st)

    summary = {"config": vars(a), "prices_source": prices["_source"], "phases": {}}
    steps_csv = []
    for key, reps in sorted(per.items()):
        g = agg(reps)
        arm, wl, prof, phase = key
        # ---- cost per 1,000 successful requests ------------------------------
        cost = None
        if arm == "lambda":
            billed = [float(r["lambda_report"]["billed_avg"]) for r in reps if r.get("lambda_report", {}).get("billed_avg")]
            if billed:
                gbs = np.mean(billed) / 1000 * prices["lambda_memory_gb"]
                per_req = prices["lambda_request_usd"] + gbs * prices["lambda_gb_second_usd_x86_tier1"] + prices["apigw_http_request_usd"]
                cost = {"usd_per_1k_ok": per_req * 1000 / max(1e-9, 1 - g["error_rate"]["mean"]),
                        "billed_ms_avg": float(np.mean(billed))}
        else:
            gp = g["goodput_rps"]["mean"]
            if gp:
                sample = rows.get((arm, wl, prof, phase, reps[0]["rep"]), [])
                bytes_avg = float(np.mean([float(r["bytes"]) for r in sample if r["bytes"]])) if sample else 0.0
                lcu = max(gp / 1000.0, gp * bytes_avg * 3600 / 1e9, 1e-9)  # rule-eval vs processed-bytes dimensions
                hourly = (a.container_hosts * prices["ec2_hour_usd"][a.host_type] + prices["alb_hour_usd"]
                          + lcu * prices["alb_lcu_hour_usd"] + prices["public_ipv4_hour_usd"] * 2)
                cost = {"usd_per_1k_ok_at_this_rate": hourly / (gp * 3600) * 1000, "hourly_usd": hourly, "alb_lcu": lcu}
        g["cost"] = cost
        summary["phases"]["|".join(key)] = g
        steps_csv.append([arm, wl, prof, phase, g["offered_rate"], g["reps"], g["goodput_rps"]["mean"],
                          g["error_rate"]["mean"], g["p50"]["mean"], g["p95"]["mean"], g["p99"]["mean"],
                          g["p99"]["sd"], (cost or {}).get("usd_per_1k_ok") or (cost or {}).get("usd_per_1k_ok_at_this_rate")])

    # ---- sustainable throughput per arm/workload -------------------------------
    sust = {}
    for arm in sorted({k.split("|")[0] for k in summary["phases"]}):
        for wl in ("overhead", "read"):
            best = None
            for key, g in summary["phases"].items():
                k_arm, k_wl, prof, phase = key.split("|")
                if (k_arm, k_wl, prof) != (arm, wl, "steps") or not phase.startswith("step-"):
                    continue
                if g["error_rate"]["mean"] <= a.max_error and (g["p99"]["mean"] or 1e18) <= a.slo_ms:
                    if best is None or g["offered_rate"] > best:
                        best = g["offered_rate"]
            sust[f"{arm}|{wl}"] = best
    summary["sustainable_offered_rps"] = sust

    # ---- cold start -------------------------------------------------------------
    cold = {}
    for key, rec in aws.items():
        if key.startswith("lambda|") and "|burst|" in key:
            inits = [float(r["@initDuration"]) for r in rec.get("init_durations", []) if r.get("@initDuration")]
            cold[key] = {"cold_starts": len(inits), "client_requests": rec["client_requests"],
                         "init_ms_p50": pct(np.array(inits), 50), "init_ms_p95": pct(np.array(inits), 95),
                         "init_ms_max": max(inits) if inits else None}
    cs = os.path.join(a.results, "container_start.json")
    if os.path.exists(cs):
        cold["container_start"] = json.load(open(cs))
    summary["cold_start"] = cold

    with open(os.path.join(outdir, "steps.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["arm", "workload", "profile", "phase", "offered_rps", "reps", "goodput_rps", "error_rate",
                    "p50_ms", "p95_ms", "p99_ms", "p99_sd_ms", "usd_per_1k_ok"])
        w.writerows(steps_csv)
    json.dump(summary, open(os.path.join(outdir, "summary.json"), "w"), indent=1, default=float)
    figures(summary, prices, a, outdir)
    print(json.dumps({"sustainable_offered_rps": sust, "cold_start": cold}, indent=1, default=float))


def figures(summary, prices, a, outdir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "Times New Roman", "font.size": 8, "axes.spines.top": False,
                         "axes.spines.right": False, "axes.grid": True, "grid.color": "#e5e5e5", "grid.linewidth": 0.6})

    # Fig: p50/p95/p99 vs offered load, one panel per workload (shared units, one axis each).
    wls = [w for w in ("overhead", "read") if any(k.split("|")[1] == w for k in summary["phases"])]
    if wls:
        fig, axes = plt.subplots(1, len(wls), figsize=(3.45 if len(wls) == 1 else 7.0, 2.4), squeeze=False)
        for ax, wl in zip(axes[0], wls):
            for arm in ARMS:
                pts = sorted((g["offered_rate"], g) for k, g in summary["phases"].items()
                             if k.startswith(f"{arm}|{wl}|steps|step-"))
                if not pts:
                    continue
                x = [p[0] for p in pts]
                for q, alpha, lw in (("p50", 1.0, 1.0), ("p99", 1.0, 2.0)):
                    y = [p[1][q]["mean"] for p in pts]
                    ax.plot(x, y, STYLE[arm], marker=MARK[arm], ms=4, lw=lw, color=COLOR[arm], alpha=alpha,
                            label=f"{SHORT[arm]} {q}")
            ax.set_xscale("log"); ax.set_yscale("log")
            ax.set_xlabel("Offered load (requests/s)"); ax.set_ylabel("Latency (ms)")
            ax.set_title("Platform path (401, no DB)" if wl == "overhead" else "Catalogue reads (PostgreSQL)", fontsize=8)
        # one shared legend above the panels so it never covers data
        h, l = axes[0][0].get_legend_handles_labels()
        fig.legend(h, l, loc="upper center", ncol=4, fontsize=6.5, frameon=False)
        fig.tight_layout(rect=(0, 0, 1, 0.88)); fig.savefig(os.path.join(outdir, "fig-latency.png"), dpi=300); plt.close(fig)

    # Fig: monthly cost vs average traffic (Lambda measured per-request cost vs container fixed capacity).
    lam = [g["cost"]["usd_per_1k_ok"] for k, g in summary["phases"].items()
           if k.startswith("lambda|read|steps|step-") and g.get("cost")]
    # capacity of ONE host = best sustainable read load over 1-3 replicas on that host
    caps = [v for k, v in summary["sustainable_offered_rps"].items() if k.startswith("container") and k.endswith("|read") and v]
    cap = max(caps) if caps else None
    if lam and cap:
        per_req = float(np.median(lam)) / 1000
        x = np.logspace(-1, 3, 200)
        sec = 30 * 24 * 3600
        lam_month = per_req * x * sec
        hosts = np.ceil(x / cap)
        cont_month = (hosts * prices["ec2_hour_usd"][a.host_type] + prices["alb_hour_usd"]
                      + np.maximum(x / 1000, 1e-9) * prices["alb_lcu_hour_usd"] + 2 * prices["public_ipv4_hour_usd"]) * 720
        fig, ax = plt.subplots(figsize=(3.45, 2.3))
        ax.plot(x, lam_month, "-", color=COLOR["lambda"], lw=2, label="Serverless")
        ax.plot(x, cont_month, "--", color=COLOR["container"], lw=2, label="Container")
        ax.set_xscale("log"); ax.set_yscale("log")
        ax.set_xlabel("Average traffic (requests/s)"); ax.set_ylabel("Cost per month (USD)")
        ax.legend(frameon=False, fontsize=7)
        cross = x[np.argmax(lam_month > cont_month)] if (lam_month > cont_month).any() else None
        if cross is not None:
            ax.axvline(cross, color="#8a8a8a", lw=0.8, ls=":")
            ax.annotate(f"break-even ≈ {cross:.1f} req/s", (cross, lam_month.min()), xytext=(4, 0),
                        textcoords="offset points", fontsize=6.5, color="#333333", va="bottom")
        summary["break_even_rps"] = float(cross) if cross is not None else None
        fig.tight_layout(); fig.savefig(os.path.join(outdir, "fig-cost.png"), dpi=300); plt.close(fig)
        json.dump(summary, open(os.path.join(outdir, "summary.json"), "w"), indent=1, default=float)

    # Fig: horizontal scaling (read workload): goodput and p99 per arm, two panels, one axis each.
    arms = [a for a in ("lambda", "container", "container-r2", "container-r3")
            if any(k.startswith(f"{a}|read|steps|step-") for k in summary["phases"])]
    if len(arms) > 2:
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.0, 2.5))
        for arm in arms:
            pts = sorted((g["offered_rate"], g) for k, g in summary["phases"].items() if k.startswith(f"{arm}|read|steps|step-"))
            x = [p[0] for p in pts]
            for ax, key in ((ax1, "goodput_rps"), (ax2, "p99")):
                y = [p[1][key]["mean"] for p in pts]
                ax.plot(x, y, STYLE[arm], marker=MARK[arm], ms=4, lw=1.5, color=COLOR[arm], label=SHORT[arm])
        ax1.plot([min(x), max(x)], [min(x), max(x)], color="#8a8a8a", lw=0.8, ls=":")
        ax1.set_xscale("log"); ax1.set_yscale("log"); ax1.set_xlabel("Offered load (requests/s)"); ax1.set_ylabel("Successful requests/s")
        ax2.set_xscale("log"); ax2.set_yscale("log"); ax2.set_xlabel("Offered load (requests/s)"); ax2.set_ylabel("p99 latency (ms)")
        # end points coincide at the time-out ceiling, so direct labels collide: one shared legend instead
        h, l = ax1.get_legend_handles_labels()
        fig.legend(h, l, loc="upper center", ncol=len(arms), fontsize=6.5, frameon=False)
        fig.tight_layout(rect=(0, 0, 1, 0.9)); fig.savefig(os.path.join(outdir, "fig-scaling.png"), dpi=300); plt.close(fig)


if __name__ == "__main__":
    main()
