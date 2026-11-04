# E3 Nova — CLAIM_PROMPT_V3, remediation F1/F2

2026-11-04 · branch `feat/e3-nova-live-gating` · baseline `cb7d020c`. Evidence: **CODE AUDIT / TEST FIXTURE**, cùng CPU replay của dữ liệu REAL AWS run đã có. Nhiệm vụ này không gửi AWS request, đo token hay chạy inference. V3 chưa được owner phê duyệt, chưa có response V3 thật và chưa đo model quality.

## Reproduction và nguyên nhân

Đã đọc `summary.json`, toàn bộ `results.jsonl` và hai original answer files tại private `e3-nova-runs/2026-11-04/run-1`. Hai output đều CAL01/Context, repeats 0/1; promptHash lịch sử `9d9718e4c64a7691531dd0c4e9c540f529221068c5c66aab68ba5fbd1901a7de`. Raw text trong answer, provider response và journal khớp nhau. Run lịch sử có **4 billed Converse measurements + 2 inference calls**, dừng sau hai failures; measurements này không phải AWS CountTokens API calls.

- **F1:** dù scientific knowledge/allowed claims/excerpts đều rỗng, model dùng product policy C20 và hash tự tạo `c20-epley-e1rm-definition` hoặc `C20-hash`. Ví dụ `CLAIM_OUTPUT_CONTRACT` của V2 cũng chứa placeholder hash không hợp schema và enum alternatives; chỉ thị linking chưa tách đủ rõ policy với scientific knowledge. Đây là prompt defect phù hợp với failure quan sát được, không phải bằng chứng rằng nó là nguyên nhân duy nhất của hành vi model.
- **F2:** observation và rationale gọi mức tăng e1RM từ log là tăng sức mạnh thực 10%, không có `metricAssertion`. V2 chỉ nhắc biến động e1RM **nhỏ** không chứng minh sức mạnh thực thay đổi; giới hạn measurement chưa được áp dụng rõ cho mọi độ lớn và toàn bộ narrative.

Original answer SHA-256: `1628d7944f4c357dbb2933d10c402490c77ca8fa68f7170182b57c2d0bec7724`, `15b9fde095cde11a0326155b4eeea6820fa1e8cf7d07b40ae9e3b086da2a5460`. Results journal `c5fdbcbca83bf22c478306857da2479fe02fe6220cecbea1ac2d4c27a2fc41ec`; summary `a61e6f9b666df2762f14e4380fb9c6d521a361d63b73b969d4182e043adef3ef`. Không sửa original evidence, approvals hoặc CLAIMED ledger.

## Patch tối thiểu

- `ai-coach-claim-dev/pipeline.ts`: thêm version V3; giữ nguyên kết quả byte của V1/V2 cho các version hợp lệ, bao gồm cả ví dụ V2 lịch sử. Unknown runtime version fail-closed thay vì rơi vào V2.
- V3 reuse nguyên user projection V2, chỉ thay output example trong system và thêm reference/measurement rules. Ví dụ V3 parse trực tiếp qua `ClaimAnalysisSchema`, không enum alternatives hoặc invented ID/hash. `factIds`, `sourceLinks`, `claimLinks` có đủ theo schema. Ví dụ format không phải đáp án/gold của case.
- `claimLinks` chỉ copy exact ID/hash trong `allowedReferences.knowledgeClaims`; list rỗng phải có `claimLinks: []`. Không scientific excerpts thì `sourceLinks: []`, `evidenceIds: []`. C20/C23/C24 chỉ là product policies. Không tạo ID/hash/excerpt/fact giả.
- `ESTIMATED_1RM` không được đổi thành `DIRECT_1RM`, bất kể delta lớn nhỏ. Mô tả e1RM tăng/giảm hữu ích phải giữ nhãn ước tính trong observation và rationale, copy metricAssertion từ projection khi đủ field; giữ quality/method/exercise/unit/window/provenance, nêu protocol chưa biết. Không tự tính lại số hoặc suy ra causality, training effectiveness hay independent verification.
- `bedrock-pilot/config.ts`: cho phép chọn V3 **tường minh, chỉ với Nova protocol**. Explicit V2 còn để đọc/replay lịch sử; không có automatic fallback từ V3. V3 có prompt/config hashes khác nên approval V2 không bind được V3. Mặc định E2/V1, Mantle và các CLI khác không tự chuyển sang V3.

Không đổi canonical output schema, retrieval/ranking, scientific packets, cases, transport, evaluator, gate, D1/D2/D3, budget, retries hoặc repair behavior. Existing schema đã chặn hai output gốc (`invalid_string` tại `claimLinks.0.knowledgeClaimHash`). Hash giả đủ 64 hex vẫn bị identity gate chặn; không cần viết lại gate.

## Regression và semantic boundary

`ai-coach-claim-prompt-v3.test.ts`: **11/11 pass** trong targeted TEST FIXTURE run, trước clean-checkout regression. Bao gồm bảy cases bắt buộc: C20, fabricated hash, missing/malformed links, unavailable excerpt, fabricated evidence khi knowledge rỗng, valid Context và valid RAG exact bindings; phân biệt schema INVALID với schema VALID nhưng identity INVALID; raw không bị sửa.

Các checks khác: ví dụ JSON parse trực tiếp; reference/measurement instructions; structured estimated→direct mismatch bị BLOCKED; narrative và conclusion vẫn UNKNOWN cần semantic review; bốn fixed V1/V2 synthetic prompt digests từ checkout lịch sử; Nova-only version selection, unsupported version rejection, old approval binding khác, zero retries và LIVE thiếu authority bị từ chối.

