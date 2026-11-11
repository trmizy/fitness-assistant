import sys, time
sys.stdout.reconfigure(encoding="utf-8")
print("START_IMPORT", flush=True)
import torch
from unsloth import FastLanguageModel
print("UNSLOTH_IMPORTED", flush=True)

t0 = time.time()
print("MODEL_LOAD_BEGIN", flush=True)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit",
    max_seq_length=384,
    dtype=None,
    load_in_4bit=True,
    device_map={"": 0},
)
print(f"MODEL_LOAD_RETURNED ({time.time()-t0:.1f}s)", flush=True)

# LoRA preparation path, matching train_qlora_semantic.py - no training/backward.
model = FastLanguageModel.get_peft_model(
    model, r=16, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    lora_alpha=32, lora_dropout=0.05, bias="none", use_gradient_checkpointing="unsloth", random_state=3407,
)
print(f"PEFT_PREPARED ({time.time()-t0:.1f}s)", flush=True)

messages = [{"role": "user", "content": "Xin chao"}]
encoded = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")
input_ids = (encoded["input_ids"] if hasattr(encoded, "keys") else encoded).to(model.device)
with torch.no_grad():
    out = model.generate(input_ids, max_new_tokens=6, do_sample=False, pad_token_id=tokenizer.eos_token_id)
text = tokenizer.decode(out[0][input_ids.shape[1]:], skip_special_tokens=True)
print(f"GENERATE_OK: {text!r} ({time.time()-t0:.1f}s)", flush=True)
print("UNSLOTH_SMOKE_PASS")
