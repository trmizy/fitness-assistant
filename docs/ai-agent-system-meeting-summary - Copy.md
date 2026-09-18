# Tóm tắt cho buổi họp với giảng viên — Kiến trúc AI Agent System của Gymini

> **Cập nhật 2026-09-14 (Phase 3 — hardening cuối)**: sau phase triển khai ban đầu (112 test), một phase hardening thứ 2 đã đóng các gap Codex tìm ra độc lập ở Regression #2: Narrator validator được **thiết kế lại từ gốc** (structured claim grounding theo semantic category + negation-aware, không phải blacklist regex vá từng câu) — Codex tự chạy lại evaluator không sửa: **255/255 pass** (trước đó 6/30 trên bộ case paraphrase mới). Đã đóng thêm: ClientJourney idempotency ở mức DB (migration + upsert, verify với 10 request đồng thời thật), stale-state cho hợp đồng/apply-plan (PT ngừng nhận khách / gói bị archive giữa lúc draft và confirm), và 1 harness prompt-injection sống chạy thật với model local. Chi tiết đầy đủ: `docs/ai-agent-hardening-fix-report.md` (mục "PHASE 3 ADDENDUM"). Các số liệu Phase 2 bên dưới vẫn giữ nguyên làm lịch sử; phần Phase 3 bổ sung ở cuối tài liệu (mục 32).
>
> Bản đầy đủ: `docs/ai-agent-system-feasibility-audit.md` (audit gốc), `docs/ai-agent-implementation-report.md` (đã code gì), `docs/ai-agent-evaluation-report.md` (đo được gì thật), `docs/ai-agent-system-target-architecture.md` (kiến trúc + sơ đồ), `docs/pt-recommendation-methodology.md`, `docs/synthetic-agentic-dataset-methodology.md`, `docs/adr-client-journey-attribution.md`, `docs/ai-agent-research-evidence.md`.

## 1. Kết luận

Đã triển khai kiến trúc **Hybrid Two-Agent** (Option C): giữ nguyên orchestrator xác định (deterministic) + chính thức hoá tầng Enterprise Context + thêm **đúng 1 năng lực LLM mới**: Recommendation Narrator có validator chống bịa số liệu. Đã đóng gap dữ liệu lớn nhất (`ClientJourney` — trước đây 0 dòng dữ liệu, giờ có pipeline ghi thật + 331 dòng dữ liệu demo). Phát hiện và sửa 1 bug thật trong công thức xếp hạng PT (cold-start fairness). **112/112 test thật pass, không regression.**

## 2. Kiến trúc cuối cùng

```
Logical Agent 1 — Enterprise Data Agent ("Điều gì là đúng?")
  = agenticFitnessService.candidates() (user-service, đã có sẵn từ trước)
  + fitness-agent-tools.ts (~30 tool HTTP, đã có sẵn)
  + EnterpriseContext type mới (backend/shared/src/fitness-agent-context.ts)

Logical Agent 2 — Fitness Recommendation Agent ("Nên khuyến nghị gì, tại sao?")
  = scorePT() xếp hạng xác định (đã có sẵn, vừa sửa 1 bug cold-start)
  + journeySimilarity()/summarizeJourneys() (đã có sẵn)
  + RAG bằng chứng khoa học thật (đã có sẵn)
  + Recommendation Narrator MỚI (1 lệnh gọi LLM, có validator)
```

Không có agent nào là vòng lặp LLM tự trị. Duy nhất phần mới là bước "giải thích", bị validator chặn nếu bịa số.

## 3. Bao nhiêu % nền móng đã có sẵn / đã code thêm

- Hạ tầng tool/idempotency/xác nhận: **100% đã có sẵn, không đổi** (apply plan, PT contract automation — verify lại bằng test thật, không sửa gì).
- EnterpriseContext (type hoá): **mới code**, chưa nối vào mọi call site (việc refactor toàn bộ để dùng type này là bước tiếp theo).
- ClientJourney: schema+thuật toán có sẵn 100% → **giờ có pipeline ghi thật, đã chạy seed thật 331 dòng**.
- Recommendation Narrator + Validator: **0% → 100% code mới**, đã test 7/7 case chống bịa số liệu.
- Bộ dữ liệu PT demo: **0% → 60 PT + 331 journey, đã seed thật vào DB dev, verify idempotent 2 lần chạy**.

