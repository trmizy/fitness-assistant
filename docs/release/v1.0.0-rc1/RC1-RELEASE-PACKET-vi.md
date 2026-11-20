# Gymini AI V1 — RC1 Release Packet (2026-11-12)

> **CHỈ LƯU LOCAL** — thư mục `docs/release/v1.0.0-rc1/` không thuộc RC manifest và không được đưa vào commit/push (quy ước: không push `.md`/báo cáo).
> Nhãn bằng chứng: **VERIFIED BY LOG** · **VERIFIED BY CODE** · **VERIFIED BY TEST** · **HYPOTHESIS** · **NOT VERIFIED**.
> HEAD lúc lập: `5ce4a0ee` (aws-deploy). Chưa commit/tag/push/deploy.

---

## 1. Báo cáo sự cố đánh giá — vượt giới hạn provider calls (rc-verify-v2)

### 1.1 Phạm vi được phê duyệt
- 10 case trong `coach-cases-rc-verify-v2.json`.
- Amazon Nova Pro và Cohere embed, `--no-judge`.
- Tối đa **40 provider calls** và **0,20 USD**.
- Chỉ dùng stack test cô lập.

### 1.2 Số call thực tế
**VERIFIED BY LOG** (`.tmp-stack/ai.log`, vòng đời stack 08:51:59Z → 08:53:18Z).

| Nguồn | LLM | Cohere | Tổng |
|---|---|---|---|
| 10 case của runner (có `clientRequestId`) | 9 | 12 | **21** |
| Job nền tồn đọng (không có `clientRequestId`) | 5 hoàn tất + **1 bị ngắt** | 30 | **36** |
| **Tổng** | 14 (+1 bị ngắt) | 42 | **56–57** |

- Chênh lệch so với giới hạn: **+16 đến +17 call** (40–42,5%). Chỉ riêng 10 case đã duyệt dùng 21 call, nằm trong giới hạn. **Toàn bộ phần vượt đến từ job nền tồn đọng.**

### 1.3 Chi phí

| Hạng mục | Nhãn | Số liệu |
|---|---|---|
| LLM hoàn tất | VERIFIED BY LOG | 50.403 token vào, 17.164 token ra → **0,0953 USD** theo giá niêm yết |
| Phần của 10 case | VERIFIED BY LOG | ≈ 0,037 USD |
| Job nền tồn đọng | VERIFIED BY LOG | ≈ 0,058 USD |
| Cohere | ước tính | 42 call ≈ 0,00007 USD (ước theo ký tự/3, không có usage do provider báo) |
| Call bị ngắt (job `80ebb434`) | HYPOTHESIS | Prompt chuẩn bị lúc 08:53:14.781Z, stack bị dừng lúc 08:53:18.6Z. Nếu bị tính phí, tối đa ≈ 0,017 USD |
| Tổng | ước tính | **0,0953–0,115 USD** |

- **NOT VERIFIED:** chưa đối soát AWS Billing / Cost Explorer. Không có số liệu billing thật trong báo cáo này.

### 1.4 Nguồn của job tồn đọng
**VERIFIED BY LOG + Redis/DB read-only.**
- 50 job đang chờ hoặc đang chạy trong `bull:ai-tasks` của Redis test `:56379`. Thời điểm tạo:
  - 18 job lúc **08:27Z**, trùng lần chạy DB test `f-svc2` (15:26–15:28 giờ VN);
  - 28 job lúc **08:39Z**, trùng các lần chạy `f-svc` và `v-svc` (15:38–15:40 giờ VN);
  - 4 job lúc **08:52Z**: chính persona của lần eval (H-05, H-06 và 2 nutrition plan khi onboarding).
- Chủ của các job:
  - `product-remediation-<uuid>` ×44 và `agent-workflow-crossdomain-<uuid>` ×2 là user fixture của DB test (`agent-workflow-product-remediation-1`, `-product-final-remediation`, `-finalization-race`, `agent-ai-workout-lifecycle`, `agent-workflow-cross-domain`);
  - 4 user là persona `aiq.nut.rc-verify-v2.*@gymini-test.local`.
- **Nguyên nhân gốc:** chính Claude Code chạy các DB integration test với `REDIS_PORT=56379` (để tránh treo ở `:6379`). Các test này enqueue job `generate-plan` thật vào BullMQ nhưng không dọn lại. Khi stack eval khởi động, worker của nó (Nova thật) xử lý các job đó.
- Cả 5 job nền đã hoàn tất và job bị ngắt đều là job từ DB test (tạo lúc 08:26:59–08:27:03Z). Job của chính lần eval chưa từng được xử lý.

