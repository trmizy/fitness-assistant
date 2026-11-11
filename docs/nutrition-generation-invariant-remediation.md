# Nutrition generation: invariant reliability remediation (finding F1)

Ngày: 2026-09-21. Phạm vi: đúng một vấn đề, là kế hoạch thực đơn do pipeline sinh ra thường vi phạm bất biến calo/chất béo sau khi chỉnh sửa "Ít bữa hơn". Không mở lại kiến trúc AI Coach. Không đổi bất biến, không đổi ngưỡng, không đổi mục tiêu dinh dưỡng, không đổi logic loại trừ thực phẩm. Không commit.

Tài liệu gốc `docs/ai-coach-live-provider-evaluation.md` giữ nguyên (bằng chứng 3/10 vẫn là lịch sử).

Nhãn bằng chứng: `REAL HTTP/API` (BullMQ, worker, model, fitness-service, DB test thật), `BACKEND INTEGRATION` (test tự động, processor thật, catalog/LLM stub), `CODE AUDIT`.

## 1. Kết luận

| Mục | Kết quả |
|---|---|
| Model | `qwen3:30b-a3b-instruct-2507-q4_K_M` qua tunnel tới RunPod A40 (cấu hình đúng) |
| Tạo lần đầu (4 bữa) | **20/20** hợp lệ |
| Tạo lại sau "Ít bữa hơn" (3 bữa) | **20/20** hợp lệ (trước đó 3/10) |
| Lưu thật, gọi lại xác nhận | 20/20 lưu; 20/20 chỉ có đúng 1 chương trình |
| Món cá hoặc bò | 0 ở cả 40 lần tạo |
| qwen3:4b (kiểm tra hồi quy) | 5/5 lần đầu, 5/5 chỉnh sửa, repair không cần chạy |
| Độ trễ do repair | 5 đến 7,5 ms (so với ~16 giây model) |
| F1 đóng? | **Có**, cho kịch bản cố định này |

Đây là cổng sẵn sàng demo cho kịch bản cố định (một hồ sơ, một chuỗi câu lệnh), không phải khẳng định chất lượng chung.

## 2. Tái hiện ban đầu

Fixture: nam, 22 tuổi, giảm mỡ, mục tiêu 1992 kcal, protein 128, carb 246, chất béo 55. Ràng buộc: không cá, không bò. Chạy luồng thật: 4 bữa, rồi "Ít bữa hơn" để ra 3 bữa. Model cấu hình qua tunnel.

Thu thập bằng cách bọc lệnh gọi LLM trong harness (`LIVE_CAPTURE_FILE`), rồi dựng lại kế hoạch ngoại tuyến bằng builder thật và catalog thực phẩm thật (`test/nutrition-invariant-remediation/analyze-captures.ts`). Kết quả dựng lại khớp hoàn toàn với log lỗi của worker thật.

| Ca | Số bữa | Bất biến | Ngày 1: kcal / P / C / F | Ghi chú |
|---|---|---|---|---|
| Đạt | 4 | có | 2241 / 128,1 / 313,4 / 60,9 | trong dung sai |
| **Hỏng** | 3 | không | **2353 / 128,3 / 308,1 / 81,5** | chất béo tối đa 81,7; kcal tối đa 2418 |

Giới hạn bất biến (không đổi): calo ±20% (1594 đến 2390), macro ±35% (chất béo 35,8 đến 74,3 g). Ngày hỏng vượt cả hai: chất béo 81,5 g và kcal tới 2418.

Ngày 1 của kế hoạch 3 bữa hỏng (chất liệu thật, 3 bữa):
- Bữa 1: soy flour defatted 79 g + táo sấy 88 g + margarine 52 g.
- Bữa 2: đùi gà tây 135 g + mứt cam 124 g + mỡ heo muối 30 g.
- Bữa 3: **soy flour full-fat 107 g (đạm 40 g, béo 22 g)** + topping dứa 123 g + mỡ heo muối 30 g.

