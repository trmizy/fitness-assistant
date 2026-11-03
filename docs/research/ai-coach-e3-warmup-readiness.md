# E3 adapter closeout và controlled warmup readiness

Ngày 2026-11-03. Branch `feat/advisory-content-v3`; reviewed implementation base `473b135e`. Evidence: **CODE AUDIT / TEST FIXTURE**. Phạm vi chỉ đóng adapter, kiểm thử code cuối và kiểm kê điều kiện warmup. Không independent audit mới, không gọi AWS/CountTokens/inference, không mở LIVE.

## Closeout và dữ liệu bảo vệ

Implementation và contract: [E3 claim adapter](ai-coach-e3-claim-adapter.md). Trên **final bounded code**, scoped regression: **393 pass / 0 fail / 0 skip / 0 cancelled**, 38 file, exit 0; thời gian 332.492 giây. AI-service `pnpm exec tsc --noEmit`: **exit 0**. Các log local ignored tại `artifacts/ai-coach-e3-closeout/2026-11-03/{regression,tsc}.log`; không đưa vào Git. Lệnh tái lập và danh sách scope giữ nguyên trong báo cáo adapter: 12 advisory, 19 ai-coach, scientific claim-map, bốn RAG và hai Bedrock suites. Đây không phải full repository regression.

Suite bao gồm final two-claim bound, common facts/policy, full `claimLinks`/identity, receipt validation/blinding, R1-only export, resume zero extra calls, contract parse failures, P2-1 accounting, D1/D2/D3 và LIVE rejection. Không đổi gate hoặc thống kê vì scripted warmup bị chặn. Không chạy lại actual-input warmup hoặc gọi transport thật; kết quả 8/8 FAKE trước đó vẫn chỉ là fixture evidence.