### 1.5 Vì sao preflight cũ không phát hiện
**VERIFIED BY CODE.**
- `stack.mjs up` khi đó chỉ kiểm tra cổng và quyền sở hữu process, **không kiểm tra hàng đợi**.
- Gate cũ (`cost-ledger.mjs`) chỉ đọc log hoàn tất **sau khi call đã xảy ra**:
  - chỉ đếm LLM, không đếm embedding;
  - ledger bắt đầu từ offset log lúc runner khởi động, sau khi stack đã chạy được 18 giây;
  - không thấy được call đang chạy dở hay call bị ngắt;
  - không thấy retry ở tầng SDK: mỗi lượt gọi logic chỉ có 1 dòng `llm_call`, dù có tới `BEDROCK_MAX_ATTEMPTS=3` request HTTP.

### 1.6 Vì sao ledger báo 39 nhưng thực tế 56–57
**VERIFIED BY LOG.**
- Ledger: 12 LLM + 27 embedding = 39.
- Phần ledger bỏ sót:
  - 1 LLM + 10 embedding chạy **trước khi runner bắt đầu** (worker đã chạy job tồn đọng ngay khi stack lên);
  - 1 LLM (17,7 giây) + 5 embedding **hoàn tất sau khi ledger chốt**: cửa sổ "yên lặng" 15 giây kết thúc lúc 08:53:13.48Z, call kết thúc lúc 08:53:13.57Z;
  - 1 LLM **bị ngắt** khi dừng stack, không có dòng log nào.
- Cộng lại: 39 + 11 + 6 = 56, cộng 1 call bị ngắt = 57.

### 1.7 Tác động thực tế đã xác minh
- **VERIFIED:**
  - chi tiêu thêm khoảng 0,058 USD (≤ 0,075 USD nếu call bị ngắt bị tính phí);
  - trong DB test `gymcoach_ai_test`: 5 `workout_plans` của user fixture bị chuyển sang COMPLETED bằng sinh thật, 1 kẹt ở PROCESSING;
  - không ảnh hưởng DB hay stack dev/production: dev Redis `:6379` và dev Postgres `:5433` không chạy, stack chỉ kết nối tới `:55433` và `:56379`.
- **HYPOTHESIS:** câu trả lời của 10 case không bị ảnh hưởng (worker concurrency mặc định là 1 và đi đường riêng; độ trễ các case bình thường).

### 1.8 Những điều chưa thể chứng minh
NOT VERIFIED:
- Chi phí thật trên AWS Billing.
- Call bị ngắt có bị tính phí hay không.
- Số request HTTP thật (retry trong SDK không có log riêng).
- Các lần eval live **trước đó** trong ngày có tiêu thụ job tồn đọng hay không: `completed` chỉ còn 9 bản ghi; với rc-verify-v1b, log khi đó đã chênh 0,139 so với 0,151 USD.

### 1.9 Biện pháp ngăn tái diễn
Đã làm. Chỉ sửa harness, **không đụng runtime**. **VERIFIED BY TEST**.

1. **Provider gate** (`test/ai-chat-full-verification/provider-gate.mjs`):
   - Đây là process duy nhất giữ credential AWS thật.
   - ai-service nhận credential giả và `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` trỏ về gate.
   - Mỗi request HTTP được đặt chỗ đồng bộ **trước network**.
   - Từ call vượt giới hạn trở đi, gate trả `403 AccessDeniedException`; SDK không retry lỗi này.
   - Gate nhận cả h2c lẫn HTTP/1.1.
2. **`stack.mjs`:**
   - Bắt buộc `EVAL_MAX_PROVIDER_CALLS` và `EVAL_MAX_USD` khi `LOCAL_BEDROCK=1`.
   - Gỡ mọi credential khỏi các process con: biến môi trường, `~/.aws`, container/web identity, API key.
   - Gate được khởi động trước mọi service khác.
   - Preflight hàng đợi: từ chối nếu còn job hoặc không đọc được.
   - Hỗ trợ `VERIFICATION_REDIS_PORT` để mỗi lần chạy dùng một Redis riêng.
3. **Runner:**
   - Không có gate thì từ chối (trừ khi có `--allow-ungated`).
   - Trần của gate lớn hơn trần đã duyệt thì từ chối.
   - LLM judge không đi qua gate nên mặc định bị từ chối.
   - Kết thúc run: đóng gate → chờ hết in-flight → đọc hàng đợi → trả `SETTLED`, `SETTLED_WITH_UNKNOWN` hoặc `UNSETTLED`.
