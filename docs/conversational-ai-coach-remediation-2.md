# Conversational AI Coach — Remediation #2

Date: 2026-09-15/16. Responds to `docs/codex-conversational-ai-coach-evaluation-2.md`
(decision: RETURN_TO_CLAUDE). A very small, focused parser patch — two
regex bugs in `agent-workflow/slot-values.ts` — not a rewrite of anything
else. Nothing in `agent-workflow/orchestrator.ts`, PROFILE_FACT semantics,
target-weight safety, the active-workflow DB invariant, PT recommendation
logic, the PT two-step contract flow, roadmap orchestration, memory, either
Claim Catalog, scoring, or any business service was touched this pass.

## 1. Codex Evaluation #2 findings

Baseline confirmed unchanged from `docs/codex-conversational-ai-coach-evaluation-2.md`:
Remediation #1 fixed 13 of 15 original findings; the evaluator itself
already read `PASS 19 / FAIL 0 / INFO 1 / BLOCKED 0`. Exactly two P0
release-gate parser bugs remained, both reproduced from real source before
any fix:

```
parseTrainingDays("thứ 2 - thứ 4 - thứ 6") -> [1]              (FAIL, expected [1,3,5])
parseMinutes("1.5 giờ")                    -> no_number_found  (FAIL, expected 90)
```

## 2. Training-days root cause

`agent-workflow/slot-values.ts::parseTrainingDays`, prior code:

```ts
const thuGroup = s.match(/\bthu\s*([2-7][2-7\s,]*)/);
```

Two independent bugs, both required to explain the exact failing input:

1. The character class `[2-7\s,]` did not include `-`, so a hyphen ended
   the captured run immediately after the first digit.
2. `.match()` (not `.matchAll()`) only ever finds the **first** `thu`
   occurrence in the message. A real Vietnamese speaker who repeats the
   "thứ" cue before every day ("thứ 2 - **thứ** 4 - **thứ** 6") never got
   past day one, even independent of bug 1.

Both bugs had to combine to produce exactly `[1]` (day one only) from the
exact failing input — confirmed by re-deriving the regex engine's own
match trace before writing any fix, per the "audit before changing"
instruction.

Canonical mapping audit (done before touching any code, per explicit
instruction): Vietnamese "Thứ N" (N = 2..7) → canonical day index `N - 1`
(1 = Monday/T2 … 6 = Saturday/T7); Sunday ("chủ nhật"/"CN") is a separate
hardcoded `7`. Cross-checked against `find-pt-program.workflow.ts`'s own
`DAY_LABEL` map (`{1:"T2",2:"T3",3:"T4",4:"T5",5:"T6",6:"T7",7:"CN"}`) —
**unchanged, exactly preserved**.

## 3. Training-days fix

- Widened the digit-run character class to `[2-7\s,-]` (adds `-`).
- Switched from `.match()` to `.matchAll()` (global), unioning the days
  found in every `thu ...` occurrence in the message — this covers both
  "one thu, many days" (`"thứ 2 4 6"`) and "thu repeated per day"
  (`"thứ 2 - thứ 4 - thứ 6"`) with the same code path.
- Added spelled-out weekday names (`hai`, `ba`, `tu`, `nam`, `sau`, `bay`),
  each still gated behind its own `\bthu\s+` cue (never a bare weekday word
  elsewhere in the sentence) — same canonical mapping as the digit form.

The run still stops at the first character it can't consume (a letter),
so the earlier anti-digit-extraction guarantee is preserved unchanged:
`"tập thứ 2, khoảng 60 phút"` still yields **only** day 2 — the `thu`-run
stops at `"k"` of `"khoảng"`, so `"60"` is never reachable. This is not
blind digit extraction; every digit is still anchored to its own `thu` cue
via `matchAll`, never pulled from anywhere else in the sentence. Verified
by a dedicated regression test (§6).

## 4. Duration root cause

