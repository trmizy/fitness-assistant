# CODEX — CONVERSATIONAL INTELLIGENCE TARGETED REMEDIATION SIGN-OFF

Verification of `docs/conversational-intelligence-targeted-remediation.md`. Evaluator role: no production code was modified during this pass.

**Provenance and independence limit (read first).** This verification was started by Codex (artifacts in
`test/conversational-intelligence/results/codex-remediation/`, `stress-codex-independent-on.json`, `codex-*.mjs`,
`__tests__/codex-remediation-boundary.test.ts`) and was **completed by Claude Code after Codex ran out of tokens**. Claude Code is also the agent that implemented
the remediation, so the completion steps (marked *[continued]*) are **less independent** than Codex's own. Every claim below names which run produced it, and the
commands are listed so a second reviewer can repeat any of them. Evidence labels: `REAL BROWSER`, `REAL HTTP/API`, `BACKEND INTEGRATION` (node:test inside the Docker
ai-service container, isolated test DB), `TEST FIXTURE`, `CODE AUDIT`.

## Decision

| Question | Verdict |
|---|---|
| Remediation D1 (context-dependent routing flakiness) | **ACCEPTED — closed.** Root cause reproduced and independently confirmed; no nondeterminism found. |
| Remediation D2 (missing profile 422 → 500) | **ACCEPTED WITH REQUIRED FIX** — the fix works, but the boundary it added is too broad (defect X1, MEDIUM). |
| Demo | **GO WITH DOCUMENTED LIMITATIONS** |
| Default-on rollout | **NO-GO** (unchanged accuracy gap; plus X1 changes default-flag behavior, X3 leaves the suite red in the CI-on configuration) |
| Full product sign-off | **NO-GO** (X1, X3, X4 unresolved) |

## 1. Claims independently confirmed