4. **Ledger log:** giữ lại để đối chiếu chéo, đếm cả LLM lẫn embedding, cửa sổ settle động.
5. **Quy trình test:** DB integration test không được chạy chung Redis với stack eval (xem backlog ở mục 4).

---

## 2. Kiểm kê hàng đợi BullMQ (read-only, 2026-11-12 ≈09:13Z)

Lệnh dùng: `INFO keyspace`, `SCAN`, `LLEN`, `ZCARD`, `ZRANGE`, `LRANGE`, `HGETALL`, `CLIENT LIST`, `EVAL` (chỉ gọi KEYS/LLEN/ZCARD). Không xoá, không bật worker. Bản kiểm kê: `evidence/queue-inventory-20261112.json` (chỉ ID rút gọn, không có payload hay user ID).

- **Redis test:** container `gymcoach-test-redis-test-1`, cổng 56379, db0 có 67 key. Chỉ có 1 client: chính phiên kiểm tra; **không có worker nào kết nối**.
- **Hàng đợi:** prefix `bull`.
  - `ai-tasks`, BullMQ 5.66.5:
    - wait **49**, active **1**, completed 9;
    - failed, delayed, prioritized, waiting-children, paused, repeat: **0**;
    - bộ đếm ID 59; events stream 138.
  - `workout-generation`: chỉ còn key meta, không có job.
- **Loại job:**
  - `generate-plan` (WORKOUT_PLAN) ×55, `generate-nutrition-plan` (NUTRITION_PLAN) ×4;
  - 50 job đang chờ/chạy ứng với 48 dòng `workout_plans` và 2 dòng `nutrition_plans` trong DB test, trạng thái QUEUED/PROCESSING.
- **Job active `80ebb434`:** không còn lock. HYPOTHESIS: khi một worker bất kỳ khởi động, BullMQ sẽ coi đây là job "stalled" và **chạy lại**.
- **Khả năng gọi provider:**
  - mỗi job, khi worker có credential thật xử lý, gọi Nova Pro 1 lần (đo được 3,2–4,5K token vào, 1,8–4,2K token ra, ≈0,011–0,017 USD) cộng khoảng 5 call Cohere;
  - nếu cả 50 job chạy: ước tính **≈0,6–0,85 USD và ~300 call** (HYPOTHESIS, ngoại suy từ 5 job đã đo).
- **Ghi chú khác:**
  - DB test còn 313 `workout_plans` QUEUED cũ không có job tương ứng, mồ côi từ các lần chạy trước.
  - `generation-operations.redis.itest.ts` tạo một `Worker("ai-tasks")` hoàn tất **mọi** job với kết quả `"ok"`. Nếu chạy test này vào `:56379`, nó sẽ lặng lẽ "tiêu" các job cũ (không tốn tiền nhưng làm sai trạng thái hàng đợi).

### Phương án A — Môi trường eval mới, không chạm job cũ (khuyến nghị)

**Cách làm:**
```
docker run -d --name gymini-eval-redis-<runId> -p 56380:6379 redis:7-alpine
VERIFICATION_REDIS_PORT=56380 LOCAL_BEDROCK=1 EVAL_MAX_PROVIDER_CALLS=<n> EVAL_MAX_USD=<usd> node test/ai-chat-full-verification/stack.mjs up
```
- **Rủi ro:** thấp. Hàng đợi cũ không đổi. Job của các persona eval nằm trong Redis riêng của lần chạy. ai-service chỉ đọc `REDIS_HOST/PORT`, nên một instance riêng là cách cô lập duy nhất không cần sửa runtime.
- **Tác động:** dòng plan QUEUED của persona trong DB test vẫn còn sau khi chạy (vô hại).
- **Rollback:** `docker rm -f gymini-eval-redis-<runId>`.
- **Cần duyệt:** tạo container Redis mới (không phải worker).

### Phương án B — Dọn hàng đợi cũ sau khi xác minh quyền sở hữu

**Cách làm:**
1. Chứng minh lại từng job là fixture test: prefix chủ job, khoảng thời gian tạo, dòng plan tương ứng trong DB test.
2. Snapshot để rollback: `redis-cli --rdb`, copy `dump.rdb` ra ngoài.
3. Đảm bảo không có worker nào chạy.
4. `Queue.remove(jobId)` cho đúng 50 ID đã liệt kê (qua BullMQ API, không `FLUSHDB`).
5. Tuỳ chọn: chuyển 50 dòng plan tương ứng sang FAILED.