`agent-workflow/slot-values.ts::parseMinutes`, prior code:

```ts
const hourMatch = s.match(/(\d{1,2})\s*(?:gio|tieng)\s*(?:(\d{1,2})\s*(?:phut)?)?/);
```

The hour-count group `(\d{1,2})` had no decimal support at all, so
`"1.5 gio"` never matched this pattern and fell through to the bare
`\d{2,3}` minutes pattern, which also doesn't match `"1.5"` (only 1 digit
before the dot) — hence `no_number_found`.

A naive fix (just adding `(?:[.,]\d+)?` to the group) was checked against
malformed input **before** being adopted, per the explicit "do not invent
values from malformed input" instruction: for `"1.2.3 giờ"`, an unguarded
decimal group backtracks into matching `"2.3"` as a plausible hour count
(138 minutes) — a real, silent wrong-value risk, not hypothetical.

## 5. Duration fix

```ts
const hourMatch = s.match(/(?<![\d.,-])(\d{1,2}(?:[.,]\d{1,2})?)(?![\d.,])\s*(?:gio|tieng)\s*(?:(\d{1,2})\s*(?:phut)?)?/);
```

- Decimal hour count accepts **either** `.` or `,` as the separator
  (`"1.5 giờ"` and `"1,5 giờ"` both → 90), parsed via
  `Number(str.replace(",", "."))` — this function shares **no** regex or
  logic with `parseBudgetVnd`'s dot/comma-thousands-grouping handling;
  duration and money decimal/comma semantics are completely independent
  (budget parser untouched, not even read during this pass beyond this
  audit note).
- `(?<![\d.,-])` / `(?![\d.,])` guard both ends of the candidate number:
  it must be a clean, unattached token. This is what makes `"1.2.3 giờ"`
  produce **no match at all** (every candidate substring — `"1"`, `"1.2"`,
  `"2.3"`, `"3"` — fails the guard because it's adjacent to another digit
  or separator), rather than silently accepting a plausible-looking slice.
  Falls through to the bare-digit pattern, which also finds no 2-3-digit
  run (each numeral is a single digit), so the final result is
  `no_number_found` — a clarifying failure, never an invented value.
- The same leading guard (`-` included) stops a unary minus from being
  silently dropped: `"-1 giờ"` cannot match starting at `"1"` (blocked by
  the preceding `-`), and there's no other digit in the string, so it also
  resolves to `no_number_found` rather than being read as `"1 giờ"` (60).
- A syntactically valid hour-phrase whose computed value falls outside the
  existing domain range (still `10..240`, unchanged) now returns an
  explicit `out_of_range` failure instead of silently falling through to a
  vaguer `no_number_found` (see §6 for `"0 giờ"`/`"10 giờ"`).

## 6. Parser test matrix

New dedicated file: `src/__tests__/slot-values-parsers.test.ts` (20 cases,
pure-function, no DB). Exact input → expected → actual:

