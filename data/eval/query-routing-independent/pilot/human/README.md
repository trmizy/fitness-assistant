# Real human pilot intake

Place here, and ONLY when produced by two real, independent people:

- `pilot_A01.csv`, `pilot_A02.csv` — columns `id,text,annotator,safetyLabel,programmingLabel[,domain,tags,uncertain,comment,timestamp]`; `annotator` must be exactly `A01` / `A02`; same ids and texts as `../pilot_batch.csv`.
- `pilot_A01.provenance.json`, `pilot_A02.provenance.json` — copy `provenance_template.json`, fill honestly, no identity fields.

Do not copy anything from `../simulated/` here. Those files are LLM-generated and are rejected by the intake gate.

Run (from `backend/services/ai-service`):

    npx tsx src/scripts/routingAnnotationTool.ts human-intake \
      --dir=../../../data/eval/query-routing-independent/pilot/human \
      --batch=../../../data/eval/query-routing-independent/pilot/pilot_batch.csv \
      --freeze=../../../data/eval/query-routing-independent/ANNOTATION_GUIDELINES_V1.freeze.json \
      --out=../../../data/eval/query-routing-independent/pilot/human/report

It fails closed (exit 3) when a file or provenance is missing, simulated, LLM-assisted, non-independent, on a different batch or on a different guideline hash. It never adjudicates.

If both annotators labelled the same SYNTHETIC utterances, the authority is `INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES` — not a human-written corpus.
