# Gymini AI Coach Frontend A/B E2E Scenario

Date: 2026-10-08. Status: TEST SCENARIO, not production code.

Purpose: define one complete frontend-driven journey from registration/login
through AI-created training roadmap, workout and nutrition setup, PT hiring,
gym membership checkout, and training-cycle completion. The scenario is written
for Playwright/browser execution against the local dev or verification stack.

## Scope

This is an A/B product-flow test, not a model-quality benchmark.

- Variant A: baseline/manual UX. The user completes the same business outcome
  through normal product pages and explicit forms.
- Variant B: AI-assisted UX. The user uses AI Coach for roadmap/workout/
  nutrition/PT discovery where the current architecture actually supports AI
  actions.

Important boundary: current AI Coach has domain tools for roadmap/workout/
nutrition/PT/program actions, but not a direct gym-membership purchase tool.
Gym discovery and membership payment therefore remain a normal frontend flow in
both variants. The A/B comparison for gym is whether AI-prepared profile/plan
context reduces user friction before the same checkout flow, not whether AI
secretly buys a gym package.

## Prerequisites

- Local services healthy: web, gateway, auth, user, fitness, ai, payment,
  gym, postgres, redis, qdrant.
- Web URL: `http://127.0.0.1:5173`.
- Payment gateway must be in sandbox/test mode. The browser only starts
  checkout; settlement requires the configured provider return/webhook path or
  a test helper that marks the transaction paid.
- AI model can be slow on local Qwen 4B. Use per-turn timeout >= 180s for any
  LLM-backed turn. Deterministic AI-agent actions should respond much faster.
- Existing browser helpers to reuse:
  - `test/ai-chat-full-verification/browser-e2e.mjs`
  - `test/ai-chat-full-verification/setup-users.mjs`
  - `test/ai-chat-full-verification/lib.mjs`

## Test Users

Create two fresh client users with equivalent profiles.

| Variant | User | Goal | Profile |
|---|---|---|---|
| A | `ab.manual.<timestamp>@gymini-test.local` | MUSCLE_GAIN | male, 30, 175cm, 76kg, target 80kg, beginner/intermediate, T2/T3/T5/T7, 60min |
| B | `ab.ai.<timestamp>@gymini-test.local` | MUSCLE_GAIN | same as A |

For PT/gym completion, seed or ensure:

- At least one published/active PT in Ho Chi Minh City with a package that the
  test user can afford.
- At least one approved gym/branch in Ho Chi Minh City with a payable membership
  plan.
- Payment providers endpoint returns at least one usable test method.

## Success Metrics

Record for both variants:

- `time_to_onboard_complete_ms`
- `time_to_active_roadmap_ms`
- `time_to_workout_saved_ms`
- `time_to_nutrition_saved_ms`
- `time_to_pt_contract_requested_ms`
- `time_to_pt_payment_started_ms`
- `time_to_gym_membership_payment_started_ms`
- `time_to_cycle_completed_ms`
- number of user messages/clicks
- number of retries/timeouts
- number of user-visible error toasts
- final DB truth state

Primary A/B hypothesis:

Variant B should reduce clicks/messages and total time for roadmap, workout,
nutrition, and PT discovery without creating false-success messages or
unauthorized writes. Payment and gym checkout should remain equally correct in
both variants.

## Variant A: Manual Baseline

### A1. Registration and login

Frontend steps:

1. Open `/register`.
2. Fill full name, email, password.
3. Submit registration.
4. Enter OTP from test fixture/dev OTP recovery.
5. Verify registration.
6. Expect redirect to `/client/onboarding`.

Assertions:

- User is authenticated.
- No redirect loop to `/login`.
- `user_profiles.hasCompletedOnboarding` is still false before final
  onboarding submit.

### A2. Manual onboarding

Frontend steps:

1. Complete level/goal step: `INTERMEDIATE`, `MUSCLE_GAIN`.
2. Choose training days: T2, T3, T5, T7.
3. Set session duration: 60 minutes.
4. Pick equipment preset or individual equipment.
5. Complete safety questions with no risk flags.
6. Fill body metrics: age 30, male, 175cm, 76kg, target 80kg.
7. Submit onboarding.

Assertions:

- Redirects to `/client/dashboard`.
- Profile values match exactly.
- Equipment selections exist in fitness-service `user_equipment`.

### A3. Manual roadmap/workout/nutrition setup

Frontend steps:

1. Open `/client/plans` or guided roadmap UI.
2. Create or activate a roadmap manually if the UI exposes it.
3. Open `/client/workout`.
4. Create/apply a workout plan manually or from templates.
5. Open `/client/nutrition`.
6. Create/save a nutrition goal/program manually.