Model gần như tất định ở nhiệt độ 0,1: cùng một mẫu 3 bữa hỏng xuất hiện lặp lại, cùng số liệu. Khi mẫu khác thì kế hoạch đạt.

## 3. Pipeline hiện tại (đã đọc code)

`nutrition.processor.ts`: LLM nhận danh sách thực phẩm và chỉ trả một mẫu một ngày. Code **chỉ dùng foodId đầu tiên của mỗi bữa** làm "món chính" (nếu đạt ≥15 g đạm và khẩu phần trần thực tế ≥100 g). Toàn bộ **số lượng gram do code tính**, không do LLM: `buildNutritionPlanFromTemplate` chia mỗi bữa theo ba vai (đạm, carb, béo), mỗi vai chọn từ một nhóm thực phẩm có sẵn rồi tính gram theo mục tiêu macro của bữa. Kế hoạch 7 ngày được nhân từ mẫu đó, sau đó qua khớp foodId, cổng loại trừ và bất biến.

## 4. Nguyên nhân gốc

Mỗi vai được định cỡ độc lập theo **toàn bộ** mục tiêu macro của bữa:
- Món chính được tính gram chỉ theo mục tiêu đạm (trừ phần đạm phụ từ hai vai kia).
- Vai béo được tính gram theo toàn bộ mục tiêu béo, **không trừ** lượng béo mà món chính đã mang.
- Vai carb tương tự với carb.

Khi món chính do LLM chọn là thực phẩm béo (ở đây soy flour full-fat: 20,6 g béo trên 100 g), lượng béo của nó **cộng chồng** lên phần béo đã được tính đủ ở vai béo. Calo cũng cộng chồng vì carb phụ và béo phụ. Kế hoạch vượt cả béo lẫn calo.

Vì sao 4 bữa đạt: món chính thứ 2 và thứ 3 do LLM chọn (đậu nành rang khô, phô mai parmesan) có trần khẩu phần dưới 100 g, nên bị bỏ và thay bằng thực phẩm nạc từ nhóm xác định. Món thứ 4 (soy nuts) cũng bị thay. Ở kế hoạch 3 bữa, món chính thứ 3 là soy flour full-fat có trần 250 g nên được giữ, rồi làm vỡ bất biến. Đây là phụ thuộc vào lựa chọn của model và số bữa, không phụ thuộc mục tiêu hay loại trừ.

Không có bằng chứng cho làm tròn, phân phối lại theo số bữa hay dữ liệu dinh dưỡng sai là nguyên nhân.

## 5. Bất biến hiện có (không đổi)

`nutrition-plan-invariant.service.ts`: mỗi ngày kiểm calo ±20%, protein, carb, chất béo ±35%, số bữa, foodId hợp lệ, và giá trị hợp lệ. Thay đổi duy nhất trong file: xuất hai hằng dung sai (`NUTRITION_CALORIE_TOLERANCE_PCT = 0.2`, `NUTRITION_MACRO_TOLERANCE_PCT = 0.35`) để bộ repair dùng đúng cùng con số. Giá trị và hành vi giữ nguyên.

## 6. Giải pháp: hiệu chỉnh số lượng xác định

File mới `backend/services/ai-service/src/services/nutrition-plan-repair.ts` (không dùng LLM, không ngẫu nhiên). Trong `nutrition.processor.ts`: khi (và chỉ khi) bất biến thất bại, gọi repair rồi kiểm lại **cùng** bất biến và cổng loại trừ. Kế hoạch đã đạt không bị chạm.

Các thay đổi trong `nutrition.processor.ts`: gọi repair sau bước bất biến thất bại, ghi log `[nutrition-repair]`, lưu `finalContent`, và export thêm `parseNutritionTemplate` (không đổi hành vi, để test dùng).

### Thuật toán

