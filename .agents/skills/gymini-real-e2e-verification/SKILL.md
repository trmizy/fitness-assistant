---
name: gymini-real-e2e-verification
description: Any request to test, verify, do E2E, confirm production-readiness, mark something done/complete, or write a verification report for Gymini. Load before making any VERIFIED/PASS claim or writing a test/verification report.
---

# Gymini Real E2E Verification

## Evidence tiers — use these exact labels, never blur them

`REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`

- **Never** call code reading "E2E."
- **Never** call fixture preparation a real user flow.
- **Never** call a scoped regression run "full repository regression" —
  say exactly which suites ran (`SCOPED REQUIRED REGRESSION: <list>`),
  not an unqualified "regression passes."
- **Never** mark something VERIFIED without the evidence to back that
  exact claim — a partially-verified finding gets marked `[~]`/
  "PARTIALLY VERIFIED" with the honest reason, not rounded up.

See `references/evidence-levels.md` for a worked example of each tier
and the real harness conventions (Playwright specs, `recordTestCase`,
`readOnlyQueryOnDb`) already established in this repo's external E2E
harness.

## For browser claims, actually drive a browser

If the claim is "a real browser confirms X," it must be backed by an
actual Playwright run against the real running dev stack — not a
mental simulation of what the UI probably does. If a browser check
can't be done (no display, no harness access), say so explicitly and
downgrade the claim to CODE AUDIT.

## Database-backed automated tests

Use the isolated test database convention already established in this
repo (a `*_test`/`postgres-test`-named DB, `FITNESS_DISABLE_REDIS=true`
where the service needs it). **Never** mutate the dev or prod DB merely
to make an automated test pass — a dev-DB fixture script is acceptable
ONLY as an explicitly-labeled TEST FIXTURE for preparing prerequisite
state (e.g. onboarding flags, a real InBody entry) before a REAL BROWSER
step, never as a substitute for the real mechanism under test. See the
"REAL SERVICE FIXTURE" pattern in `gymini-cross-system-journey` for how
this repo solved a genuinely unautomatable step (payment) without
weakening any real check.

## Before writing a verification report

1. Actually run the tests you're about to claim passed — don't infer
   from a prior session's memory of a similar run.
2. If you find a real bug while building the test (not the bug the test
   was originally meant to catch), fix it if P0/P1, or document it
   honestly if P2/P3 — see `gymini-scope-control`'s severity table.
3. Do an honesty pass on your own draft report before finalizing: for
   every `[x]`/"VERIFIED" line, ask "did I actually run something that
   proves this, or did I infer it from code reading?" Downgrade
   anything that's actually inferred.
4. State exact test counts (`12/12 pass`), not vague language ("all
   tests pass").

## Definition of correct behavior

A reader of the verification report could re-run the exact same
commands/tests and get the same result — every claim is reproducible,
not just asserted.

## Common failure modes

- Marking a DoD item `[x]` because the underlying code LOOKS correct,
  without an actual run.
- Claiming "full regression" after running only the suites relevant to
  the current change.
- Fabricating a plausible-sounding test result while a background test
  is still running (never predict a result — wait for the real
  completion).
- Treating a code-audit-based "this should work by construction" claim
  as equivalent to a live-tested one, when the task specifically asked
  for a live test (e.g. "test one real mismatch").
