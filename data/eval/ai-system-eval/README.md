# AI system evaluation (Plan Phase 5)

Scope: routing + business correctness + safety + real side effects of the Gymini AI across 8 groups:
`intent, context, workout, nutrition, roadmap, health, pt_copilot, operations`.

## Splits (never mix)
| Split | Folder | Written by | Purpose | May be used to fix code? |
|---|---|---|---|---|
| DEV | `dev/` | the engineer (label `author: engineer`) | regression + smoke of known behaviour | yes |
| INDEPENDENT | `heldout/` | **real people, labelled independently** (`ANNOTATION_GUIDELINES_V1`, frozen) | unbiased measurement | **no** — never open to hunt for examples to fix |

DEV results are NOT evidence of generalisation. Only INDEPENDENT results are. An item file under `heldout/` is rejected by the
runner unless `EVAL_OPEN_HELDOUT="<reason>"` is set; each open is appended to `heldout/ACCESS_LOG.jsonl`.
No production conversations are used without consent + de-identification (guideline §6.3).

## Item format (`schema.json`)
One JSON array per file. Multi-turn items list `turns`; expectations on each turn are checked on that turn's reply.
Four independent axes are scored, each only when the item declares it:
- `routing`: `blockKinds` (any-of structured block kinds / `ACTION_CONFIRMATION` etc.) or `noBlock: true`
- `business`: `answerMatches` (all regexes must match) — ground the regex in the user-visible contract, not in the implementation
- `safety`: `answerForbids` (none may match, e.g. diagnosis claims, "Lưu thành công" without a save), `mustEmergency: true`
- `sideEffect`: `sql: {db, query, equals}` evaluated right after the turn (REAL DB check of what was actually saved / not saved)

## Running
`node test/ai-eval/run-eval.mjs --set data/eval/ai-system-eval/dev/dev-v1.json` (stack up; see stack.mjs). Output:
`test/ai-eval/results/<set>-<ts>.json` + per-group, per-axis table. A routing miss and a reasoning miss are reported separately
(plan §6.2): an item that has `routing` AND `business` axes failing only the latter is a "reasoning" error.

## Independent set procedure
1. Writers receive `writer_brief.md` (scenarios per group, no system internals, no examples from DEV).
2. Two annotators label independently per `ANNOTATION_GUIDELINES_V1`; disagreements adjudicated (`adjudication_template.csv` in
   `data/eval/query-routing-independent/`).
3. Items converted to this schema by someone who has NOT seen system outputs. Files placed in `heldout/`, sealed (hash recorded).
4. One scored run per release candidate; results are reported, not used to tune.
