# Báo cáo kiểm thử chức năng AI và đề xuất phát triển

**Dự án:** Fitness Assistant  
**Ngày kiểm tra:** 17/08/2026  
**Môi trường:** local Docker, Ollama, Qdrant, nhánh `feature/session-feedback-pt-mode`  
**Phạm vi:** mã nguồn hiện tại, test tự động, kiểm thử tích hợp AI đang chạy, dữ liệu fine-tuning và đối chiếu hướng dẫn chính thống.

## 1. Kết luận điều hành

Dự án đã có một nền tảng AI tương đối đầy đủ: orchestration, phân loại intent, RAG, guard, schema validation, fallback, metrics, hội thoại có memory và model Qwen2.5 đã fine-tune bằng QLoRA. Chat/RAG và tầng bằng chứng hoạt động tốt. Tuy nhiên, chưa nên coi hệ thống là sẵn sàng cho AI production hoàn toàn vì bộ sinh workout plan còn có thể tạo lịch sai schema và thay bài sai ngữ nghĩa nhưng vẫn trả trạng thái thành công.

Các kết luận chính:

- **Chat/RAG:** hoạt động; Qdrant và Ollama đều khỏe; benchmark truy xuất đạt hit@5 và recall@5 là `0.98`.
- **Workout plan AI:** có lỗi thực tế mức **P0/P1**. Một bài kiểm tra thất bại vì lịch không đủ đúng `daysPerWeek`; log còn cho thấy bước sửa tự động đôi lúc thay bài bằng bài không cùng nhóm cơ/mục tiêu.
- **Nutrition AI:** kiến trúc hybrid phù hợp, nhưng cần bổ sung golden-set live evaluation và kiểm tra bất biến calories/macros/allergy trước khi dùng production.
- **Cycle assessment và feedback:** thiết kế hiện tại đúng hướng: deterministic engine ra quyết định, AI chỉ giải thích/tóm tắt.
- **Fine-tuning:** đã huấn luyện thật và đã deploy model Q4, nhưng chưa có bằng chứng đánh giá live model đủ mạnh để kết luận model fine-tuned tốt hơn base model.
- **Evaluation harness:** có harness kiểm thử deterministic, policy và retrieval, nhưng hai runner quan trọng không gọi model thật. Script đánh giá dataset hiện không phù hợp kiểu dữ liệu hỗn hợp nên các chỉ số JSON/citation không phản ánh đúng năng lực model.
- **Bộ test tổng:** 394 test, 387 pass, 7 fail. Trong 7 lỗi, 4 lỗi marketplace chủ yếu là fixture/contract test đã cũ; 3 lỗi plan generation chạy từ host bị sai DNS Docker. Đây không phải tất cả đều là lỗi AI sản phẩm.
- **Chưa nên thêm AI vào payment, auth, booking, hợp đồng, check-in hoặc state machine.** Các phần này cần tính xác định, audit được và idempotent.

## 2. Hệ thống AI hiện tại

### 2.1 Model và hạ tầng

| Thành phần | Trạng thái kiểm tra | Nhận xét |
|---|---:|---|
| Ollama | PASS | Health endpoint trả `ok` |
| LLM | PASS | `fitness-coach-qwen2.5-1.5b:q4_K_M`, khoảng 986 MB |
| Base model fine-tune | Có | `unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit` |
| Embedding | PASS | `nomic-embed-text` |
| Qdrant | PASS | Kết nối và truy xuất được |
| Tool calling | Tắt mặc định | Nên giữ tắt cho đến khi có permission/policy harness đầy đủ |

Các collection quan sát được:

| Collection | Số điểm |
|---|---:|
| `exercises` | 207 |
| `fitness_knowledge` | 7.072 |
| `fitness_faq` | 5.946 |
| `fitness_evidence` | 115 |

### 2.2 Mức độ fine-tuning

QLoRA đã chạy hoàn chỉnh, không phải chỉ có script mẫu:

- Train: 15.944 mẫu; eval: 1.771 mẫu; production export: 814 mẫu.
- Một epoch, 1.993/1.993 bước; final eval loss khoảng `0.08517`.
- Adapter khoảng 70,49 MiB; merged model khoảng 2,944 GiB; F16 GGUF khoảng 2,950 GiB.
- Bản Q4 đã được nạp vào Ollama và phản hồi được.

Mức đánh giá hợp lý: **fine-tuning kỹ thuật đã hoàn thành, nhưng validation chất lượng production chưa hoàn thành**. Chưa có A/B test base-vs-fine-tuned trên cùng golden set, chưa có safety recall, schema success rate, hallucination rate và regression gate chạy trực tiếp qua model.

## 3. Kết quả kiểm thử

### 3.1 Ma trận kết quả

| Hạng mục | Kết quả | Bằng chứng/diễn giải |
|---|---:|---|
| Shared package build | PASS | Build hoàn tất |
| AI service TypeScript build | PASS | Build hoàn tất |
| Toàn bộ test | PARTIAL | 394 tổng; 387 pass; 7 fail |
| Deterministic evaluation | PASS | 20/20 |
| Policy behavior | PASS | 6/6 |
| Ollama health | PASS | Provider/model khả dụng |
| Qdrant health | PASS | Collection và vector search hoạt động |
| Knowledge RAG | PASS | Truy xuất tài liệu thật, có URL/evidence metadata |
| Evidence integration | PASS | Tầng evidence hoạt động |
| Training methods RAG | PASS | 4 phương pháp truy xuất được và citation-safe |
| Retrieval benchmark | PASS có cảnh báo | 98/100 hit; MRR `0.81867`; còn 2 truy vấn trượt |
| Intent routing | LOGIC PASS / TEST FAIL | Kỳ vọng ngày bị hard-code cũ; hệ thống trả ngày tương đối đúng hiện tại |
| Workout/nutrition live routing | LOGIC PASS / TEST FAIL | Phản hồi thật nhận được; assertion ngày `2026-06-02` đã lỗi thời |
| Plan evidence/live generation | FAIL THẬT | `weeklySchedule` không có đúng số ngày yêu cầu |
| Marketplace integration | 4 FAIL DO TEST DRIFT | Fixture/expected status không còn khớp business rules hiện tại |
| Prisma generate trên host | ENV FAIL | Windows `EPERM rename`, binary đang bị process/container giữ |
| InBody vision live | CHƯA ĐỦ BẰNG CHỨNG | Không có ảnh chuẩn và credential/provider thích hợp để đánh giá end-to-end |

### 3.2 Lỗi sản phẩm AI quan trọng

#### P0/P1 — Sinh workout plan không bảo đảm bất biến cuối

Test tích hợp trả lỗi:

```text
weeklySchedule must contain exactly daysPerWeek day objects
```

Log live còn cho thấy model tạo thiếu ngày, trùng ngày, sai exercise ID hoặc sai nhóm cơ. Bước deterministic repair can thiệp nhiều, nhưng đôi khi tạo thay thế sai ngữ nghĩa, ví dụ bài triceps được thay bằng tire flip hoặc bài bụng được thay bằng snatch. Nguy hiểm hơn, kết quả cuối vẫn có thể được đánh dấu `completed`.

Tác động:

- Người dùng có thể nhận lịch không đúng mục tiêu, thiết bị hoặc nhóm cơ.
- Trạng thái thành công gây false confidence cho UI, PT và dữ liệu downstream.
- Fine-tuning không giải quyết được nếu tầng constraint/validation cuối chưa chặt.

Cách sửa bắt buộc:

1. Sinh **khung plan deterministic trước**: số ngày, muscle split, volume budget, equipment constraints và danh sách exercise ID hợp lệ.
2. Chỉ cho LLM chọn trong candidate IDs đã lọc hoặc chỉ dùng LLM để viết giải thích.
3. Thêm final semantic invariant: đủ ngày; không trùng ngày; exercise tồn tại; equipment hợp lệ; primary muscle phù hợp; volume/risk trong biên; không có contraindication conflict.
4. Nếu repair vượt ngưỡng hoặc không tìm được bài cùng taxonomy thì **fail closed**, không trả `completed`.
5. Ghi `repairCount`, `repairReasons`, `constraintPass`, `modelRawVersion` vào telemetry.

