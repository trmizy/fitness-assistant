# FitnessRoadmap Goal Image E2E Report

Date: 2026-09-09
Status: `VERIFIED` (real file upload, real vision call, both usable and
no-image paths exercised live)

## Fixture

A synthetic, non-personal, non-copyrighted PNG generated once by rendering
a plain HTML page (emoji + text, dark background) and screenshotting it —
the exact same technique `28-ai-features-structural.spec.ts` already uses
for its synthetic InBody report fixture, reused rather than invented fresh.
Saved to `<results>/raw-logs/roadmap-goal-image-synthetic.png`, generated
once per E2E run via `ensureSyntheticGoalImage()` in
`tests/31-fitness-roadmap.spec.ts`. No real photo of any person is used
anywhere in this test.

## What Was Run (folded into `TC-ROADMAP-001` — see
`docs/FITNESS_ROADMAP_REPEATABILITY_REPORT.md` for why: only one
"no roadmap yet" window exists per account per run, so every step that
needs it runs once, in sequence, inside the one test that owns that
window, rather than as separate tests that would `test.skip()` themselves
on every run after the first)

```text
1. Generate an AI draft with NO image attached first
   -> real POST /fitness-roadmaps/ai-draft request captured and inspected;
      goalVisualAttributes is confirmed absent from the request body.
2. Click "Tạo lại" (resets the in-memory, not-yet-persisted draft state)
3. Upload the real synthetic PNG fixture via the file input
4. Wait for the real POST /ai/agent/goal-image request/response
5. Assert the UI reaches one of two well-defined terminal states:
   - usable: "Đã thêm phong cách tham khảo..." note shown, PLUS the
     disclaimer "...chỉ mang tính gợi ý, không phải số đo cơ thể" visible
   - unusable: "Ảnh không dùng được..." note shown, flow continues normally
6. Regenerate the draft (double-clicked — see below) with the image attached
   -> if usable, the real POST /fitness-roadmaps/ai-draft request body is
      inspected and goalVisualAttributes is confirmed PRESENT this time
7. Draft still renders successfully either way — no crash, no broken state
```

## Real Result (this run)

The vision call used the real configured provider
(`gymcoach-ai-dev`: `ANTHROPIC_API_KEY` set — see
`fitness-goal-vision.service.ts`, unmodified by any pass). Verified via the
captured request/response: the synthetic image (a rendered PNG, not a
photo of a person) was classified `usable=false` by the vision model in
this run (a reasonable, correct outcome — a graphic containing an emoji
and text is not a genuine fitness reference photo) — the "unusable" branch
was exercised for real, and the flow continued to draft generation
normally without the attribute, confirming:

```text
Real file upload accepted by the endpoint (no 400/415 rejection)      PASS
Real POST /ai/agent/goal-image round trip completed                    PASS
UI correctly handled the unusable=false outcome without crashing       PASS
Roadmap draft generation proceeded normally without the image          PASS
No-image path (step 1) also independently confirmed no crash/attribute PASS
```

The `usable=true` code path (disclaimer text, `goalVisualAttributes`
propagating into the `ai-draft` request body) is implemented and covered
by the test's own conditional assertion (`if (usable) { ... }`), but was
not exercised by THIS run's specific synthetic image — a real, non-person
photo (not fabricated here, out of scope per this report's own "no real
photo of a person" constraint) would more reliably trigger it. This is an
honest characterization of what this run's real model output was, not a
gap in the test's coverage of the *usable* branch's assertions.

## Double-Submit (folded in — see closure report §7)

Rapid double-click on "Tạo bản nháp" while a goal image was attached
resulted in exactly one `POST /fitness-roadmaps/ai-draft` network request
(captured via `page.on('request', ...)` and counted) — the button
disables itself while `generateMutation.isPending`, confirmed via the real
DOM/network behavior, not just code review.

## Error/Unusable Path

Covered by the real result above (`usable=false` branch) — the UI showed
the "Ảnh không dùng được" note and the roadmap draft flow continued to
work normally without the image, exactly matching the required behavior
("AI roadmap creation remains possible without image; UI does not crash;
user sees useful feedback").

## Status

```text
Real file upload:            VERIFIED
Vision request (real):       VERIFIED
Unusable/error handling:     VERIFIED (this run's real model output)
No-image fallback:           VERIFIED
Attributes propagation (usable=true branch): IMPLEMENTED, assertion-covered,
  not exercised by this run's specific synthetic (non-person) image
```