Assertions:

- Exactly one active roadmap or the page truthfully states none exists if the
  manual UI cannot create it.
- Workout program/schedule exists and is visible.
- Nutrition target/program exists and is visible.
- No AI confirmation card appears in this variant.

### A4. Manual PT hiring

Frontend steps:

1. Open `/client/coaches` or Services -> `Tìm PT`.
2. Filter Ho Chi Minh City, goal muscle gain, budget 2,000,000 VND or no cap.
3. Select a PT package.
4. Submit contract request.
5. If the flow requires PT acceptance/signature, complete via seeded helper or
   PT/admin test account.
6. Open `/client/contracts`.
7. Start payment from the contract.
8. Select test provider in `PaymentMethodDialog`.
9. Follow sandbox redirect/return.

Assertions:

- Contract progresses through the expected statuses, e.g.
  `PENDING_REVIEW`/`PENDING_SIGNATURE`/`PENDING_PAYMENT` -> `ACTIVE` once
  payment is settled.
- Browser never shows paid/active before gateway settlement.
- Payment transaction is linked to `PT_CONTRACT`.

### A5. Manual gym membership

Frontend steps:

1. Open `/client/gyms`.
2. Filter Ho Chi Minh City.
3. Open a gym detail page.
4. Select a membership plan.
5. Create membership.
6. Open `/client/gym-memberships`.
7. Start payment.
8. Select test provider.
9. Follow sandbox redirect/return.

Assertions:

- Membership exists before payment in a pending state.
- Membership becomes active only after payment webhook/sync.
- Payment transaction is linked to `GYM_MEMBERSHIP`.

### A6. Complete cycle

Frontend steps:

1. Open `/client/workout/cycle`.
2. Complete enough scheduled workout exercises or use an approved test helper
   to mark scheduled sessions complete.
3. Trigger cycle evaluation/completion from the UI if exposed.
4. Confirm completion if the UI asks.

Assertions:

- Active cycle becomes completed.
- A cycle assessment/recommendation summary exists.
- Completion is idempotent; refreshing/re-clicking does not create duplicate
  assessments.

## Variant B: AI-Assisted Flow

### B1. Registration and onboarding

Use the same registration and onboarding steps as Variant A. Keep the profile
identical so differences come from the AI-assisted flow, not input data.

### B2. AI creates roadmap

Frontend steps:

1. Open `/client/ai-coach`.
2. Send: `Tạo lộ trình tăng cơ cho tôi`.
3. If AI asks for missing slots, answer with the same profile constraints:
   `4 buổi mỗi tuần`, `60 phút mỗi buổi`.
4. Wait for roadmap preview/action card.
5. Click `Xác nhận`.

Assertions:

- A high-risk confirmation card appears before any write.
- Before clicking confirm, no active roadmap is created.
- After confirm, exactly one active roadmap exists or the existing active
  roadmap is truthfully replaced according to current product semantics.
- Response source is deterministic AI-agent action, not a false generic answer.

### B3. AI creates workout plan

Frontend steps:

1. Send: `Hãy tạo lịch tập cho tôi`.
2. Answer missing slots if any.
3. Verify `WORKOUT_PLAN_PREVIEW`.
4. Send a draft revision: `tôi muốn nâng lên 6 bài tập cho 1 ngày`.
5. Verify the draft is revised or truthfully constrained by duration.
6. Click `Lưu lịch tập này`.

Assertions:

- Preview appears before saving.
- Revision does not call slow general QA or time out.
- Before confirm, no workout program is persisted.
- After confirm, workout program/schedule exists.
- Saved schedule can be opened from the detail link.

### B4. AI creates nutrition plan

Frontend steps:

1. Send: `Tạo thực đơn tăng cơ cho tuần này, 4 bữa mỗi ngày`.
2. If the plan is still generating, poll with `Xong chưa?`.
3. Verify `NUTRITION_PLAN_PREVIEW`.
4. Send one revision, e.g. `ít món bò hơn`.
5. Confirm with `Lưu thực đơn này`.

Assertions:

- AI reports generating state truthfully.
- Preview respects exclusions/revisions or refuses unsupported constraints.
- Before confirm, no nutrition program is persisted.
- After confirm, nutrition program exists and is visible in `/client/nutrition`.

### B5. AI-assisted PT hiring

Frontend steps:

