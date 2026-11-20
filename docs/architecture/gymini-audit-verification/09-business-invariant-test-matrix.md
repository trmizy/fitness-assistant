# 09 — Business invariants và test coverage

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

Không có test implementation hoặc execution trong nhiệm vụ này. Các suite đã đọc chỉ cung cấp test definitions; tên “E2E” trong file không biến thành REAL BROWSER hay bằng chứng pass.

| ID | Invariant | Hiện có | Test/fixture cần | Acceptance |
| --- | --- | --- | --- | --- |
| INV-V01 | Workout requested frequency equals final generated sessions | agent-workflow-create-workout-plan.test.ts (partial, not run) | UNIT + BACKEND INTEGRATION / All generation surfaces, catalog drops, injury and combined intents | Exact requested count or explicit clarification/failure; never silent count drift. |
| INV-V02 | MOVE preserves count and all unrelated sessions | NOT_EXHAUSTIVELY_MAPPED | UNIT + BACKEND INTEGRATION / Four-day draft; Fri→Sat; collision case | Only destination weekday changes; session/exercise IDs and doses unchanged. |
| INV-V03 | Targeted focus/exercise change preserves unrelated content | agent-workflow-create-workout-plan.test.ts (partial, not run) | UNIT + BACKEND INTEGRATION / Monday third item, cable exclusion; ambiguous ordinal/day | Only resolved item/focus patched; ambiguous requests ask; catalog and equipment rules rerun. |
| INV-V04 | Unresolved physical limitation survives unrelated revisions | NOT_EXHAUSTIVELY_MAPPED | UNIT + BACKEND INTEGRATION / Scenarios C/D; benign soreness vs red flags; different regions | Retain uncertainty and restriction until clarified/resolved; conflicting leg request asks, no diagnosis. |
| INV-V05 | Catalog identity remains authoritative | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Published, archived, staging and other-user custom exercise IDs | Persist only permitted canonical IDs; no silent fuzzy fallback for an invalid explicit ID. |
| INV-V06 | Nutrition substitutions preserve goal and unrelated meals | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Active goal+program; completed meal; ambiguous item | Goal row unchanged, scoped item update and transactional meal/day rollups; completed meal refuses. |
| INV-V07 | Serving changes keep derived nutrient totals consistent | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Quantity-only update versus complete nutrient payload | Specify API contract; verify resulting item nutrients and rolled-up totals, not only quantity. |
| INV-V08 | Dietary constraints survive unrelated edits and explicit removal | NOT_EXHAUSTIVELY_MAPPED | UNIT + BACKEND INTEGRATION / Allergy vs preference; add, correct, withdraw | Preserve active restrictions; clarify safety-sensitive removal; do not copy permanent union semantics blindly. |
| INV-V09 | Roadmap honors deadline semantics | NOT_EXHAUSTIVELY_MAPPED | UNIT + BACKEND INTEGRATION / Chat/wizard, explicit 12wk, unspecified and no-deadline; fallback | No literal override of explicit input; no-deadline is preserved or clarified; unaffected milestones retained. |
| INV-V10 | PT only accesses actively authorized clients | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Two PTs, two clients, revoked contract, service error | Every read/write/tool rechecks verified relationship and target ownership; fail closed. |
| INV-V11 | Client-scoped batch proposals remain independent | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Three clients, one revoked, one generation failure | Each authorized result has client/version/audit provenance; no cross-client state or implicit apply. |
| INV-V12 | Stale or altered proposal cannot be confirmed | agent-workflow-finalization-race.test.ts (definitions inspected, not run) | BACKEND INTEGRATION / Two devices confirm/edit/dismiss interleavings and expired TTL | Atomic content-version check; losing edit rejected; confirmed snapshot exactly equals reviewed preview. |
| INV-V13 | Duplicate confirmation creates one business result | agent-workflow-finalization-race.test.ts (definitions inspected, not run) | BACKEND INTEGRATION / Duplicate request and crash after downstream commit | Use existing claim and downstream idempotency; replay returns original IDs without new writes. |
| INV-V14 | Partial bundle failure is truthful and recoverable | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Fail each step before/after commit; crash before finalization | Report each outcome; retry failed steps only; preserve created IDs; concurrent retry cannot duplicate. |
| INV-V15 | Logout/account switch leaves no prior-user state | NOT_EXHAUSTIVELY_MAPPED | REAL BROWSER + REAL HTTP/API / A→B→A, delayed query, token refresh, sockets, rapid switch | No previous resource IDs rendered, including transient delayed-response flash. |
| INV-V16 | Workflow concurrent corrections do not erase known slots | NOT_EXHAUSTIVELY_MAPPED | BACKEND INTEGRATION / Same workflow, two devices editing different slots | Merge or explicit conflict; correct lifecycle; no silent lost fields. |
| INV-V17 | Tokens never reach logs | NOT_EXHAUSTIVELY_MAPPED | UNIT + BACKEND INTEGRATION / Capture logger output after login/verify/errors | No raw access/refresh/cookie/password/OTP in output at any supported serialization nesting. |
| INV-V18 | Safety signals gate every relevant generation surface | NOT_EXHAUSTIVELY_MAPPED | UNIT + BACKEND INTEGRATION / High-risk vs caution vs ordinary fatigue; context follow-up | Appropriate clarification/abstention, no warning-only bypass for known contraindication; no diagnosis invented. |

Ưu tiên fixture synthetic, isolated *_test/postgres-test; FITNESS_DISABLE_REDIS=true khi suite yêu cầu. Không dùng DB khách hàng/dev để làm test pass. Model adapters mock/offline, không paid model hoặc heldout.

INV-09 gốc “ENFORCED_BY_OMISSION” không phải invariant đã enforce: thiếu chức năng không chứng minh query-count policy. INV-11 gốc gọi decision “AI-authored” mâu thuẫn domain authority CycleAssessment; cần kiểm tra deterministic decision và AI explanation riêng.


**INV-V19 bổ sung:** Mọi billed-model endpoint phải enforce caller contract và quota chung; test JWT thường/service secret, body userId spoof, cross-endpoint bucket exhaustion và limiter outage. Mock model để không phát sinh phí. JSON chứa acceptance/fixture.
