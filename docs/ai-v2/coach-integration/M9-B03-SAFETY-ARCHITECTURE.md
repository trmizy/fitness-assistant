# M9-B03-SAFETY-ARCHITECTURE — Hợp đồng an toàn cấp cứu dùng chung V1/V2 và cổng kiến trúc (M9.5-T1A)

Ngày 2026-11-16. Baseline: worktree `ai-v2-coach-integration-plan`, HEAD `53ab7545`; candidate `a6b0f3a4` (T1S), candidate trước `3fee5775` (T1), nguồn V1 trong repo `e703b714` (`aws-deploy`). Lượt này **chỉ thiết kế + tạo test RED**: không sửa implementation Safety Guard, Router, Supervisor, bridge, hạ tầng, pin hay benchmark; không gọi model/AWS/DB/Redis.

Nhãn: `CODE FACT` (đọc source ở HEAD, kèm dòng) · `RUN FACT` (đã chạy ở lượt này, kết quả nằm trong test hoặc `t1a-RED-enforced`) · `PROPOSED` (đề xuất, **chưa phải hợp đồng đã duyệt**) · `NOT VERIFIED`. Phân loại vấn đề: **DEFECT** (hợp đồng đã rõ, code vi phạm) · **POLICY GAP** (cần chủ dự án định nghĩa/duyệt) · **KNOWN LIMITATION** (giới hạn đã khai báo/đã biết).
Hai báo cáo review độc lập (Codex) **không có trong workspace**; danh sách phát hiện lấy từ brief, từng mục được kiểm lại bằng source/chạy thật bên dưới.

## 0. Kết luận
- B-03 **không** được đóng: independent review ×2 = `BLOCKED`. Candidate `a6b0f3a4` **không** thể coi là đóng B-03; vá thêm regex từng ca sẽ tiếp tục tạo hồi quy (đã xảy ra: T1S làm mất `I don't wanna live anymore.` mà T1 bắt được).
- Nguyên nhân là **hệ thống**, không phải thiếu từ khoá: (S1) bằng chứng không có mô hình kiểu chặt (chủ thể/thời gian/phủ định/miền) gắn với *từng sự kiện*; (S2) danh sách loại trừ trộn từ chỉ gắng sức với từ chỉ đau khổ và áp dụng cả mệnh đề; (S3) độ phủ bị buộc vào từ ngữ; (S4) phán quyết cấp cứu nằm **sau** các phụ thuộc có I/O (kho idempotency/lịch sử, DB hội thoại, kho hạn chế vị thành niên); (S5) chuẩn hoá khác nhau giữa V1 và V2; (S6) trần cắt âm thầm và độ phức tạp không có hợp đồng; (S7) quyền ưu tiên mã hoá bằng *thứ tự dòng code* của ~15 detector.
- Đề xuất: phương án **B — pipeline bằng chứng rule-based có biên, dùng chung, tách khỏi kho mẫu phản hồi**; C (classifier bổ sung) chỉ là phần mở rộng sau, chỉ được leo thang, không bao giờ hạ cấp.
- Bộ regression độc lập: **20 test, 6 enforced GREEN, 14 RED** (RED được giữ có chủ đích; `B03_ENFORCE=1` biến chúng thành test bắt buộc). Nội dung phản hồi: **chưa được phát hành** (mục 7).