| Input | Expected | Actual (source-level) |
|---|---|---|
| `parseTrainingDays("T2 T4 T6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("t2 t4 t6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ 2 4 6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ 2, 4, 6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ 2 - 4 - 6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ 2 - thứ 4 - thứ 6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ 2, thứ 4, thứ 6")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ hai, thứ tư, thứ sáu")` | `[1,3,5]` | `[1,3,5]` |
| `parseTrainingDays("thứ 2, chủ nhật")` | `[1,7]` | `[1,7]` |
| `parseTrainingDays("tập thứ 2, khoảng 60 phút")` | `[1]` (never `60`) | `[1]` |
| `parseTrainingDays("3 buổi")` | `[1,2,3]` | `[1,2,3]` |
| `parseTrainingDays("không biết nữa")` | `ok:false` | `ok:false` |
| `parseMinutes("60 phút")` | `60` | `60` |
| `parseMinutes("90 phút")` | `90` | `90` |
| `parseMinutes("45 phút")` | `45` | `45` |
| `parseMinutes("1 giờ")` | `60` | `60` |
| `parseMinutes("1 tiếng")` | `60` | `60` |
| `parseMinutes("2 giờ")` | `120` | `120` |
| `parseMinutes("2 tiếng")` | `120` | `120` |
| `parseMinutes("1.5 giờ")` | `90` | `90` |
| `parseMinutes("1.5 tiếng")` | `90` | `90` |
| `parseMinutes("1,5 giờ")` | `90` | `90` |
| `parseMinutes("1,5 tiếng")` | `90` | `90` |
| `parseMinutes("0.5 giờ")` | `30` | `30` |
| `parseMinutes("1.2.3 giờ")` | `ok:false` (never 138) | `ok:false` (`no_number_found`) |
| `parseMinutes("-1 giờ")` | `ok:false` (never 60) | `ok:false` (`no_number_found`) |
| `parseMinutes("abc giờ")` | `ok:false, no_number_found` | `ok:false, no_number_found` |
| `parseMinutes("0 giờ")` | `ok:false, out_of_range` | `ok:false, out_of_range` |
| `parseMinutes("10 giờ")` | `ok:false, out_of_range` | `ok:false, out_of_range` |

Result: `npx tsx --test src/__tests__/slot-values-parsers.test.ts` →
**20/20 pass**.

## 7. Compiled dist verification

Per the explicit instruction that Codex found these bugs against compiled
output, source-level tests alone were not treated as sufficient. Ran
`pnpm --filter @gym-coach/ai-service build` (clean `tsc`, no errors), then
invoked the **compiled** `dist/agent-workflow/slot-values.js` directly via
`node -e "require(...)"` (not through `tsx`/ts-node):

```
parseTrainingDays("thứ 2 - thứ 4 - thứ 6") => {"ok":true,"value":[1,3,5]}
parseMinutes("1.5 giờ")                    => {"ok":true,"value":90}
parseTrainingDays("thứ hai, thứ tư, thứ sáu") => {"ok":true,"value":[1,3,5]}
parseMinutes("1.2.3 giờ")  => {"ok":false,"reason":"no_number_found",...}
parseMinutes("-1 giờ")     => {"ok":false,"reason":"no_number_found",...}
parseMinutes("0 giờ")      => {"ok":false,"reason":"out_of_range",...}
```

Both P0 cases pass against the real compiled artifact, matching the
source-level result exactly.

## 8. Codex evaluator result

