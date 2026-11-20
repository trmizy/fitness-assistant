"""Collect server-side evidence for every load phase found in the client CSVs.

For each (arm, workload, profile, rep, phase) window it stores:
  lambda arm    : CloudWatch Logs Insights aggregate over the function's REPORT
                  lines (count, duration percentiles, billed duration, cold
                  starts = rows with @initDuration) plus the raw init durations;
  both arms     : CloudWatch metrics (Lambda concurrency/throttles, Aurora
                  connections/ACU/CPU, ALB response time, EC2 CPU).

Read-only AWS calls (logs start-query/get-query-results, cloudwatch
get-metric-data). Usage:
  python collect_aws.py --results ../results --out ../results/aws.json \
      [--alb-suffix app/xxx/yyy --tg-suffix targetgroup/xxx/yyy --instance i-...]
"""
import argparse, csv, glob, json, os, subprocess, time
from collections import defaultdict
from datetime import datetime, timezone

REGION = "ap-southeast-1"
FUNCTION = "fitness-assistant-dev-fitness"
LOG_GROUP = f"/aws/lambda/{FUNCTION}"
AURORA = "fitness-assistant-dev-aurora"


def aws(*args):
    out = subprocess.run(["aws", *args, "--region", REGION, "--output", "json"],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out) if out.strip() else {}


def windows(results_dir):
    w = defaultdict(lambda: [float("inf"), 0.0, 0])
    for path in glob.glob(os.path.join(results_dir, "*.csv")):
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                if r["profile"] == "smoke":
                    continue
                k =(r["arm"], r["workload"], r["profile"], r["rep"], r["phase"])
                s = float(r["sched_ms"])
                e = float(r["end_ms"]) if r["end_ms"] else s
                w[k][0] = min(w[k][0], s); w[k][1] = max(w[k][1], e); w[k][2] += 1
    return w


def insights(query, start_ms, end_ms):
    q = aws("logs", "start-query", "--log-group-name", LOG_GROUP,
            "--start-time", str(int(start_ms // 1000) - 1), "--end-time", str(int(end_ms // 1000) + 2),
            "--query-string", query)
    while True:
        time.sleep(1.5)
        r = aws("logs", "get-query-results", "--query-id", q["queryId"])
        if r["status"] in ("Complete", "Failed", "Cancelled", "Timeout"):
            return [{c["field"]: c["value"] for c in row} for row in r.get("results", [])]


AGG = ('filter @type = "REPORT" | stats count(*) as invocations, avg(@duration) as dur_avg, '
       'pct(@duration, 50) as dur_p50, pct(@duration, 95) as dur_p95, pct(@duration, 99) as dur_p99, '
       'avg(@billedDuration) as billed_avg, sum(@billedDuration) as billed_sum, '
       'max(@maxMemoryUsed) as mem_max_bytes, count(@initDuration) as cold_starts, '
       'avg(@initDuration) as init_avg, max(@initDuration) as init_max')
INITS = 'filter @type = "REPORT" and ispresent(@initDuration) | fields @initDuration, @duration | limit 10000'


def metrics(start_ms, end_ms, alb, tg, instance):
    def q(i, ns, name, dims, stat, period=60):
        return {"Id": i, "MetricStat": {"Metric": {"Namespace": ns, "MetricName": name,
                "Dimensions": [{"Name": k, "Value": v} for k, v in dims]}, "Period": period, "Stat": stat}}
    qs = [q("lconc", "AWS/Lambda", "ConcurrentExecutions", [("FunctionName", FUNCTION)], "Maximum"),
          q("lthr", "AWS/Lambda", "Throttles", [("FunctionName", FUNCTION)], "Sum"),
          q("lerr", "AWS/Lambda", "Errors", [("FunctionName", FUNCTION)], "Sum"),
          q("dbconn", "AWS/RDS", "DatabaseConnections", [("DBClusterIdentifier", AURORA)], "Maximum"),
          q("dbacu", "AWS/RDS", "ServerlessDatabaseCapacity", [("DBClusterIdentifier", AURORA)], "Maximum"),
          q("dbcpu", "AWS/RDS", "CPUUtilization", [("DBClusterIdentifier", AURORA)], "Maximum")]
    if alb:
        qs.append(q("albrt", "AWS/ApplicationELB", "TargetResponseTime", [("LoadBalancer", alb)], "p99"))
        qs.append(q("alb5xx", "AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", [("LoadBalancer", alb)], "Sum"))
    if alb and tg:
        qs.append(q("healthy", "AWS/ApplicationELB", "HealthyHostCount", [("LoadBalancer", alb), ("TargetGroup", tg)], "Minimum"))
    if instance:
        qs.append(q("ec2cpu", "AWS/EC2", "CPUUtilization", [("InstanceId", instance)], "Maximum"))
    iso = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = aws("cloudwatch", "get-metric-data", "--start-time", iso(start_ms - 60000), "--end-time", iso(end_ms + 60000),
            "--metric-data-queries", json.dumps(qs))
    return {m["Id"]: (max(m["Values"]) if m["Values"] else None) for m in r["MetricDataResults"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="../results")
    ap.add_argument("--out", default="../results/aws.json")
    ap.add_argument("--alb-suffix"); ap.add_argument("--tg-suffix"); ap.add_argument("--instance")
    a = ap.parse_args()
    done = json.load(open(a.out)) if os.path.exists(a.out) else {}
    for k, (s, e, n) in sorted(windows(a.results).items()):
        key = "|".join(k)
        if key in done:
            continue
        rec = {"window_start_ms": s, "window_end_ms": e, "client_requests": n}
        if k[0] == "lambda":
            rec["report"] = (insights(AGG, s, e) or [{}])[0]
            rec["init_durations"] = insights(INITS, s, e)
        rec["metrics"] = metrics(s, e, a.alb_suffix, a.tg_suffix, a.instance)
        done[key] = rec
        json.dump(done, open(a.out, "w"), indent=1)
        print(key, rec.get("report", {}).get("invocations"), rec["metrics"])


if __name__ == "__main__":
    main()
