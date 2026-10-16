# Gymini Semantic Fine-Tune — V2.1E Native Load Crash Diagnostic

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file touched; no
dataset, V2/V2.1 artifact, or package was modified. No training, V2.1
evaluation, Optuna run, heldout access, or GGUF export occurred in this
task, as required.

## Outcome

**`MODEL_LOAD_PATH_RECOVERED`.** The exact historical plain-`transformers`
load path (`AutoModelForCausalLM.from_pretrained(..., device_map={"":0},
torch_dtype=torch.bfloat16)`) succeeded in **3/3 fresh processes** this
session, with correct deterministic generation verified in 2/3
("Xin chào! 😊" — a coherent, correct Vietnamese greeting, identical both
times). No package, driver, or system setting was changed to achieve this.

## 1. Host reboot status

**`HOST_REBOOTED_SINCE_LAST_FAILURE = NO`.** `LastBootUpTime` =
2026-10-10 20:34:53; the 3/3 SIGSEGV failures from the prior V2.1R session
occurred 2026-10-11 ~11:25-11:38 (after that boot). The host has not been
rebooted between that failure run and this diagnostic — the recovery seen
here is not attributable to a reboot.

## 2. Environment snapshot (unchanged from prior reports, re-verified)

OS build 26340 (Windows 11 Home Insider Preview). Python 3.11.15, 64-bit,
`training/.venv/Scripts/python.exe`. GPU: RTX 3050 Ti Laptop, driver
617.14, 4096 MiB VRAM. Full `pip freeze` saved to
`training/diagnostics/model-load/pip_freeze_v2.1e.txt` (89 packages).

## 3. Version-drift check (task §7/§8)

**`NO_VERSION_DRIFT_PROVEN`.** `docs/ai-training/local-qwen4b-discovery.md`
(written at the very start of this whole project, when the environment
was first set up and used for every successful training/eval run through
V1/D1/V2) recorded: `torch 2.10.0+cu126`, `transformers 5.5.0`,
`peft 0.19.1`, `trl 0.24.0`, `bitsandbytes 0.49.2`, `accelerate 1.14.0`,
`unsloth 2026.7.3`, `unsloth_zoo 2026.7.3`, `torchao 0.17.0`. Today's
`pip freeze` shows **identical** versions for every one of these packages.
No dependency change occurred between the last known-good environment and
now — the cause of the recent failures is not a software version change.

## 4. Test ladder results

| Test | Description | Result |
|---|---|---|
| T0 | Pure Python (JSON, 50MB bytearray) | **PASS** (0.016s) |
| T1 | NumPy import + 200×200 matmul | **PASS** (0.555s) |
| T2 | Torch CPU import + matmul, no CUDA | **PASS** (6.3s) |
| T3 | CUDA init only (no model) | **PASS** (5.6s) — 3.456/4.294 GB VRAM free |
| T4 | CUDA tensor smoke, 3 fresh processes | **PASS 3/3** (4.4-5.1s each) |
| T5 | fp16 + bf16 matmul capability | **PASS** — `is_bf16_supported()=True`, both dtypes work |
| T6 | bitsandbytes import | **PASS** (12.2s; `COMPILED_WITH_CUDA` attr absent in this version, not a failure, just an API difference) |
| T7 | Real `bnb.nn.Linear4bit` construction + GPU forward pass | **PASS** (9.7s) — the exact quantization mechanism used during model loading |
| T8 | transformers + accelerate + peft import | **PASS** (14.9s) |
| T9 | Tokenizer-only load, 2 fresh processes | **PASS 2/2** (~12.9s each) |
| T10 | `AutoConfig.from_pretrained` only | **PASS** (10.7s) — 36 layers, hidden_size 2560, quantization_config present |
| T11 | HF cache inventory | Single-shard `model.safetensors`, 3546.0 MB, snapshot `7744afa8566e264af1a92a806d8d9aae00cc7c78`, downloaded 2026-10-09 |
| T12 | Safetensors structural validation (headers only, no tensor materialization) | **PASS** — all 1493 tensor headers parse cleanly, file size matches exactly (3,545,956,414 bytes) |
| — | Cache corruption check: `.incomplete`/`.lock`/zero-length files | **None found** — all files consistent single-session timestamps (Oct 9) |
| T13 | Meta-device architecture skeleton (no real weight allocation) | **PASS** (14.0s) — 4,022,468,096 params, matches expected model size |
| T15 | **Full model load** (plain transformers, historical path), instrumented | **PASS, attempt 1/1** (17.6s) |
| T15 repeat | Same path, 2 more fresh processes, each with tiny generation | **PASS 2/2**, generation correct both times |