Với mỗi ngày vi phạm dung sai (các ngày đạt giữ nguyên):
1. Lấy các món đã có trong ngày (đúng các thực phẩm và số bữa đó).
2. Giải bài toán bình phương tối thiểu có cận trên các biến là số gram, bằng giảm toạ độ tuần hoàn (thứ tự và số vòng cố định, tối đa 300 vòng, dừng khi thay đổi dưới 1e-4).
3. Hàm mục tiêu: tổng sai số tương đối bình phương của kcal, protein, carb, chất béo so với mục tiêu (trọng số 1 mỗi cái), cộng số hạng mềm giữ calo mỗi bữa gần mức chia đều (trọng số 0,1), cộng số hạng mềm giữ gram gần giá trị ban đầu (trọng số 0,01).
4. Làm tròn gram về số nguyên, tính lại từng món, từng bữa, cả ngày bằng đúng công thức làm tròn của builder (calo làm tròn nguyên, macro làm tròn 0,1 g).
5. Chỉ nhận kết quả nếu ngày đó qua dung sai bất biến **và** mỗi bữa nằm trong [0,4 x, 1,8 x] mức calo trung bình mỗi bữa. Nếu không, ngày đó giữ nguyên trạng thái hỏng.

### Được phép đổi gì, cận an toàn

- Chỉ số gram của các món đã có. Không thêm, không thay, không bỏ món. Nên không thể thêm cá hay bò, không có foodId lạ, không thay đổi số bữa.
- Mỗi món: số nguyên trong [min(10 g, trần), trần khẩu phần thực tế của món] (trần lấy từ `realisticServingCapG`, cùng quy tắc của builder). Không có số âm, không có món hoặc bữa rỗng.
- Mục tiêu 1992/128/246/55 không đổi.

### Khi không sửa được

Không ép: ngày không sửa được giữ nguyên, bất biến vẫn từ chối kế hoạch, nên hành vi thất bại trung thực cũ được giữ (đã có test). Thực phẩm không có trong catalog ở ngày hỏng cũng khiến ngày đó không được sửa.

### Điều chưa làm (cố ý)

- Tầng 3 (thay hoặc thêm thực phẩm từ catalog): không cần, vì chỉnh gram đã đủ trên dữ liệu thật.
- Thử lại LLM một lần: không cần, vì hiệu chỉnh xác định đủ. Không thêm vòng thử lại.

## 7. Kết quả sửa trên dữ liệu thật

Mẫu 3 bữa hỏng (bản chụp thật của model 30B), sau repair:

| Ngày 1 | kcal | Protein | Carb | Chất béo |
|---|---|---|---|---|
| Trước | 2353 | 128,3 | 308,1 | 81,5 |
| Sau | 1921 | 128,4 | 252,8 | 55,8 |
| Mục tiêu | 1992 | 128 | 246 | 55 |

Cả 7 ngày được sửa, dải sau sửa: kcal 1921 đến 1959, chất béo 55,8 đến 56,1, protein 127,7 đến 128,6, carb 248,9 đến 252,8. Kết quả tất định (hai lần chạy cho cùng đầu ra), không có foodId lạ, số bữa giữ nguyên 3. Ví dụ ngày 1 sau sửa: soy flour defatted 79 đến 91 g, soy flour full-fat 107 đến 68 g, mỡ heo muối 30 đến 19 g.

## 8. Kiểm thử

Test mới (đều đạt, `BACKEND INTEGRATION`):

- `nutrition-plan-repair.test.ts`, 13 test đơn vị: chất béo quá cao, quá thấp, calo quá cao, quá thấp, cả hai cùng lúc, 3 bữa và 4 bữa, loại trừ cá và bò (catalog có cá, bò nhưng không bao giờ xuất hiện), giới hạn khẩu phần (số nguyên trong cận), làm tròn và nhất quán tổng, no-op khi đã đạt, tất định và không đổi đầu vào, không sửa được (thực phẩm bị chặn trần), foodId lạ, và dung sai trùng với bất biến.
- `nutrition-generation-repair.processor.test.ts`, 5 test đi qua `processNutritionPlanJob` thật:
  - Golden: đầu ra thật của qwen3:30b cho 3 bữa. Trước repair bất biến thất bại (chất béo và calo); qua processor thì hoàn tất, 3 bữa mỗi ngày, mục tiêu không đổi, không cá hay bò, không thêm món, một lần gọi LLM.
  - No-op: kế hoạch 4 bữa đã đạt được lưu đúng như builder tạo ra.
  - Không sửa được: vẫn thất bại với lý do ràng buộc, không lưu kế hoạch.
  - Loại trừ không bị làm yếu.