Re-run from the **repository root** (not through a pnpm filter — the exact
cwd-path-duplication bug Codex's own evaluation #2 documented, and that
Remediation #1 had already independently found and worked around):

```
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow/evaluate_conversational_workflow.ts
```

```json
{ "PASS": 19, "FAIL": 0, "INFO": 1, "BLOCKED": 0 }
```

Unchanged from the post-Remediation-#1 baseline — exactly the expected
result, evaluator source untouched (not modified this pass at all, since
no evaluator bug was found this time; §54 of Remediation #1 already fixed
the only real evaluator bugs that existed). A stale nested output
directory (`backend/services/ai-service/backend/...`, mtime older than
this run, left over from an earlier pnpm-filtered invocation — not created
by this pass) was found and removed; the correct-path results file
(`backend/services/ai-service/src/evaluation/conversational-workflow/results/conversational-workflow-evaluation-1.json`)
was written cleanly by this run.

## 9. Workflow regression result

`agent-workflow-remediation-1.test.ts`, `agent-workflow-roadmap-e2e.test.ts`,
`agent-workflow-program-e2e.test.ts`, `agent-workflow-security-e2e.test.ts`
run together (BACKEND INTEGRATION, real DB):

```
tests 19, pass 19, fail 0
```

Exact expected baseline, no regression from the parser change.

## 10. Memory/Claim/Scoring regression result

The exact 5 files Codex's own baseline names live at
`src/llm/__tests__/{memory_extraction,memory_policy,recommendation_claims,
program_recommendation_claims}.test.ts` and
`src/__tests__/training-program-scoring-v2.test.ts` (not all under
`src/__tests__/` — noted only because it means `pnpm test`'s glob
`src/__tests__/*.test.ts` does not run the first four at all; a pre-existing
test-script gap, not touched this pass):

```
tests 76, pass 76, fail 0
```

Exact expected baseline, no regression.

## 11. Full suite hang investigation

**FULL SUITE HANG = PRE-EXISTING / ENVIRONMENTAL.** Bounded investigation
(binary-searched by running subsets of `src/__tests__/*.test.ts`, not by
letting the full 54-file glob run to completion — never attempted, and not
required):

- Reproduced deterministically: `pnpm`-equivalent full-glob run stalls
  completely (zero new output) after ~9 seconds of real activity, every
  time (2 independent runs, identical 893-line stall point).
- **Not** DB connection-pool exhaustion: sampled `pg_stat_activity` on the
  dev Postgres mid-hang — only 4 total connections (2 active, 2 idle)
  against a `max_connections` of 100. Ruled out.
- Bisected by running progressively smaller file subsets: the full glob →
  first 36 files → first 18 → first 9 → down to exactly
  `{ai.flow.test.ts, ai.test.ts, bedrock-provider.test.ts,
  body_composition_rules.test.ts, chunking.test.ts}`, which alone
  reproduces it, then to `ai.test.ts` alone (still hangs), then to a
  single named test case via `--test-name-pattern`.
- **Root cause pinpointed**: `src/__tests__/ai.test.ts`, the test
  `"passes auth when both x-internal-token and x-user-id are correct"`
  (describe block "D. Auth middleware..."). It issues a real
  `POST /ai/ask` through the full, unmocked orchestration pipeline (unlike
  the rest of the file, which mocks providers at the dependency-injection
  boundary). The last log line before the stall is
  `"LLM orchestration started"` (`src/llm/trace_logger.ts`) — the call
  never returns and never times out within 30+ seconds of isolated
  waiting, well past what any of the file's other LLM-touching tests take
  (those fail fast with `ECONNREFUSED` against the unreachable local Ollama
  port). Something downstream of that log line (embedding/retrieval call
  or a provider-selection path this specific test's env doesn't hit the
  fast-fail branch for) blocks indefinitely.
- Because Node's built-in test runner runs test **files** concurrently in
  a bounded pool, one file whose process never exits permanently occupies
  a concurrency slot — this is exactly why the full run shows ~9s of
  normal multi-file activity and then total silence: most of the other 53
  files are simply never dispatched, not failing silently.
- This exactly matches Codex Evaluation #2's own description of the
  symptom ("early passing tests and provider-unreachable fallback logs,
  then no more output for several minutes") — independently reproduced,
  not a new report.
- **Not caused by this pass**: `slot-values.ts`'s changes are pure,
  synchronous regex logic with zero DB, HTTP, or timer involvement, and
  `ai.test.ts` does not import `agent-workflow/` at all. `git log`/diff
  confirms this test file is untouched by both Remediation #1 and #2.
- **No safe small fix applied.** The actual fix would mean either mocking
  this one test's orchestration call the way the rest of the file does, or
  adding a bounded timeout inside `llm/orchestrator.service.ts`'s call
  chain — both are changes to test/production code well outside this
  pass's explicit "very small focused parser patch" scope (the second
  option specifically touches orchestration logic this task lists as
  off-limits). Documented, not hidden, not fixed.
- **AWS runtime relevance: none.** No Lambda handler runs `node:test`;
  this is exclusively a local/CI test-runner-concurrency artifact of one
  test file, unrelated to request-time behavior.

## 12. Documentation update

`docs/conversational-ai-coach-workflow-design.md` §3 (`AWAITING_SLOT_
CONFIRMATION --(decline/use-once)--> COMPLETED (resume, no write)`) was
stale — a leftover pre-Remediation-#1 description that no longer matches
`allowsUseOnce(persistence)` enforcement (§4 of Remediation #1: PROFILE_FACT
refuses decline/use-once outright; only confirm / a valid correction /
cancel are accepted). The rest of the same document (its own later
"Remediation #1" changelog section, §`allowsUseOnce`/`tryDetectCorrection`)
already described the correct, current behavior — only this one lifecycle-
diagram line was out of date. Updated to two explicit branches
(`allowsUseOnce(persistence)` false vs. true), noting the true branch is
"not reachable by any slot shipped today." **Documentation only** — zero
production behavior changed by this edit.

## 13. Database impact

No new migration. The last migration remains
`20260916090000_agent_workflow_session_active_unique` (unchanged, not
edited). `AWS DATABASE MIGRATION REQUIRED = YES` — preserved from Codex
Evaluation #2's own audit: this migration has not yet been deployed to
AWS. This pass did not run any migration against any database.

## 14. Artifact build result

```
pnpm --filter @gym-coach/shared build      (tsc, clean)
pnpm --filter @gym-coach/ai-service build  (tsc, clean)
pnpm --filter @gym-coach/ai-service run build:lambda:package
```

```
ai-lambda.zip          37,096,949 bytes   handler dist/lambda.handler
ai-worker-lambda.zip   37,096,949 bytes   handler dist/worker-lambda.handler
ai-migrate-lambda.zip  22,329,415 bytes   handler dist/migrate-lambda.handler
```

Compared to the artifacts Codex Evaluation #2 audited (dated 2026-09-15
21:57, sizes 37,083,461 / 37,083,461 / 22,329,415): `ai-lambda.zip` and
`ai-worker-lambda.zip` changed size (as expected — they now contain the
patched `dist/agent-workflow/slot-values.js`); **`ai-migrate-lambda.zip`'s
byte count is unchanged** — confirmed by directly listing its contents:
it does not contain `dist/agent-workflow/slot-values.js` at all (see §15),
consistent with it never depending on this code path.