## 4. Những gì reuse được (không đổi)

Toàn bộ luồng draft→confirm hợp đồng PT, apply training plan, roadmap wizard, RAG/Qdrant retrieval, vision goal-image — tất cả giữ nguyên, verify lại bằng test thật (43 test hợp đồng/session liên quan không regression).

## 5. Những gì đã code mới (thật, có test)

1. `backend/shared/src/fitness-agent-context.ts` — type EnterpriseContext/RecommendationResult.
2. `backend/services/ai-service/src/llm/recommendation_narrator.ts` — Narrator + Validator (7/7 test pass).
3. `backend/services/user-service/src/services/client-journey-derivation.service.ts` — pipeline ghi ClientJourney thật, gắn vào đúng 1 điểm hợp đồng hoàn thành tự nhiên (7/7 test pass cho phần logic thuần).
4. `backend/services/user-service/src/scripts/seed-agentic-demo.ts` — seed dữ liệu demo (đã chạy thật).
5. Sửa bug cold-start trong `scorePT` (`backend/shared/src/fitness-agent-scoring.ts`, version bump compatibility-v2, 8/8 test pass).
6. Hợp nhất 2 pipeline RAG (agent nền thực hiện, 22/22 test pass).
7. Risk badge + UI cho 2 block loại còn thiếu ở frontend (agent nền thực hiện, build pass) — phát hiện thêm 1 bug thật (render nhầm candidates giữa các block type) trong lúc làm.

## 6. Image → GoalContext → Recommendation

**Chưa nối đầu cuối — DEFERRED có ghi rõ, không giả vờ đã xong.** Ảnh → trích xuất thuộc tính an toàn → xác nhận → lưu vào `UserProfile` đã hoạt động (có sẵn từ trước, đúng chuẩn an toàn). Chưa xác minh liệu `findPTCandidates`/`scorePT` có thực sự đọc dữ liệu goal-từ-ảnh này hay chỉ dùng `profile.goal` cơ bản — việc nối cần một quyết định thiết kế scoring cẩn trọng (không tự ý thêm chiều điểm số mới), để lại cho phase tiếp theo.

## 7. ClientJourney — dữ liệu thật được sinh thế nào

Không cần migration schema (ADR: dùng khoảng thời gian hợp đồng để suy luận baseline/ending InBody, thay vì thêm FK). Gắn vào đúng 1 hàm `checkAndCompleteContract` (nơi duy nhất trong toàn bộ codebase set trạng thái COMPLETED). Có cơ chế phòng sai lệch: bỏ qua suy luận nếu khách hàng có hợp đồng chồng lấn với PT khác cùng thời điểm (tránh gán nhầm). Không suy diễn quan hệ nhân quả — chỉ nhãn định hướng (IMPROVED/NO_CHANGE/REGRESSED/UNKNOWN), không bao giờ "PT này khiến bạn giảm cân".

## 8. Synthetic Dataset

60 PT, 331 ClientJourney, 331 SessionReview — đã seed thật vào DB dev, verify lại 2 lần chạy cho ra số giống hệt (idempotent thật, đo qua query DB trực tiếp). Phân bổ 6 archetype (cold-start, mạnh, hỗn hợp, yếu, mới-nhưng-có-chứng-chỉ, kinh nghiệm-nhưng-đánh-giá-trung-bình) — không phải "60 PT hoàn hảo". Guard production: script từ chối chạy nếu `NODE_ENV=production`.

## 9. PT Recommendation

Thuật toán không đổi (deterministic weighted sum, không LLM), trừ 1 bug fix cold-start. Hard constraints: PT đang nhận khách, có gói trong ngân sách, đủ slot thời gian thật. Soft score: goal/schedule/budget/reputation/evidence. Historical similarity: case-based reasoning (journeySimilarity), ngưỡng tối thiểu 5 mẫu mới tin. Cold-start: đã sửa để không bị phạt như PT có kết quả xấu thật — verify bằng test end-to-end thật với dữ liệu vừa seed.

## 10. Training Program Recommendation

**Cố ý chưa mở rộng.** `findTrainingPrograms` vẫn chỉ lọc, không xếp hạng — bịa trọng số khi chưa có thiết kế khoa học thể thao cẩn trọng sẽ vi phạm nguyên tắc "không đoán". Ghi nhận là bước tiếp theo, không build vội.