Không dùng regex để tuyên bố scientific entailment. Structured metric copy đúng không xác nhận narrative. Human reviewer phải đọc mọi observation, conclusion và câu hỏi, kiểm tra estimated/direct distinction, causal/effectiveness overreach, method/quality/window/protocol và usefulness. Scientific support/personal applicability vẫn UNKNOWN. Prompt compliance/model quality V3 **NOT_MEASURED**.

Private real-failure regression copies/replay nằm ngoài Git tại `gymini-review-local/e3-owner-prep/nova-prompt-v3-private-regressions-2026-11-04/`. Chúng giữ raw/provider/candidate, original hashes và failure reasons; không phải independent gold, scientific evidence hay model-facing few-shot examples. Replay hai original failures và 64-hex C20 negative controls, không gửi request.

Clean pinned regression chạy **sau commit**, với source không đổi trong khi tests chạy. Scope: V2/V3 prompt, ba Nova suites, claim dev/correctness/pilot, D1/D2/D3 và frozen V2. Lệnh và kết quả cuối ghi trong private review package/final handoff; không gọi đây là full repository regression. `pnpm exec tsc --noEmit` trước commit: exit 0.

## Bốn payload mới

Model `amazon.nova-pro-v1:0`, region `us-east-1`, policy MINIMAL. CAL01/CAL06 × Context/RAG, hai repeats; **4 unique payloads / 8 prepared rows**, không inference schedule mới cho 20/183 cases. Parameters giữ maxTokens 2048, temperature 0.2; measurement request chỉ khác inference ở maxTokens=1. Token counts thật chưa được đo.

| Case / arm | tokenPayloadHash V3 |
| --- | --- |
| CAL01 / Context | `cf415ff20626e0e5623621bf1b6ae19fa73b5210270cb1887ce7d10d122a6e59` |
| CAL01 / RAG | `4eacb7bc68c916a30891558e93890eeb97183840899d77880634092f00021622` |
| CAL06 / Context | `a547ab564c5d81ebaeba80a2741a8a4faad4fafe65e4d1338342017416386f62` |
| CAL06 / RAG | `2240e7f6bffb14f2bab061e024ff026a308e21d3c8304347b0b88e7bb4cadc46` |

| Case / arm | measureRequestHash | inferenceRequestHash |
| --- | --- | --- |
| CAL01 / Context | `85eeea4bc02ea9c809a2451451fe115eabab9871538d6795b433eb611b668687` | `f0e607d76b1c3f685fb0a9fcad9f4d7b3c7008bb0629d8415a5870c16a355891` |
| CAL01 / RAG | `317518f12f02b98822e136bfd5eda52b9ae7f9e97772e9af95a3716d9968e228` | `b365e55d47cccf62e9e4e02bfe36fc4cfab4c0f0721bc42dd8b3518ca3d87df5` |
| CAL06 / Context | `671f63e42a5d85f399c45a6d2fc8bc2cb55db9aa7ccd9b12a7ea411a3149a66a` | `e98eb4c517afb4eb5d0490859f4c445141273fafea03bd7ab5428f8e0c4097c4` |
| CAL06 / RAG | `c95ad0d0308890069a72195f7b277f2566a67d66c599a282b8c3d004a6cdc019` | `e2da82b016bc43fae7c2c6dc304114ff13e6cd71ad9c866f462f708bd0d3b557` |

promptHashes (cùng thứ tự): `39d586924d7a9f8dbe8df55c831d4999a007be4d447d2c4f6f480cdcd1599700`, `fe0910fc955a599720b9262ed990f98aed0702c985b25fec7ba388911778f0b0`, `6c1c96132cfe080d9fe081d8292534ff4b968ef78e55f9b29b1fdc15706a658c`, `e4b175e51ac2d431a893d86fe16687713dd6efee088f2436a37b1069a46ae0c9`.

Inference request sizes: 12.655 / 28.352 / 12.633 / 20.179 bytes; không coi bytes là tokens hoặc tự nâng cap 12.000 tokens. V3 --check CPU preparation xác nhận V1/V2 khớp historical manifests; V2/V3 user bytes, requestHash, full ClaimContext, retrieval và exact excerpt bindings giữ nguyên. Không local paths, structured case-label keys hoặc frozen label hashes trong model-facing payload. Source owner-approval/policy metadata là provenance/policy hiện hành, không phải case gold; kiểm tra này không chứng minh mọi free-text privacy leak đã được phát hiện.

## Owner / independent review location và giới hạn

Private create-only package: `C:/D_Backup/project_personal/gymini-review-local/e3-owner-prep/nova-warmup-payload-preview-2026-11-04-v3/`. Chứa bốn exact measurement/inference pairs, system/user và full human preview, V2→V3 diff, prompt/payload/pins/hash manifest và provenance checks. Final package được sinh từ clean committed code; chỉ package mới, không ghi đè V2 hoặc owner decisions. Không commit package/fixtures/journal/private config.

V2 approvals, run-1 và CLAIMED ledger vẫn là lịch sử, không cấp quyền cho V3. V3 cần independent prompt review và owner quyết định mới trước một authorization task riêng; nhiệm vụ này không xin hoặc tạo LIVE authorization, signature/trust root/issued ledger. Thay prompt không chứng minh Nova đã tuân thủ hoặc tư vấn tốt hơn. Không tiếp tục AWS LIVE từ bàn giao này.