### Per-Lambda impact audit (traced, not assumed)

| Artifact | Contains `dist/agent-workflow/slot-values.js`? | Actually executes it at runtime? | Reupload required |
|---|---|---|---|
| `ai-lambda.zip` (HTTP, `dist/lambda.handler`) | Yes | **Yes** — `lambda.ts` dynamically imports `./app`, which wires `fitness-agent.routes.ts` → `fitness-agent.service.ts` → `agent-workflow/*` → `slot-values.ts` via `POST /ai/ask` and the agent chat routes | **YES** |
| `ai-worker-lambda.zip` (SQS, `dist/worker-lambda.handler`) | Yes | No — `worker-lambda.ts` only imports `./workers/ai.worker`, which has zero references to `fitness-agent`/`agent-workflow`/`slot-values` (grep-verified) | **YES** — not because this handler executes the changed code, but because this artifact is, by the packaging script's own explicit design ("byte-identical to ai-lambda.zip... same dependency graph, only the configured Lambda Handler differs"), the *same physical zip* as `ai-lambda.zip`; it changes as a mechanical consequence of that rebuild, not from its own code path |
| `dist/jobs-lambda.handler` (ships inside `ai-worker-lambda.zip` per the packaging script's own comment) | Yes | No — `jobs-lambda.ts` only imports `./knowledge-pipeline/service` and `personalized-service-autoaccept-sweep.service.ts`, both grep-verified to have zero references to the changed module | Same artifact as above — **YES**, same reasoning |
| `ai-migrate-lambda.zip` (manual invoke, `dist/migrate-lambda.handler`) | **No** (verified: not listed in the zip at all) | No — `migrate-lambda.ts` only spawns `prisma migrate deploy` as a subprocess against the migration SQL files; it has no import-graph path to any application TypeScript code | **NO** — this parser change has zero effect on this artifact. (Separately, the *migration itself* — §13 — still needs deploying to AWS, which is a database action, not a Lambda-artifact-reupload one.) |

## 15. Artifact security scan

Scanned `ai-lambda.zip`'s file listing directly (the artifact
`ai-worker-lambda.zip` is byte-identical by design, so the same result
applies):

