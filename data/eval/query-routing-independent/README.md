# Independent query-routing corpus (Phase 4.7R6 / R6A)

**Status: no human-labelled data yet — `INDEPENDENT_ANNOTATION_REQUIRED`.** Policy is frozen (`ANNOTATION_GUIDELINES_V1`); the pilot package is ready for human writers/annotators. Do not put real user data here (see `docs/ai-product/query-routing-data-governance.md`).

| File | Purpose |
|---|---|
| `HANDOFF.md` | start here — roles and exact steps for the humans |
| `ANNOTATION_GUIDELINES_V1.md` | FROZEN label policy (hash in `ANNOTATION_GUIDELINES_V1.freeze.json`) |
| `pilot_scenario_cards.csv` | 40 scenario cards (26 safety, 14 Programming/domain) for independent writers — scenarios only, no utterances |
| `writer_scenarios.md` | broader scenario groups for the later full collection |
| `annotation_schema.json` | row schema (extra / personal-data fields rejected) |
| `annotation_batch_template.csv`, `adjudication_template.csv` | output templates |
| `annotation_guidelines.md` | superseded R6 draft pointer |

Tooling: `backend/services/ai-service/src/scripts/routingAnnotationTool.ts` (CSV, local, blind; columns such as email / phone / user_id / full_name are rejected). LLMs may help build tooling but are NEVER counted as writers or annotators; the 149 utterances in `pilot/pilot_batch.csv` were LLM-written (`SYNTHETIC_UTTERANCES_WITH_FUTURE_HUMAN_LABELS`), so even real human labels on them are not a human-written corpus.

## Pilot (R6A.1)

- `pilot/pilot_batch.csv` (+ `pilot_batch.manifest.json`) — blind batch of 149 synthetic utterances (id,text).
- `pilot/simulated/` — LLM-simulated labels, `SIMULATED_PIPELINE_SMOKE_ONLY`; never counts as annotation (see its `manifest.json`).
- `pilot/human/` — intake for REAL human files + provenance; run `human-intake` (see its README). Empty until real annotators deliver.