#### P1 — Evaluation harness chưa kiểm tra live model đầy đủ

Deterministic/policy runners hiện kiểm tra logic giả lập hoặc output fixture, không gọi LLM thật. Vì vậy 20/20 và 6/6 không chứng minh model production luôn tuân thủ schema, safety và citation.

Cần thêm runner gọi cả base model và fine-tuned model với temperature cố định, seed nếu provider hỗ trợ, timeout, retry policy và lưu raw response. Gate phát hành nên đo ít nhất:

- JSON/schema pass rate;
- final invariant pass rate;
- citation precision/coverage;
- unsupported-claim rate;
- safety refusal/triage recall;
- tiếng Việt đúng, rõ và không bịa;
- latency p50/p95, token và chi phí;
- repair rate và failure-after-repair rate.

#### P1 — Evaluator không khớp dataset fine-tune

Evaluator chạy trên 1.771 mẫu cho kết quả structured JSON `0.0`, citation `0.0`, Vietnamese khoảng `0.4065`. Đây không thể dùng để kết luận model tệ: dataset có cả câu trả lời văn bản tự do nhưng evaluator giả định phần lớn output là JSON. Cần gắn `task_type`/`response_contract` cho từng mẫu rồi chấm theo rubric tương ứng.

### 3.3 Lỗi test và môi trường, không nên ghi nhầm là lỗi AI

- Ba integration test gọi hostname `auth-service` từ host nên gặp `ENOTFOUND`; hostname đó chỉ hợp lệ trong Docker network. Khi chạy bên trong Docker, các job sinh plan thật đã chạy.
- Intent/workout/nutrition test hard-code ngày `2026-06-02`. Với ngày kiểm thử 17/08/2026, hệ thống trả `2026-08-18` cho “ngày mai”, là đúng.
- Fixture marketplace tạo plan có một ngày không có exercise; validation mới từ chối publish/republish bằng 422.
- Paid adoption hiện chủ động trả 409 nhưng test vẫn đợi 402.
- Review hiện yêu cầu adoption thật; fixture chỉ tạo completed cycle nên nhận 403.
- Prisma `EPERM` là khóa file Windows do process đang chạy, không phải lỗi schema AI.

Nên sửa test bằng clock injection/fake timer, cấu hình URL riêng `HOST_TEST_BASE_URL` và `CONTAINER_TEST_BASE_URL`, đồng thời cập nhật marketplace fixtures theo contract hiện hành.

## 4. Chức năng nào thực sự cần AI

### 4.1 Nên dùng AI, nhưng theo mô hình hybrid

| Chức năng | Vai trò phù hợp của AI | Phần phải deterministic/human |
|---|---|---|
| Chat hỏi đáp fitness | Hiểu ý định, RAG, diễn giải bằng tiếng Việt, hỏi bổ sung | Source allowlist, citation, safety triage |
| Workout plan | Cá nhân hóa cách diễn giải, gợi ý từ candidate set | Lịch, ID bài, constraints, volume, chống chỉ định |
| Nutrition plan | Gợi ý món/thay thế, giải thích và cá nhân hóa sở thích | Calories, macros, dị ứng, food IDs, giới hạn y tế |
| Cycle assessment | Tóm tắt nguyên nhân và giải thích quyết định | Decision engine quyết định tăng/giảm/deload |
| Session feedback | Tóm tắt xu hướng, câu hỏi follow-up | Pain red flags, ngưỡng tải và escalation |
| PT client-plan draft | Soạn bản nháp và rationale | PT duyệt/sửa trước khi giao khách |
| InBody image extraction | OCR/vision trích xuất trường dữ liệu | Confidence threshold và người dùng xác nhận |
| Marketplace moderation | Prescreen, phát hiện nội dung đáng ngờ, gợi ý cải thiện | Admin quyết định publish/ban |
| Knowledge research | Tóm tắt, phân loại, tạo candidate knowledge | Provenance, source review và approval |