## 11. RAG

Hợp nhất 2 pipeline: `knowledge/pipeline/` đánh dấu deprecated tại chỗ, `knowledge-pipeline/` xác nhận là đường chính thức duy nhất. Đánh giá port Crossref/OpenAlex sang — quyết định KHÔNG làm (sẽ cần nhân đôi 6 file plumbing), ghi rõ gap thay vì làm dở dang.

## 12. Recommendation Narrator

LLM chỉ giải thích, không bao giờ tự tính điểm. Validator xác định (không phải LLM) chặn: % bịa, tuyên bố "khách tương tự" khi cohort=0, trích dẫn khoa học không có thật, ngôn ngữ cam kết/nhân quả. Bất kỳ vi phạm nào → rơi về template có sẵn, không bao giờ làm hỏng luồng khuyến nghị.

## 13. Memory / Context

Không đổi — 5 lượt hội thoại gần nhất + UserMemory FIFO-20, không cần sửa trong phase này (chưa có bằng chứng thực sự cần summarization).

## 14. Tool Selection

Không đổi — router luật cho hành động nghiệp vụ, LLM chỉ dùng cho 3 tool RAG phụ trợ (vẫn tắt mặc định, chưa test prompt injection — ghi rõ là gap chưa đo).

## 15. Human-in-the-loop

Đã thêm risk badge hiển thị trên UI xác nhận (trước đây tính nhưng không hiện). Cơ chế xác nhận 2 bước cho hợp đồng PT không đổi (đã đúng chuẩn từ trước).

## 16. Apply Plan Automation

Không đổi, verify lại bằng test thật — vẫn transactional, idempotent, có fingerprint chống stale-state.

## 17. PT Contract Automation

Không đổi, verify lại bằng test thật (43 test liên quan pass) — vẫn draft→confirm, advisory lock, thanh toán tách riêng qua webhook.

## 18. Prompt Injection / Security

**Chưa test trong phase này** — rủi ro đã nêu ở audit (nội dung RAG có thể kích hoạt tool `remember_user_fact` hay không) vẫn chưa được kiểm chứng vì `ENABLE_TOOL_CALLING` không được bật/test trong lần triển khai này. Ghi rõ là gap, không giả vờ đã an toàn.

## 19. Evaluation Results (chỉ số đo được thật)

- 112/112 unit/integration test pass (0 fail) — bao gồm 8 test cold-start scoring, 7 test validator chống bịa số liệu narrator, 7 test derivation logic, 2 test end-to-end với dữ liệu synthetic thật, 88 test regression hiện có (không hỏng gì).
- Seed thật: 60 PT / 331 journey / 331 review, verify idempotent qua query DB trực tiếp 2 lần.
- **Chưa đo**: chất lượng RAG retrieval, độ chính xác tool-selection, prompt injection, an toàn multimodal, latency/chi phí LLM thật (không có lệnh gọi LLM sống nào được thực hiện trong phase này — narrator mới test qua validator thuần, chưa test với model thật).

## 20. Test Results

Pass: 112. Fail: 0. Skipped: 0 (trong các suite đã chạy). Chi tiết đầy đủ theo từng file: `docs/ai-agent-evaluation-report.md`.

## 21. Database Migrations

**0 migration.** Quyết định kiến trúc rõ ràng (ADR): dùng suy luận theo khoảng thời gian hợp đồng thay vì thêm cột/bảng mới — đúng nguyên tắc "không migration mặc định" của dự án.

## 22. Frontend Changes

Risk badge cho ACTION_CONFIRMATION, UI card cho SUBSTITUTE_RESULT và CYCLE_EVALUATION_RESULT — build pass thật (`npm run build`, exit 0). Không có kiểm tra trình duyệt thật ở 360/375/390/412px (không có công cụ browser trong phiên này) — ghi rõ là chưa verify, không giả vờ đã test.

## 23. Research mới đã bổ sung