- Fixture golden đã khử nhạy cảm: `src/__tests__/fixtures/nutrition-30b-3meal-failed.json` và `nutrition-30b-4meal-valid.json` (chỉ có mẫu LLM, mục tiêu, 21 hoặc 22 thực phẩm cần thiết; không có prompt, id người dùng hay siêu dữ liệu nhà cung cấp; đã kiểm tra rằng catalog rút gọn dựng lại đúng kế hoạch gốc).

Tạo lại fixture: `npx tsx test/nutrition-invariant-remediation/make-golden-fixture.ts <capture.jsonl>`.

## 9. Kiểm tra live: qwen3:30b, 20 hành trình liên tiếp (`REAL HTTP/API`)

Chạy tuần tự, không chọn lọc kết quả, giữ nguyên mọi lượt. Bản ghi thô: 20 tệp log (đã xoá cùng thư mục tạm; số liệu tổng hợp bằng `test/nutrition-invariant-remediation/summarize-live-logs.js`).

| Chỉ số | Kết quả |
|---|---|
| Tạo lần đầu, 4 bữa | PASS 20, FAIL 0 (trên 20) |
| Tạo lại 3 bữa | PASS 20, FAIL 0 (trên 20) |
| Cùng một hành động sau chỉnh sửa, job mới | 20/20 |
| Bản chỉnh sửa có đúng 3 bữa | 20/20 |
| Cá hoặc bò trong bản xem trước | 0 (cả bản đầu và bản chỉnh sửa, 20/20) |
| "Không ăn cay" bị từ chối, không tạo bản ghi mới | 20/20 |
| Lưu chương trình thật (63 dòng) | 20/20 |
| Xác nhận lần hai cho cùng kết quả, đúng 1 chương trình | 20/20 |
| Repair được gọi | 15 trên 20 lượt, đều ở bước tạo lại 3 bữa, cả 15 thành công (7/7 ngày, 0 ngày hỏng) |
| Repair không cần | 5 lượt (model trả mẫu 3 bữa khác, đã đạt) |
| Mẫu hỏng trước repair (giống nhau ở 15 lượt) | ngày 1: 2353 kcal, P128,3, C308,1, F81,5 |
| Sau repair (giống nhau ở 15 lượt) | ngày 1: 1921 kcal, P128,4, C252,8, F55,8 |
| Thời gian repair | 5,0 đến 7,4 ms (trung bình khoảng 6,4 ms) |
| Thời gian model tạo lần đầu | khoảng 16 giây (lượt đầu 24 giây) |
| Cả luồng đến khi lưu xong | khoảng 27 giây (một số lượt 35 giây do nạp lại model) |

Ghi chú về dữ liệu theo từng lượt: số liệu "trước và sau repair" chỉ được ghi ở lượt có gọi repair (log `[nutrition-repair]`); ở 5 lượt không gọi repair thì kế hoạch đã đạt ngay từ builder nên không có bản "trước". Model chạy gần tất định, nên các lượt có repair cho cùng số liệu.

## 10. Kiểm tra hồi quy model nhỏ: qwen3:4b (local)

5 hành trình liên tiếp: 5/5 lần đầu, 5/5 chỉnh sửa, 5/5 lưu, 5/5 gọi lại đúng 1 chương trình, 0 cá hay bò, 5/5 từ chối "không ăn cay". Repair **không được gọi** ở lượt nào vì kế hoạch đã đạt (đường no-op). Thời gian tạo khoảng 64 đến 80 giây (GPU 4 GB). Không có hồi quy so với kết quả trước đó.

