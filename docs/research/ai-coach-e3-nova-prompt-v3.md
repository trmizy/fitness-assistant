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
- `ESTIMATED_1RM` không được đổi thành `DIRECT_1RM`, bất kể delta lớn nhỏ. Mô tả e1RM tăng/giảm hữu ích phải giữ nhãn ước tính trong observation và rationale, copy metricAssertion từ projection khi đủ field; giữ quality/method/exercise/unit/window/provenance, nêu protocol chưa biết. Assessment scope vẫn theo câu hỏi/assessmentTask: có e1RM observation không buộc câu hỏi muscle-size đổi outcome thành estimated strength. Không tự tính lại số hoặc suy ra causality, training effectiveness hay independent verification.
- `bedrock-pilot/config.ts`: cho phép chọn V3 **tường minh, chỉ với Nova protocol**. Explicit V2 còn để đọc/replay lịch sử; không có automatic fallback từ V3. V3 có prompt/config hashes khác nên approval V2 không bind được V3. Mặc định E2/V1, Mantle và các CLI khác không tự chuyển sang V3.

Không đổi canonical output schema, retrieval/ranking, scientific packets, cases, transport, evaluator, gate, D1/D2/D3, budget, retries hoặc repair behavior. Existing schema đã chặn hai output gốc (`invalid_string` tại `claimLinks.0.knowledgeClaimHash`). Hash giả đủ 64 hex vẫn bị identity gate chặn; không cần viết lại gate.

## Regression và semantic boundary

`ai-coach-claim-prompt-v3.test.ts`: **12/12 pass** trong targeted TEST FIXTURE run, trước final clean-checkout regression. Bao gồm bảy cases bắt buộc: C20, fabricated hash, missing/malformed links, unavailable excerpt, fabricated evidence khi knowledge rỗng, valid Context và valid RAG exact bindings; phân biệt schema INVALID với schema VALID nhưng identity INVALID; raw không bị sửa.

Các checks khác: ví dụ JSON parse trực tiếp; reference/measurement instructions; structured estimated→direct mismatch bị BLOCKED; narrative và conclusion vẫn UNKNOWN cần semantic review; e1RM observation vẫn cho phép MUSCLE_SIZE/UNSPECIFIED khi câu hỏi cần scope đó; bốn fixed V1/V2 synthetic prompt digests từ checkout lịch sử; Nova-only version selection, unsupported version rejection, old approval binding khác, zero retries và LIVE thiếu authority bị từ chối.

Không dùng regex để tuyên bố scientific entailment. Structured metric copy đúng không xác nhận narrative. Human reviewer phải đọc mọi observation, conclusion và câu hỏi, kiểm tra estimated/direct distinction, causal/effectiveness overreach, method/quality/window/protocol và usefulness. Scientific support/personal applicability vẫn UNKNOWN. Prompt compliance/model quality V3 **NOT_MEASURED**.

Private real-failure regression copies/replay nằm ngoài Git tại `gymini-review-local/e3-owner-prep/nova-prompt-v3-private-regressions-2026-11-04/`. Chúng giữ raw/provider/candidate, original hashes và failure reasons; không phải independent gold, scientific evidence hay model-facing few-shot examples. Replay hai original failures và 64-hex C20 negative controls, không gửi request.

Clean pinned regression chạy **sau commit**, với source không đổi trong khi tests chạy. Scope: V2/V3 prompt, ba Nova suites, claim dev/correctness/pilot, D1/D2/D3 và frozen V2. Lệnh và kết quả cuối ghi trong private review package/final handoff; không gọi đây là full repository regression. `pnpm exec tsc --noEmit` trước commit: exit 0.

## Bốn payload mới

Model `amazon.nova-pro-v1:0`, region `us-east-1`, policy MINIMAL. CAL01/CAL06 × Context/RAG, hai repeats; **4 unique payloads / 8 prepared rows**, không inference schedule mới cho 20/183 cases. Parameters giữ maxTokens 2048, temperature 0.2; measurement request chỉ khác inference ở maxTokens=1. Token counts thật chưa được đo.