12 nguồn, phân loại AI Engineering / Fitness Science / Recommender-System / Safety — đầy đủ tại `docs/ai-agent-research-evidence.md`. Nổi bật: nghiên cứu cold-start fairness trong recommender system (SIGIR) trực tiếp hỗ trợ quyết định sửa bug `scorePT`; quy định về nhãn dữ liệu synthetic (EU AI Act, California AB 2013) xác nhận cách dự án đã đánh dấu `dataOrigin: SYNTHETIC` là đúng hướng.

## 24. Files Changed

Danh sách đầy đủ trong `docs/ai-agent-implementation-report.md`. Tóm tắt: 6 file mới ở backend (types, narrator, derivation service, seed script, 4 test file mới), 1 bug fix trong scoring, wiring vào 2 service hiện có (fitness-agent.service.ts, contract.service.ts), 2 file RAG deprecated + 1 README mới, 2 file frontend sửa.

## 25. Docs Created/Updated

`ai-agent-system-feasibility-audit.md`, `ai-agent-system-target-architecture.md` (cập nhật + sơ đồ ownership mới), `ai-agent-system-migration-plan.md`, `ai-agent-system-meeting-summary.md` (tài liệu này), `ai-agent-research-evidence.md`, `pt-recommendation-methodology.md`, `synthetic-agentic-dataset-methodology.md`, `adr-client-journey-attribution.md`, `ai-agent-implementation-report.md`, `ai-agent-evaluation-report.md`.

## 26. Những gì còn thiếu

- Image-goal → recommendation chưa xác minh nối đầu cuối.
- Training program recommendation chưa có scoring (chỉ filter).
- RAG evaluation, tool-selection accuracy, prompt injection, multimodal safety — chưa đo trong phase này.
- Chưa test narrator với LLM thật (chỉ test validator thuần).
- EnterpriseContext type chưa được dùng ở mọi call site (mới định nghĩa).

## 27. Những gì cố ý KHÔNG làm và lý do

- Không xây agent LLM thứ 2 tự trị (bản deterministic đã tốt hơn, có bằng chứng từ Anthropic guidance).
- Không cho LLM tự tính điểm/xếp hạng PT.
- Không chuyển sang LangGraph/framework agent nào.
- Không port Crossref/OpenAlex vào RAG pipeline chính (cần nhân đôi plumbing, không đủ giá trị so với công sức).
- Không mở rộng scoring cho training program (chưa có thiết kế khoa học thể thao đủ cẩn trọng).
- Không bật `ENABLE_TOOL_CALLING` mặc định (chưa test injection).

## 28. Demo scenario cho meeting với thầy

Kịch bản khả thi để demo: "Tìm PT phù hợp với tôi" (goal=WEIGHT_LOSS) → dùng dữ liệu 60 PT vừa seed → thấy PT có `history.count > 0` (bằng chứng lịch sử thật từ dữ liệu demo) xếp hạng khác PT cold-start → xem narration giải thích (nếu bật `ENABLE_RECOMMENDATION_NARRATION` và có LLM sống) hoặc why-string fallback. Tiếp theo: "Tôi chọn PT X" → "Tôi xác nhận" → tạo Contract thật (draft→confirm, idempotent). Toàn bộ luồng này chạy trên dữ liệu demo, có nhãn SYNTHETIC rõ ràng khi trình bày.

## 29. Architecture Mermaid

Xem `docs/ai-agent-system-target-architecture.md` §2-4, §8-9, §10.6 (đầy đủ AS-IS, TO-BE, RAG flow, 2 sequence diagram, data-ownership diagram).

## 30. Git status / commits

**Không commit gì** — theo đúng quy tắc dự án ("never commit unless explicitly requested"). Toàn bộ thay đổi nằm trong working tree, `git status` phản ánh chính xác các file đã sửa/tạo. Phát hiện: Codex đang xây dựng độc lập một eval harness riêng (`backend/services/ai-service/src/evaluation/agentic/`) song song trong cùng working tree — không đụng vào, không chạy hộ, ghi nhận trung thực.

## 31. FINAL STATUS

```
PARTIALLY COMPLETE
```

Lõi kiến trúc hybrid two-agent, pipeline dữ liệu ClientJourney, Recommendation Narrator có validator, bug fix cold-start, dữ liệu demo, và hợp nhất RAG — **hoàn thành thật, có test đo được (112/112 pass)**. Các phần còn lại (image-goal loop closure, training-program scoring, RAG/tool-selection/injection/multimodal evaluation, live-LLM narrator test) — **DEFERRED**, ghi rõ lý do, không giả vờ hoàn thành.

