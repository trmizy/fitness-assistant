# 05 — AI architecture và workflow

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

Khuyến nghị **EXTEND_CURRENT_ARCHITECTURE_WITH_TARGETED_CHANGES**. Giữ orchestrator chung, workflow theo domain, validator xác định và quyền ghi ở service chủ sở hữu. Không có bằng chứng cần LangGraph/Mastra hay các agent tự trị riêng.

Tái sử dụng thực tế: AgentWorkflowSession lưu slots/known/revision/TTL trong Postgres; FitnessAgentAction lưu payload/proposal/status/result; FitnessRecommendation lưu candidate snapshot. resolveRevisionTarget lọc userId+sessionId+kind+TTL, ưu tiên pending draft rồi recommendation (E41: `backend/services/ai-service/src/agent-workflow/workflow-state.repository.ts:1`; E42: `backend/services/ai-service/src/services/revision/target-resolution.ts:23`). CI có belief/conflict/reference interpretation, các cờ off/shadow/on có phạm vi được ghi rõ (E36: `backend/services/ai-service/src/conversational-intelligence/index.ts:17`). Bộ revision đã có diff/reference/target resolution và các handler theo domain; không xây lại thành universal engine.

Workout-specific: ngày, sets, catalog/equipment, safety; nutrition-specific: authoritative goal, servings, meal/day totals; roadmap-specific: phase/timeframe/activation; PT-specific: contract/target client và audit. Shared envelope nên chứa intent, target, expected revision, constraints, diff; patch engine vẫn theo domain.

Regeneration phù hợp khi đổi frequency làm thay đổi split; không phù hợp MOVE. Existing incremental edits gồm exercise-count slice, minutes trim, day sets reduction, relabel lịch và named-exercise replacement (E05: `backend/services/ai-service/src/services/fitness-agent.service.ts:1870`; E06: `backend/services/ai-service/src/services/fitness-agent.service.ts:1976`). Nutrition có hypothetical calorie comparison chỉ đọc, bác bỏ claim COMPARE không tồn tại ở mọi domain (E18: `backend/services/ai-service/src/services/revision/nutrition-revision.ts:32`).

Business authority không nằm trong LLM text. Explicit confirmation đã có atomic PENDING→EXECUTING/CANCELLED, owner, session, TTL, replay COMPLETED và stale claim reclaim (E09: `backend/services/ai-service/src/services/fitness-agent.service.ts:1066`). Nhưng confirm không nhận content version và edits không CAS, nên có lỗ hổng giữa preview và execution (E04: `backend/services/ai-service/src/services/fitness-agent.service.ts:1823`; E10: `backend/services/ai-service/src/routes/fitness-agent.routes.ts:69`). Không được gọi mọi stale proposal đã an toàn chỉ vì TTL/claim tồn tại.

Không có một confirmation contract áp dụng tuyệt đối cho mọi thay đổi AI: nutrition meal substitution đã có ngoại lệ sản phẩm thấp rủi ro, ghi trực tiếp qua service với owner check/transaction, không đi FitnessAgentAction (E39: `backend/services/fitness-service/src/services/nutrition-agent.service.ts:10`; E40: `backend/services/fitness-service/src/services/nutrition.service.ts:382`). Không nên biến ngoại lệ được chủ sản phẩm cho phép thành lỗi authorization hoặc thêm confirmation không cần thiết.

| Phương án | Đánh giá dựa trên repo |
| --- | --- |
| A — mở rộng hybrid | Tận dụng state/claim/validators/domain ownership có sẵn; ít boundary hơn; chi phí/latency phụ thuộc model call thực tế, chưa benchmark. |
| B — agent tự trị mỗi domain | Chưa giải quyết capture/version/idempotency; tăng số contract tool auth và đồng bộ state; không có evidence cần thiết. |
| C — framework mới | Không có constraint kỹ thuật chứng minh framework hiện tại không đáp ứng; tăng migration/deployment/regression scope. |

Governance: CI-V2_LLM=off chỉ cấm parser second opinion, không phải kill switch mọi model. BDG-01/G-17 là một yêu cầu governance cần hợp đồng rõ; không suy luận vi phạm từ tên cờ. Providers Bedrock/Ollama/Anthropic/mock có report inventory; Bedrock đang dirty được giữ read-only, không xác nhận active provider/model/quota. Không gọi model, không mở heldout. AICAP-06..10 và ML/RAG depth chưa source-traced đầy đủ: schema existence không chứng minh runtime authority boundary.


**Bổ sung kiểm tra nguồn:** AssessCycleOutputSchema CÓ decision; cycle-assessment.service.ts ép về req.decision.value, requiresConfirmation=true và allowedChanges. Claim “decision field absent, structurally impossible” trong ai-integrations.json và report 06 là sai cơ chế. Exercise progression explanation là nhánh khác chỉ trả explanation; legacy analyze-cycle lại có model decision phase, không phải deterministic CycleAssessment. E55: `backend/services/ai-service/src/schemas/cycle-assessment.schemas.ts:90`; E56: `backend/services/ai-service/src/services/cycle-assessment.service.ts:153`; E72: `backend/services/ai-service/src/services/exercise-progression-explanation.service.ts:66`; E73: `backend/services/ai-service/src/services/cycle-analysis.service.ts:215`.

Delegated LLM tool executeTool lấy fitness data từ personalization đã xác thực, không nhận arbitrary clientId; tối đa hai tool calls. remember_user_fact vẫn dispatchable nhưng có memory policy và không được đề nghị trong tool list; không suy rằng đây là ghi business-authoritative state. E59: `backend/services/ai-service/src/llm/tools.ts:177`; E60: `backend/services/ai-service/src/llm/tools.ts:251`.

Enterprise Data Layer training reader forward bearer, phân biệt ok/absent/error, no-data không bị dùng thay lỗi transport (E61). RAG plan evidence chỉ fitness_evidence (E75/E76); exercise-search tool là path khác. Provider defaults từ source không xác minh active AWS provider (E67). ML artifacts directory trống ở checkout; loader missing/invalid trả null; đây là availability/fallback, không đơn giản là feature-flag-off (E68/E69).

NEW-GAP-003 cho thấy boundary cần mở rộng ngay trong hybrid hiện tại: router auth chưa đủ chứng minh intended service caller và cost governance cho từng generation endpoint.
