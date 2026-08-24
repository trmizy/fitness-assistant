# FINAL ENGINEERING + QA REPORT

**Dự án:** Fitness Assistant  
**Ngày:** 17/08/2026  
**Nhánh/commit nền:** `feature/session-feedback-pt-mode` / `327b296830c85845633d45e85fafa612fc8fe73b`  
**Môi trường:** Docker local, Postgres test riêng, Redis, Qdrant, Ollama và Chromium qua Playwright CLI.

## 1. Executive Summary

Các suite có phạm vi chồng lấn nên không cộng thành một tổng giả: AI `test:all` 402/402; cycle/feedback persistence 80/80; payment 18/18; user 36/36; gym 9/9; chat 9/9; gateway 21/21; deterministic evaluation 20/20; policy 6/6. Monorepo production build pass. Live model A/B hoàn tất 24 request nhưng chất lượng chưa đạt release gate.

```text
P0 open: 0 lỗi code đã chứng minh; provider-level financial E2E chưa xác minh
P1 open: 4 nhóm (model safety, allergen metadata, legacy plans, provider E2E)
P2 open: 2 nhóm (Docker full-test build, API empty-state contract)
P3 open: 1 (LLM-health duplicate request)
```

Mức sẵn sàng: **demo-ready, chưa beta/production-ready**. Workout/nutrition pipeline và financial idempotency đã được harden, nhưng model trực tiếp còn unsafe và chuỗi OTP/e-sign/payment/escrow/no-show/refund/clawback chưa có sandbox E2E đầy đủ.

## 2. Các lỗi đã sửa

- `BUG-AI-WORKOUT-001`: thêm per-day candidate, schema/semantic/equipment invariant, fail-closed và telemetry. Sáu regression case và năm plan Ollama live pass.
- `BUG-AI-NUTRITION-001`: deterministic meal expansion, catalog protein/carb/fat và final 7-day/calorie/macro/food-ID gate. Live plan `65a69792-d4ff-45e5-a667-5f64d3b1ae62` pass.
- `BUG-AI-EVAL-HARNESS-001`: A/B runner gọi Ollama thật, temperature 0, seed 42, timeout/retry hữu hạn, raw JSONL và rubric theo contract.
- `BUG-CONFIG-LLM-DEFAULT-001`: host default dùng đúng fine-tuned Qwen thay cho `llama3.2:3b` không tồn tại.
- `BUG-TEST-DRIFT-002`: sửa relative date, host/container URL và marketplace fixtures.
- `BUG-FINANCE-IDEMPOTENCY-001`: thêm compare-and-swap cho internal transfer/refund trong transaction khóa ví; duplicate call không double debit/credit/refund.
- `BUG-PRISMA-WINDOWS-EPERM-001`: xác nhận generate trong container là workflow ổn định khi stack bind-mounted đang chạy.

## 3. Lỗi và rủi ro còn lại

### P1

- Fine-tuned safety recall chỉ 42,9%; từng bỏ sót ngất, đau cấp, tê yếu thần kinh và yêu cầu giảm cân cực đoan. Không được expose model trực tiếp.
- Fine-tuned không chứng minh tốt hơn base: citation precision/coverage 50% so với 100%; final semantic 41,7% so với 66,7%.
- Nutrition catalog chưa có allergen/dietary tags authoritative, nên chưa thể chứng minh loại trừ dị ứng bằng code.
- Legacy PPL plan có muscle split không khớp exercises. Plan mới được bảo vệ nhưng dữ liệu cũ cần audit/quarantine/regenerate.
- OTP, Dropbox Sign, payment sandbox, escrow/release, no-show compensation, prorated refund và referral clawback chưa được xác minh xuyên UI/API/ledger.

### P2/P3

- `docker:test:full` build vượt 10 phút; fallback service suites pass nhưng CI harness cần tối ưu dependency layer/cache.
- InBody page nhận 404 từ `/training-cycles/active` khi chưa có cycle; UI xử lý được, nhưng 200/null sẽ sạch hơn.
- AI Plans gọi `/plans/llm-health` ba lần khi load.
- Frontend bundle chính 2,05 MB và background JPG 6,33 MB; cần code splitting và image optimization.

## 4. Workout AI Quality

| Metric | Pipeline sau fix | Direct fine-tuned golden |
|---|---:|---:|
| Schema pass | 100% trên 5 live plans | 66,7% |
| Workout invariant pass | 100% | 33,3% |
| Repair rate | 100% (4–7 repair/plan) | 66,7% cần repair |
| Failure after repair | 0/5 | 66,7% trong direct harness không repair |
| Invalid/out-of-candidate ID persisted | 0 | Có trong raw W-5 |
| Latency | khoảng 8,6s trung bình | p50 860ms; p95 11.359ms |

Kết luận: pipeline deterministic cứu chất lượng, không phải fine-tune. Repair rate cao phải tiếp tục giảm.

## 5. Base vs Fine-tuned

| Metric | Base Qwen2.5 1.5B | Fine-tuned | Better |
|---|---:|---:|---|
| Schema pass | 33,3% | 66,7% | Fine-tuned |
| Final semantic | 66,7% | 41,7% | Base |
| Workout invariant | 33,3% | 33,3% | Hòa |
| Vietnamese heuristic | 75% | 75% | Hòa |
| Citation precision/coverage | 100% / 100% | 50% / 50% | Base |
| Unsupported-claim proxy | 0% | 0% | Hòa |
| Safety recall | 71,4% | 42,9% | Base |
| Repair/failure-after-repair | 66,7% / 66,7% | 66,7% / 66,7% | Hòa |
| Latency p50/p95 | 969 / 9.168 ms | 860 / 11.359 ms | Mixed |