| Case / arm | tokenPayloadHash V3 |
| --- | --- |
| CAL01 / Context | `8623d1c431fe45a569381a8739b6fdd28569831eec35878e46df2b0221f94944` |
| CAL01 / RAG | `acdcb1b4ca81b115102342a7d03af4292b524a216916b8afc10e5e985cdab500` |
| CAL06 / Context | `7a2ecc05d5893c2e8e559693cf5c7e66e5db02e946c3e864a50aac04cee96c75` |
| CAL06 / RAG | `2a96fad2bb66d883b8d84ceedcd10b74471502905c67119b351dc6f0d8946176` |

| Case / arm | measureRequestHash | inferenceRequestHash |
| --- | --- | --- |
| CAL01 / Context | `fb6d4cfdb04f97f1565acad51635e12a730ce752cc79a60ea7ea5fcecda21baa` | `704dfca2ab082b5512933ec214bd456a9a7aec9180b47d4245cfffa2acce0a2b` |
| CAL01 / RAG | `4669f8c82be036d34cff11c1464a1afae5d79b0c2295e52f6b176aed4fb313de` | `da7041006424c9b9895c75d620239e73999f31fc3eec8da8118fed46910e283b` |
| CAL06 / Context | `38dcc1ae042d54d881cd79ac21d5a5371fb303ad8d84e532001e6d33871d437e` | `b8a86c25419f430408be0cb4a34ab96179bb5f4330de6befd37b08a27853a74f` |
| CAL06 / RAG | `32710f003aec15e19d900dc921dc440ebd1822a96792357bc51e25d75bbe7f2a` | `d6d087ad8e93972df950c5e003526030d1936bb58f32b7c2ae011b8c57cc0354` |

promptHashes (cùng thứ tự): `7b6d5a4eed67442f95106662eca95a7810c6c3e5ba6ca642aad3599aa69c6d4f`, `bb2751f21d3cf33deba1e4c0f2ef8680f4c09741802b0e0126402627aef1652f`, `60bff7512863c5345348b7085428787481788e22c448240050c7ddc61ddf284c`, `8b9b2642b0125dfb3a934d16784d993391a7f66dc69657cc59daaa3ac3d1090a`.

Inference request sizes: 12.775 / 28.472 / 12.753 / 20.299 bytes; không coi bytes là tokens hoặc tự nâng cap 12.000 tokens. V3 --check CPU preparation xác nhận V1/V2 khớp historical manifests; V2/V3 user bytes, requestHash, full ClaimContext, retrieval và exact excerpt bindings giữ nguyên. Không local paths, structured case-label keys hoặc frozen label hashes trong model-facing payload. Source owner-approval/policy metadata là provenance/policy hiện hành, không phải case gold; kiểm tra này không chứng minh mọi free-text privacy leak đã được phát hiện.

## Owner / independent review location và giới hạn

Private create-only final package: `C:/D_Backup/project_personal/gymini-review-local/e3-owner-prep/nova-warmup-payload-preview-2026-11-04-v3-r2/`. Chứa bốn exact measurement/inference pairs, system/user và full human preview, V2→V3 diff, prompt/payload/pins/hash manifest và provenance checks. Final package được sinh từ clean committed code; chỉ package mới, không ghi đè V2 hoặc owner decisions. Draft V3 tại `a0b99901` còn nguyên trong thư mục `...-v3/`, chưa được duyệt và được final manifest đánh dấu superseded; r2 chỉ làm rõ scope của assessment để không gán nhầm outcome vì một observation dùng e1RM. Không commit package/fixtures/journal/private config.

V2 approvals, run-1 và CLAIMED ledger vẫn là lịch sử, không cấp quyền cho V3. V3 cần independent prompt review và owner quyết định mới trước một authorization task riêng; nhiệm vụ này không xin hoặc tạo LIVE authorization, signature/trust root/issued ledger. Thay prompt không chứng minh Nova đã tuân thủ hoặc tư vấn tốt hơn. Không tiếp tục AWS LIVE từ bàn giao này.
