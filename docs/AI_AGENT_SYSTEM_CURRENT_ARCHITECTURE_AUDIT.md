# Gymini AI Agent System — Audit kiến trúc hiện tại

> Mục đích: phục vụ các nhóm nghiên cứu RAG/AI thiết kế kiến trúc AI Agent
> System cho buổi meeting với giảng viên. Toàn bộ nội dung dưới đây được
> xác minh trực tiếp từ code trong `backend/services/ai-service`
> (2026-09-14), không suy đoán. Đường dẫn file tương đối theo
> `backend/services/ai-service/src/` trừ khi ghi chú khác.
>
> Lưu ý theo quy ước của repo: tài liệu `docs/*.md` là bằng chứng/lịch sử
> tại thời điểm viết, không phải nguồn sự thật vĩnh viễn — code luôn là
> nguồn sự thật. Khi dùng tài liệu này để thiết kế, hãy đối chiếu lại code
> nếu đã có thay đổi.

## 0. Bối cảnh tổng thể

`ai-service` **không sở hữu dữ liệu nghiệp vụ**. Nó chỉ gọi HTTP sang các
service nghiệp vụ (`clients/fitness.client.ts`, `user.client.ts`,
`auth-service.client.ts`, `payment.client.ts`) để đọc/ghi; nguồn sự thật
(`FitnessRoadmap`, `TrainingCycle`, `WorkoutProgram`, `NutritionGoal`,
`Exercise.id`...) vẫn nằm ở các service nghiệp vụ như trước. AI là lớp
tích hợp thông minh nằm bên trên hệ thống thông tin doanh nghiệp hiện có,
đúng mô hình "existing business system + AI integration layer".

---

## 1. Dữ liệu nào được chunk vào Vector DB

- **Vector DB: Qdrant** (`repositories/qdrant.ts` — singleton
  `QdrantClient`, trỏ `QDRANT_HOST`/`QDRANT_PORT`, mặc định
  `localhost:6333`).
- **Embedding model: Ollama `nomic-embed-text`** (`services/llm.service.ts`).
  Embedding luôn đi qua Ollama-compatible `/api/embeddings` (fallback
  `/api/embed`) **bất kể** provider chat đang dùng là gì — kể cả khi chat
  dùng Claude, vì Anthropic không có endpoint embeddings.
- **4 collection** (`llm/retriever.ts`):
  - `exercises`, `fitness_knowledge`, `fitness_faq`, `fitness_evidence`
    — dùng cho retrieval khi chat.
  - `fitness_evidence` riêng — dùng để trích dẫn bằng chứng khoa học khi
    generate plan. **AI-plan không bao giờ lấy exercise từ Qdrant**, chỉ
    từ catalog thật ở fitness-service (đúng nguyên tắc `Exercise.id` là
    identity duy nhất).
  - Tên collection cấu hình qua `KNOWLEDGE_QDRANT_COLLECTION` (mặc định
    `fitness_evidence`), vector size `768`.
- **Nguồn dữ liệu được chunk**: bài báo PubMed, RSS (ví dụ ScienceDaily),
  trang web whitelist (ví dụ ACSM), evidence JSONL nội bộ curated.
- **Chiến lược chunk (pipeline chính thức)**: cửa sổ cố định ~1200 ký tự,
  overlap 160 ký tự, snap điểm cắt theo ranh giới câu (`. `, `; `, `: `)
  khi điểm đó nằm sau 55% cửa sổ; điểm bắt đầu overlap của chunk kế tiếp
  cũng được snap theo ranh giới từ.
- **Metadata gắn theo từng chunk**: `title`, `source_type`, `category`,
  `content`/`text`, `topic`, `source_url`, `evidence_level`, `tags`,
  `chunk_index`, `total_chunks`, `extraction_method`, `created_from`,
  `source_file`, `chunk_id` (`${documentId}:${index}`), `document_id`,
  `source_name`, `source_tier` (trust tier), `trust_score`,
  `quality_score`, `language`, `published_at`. Chunk cũng được mirror
  sang bảng Postgres (`knowledgeRepository.insertChunk`) để lineage/audit.