## 1. Hiện trạng đường đi (CODE FACT)
**V1** `POST /ai/ask` (`routes/ai.routes.ts:41-52`): `requireAuth → askRateLimiter → validateBody(≤2000) → bindRequestIdentity → coachBridgeAsk(OFF→next) → aiController.ask → ragService.rag`. Trong `rag` (`services/rag.service.ts`): **DB** `findByClientRequestId` (l.124) → **DB** `findSessionById`/`createSession` (l.150) → `llmOrchestrator.run` (l.159) → [bên trong: `languageGuard`, **`safetyGuard.check`** (orchestrator ~l.492), early-return] → **DB** `conversationRepository.create` (l.181). ⇒ cổng an toàn nằm *giữa* các thao tác DB; DB lỗi trước/sau ⇒ HTTP 500, không có phản hồi cấp cứu.
**V2** (bridge hoặc `/ai/v2/ask`): cùng chuỗi tới `coachBridgeAsk` → `runCoachTurn`: quyết định không I/O → **`history.findSession`** (continuity l.196) → **`idempotency.claim`** (l.207) → executor → **Supervisor**: cờ, danh tính, độ dài, rồi **ghi hạn chế vị thành niên** (supervisor.ts l.481-504, trả `SESSION_UNAVAILABLE` nếu kho lỗi) → **`checkInputSafety`** (l.505) → đọc hồ sơ/phiên/Router… ⇒ cổng an toàn nằm sau kho idempotency/lịch sử và sau kho hạn chế.
`checkInputSafety` (answer-guards.ts l.41-62): V2 gọi `safetyGuard.check(q)` rồi, nếu `safe`, gọi lại trên `foldVi(q)` (cờ `accentFoldedRetry`); V1 gọi **một lần** trên bản gốc. Câu hỏi/tuyên bố cấp cứu được `classifyCoachCapability` xếp `CHAT_READONLY_QA` (đủ điều kiện V2) khi dạng câu hỏi ("Bạn tôi đang co giật, phải làm gì?"); dạng khẳng định ("Tôi muốn tự tử.") xếp V1-only (RUN FACT).
Ngoài phạm vi guard nhưng liên quan độ phủ: các endpoint văn bản tự do `POST /ai/nutrition/day-estimate`, `/ai/agent/image-chat`, `/ai/agent/goal-image` **không** gọi `safetyGuard` (grep: chỉ orchestrator và V2 gọi) — KNOWN LIMITATION cần owner quyết định riêng.