Golden set có 12 case/model: đủ bác bỏ tuyên bố fine-tuned tốt hơn, chưa đủ làm benchmark y tế cuối cùng. Raw evidence ở `backend/services/ai-service/artifacts/live-evaluation/`.

## 6. Nutrition AI

Regression invariant 2/2 và một generation live 7 ngày pass. Invalid intermediate generations được lưu `FAILED`. Allergy/vegetarian/budget/medical vẫn cần structured domain metadata và golden E2E riêng.

## 7. RAG

100 case: hit@5 = recall@5 = `0.98`, MRR `0.81867`, average score `0.73883`. Hai query mơ hồ về vị trí chân và thiết bị squat vẫn trượt. Evidence/Qdrant và training-method citation integration pass. Citation metric live chỉ là automated proxy, chưa phải expert claim review.

## 8. E2E Business Flow

| Flow | Kết quả | Ghi chú |
|---|---|---|
| Login | PASS | UI → auth 200, role route đúng |
| Registration/OTP | BLOCKED | Thiếu SMS sandbox/OTP capture |
| Onboarding | PASS | 6 bước, profile + equipment PUT 200, redirect dashboard |
| InBody | PARTIAL | Page render; production vision chưa có credential/ảnh chuẩn |
| AI Coach/Plans | PASS/PARTIAL | Live pipeline pass; direct model quality fail |
| Workout/PR | PARTIAL | Route + persistence suites pass; full UI PR chain chưa chạy |
| Nutrition | PASS/PARTIAL | Route + live invariant pass; allergy open |
| Marketplace | PASS/PARTIAL | Integration 8/8 + UI route; paid purchase blocked |
| Gym/QR | PARTIAL | Route/auth smoke; real membership/check-in chưa chạy |
| PT discovery/request | PARTIAL | UI route render; multi-user lifecycle chưa chạy |
| Contract/signature | BLOCKED | Thiếu Dropbox Sign sandbox |
| Payment/escrow/release | PARTIAL | Mock DB invariants pass; provider/escrow E2E chưa chạy |
| Booking/session/review | PARTIAL | Component coverage; full multi-party chain chưa chạy |
| Cycle/feedback | PASS | 80/80 real test DB |
| PT application/admin approval | PARTIAL | Validation/security pass; role UI chain chưa chạy |
| No-show/cancellation/refund/suspension/clawback | BLOCKED/PARTIAL | Chưa có full ledger-reconciled E2E |

## 9. Financial Invariants

- Duplicate/concurrent webhook không double-credit: PASS.
- Concurrent duplicate internal payment: đúng một debit payer, một credit receiver và một commission: PASS sau fix.
- Concurrent duplicate refund: đúng một reversal; ba ví trở về baseline; original `REFUNDED`, refund `PAID`: PASS.
- Forged provider webhook và MOCK production fail closed: PASS.
- Real provider sandbox, escrow release, settlement, proration, no-show compensation và clawback: chưa xác minh. Không thực hiện giao dịch tiền thật.

## 10. Security / Authorization

Payment/gym không tin client identity headers; admin financial routes được bảo vệ; gateway chặn customer vào admin profile; chat third-party ICE bị chặn; feedback ownership bị chặn; fabricated e-sign webhook fail closed; signed PT document URLs chống forge/expiry/tamper. Cross-gym finance và full direct-URL matrix theo mọi role vẫn cần dedicated E2E accounts.

## 11. External Blockers

- SMS/OTP sandbox hoặc test inbox.
- Dropbox Sign API key/webhook sandbox.
- Payment-provider sandbox credentials và webhook endpoints.
- Production vision provider và bộ ảnh InBody ground truth.
- Multi-role E2E fixtures cho customer/PT/gym-owner/admin và financial lifecycle.

## 12. Files Changed Chính

- `backend/services/ai-service/src/services/workout-plan-invariant.service.ts`, `src/workers/ai.worker.ts` — final invariant, constrained repair, fail closed, telemetry.
- `backend/services/ai-service/src/services/nutrition-plan-invariant.service.ts`, `nutrition.processor.ts` — nutrition validation/composition.
- `backend/services/ai-service/src/evaluation/live_golden_cases.ts`, `run_live_model_evaluation.ts` — live A/B harness.
- `backend/services/ai-service/src/services/llm.service.ts` — model default.
- `training/scripts/prepare_coach_dataset.py`, `evaluate_coach_model.py` — evaluator routing.
- `backend/services/payment-service/src/services/wallet.service.ts` và `src/__tests__/wallet-financial-invariants.integration.test.ts` — financial idempotency.
- `TEST_STATE.md`, `QA_MATRIX.md`, `QA_REMAINING_ISSUES.md`, `QA_FIXED_ISSUES.md` — checkpoint/evidence.

Worktree đã có nhiều thay đổi của người dùng từ trước; danh sách trên không tuyên bố ownership đối với toàn bộ `git status`.

## 13. Remaining Risk Before Production

Rủi ro lớn nhất là health safety nếu bypass guard, allergen safety, legacy workout data và external financial integration chưa được kiểm chứng xuyên dịch vụ. Trước production cần 100% critical golden, expert review, canary/rollback, provider sandbox E2E có reconciliation, security role matrix và CI harness ổn định.
