# Annotation provenance — frozen-150 (annotation_version 1.0)

Stated precisely, with no review that did not happen.

- **Who produced the gold labels:** one annotator, the implementation author of this repository, working with an AI coding assistant (Claude) that drafted case text and proposed labels under the author's direction. The author made the final labeling decisions recorded in the frozen file.
- **Independent human review:** none. There was no second annotator, no adjudication, and no inter-annotator agreement measurement. The results therefore do not establish label reliability beyond the single annotator's own consistency.
- **Model involvement in labels:** no language model under evaluation (Qwen3 4B, or the deterministic pipeline) produced or revised any gold label. Gold labels were derived from the design documents `docs/research/workout-plan-bpm/04..07` and `route-vocabulary.json`, as stated in `annotation-guideline.md`.
- **Timing:** `annotation-guideline.md` states it was written before any case was generated and before any model output was observed. This is recorded as the author's statement. It was not independently verified by a third party.
- **Pre-freeze edits:** logged QA edits made before the dataset was frozen (route-family corrections W042, W044–W046; W047 dismissal route; CONFIRM_LAST_ACTION added to W001, W134, W137). They are listed in `dataset-review.md`.
- **Post-freeze changes:** none to the frozen file. Discovered caveats are listed in `post-freeze-annotation-issues.md` and are not repaired.
- **Consequence for the claims:** results measure agreement with this single annotator's gold labels. They are not a clinical or product-validated accuracy claim.
