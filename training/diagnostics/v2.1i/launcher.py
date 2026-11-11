"""V2.1I single-run launcher: verifies the required env controls from INSIDE the training process, then runs the
unmodified train_qlora_semantic.py with the frozen V2.1 config. No hyperparameter is set here."""
import os, sys, time, json, runpy
sys.stdout.reconfigure(encoding="utf-8")
env = {k: os.environ.get(k) for k in ("HF_DEACTIVATE_ASYNC_LOAD", "UNSLOTH_CE_LOSS_TARGET_GB")}
print("CHILD_ENV", json.dumps(env), flush=True)
assert env["HF_DEACTIVATE_ASYNC_LOAD"] == "1" and env["UNSLOTH_CE_LOSS_TARGET_GB"] == "0.05", "required env controls not active"
print("TRAIN_START", time.strftime("%Y-%m-%dT%H:%M:%S%z"), flush=True)
script = r"C:\D_Backup\project_personal\fitness-assistant\training\semantic-qwen3-4b\scripts\train_qlora_semantic.py"
cfg = r"C:\D_Backup\project_personal\fitness-assistant\training\semantic-qwen3-4b\config\qlora_semantic_qwen3_4b_v2_1.yaml"
sys.argv = [script, "--config", cfg]
t0 = time.time()
try:
    runpy.run_path(script, run_name="__main__")
finally:
    print("TRAIN_END", time.strftime("%Y-%m-%dT%H:%M:%S%z"), f"wall_s={time.time()-t0:.1f}", flush=True)
