# Gymini Semantic Fine-Tune — V2.1F Unsloth Preflight + Training Attempt

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset, V2/
V2.1 artifact, or package was modified. No training ran. No V2.1
evaluation ran. Heldout was never opened. No Optuna, no GGUF export.

## Outcome

**`UNSLOTH_LOAD_PATH_BLOCKED`.** The Unsloth training load path
(`FastLanguageModel.from_pretrained(...)`, the exact function
`train_qlora_semantic.py` uses) failed both permitted attempts:

| Attempt | Result | Failure point |
|---|---|---|
| 1 | FAIL (exit 139, SIGSEGV) | `transformers/core_model_loading.py:804 spawn_materialize` — a `ThreadPoolExecutor`-based parallel weight-materialization path |
| 2 | FAIL (exit 1, clean Python exception) | `transformers/modeling_utils.py:4240`, `safe_open(...)` → `OSError: The paging file is too small for this operation to complete. (os error 1455)` |

Per the task's strict 2-attempt policy, no further retry was made and
training was never started. This is a genuine, newly-surfaced finding,
not a repeat of the prior sessions' unexplained crashes — see §2.

## 0. §4 clarification (plain-Transformers "2/3" generation)

Re-examined the prior diagnostic's own test scripts directly. The run
that did not attempt generation was **the first** of the three load
attempts (it used a load-only script with no generation code at all),
not the third — attempts 2 and 3 both included generation and both
passed. No generation failure occurred in that diagnostic; nothing
needed to be redone. (`FIRST_LOAD_GENERATION_NOT_ATTEMPTED` — by script
design, not a failure — rather than the task's assumed
`THIRD_GENERATION_NOT_ATTEMPTED` label, corrected here for accuracy.)

## 1. Minimal environment preflight (before Unsloth testing)

Free RAM ~2.14 GB of 16 GB, free virtual memory ~8.07 GB, GPU 3962/4096
MiB free, 0% utilization, 58°C, zero compute processes, no orphan Python
processes, 69.1 GB free disk. Consistent with the range observed
throughout this whole multi-session task — not materially different from
either the prior failures or the prior recovery.

## 2. The real finding: Unsloth's load path is architecturally different from the plain path, and that difference is exactly where it crashed

`PYTHONFAULTHANDLER=1` captured a full native-fault traceback for attempt
1 (not available for any of the prior sessions' crashes) — the first
time in this entire multi-session investigation that the crash site has
been visible at the Python frame level, not just a bare SIGSEGV. It
shows the crash occurring inside `transformers`' newer
`core_model_loading.py::spawn_materialize`, which explicitly spawns a
`concurrent.futures.ThreadPoolExecutor` to materialize weight tensors in
parallel across multiple threads (`_adjust_thread_count` → `threading.start`
→ `threading.wait`).

**This is a genuinely different code path from the one verified stable
3/3 in the V2.1E diagnostic.** That diagnostic's plain
`AutoModelForCausalLM.from_pretrained(..., device_map={"":0}, torch_dtype=
torch.bfloat16)` call — called directly, the same transformers version
(5.5.0), the same model — did not visibly hit this thread-pool
materialization path in any of its 3 successful runs (its logs show only
a single-threaded `Loading weights: 0%→100%` progress bar, not multiple
worker threads). Unsloth's wrapper
(`unsloth/models/llama.py:2714`, inside `unsloth_zoo`'s
`moe_grouped_modulelist.wrapper`) calls the *same*
`AutoModelForCausalLM.from_pretrained` function, but evidently with
different effective arguments or triggering conditions that lead
`transformers` to choose its newer multi-threaded materialization
strategy instead of the simpler single-threaded one.

Attempt 2's failure (`os error 1455`, the identical message from the
prior V2.1R session) occurred at the more familiar `safe_open(...)` call
— the same proximate location as every previous paging-file failure in
this whole multi-day task.

**Honest interpretation, not overclaimed**: both failures sit within the
same general phase (loading the 3.5 GB weight file into memory under the
current host's fluctuating low-RAM conditions), but attempt 1 provides
concrete evidence that Unsloth's specific call pattern exercises an
additional, more resource-intensive (multi-threaded) code path that the
already-verified-stable plain path does not. This is a plausible
contributing factor to why the Unsloth path has been consistently less
reliable than the plain path throughout this project (V2's training
needed 9 attempts; the plain evaluator path needed far fewer each time it
was retried) — not proven as the sole cause, since attempt 2's failure
mode is identical to failures seen on the plain path's own worse days.

## 3. Everything downstream — not attempted

Per task scope and the explicit stop condition on `UNSLOTH_LOAD_PATH_BLOCKED`:
no remediation baseline (`V2_ADAPTER_REMEDIATION`, `HF_BASE_REMEDIATION`),
no training, no checkpoint, no evaluation of any kind occurred. V2 and
V2.1 artifacts remain exactly as documented in prior reports — re-verified
unchanged (`git status`/`git rev-parse HEAD` both confirm no repository
change).

## 4. What would be worth trying next (reporting only, no action taken)

The newly-identified `spawn_materialize` thread-pool code path is a
concrete, specific mechanism — not previously visible — that a future
session could investigate further (e.g., whether `transformers` exposes
an environment variable or loading-kwarg to force the older
single-threaded weight-materialization path, matching what the plain-
load diagnostic already proved stable). This task did not attempt any
such change, per its explicit no-package/no-environment-mutation scope.