### ⚠️ Phát hiện: 2 pipeline chunk/ingest song song, cùng ghi vào `fitness_evidence`

| | `knowledge-pipeline/` (chính thức) | `knowledge/pipeline/` + `knowledge/connectors/` (research automation) |
|---|---|---|
| Chunker | `chunking.ts::chunkText()` — có overlap, snap câu | `chunk.ts::chunkResearchRecord()` — cắt cứng, không overlap, không snap |
| Nguồn | `local-evidence.ts`, `pubmed.ts`, `rss.ts`, `web.ts` (điều khiển bởi `source-registry.ts`) | `connectors/`: `pubmed.connector.ts`, `crossref.connector.ts`, `openalex.connector.ts`, `webpage.connector.ts` (điều khiển bởi `knowledge/source_registry.ts`) |
| Wiring vào server | **Có** — `qdrant-writer.ts::embedAndUpsertDocument` được gọi từ `knowledge-pipeline/service.ts`, expose qua `routes/internal.routes.ts` + `admin.controller.ts`, chạy nền qua BullMQ `Worker` (`knowledge-pipeline/worker.ts`) | **Không** — `index_to_qdrant.ts::indexResearchRecordsToQdrant` chỉ được gọi từ CLI script (`scripts/researchFetch.ts`, `researchIndex.ts`), gated `ENABLE_RESEARCH_AUTOMATION=true`, chạy qua cron ngoài (`researchScheduler.ts`) |
| Evidence scoring | `scoring.ts::computeTrustScore/computeQualityScore` (rule-based) | `evidence_score.ts::scoreEvidence` (rule-based, khác công thức) |

**Kết luận**: `knowledge-pipeline/` là pipeline ingest chính thức/đang chạy
tự động. `knowledge/pipeline/` + `knowledge/connectors/` là pipeline phụ
(nguồn rộng hơn — thêm Crossref/OpenAlex — nhưng chunker thô hơn), chỉ
chạy thủ công, ghi vào cùng collection qua đường khác. Đây là nợ kỹ thuật
thật, nên hợp nhất trước khi mở rộng — điểm tốt để đưa vào slide như một
finding thực tế của nhóm.

---

## 2. Retrieval hoạt động thế nào

(`llm/retriever.ts`, `services/rag.service.ts`)

- **Query expansion**: `retriever.retrieveForChat()` mở rộng câu hỏi gốc
  thành nhiều biến thể (`expandQueries()` — rule-based, ví dụ tự thêm
  "calorie deficit high protein" khi phát hiện ý định giảm mỡ), gửi song
  song tới cả 4 collection.
- **Tham số**: `TOP_K` = `RAG_TOP_K` env (mặc định 5); `MIN_SCORE` =
  `RAG_MIN_SCORE` env (mặc định 0.35) — kết quả dưới ngưỡng cosine score
  bị loại ngay trong `searchCollection()`.
- **Filter**: có filter thiết bị tại nhà (`GYM_ONLY_EQUIPMENT`, Qdrant
  `must_not` trên `typeOfEquipment`) áp dụng cho collection `exercises`
  khi phát hiện câu hỏi kiểu "không có thiết bị"/"tập ở nhà"
  (`detectHomeOnlyConstraint()` — regex).
- **Không có reranking bằng LLM** — kết quả dedupe theo id (giữ score cao
  nhất) rồi sort thuần theo Qdrant similarity score
  (`dedupeAndSort()`), cắt còn `TOP_K`.
- **Evidence retrieval riêng**: `retriever.retrieveEvidence(queries)` chỉ
  tìm trong `fitness_evidence`, tối đa 5 query, dedupe/sort, cắt còn 4 —
  dùng cho trích dẫn bằng chứng khi generate plan (`llm/plan_evidence.ts`).
- `services/rag.service.ts` **không tự retrieval** — nó resolve/tạo chat
  session, giao toàn bộ câu hỏi cho `llmOrchestrator.run()`, lưu kết quả
  hội thoại, và tùy chọn chạy thêm 1 lần LLM self-eval (`ENABLE_LLM_SELF_EVAL`,
  mặc định tắt) phân loại độ liên quan `NON_RELEVANT/PARTLY_RELEVANT/RELEVANT`.

---

