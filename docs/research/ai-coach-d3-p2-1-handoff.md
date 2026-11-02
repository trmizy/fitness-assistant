# AI Coach — D3 P2-1 gate confusion correction

Ngày 2026-11-02. Reviewed base: 464fed05; branch feat/advisory-content-v3. Evidence: CODE AUDIT / TEST FIXTURE. Phạm vi duy nhất P2-1; chờ Claude Code xác minh lại đúng finding này.

## Root cause và patch

analyzeOffline đưa mọi row vào gateConfusion sau khi đổi decision thành boolean blocked. FAILED vì thế thành blocked=false, bị đếm FN hoặc TN tùy truth; failure mang BLOCKED còn có thể bị đếm TP.

Patch chỉ thêm gateRows = rows.filter(r => r.valid && (r.blocked || r.released)) và dùng tập này cho overall, per-scope và fixture confusion matrices. Theo schema hiện tại, GENERATED phải parse thành AnalysisEnvelope hợp lệ; released tương ứng decision ELIGIBLE. Candidate còn phải có quyết định BLOCKED hoặc ELIGIBLE. GENERATED + gate FAILED cũng bị loại.

Không thay gateConfusion arithmetic, Cohen κ, paired comparisons, bootstrap, annotation, budget/resume hoặc raw/post denominators. Failure accounting hiện có denominators.failed (raw status FAILED) giữ nguyên; không đổi failure thành blocked/released. Không còn sample hợp lệ thì labelled=0 và sensitivity/specificity/precision.value=null; valid sample thiếu adjudicated truth vẫn missing.

## Reproduction và regression

Regression mới chạy TRƯỚC patch tại reviewed code: 12 tests, 5 pass / 7 fail / 0 skip, exit 1. E1 fail với actual [TP,FP,TN,FN]=[0,0,0,1] thay vì [0,0,0,0]. Truth=false tái hiện TN=1 sai.

| Synthetic fixture | Trước [TP,FP,TN,FN] | Sau | Failure accounting |
| --- | --- | --- | --- |
| E1 FAILED, truth=true | [0,0,0,1], sensitivity=0/1 | [0,0,0,0], sensitivity=null | failed=1 cả trước/sau |
| FAILED, truth=false | [0,0,1,0], specificity=1/1 | [0,0,0,0], specificity=null | failed=1 cả trước/sau |
| Hai FAILED, truth true/false | [0,0,1,1], labelled=2 | [0,0,0,0], labelled=0; metrics null | failed=2 |
| Mixed 4 valid outcomes + 2 FAILED + 1 unknown-truth valid | [1,1,2,2], labelled=6 | [1,1,1,1], labelled=4, missing=1; sensitivity=specificity=0.5 | failed=2; rawRecorded=7, validGenerated=5, releasedValid=3, coverage=3/5 giữ nguyên |

12 regression cases gồm E1 true/false, bốn TP/FP/FN/TN hợp lệ, parse failure mang BLOCKED, GENERATED nhưng gate FAILED, all-failed, mixed, missing truth và per-scope branches. Nhánh independent-mode chỉ dùng synthetic metadata để kiểm code path; không tạo independent gold hoặc gọi provider.

Sau patch: offline analyzer 19 pass / 0 fail / 0 skip. Scoped regression 325 pass / 0 fail / 0 skip trong 32 file (12 advisory, 14 ai-coach, 4 RAG, 2 existing Bedrock SDK/STS fixture suites). pnpm exec tsc --noEmit: exit 0. Đây không phải full repository regression hoặc model evaluation.

Lệnh từ backend/services/ai-service: pnpm exec tsx --test src/__tests__/ai-coach-offline-analysis-d3.test.ts. Full scoped command như D1–D3 handoff, ADVISORY_V2_ARTIFACT_DIR trỏ preserved bedrock-guarded-v2 local artifacts; pnpm exec tsc --noEmit.

## Integrity và limitations

Frozen V2 integrity suites chạy với local artifacts. Pack SHA256: 4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea. Results SHA256: 4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a. Protected source/scientific bytes đối chiếu với reviewed base không đổi; statistics.ts và D1/D2 implementation không sửa. Không đổi production routes/config; CLI/runner vẫn FAKE_ONLY (negative LIVE test còn trong scoped suite).

Actual model/Bedrock calls=0, embedding calls=0, vector DB calls=0. Không merge. Chỉ ba file trong commit: offline-analysis.ts, ai-coach-offline-analysis-d3.test.ts và report này.

Các P3 chưa được yêu cầu vẫn là known limitations; không mở rộng sửa hoặc tự đóng 13 finding. Independent annotations, scientific review, model evaluation và authorization LIVE vẫn pending. Confidence/authority và model-effectiveness conclusions không được suy từ regression pass.

Bàn giao Claude Code: xác minh P2-1 rằng failure không ảnh hưởng TP/FP/TN/FN, các denominator/failure counters khác giữ nguyên; không yêu cầu audit lại toàn bộ kiến trúc.