1. Send: `Tìm PT phù hợp cho tôi ở Thành phố Hồ Chí Minh`.
2. Answer budget: `2 triệu` or `không giới hạn`.
3. Verify `PT_RECOMMENDATIONS` cards or an honest no-match message.
4. Click `Chọn PT`.
5. Confirm the draft card.
6. If the product requires a second confirmation/payment/signature sequence,
   follow `/client/contracts`.
7. Start contract payment from the frontend and settle via sandbox.

Assertions:

- AI does not fabricate a PT if no candidate exists.
- Selecting a PT first creates a draft/contract request, not an active paid
  contract.
- Payment activation follows gateway truth only.
- Contract belongs to the current user/session.

### B6. Gym membership after AI context

Frontend steps:

1. Ask AI: `Tôi nên chọn phòng gym như thế nào với lịch tập hiện tại?`
2. Verify this is advice only; no gym membership is created.
3. Open `/client/gyms`.
4. Buy a Ho Chi Minh City membership through the same checkout flow as A5.

Assertions:

- AI answer does not claim it bought a gym membership.
- Membership/payment invariants match Variant A.

### B7. AI-assisted cycle completion

Frontend steps:

1. Complete scheduled workouts from `/client/workout`.
2. Return to AI Coach.
3. Send: `Đánh giá chu kỳ tập hiện tại của tôi`.
4. If eligible, send: `Hoàn tất chu kỳ hiện tại`.
5. Confirm the completion card if shown.

Assertions:

- Evaluation reads the active cycle state.
- Completion requires confirmation.
- Completed cycle has a persisted assessment.
- Repeating confirmation is idempotent.

## A/B Comparison Table

| Phase | Variant A expected | Variant B expected | Pass condition |
|---|---|---|---|
| Signup/login | Same | Same | Both users authenticated |
| Onboarding | Same manual wizard | Same manual wizard | Identical profile DB state |
| Roadmap | Manual page/wizard | AI preview + confirm | Same active-roadmap outcome, B fewer clicks if supported |
| Workout | Manual plan/template | AI preview/revise/confirm | Same saved schedule outcome, no false writes |
| Nutrition | Manual nutrition page | AI async preview/confirm | Same saved nutrition outcome |
| PT | Manual PT discovery | AI PT recommendation + confirm | Contract request/payment truth preserved |
| Gym | Manual checkout | AI advice + same checkout | No AI false purchase, payment truth preserved |
| Cycle | Manual completion | AI evaluate/complete + confirm | Completed cycle + one assessment |

## Frontend Automation Shape

Recommended runner structure:

```text
test/frontend-ab/full-ai-journey-ab.mjs
  setup:
    - register two users through real frontend registration OR API registration
      plus frontend login
    - seed required PT/gym/payment fixtures
  runVariantA(page, user)
  runVariantB(page, user)
  collectMetrics()
  write:
    - output/playwright/ai-ab/<timestamp>/metrics.json
    - output/playwright/ai-ab/<timestamp>/screenshots/*.png
```

For immediate partial coverage, reuse the existing real-browser suites:

```powershell
node test/ai-chat-full-verification/setup-users.mjs
node test/ai-chat-full-verification/browser-e2e.mjs chat workout nutrition pt roadmap session
```

Those suites already verify authenticated frontend AI Coach behavior for
workout, nutrition, PT, roadmap, session isolation, and screenshots. The missing
pieces for the full A/B journey are registration UI automation, gym membership
checkout settlement, and cycle completion from frontend.

## Pass / Fail Rules

Hard fail:

- Any unauthorized cross-user/session access.
- Any UI success message before the backing DB write exists.
- Any payment marked active before gateway/webhook truth.
- Any AI message claiming it saved/bought/hired something without an action
  confirmation and corresponding DB transition.
- Any pending draft correction falling into slow general QA and timing out.
- Any duplicated contract, membership, workout program, nutrition program, or
  cycle assessment from retry/refresh/double-click.

Soft fail / product limitation:

- Qwen 4B takes >180s for non-deterministic general QA.
- No PT/gym candidate exists in Ho Chi Minh City test data.
- External payment sandbox unavailable.
- Cycle cannot be completed from frontend without enough scheduled workout data.

## Reporting Format

Final report should include:

- Environment: stack, model, feature flags, payment provider.
- User IDs/emails for A and B.
- Per-phase screenshots.
- Per-phase timings and click/message counts.
- Final DB state summary.
- Verdict:
  - A baseline flow: GO / NO-GO
  - B AI-assisted flow: GO / NO-GO
  - A/B product improvement: POSITIVE / NEUTRAL / NEGATIVE
  - Demo readiness: GO / GO WITH LIMITATIONS / NO-GO