## 32. PHASE 3 — Hardening cuối (2026-09-14), cập nhật FINAL STATUS

Đáp lại đánh giá độc lập "Regression #2" của Codex (tìm ra validator Phase 2 vẫn fail 24/30 case paraphrase ngữ nghĩa mới + 4/8 case false-positive).

**Đã đóng trong Phase 3** (bằng chứng thật, evaluator của Codex không bị sửa):
- ADV-001 + ADV-005 (narrator bịa đặt / false-positive): thiết kế lại validator theo **semantic claim category** có nhận biết phủ định (negation-aware) ở mức câu, thay vì blacklist regex vá từng chuỗi. Sửa đúng gốc bug diacritic ("tính từ" và "tỉnh" cùng chuẩn hoá về "tinh"). Kết quả evaluator của Codex (không sửa fixture): **255/255 pass, 0 fail** (trước đó 6/30). Bộ test riêng: 41/41 pass, gồm 15 case paraphrase thế hệ 3 hoàn toàn mới (không copy từ Codex).
- ADV-006 (ClientJourney race condition): thêm migration `@@unique([contractId])` (đã verify 0 bản ghi trùng trước khi migrate) + `upsert()`. Test DB thật với 10 request đồng thời → đúng 1 bản ghi.
- Stale-state hợp đồng/apply-plan (PT ngừng nhận khách, gói bị archive giữa draft và confirm) — test DB thật, đúng 409, 0 bản ghi thừa.
- ADV-003 (prompt injection qua tool-calling): chạy harness thật với model Ollama local cho 3 kịch bản tấn công — model có làm theo lệnh injection hay không được đo riêng, và boundary xác định (`classifyMemoryFact`) có chặn ghi trái phép hay không được đo riêng. Cả 3 case: boundary chặn thành công dù model có tuân theo injection hay không.
- Phát hiện và sửa 1 regression thật trong `memory_policy.ts` (chỉ tiếng Việt, thiếu từ vựng tiếng Anh khiến sở thích hợp lệ bằng tiếng Anh bị từ chối mặc định) — phát hiện được vì Phase 3 chạy lại **toàn bộ** suite test có sẵn của ai-service, không chỉ các file mới.

**Đính chính 1 phát hiện của Phase 2**: `.env` port `11435` KHÔNG phải bug cấu hình — đọc lại comment trong file mới thấy đây là cổng SSH tunnel tới model RunPod từ xa, đơn giản là tunnel chưa bật trong phiên đánh giá. File `.env` không hề bị sửa ở cả 2 phase.

