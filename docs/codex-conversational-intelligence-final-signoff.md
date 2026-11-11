# Codex Conversational Intelligence Final Closure Sign-off

Date: 2026-10-03.

Role: independent evaluator. Scope for this update: narrow final verification
of Claude Code's reported X4-T10 fix. I did not modify production code, test
expectations, prompts, model settings, corpus labels, or feature flags. This
document is the only file intentionally changed in this pass.

## Final Verdicts

| Decision | Verdict |
|---|---|
| X1 error-origin remediation | CLOSED |
| X2 log-privacy remediation | CLOSED |
| X3 CI-ON regression remediation | CLOSED |
| X4 confirmation truthfulness remediation | CLOSED |
| X4-T10 confirmation-window defect | CLOSED |
| Targeted defect remediation | GO |
| Demo readiness | GO WITH DOCUMENTED LIMITATIONS |
| CI-V2 default-on readiness | NO-GO |
| Full product readiness | NO-GO |

**X1-X4 defect remediation is closed.** The prior X4-T10 blocker is now
independently verified fixed. Remaining items are backlog/product-readiness
work, not blockers for this targeted defect-remediation phase.

## Documents Read

- `docs/codex-conversational-intelligence-final-signoff.md` previous version
- `docs/conversational-intelligence-x4-t10-final-fix.md`

## Code Inspection Evidence

- `fitness-agent.service.ts::tryConfirmationBoundary` no longer uses the old
  windowed `findMany(... orderBy updatedAt desc, take: 10)` action query.
- The implementation now asks two scoped questions:
  - first, `findFirst` for a live action in the same `userId` + `sessionId`
    where status is `EXECUTING`, or status is `PENDING` with `expiresAt > now`;
  - only if no live action exists, `findFirst` for the latest action by
    `updatedAt desc`.
- `deriveConfirmationState(actions, now)` still owns TTL semantics: live
  `PENDING` wins, `EXECUTING` wins, stale persisted `PENDING` resolves as
  `EXPIRED`.
- `mergeConfirmationState` remains the cross-source merge point with live
  action precedence, otherwise latest terminal event across action and profile
  workflow governs.
- CI-V2 defaults remain off: `CONVERSATIONAL_INTELLIGENCE_V2` and
  `CONVERSATIONAL_INTELLIGENCE_V2_LLM` both default to `off`.

## Independent X4-T10 Probe

I ran an independent transient `tsx` script through stdin inside
`gymcoach-ai-dev`, not a production or test-file edit. It directly constructed
DB states and called the real `fitnessAgent.tryConfirmationBoundary`.

Passed cases:

- exact reproduction: one live `PENDING` action plus 10 newer terminal actions;
  live action was 11th by old `updatedAt desc` lifecycle ordering, answer was
  pending, no false saved-success claim, and DB action row was unchanged.
- row-count independence: same shape with 25 and 40 newer terminal rows; answer
  still detected pending.
- `EXECUTING` precedence: older in-flight action plus 20 newer terminal rows;
  answer reported in-flight save, not terminal success.
- TTL semantics: persisted `PENDING` with `expiresAt < now` answered expired;
  persisted `PENDING` with `expiresAt > now` answered live pending.
- prior Case C: earlier-created action updated/cancelled later beat a
  later-created action whose terminal event was older.
- cross-source merge: live action beat older completed profile workflow; newer
  completed profile workflow beat older terminal action; newer terminal action
  beat older completed profile workflow.
- isolation: user B asking in B's session, and user B asking with user A's
  session id in this service-level probe, saw no information from user A's live
  pending action.
- multiple-live check: schema has no unique constraint enforcing one live
  `FitnessAgentAction` per user/session, and multiple create paths can create
  pending actions. A fixture with one `EXECUTING`, one `PENDING`, and 15 newer
  terminal rows still produced a non-terminal/live answer, never terminal
  success. No demonstrated defect.

## Real HTTP Reproduction

Command:

```text
node test/conversational-intelligence/x4-t10-repro.mjs
```

Result: PASS.

Observed evidence:

- real draft action created: `6498596a-4f03-44c8-9b64-c58afb2e76db`,
  status `PENDING`;
- total rows in session: 11;
- live pending action existed behind 10 newer terminal rows;
- status question returned:
  `Chua - minh chua luu gi ca... dang cho ban bam nut Xac nhan`;
- real `/confirm` endpoint returned HTTP 200;
- authoritative action status became `COMPLETED`;
- subsequent status question truthfully returned positive saved status;
- no duplicate action row/write was created.

## Focused Regression

Same focused regression suite was executed independently in all requested
configurations:

| Config | Flags | Result |
|---|---|---|
| A | CI-V2 OFF, LLM OFF | 260/260 pass |
| B | CI-V2 ON, LLM OFF | 260/260 pass |
| C | CI-V2 ON, LLM ON | 260/260 pass |

Included coverage:

- X1 probes remained green.
- X2 probes remained green.
- X3 probes remained green.
- prior X4 event-ordering tests remained green.
- X4 follow-up tests remained green.
- X4-T10 tests remained green.

Notes: local Ollama/Qwen3 4B paths were still slow in Config C, with LLM route
latencies up to about 80 seconds and some timeout/fallback logs. These did not
cause test failures and remain part of the X6 backlog limitation, not an X4-T10
closure blocker.

## Multiple-Live-Action Invariant

No hard DB invariant guarantees only one simultaneously-live
`FitnessAgentAction` per user/session:

- `FitnessAgentAction` has an index on `[userId, sessionId, createdAt]`, not a
  unique live-action constraint.
- multiple product paths create action-confirmation rows with default
  `PENDING` status.

Because multiple live rows are possible at the persistence level, I tested the
actual behavior rather than assuming an invariant. The generic confirmation
status answer remained truthfully non-terminal when multiple live actions were
present. It did not incorrectly fall through to a newer terminal row or claim a
save had completed.

## Remaining Backlog, Not Part Of X1-X4 Closure

- X5: draft free-text exclusion behavior.
- X6: local Qwen3 4B / browser latency.
- Profile-origin 401/403 -> HTTP 500 mapping.
- Qwen3 4B generalisation weakness; still insufficient for default-on.
- Qwen3 30B frozen-corpus evaluation has not been run.

## Final Conclusion

The demonstrated X4-T10 class is closed. Correctness no longer depends on an
arbitrary top-N action window: live `PENDING`/`EXECUTING` rows are queried
directly, TTL is respected, and terminal fallback uses the latest lifecycle
event only after live actions are absent. The previous X4 event-ordering fix was
not regressed.

Therefore X1, X2, X3, X4, and X4-T10 are CLOSED, and targeted defect
remediation is GO.

CI-V2 should still not be enabled by default, and this is not full product
readiness. Demo readiness remains GO WITH DOCUMENTED LIMITATIONS because the
verified flows are stable, but local-model latency and the remaining backlog
must be communicated honestly.