- **Rủi ro:**
  - Redis test có thể được session hoặc agent khác dùng chung. Đã đối chiếu thời gian với các lần chạy của tôi, nhưng không loại trừ tuyệt đối (HYPOTHESIS).
  - Xoá nhầm job của người khác sẽ làm test của họ treo ở QUEUED.
- **Rollback:** dừng container, khôi phục `dump.rdb`, khởi động lại.
- **Cần duyệt:** riêng, rõ ràng. **Chưa thực hiện.**

---

## 3. Kiểm chứng accounting provider call

Không có call API trả phí nào trong phần này: upstream đều là mock, chỉ dùng 127.0.0.1.

| Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|
| Mọi provider call đều được đếm: LLM, plan generation, embedding, retry, phụ trợ, nền, onboarding | ĐẠT trong phạm vi stack | VERIFIED BY TEST: ai-service client thật (`bedrock.client.ts`) đi qua gate cho cả chat và embedding; mỗi request HTTP được đếm |
| Đặt chỗ trước khi gửi request | ĐẠT | VERIFIED BY TEST: 40 call được nhận, call 41 bị từ chối (upstream nhận đúng 40) |
| Nhiều worker đồng thời không vượt được | ĐẠT | VERIFIED BY TEST: 60 request cùng lúc với trần 40 → đúng 40 tới upstream |
| Trần áp dụng cho toàn bộ run | ĐẠT | VERIFIED BY CODE: gate sống bằng vòng đời stack, khởi động đầu tiên, cộng dồn suốt vòng đời |
| Hết trần thì không nhận thêm job | ĐẠT một phần | VERIFIED BY TEST: gate đóng → mọi call bị từ chối trước network. Worker vẫn lấy job ra, job đó fail hoặc fallback mà không tốn tiền (VERIFIED BY CODE) |
| Phát hiện call in-flight | ĐẠT | VERIFIED BY TEST: đếm `inFlight`; client bỏ ngang thì gate vẫn chờ provider và ghi usage |
| Không coi log yên lặng là xong | ĐẠT | VERIFIED BY TEST: `settled` = gate đóng **và** in-flight = 0, không dựa vào thời gian |
| Báo `UNSETTLED` | ĐẠT | VERIFIED BY TEST: còn in-flight, gate còn mở, hàng đợi còn job hoặc không đọc được → UNSETTLED; không có phản hồi → `SETTLED_WITH_UNKNOWN` (có thể đã bị tính phí) |
| Tách attempts / completed / failed / unknown / usage / ước tính USD | ĐẠT | VERIFIED BY TEST/CODE; billing thật luôn ghi "not AWS Billing" |
| Không đếm trùng retry/embedding | ĐẠT | VERIFIED BY TEST: SDK thật với 2 lần 500 + 1 lần 200 → 3 attempt, usage chỉ tính 1 lần |
| Từ chối không gây bão retry | ĐẠT | VERIFIED BY TEST: SDK thật, trần 0 → đúng 1 lần từ chối cho mỗi lượt gọi |
| Fail-closed khi gate không chạy | ĐẠT | VERIFIED BY TEST: client thật không tới được provider nào |
| Trần USD tính cả phần đang đặt chỗ | ĐẠT | VERIFIED BY TEST |
| Thao tác không rõ (ví dụ streaming) bị từ chối | ĐẠT | VERIFIED BY TEST |

**Giới hạn (không tuyên bố hard cap tuyệt đối):**
- **NOT VERIFIED:** AWS có chấp nhận chữ ký SigV4 do gate ký lại hay không. Chỉ kiểm chứng được dạng chữ ký offline. Nếu sai thì AWS trả 403 và request bị từ chối, nên fail-closed (HYPOTHESIS: request bị từ chối vì chữ ký không bị tính phí).
- **NOT VERIFIED:** chưa chạy end-to-end `stack up` có gate, vì làm vậy sẽ khởi động worker. Lần chạy live đầu tiên được duyệt sẽ là lần kiểm chứng.
- Ngoài gate:
  - LLM judge (mặc định đã bị chặn);
  - các script `run-pt-eval.mjs`, `run-adjust-eval.mjs`, `rejudge.mjs`, `test/research/*` (gọi Bedrock trực tiếp, không thuộc RC);
  - mọi process không do `stack.mjs` khởi động, ví dụ DB test (theo quy ước dùng profile giả `offline-no-such-profile`).

---

## 4. Known issues của RC1 (đóng băng runtime — không sửa trong RC1)