### 4.2 Không cần AI và không nên thêm AI vào luồng quyết định

Các phần sau nên giữ deterministic vì cần tính chính xác, audit, permission và idempotency:

- đăng nhập, phân quyền và account state;
- thanh toán, ví, refund, commission;
- membership, gym check-in;
- booking, availability và xử lý ngày giờ;
- hợp đồng, chữ ký và trạng thái pháp lý;
- CRUD workout/nutrition log;
- tổng hợp số liệu/statistics cơ bản;
- quyền truy cập plan, adoption/version state machine;
- notification delivery và retry;
- lưu/retrieve exercise ID, calories/macros đã được tính.

AI có thể **giải thích hoặc tóm tắt** dữ liệu của các luồng trên, nhưng không được tự thay đổi trạng thái giao dịch.

### 4.3 Chức năng AI có thể bổ sung

| Đề xuất | Ưu tiên | Điều kiện triển khai |
|---|---:|---|
| Semantic exercise search/substitution | Cao | Candidate filter theo muscle/equipment/injury trước, AI rerank sau |
| Weekly adherence coach summary | Trung bình | Dữ liệu đủ, cho người dùng xem assumptions và opt-out |
| Fatigue/overtraining early warning | Trung bình | Rule/threshold cảnh báo trước; AI chỉ giải thích, không chẩn đoán |
| PT copilot so sánh draft với log | Trung bình | Highlight bằng chứng và bắt PT xác nhận |
| Meal-photo extraction | Trung bình/thấp | Người dùng phải xác nhận khẩu phần và món ăn |
| Review summarization/spam triage | Thấp | Không auto-ban dựa riêng vào model |
| Operational log/incident summarization | Trung bình | Read-only, không auto-remediate production ban đầu |

Không đề xuất AI dynamic pricing, tự phê duyệt refund, tự ký hợp đồng hoặc tự đưa ra chẩn đoán y tế.

## 5. AI nên trả lời như thế nào

### 5.1 Contract chung

Mọi phản hồi có ảnh hưởng tới sức khỏe/kế hoạch nên có cấu trúc máy đọc được:

```json
{
  "answer": "Giải thích ngắn gọn bằng tiếng Việt",
  "assumptions": ["Thông tin đang giả định"],
  "missingInformation": ["Câu hỏi cần bổ sung"],
  "deterministicFacts": {},
  "recommendations": [],
  "evidence": [
    { "title": "Nguồn", "url": "https://...", "supports": "Khẳng định nào" }
  ],
  "confidence": "low|medium|high",
  "safetyFlags": [],
  "requiresHumanReview": false
}
```

Quy tắc chung:

- Phân biệt rõ dữ liệu hệ thống tính được với phần AI diễn giải.
- Nêu giả định và hỏi thêm nếu thiếu tuổi, mục tiêu, kinh nghiệm, thiết bị, chấn thương, lịch tập hoặc chế độ ăn.
- Không bịa nguồn; mỗi khẳng định sức khỏe quan trọng phải gắn với evidence thật.
- Không chẩn đoán bệnh. Khi có đau ngực, ngất, khó thở bất thường, đau cấp, triệu chứng thần kinh hoặc dấu hiệu nguy hiểm thì dừng tư vấn tập và khuyến nghị hỗ trợ y tế phù hợp.
- Confidence thấp hoặc schema/constraint fail phải chuyển sang fallback/human review.

### 5.2 Theo từng chức năng

**Workout:** trả mục tiêu, số ngày, từng bài với exercise ID hợp lệ, sets/reps/intensity/rest, lý do ngắn, thiết bị thay thế cùng taxonomy và nguyên tắc progression. Các giá trị phải qua validator trước khi hiển thị.

**Nutrition:** calories/macros do calculator xác định; AI chỉ giải thích và ghép món trong giới hạn. Phải xét dị ứng, tôn giáo/văn hóa, ngân sách và sở thích. Với bệnh lý, mang thai hoặc rối loạn ăn uống, yêu cầu chuyên gia y tế/dinh dưỡng thay vì tự kê chế độ điều trị.