**Vẫn NOT MEASURED / BLOCKED**: tái tạo chỉ số Hit@5/Recall@5/MRR cho collection `exercises` (file dataset ground-truth không tồn tại trong repo — gap thật, không phải do môi trường); đánh giá ngữ nghĩa citation-support của RAG; kịch bản multi-candidate của live narrator; Training Program Recommendation (chủ động chưa bắt đầu, chờ Codex Regression #3 xác nhận).

```
FINAL STATUS (sau Phase 3): PARTIALLY COMPLETE — nhưng toàn bộ HIGH/MEDIUM finding từ đánh giá độc lập của Codex (ADV-001, 002, 003, 005, 006) đã CLOSED có bằng chứng. Phần còn lại DEFERRED có lý do rõ ràng, không phải lỗi chưa phát hiện.
```

## 33. PHASE 4 — Cấu trúc lại kiến trúc theo Codex Regression #3 (2026-09-14)

Codex Regression #3 độc lập trả về **NO-GO**: ADV-001 mở lại (48/50 case paraphrase thế hệ 4 mới bypass validator regex của Phase 3), ADV-003 mở lại (1 prompt injection dạng "sở thích hợp lệ" khiến hệ thống ghi thật 1 dòng UserMemory trái phép). Chi tiết đầy đủ: `docs/ai-agent-hardening-fix-report.md` mục "PHASE 4 ADDENDUM", `docs/recommendation-claim-catalog-design.md`, `docs/user-memory-provenance-design.md`.

**Bài học cốt lõi**: sau 3 lần vá regex liên tiếp đều bị bypass bởi cách diễn đạt mới, kết luận là **không thể vá thêm regex được nữa** — đây là lỗi sai ở tầng kiến trúc (trust boundary), không phải thiếu từ vựng.

**Kiến trúc mới cho Narrator (Structured Claim Grounding)**:
```
Dữ liệu doanh nghiệp thật -> Claim Catalog (server tự sinh, xác định)
  -> LLM CHỈ được chọn claim ID có sẵn (không viết câu nào)
  -> validate ID đúng phạm vi từng PT (chống dùng chéo ID)
  -> Renderer xác định render câu chữ -> người dùng
```
10 loại claim, mỗi loại gắn với 1 trường dữ liệu thật cụ thể (điểm phù hợp, khớp mục tiêu, khớp lịch, khớp ngân sách, uy tín thật, bằng chứng lịch sử thật, chứng chỉ đã xác minh, bằng chứng khoa học thật...). **Không có loại claim nào cho**: giá, lịch cam kết, địa điểm, y tế/PED, hành động đã hoàn tất, so sánh hơn thua — vì không có trường dữ liệu thật nào cho các loại này, nên LLM không có gì để chọn dù diễn đạt kiểu gì mới. Đây là lý do case paraphrase MỚI không còn bypass được — không phải vì regex bắt giỏi hơn, mà vì không còn chỗ cho LLM viết câu bịa nữa.

`validateNarration()` (validator regex cũ) được GIỮ NGUYÊN 100%, vẫn export — vì bộ evaluator của Codex gọi trực tiếp hàm này với chuỗi tự do, cần giữ tương thích ngược. Nhưng KHÔNG còn được gọi trong luồng sản xuất thật nữa (thử gắn vào rồi rollback: nó sẽ từ chối nhầm câu "chứng chỉ đã xác minh" hợp lệ mới của renderer). Vì vậy 48/50 case Regression #3 vẫn hiện FAIL khi Codex chạy lại evaluator — **đúng như dự kiến, đã ghi rõ lý do**, không phải bỏ sót: các case đó gọi thẳng validator cũ với văn bản tự do, một đường đi sản phẩm thật không còn dùng nữa.

**Kiến trúc mới cho Memory (ADV-003)**: bỏ hẳn `remember_user_fact` khỏi danh sách tool LLM được phép gọi — model không còn cách nào kích hoạt ghi nhớ trái phép nữa, bất kể có bị lừa làm theo chỉ thị injection hay không. Việc ghi nhớ hợp lệ chuyển sang pipeline xác định mới, quét trực tiếp câu chữ GỐC của chính người dùng (không qua LLM diễn giải lại), có thêm lớp chặn riêng cho khung câu kiểu "bỏ qua hướng dẫn hệ thống..." — chặn toàn bộ câu ứng viên trong tin nhắn đó bất kể nội dung nghe hợp lý thế nào.

**Sửa 1 sai sót thật của Phase 3**: báo cáo Phase 3 nói file dataset `ground-truth-retrieval.csv` không tồn tại — Codex tự kiểm tra độc lập thấy file NÀY CÓ TỒN TẠI (1035 dòng, ở gốc repo). Nguyên nhân: lần tìm kiếm Phase 3 chỉ giới hạn trong thư mục `ai-service`, bỏ sót thư mục `data/` ở gốc. Đã sửa và đo lại thật lần này: Hit@5=0.98, Recall@5=0.98, MRR=0.8187 trên 100 case — khớp gần như chính xác với số liệu gốc của Regression #1.

**Test thật**: 19 test catalog/renderer mới + 6 test tích hợp `narrateRecommendations` (LLM giả lập) + 9 test memory provenance mới (chữ hoàn toàn mới, không copy Codex) — tất cả pass. Toàn bộ suite ai-service (69 file): 700/700 pass, 4 skip, 0 fail. Evaluator Codex (không sửa): 273/366 pass — 50 fail y hệt trước và sau (đã giải thích rõ tại sao không phải regression thật).

```
FINAL STATUS (sau Phase 4): ADV-001 và ADV-003 (2 HIGH finding của Regression #3) đã CLOSED bằng thiết kế kiến trúc lại, không phải vá thêm case. ADV-005 CLOSED cấu trúc. Chờ Codex Regression #4 xác nhận độc lập trước khi bắt đầu Training Program Recommendation.
```