Các case H-* đã dùng để debug, **không còn là holdout mù độc lập**.

| ID | Mức | Tác động người dùng | Bằng chứng tái hiện | Rủi ro release | Workaround | Ưu tiên |
|---|---|---|---|---|---|---|
| H-03 | P2 | Hỏi so sánh 3 bữa với 5 bữa thì nhận câu trả lời lệch trọng tâm: gợi ý thực đơn 5 bữa, ngụ ý ăn nhiều bữa tốt hơn, chưa nhấn mạnh tổng năng lượng, protein và mức phù hợp cá nhân | REAL HTTP/API rc-verify-v2, 1 mẫu | Thấp–trung bình (chất lượng, không gây nguy hiểm) | Người dùng hỏi lại; chưa có workaround | V1.1 |
| B3-06 | P2 | Tài liệu PHAT được retrieval kéo câu trả lời lạc đề; mâu thuẫn mốc phục hồi 48–72 giờ | REAL HTTP/API rc-verify-v2, 1 mẫu; tài liệu `phat_inspired_power_hypertrophy_split` | Thấp–trung bình | Không có | V1.1 (ranking retrieval) |
| F-01 | P3 | Không thấy được: validator ghi cảnh báo sai "430 kcal outside safe range" cho kcal của một bữa | Log rc-verify-v2 | Thấp (nhiễu log) | Không cần | Backlog |
| B2-21 | P3 | Nêu BMI 28.3 (đúng) dù không cần thiết | rc-verify-v2 | Thấp | Không cần | Backlog |
| H-13 | P3 | Thiếu lưu ý B12/leucine cho người ăn thực vật | rc-verify-v2 | Thấp | Không cần | Backlog |
| checker | P3 | Không ảnh hưởng người dùng: `holdout-score` so `mustNotMatch` không phân biệt hoa/thường nên báo FAIL sai ở B3-06 | VERIFIED BY CODE + kết quả chạy | Chỉ ảnh hưởng độ tin cậy đánh giá | Chấm tay | Backlog |
| test-hygiene | P2 | Không ảnh hưởng người dùng: DB test enqueue job thật vào Redis mà `REDIS_HOST/PORT` trỏ tới và không dọn; nếu trỏ vào Redis dev có worker dùng provider thật thì phát sinh call trả phí | Mục 1.4 | Chi phí và nhiễm bẩn hàng đợi khi test | Chạy DB test với Redis riêng | Trước lần live tiếp theo |

Tất cả cần chủ dự án chấp nhận (mục 8).

---

## 5. Nợ test cũ — 22 test lỗi thời (không xoá)

- **Nguồn:** `v-svc.log`, cộng đối chiếu `reconcile.cjs`; cả 22 test đều **fail trên bản sao trước 7-phase**, tức không phải regression do RC.
- **Root cause:** theo phân tích trước đó (CODE AUDIT + log test), **không chạy lại trong nhiệm vụ này**.