## 3. Tools nào được "tự động chọn" — 3 tầng, phần lớn không phải LLM chọn

Đây là điểm cần làm rõ nhất khi trình bày, vì Gymini **chủ yếu dùng
router luật (regex)**, không dùng LLM để chọn tool cho phần nghiệp vụ lõi:

| Tầng | File | Cơ chế chọn | LLM có tham gia chọn không |
|---|---|---|---|
| Domain action tools (đặt lịch, tạo roadmap, apply plan, accept/reject recommendation...) | `services/fitness-agent-intent.ts` (`parseFitnessAgentIntent`) | Regex/keyword tiếng Việt đã chuẩn hoá dấu | **Không** — comment trong code: *"Ranking, prescription and action execution are never inferred by a model"* |
| Intent chat (meal_plan, workout_plan, general_knowledge, unsafe_weight_loss...) | `llm/intent_router.ts` | Regex | **Không** |
| RAG-chat tools: `search_exercise_library`, `get_user_fitness_data`, `remember_user_fact` | `llm/tools.ts` | **LLM function-calling thật** (Ollama native tool-calling, model `qwen3:30b-a3b-instruct-2507-q4_K_M`) | **Có**, nhưng **mặc định TẮT** (`ENABLE_TOOL_CALLING=false`); giới hạn `MAX_TOOL_CALLS_PER_TURN = 2`, chỉ 1 vòng round-trip |

**Danh sách domain action tools** (`fitness-agent-tools.ts`, ~30
phương thức, đều gọi HTTP thật qua helper `domain()`, response Zod-validated):
`findPTCandidates`, `findTrainingPrograms`, `createPTContractDraft`,
`confirmPTContract`, `applyTrainingPlan`, `generateRoadmapDraft`,
`acceptRoadmapDraft`, `activateRoadmap`, `getCurrentRoadmap`,
`advanceRoadmapPhase`, `previewRoadmapRebuild`, `applyRoadmapRebuild`,
`archiveRoadmap`, `searchFood`, `createNutritionLog`, `getTodaySchedule`,
`start/skip/cancelWorkoutSchedule`, `bootstrapNutrition`,
`importAiPlanToSchedule`, `searchExerciseByName`, `substituteMealItem`,
`getActiveCycle`, `evaluateCycle`, `completeCycle`, `cancelCycle`,
`reviewRecommendation`, `getScientificEvidence`.

**3 tool LLM function-calling** (`llm/tools.ts`, `AVAILABLE_TOOLS`):
- `search_exercise_library` — tìm bài tập theo nhóm cơ/kiểu vận động,
  lọc theo thiết bị (wrap `retriever.searchExercises`).
- `get_user_fitness_data` — lấy dữ liệu của chính người dùng theo yêu cầu
  (workout_history / inbody / nutrition_logs).
- `remember_user_fact` — lưu một fact/sở thích bền vững vào `UserMemory`
  (ghi long-term memory).

→ **Trả lời trung thực cho câu "tool nào AI tự chọn"**: phần nghiệp vụ có
rủi ro/audit (roadmap, PT, nutrition, workout) luôn đi qua router luật
xác định trước, không phải LLM. Chỉ có một tập tool nhỏ, phụ trợ (tra
cứu bài tập, lấy dữ liệu người dùng, ghi nhớ fact) là để LLM tự quyết
định gọi — và tính năng này còn ở dạng thử nghiệm (tắt mặc định).

---

## 4. Các Agent tương tác ra sao — thực chất là 1 orchestrator, không phải multi-agent

Không có kiến trúc kiểu "agent A gọi/đàm phán với agent B". Có **một
orchestrator duy nhất** (`llm/orchestrator.service.ts`, ~1200 dòng),
luồng xử lý một turn chat:

1. **Language detection** (`languageGuard.resolve`) — đồng bộ, trước mọi I/O.
2. **Safety gate** (`safetyGuard.check`) — chặn sớm 11 loại câu hỏi nguy
   hiểm/off-topic bằng regex, trả template tĩnh, không tốn RAG/LLM.
