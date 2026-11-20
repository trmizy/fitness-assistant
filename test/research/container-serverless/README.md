# Container vs Serverless — fitness-service (NCKH)

Paper: *Comparing Latency, Scalability and Cost of Container and Serverless
Deployment for a Fitness Microservice*.

## Design (what makes the comparison fair)

| | Serverless arm | Container arm |
|---|---|---|
| Code | `fitness-assistant-dev-fitness` deployment zip | **the same zip**, downloaded from the function (`container/entry.js` calls `app.listen` instead of `serverless-http`) |
| OS / Node | Lambda nodejs22.x (AL2023) | `public.ecr.aws/lambda/nodejs:22` image (same OS + Node build) |
| Compute | 1024 MB (≈0.58 vCPU) | `--cpus 0.58 --memory 1024m` per replica, 1–3 replicas on one m7i.large |
| Front door | API Gateway HTTP API | ALB |
| Network | private-app subnet A/B, Lambda SG | private-app subnet A, **same** Lambda SG |
| Config | function env, DB secret at cold start | same env vars copied from the function, same secret |
| Redis | disabled | disabled (`FITNESS_DISABLE_REDIS=true`) |
| Database | Aurora PostgreSQL Serverless v2 (0.5–2 ACU), shared | same cluster |
| Client | open-loop generator on c7i.xlarge, same region, same public-endpoint path | same |

Workloads (public, read-only — nothing is written to the DB):
- `overhead`: `GET /equipment/me` without a token → 401 from the auth middleware, before any DB or downstream call → **platform path only**.
- `read`: 50% `GET /exercises?page=…&limit=20`, 30% `GET /exercises/:id`, 20% `GET /exercises/filter-options` → **PostgreSQL-backed reads**.

Profiles (`loadgen/loadgen.mjs`): `steps` (warm-up 10 rps, then 10/25/50/100/200/400 rps × 120 s, first 15 s of each step trimmed),
`spike` (10 → 300 → 10 rps), `burst` (N simultaneous requests after ≥15 min idle = Lambda cold starts), `custom`.
Safety: the generator aborts if >50% of requests fail in a 10 s window.

Metrics: p50/p95/p99 (client, and from schedule = coordinated-omission-aware), goodput, error rate,
Lambda REPORT (duration, billed duration, Init Duration, cold-start count), CloudWatch (Lambda concurrency/throttles,
Aurora connections/ACU/CPU, ALB response time, EC2 CPU), cost per 1,000 successful requests, monthly cost vs traffic and break-even.
Prices: `analysis/prices.json` (AWS Price List API, ap-southeast-1, retrieved 2026-11-12).

## Run order

```bash
# 0. start DEV backend (Aurora + NAT + Secrets endpoint), ~18 min
powershell -File scripts/aws/dev-start.ps1 -Backend
cd test/research/container-serverless
./ops/exp.sh deploy                       # temporary stack nckh-exp-container-serverless
./ops/exp.sh push
./ops/exp.sh host 1 --cold                # build, start 1 replica, record container start-up
./ops/exp.sh run lambda read smoke 1      # sanity: both arms answer
./ops/exp.sh run container read smoke 1

# 1. main runs (alternate arms; Lambda idles ≥15 min before each burst)
./ops/exp.sh run lambda    read steps 1 --max-rate 400
./ops/exp.sh run container read steps 1 --max-rate 400
./ops/exp.sh run lambda    overhead burst 1 --burst-size 50   # after ≥15 min Lambda idle
...  reps 2, 3; overhead steps reps 1, 2; spike rep 1 per arm
# 2. horizontal scaling of the container arm
./ops/exp.sh host 2 --cold && ./ops/exp.sh run container read steps 21 --max-rate 400
./ops/exp.sh host 3 --cold && ./ops/exp.sh run container read steps 31 --max-rate 400

# 3. evidence + analysis (wait ~5 min for Logs Insights to index)
./ops/exp.sh fetch && ./ops/exp.sh collect
python analysis/analyze.py

# 4. ALWAYS tear down, then stop DEV
./ops/exp.sh teardown
powershell -File scripts/aws/dev-stop.ps1
```

## Limitations to state in the paper
- One service, one region, one DEV database shared by both arms (DB is a common bottleneck; Aurora max 2 ACU).
- DEV environment may carry other traffic; Lambda REPORT counts are compared with client counts per window.
- Container arm is a single host (no autoscaling policy); scaling is measured with 1–3 fixed replicas.
- Load generated from one region-local client; latencies include the front door (API Gateway vs ALB).

## Protocol deviations (2026-11-12, main run) — recorded as they happened
1. `lambda read steps r1` (max 400): the DEV Aurora (max 2 ACU) hit 100% CPU at 50–100 req/s;
   at the 200 req/s step Lambda scaled to 914 concurrent executions (account limit 1000) and
   658 DB connections, the app returned HTTP 500 and the generator aborted (>50% errors).
   Lambda itself had 0 throttles and 0 errors. Steps 10–100 of this run are complete and kept.
2. DB-backed reads were therefore capped at **100 req/s** (within the approved 400);
   the platform-only workload (401, no DB) keeps 400 req/s.
3. `container read steps r1` started right after (1) while Aurora was still at 100% CPU with
   ~280 idle Lambda connections; it aborted at 50 req/s with Prisma pool time-outs
   (default pool = 5 connections, 10 s wait). It is kept on disk but **excluded** from the
   analysis (`--exclude` default) and replaced by rep 4.
4. From then on (`ops/run-all3.sh`): 3–5 min cool-down after every DB-backed run and the arm
   order alternates per repetition (rep 2 container first, rep 3 Lambda first).
5. Container read reps 2, 3 and 4 (all after a cool-down) **also** aborted at the 50 req/s step
   with the same Prisma pool time-outs, so the rep-1 failure was not only carry-over: one replica
   (default pool = 5 connections) saturates between 25 and 50 req/s on this DB. 2 replicas held
   50 req/s (p99 1.26 s > SLO), 3 replicas held 50 req/s (p99 42 ms); both failed at 100 req/s.
6. Both read spikes (10 → 100 → 10 req/s) aborted in the spike phase (container 87% errors,
   Lambda 48% errors, Aurora 100% CPU); the 200 req/s point of `lambda read` exists only in rep 1.
7. Aurora CPU was already 63–79% at the 10 req/s warm-up and 100% from 25 req/s on, for both arms:
   the shared DEV database, not the compute tier, bounds every DB-backed result.

## Run record (2026-11-12)
Main schedule finished 22:15 (`ops/run-all3.sh`, log `results/run-all.log`). Evidence:
`results/*.csv` (client), `results/aws.json` (Lambda REPORT + CloudWatch),
`results/container_start.json`, analysis in `results/analysis/` (`steps.csv`, `summary.json`, 3 figures).
All experiment resources deleted (`results/teardown.log`) and DEV stopped (`results/dev-stop.log`).

## Paper
`paper/make_figures.py` (single-column figures + cost model) then
`paper/build_paper.py --template paper/SSRC_Word_Template.docx --out paper/NCKH-Container-Serverless-vN.docx`.
Every number in the text is read from `results/` and `analysis/prices.json`; edit the text in `build_paper.py` and rebuild,
never hand-edit numbers in the .docx. Word COM converts .docx → .pdf. Draft v5 (2026-11-13): 5 pages (user limit; cold-start table folded into text, figures shorter), 5 tables, 4 figures, 5 equations, 15 references (limit 15), author names without diacritics (DOIs checked on CrossRef; USENIX pages on usenix.org).