| # | Test | Module | Lý do fail | Hành vi dự kiến hiện tại | Đã có test thay thế? | Rủi ro nếu xoá | Đề xuất |
|---|---|---|---|---|---|---|---|
| 1–5 | WORKOUT race: CONFIRM thắng / confirm‖dismiss ×25 / double confirm / business FAILURE → PENDING / crash recovery: stale claim | `agent-workflow-finalization-race.test.ts` | Stub `llmAvailable:true` nên luồng đi đường AI **async**; draft chưa có ngay ("Lịch tập chưa sẵn sàng để lưu") từ f5e606e3 | Draft GENERATING → PREVIEW rồi mới confirm/dismiss | **Một phần**: `agent-ai-workout-lifecycle` có "2 confirm đồng thời → 1 import" và "confirm lặp không ghi lại". **Chưa có**: confirm‖dismiss, dismiss giữa lúc ghi, FAILURE → PENDING, phục hồi stale claim | **Cao**: race, ghi trùng, crash recovery | Viết lại fixture để đi qua async lifecycle (đẩy draft lên PREVIEW bằng completion processor có LLM giả); giữ nguyên expectation |
| 6–7 | M3: double dismiss idempotent / dismiss sau khi hoàn tất; COMPLETED/EXPIRED/CANCELLED | `agent-workflow-product-final-remediation.test.ts` | Như trên | Như trên | **Chưa có** | Cao (chuyển trạng thái) | Như trên |
| 8 | M4-C: sửa workout chỉ cập nhật draft WORKOUT | `agent-workflow-product-remediation-1.test.ts` | Như trên (preview undefined) | Sửa đúng draft khi có nhiều preview | Chưa có | Trung bình–cao (chuyển giữa các domain) | Như trên |
| 9 | M5: cảnh báo chấn thương ở preview và sau khi sửa | idem | Như trên | Cảnh báo injury luôn xuất hiện | Chưa có | Trung bình (an toàn) | Như trên |
| 10–12 | M6: bỏ hoặc thay cable / deadlift / squat bằng ID chuẩn | idem | Như trên | Thay thế bằng `Exercise.id` chuẩn | Chưa có ở async | Trung bình | Như trên |
| 13–15 | M7: nhãn thứ trong tuần / thứ 3-5-7 / đổi số buổi → sinh lại | idem | Như trên | Weekday nhất quán từ preview tới import | Chưa có | Trung bình | Như trên |
| 16 | Workout double confirm = 1 lần import logic | idem | Như trên | Idempotent | **Có một phần** (lifecycle test 1–2) | Thấp–trung bình | Như trên |
| 17 | Cross-workflow context reuse (CREATE_WORKOUT → CREATE_NUTRITION) | `agent-workflow-cross-domain.test.ts` | Như trên (bước workout async) | Dùng lại context giữa các domain | Chưa có | Trung bình–cao (chuyển giữa các domain) | Như trên |
| 18 | Remediation Fix D: "Không, 70 kg." thay giá trị đang chờ | `agent-workflow-remediation-1.test.ts` | Fixture thiếu `activityLevel`; guard hỏi trước (cc197551) chen vào | Hỏi `activityLevel` trước khi đề xuất mục tiêu | Không | Trung bình | **Cập nhật fixture** (thêm `activityLevel`), giữ expectation |
| 19 | Remediation #2 recovery | `agent-workflow-remediation-2.test.ts` | Như trên | Như trên | Không | Trung bình | Cập nhật fixture |
| 20 | GOLDEN 4th turn (flag ON) | `conversational-intelligence-v2.test.ts` | Như trên | Như trên | Không | Trung bình | Cập nhật fixture |
| 21–22 | independent X1 origin, CI off/on | `codex-final-closure-independent.test.ts` | Gọi không có token, nhận "No token provided" thay vì 422 "chưa có hồ sơ" | Route yêu cầu auth | Không | Thấp | **Cập nhật fixture** (gửi token test) |

**Kết luận:**
- 3 test lifecycle mới **không** thay thế được 17 test async cũ. Chúng chỉ phủ GENERATING → PREVIEW → confirm 1 lần và 2 confirm đồng thời.
- Các hành vi race, dismiss, crash recovery, chuyển trạng thái và chuyển domain trên đường async **hiện không có test nào bảo vệ** (rủi ro release: trung bình; chưa thấy lỗi).
- **Kế hoạch hiện đại hoá** (tách riêng, không chặn commit RC1):
  1. Dựng harness async lifecycle dùng chung: completion processor có LLM giả và đẩy draft lên PREVIEW một cách quyết định.
  2. Chuyển 17 test async sang harness đó, giữ nguyên expectation.
  3. Sửa fixture cho 5 test còn lại.
  4. Thêm Redis riêng cho DB test, kèm bước dọn hàng đợi do test tự sở hữu.

---

## 6. Manifest RC1 và kiểm tra dependency

