# Gymini Semantic Fine-Tune — V2.1G Materialization Control Discovery

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. No tracked production file, dataset,
V2/V2.1 artifact, or package was modified. No training, no model-quality
evaluation, no Optuna, no heldout access, no GGUF export. `PACKAGE_CHANGES
= NONE`, `SYSTEM_CHANGES = NONE`.

## Outcome

**A genuine, officially-supported serialization control was found by
reading the installed `transformers==5.5.0` source directly — but it was
never tested against a real model load this session**, because host free
RAM degraded sharply and progressively during the investigation (1.70 GB
→ 1.09 GB, both already worse than the 2.14 GB starting point that had
already failed in the prior V2.1F session). Per this task's own explicit
instruction not to waste a model-load attempt when memory is clearly
worse than a known failure point, no load was attempted.
`HOST_MEMORY_STATE_DEGRADED`.

## 1. The supported control: `HF_DEACTIVATE_ASYNC_LOAD`

Read directly from `training/.venv/Lib/site-packages/transformers/core_model_loading.py`
(lines 777-826, 1091-1125 — full excerpt saved to
`training/diagnostics/model-load/spawn_materialize_source_excerpt.py`):

```python
GLOBAL_WORKERS = min(4, os.cpu_count() or 4)

def spawn_materialize(thread_pool, tensor, device=None, dtype=None):
    def _job():
        return _materialize_copy(tensor, device, dtype)
    if thread_pool is not None:
        return thread_pool.submit(_job)
    else:
        return _job   # fully synchronous - no thread pool at all
```

and, inside `convert_and_load_state_dict_in_model` (the function that
decides whether to build a thread pool in the first place):

```python
# We use threading by default, if not explicitly deactivated via env variable. ...
has_on_the_fly_quantization = hf_quantizer is not None and not hf_quantizer.pre_quantized
if (
    is_env_variable_true("HF_DEACTIVATE_ASYNC_LOAD")
    or "disk" in device_map.values()
    or has_on_the_fly_quantization
):
    thread_pool = None
else:
    thread_pool = ThreadPoolExecutor(max_workers=GLOBAL_WORKERS)
```

`is_env_variable_true` (`transformers/utils/import_utils.py:113-115`)
accepts `"true"/"1"/"y"/"yes"/"on"` (case-insensitive).

**Verdict: `SUPPORTED_SERIAL_CONTROL_FOUND` — `HF_DEACTIVATE_ASYNC_LOAD=1`.**
This is not a reduced-worker-count setting; when set, `thread_pool` is
`None` and `spawn_materialize` never touches `ThreadPoolExecutor` at all
— every tensor materializes synchronously on the main thread, exactly as
the library's own comment describes it being used for other memory-
constrained cases (disk offload, on-the-fly quantization).

## 2. Important correction to the prior (V2.1F) hypothesis

V2.1F's documentation speculated that Unsloth's load triggers a
*different* (more dangerous) code path than the plain `transformers`
call that had been verified stable 3/3. **Source inspection does not
support that.** The decision to build a `ThreadPoolExecutor` depends only
on three conditions: `HF_DEACTIVATE_ASYNC_LOAD`, disk offload in the
device map, and on-the-fly quantization. Checked directly:

- Neither the plain diagnostic call nor Unsloth's call sets
  `HF_DEACTIVATE_ASYNC_LOAD`.
- Neither uses disk offload (`device_map={"":0}` in both cases).
- `unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit` is a checkpoint
  already saved in bnb-4bit format (`config.json` carries a
  `quantization_config`, confirmed in the V2.1E diagnostic), so
  `HfQuantizer.pre_quantized` defaults to `True`
  (`transformers/quantizers/base.py:90`) for both loading calls, making
  `has_on_the_fly_quantization = False` for both.

**Both the plain path and Unsloth's path are therefore expected to
construct the identical real `ThreadPoolExecutor`.** The plain path's
3/3 success and Unsloth's 0/2 failure is not evidence of a structural
difference between the two loaders — it is much more likely the same
underlying flaky resource-pressure condition, sampled across a small
number of trials each. This supersedes the "Unsloth-specific" framing in
`qwen4b-v2-1f-single-training-run.md` (not rewritten, corrected here).

## 3. Host memory trend during this session

| Checkpoint | Free RAM |
|---|---|
| V2.1F Unsloth attempt 1 (prior session) | ~2.14 GB (failed) |
| This session, preflight | ~1.70 GB |
| This session, immediately before planned S1 | ~1.09 GB |

A clear, progressive worsening trend, not noise around a stable point —
and already below the level that failed before this session even began
its own test. Top memory consumers checked and found to be the same
class of legitimate user processes seen throughout this whole task
(Memory Compression, Node, VS Code, WSL, Edge) — nothing attributable to
this session's own activity, and nothing this task has authority to
change.

## 4. Everything else in the task's plan — not reached

S1 (the `HF_DEACTIVATE_ASYNC_LOAD=1` experiment), its repeatability runs,
S2, the trainer-initialization smoke, and all downstream steps require an
actual model load attempt, which §10's explicit stop condition correctly
prevented this session. The single-shard/thread-count/commit-spike
observational questions (§20-22) likewise require a live load to measure
and were not attempted.

## 5. Recommended next minimal experiment (reporting only)

The exact, concrete, now-ready-to-run next step for a future session:

```
HF_DEACTIVATE_ASYNC_LOAD=1 UNSLOTH_CE_LOSS_TARGET_GB=0.05 \
  training/.venv/Scripts/python.exe <unsloth-smoke-script>
```

using the same `FastLanguageModel.from_pretrained(...)` call already
written to `training/diagnostics/model-load/unsloth_smoke_test.py` in the
prior session — no new script is needed, only the added environment
variable and a host memory state materially better than ~2 GB free
before attempting it.