## 2. Task A — Nguyên nhân gốc (đã xác minh)
| # | Phát hiện | Nguyên nhân xác minh (source/chạy) | Loại |
|---|---|---|---|
| 1 | Hồi quy `I don't wanna live anymore.` (T2a) | `EN_NOLIVE` (safety_guard.ts l.526) chỉ có `want to`; T1 có `(?:want to\|wanna)` và `no longer`. T1S viết lại lõi và làm mất biến thể. **RUN:** `safe` ở cả V1/V2 (4/4 biến thể) | DEFECT (hồi quy) |
| 2 | Trần 200 kết quả làm mất tín hiệu cuối (T5b) | `events.slice(0, 200)` (l.568) và `hits.slice(0, 200)` (l.604); các sự kiện gom theo *nhóm pattern* (A,B,C,EN…), không theo vị trí ⇒ tín hiệu ở nhóm sau bị cắt. **RUN:** 5 115 ký tự (300 sự kiện phủ định + 1 sự kiện cuối) ⇒ V1 `safe`; V2 `input_too_long` (fail-closed). Trong giới hạn HTTP 2 000 đơn vị, tối đa ~181 sự kiện nên chưa chạm trần (T5a GREEN) | DEFECT ở mức hàm; KNOWN LIMITATION ở biên HTTP |
| 3 | Bỏ sót overdose, bất tỉnh+giật, trạng thái tinh thần thay đổi (T2d, T2e) | Không có lớp overdose/ngộ độc nào (D-P29(f) chưa được định nghĩa); co giật bị buộc vào từ "co giật/seizure/convulsing" (`SZ_VI`, `SZ_EN`); lõi tiếng Anh về thần kinh/đột quỵ mỏng (VI nhờ `safety-narrative` "méo miệng"). **RUN:** "My friend is unconscious and jerking…", "My dad is suddenly confused and can't speak clearly", 3 câu overdose đều `safe` | overdose = POLICY GAP; "unconscious+jerking" = DEFECT (độ phủ buộc từ); tiếng Anh AMS = KNOWN LIMITATION |
| 4 | Ngoại lệ ngôn ngữ luyện tập che dấu hiệu tự hại (T2b) | `EN_HYPER` (l.529) chứa `tired/hurts/workout/squats…` và được áp **cả mệnh đề** cho "want to die"; `SENSATION_BEFORE` (l.515) chứa `chán/khổ/sợ/ngại` — từ đau khổ, không phải gắng sức — trong cửa sổ 14 ký tự. **RUN:** "I'm so tired of everything and I want to die" và "…chán nản và muốn chết" ⇒ `safe` | DEFECT (loại trừ trộn hai họ từ) + POLICY GAP (ranh giới cường điệu/khủng hoảng) |
| 5 | Ghép tình trạng của hai chủ thể (T3) | `heatIllnessEmergency` (l.619) ghép `confusion` và `heat` trên **toàn tin nhắn** (`clauses.join(" , ")`); `severeSigns` (l.598) gộp dấu hiệu nặng **toàn tin nhắn** nên "Mẹ tôi không nói được" tắt loại trừ co thắt cơ của "Tay *tôi* co giật nhẹ". **RUN:** 3/3 câu hai chủ thể ⇒ emergency (FP) | DEFECT |
| 6 | Sai phạm vi phủ định / giả định / thời gian (T2c) | Thời gian: `const past = v.past.test(t) && !v.recent.test(t)` (l.573) xét **cả mệnh đề**, không gắn với động từ của sự kiện ("Năm ngoái tôi mất việc và tôi muốn tự tử" ⇒ bị coi quá khứ). Giả định: `v.hypo.test(t)` cả mệnh đề (seizure) ⇒ "My brother had a seizure and if it happens again…" bị bỏ. Phủ định: cửa sổ 3 từ (có thể sai hai chiều: phủ định kép, phủ định thuộc mệnh đề phụ). **RUN:** 3 câu ⇒ `safe`/sai khuôn | DEFECT |
| 6b | Khuôn phản hồi sai loại | Cấp cứu phát hiện bằng đường *cũ* (`detectMedicalEmergency`, `safety-narrative`) **không có `emergencyKind`** ⇒ trả mẫu đau ngực ("Dừng tập ngay, ngồi nghỉ"). **RUN:** "Năm ngoái tôi mất việc và tôi muốn tự tử" và "Bạn tôi bất tỉnh và giật liên hồi" ⇒ `medical_emergency` + mẫu đau ngực | DEFECT |
| 7 | Cấp cứu thua quy tắc giảm cân | `check()` (l.860-899): emergency **mới** ở đầu; `detectUnsafeWeightLoss` (l.862) và nhánh vị thành niên đứng **trước** `detectMedicalEmergency` cũ (l.899) ⇒ đau ngực/bất tỉnh + "giảm 10kg trong 1 tuần" ⇒ `unsafe_weight_loss`; "Em 15 tuổi… đau ngực" ⇒ câu của vị thành niên. T1 cố ý giữ thứ tự cũ. **RUN:** 3/3 ⇒ sai | DEFECT (quyền ưu tiên = thứ tự code) |
| 8 | Khác biệt chuẩn hoá V1/V2 | V2 chạy lại trên bản bỏ dấu; V1 chọn **một** view (`hasMarks ? nfc : ascii`, l.633-634). **RUN:** fuzz 282 biến thể (bỏ dấu từng từ, in hoa, NFD) của các câu cấp cứu đã đóng: **42** biến thể V1 `safe` nhưng V2 emergency (vd "Tôi muon tự sát.", "Tôi muốn tu sát.") | DEFECT |
| 9 | Kho hạn chế vị thành niên lỗi trước khi đánh giá cấp cứu | supervisor.ts l.481-504: ghi hạn chế khi `statesMinor` **trước** `checkInputSafety` (l.505), `statementNotPersisted` ⇒ `SESSION_UNAVAILABLE`. **RUN:** "Em 15 tuổi, em muốn tự tử." và "Em 15 tuổi, em đang bị co giật." với kho lỗi ⇒ `SESSION_UNAVAILABLE`, không có phản hồi khẩn cấp (câu không nêu tuổi thì `SAFETY_BLOCKED`) | DEFECT (thứ tự) |
| 9b | Kho/DB khác đứng trước cổng | Bridge: `findSession`/`claim` lỗi ⇒ `boundary STORE_UNAVAILABLE` (RUN: handler `boundary`). V1: `createSession`/`create` lỗi ⇒ **HTTP 500 INTERNAL_ERROR**, không phản hồi cấp cứu (RUN) | DEFECT (thứ tự) |
| 10 | Độ phức tạp khi nhiều span chủ thể | `subjectCandidates` (l.544) so từng cặp `within(x, spans)` (l.540): O(F·(T+G)). **RUN:** chuỗi "bạn tôi tôi …": 20k ký tự 33 ms → 100k ký tự 729 ms (~n^1.9); trong 2 000 ký tự < 2 ms. Bản T1S trước đó có regex tách mệnh đề bậc hai (6 s/100k) — đã sửa | KNOWN LIMITATION ngoài giới hạn HTTP; hợp đồng mới phải có bằng chứng đo |
Bốn điểm cần nhấn mạnh để không quy về "thiếu từ khoá": #4, #5, #6 là lỗi *mô hình hoá* (phạm vi sai); #7, #9, #9b là lỗi *kiến trúc* (thứ tự phụ thuộc); #8 là lỗi *ranh giới* (mỗi điểm vào chuẩn hoá một kiểu); #2/#10 là lỗi *hợp đồng tài nguyên*.

