# Gymini Semantic Fine-Tune — V2.1R Environment Recovery Attempt

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout (verified at start and end). Branch `aws-deploy`. No tracked
production file touched. V2 and V2.1 artifacts verified intact (see §2) —
nothing in this task modified them. Heldout (`datasets/processed/v2/heldout.jsonl`)
was never opened. No training ran; no checkpoint of any kind was produced.

## 1. Outcome

**Environment recovery did not succeed.** The base-model load smoke test
(the first, smallest gate before any real evaluation or training could
begin) failed all 3 permitted attempts, each separated by a cooldown
(4 min, then 7 min). All 3 failures were **native segmentation faults**
during model load — notably, this is the *same* plain-`transformers`
loading path (no Unsloth) that worked reliably multiple times earlier in
the broader V2 task. **Model-load status: `ENVIRONMENT_MODEL_LOAD_BLOCKED`**
(not `HOST_COMMIT_LIMIT_BLOCKED` — none of this session's 3 failures
produced the `os error 1455` paging-file message; all 3 were plain
SIGSEGV with no distinguishing error text).

No further stage of the pipeline (V2-adapter smoke, remediation-baseline
evaluation, V2.1 training, any metric) could be attempted, since §19
explicitly gates everything downstream behind this smoke test passing.

## 2. V2 / V2.1 frozen-artifact verification (task §B/§C)

Read directly, not assumed:

- `datasets/processed/v2/manifest.json`: `totalCases=464`, `train=327`,
  `validation=71`, `heldout=66` — matches documented V2 state exactly.
- `outputs/train/qlora-baseline-v2/eval/metrics.json`: `jsonValidityRate=1.0`,
  `schemaValidityRate=0.7887`, `primaryIntentAccuracy=0.662`,
  `entityF1Mean=0.7817`, `correctionAccuracy=0.8333`, `referenceAccuracy=0.0`,
  `ambiguityAccuracy=0.8169`, `inventedEnumCount=4`,
  `errorBucketCounts.OVERCONFIDENT_AMBIGUITY=7` — matches the historical
  `QLORA_REGRESSED` V2 record exactly. **Not re-interpreted, not rewritten.**
- `datasets/processed/v2.1/manifest.json`: `v2TrainRowsCarriedOver=327`,
  `v2_1NewTrainRows=62`, `totalTrainRows=389`, `validationRemediationRows=12`
  — matches the documented V2.1 dataset state exactly. Both file hashes
  present and unchanged from prior session.

**Conclusion: both artifact sets are intact and immutable, as required.**

## 3. Environment preflight (task §12-17)

| Check | Observation |
|---|---|
| Timestamp | 2026-10-11T04:22:28Z (preflight start) |
| OS | Windows 11 Home Insider Preview Single Language |
| Python | 3.11.15 (`training/.venv`) |
| PyTorch | 2.10.0+cu126 |
| CUDA (torch-reported) | 12.6 |
| transformers | 5.5.0 |
| bitsandbytes | 0.49.2 |
| Unsloth | 2026.7.3 |
| GPU | NVIDIA GeForce RTX 3050 Ti Laptop GPU, driver 617.14 |
| VRAM | 4096 MiB total, 0 MiB used, 3962 MiB free (consistent before every attempt) |
| GPU temperature | 59-60°C across the whole preflight and all 3 attempts |
| GPU utilization | 0-2% (idle) before every attempt |
| GPU compute processes | none (confirmed via `nvidia-smi --query-compute-apps`, empty every check) |
| Free system RAM | 2.57-2.74 GB of 16 GB total (sampled before and after every attempt — essentially flat, not improving or worsening materially) |
| Free virtual memory | ~8.3-8.5 GB of ~37 GB total virtual |
| Pagefile | 22,366 MB allocated (manually sized, not auto-managed), 2,045-2,045 MB in current use, 3,338 MB peak — large aggregate headroom, no sign of literal exhaustion |
| Disk free (C:) | ~64.6 GB |
| Orphan Python processes | none, checked after every single attempt |
| WSL/Docker | `vmmemWSL` (~992 MB) present; training confirmed to run natively on Windows (`sys.platform == "win32"`, `.venv/Scripts/python.exe`), so WSL is **not required** for this experiment — genuine removable contention, reported factually rather than as generic "close everything" advice. Docker Desktop backend (~269 MB) also present; whether it's needed depends on whether the user is running the service stack, not assessed here. |

**Gross preflight checks (disk, GPU contention, orphan processes, pagefile
aggregate) all passed.** Per the task's own explicit instruction not to
invent an artificial free-RAM threshold, the preflight did not block on
the low-RAM number alone — it proceeded to the empirical smoke test
instead, consistent with how V2's own training eventually succeeded
despite similarly low readings earlier in that task.

## 4. Thermal-throttling verdict

**`THERMAL_THROTTLING_UNPROVEN`.** GPU temperature stayed at a modest
59-60°C immediately before each of the 3 attempts, and utilization was
0-2% (idle) at that point — the crashes occurred during model loading
(a CPU/host-memory-bound phase, before sustained GPU compute begins), not
during or after a period of heavy GPU load. There is no clock-speed or
utilization telemetry here suggesting throttling caused these specific
failures. (This is a different finding from the *training*-time slowdown
observed in the prior session's V2.1 time-estimate dry run, where step
times increased within a single run under sustained compute load — that
earlier observation remains a separate, plausible-but-unproven note, not
restated as fact here.)

## 5. Load-attempt log (this task)

| Attempt | Cooldown before | Result | Error |
|---|---|---|---|
| 1 | — (first attempt) | FAIL | Native segfault (SIGSEGV), no distinguishing message |
| 2 | 4 min | FAIL | Native segfault (SIGSEGV), no distinguishing message |
| 3 | 7 min | FAIL | Native segfault (SIGSEGV), no distinguishing message |

Verified after every attempt: no orphan Python process remained, GPU
memory returned to 0 MiB used, temperature stayed in the 59-60°C band.
Free RAM was essentially flat (2.57-2.74 GB) across the entire sequence —
neither the cooldowns nor the attempts themselves measurably changed it,
suggesting whatever the user's other processes are doing, they are
holding a fairly stable amount of memory rather than fluctuating in a way
a short wait reliably relieves.

**This is a different (worse) outcome than the prior V2.1 session**, where
the *training* script's load (via Unsloth) failed 3/3 times but the
*evaluation* script's load (plain `transformers`, the same code path used
here) had succeeded reliably multiple times. In this task, the plain
path itself failed 3/3 — a possible sign that host conditions have
degraded further since, though with only 3 trials this is not statistically
conclusive, just the honest observation.

## 6. Recommendation (reporting only, no privileged action taken)

Per task §13, no Windows pagefile, registry, WSL, Docker, or service
setting was changed autonomously. If a future session wants a materially
better chance of success:

- Closing WSL (`vmmemWSL`, ~992 MB) is specifically justified for *this*
  experiment, since it's confirmed not required to run it.
- A full reboot, if convenient, would most cleanly reset whatever is
  holding the ~13+ GB of RAM not currently free, if that's not immediately
  obvious from running applications alone.
- Re-running this exact task's preflight afterward would show whether
  free RAM improved before attempting the model load again — no numeric
  threshold is prescribed here (per the task's own instruction not to
  invent one), but materially more than the ~2.6-2.7 GB observed
  throughout this and the prior session would be a reasonable signal to
  try again.