## 11. Hồi quy lõi

| Bộ | Kết quả |
|---|---|
| Workflow, loại trừ, parser, race + 18 test repair mới | 136/136 |
| Bất biến, serving caps, PT, chương trình, memory, claims, narrator | 184/184 |
| Foundation evaluator (không đổi) | 30/30 |
| Fitness: dinh dưỡng, bootstrap, idempotency, concurrency | 37/37 |
| `tsc --noEmit` ai-service, fitness-service | sạch |

Frontend build không được chạy lần này, vì không sửa frontend.

## 12. Phạm vi thay đổi

Code production (đều thuộc nhóm sinh thực đơn):
- `services/nutrition-plan-repair.ts` (mới).
- `services/nutrition.processor.ts` (gọi repair sau bất biến thất bại, log, export `parseNutritionTemplate`).
- `services/nutrition-plan-invariant.service.ts` (chỉ xuất hai hằng dung sai, giá trị không đổi).

Không đổi: agent-workflow, vòng đời FitnessAgentAction, PT, Program v2, memory, mục tiêu dinh dưỡng, phân tích loại trừ, bootstrap, frontend, migration.

Hỗ trợ và bằng chứng:
- Test: `nutrition-plan-repair.test.ts`, `nutrition-generation-repair.processor.test.ts`, hai fixture.
- Công cụ: `test/nutrition-invariant-remediation/` (`analyze-captures.ts`, `make-golden-fixture.ts`, `summarize-live-logs.js`).
- Harness live: `test/ai-coach-production-readiness/live-nutrition.ts` thêm tuỳ chọn ghi lại prompt và câu trả lời (`LIVE_CAPTURE_FILE`).
- CI: `.github/workflows/docker-test.yml` thêm hai file test mới vào cổng lõi hiện có (chưa chạy trên runner).

## 13. Phát hiện còn lại

- CRITICAL, HIGH: không.
- MEDIUM: không cho kịch bản này.
- LOW/INFO: (a) Builder có xu hướng vượt calo 4 đến 14% ở các kế hoạch vẫn đạt (nằm trong ±20%). Theo yêu cầu no-op, chúng không bị chạm. (b) Mẫu kiểm tra là một hồ sơ, một chuỗi câu lệnh, 20 hành trình, nên không thể nói tới tỉ lệ thành công tổng quát. Hồ sơ khác, câu lệnh khác (ví dụ 5 bữa, mục tiêu tăng cơ) cần đo riêng. (c) User-service vẫn là stub trong harness live. (d) Chưa chạy trình duyệt có đăng nhập.

## 14. Kết luận

- F1 đóng cho kịch bản cố định: **có**.
- Thực đơn sẵn sàng demo (kịch bản này, model 30B hoặc 4B): **có**.
- Sẵn sàng bước E2E trình duyệt: **có** (phần thực đơn), các phần khác của E2E chưa liên quan tới thay đổi này.

## 15. Lệnh đã dùng

```bash
# Dựng lại và phân tích các bản chụp thật (không gọi LLM)
npx tsx test/nutrition-invariant-remediation/analyze-captures.ts <capture.jsonl>
npx tsx test/nutrition-invariant-remediation/make-golden-fixture.ts <capture.jsonl>

# Live: 30B qua tunnel (ssh -N -L 11435:127.0.0.1:11434 <pod>) và 4B local
LIVE_LLM_MODEL=qwen3:30b-a3b-instruct-2507-q4_K_M LIVE_LLM_BASE_URL=http://127.0.0.1:11435 \
  npx tsx test/ai-coach-production-readiness/live-nutrition.ts
LIVE_LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M npx tsx test/ai-coach-production-readiness/live-nutrition.ts

# Test
cd backend/services/ai-service
npx tsx --test --test-force-exit src/__tests__/nutrition-plan-repair.test.ts \
  src/__tests__/nutrition-generation-repair.processor.test.ts
```