## 3. Task B — Hợp đồng đề xuất (PROPOSED, chưa phải API đã duyệt)
**Một hàm thuần dùng chung** (V1 và V2 cùng gọi), không phụ thuộc model, session, hồ sơ sức khoẻ hay kho nào:
```
assessEmergency(input: { text: string }, boundary: { maxUnits: 2000 }): EmergencyAssessment
```
- **Đầu vào:** văn bản thô sau khi `requireAuth`, rate limit và kiểm độ dài đã chạy (**không** vượt xác thực/giới hạn tốc độ). Danh tính người dùng *không* tham gia nhận diện; chỉ dùng để ghi nhật ký mã.
- **Phân loại rủi ro** (nhãn đề xuất): `IMMEDIATE_EMERGENCY` · `POSSIBLE_HIGH_RISK` · `HISTORICAL_OR_THIRD_PARTY_CONCERN` · `GENERAL_EDUCATION_OR_HYPOTHETICAL` · `NO_EMERGENCY_DETECTED` · `UNABLE_TO_ASSESS`.
- **Bằng chứng có kiểu** (mỗi sự kiện): `{ domain, subject, tense, negated, span(offset trong văn bản thô), clauseIndex, lexiconId }`
  - `domain` (tập do chủ dự án duyệt): tự hại/ý định tự tử, co giật, say nóng/sốc nhiệt, tim–hô hấp, mất ý thức, quá liều/ngộ độc, dấu hiệu thần kinh/đột quỵ…
  - `subject`: `SELF` · `OTHER_NAMED` (bạn tôi, mẹ tôi, he, my friend…) · `GENERIC` ("người muốn tự tử", "someone who") · `UNKNOWN`.
  - `tense`: `PRESENT_OR_RECENT` · `PAST_FINISHED` · `HYPOTHETICAL` · `UNKNOWN`. **Gắn với động từ của sự kiện**, không phải cả mệnh đề (#6).
  - `negated`: chỉ phạm vi của chính mệnh đề/động từ chứa sự kiện; phủ định kép và phủ định thuộc mệnh đề phụ có bài test riêng.
- **Gộp bằng chứng theo chủ thể:** điều kiện của chủ thể A không bao giờ được cộng với dấu hiệu của chủ thể B (#5). `UNKNOWN` không bao giờ được dùng để *hạ* mức.
- **Quyền ưu tiên** (một bảng dữ liệu, không phải thứ tự dòng code — #7): bất kỳ `IMMEDIATE_EMERGENCY` thắng mọi quy tắc phi cấp cứu (giảm cân, vị thành niên, off-topic, injection, dinh dưỡng). Giữa các miền cấp cứu: thứ tự và mẫu phản hồi do bảng chính sách quyết định, mọi miền đều có `responseTemplateId`.
- **Độ bất định:** `AMBIGUOUS_WORDING` (cường điệu có thể là khủng hoảng, giả định ngôi thứ nhất), `INPUT_LIMIT`, `INTERNAL_ERROR`. **Không đồng nhất "không thấy nguy hiểm" với "an toàn":** `NO_EMERGENCY_DETECTED` chỉ nghĩa là luồng thường tiếp tục *qua các guard còn lại*; không phải bảo đảm.
- **Hành vi phản hồi an toàn:** `IMMEDIATE` → mẫu cấp cứu đúng miền; `POSSIBLE_HIGH_RISK` → mẫu thận trọng (không coaching, gợi ý hỗ trợ); `HISTORICAL_OR_THIRD_PARTY` → chủ thể thứ ba *hiện tại* = `IMMEDIATE` (mẫu cho người chăm sóc), quá khứ kết thúc = không cấp cứu nhưng không được mô tả là "an toàn"; `UNABLE_TO_ASSESS` (quá giới hạn, lỗi nội bộ, vượt ngân sách quét) → **fail-closed**: không coaching, trả mẫu chung đã duyệt. Mẫu nào cũng cần duyệt (mục 7).
- **Giới hạn của rule-based:** không hiểu được mọi cách diễn đạt tự nhiên; do đó FN còn lại là **kỳ vọng**, phải được đo và công bố, và là lý do cho tầng C tuỳ chọn (mục 8).
- **Điểm cắm cho B-01/B-02** (không làm ở T1A): bước chuẩn hoá trả về *nhiều view song song* kèm bản đồ offset về văn bản thô (xem mục 4); xử lý ký tự vô hình (B-01) và gập tương thích/full-width/homoglyph (B-02) là hai bước thêm view mới, không đổi detector.

## 4. Task C — Xử lý input có biên (PROPOSED)
Giới hạn HTTP hiện hành: **2 000 đơn vị UTF-16** (`MAX_QUESTION_CHARS`, schema zod V1 `ai.schemas.ts:8`; V2 `PILOT_LIMITS.maxQuestionChars` và `checkInputSafety` fail-closed `input_too_long`).
1. **Kiểm độ dài trên văn bản thô** (đơn vị UTF-16) *trước* mọi xử lý. Vượt ⇒ `UNABLE_TO_ASSESS` (fail-closed), **không bao giờ cắt cụt rồi đánh giá phần đầu** (cắt âm thầm = mất tín hiệu cuối, #2).
2. **Thứ tự chuẩn hoá:** NFC → gộp mọi khoảng trắng (kể cả NBSP, tab, xuống dòng) về một dấu cách *kèm bản đồ offset* → hạ chữ → *(điểm cắm B-01: chính sách ký tự vô hình)* → *(điểm cắm B-02: gập tương thích/full-width)* → tạo view bỏ dấu **song song** (không thay thế view có dấu) → tách mệnh đề. Cùng một hàm chuẩn hoá cho V1 và V2 (khử #8): đánh giá **mọi view** trên **mọi** điểm vào; không còn "V2 thử lại, V1 không".
3. **Xử lý khoảng trắng:** gộp *trước* khi tách mệnh đề và trước khi so khớp cụm nhiều từ (tránh cả lỗi cụm đa từ cố định lẫn regex `\s+…\s+` bậc hai đã gặp ở T1S).
4. **Quét span:** mỗi lexicon biên dịch một lần; mỗi view quét tuyến tính theo pattern; mọi span lưu `(start,end)`; việc gán chủ thể dùng danh sách span **đã sắp xếp** và hai con trỏ/`bisect` (O(S log S)) thay cho so từng cặp.
5. **Ưu tiên tín hiệu:** *mức nghiêm trọng thắng mọi vị trí*; không "n sự kiện đầu". Không có trần kết quả âm thầm: số span bị chặn trên bởi độ dài ≤ 2 000 nên không cần trần; nếu một ngân sách nội bộ vẫn bị vượt (lỗi/đầu vào bệnh lý) ⇒ `UNABLE_TO_ASSESS`, không bỏ qua.
6. **Giới hạn tài nguyên & chống bậc hai:** chi phí mục tiêu O(L·P) với L ≤ 2 000 và P cố định; regex không có lồng lặp không biên và không `\s+` kề nhau. **Không tuyên bố tuyến tính khi chưa đo:** cổng chấp nhận là bài test độ phức tạp `T1A-5c` (tỉ lệ thời gian 4× đầu vào < 9×) cộng đo độ trễ ở 2 000 ký tự trong CI; hiện **đo được ~n^1.9** (RED), nên mọi tuyên bố "tuyến tính" đều chưa được phép.

## 5. Task D — Cấp cứu so với phụ thuộc phiên/kho (PROPOSED; cần owner duyệt phần đụng Supervisor/bridge)
Yêu cầu: không đọc hồ sơ; không phụ thuộc lưu phiên; không vượt xác thực/rate limit; **không tiếp tục coaching nếu kho hạn chế vị thành niên lỗi**; không fallback sang V1 sau phán quyết an toàn; vẫn trả phản hồi khẩn cấp chung khi kho phiên không khả dụng.
Thiết kế: **cổng cấp cứu thuần (`emergency pre-gate`)** đặt ở *điểm đầu tiên không I/O* của mỗi đường vào, **sau** `requireAuth`, `askRateLimiter`, `validateBody`, `bindRequestIdentity`:
- V1 `/ask` và `/ask/stream`: trước `coachBridgeAsk`/`aiController` (⇒ trước `ragService.rag`, tức trước mọi DB). V2 `/ai/v2/ask`: sau `requireVerifiedEndUser`, `askRateLimiter` và body chặt, trước handler của route V2. **Một** nơi, **một** mẫu, V1 và V2 không thể lệch nhau; không có chuyển giao V1↔V2 sau phán quyết (khớp D-009).
- Phán quyết `IMMEDIATE` ⇒ trả phản hồi cấp cứu (HTTP 200, hình dạng payload hiện có, đánh dấu engine/nguồn `safety-gate`), **không** chạy bridge/idempotency/lịch sử/Supervisor/model. Ghi lịch sử là best-effort *sau* khi đã trả (nếu DB lỗi vẫn trả cấp cứu).
- **Vị thành niên + cấp cứu (Supervisor):** thứ tự đổi thành *cấp cứu trước, ghi hạn chế sau*: Supervisor tính phán quyết cấp cứu **trước** khối ghi hạn chế (l.479-504); nếu cấp cứu, vẫn ghi hạn chế theo cơ chế quarantine (best-effort, không chặn phản hồi) rồi trả `SAFETY_BLOCKED` kèm mẫu cấp cứu; nếu ghi thất bại, hạn chế nằm trong registry quarantine ⇒ **các lượt coaching sau vẫn bị từ chối** (hành vi fail-closed hiện có giữ nguyên; test `T1A-7a` enforced). Đây là **thay đổi Supervisor ⇒ cần owner duyệt** (không làm ở T1A).
- **Giới hạn tốc độ:** pre-gate chạy *sau* rate limiter nên không vượt qua nó. Nếu *backend* của limiter lỗi (DynamoDB provider fail-closed — script quota ghi "limiter fails closed and blocks every paid AI call"), cấp cứu bị chặn; có cho phép trả mẫu cấp cứu khi backend limiter lỗi hay không là **quyết định cho owner** (đánh đổi lạm dụng vs người dùng khủng hoảng).
- Bridge: phát hiện cấp cứu trước `findSession`/`claim` (hoặc để pre-gate trả lời trước khi tới bridge — khuyến nghị).
- Dữ liệu nhạy cảm: nội dung khủng hoảng hiện đi qua `persistDeterministicMemoryCandidates` và lưu lịch sử hội thoại như câu thường (CODE FACT, orchestrator trước early-return); chính sách lưu giữ/ẩn cho loại nội dung này cần owner quyết.
**Quyết định cần owner (chưa ghi vào DECISIONS.md, theo brief):** vị trí pre-gate và hợp đồng phản hồi (có lưu lịch sử?); sửa thứ tự Supervisor; hành vi khi backend rate limit lỗi; mẫu `UNABLE_TO_ASSESS`; lưu giữ nội dung khủng hoảng; tập miền/ lớp (overdose, đột quỵ, AMS…); phạm vi endpoint văn bản tự do ngoài `/ask`.

## 6. Task E — Bộ regression độc lập (đã tạo, chạy trên candidate chưa sửa)
File: `backend/services/ai-service/src/__tests__/safety-emergency-b03-independent.test.ts` (file mới; **không sửa** các test đã đóng băng). Đánh giá *phân loại rủi ro và định tuyến* (emergency vs không; lớp khuôn; ai trả lời; cái gì đã chạy), **không** so khớp nguyên văn phản hồi. Mặc định các test RED đăng ký `todo` để repo vẫn chạy được; **`B03_ENFORCE=1`** biến chúng thành test thật (đã chạy: 14 fail).
| Test | Nội dung | Trạng thái trên `a6b0f3a4` |
|---|---|---|
| T1A-1 | các ca T1/T1S đã đóng còn đúng | GREEN (enforced) |
| T1A-2a | `wanna` / `no longer` — hồi quy | **RED** |
| T1A-2b | từ đau khổ/luyện tập che tự hại | **RED** |
| T1A-2c | phạm vi thời gian/giả định sai | **RED** |
| T1A-2d | bất tỉnh+giật, AMS (tiếng Anh), khuôn không phải đau ngực | **RED** |
| T1A-2e | overdose/ngộ độc (POLICY — kỳ vọng là lớp đề xuất) | **RED** |
| T1A-2f | mọi cấp cứu có `emergencyKind`, không dùng khuôn đau ngực sai | **RED** |
| T1A-3 | ghép tình trạng hai chủ thể (FP) | **RED** |
| T1A-4 | cấp cứu thắng giảm cân/vị thành niên | **RED** |
| T1A-5a | dò tín hiệu cuối trong giới hạn 2 000 | GREEN (enforced) |
| T1A-5b | quá giới hạn không bao giờ `safe`, không mất span cuối | **RED** |
| T1A-5c | tỉ lệ thời gian khi tăng đầu vào (độ phức tạp) | **RED** (đo ~n^1.9) |
| T1A-6 | nhất quán V1/V2 khi bỏ dấu một phần | **RED** (42/282 biến thể lệch) |
| T1A-7a | kho hạn chế lỗi: cấp cứu không tuổi vẫn chặn; coaching vị thành niên vẫn fail-closed | GREEN (enforced) |
| T1A-7b | kho hạn chế lỗi + tuổi + cấp cứu ⇒ phản hồi khẩn cấp | **RED** |
| T1A-7c | bridge: kho idempotency lỗi không che cấp cứu | **RED** |
| T1A-7d | V1: DB hội thoại lỗi không che cấp cứu | **RED** (HTTP 500) |
| T1A-7e | V1: dịch vụ hồ sơ lỗi: vẫn cấp cứu, 0 model, 0 lần đọc | GREEN (enforced) |
| T1A-8 | đối chứng fitness/giáo dục lành tính | GREEN (enforced) |
| T1A-9 | hàm thuần, xác định | GREEN (enforced) |
Phân loại kỳ vọng: **[DEFECT]** — hợp đồng đã rõ, test ghi đúng kỳ vọng; **[POLICY]** (T1A-2b dòng cuối, T1A-2e) — kỳ vọng là phương án *đề xuất*, đóng sau khi chủ dự án duyệt lớp; **[LIMIT]** (T1A-2d dòng AMS, T1A-5c) — giới hạn mà hợp đồng mới loại bỏ. Lượt triển khai sau **hoàn thành khi file này pass với `B03_ENFORCE=1` nguyên văn**; không được nới kỳ vọng.

## 7. Task F — Cổng nội dung lâm sàng (tách mẫu khỏi chính sách phát hiện)
Thiết kế: kho **mẫu phản hồi** (`responseTemplateId` → nội dung vi/en + trạng thái duyệt + người duyệt + ngày) tách hẳn khỏi bảng chính sách phát hiện; detector chỉ trả `templateId`. Mẫu có trạng thái `NOT_APPROVED` **không được phát hành** (build/test fail nếu một route production tham chiếu mẫu chưa duyệt).
**Không được phát hành cho tới khi có phê duyệt chuyên môn do con người ký:**
1. Mẫu sốc nhiệt: dòng "cho uống nước từng ngụm **nếu còn tỉnh**" mâu thuẫn với điều kiện kích hoạt là *lú lẫn* (nguy cơ sặc) — chỉ được dùng nếu bảo đảm tỉnh táo và khả năng nuốt an toàn; tiêu đề "Dấu hiệu say nóng/sốc nhiệt" nghiêng về chẩn đoán.
2. Chỉ dẫn sơ cứu co giật (không giữ chặt, không nhét vật vào miệng, nằm nghiêng, ngưỡng 5 phút, ghi giờ) — chưa duyệt.
3. Phản hồi tự hại (ngôi thứ nhất) và **người thứ ba** — chưa duyệt; chưa có đường dây hỗ trợ sức khoẻ tâm thần địa phương.
4. Số khẩn cấp **115**: chỉ có sẵn trong repo, chưa xác minh cho địa bàn áp dụng; người dùng ngoài Việt Nam cần cách diễn đạt trung tính theo locale.
Tài liệu **để rà soát** (tham chiếu, *chưa đối chiếu nội dung trong lượt này, không tuyên bố clinical approval*): CDC/NIOSH về bệnh do nhiệt và sơ cứu say nóng; CDC về sơ cứu cơn động kinh (Epilepsy); NIMH về phòng ngừa tự tử/ngôn ngữ an toàn khi trao đổi. Người duyệt phải là người có chuyên môn phù hợp; code review không thay thế rà soát y khoa.

## 8. Task G — Lựa chọn kiến trúc
| Tiêu chí | A. Mở rộng detector hiện tại | B. Pipeline bằng chứng rule-based có biên, dùng chung | C. Hybrid (B + classifier bổ sung, fail-safe) |
|---|---|---|---|
| Độ phủ an toàn | Tăng theo từng ca; phụ thuộc từ ngữ, đã chứng minh hồi quy (T1→T1S) | Cao hơn nhờ mô hình kiểu (chủ thể/thời gian/miền) + bảng chính sách; FN diễn đạt tự do vẫn còn | Cao nhất cho diễn đạt tự nhiên (nếu classifier tốt) |
| False positive | Khó kiểm soát; ngoại lệ trộn | Kiểm soát được theo miền/chủ thể; đo được | Có thể tăng/giảm; khó giải thích |
| Tính xác định | Có | **Có** | Một phần (classifier không xác định) |
| Độ trễ | ~ms | ~ms (mục tiêu < vài ms ở 2 000 ký tự, phải đo) | + độ trễ model (vài trăm ms–giây) |
| Chi phí | 0 | 0 | Chi phí model/lượt; D-006 chỉ Nova Pro, cần duyệt |
| Kiểu lỗi | Im lặng bỏ sót, hồi quy | Có `UNABLE_TO_ASSESS` fail-closed, test bằng bảng | Model lỗi/timeout ⇒ cần chính sách (phải chỉ leo thang) |
| Khả năng kiểm thử | Từng câu | **Theo thuộc tính + bảng + RED suite** | Khó (cần bộ đánh giá + giám khảo) |
| Tương thích V1 | Có nhưng giữ nợ | Có: hàm thuần, hợp đồng payload không đổi | Cần model trong luồng V1 (đường dependency mới) |
| AWS Lambda | Tốt | **Tốt** (CPU thuần, không mạng, không cold-start thêm) | Cần Bedrock/NAT/IAM (B-16 chưa kiểm) |
**Chọn: B**, vì: bảo đảm sàn xác định, không phụ thuộc hạ tầng chưa kiểm chứng, loại được cả nhóm lỗi *mô hình hoá* (#4–#6), *thứ tự* (#7, #9) và *ranh giới* (#8) bằng cấu trúc thay vì thêm ca, và cho phép đóng B-03 bằng bằng chứng đo được. **C** chỉ nên xem xét sau B, như *bổ sung* chạy sau sàn rule-based: classifier chỉ được **nâng** mức (POSSIBLE→IMMEDIATE), **không bao giờ hạ** phán quyết của B; lỗi/timeout ⇒ giữ phán quyết B; cần duyệt model/ngân sách/PII và đánh giá riêng. **A** bị loại: đã thất bại hai lần review và tạo hồi quy.

## 9. Phạm vi triển khai nhỏ nhất cho lượt sau (đề xuất; chưa mở)
1. **Mô-đun mới** `backend/services/ai-service/src/llm/emergency/` (hàm thuần): `types.ts` (kiểu hợp đồng), `normalize.ts` (views + offset, điểm cắm B-01/B-02), `lexicon.ts` (dữ liệu có phiên bản), `assess.ts` (clause → evidence → subject/tense/negation theo sự kiện → gộp theo chủ thể → ưu tiên theo bảng), `policy.ts` (bảng ưu tiên miền→template), `templates.ts` (kho mẫu; trạng thái duyệt). Không đụng Router/Agent.
2. `llm/safety_guard.ts`: `check()` gọi `assessEmergency` **trước mọi detector cũ** và trả kết quả theo bảng; xoá đoạn B-03 hiện tại; V2 `checkInputSafety` gọi cùng hàm (một lần, mọi view).
3. **Thay đổi thứ tự (cần owner duyệt từng mục):** (a) pre-gate middleware ở `routes/ai.routes.ts` (và route V2) sau auth/rate limit/validate; (b) Supervisor: cấp cứu trước khối ghi hạn chế; (c) bridge: không để kho idempotency/lịch sử đứng trước cấp cứu (hoặc nhờ pre-gate).
4. Test: chạy `safety-emergency-b03-independent.test.ts` với `B03_ENFORCE=1` (phải xanh nguyên văn), cộng test thuộc tính của `assess` (không cắt âm thầm; bất biến theo khoảng trắng; đơn điệu: thêm bằng bằng chứng cấp cứu không thể hạ mức), benchmark độ phức tạp, differential cũ–mới (Unsafe→Safe = 0 trên corpus độc lập), toàn bộ suite `llm`, `agent-v2-*`, coach/bridge; V1/V2 nhất quán trên cùng corpus.
5. Ảnh hưởng pin: thêm file V1-side mới (`llm/emergency/*`) và có thể sửa `routes/ai.routes.ts` (đã trong delta) ⇒ chỉ làm tăng danh sách lệch RI-2/HR-27, **không** tự rebaseline.
6. **STOP nếu:** cần sửa Router; owner chưa duyệt thay đổi Supervisor/vị trí pre-gate (khi đó chỉ làm bước 1–2 + test, và giữ T1A-7b/7c/7d RED được ghi nhận); xuất hiện Unsafe→Safe; mẫu phản hồi chưa duyệt bị tham chiếu bởi đường production.
Không nằm trong phạm vi: B-01/B-02 (chỉ chừa điểm cắm), classifier/model, bất kỳ hotfix V1 (D-P30), mở rộng sang 15 P1 khác.
