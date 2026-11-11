import sys, time
sys.stdout.reconfigure(encoding="utf-8")
print("START_IMPORT", flush=True)
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
print("IMPORTS_DONE", flush=True)

t0 = time.time()
tok = AutoTokenizer.from_pretrained("unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit")
print(f"TOKENIZER_READY ({time.time()-t0:.1f}s)", flush=True)

from transformers import AutoConfig
cfg = AutoConfig.from_pretrained("unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit")
print(f"CONFIG_READY ({time.time()-t0:.1f}s)", flush=True)

print("MODEL_LOAD_BEGIN", flush=True)
model = AutoModelForCausalLM.from_pretrained(
    "unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit",
    device_map={"": 0},
    torch_dtype=torch.bfloat16,
)
print(f"MODEL_LOAD_RETURNED ({time.time()-t0:.1f}s)", flush=True)
print("device:", next(model.parameters()).device, flush=True)
print("DEVICE_READY", flush=True)
print("T15_PASS")