Đối chiếu protected manifest: **69/69 nguyên vẹn**. Frozen V2 tests chạy không skip; SHA256 evidence-pack vẫn `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`, results vẫn `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. Diff đối chiếu base cho advisory-progress, `statistics.ts`, routes và Bedrock application client không có thay đổi. Real Bedrock/Ollama/embedding/vector DB calls trong lượt closeout: **0**.

Commit chọn lọc chỉ gồm 14 file TypeScript implementation/tests và hai tài liệu adapter/readiness. Không đưa E3A proposal/dashboard changes vào commit này. Không commit owner decisions, scientific packets, snapshot, raw journals, trust, secrets hoặc ledger. Không merge. Hash commit được báo trong bàn giao; không nhúng hash tự tham chiếu vào commit.

14 file TypeScript, tương đối với `backend/services/ai-service/src/`:

- `__tests__/ai-coach-claim-pilot.test.ts`
- `evaluation/ai-coach-claim-dev/{pipeline,projection}.ts`
- `evaluation/ai-coach-dev/{pipeline,retrieval}.ts`
- `evaluation/bedrock-pilot/{claim-adapter,config,pins,prepare,runner,session}.ts`
- `evaluation/evaluation-kit/{annotations,lifecycle,offline-analysis}.ts`

Ngoài Git: toàn bộ 69 file trong protected manifest cũ, bao gồm review/audit inputs, private claim-map/bundle và hai decision stores; các file scientific review untracked khác; `artifacts/ai-coach-e3-adapter/2026-11-03/` và log/probe closeout. E3A proposal `data/eval/ai-coach-e3-prep/review-dashboard-items.json`, tài liệu E3A và `scripts/review-dashboard/` giữ ngoài commit này. Không ghi đè, stash, clean hoặc stage rộng.

## Owner scope hiện tại

Đọc trực tiếp `C:/D_Backup/project_personal/gymini-review-local/e3-owner-decisions.json`: revision 13, history 13. Đây là engineering choices theo ủy quyền trong chat, authority `OWNER_ENGINEERING_CHOICE_NOT_LIVE_AUTHORIZATION`, không phải scientific validation hoặc signed spend authorization.

- E13: Haiku 4.5, `anthropic.claude-haiku-4-5-20251001-v1:0`; profile `global.anthropic.claude-haiku-4-5-20251001-v1:0`, entry region `us-east-2`.
- E14/E15: warmup hai calibration case × hai arm × hai repeat = 8 calls; planning cap USD 1, 12,000 input/call, 2,048 output/call, 96,000 input tổng, 16,384 output tổng, retries 0, dừng khi hai failures. USD 5 cho main là đề xuất phase sau, không phát hành quyền chi tiêu.
- E16/E17: giữ tác giả/nguồn AI thật, owner-only exploratory, không independent gold/held-out hay reviewer thứ hai giả.
- E18: chỉ approve readiness requirements; không LIVE. E12 vẫn `KEEP_PENDING_EVIDENCE`. Không thay C22/A13/E07/CAL02/CAL03.

## Checklist warmup thật

`VERIFIED` dưới đây chỉ áp dụng đúng bằng chứng ghi trong hàng; kiểm thử fixture không xác minh tài khoản AWS. Không dùng giá FAKE làm official pricing.

| Điều kiện | Trạng thái | Bằng chứng / khoảng trống |
| --- | --- | --- |
| Model/profile/region được chọn trong engineering scope | VERIFIED | E13 revision 2; FAKE config dùng đúng ba identifier trên. Đây chỉ là lựa chọn, không chứng minh model còn active hoặc account dùng được. |
| Target model/profile thực sự khả dụng | NOT_VERIFIED | `profileModelConfirmed=false`; không đọc model access/lifecycle/profile API trong lượt này. |
| Exact CountTokens và Converse payload/target compatibility | NOT_VERIFIED | Chỉ có CPU byte-based fake counter. `session.ts:inferenceTarget` hiện từ chối Haiku/E2 LIVE và profile LIVE; không đếm base model thay profile để vượt gate. |
| IAM/model access | NOT_VERIFIED | Không đọc credentials, STS, IAM, Bedrock API hoặc account policy. Cần owner/account operator xác minh đúng principal và target route. |
| Official pricing đúng model/profile/region và expiry | NOT_VERIFIED | Config hiện `FAKE_TEST_ONLY`, USD 1/5 mỗi triệu token chỉ là fixture planning rates, `approval=null`. URL pricing không chứng minh rate đã được xác minh. Cần evidence mới và `OWNER_CONFIRMED_AWS` pin trước issuance. |
| Account quotas/capacity | NOT_VERIFIED | Chưa có account/region-specific quota hoặc throttling evidence. Không dự đoán từ số calls nhỏ. |
| Data residency, retention và invocation logging | NOT_VERIFIED | Global là route được chọn, không có bảo đảm chỉ xử lý Ohio. Chưa có target destination/data handling/account logging evidence được owner chấp nhận. Synthetic-only không thay privacy review. |
| Budget reservation/failure/resume accounting bằng code | VERIFIED | Existing scoped D2/pilot fixtures kiểm tra cap, reservation, unknown spend, durable locking/resume; adapter không đổi công thức. Không phải tiền đã được cấp hoặc AWS bill. |
| Budget thật được cấp và ghi nhận chi phí | BLOCKED | Chỉ có FAKE config/fixture ledgers; không có authorization chain LIVE từ config hiện tại. |
| Installed trust root | BLOCKED | Read-only `Test-Path C:/ProgramData/Gymini/Evaluation/trust.json` trả false. Không tạo file/key. |
| Signed authorization đúng config/pins/expiry | BLOCKED | `approval=null`; dashboard records không phải Ed25519 signature được `installedApproval` xác thực. |
| Durable owner-issued ledger | BLOCKED | Không có trusted ledger directory từ installed trust, không có issued LIVE authority được config này tham chiếu. Không tạo ledger hoặc dò journal riêng tư không liên quan. |
| LIVE execution lock còn đóng | VERIFIED | `run.ts`: `CLI_LIVE_LOCKED`; `runner.ts`: `RUNNER_LIVE_LOCKED`; `session.ts`: `CLAIM_PILOT_LIVE_NOT_READY`. Negative regression dùng fake transport; không dispatch AWS. |
| Clean committed implementation/pins để phát hành | BLOCKED | Commit adapter không xóa scientific review untracked. Existing LIVE clean-tree check còn yêu cầu checkout sạch và pin lại code/corpus/cases/prompts cho config sau cùng; FAKE config cũ không tự trở thành LIVE config. |

## Evaluation integrity giữ nguyên

Hai arm nhận cùng personal facts/provenance và system policy; chỉ RAG nhận tối đa hai ranked approved claims với excerpt/scope đầy đủ. Giới hạn hai claim không chứng minh scientific recall/coverage. Không chỉnh gate vì dummy warmup bị chặn 8/8.

Full E2 envelope, `claimLinks`, full-candidate identity và versioned legacy projection được giữ trong internal results; packet receipts bind full candidate. R1-only distribution giữ reviewer blinding, không phát R2 artifact hoặc giả annotation. Raw/generated/blocked/failed/released accounting vẫn riêng. Full raw ở đây theo contract redacted-canonical, không phải archive secrets nguyên văn.

Reviewer phải đọc **toàn bộ câu trả lời**, gồm observation, claim gắn sai loại, rationale/conclusion và câu hỏi, để ghi nhận unsupported personal statements. Denominator theo claim type tự động không bảo đảm bắt hết all-text lỗi. Owner-only được ghi `EXPLORATORY_OWNER_REVIEWED`; không suy independent κ/CI, causal improvement hoặc model quality từ FAKE results. Usefulness guard cần câu trả lời model thật và đánh giá thật.

## E3 Case Intake: format và kế hoạch nối tối thiểu

Đã có implementation tại `C:/D_Backup/project_personal/gymini-review-local/e3-case-intake-ui`; **CODE AUDIT**, không tuyên bố đã kiểm thử browser hoặc trạng thái case thật. `server/exports.js` xuất canonical `e3-case-intake-export-v1`, `...-all-v1` và `...-frozen-v1`, giữ source/template hash, canonical cases/authorship và compatibility report. `e3-model-input-preview-v1` chỉ là preview, không phải generation release.

**TEST FIXTURE** độc lập, in-memory (`intake-format-probe.mjs`) xác nhận export giữ provenance/labels ở canonical, `modelInput` và request projection loại các sentinel trong labels, reviewer notes và authorship. Không đọc/ghi case owner, không khởi động intake server, không import hoặc freeze dữ liệu thật. Đây chỉ là kiểm tra format/allowlist; nội dung free-text vẫn cần kiểm tra leakage/PII trước release.

Export có thể làm đầu vào cho bước chuyển đổi offline, nhưng **chưa trực tiếp tương thích runner**. `compat.projectDevRequest` tự ghi `UNVALIDATED_MECHANICAL_PROJECTION_NOT_FOR_RUNNER`: snapshot có `recordedAt=null`, tối đa 120 intake rows so với 20 facts/snapshot, các extension fields chưa có nơi trong request. Không tự gán thời gian export thành thời gian đo, không tự tính e1RM/outcome mới.

Khi owner phát hành case, bước chuyển đổi cần:

1. Đọc canonical/frozen export, xác minh integrity và freeze receipt, giữ nguyên authorship, AI exposure, cluster/variants và source hashes trong private provenance. Duy trì namespace synthetic, xác minh synthetic classification; không đổi dữ liệu thật thành synthetic chỉ bằng nhãn.
2. Chốt mapping/time convention/row limits rõ ràng; validate `DevRequestSchema`, không silent-drop fields. Chỉ allowlist facts/question/conversation và context được phép vào generation. Knowledge/labels/reference-support/reviewer notes ở private sidecar, không dùng relevantClaimIds hoặc expected outcome để ép retrieval.
3. Giữ provenance owner-exploratory thực tế. D1 `ReviewerCaseSchema` hiện chỉ nhận `INDEPENDENT_REVIEWER` + `independenceAttested=true`; **không khai true hoặc HELD_OUT để lách**. Intake-to-release và formal owner-exploratory D3 admission vẫn PENDING; cần một quyết định mapping nhỏ riêng, không thêm runner/analyzer/UI thứ hai.
4. Sau khi có valid release input, reuse existing runner, R1 exports/receipts và full raw/post-gate accounting. Calibration không trở thành independent held-out; variants cùng cluster không tăng số mẫu độc lập.

## Công việc tối thiểu còn lại trước warmup

Owner/account operator cung cấp bằng chứng target/counting, IAM/quotas, official pricing và privacy/logging. Sau đó mới chuẩn bị config/pins từ checkout sạch và cấp trust/signature/issued ledger bằng authority thật. Một thay đổi được ủy quyền riêng phải nối đúng counting/inference target và mở controlled LIVE entry trong **hạ tầng hiện có**, sau negative/FAKE checks; không bỏ ba lock trong closeout này. Intake mapping là việc phase main riêng, không cần tự import 20 case để hoàn tất calibration warmup.

Dừng phát triển adapter sau commit. Không mở LIVE, không tự tạo approval/ledger, không production deployment.