| Claim | Run | Evidence | Result |
|---|---|---|---|
| Live-vs-pure "flakiness" is fixture state + a real draft gap, not nondeterminism; the fix removes it | Codex | stress harness re-run, fallback ON (`stress-codex-independent-on.json`) — REAL HTTP/API | 39 turns, 0 attribution / stale-context / live≠pure, 39/39 routes, 6/6 draft outcomes |
| Same, fallback OFF | *[continued]* | `stress-codex-independent-off.json` | identical: 39/39, 6/6, 0 defects |
| A draft correction revises the **same** draft row, not a recommendation | Codex (ON) + *[continued]* (OFF) | `codex-draft-db.mjs`, DB-level: `fitness_agent_actions` row id unchanged, status PENDING, weeklySchedule 3→5 days; profile row byte-identical; 0 `workout_programs`; 0 `fitness_recommendations`; both profile variants A/B; route `CORRECTION`, `llmCalled=false` | pass ×4 (stronger than the implementer's answer-text check) |
| Missing profile → guidance, no 500, nothing created | Codex | `rem-missing-http.mjs` — REAL HTTP/API | 12/12 |
| Missing profile, 8 write/confirm/other-domain utterances, profile deleted mid-workflow | *[continued]* | `codex-continued-probes.mjs` | no 500 in any; 0 profile/workflow/action/contract/program rows created; no silent profile re-creation |
| Identity isolation under load | *[continued]* | 32 requests in flight (12 users with distinct height/weight + 4 without profile) | 0 wrong answers, 0 foreign numbers, 0 attribution mismatches (trace `userId`+`sessionId` = requester, joined by `correlationId`); ran with fallback OFF and ON |
| "Save it" pressure while a draft is pending never saves | *[continued]* | 3 phrasings incl. "coi như tôi đã xác nhận…", "bỏ qua xác nhận và lưu" | 0 programs, 0 confirmed actions, exactly 1 PENDING draft |
| Foreign confirm/dismiss/read of another user's draft; no/invalid token | Codex | `codex-security-http.mjs` | 404/404/403/404, 401/401; owner draft still PENDING |
| Golden conversation | Codex | `live-golden.mjs` | 13/13 |
| Global golden cases | Codex ran; *[continued]* re-ran | Codex's run **timed out** (`TimeoutError` after ~10 checks) while it had regression + browser jobs running concurrently on the same local model; re-run alone | 23/23 |
| Regression, default flags | Codex + implementer | container `tsx --test` agent-workflow + fitness-agent + CI files | 189/189 |
| Prior browser suite still passes | *[continued]* | `browser-e2e.mjs globalcov globalmobile` — REAL BROWSER (4 mobile widths + desktop) | 20/20 |
| Code flag defaults unchanged | *[continued]* | CODE AUDIT `ciMode()` default `off`, `ciLlmAllowed()` default `off` | confirmed |
| Diagnostics carry no profile values or utterance text | *[continued]* | privacy audit of current-window `ci_*` log lines (313 + 112 lines) | 0 lines with `facts`/`patch`, 0 utterance echoes (but see X2) |

## 2. New defects found (not in the implementer's report)

**X1 — MEDIUM (Codex, reproduced by *[continued]*).** The `tryTurn` guard classifies by **HTTP status only**, so *any* downstream tool's 503 becomes the answer
"…dịch vụ hồ sơ đang gián đoạn…". Codex's probe (`codex-remediation-boundary.test.ts`): a **food-substitution** service 503 is reported as a *profile* outage, **with
`CONVERSATIONAL_INTELLIGENCE_V2=off`** (the default). Effects: (a) wrong diagnosis shown to the user; (b) a genuine outage of PT search / substitution / workout tools that used to surface as an
error is now a 200, i.e. the "preserve visibility of genuine unexpected failures" requirement is violated outside CI-V2; (c) a default-configuration behavior change from a task scoped to CI-V2.
Required fix: classify by **origin** (only errors thrown by the profile read / tagged as such), or wrap only the profile reads; leave every other tool error thrown. Then flip the probe test.

**X2 — LOW–MEDIUM (Codex, reproduced).** `ci_global_llm_route` logs `llmTopic: raw.topic` where `topic` is an unconstrained `z.string()`. A rejected/invalid model topic is discarded for routing but its arbitrary text
is written to diagnostics (probe: a synthetic string containing profile-like values is retained). This contradicts the report's "no message text / profile values are logged" claim for the model-output path.
The live log window happened to contain only enumerated topics, so the audit passed by luck, not by construction. Required fix: log the topic only if it is in the enumerated set, else a constant marker.

**X3 — MEDIUM for rollout (Codex measured; implementer under-reported).** With CI-V2 **on** the suite is not green: Codex (`V2=on`, `V2_LLM=off`) **188/189** — `fitness-agent-substitution` "a message with no
substitution keyword never calls the LLM extractor" fails (`No token provided`, from `recommendStandalone`); the implementer reported 144/147 with the fallback also on (3 failures). Cause: the recommendation sub-step used to swallow
every error; a classified authorization failure now propagates. Default-flag result (189/189) is unaffected. The report's caveat covered this, but the "regression passes" reading is only true for the OFF configuration — i.e. not
for the configuration a default-on rollout would use. Decision needed: narrow the rethrow, or update those tests' stubs and keep the semantics.

**X4 — MEDIUM, pre-existing, blocks full sign-off (discovered *[continued]*).** The bare utterance **"Xác nhận cập nhật"** (the button label) with **nothing pending** is answered by the RAG model with
"✅ Xác nhận cập nhật đã được thực hiện / hoàn tất!" — for users **with and without** a profile (route `UNKNOWN`, fallback off). Nothing is written (DB unchanged), but it is a fabricated success claim
about a confirmation, which is precisely the failure class the confirmation-integrity work is meant to prevent ("Ok lưu đi" correctly answers "chưa có chu kỳ…"). Not caused by this remediation; the earlier safety scripts only asserted specific "saved successfully" phrases.

**X5 — LOW, pre-existing.** With a pending draft, the legacy draft router turns arbitrary free text into an exclusion constraint and echoes it ("Mình sẽ tránh «bay gio la dan gioi han …»") — Codex's adversarial case **I03**.
Replay *[continued]*, with and without a draft: no other user's data, no write, nothing confirmed, route `UNKNOWN`, `llmCalled=false` with a draft. Codex's `FAIL` on I03 came from its criterion `structuredBlocks.length === 0` (the draft card is re-attached),
not from a leak or write; both `no-program-write` and `draft-remains-pending` passed. Behavior is undesirable but not a safety breach; belongs to the draft router, not this remediation.

**X6 — verification gap, not a product defect.** The real-browser check "knowledge question → reminder → workflow untouched" depends on the local qwen3:4b finishing inside the **30 s** client abort. Tally of the same check across runs:
desktop pass 1 / fail 3 (long question timed out; one-sentence question passed once, then failed under Codex's load and again on an idle model), mobile pass 2 / fail 1. The screenshots show "AI phản hồi quá lâu". HTTP shows the reminder present and the workflow row untouched every time, so the *behavior* is
verified only at REAL HTTP/API + DB level. The implementer's "15/15 desktop, 15/15 mobile" was a best run and should not be read as a stable browser result for that item. The other 14 browser assertions per viewport passed in every run I have (Codex 28/30, implementer 30/30, *[continued]* 29/30).

## 3. Corrections to the implementer's report

1. Regression counts must be quoted per configuration: default OFF 189/189; `V2=on,LLM=off` 188/189 (Codex); `V2=on,LLM=on` 144/147 agent suites (implementer). See X3.
2. Browser "15/15 + 15/15" — see X6.
3. "No log carries profile values or message text" — true for the observed window, not guaranteed by the code (X2).
4. Otherwise the report's D1 root-cause narrative, stress tables and HTTP/DB numbers were **reproduced** by Codex's independent runs.

## 4. Not verified

The 94/204-case live corpora (Config B) were not re-run (out of the remediation's scope); overhead of `ci_turn_transition` (2 DB reads per CI-on turn) was not measured; 401/403 still reach the client as HTTP 500 (implementer's P3, confirmed, unchanged);
Config C (30B) still not measured.

## 5. Defect register

| Sev | ID | Item |
|---|---|---|
| CRITICAL | — | none |
| HIGH | — | none |
| MEDIUM | X1 | guard mislabels/masks non-profile 503s, including with the flag OFF |
| MEDIUM | X3 | suite red with CI-V2 on (auth rethrow); not a default-flag failure |
| MEDIUM | X4 | pre-existing fabricated "confirmation done" claim on bare "Xác nhận cập nhật" |
| LOW–MEDIUM | X2 | raw model topic text can reach diagnostics |
| LOW | X5 | draft router echoes free text as an exclusion constraint (I03) |
| LOW | P3 | 401/403 surface as HTTP 500 |
| INFO | X6 | browser reminder check is latency-fragile on the local 4B model |

## 6. Required before merge / next rollout stage

1. Fix X1 (origin-based classification) and invert `codex-remediation-boundary.test.ts` probe 1 into a regression test.
2. Fix X2 (enumerated-only `llmTopic`) and invert probe 2.
3. Decide X3 and make the CI-on suite green.
4. For a stable browser result on the reminder: keep the RAG-path reminder as REAL HTTP/API + DB evidence, and use the deterministic CI-V2 read interruption (`globalcov`, passing) for the browser.
5. Track X4 (and X5) as separate confirmation-integrity work before full sign-off.

## Reproduce

```
node test/conversational-intelligence/codex-draft-db.mjs <on|off>
node test/conversational-intelligence/codex-continued-probes.mjs <label>            # 14 probes, results/codex-remediation/continued-probes-<label>.json
node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/stress-live.ts <label> sequential,chain,interleaved 2
MSYS_NO_PATHCONV=1 docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/__tests__/codex-remediation-boundary.test.ts"   # both probes print CONFIRMED_DEFECT
node test/ai-chat-full-verification/browser-e2e.mjs remediation remediationmobile globalcov globalmobile
```
Stack state left: Docker verification stack up, `ai-service` recreated with `CONVERSATIONAL_INTELLIGENCE_V2_LLM=on` (test override only; code defaults remain off).