| Hạng mục | Kết quả | Nhãn |
|---|---|---|
| Branch / HEAD | `aws-deploy` @ `5ce4a0ee`; index rỗng | VERIFIED |
| Manifest | **90 file** (87 + 3 file provider gate), tổng 97; 7 file loại trừ: 5 báo cáo `.md`, 1 CSV review, 1 prisma generated | VERIFIED BY CODE |
| Import graph | 289 cạnh tương đối, 0 lỗi | VERIFIED BY CODE |
| File MIXED | `safety_guard.ts`, `intent_router.ts` không đổi kể từ snapshot của commit plan; 10/10 và 6/6 dòng b4 vẫn có mặt | VERIFIED BY CODE |
| Patch b4 | Áp được lên index ở HEAD (`git apply --cached --check`) | VERIFIED BY TEST |
| Mô phỏng 4 commit | Dùng index tạm. C2 bằng đúng HEAD + b4. Tree cuối khác HEAD đúng 90 file và khớp từng byte với working tree. Không có import gãy ở bước nào | VERIFIED BY TEST |
| Enum dùng chung `SUBSTITUTE_SAVED_EXERCISE` | Nằm trong C1; HEAD ai-service đã dùng enum này | VERIFIED BY CODE |
| package.json / lockfile | Không thay đổi; RC không đổi dependency | VERIFIED |
| **`node_modules` local** | **Lệch so với `pnpm-lock.yaml`**: 281 dòng khác ở AWS SDK/smithy; user-service có dependency đã bỏ | VERIFIED |
| Typecheck ai-service (local) | 1 lỗi TS ở `dynamodb-rate-limiter.ts` (không thuộc RC, không đổi từ 09-2026), do lệch kiểu SDK. Xem mục clean install | VERIFIED BY TEST (local) |
| Test llm | **673/673** (working tree, offline) | VERIFIED BY TEST |
| Test harness | provider-gate 15/15 (×3), stack-process 11/11, cost-ledger 7/7 | VERIFIED BY TEST |
| DB test của service | **Không chạy** trong nhiệm vụ này: chúng sẽ enqueue thêm job, hoặc với itest có `Worker` thì sẽ tiêu job cũ trong Redis `:56379` | NOT RUN |
| Secret | 90 file đã quét: 1 kết quả là false positive (chuỗi giả `gate-only-not-a-real-secret`) | VERIFIED BY CODE |
| Xoá file ngoài RC | 5 file `docs/* - Copy.md` đang bị xoá trong working tree: không stage, không khôi phục | VERIFIED |
| Clean install offline + build | Lockfile được chấp nhận, 0 package tải về; shared build, prisma generate và ai-service `tsc` đều **exit 0**; test llm 673/673. Lỗi TS local chỉ do `node_modules` bị lệch (`evidence/clean-install-result.txt`) | VERIFIED BY TEST |
| Đóng gói Lambda thật / CI build từ SHA | **Chưa chạy** | NOT VERIFIED |

---

## 7. Kế hoạch 4 commit (chưa thực hiện)

**Điều kiện trước:**
- Index rỗng; `git status` khớp với snapshot.
- Không có agent nào khác đang sửa 90 file này.
- Tuyệt đối không dùng `git add -A` hay `git add .`

```
P=docs/release/v1.0.0-rc1/commit-plan
```

| Commit | Lệnh stage | Diff kỳ vọng | Kiểm tra trước khi commit |
|---|---|---|---|
| **C1** shared contract | `git add -- $(cat $P/C1.files.txt)` | 1 file (`backend/shared/src/fitness-agent.ts`), tree `60225dfa…` | `pnpm --filter @gym-coach/shared run build` |
| **C2** b4 coach safety | `git apply --cached $P/b4-safety_guard.patch $P/b4-intent_router.patch` rồi `git add -- $(cat $P/C2.files.txt)` | 6 file (4 file b4 + 2 file MIXED chỉ có hunk b4), tree `e589650d…` | `git diff --cached` của 2 file MIXED phải bằng đúng 2 patch; chạy `coach-b4-regressions.test.ts` |
| **C3** AI stabilization V1 RC1 | `git add -- $(cat $P/C3.files.txt)` (gồm toàn bộ 2 file MIXED) | 64 file, tree `685622f0…` | Test llm 673/673; typecheck ai-service trên dependency sạch |
| **C4** eval & harness | `git add -- $(cat $P/C4.files.txt)` | 21 file, tree `b809ca3d…` | cost-ledger, stack-process, provider-gate (`node --test`) |

- Sau mỗi bước: `git diff --cached --name-only` phải bằng danh sách file, và `git write-tree` phải ra đúng tree ID trong `commit-plan/commit-sim-result.json`. Lệch thì dừng.
- **Không stage:**
  - `AGENTS.md`, `CLAUDE.md`;
  - `*/generated/prisma/*` (khác biệt chỉ là whitespace);
  - `docs/**` (kể cả gói này) và các file `docs/* - Copy.md` đang bị xoá;
  - `test/**/results/`, các báo cáo `.md`, `.tmp-stack/`;
  - các file untracked khác ngoài manifest.

**Commit message đề xuất:**
- C1: `feat(shared): thêm SUBSTITUTE_SAVED_EXERCISE vào hợp đồng fitness-agent (ai-service đã dùng)`
- C2: `fix(ai-service): b4 — chặn đổi bài tập vĩnh viễn ngoài phạm vi, chuyển hướng y tế, hướng dẫn bài tập an toàn`
- C3: `feat(ai-service): ổn định AI V1 RC1 — speech-act gate, grounding BMI/intake, context fidelity, chính sách người dùng vị thành niên, hygiene, định tuyến so sánh bữa ăn`
- C4: `test(ai-eval): provider gate trước network, preflight hàng đợi, ledger LLM+embedding, harness dừng stack an toàn`

