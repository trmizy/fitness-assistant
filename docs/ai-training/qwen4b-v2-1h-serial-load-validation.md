# Gymini Semantic Fine-Tune — V2.1H Serial Materialization Validation

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset,
V2/V2.1 artifact, or package was modified. No model load was attempted,
no training, no evaluation, no Optuna, no heldout access, no GGUF export.
`PACKAGE_CHANGES = NONE`, `SYSTEM_CHANGES = NONE` (none made by this task;
no evidence of any change made outside this task either).

## Outcome

**The empirical memory gate (§7: free RAM ≥ 3.0 GB) was not met.**
Sampled over a ~3.5-minute stability window per §8's instruction (9
samples, 20-25s apart): mean ≈2.67 GB, range 2.08-3.07 GB — 8 of 9
samples below the gate, including the most recent reading (2.75 GB) at
decision time. Per the task's own explicit instruction, no model load
was attempted. **`HOST_MEMORY_PRECONDITION_NOT_MET`.**

## 1. Stability-window observations

| Time (UTC) | Free RAM |
|---|---|
| 05:58:51 | 2.67 GB |
| 05:59:17 | 2.59 GB |
| 05:59:43 | 2.64 GB |
| 06:00:09 | 2.51 GB |
| 06:00:35 | 3.07 GB |
| 06:01:01 | 2.08 GB |
| 06:01:38 | 2.90 GB |
| 06:01:59 | 2.79 GB |
| 06:02:20 | 2.75 GB |

Full raw values in `training/diagnostics/model-load/v2.1h_ram_stability_window.txt`.
**Not a rapid monotonic decline** — the trace is noisy, fluctuating
within a roughly stable low band (~2.1-3.1 GB), not a steady drain. This
does not meet `HOST_MEMORY_STATE_UNSTABLE`'s "rapidly declining"
description, but it also doesn't clear the separate, simpler `≥3.0 GB`
gate — the two are different checks and only the second applied here.

## 2. Other preflight factors (all healthy, not the blocker)

GPU: 3962/4096 MiB free, 0% utilization, 57°C — clean. No orphan Python
processes. Disk free on C: ~69.1 GB. Top memory consumers: Memory
Compression (~3.99 GB — Windows' own mechanism, not a process to close),
`vmmemWSL` (~894 MB), two VS Code processes (~640+457 MB), `msedge`
(~533 MB), two `claude` processes (~290+255 MB), `MsMpEng` (~234 MB) —
the same class of legitimate user applications observed throughout this
entire multi-session task. None were terminated, and none is reported as
something this task has authority to close (§6).

## 3. Why the task stopped here rather than proceeding

Per §7's explicit, task-predeclared operational threshold (an
engineering control for this specific machine, not a scientific claim):
"If free RAM < 3.0 GB: DO NOT attempt model load." The most recent
reading at decision time was 2.75 GB. Proceeding to S1 under this
reading would have repeated the exact low-memory condition already
associated with every prior Unsloth-path failure in this project
(V2.1F's two failures both started below 2.2 GB) — exactly the scenario
this gate exists to prevent.

## 4. What remains untested

Everything downstream of the memory gate — `HF_DEACTIVATE_ASYNC_LOAD=1`
itself, the 3-run Unsloth-load repeatability requirement, tiny execution,
thread-count/materialization observations, and the trainer-initialization
smoke — was not reached. The control identified in V2.1G
(`HF_DEACTIVATE_ASYNC_LOAD=1`) remains unvalidated against a real load,
not because it's in doubt, but because no load was attempted at all this
session.

## 5. Recommendation

Per §6, this task does not close memory-heavy applications
automatically. If the user is able to free RAM (closing WSL specifically
was already identified in `qwen4b-v2-1-environment-recovery-training.md`
as not required for this experiment and genuine removable contention —
~894 MB currently), a future session re-running this exact V2.1H
procedure, starting from a cleaner reading, is the direct next step —
no new experiment design is needed, only a healthier starting memory
state.