3. **`fitnessAgent.tryTurn()`** — dispatcher hành động dựa theo intent
   luật (mục 3); nếu khớp, trả lời ngay và **không** chạm tới RAG/LLM
   cho turn đó (nguồn: `responseSource: "fitness_agent"`).
4. Nếu không khớp: fetch **song song** — profile/personalization
   (`profileExtractor.extract`), Qdrant retrieval
   (`retriever.retrieveForChat`, bỏ qua nếu là lookup nutrition/schedule),
   5 lượt chat gần nhất, tối đa 20 long-term memory.
5. Một loạt engine luật xác định: nutrition lookup, workout-schedule
   lookup, body-composition analysis, `recommendationEngine` (workout
   plan template), `answerValidator`/`nutrition_engine` cross-check —
   toàn bộ deterministic TypeScript, không LLM.
6. **Chỉ 1 lần gọi LLM** cho các intent cần văn bản sinh động (general
   knowledge, meal plan, body recomposition...): `promptBuilder.build()`
   gộp câu hỏi + input đã parse + profile + tài liệu RAG/evidence +
   recommendation + chat history + body-comp text thành 1 prompt lớn, rồi
   gọi `runToolCallingTurn()` (nếu bật tool-calling) hoặc
   `llmService.callLLM()` bình thường — **1 lần gọi model/turn**, không
   phải vòng lặp agent nhiều bước.
7. **Validation + fallback nhiều lớp**: `answerValidator.validate()` đối
   chiếu câu trả lời LLM với số liệu deterministic; nếu lệch nghiêm
   trọng, rỗng, hoặc là một lời từ chối ngoài phạm vi — **loại bỏ câu trả
   lời LLM, thay bằng câu trả lời deterministic**
   (`usedDeterministicFallbackBecauseOfValidation`).
8. Tổng hợp response cuối + trace logging (`traceLogger`).

**Nhận xét kiến trúc**: đây là mô hình **"deterministic-first,
LLM-as-narrator"** — LLM chỉ được tin dùng để diễn giải ngôn ngữ tự
nhiên; mọi số liệu/quyết định nghiệp vụ (calo, macro, roadmap phase...)
đều có nguồn sự thật xác định và LLM bị validate/ghi đè nếu sai lệch.
Khác với mô hình multi-agent cổ điển (planner agent → executor agent →
critic agent) — đây là điểm để nhóm so sánh/đề xuất hướng mở rộng trong
thiết kế kiến trúc AI Agent System.

---

## 5. AI context & memory quản lý thế nào

(`repositories/conversation.repository.ts`, `controllers/memory.controller.ts`)

- **Lưu trữ**: Prisma/Postgres. Bảng `Conversation` (1 dòng/lượt hỏi-đáp),
  `ChatSession`, `UserMemory` (fact dài hạn).
- **Short-term memory**: **5 lượt `Conversation` gần nhất** cùng
  `userId`+`sessionId`, lọc bỏ các lượt fallback/bị thumbs-down, đưa vào
  prompt qua `promptBuilder.build(...chatHistory...)`.
- **Long-term memory**: bảng `UserMemory`, chỉ được ghi qua tool
  `remember_user_fact` (LLM tự quyết định khi nào đáng nhớ, chỉ hoạt
  động khi `ENABLE_TOOL_CALLING=true`), đọc tối đa **20 fact/user**
  (`findMemoriesByUser`), cắt theo **FIFO cứng**
  (`pruneOldestMemories(userId, keepCount=20)`) — **không có bước tóm
  tắt/summarization** nào khi vượt ngưỡng.
- **Cô lập theo user**: mọi query đều scope theo `userId`; xoá memory của
  người khác trả 403 (`memoryController.remove()`); mọi hành động agent
  verify `ChatSession.userId === identity.userId`
  (`fitness-agent.service.ts::ownSession()`); `rag.service.ts` 404 nếu
  `sessionId` không thuộc về caller.
- **API**: `routes/memory.routes.ts` — `GET /` (list), `DELETE /:memoryId`
  (xoá 1 fact), mount dưới `/ai/memories`, kế thừa auth từ `ai.routes.ts`.