Mỗi message kết thúc bằng dòng `Co-Authored-By` nếu Claude Code là người thực hiện commit.

---

## 8. Kế hoạch build, deploy và rollback Lambda

Dựa trên `.github/workflows/dev-build.yml`, `dev-deploy.yml`, `scripts/ci/Build-LambdaArtifact.ps1`.

1. **Tag** `v1.0.0-rc1` gắn vào SHA của C4, sau khi chủ dự án duyệt. Push tag/branch chỉ khi được duyệt: push `aws-deploy` **tự kích hoạt** `dev-build.yml`.
2. **CI build từ SHA** (`dev-build.yml`, Windows):
   - `pnpm install --frozen-lockfile`
   - `db:generate`
   - build đệ quy (shared → ai-service `tsc`)
   - `build:lambda:package`
3. **Artifact bất biến:** `ai-<gitSha>.zip` kèm `ai-<gitSha>.manifest.json` (gitSha, **sha256**, kích thước); ghi vào step summary.
4. **Staging (môi trường `dev`) dry-run:** `dev-deploy.yml` chạy với `build_run_id=<run>`, `services=ai`, `dry_run=true`. Bước này kiểm `ARTIFACT_HASH_MISMATCH` và in kế hoạch, không thay đổi gì trên AWS.
5. **Reviewer duyệt:** environment `dev` yêu cầu reviewer; OIDC chỉ cho branch `aws-deploy`.
6. **Deploy:** `dry_run=false`.
   - Upload lên `s3://…/ci-artifacts/ai/<gitSha>/<sha256>.zip` (key theo nội dung, không ghi đè được).
   - `update-function-code`.
   - Ghi **CodeSha256 trước đó** vào `rollback-record.txt`.
7. **Smoke:** workflow chỉ gọi `/health` (không gọi AI/Bedrock). Smoke AI (vài câu chat có kiểm soát qua Nova) là **bước riêng, cần duyệt chi phí riêng**.
8. **Rollback:** chạy lại `dev-deploy` với `build_run_id` của bản build trước (nếu artifact GitHub còn hạn lưu), hoặc `aws lambda update-function-code --s3-key ci-artifacts/ai/<prevSha>/<prevSha256>.zip`. Sau đó đối chiếu `CodeSha256` với `rollback-record.txt`.
9. **Diễn tập rollback:** deploy RC1 → smoke → rollback về artifact trước → smoke → deploy lại RC1. Ghi lại cả 3 giá trị `CodeSha256`.

**Lưu ý:** workflow không dùng `publish-version`/alias. Rollback dựa vào S3 key của artifact trước, nên cần ghi lại gitSha và sha256 của bản đang chạy **trước khi** deploy.

---

## 9. Checklist phê duyệt của chủ dự án (từng hành động riêng)

- [ ] **A1.** Ghi nhận sự cố vượt giới hạn: 56–57 call so với 40 được duyệt; ≈0,095–0,115 USD ước tính; đối soát AWS Billing.
- [ ] **A2.** Chọn cách cô lập hàng đợi: **Phương án A** (Redis mới cho mỗi lần chạy, khuyến nghị) hoặc **Phương án B** (dọn 50 job sau khi xác minh và snapshot).
- [ ] **A3.** Chấp nhận provider gate làm cơ chế bắt buộc cho mọi lần eval live (`EVAL_MAX_PROVIDER_CALLS` / `EVAL_MAX_USD`).
- [ ] **A4.** Chấp nhận các known issue P2/P3 ở mục 4.
- [ ] **A5.** Chấp nhận nợ test ở mục 5 và kế hoạch hiện đại hoá (không chặn RC1).
- [ ] **A6.** Duyệt 4 commit theo mục 7 (Claude Code thực hiện, hoặc chủ dự án tự làm).
- [ ] **A7.** Duyệt tag `v1.0.0-rc1` và push `aws-deploy` (kích hoạt CI build).
- [ ] **A8.** Duyệt deploy dry-run, rồi deploy môi trường dev (staging) qua reviewer.
- [ ] **A9.** Duyệt diễn tập rollback.
- [ ] **A10.** Nếu cần: duyệt một lần smoke AI live có giới hạn chạy qua gate (trần call/USD cụ thể), đồng thời là lần kiểm chứng ký SigV4 của gate.
- [ ] **A11.** Duyệt human review phiếu CSV 10 dòng (`results/…-738Z.human-review.csv`).