- No `.env`/`.env.*` file present.
- No `.git/` directory present.
- No AWS credentials, DB password, JWT secret, or
  `INTERNAL_SERVICE_SECRET` file present (checked by name pattern; none of
  these are ever written to a file in this codebase — they are runtime
  env vars only, never baked into the build).
- No compiled **application** test files (`dist/__tests__/`,
  `dist/**/__tests__/`) — the packaging script's own `pruneTests()` step
  removes these; verified absent. (Third-party npm packages' own internal
  `test`/`__tests__` folders under `node_modules/` are present, as they
  always have been — that is normal, pre-existing vendor-package content,
  not this codebase's compiled tests, and out of scope to change.)
- Present and confirmed: `@aws-sdk/client-bedrock-runtime`,
  `@opensearch-project/opensearch`, the Prisma `rhel-openssl-3.0.x` query
  engine (`dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node`),
  and all three Lambda handler entrypoints (`dist/lambda.js`,
  `dist/worker-lambda.js`, `dist/jobs-lambda.js`).

## 16. AWS deployment delta

- **AWS DATABASE MIGRATION REQUIRED = YES** — `20260916090000_agent_workflow_session_active_unique`
  still not deployed to AWS (unchanged from Codex Evaluation #2's own
  finding; not created or modified this pass).
- **AI HTTP LAMBDA REUPLOAD REQUIRED = YES** — executes the changed code.
- **AI WORKER LAMBDA REUPLOAD REQUIRED = YES** — same physical artifact as
  the HTTP Lambda by design; changes mechanically even though its own
  handler code path doesn't execute the changed function (§14).
- **AI JOBS LAMBDA REUPLOAD REQUIRED = YES** — ships inside the same
  worker artifact; same reasoning as above.
- **AI MIGRATION LAMBDA REUPLOAD REQUIRED = NO** — verified not to contain
  the changed file at all; unaffected by this pass.
- **FRONTEND S3 REUPLOAD REQUIRED = YES** — unchanged from Remediation #1:
  the `allowUseOnce`-aware `FitnessAgentBlocks.tsx` UI change was built
  (`npx vite build`, clean) but has not yet been uploaded to S3. No
  frontend source was touched this pass (not required — Codex Evaluation
  #2 already passed the frontend outright), so no frontend rebuild was
  performed this pass either; the prior build output stands.
- **ENV CHANGES REQUIRED = NO** — no new environment variable introduced
  or removed.
- **IAM CHANGES REQUIRED = NO** — no new AWS resource, permission, or
  service touched.

No AWS action was actually taken this pass: no migration run, no Lambda
upload, no S3 upload, no AWS CLI invocation, no IAM or env change.
Artifacts were rebuilt and audited locally only, per explicit instruction.

## 17. Remaining blockers

None known. Both P0 parser bugs are fixed and verified at the source,
compiled-dist, evaluator, and regression-suite layers. The one open item —
the full-suite test-runner hang (§11) — is pre-existing, environmental,
reproducible independent of this change, has no AWS runtime relevance, and
was explicitly out of scope to fix under this task's "very small focused
parser patch" constraint (a real fix would mean touching either a test's
mocking boundary or `orchestrator.service.ts`'s LLM-call timeout handling,
both outside this pass's authorized scope). It is documented here, not
hidden, exactly as instructed.

## 18. Final verdict

**READY FOR CODEX FINAL RE-REVIEW**