**Every single test from T0 through T13 passed cleanly, with no ambiguity,
regardless of host RAM level.** The full model load (T15) — the one test
requiring the single largest contiguous memory operation (materializing
the 3.5 GB weight file) — is the only stage that had previously failed,
and succeeded cleanly this time, 3/3.

## 5. Failure boundary verdict

**`FAILURE_BOUNDARY_IDENTIFIED`**, with appropriate caution about
causality: the boundary is specifically the safetensors weight
materialization step inside `transformers.modeling_utils._load_pretrained_model`
(the same call stack seen in the prior session's `OSError: paging file
too small` traceback, and the same code path a segfault would hit without
producing a distinguishing message). Every lower-level primitive this
step depends on — CUDA tensor allocation (T4), bf16 math (T5),
bitsandbytes quantization (T7), safetensors header parsing (T12), and
architecture construction (T13) — was independently verified healthy.
**Free system RAM observed immediately before this session's successful
T15 runs (~3.0-3.9 GB) was measurably higher than during the prior
session's 3 failed attempts (~2.26-2.74 GB)**, consistent with (not
proof of) the standing hypothesis that this specific large-allocation
step is the one sensitive to the host's fluctuating free-RAM level, while
every smaller/earlier operation is not.

## 6. Unsloth path — not separately tested (and why)

Task §32 conditions testing the Unsloth-specific load path
(`FastLanguageModel.from_pretrained`, the actual entry point
`train_qlora_semantic.py` uses) on "if plain Transformers crashes" — it
did not crash here (3/3 success), so that trigger condition was not met,
and per this task's own explicit scope (§3: "even if base model eventually
loads successfully, STOP after load-path stability verification"),
Unsloth's path was not additionally exercised. **This leaves one honest
gap**: training's real entry point does more CPU-side work at load time
(model patching, kernel setup) than the plain path just verified, so this
diagnostic's success does not by itself guarantee a future V2.1 training
attempt will succeed — only that the environment is no longer in the
state that made even the simplest load impossible. `AF` below is marked
not-tested, not assumed-passing.

## 7. Memory/VRAM observations (sampled, not instrumented peak)

Free RAM immediately before the T15 series: ~3.0 GB. Free RAM immediately
after (3 successful loads + 2 generations completed): ~3.86 GB — labeled
`OBSERVED`/`SAMPLED`, not `PEAK`, since no continuous sampler ran during
the loads themselves. VRAM: 3962/4096 MiB free before and after every
test (model + tiny generation activity released cleanly each time, no
leak observed across runs). GPU temperature stayed at 59-62°C throughout
— no evidence of thermal involvement in either the successes or the
historical failures.

## 8. What this does and doesn't establish

This diagnostic proves the environment is **currently** capable of the
one thing it previously could not do at all (load the base model). It
does not retroactively explain with certainty why 3/3 attempts failed
yesterday and 3/3 succeeded today under a nearly identical package/driver
stack — the most defensible, evidence-backed explanation remains
fluctuating host free-RAM pressure from the user's own concurrent
applications (confirmed not caused by any process of this session's own).
No reboot occurred, so the recovery is not attributable to that. This is
reported as the honest limit of what 3 successful trials can prove, not
overclaimed as a permanent fix.