**Khoảng trống đáng lưu ý**: không có cơ chế context-window
compaction/summarization nào trong toàn bộ ai-service — giới hạn 5
lượt/20 fact là cắt cứng, dễ mất ngữ cảnh dài. Đây là điểm nhóm có thể đề
xuất cải tiến trong thiết kế kiến trúc mới.

---

## 6. Nền tảng LLM / provider

(`services/llm.service.ts`)

- Multi-provider, chọn qua `LLM_PROVIDER` env (mặc định `ollama`).
- Mặc định vận hành: **Ollama tự host**, `LLM_MODEL=llama3.2:3b`,
  `EMBEDDING_MODEL=nomic-embed-text`.
- Nhánh Anthropic đã cài đầy đủ (`@anthropic-ai/sdk`, model mặc định
  `claude-sonnet-5` khi `LLM_PROVIDER=anthropic`), có xử lý riêng cho
  `refusal` stop-reason và "floor" token budget (vì cap `numPredict` được
  tune cho model nhỏ local sẽ cắt cụt output của Claude).
- Embedding **luôn** qua Ollama bất kể provider chat (mục 1).
- Provider khác: `mock` (test), OpenAI-compatible fallback (LM
  Studio/vLLM/OpenAI).
- `llm/json_llm_call.util.ts::callLlmJson()` — helper dùng chung: gọi LLM
  ở JSON-mode + validate Zod + retry (mặc định 2 lần) + trả `null` khi
  hết retry; tự trích object JSON cân bằng đầu tiên trong text để chống
  model nhỏ local thêm chữ thừa sau JSON hợp lệ.

---

## 7. Safety / guardrail — 2 lớp riêng biệt

- **`llm/safety_guard.ts`** (652 dòng) — chạy **trước** khi vào pipeline
  chat, regex-based, chặn: yêu cầu giảm cân cực đoan/nhanh, triệu chứng
  cấp cứu y tế, yêu cầu liều PED/steroid, yêu cầu calo cực thấp (<800
  kcal chặn cứng, 800–1199 kcal cảnh báo theo hướng dẫn IOC RED-S/ACSM),
  vị thành niên, thai kỳ/cho con bú, rối loạn ăn uống, dị ứng nặng,
  prompt injection, off-topic. Khớp là trả template tĩnh (vi/en) ngay,
  **trước cả khi fetch profile hay gọi RAG/LLM**.
- **`knowledge-pipeline/safety-judge.ts`** — guardrail khác, chạy lúc
  **ingest tài liệu vào vector DB**, không phải lúc chat: LLM-as-judge
  tùy chọn (`KNOWLEDGE_ENABLE_LLM_SAFETY_JUDGE=true`) phân loại tài liệu
  an toàn/không an toàn (`medical|supplement|extreme_weight_loss|sales|none`)
  trước khi cho vào Qdrant; bổ trợ cho `detectSafetyIssue()` regex-based
  trong `scoring.ts` (chạy vô điều kiện; LLM judge chỉ chạy nếu regex
  chưa flag và feature bật; lỗi luôn "skip", không bao giờ chặn ingest).

---

## 8. Tóm tắt cho slide trình bày

| Trục yêu cầu của thầy | Hiện trạng Gymini |
|---|---|
| Dữ liệu nào chunk vào vector DB | PubMed/RSS/web whitelist/evidence nội bộ → `fitness_evidence`; catalog bài tập/FAQ/knowledge → 3 collection khác. **2 pipeline ingest song song, cần hợp nhất.** |
| Tool nào tự động chọn | Nghiệp vụ lõi: router luật (regex), không LLM. Chỉ 3 tool phụ trợ RAG dùng LLM function-calling thật, đang tắt mặc định. |
| Agent tương tác ra sao | Không phải multi-agent — 1 orchestrator điều phối tuần tự qua safety gate → action dispatcher luật → RAG song song → engine luật → 1 lần gọi LLM → validate/fallback. |
| Context & memory quản lý thế nào | Short-term: 5 lượt hội thoại gần nhất. Long-term: `UserMemory` FIFO cap 20, không có summarization. Cô lập chặt theo `userId`. |
| Hệ thống doanh nghiệp | Không đổi — AI chỉ gọi HTTP sang các service nghiệp vụ hiện có, không sở hữu dữ liệu nghiệp vụ. |
