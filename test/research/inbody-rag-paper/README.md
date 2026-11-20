# InBody-grounded RAG paper: experiment package

Local research package for the NCKH paper "Is Retrieval Enough? Grounding Language-Model Nutrition Advice in Measured
Body Composition". Not part of the product; nothing here runs in production.

Evidence labels: ablation = TEST FIXTURE personas + REAL model calls (Bedrock) + production retriever/engine code.
Extraction = real InBody270 printouts (identifiers never leave `test/inbody_duy`; results use hashed image ids).

## Files

| File | Purpose |
|---|---|
| `generate-personas.mjs` → `personas-inbody.v1.json` (+ `.sha256`) | 24 reproducible personas (seed 20261108). See `DATASET.md`. |
| `lib/prompts.ts` | System prompt, context blocks A–D, the six questions. |
| `run-ablation.ts` (via `run.sh`) | 24 × 6 × 4 × repeats generations with Nova Pro; resumable JSONL. |
| `judge-ablation.mjs` | Claude Opus 4.6 grader for Q4–Q6. |
| `ocr-eval.mjs`, `score-ocr.mjs` | Four vision-language models on the InBody photos; reference labels + scoring. |
| `lib/retrieval-redundancy.mjs` | Near-duplicate rate of retrieved passages. |
| `analyze.py`, `fig_architecture.py` | Statistics (bootstrap, Wilcoxon + Holm, Wilson) and figures. |
| `make-human-kit.mjs`, `score-human.py` | Blinded 48-answer 5-point Likert kit for HUMAN raters (`human-eval/phieu-cham.html`) and its scoring (adds the human-evaluation section once `ratings-*.csv` from real raters exist). |
| `score-gpt6.py`, `fig_judges.py` | GPT-6 as a third, cross-family LLM judge (`human-eval/llm-judge-gpt6.csv`, NOT human) and Fig. 4. |
| `build_paper.py` | Fills the SSRC Word template with text + numbers read from `metrics.json`. |

## Prerequisites

- Qdrant with the Bedrock-embedded knowledge base on `localhost:6340` (container `gymini-qdrant-bedrock`).
- AWS profile `divuzha` with Bedrock access in ap-southeast-1 (Nova Pro/Lite, Claude Sonnet 4.6/Haiku 4.5/Opus 4.6, Cohere embed v3).
- Python with numpy, scipy, matplotlib, python-docx, pymupdf (a throwaway venv is fine).

## Reproduce

```bash
node test/research/inbody-rag-paper/generate-personas.mjs                      # checksum must match
bash test/research/inbody-rag-paper/run.sh run-ablation.ts --run-id main-20261108 --repeats 3 --concurrency 3
node test/research/inbody-rag-paper/judge-ablation.mjs --run-id main-20261108 --reps 1
node test/research/inbody-rag-paper/ocr-eval.mjs --run-id 20261108
node test/research/inbody-rag-paper/score-ocr.mjs --run-id 20261108
cd test/research/inbody-rag-paper && node lib/retrieval-redundancy.mjs main-20261108
python analyze.py --run-id main-20261108 --ocr-run 20261108
python fig_architecture.py main-20261108
python build_paper.py --run-id main-20261108 --template SSRC_Word_Template.docx --out paper.docx
```

Bedrock on-demand quotas throttle Nova Pro at concurrency ≥ 6; the runner backs off and resumes, but use 3.

### Robustness experiments (added 2026-11-08)

```bash
# second chat model (reasoning, temperature not settable), one repetition
ABL_MODEL=global.anthropic.claude-haiku-4-5-20251001-v1:0 bash test/research/inbody-rag-paper/run.sh run-ablation.ts --run-id haiku-20261108 --repeats 3 --concurrency 4   # Kimi K3.1 was tried first: throttled by the service (capacity), not by the account quota (1M tokens/min, 540M/day)
node test/research/inbody-rag-paper/judge-ablation.mjs --run-id haiku-20261108 --reps 1           # Opus grades Haiku
node test/research/inbody-rag-paper/judge-ablation.mjs --run-id main-20261108 --reps 1,2,3        # Opus grades all Nova reps
ABL_JUDGE=global.anthropic.claude-sonnet-4-6 node test/research/inbody-rag-paper/judge-ablation.mjs --run-id main-20261108 --reps 1 --out judgments.sonnet.jsonl
python analyze.py --run-id haiku-20261108 && python agreement.py --run-id main-20261108 --second judgments.sonnet.jsonl   # second model + inter-judge agreement
```

- Extraction reference: `results/ocr-20261108/manual-labels.jsonl` holds hand transcriptions of all 24 printouts (identity-checked);
  `score-ocr.mjs` also reports how often the earlier majority-vote labels agreed with them.
- `analyze.py` writes a `sensitivity` block (narrow/wide reference intervals; Mifflin-based TDEE reference).
- Kimi K3.1 (2026-11-08): account quota is 1M tokens/min and 540M tokens/day, but the shared global pool returned ThrottlingException even for single requests after ~25 calls, i.e. service capacity, not quota. Retry later at concurrency ≤ 2.


## Known findings outside the paper's scope (product)

- The production InBody photo schema (`user-service/src/services/inbody-vision.service.ts`) does not extract the printed
  BMR or FFM, so photo-created records have `bmr = null` and the nutrition engine falls back to Mifflin–St Jeor.
- Ambiguous `DD.MM.YYYY` dates (both parts ≤ 12) are converted month-first by the vision models (01.12.2025 → 2025-01-12).
