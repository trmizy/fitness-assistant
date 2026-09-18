---
name: gymini-scope-control
description: Large or ambiguous requests, "continue"/"continue everything", production-hardening asks, or audit/implementation master tasks for Gymini. Load to decide what to fix now vs. document vs. explicitly defer.
---

# Gymini Scope Control

## Workflow

```
OBSERVE -> REPRODUCE -> ROOT CAUSE -> CLASSIFY -> DESIGN -> IMPLEMENT -> VERIFY
```

Don't skip straight to IMPLEMENT because a fix seems obvious — a wrong
root-cause guess produces a fix that doesn't actually fix anything (or
fixes the wrong layer — see `gymini-roadmap-product-flow`'s "never fix
only the visible text" rule).

## Severity

| Level | Meaning | Action |
|---|---|---|
| P0 | Security breach, data corruption, ownership violation, core journey cannot continue at all | Fix now, regardless of original scope |
| P1 | A major business flow is broken/unusable | Fix now |
| P2 | Real UX/data-continuity problem, not blocking | Fix if small and directly related; otherwise document, don't build |
| P3 | Minor usability/observability issue | Document only |

Real examples from this repo's own history: a PT plan-assignment
endpoint always failing validation because of a 0-based vs. 1-based
`order` mismatch was P1 (fixed immediately, even though the original ask
was "build an E2E test," not "fix workout assignment"). A PT-dashboard-
wide "clients needing attention" aggregate was a real, valuable P2 that
was explicitly NOT built in the same pass, because building it correctly
would require either a real N+1 or a new aggregate projection — a
separate unit of work, documented instead.

## Rules

- Fix the actual requested problem first.
- Do not invent adjacent features "while you're in there."
- Do not reopen a workstream a `docs/*_VERIFICATION_REPORT.md` already
  marked VERIFIED/CLOSED, unless new real evidence (a real failing
  test, a real observed bug) demonstrates a defect — a vague feeling
  that "more hardening would be nice" is not new evidence.
- Prefer the smallest architecture-consistent correction over a
  redesign.
- No schema migration by default — a derived/projected value is
  preferred; only add a new table/column if a real audit proves the
  existing models genuinely cannot represent the needed state (this
  repo's own precedent: `trainingReadiness`/`nutritionReadiness` are
  fully derived, no new column, specifically because that was checked
  first).
- A large P2 gets a paragraph in an integration-gaps doc, not a
  half-built implementation. Do not turn every P2 into a new
  architecture discussion mid-task.
- Do not recommend another generic "hardening phase" for a workstream
  that just closed — if there's a genuinely valuable next step, name
  ONE specific, scoped thing, not an open-ended continuation.

## "Continue" with no further detail

When a user says "continue" after a phase has already reached a
genuine, evidence-backed VERIFIED/CLOSED state:

1. Do one honest self-review pass first — re-check your own most recent
   claims for anything asserted "by construction"/"by code reading"
   that the original task actually asked to be live-tested (see
   `gymini-real-e2e-verification`). If you find one, close it for real
   — this is legitimate, valuable "continue" work, not scope creep.
2. If nothing genuine turns up, say so plainly and ask what's next
   rather than inventing busywork. Manufacturing a new "finding" just
   to have something to report is worse than stating the phase is
   done.

## Definition of correct behavior

Every fix made can be traced to either the original request, a P0/P1
found along the way, or a small P2 directly entangled with what was
already being touched. Every deferred item has a one-paragraph reason
recorded somewhere a future session can find it.

## Common failure modes

- Treating "continue" as a license to expand scope indefinitely without
  new evidence.
- Silently fixing a P2 that requires real architecture discussion,
  under time pressure, without flagging the decision it's making.
- Re-litigating an already-closed workstream because a later task
  happens to touch adjacent code.