**Cycle/feedback:** trình bày evidence từ log như RPE, completion, đau và xu hướng tải; ghi rõ quyết định nào do engine đưa ra. AI không được tự ghi đè quyết định.

**InBody:** trả từng trường với confidence; trường confidence thấp bắt buộc xác nhận thủ công. Không diễn giải một chỉ số thành chẩn đoán.

**PT draft/marketplace moderation:** luôn có nhãn “AI draft” hoặc “AI prescreen”, lịch sử thay đổi và người chịu trách nhiệm duyệt.

## 6. Đối chiếu nguồn chính thống

Thiết kế prompt, rule engine và golden set nên phản ánh các nguyên tắc sau:

- Hướng dẫn hoạt động thể chất Hoa Kỳ khuyến nghị người lớn đạt 150–300 phút vận động mức vừa hoặc 75–150 phút mức mạnh mỗi tuần và tập các nhóm cơ chính ít nhất 2 ngày; progression cần tăng dần. Nguồn: [HHS Physical Activity Guidelines](https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines) và [bản PDF đầy đủ](https://odphp.health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf).
- WHO cung cấp khuyến nghị theo nhóm tuổi và tình trạng sức khỏe; AI phải hỏi đủ context thay vì áp một plan cho mọi người. Nguồn: [WHO Guidelines on Physical Activity and Sedentary Behaviour](https://www.who.int/publications/i/item/9789240014886).
- ACSM 2026 nhấn mạnh tính nhất quán hơn độ phức tạp, tất cả nhóm cơ chính ít nhất hai lần/tuần, đồng thời mục tiêu strength, hypertrophy và power có prescription khác nhau. Nguồn: [ACSM Resistance Training Guidelines Update 2026](https://acsm.org/resistance-training-guidelines-update-2026/) và [infographic](https://www.acsm.org/wp-content/uploads/2026/03/Resistance-Training-Position-Stand-infographic.pdf).
- ISSN nêu khoảng protein thường dùng cho người tập là khoảng 1,4–2,0 g/kg/ngày, nhưng vẫn phải cá nhân hóa theo bối cảnh và không biến thành chỉ định y tế tự động. Nguồn: [ISSN Position Stand on Protein and Exercise](https://jissn.biomedcentral.com/counter/pdf/10.1186/s12970-017-0177-8.pdf).
- CDC khuyến khích giảm cân từ từ khoảng 1–2 pound/tuần; AI cần tránh hứa hẹn giảm cân quá nhanh. Nguồn: [CDC Steps for Losing Weight](https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html).
- Gợi ý ăn uống nên theo dietary pattern giàu dinh dưỡng và phù hợp văn hóa, sở thích và ngân sách. Nguồn: [Dietary Guidelines for Americans](https://www.dietaryguidelines.gov/).
- WHO yêu cầu AI y tế bảo vệ quyền tự chủ, an toàn, minh bạch, trách nhiệm, công bằng và bền vững; phải có bằng chứng lợi ích trước khi sử dụng rộng rãi. Nguồn: [WHO Ethics and Governance of AI for Health](https://www.who.int/publications/i/item/9789240037403), [six guiding principles](https://www.who.int/news/item/28-06-2021-who-issues-first-global-report-on-ai-in-health-and-six-guiding-principles-for-its-design-and-use) và [regulatory considerations](https://www.who.int/news/item/19-10-2023-who-outlines-considerations-for-regulation-of-artificial-intelligence-for-health).
- Risk management cần diễn ra xuyên suốt vòng đời và có test/evaluation/verification/validation, đặc biệt với GenAI. Nguồn: [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework), [NIST GenAI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) và [NIST AIRC TEVV](https://airc.nist.gov/).

Các con số trên nên là default/range tham khảo cho golden set, không phải prescription cứng cho mọi người dùng.

## 7. Kiến trúc đích đề xuất

```text
User input
   -> Safety + missing-data triage
   -> Deterministic calculators / decision engine
   -> Constraint-filtered candidates
   -> RAG từ nguồn được duyệt
   -> LLM diễn giải hoặc rerank trong phạm vi cho phép
   -> JSON schema validation
   -> Semantic/final invariant validation
   -> Human review khi rủi ro hoặc confidence thấp
   -> Persist + audit + feedback + monitoring
```

Nguyên tắc quan trọng: LLM không được là nguồn sự thật cho ngày tháng, transaction state, exercise ID, calories/macros, permission hay quyết định y tế.

## 8. Kế hoạch hành động

### P0 — trước mọi demo production có người dùng thật

- Chặn trạng thái `completed` khi workout plan không qua final semantic invariants.
- Viết lại exercise repair theo taxonomy/muscle/equipment/injury; fail closed khi không có candidate đúng.
- Thêm regression test cho thiếu ngày, trùng ngày, sai nhóm cơ, sai thiết bị và unsafe substitution.

### P1 — trước khi tuyên bố AI production-ready

- Xây live-model evaluation harness và so sánh base với fine-tuned model.
- Chia dataset/evaluator theo `task_type` và `response_contract`.
- Thêm golden sets cho workout, nutrition, safety, citation, Vietnamese và adversarial prompts.
- Sửa test dùng clock injection; tách URL host/Docker; cập nhật marketplace fixtures.
- Gắn telemetry cho constraint failure, repair, fallback, citation và human override.

### P2 — hardening và vận hành DevOps/MLOps

- Model registry/versioning, prompt versioning, dataset lineage và reproducible evaluation.
- Canary rollout; rollback theo quality/latency/safety thresholds.
- Dashboard p50/p95, error rate, schema pass, repair rate, citation coverage, user feedback.
- Red-team prompt injection, malicious document ingestion, PII leakage và authorization boundary.
- Tách test database và cleanup dữ liệu test tự động.

### P3 — tính năng mới

- Semantic substitution có constraint.
- Weekly adherence summary và PT copilot.
- InBody/meal-photo confidence workflow.
- Moderation/review summarization có human-in-the-loop.

## 9. Tiêu chí phát hành đề xuất

Không release model/prompt mới nếu một trong các điều kiện sau xảy ra:

- final workout/nutrition invariant dưới 100% trên bộ critical golden cases;
- safety recall dưới ngưỡng nhóm dự án phê duyệt;
- citation chứa URL không tồn tại hoặc không hỗ trợ claim;
- có exercise ID ngoài catalog hoặc substitution sai contraindication;
- regression đáng kể so với model đang chạy;
- không thể truy vết model, prompt, retrieval documents và validator version.

Ngưỡng ban đầu gợi ý cho non-critical set: schema pass ≥99%, citation precision ≥95%, retrieval hit@5 ≥95%, và repair rate phải được theo dõi/giảm dần. Các ngưỡng này là release policy nội bộ đề xuất, không phải tiêu chuẩn y tế chính thức.

## 10. Giới hạn của lần kiểm tra

- Không kiểm thử end-to-end InBody vision bằng bộ ảnh chuẩn và provider production.
- Không kiểm thử chất lượng với người dùng/HLV thật; chưa có expert blinded review.
- Một số test đã tạo conversation/plan trên tài khoản test; không sử dụng tài khoản người dùng thật.
- Việc audit tập trung vào chức năng AI; payment provider và các dịch vụ ngoài AI chỉ được phân loại về nhu cầu AI, không được thực hiện giao dịch thật.

## 11. Đánh giá cuối cùng

Hệ thống **đủ tốt để demo kiến trúc AI/RAG/fine-tuning và quy trình serverless/DevOps**, nhưng **chưa đủ an toàn để quảng bá là AI tự động sinh plan production-ready**. Ưu tiên đúng không phải thêm nhiều AI hơn, mà là khóa chặt deterministic constraints, xây live evaluation harness và triển khai human-in-the-loop cho các quyết định có ảnh hưởng tới sức khỏe.
