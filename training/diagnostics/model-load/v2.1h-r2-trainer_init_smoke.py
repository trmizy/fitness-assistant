import sys, json, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, "semantic-qwen3-4b/scripts")
from pathlib import Path
from masking_utils import build_input_ids_and_labels

print("START", flush=True)
import torch
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig

CONFIG = {
    "base_model": "unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit",
    "max_seq_length": 384, "learning_rate": 5e-5, "num_train_epochs": 2,
    "per_device_train_batch_size": 1, "gradient_accumulation_steps": 8,
    "lora_r": 16, "lora_alpha": 32, "lora_dropout": 0.05,
    "target_modules": ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    "load_in_4bit": True, "bf16": True, "save_steps": 50, "eval_steps": 25,
    "logging_steps": 1, "seed": 3407,
}
dataset_path = Path("semantic-qwen3-4b/datasets/processed/v2.1/train.jsonl")
eval_path = Path("semantic-qwen3-4b/datasets/processed/v2/validation.jsonl")
output_dir = Path("/tmp/trainer-init-smoke-output")
max_seq_length = CONFIG["max_seq_length"]

t0 = time.time()
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=CONFIG["base_model"], max_seq_length=max_seq_length, dtype=None,
    load_in_4bit=CONFIG["load_in_4bit"], device_map={"": 0},
)
print(f"MODEL_LOADED ({time.time()-t0:.1f}s)", flush=True)

cfg = model.config
expected = {"num_hidden_layers": 36, "hidden_size": 2560, "max_position_embeddings": 262144}
actual = {k: getattr(cfg, k, None) for k in expected}
mismatches = {k: (v, actual[k]) for k, v in expected.items() if actual[k] != v}
if mismatches:
    raise SystemExit(f"MODEL_IDENTITY_MISMATCH: {mismatches}")
print("MODEL_IDENTITY_VERIFIED", flush=True)

model = FastLanguageModel.get_peft_model(
    model, r=CONFIG["lora_r"], target_modules=CONFIG["target_modules"],
    lora_alpha=CONFIG["lora_alpha"], lora_dropout=CONFIG["lora_dropout"],
    bias="none", use_gradient_checkpointing="unsloth", random_state=3407,
)
print(f"PEFT_PREPARED ({time.time()-t0:.1f}s)", flush=True)

def load_jsonl_rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

def to_input_ids_and_labels(rows):
    out = []
    truncated = 0
    for r in rows:
        completion_messages = [{"role": "assistant", "content": json.dumps(r["target"], ensure_ascii=False)}]
        built = build_input_ids_and_labels(tokenizer, r["messages"], completion_messages)
        ids, labels = built["input_ids"], built["labels"]
        if len(ids) > max_seq_length:
            truncated += 1
            ids, labels = ids[:max_seq_length], labels[:max_seq_length]
        out.append({"input_ids": ids, "labels": labels, "attention_mask": [1]*len(ids)})
    return out, truncated

from datasets import Dataset, DatasetDict
train_rows = load_jsonl_rows(dataset_path)
print(f"TRAIN_ROWS_LOADED count={len(train_rows)}", flush=True)
train_processed, truncated = to_input_ids_and_labels(train_rows)
print(f"TRAIN_TOKENIZED truncated={truncated}", flush=True)

im_end_id = tokenizer.convert_tokens_to_ids("<|im_end|>")
sample_labels = train_processed[0]["labels"]
non_masked = [t for t in sample_labels if t != -100]
print(f"MASKING_CHECK row0: n_masked={sum(1 for t in sample_labels if t==-100)} n_real={len(non_masked)} im_end_supervised={im_end_id in non_masked}", flush=True)

val_rows = load_jsonl_rows(eval_path)
val_processed, _ = to_input_ids_and_labels(val_rows)
print(f"VAL_ROWS_LOADED count={len(val_rows)}", flush=True)

dataset = DatasetDict({
    "train": Dataset.from_list(train_processed),
    "validation": Dataset.from_list(val_processed),
})
print("DATASET_READY", flush=True)

output_dir.mkdir(parents=True, exist_ok=True)
sft_config = SFTConfig(
    output_dir=str(output_dir),
    per_device_train_batch_size=CONFIG["per_device_train_batch_size"],
    gradient_accumulation_steps=CONFIG["gradient_accumulation_steps"],
    learning_rate=CONFIG["learning_rate"],
    num_train_epochs=CONFIG["num_train_epochs"],
    max_steps=-1,
    bf16=CONFIG["bf16"] and torch.cuda.is_bf16_supported(),
    fp16=not (CONFIG["bf16"] and torch.cuda.is_bf16_supported()),
    logging_steps=CONFIG["logging_steps"],
    save_steps=CONFIG["save_steps"],
    eval_strategy="steps",
    eval_steps=CONFIG["eval_steps"],
    max_seq_length=max_seq_length,
    report_to=[],
    optim="adamw_8bit",
    seed=CONFIG["seed"],
)
print(f"SFT_CONFIG_READY optim={sft_config.optim} seed={sft_config.seed} bf16={sft_config.bf16} lr={sft_config.learning_rate} epochs={sft_config.num_train_epochs} batch={sft_config.per_device_train_batch_size} grad_accum={sft_config.gradient_accumulation_steps} max_seq_length={sft_config.max_seq_length}", flush=True)

trainer = SFTTrainer(
    model=model, tokenizer=tokenizer,
    train_dataset=dataset["train"], eval_dataset=dataset.get("validation"),
    args=sft_config,
)
print(f"TRAINER_OBJECT_READY ({time.time()-t0:.1f}s)", flush=True)
print(f"trainer.args.num_train_epochs={trainer.args.num_train_epochs} trainer train rows={len(trainer.train_dataset)}", flush=True)

# STOP HERE - no trainer.train(), no backward, no optimizer step.
print("TRAINER_INITIALIZATION_PASS")
