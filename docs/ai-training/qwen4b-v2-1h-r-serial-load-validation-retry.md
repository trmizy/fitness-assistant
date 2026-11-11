# Gymini Semantic Fine-Tune — V2.1H-R Serial Load Validation Retry

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset,
V2/V2.1 artifact, or package was modified. No model load was attempted;
no training, evaluation, Optuna, heldout access, or GGUF export occurred.
`PACKAGE_CHANGES = NONE`. `Agent-made SYSTEM_CHANGES = NONE`.

## Outcome

**`V2_1H_R_NOT_RUN_DUE_TO_HOST_MEMORY`.** The RAM stability window not
only failed the ≥3.0 GB gate again — this time it showed a **genuine,
accelerating downward trend** (not noisy fluctuation like V2.1H's
window), dropping from 2.70 GB to 1.30 GB over 3.3 minutes. Per this
task's own explicit fail-path instruction, nothing was changed (no
loader, threshold, package, or pagefile edit, no re-running of earlier
diagnostics) — this is reported plainly and the task stops here.

## 1. User-controlled host changes since V2.1H

**`USER_HOST_CHANGES_SINCE_V2_1H = NONE`.** `LastBootUpTime` unchanged
(2026-10-10 20:34:53 — no reboot). WSL (`vmmemWSL`) still running.
Docker Desktop (5 processes) and its backend still running, both with
the same start times as recorded in earlier sessions (2026-10-10
~20:38). Nothing was closed by the user between V2.1H and this task.

## 2. RAM stability window

10 samples, 20s apart, ~3.3 minutes total (raw data:
`training/diagnostics/model-load/v2.1h-r-preflight-ram.csv`):

| Time (UTC) | Free RAM |
|---|---|
| 06:09:59 | 2.70 GB |
| 06:10:20 | 2.30 GB |
| 06:10:41 | 2.45 GB |
| 06:11:02 | 2.32 GB |
| 06:11:23 | 2.00 GB |
| 06:11:44 | 1.77 GB |
| 06:12:05 | 1.87 GB |
| 06:12:26 | 1.58 GB |
| 06:12:49 | 1.49 GB |
| 06:13:10 | **1.30 GB** |

**Statistics**: n=10, min=1.301 GB, max=2.702 GB, mean=1.979 GB,
median=1.934 GB, latest=1.301 GB, **0/10 samples ≥ 3.0 GB**.

## 3. RAM stability-gate result: FAIL (decisively, on every criterion)

| Criterion (task §7) | Result |
|---|---|
| Latest sample ≥ 3.0 GB | FAIL (1.301 GB) |
| Majority of samples ≥ 3.0 GB | FAIL (0/10) |
| Median ≥ 3.0 GB | FAIL (1.934 GB) |
| No clear rapid downward trend | **FAIL** — unlike V2.1H's noisy-but-flat window, this window shows a real, fairly steady decline (minor local upticks at samples 3 and 7, but an unambiguous overall downward slope from 2.70→1.30 GB) |

This is a materially worse reading than V2.1H's own already-failing
window (mean 2.67 GB there vs. 1.98 GB here), despite no user-controlled
change to the host in between — consistent with ongoing, externally-
driven memory pressure from the same long-running applications (Memory
Compression, WSL, Docker Desktop, VS Code, browser) continuing to grow
their footprint over time, not something newly introduced by this task.

## 4. Everything else — correctly not attempted

Per §8's explicit instruction, no model load, no commit/pagefile
preflight (gated behind the RAM check passing first), no GPU-contention-
driven stop (GPU was separately confirmed clean: 3962/4096 MiB free, 0%
utilization, 58°C — not the blocker), no orphan-process cleanup action
beyond the read-only check (none found), and none of the three load
attempts, repeatability requirement, or trainer-initialization smoke
were reached.

## 5. Verdicts (unchanged from V2.1H, not reinterpreted)

- Root-cause verdict: **`ROOT_CAUSE_STILL_UNRESOLVED`**
- Training-path verdict: **`V2_1_TRAINING_PATH_NOT_READY`**

## 6. Observation for a future attempt (reporting only)

Two consecutive sessions (V2.1H, V2.1H-R) have now failed the RAM gate
without any load attempt at all — the host's free-memory baseline has
not recovered between them, and in this session actively worsened
during the observation window itself. Continuing to retry this exact
procedure without any change in host conditions is unlikely to produce a
different outcome. The supported control
(`HF_DEACTIVATE_ASYNC_LOAD=1`, confirmed via source in V2.1G) remains
ready to test the moment a future session observes a stable window at or
above the gate — no further diagnostic design work is needed, only a
materially different starting memory state.
