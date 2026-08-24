# Import Batch Log

Generated: 2026-08-19T16:39:50.565Z — real query against `import_batches`, not hand-maintained.

| Batch (short id) | Source | Started | Status | Inserted | Updated | Skipped/Dup | Review-queued | Errors |
|---|---|---|---|---|---|---|---|---|
| 25a1bbcb | curated_vi_food_aliases | 2026-08-19T16:10:31.288Z | COMPLETED (dry-run) | 553 | 0 | 0 | 136 | 0 |
| d9ec594c | curated_vi_food_aliases | 2026-08-19T16:10:58.140Z | COMPLETED | 553 | 0 | 0 | 136 | 0 |
| ae96f85b | curated_vi_food_aliases | 2026-08-19T16:11:13.991Z | COMPLETED | 0 | 0 | 553 | 136 | 0 |
| fa0f700c | rollback_mechanism_test | 2026-08-19T16:12:12.948Z | ROLLED_BACK | 1 | 0 | 0 | 0 | 0 |
| 30b9e130 | curated_vi_exercise_catalog | 2026-08-19T16:13:50.975Z | COMPLETED (dry-run) | 26 | 0 | 0 | 179 | 0 |
| f1c9532c | curated_vi_exercise_catalog | 2026-08-19T16:14:14.382Z | COMPLETED | 52 | 0 | 0 | 179 | 0 |
| b883d11f | curated_vi_exercise_catalog | 2026-08-19T16:14:38.370Z | COMPLETED | 0 | 0 | 26 | 179 | 0 |
| 87f9de83 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:25:41.107Z | COMPLETED (dry-run) | 21 | 0 | 0 | 0 | 0 |
| 3d7c6b68 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:25:52.507Z | COMPLETED | 63 | 0 | 0 | 0 | 0 |
| d73a6b68 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:26:57.577Z | COMPLETED | 0 | 0 | 0 | 0 | 0 |
| ec8f193f | rollback_exercise_test_staging | 2026-08-19T16:27:44.451Z | ROLLED_BACK | 1 | 0 | 0 | 0 | 0 |
| a35729a6 | rollback_exercise_test_published | 2026-08-19T16:27:44.515Z | COMPLETED | 1 | 0 | 0 | 0 | 0 |
| fc40ea20 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:37:13.198Z | COMPLETED (dry-run) | 97 | 0 | 1 | 0 | 0 |
| 27222475 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:37:38.647Z | COMPLETED | 398 | 0 | 1 | 0 | 0 |
| 852913e8 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:38:31.617Z | COMPLETED | 4 | 0 | 30 | 0 | 0 |
| bc8f4573 | curated_vi_exercise_catalog_new_exercises | 2026-08-19T16:38:49.322Z | COMPLETED | 0 | 0 | 30 | 0 | 0 |

## What's actually live vs review-queued

- **curated_vi_food_aliases**: the real (non-dry-run) run committed 553
  alias-food links from the 195-entry source file. 136 individual alias
  entries were queued for review rather than auto-linked — either because
  their `englishQuery` matched ZERO foods (a gap in the source file's own
  query mapping, e.g. "chicken breast cooked" not appearing verbatim in
  any of the 13,159 USDA names), or matched MORE than 30 foods (too broad
  to safely auto-link without a human picking which ones are actually
  right — e.g. "ức gà"/"chicken breast" alone matched 36 rows). Re-running
  the importer a second time confirmed idempotency: 0 new inserts, all
  553 correctly recognized as already-linked.
- **curated_vi_exercise_catalog**: only the 26 EXACT_CROSS_SOURCE matches
  from `reports/data/duplicate-candidate-report.md` were auto-linked (52
  rows: 26 ExerciseAlias + 26 ExerciseSource). The other 179 catalog
  entries (LIKELY_DUPLICATE/POSSIBLE_VARIANT/MANUAL_REVIEW/no-match) are
  queued for human review — importing them as NEW exercise rows is Gate
  7's explicit, separately-reviewed scope, not done here.
- Both importers' dry-run output matched their real-run output exactly,
  and a real-run-twice check produced zero new writes on the second pass.
- Rollback mechanism independently verified via an isolated throwaway
  batch (create → verify exists → roll back → verify gone), without
  touching either of the two real batches above.
