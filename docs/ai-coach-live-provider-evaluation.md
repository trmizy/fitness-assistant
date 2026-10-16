# Báo cáo đánh giá provider LLM cho luồng tạo thực đơn của AI Coach

Ngày: 2026-09-21. Phạm vi: chỉ luồng tạo và chỉnh sửa thực đơn qua chat (CREATE_NUTRITION_PLAN) với ba model khác nhau, cộng phần khảo sát phương án thay thế RunPod (Bedrock, chọn GPU). Không sửa code production. Không commit.

Nhãn bằng chứng dùng trong tài liệu: `REAL HTTP/API` (chạy thật qua HTTP, BullMQ, worker, DB test), `CODE AUDIT` (đọc code hoặc cấu hình), `CONFIG READ` (đọc cấu hình AWS, chỉ đọc). Không có mục nào ở đây là kiểm thử trình duyệt hay production.

## 1. Kết luận ngắn

| Câu hỏi | Trả lời |
|---|---|
| Model cấu hình (qwen3:30b) chạy được qua tunnel RunPod không? | Có. Pod RTX A40, model chạy 100% GPU, khoảng 74 token/giây. |
| Tạo thực đơn lần đầu (4 bữa) với model 30B | 10/10 thành công |
| Chỉnh sửa "Ít bữa hơn" (3 bữa) với model 30B | **3/10 thành công**, 7 lần thất bại do bất biến `fat_target_mismatch` |
| Model 4B chạy local (qwen3:4b) | 10/10 lần tạo thành công (5 lần đầu và 5 lần chỉnh sửa) |
| Model 1,5B chạy local (lần trước) | 2/4 lần tạo thành công |
| Hệ thống có trả kết quả sai khi model thất bại không? | Không. Thất bại được báo rõ lý do, không hiển thị bản xem trước giả, không lưu dữ liệu. |
| Có sửa code không? | Không. Chỉ sửa file harness kiểm thử của tôi (mục 8). |

Rủi ro demo (MEDIUM): nếu demo bằng model 30B thì thao tác chỉnh sửa thực đơn có thể thất bại khoảng 7 trên 10 lần. Đây là chất lượng đầu ra của model, không phải lỗi mất dữ liệu.

## 2. Môi trường

| Thành phần | Chi tiết |
|---|---|
| Máy dev | Windows, GPU RTX 3050 Ti 4 GB VRAM |
| Model local | Ollama trên `127.0.0.1:11434`: `qwen2.5:1.5b`, `qwen3:4b-instruct-2507-q4_K_M` (2,5 GB), `nomic-embed-text` |
| Pod RunPod | NVIDIA A40, 46 GB VRAM, giá $0,49/giờ theo trang giá bạn gửi. Địa chỉ SSH và khoá không ghi trong tài liệu này. |
| Cách nối | SSH port-forward: cổng 11435 trên máy dev tới cổng 11434 của Ollama trên pod, đúng cấu hình `LLM_BASE_URL=http://127.0.0.1:11435` trong `backend/services/ai-service/.env` |
| Model cấu hình | `qwen3:30b-a3b-instruct-2507-q4_K_M` (18 GB), Ollama báo dùng 21 GB VRAM, 100% GPU, ngữ cảnh mặc định 32768 |
| Hạ tầng test | `docker-compose.test.yml`: Postgres test cổng 55433, Redis test cổng 56379 (cô lập, không phải DB dev) |

Cài đặt trên pod: script cài Ollama chính thức, `ollama pull` model chính (tốc độ tải khoảng 400 MB/giây, mất chừng một phút), rồi `ollama pull nomic-embed-text`.

Lưu ý phát hiện khi cài (INFO): bước kiểm tra sức khoẻ provider của ai-service yêu cầu **cả model chat lẫn `nomic-embed-text` phải có trên cùng địa chỉ Ollama**. Lần chạy đầu trên pod thất bại ngay ở bước này (báo `Missing model(s): nomic-embed-text`). Mười lượt lỗi đó là lỗi môi trường, đã loại khỏi thống kê, sau khi tải embedding thì chạy lại từ đầu.

## 3. Phương pháp

Harness: `test/ai-coach-production-readiness/live-nutrition.ts`. Mỗi lượt chạy một hành trình đầy đủ:

1. Ba lượt hội thoại tích luỹ ràng buộc: "không ăn cá", rồi "cũng không ăn thịt bò", rồi "4 bữa".
2. Đưa job thật vào BullMQ, worker thật xử lý, gọi model thật, fitness-service thật (kho thực phẩm thật) trả dữ liệu.
3. Kiểm tra mục tiêu dinh dưỡng, số món, và quét từng món xem có cá hoặc bò.
4. Gửi "không ăn cá và không ăn cay" để kiểm tra từ chối yêu cầu không hỗ trợ.
5. Gửi "Ít bữa hơn" để chỉnh sửa thực đơn (cùng hành động, job mới).
6. Xác nhận lưu, rồi xác nhận lần hai để kiểm tra idempotency.

Thật: ai-service (`tryTurn` và `execute`), Redis và BullMQ, worker và processor, lệnh gọi model qua HTTP, fitness-service, DB test của AI và fitness.
Giả lập: user-service (thay bằng bản stub trong harness, vì user-service thật cần JWT của auth-service). Hồ sơ thử cố định (nam, 22 tuổi, giảm mỡ), nên mục tiêu ra 1992 kcal, 128g protein, 246g carb, 55g chất béo.

Biến môi trường thêm cho harness: `LIVE_LLM_MODEL` (tên model), `LIVE_LLM_BASE_URL` (địa chỉ Ollama, dùng cho tunnel). Mặc định vẫn là `qwen2.5:1.5b` ở `127.0.0.1:11434`.

## 4. Kết quả chi tiết

### 4.1 Model 1,5B (local, lần đo trước)

2 trên 4 lần tạo thực đơn thành công. Hai lần thất bại đều do `fat_target_mismatch`. Đã chẩn đoán trước đó bằng script không dùng LLM: mục tiêu và loại trừ đều hợp lệ với template ít chất béo, và thất bại với template nhiều chất béo, kể cả khi không có mục tiêu hay loại trừ. Nên hiện tượng phụ thuộc model và template, có từ trước.

### 4.2 Model qwen3:4b (local)

Năm lượt liên tiếp, mỗi lượt gồm một lần tạo lần đầu và một lần tạo lại sau chỉnh sửa.

| Chỉ số | Kết quả |
|---|---|
| Tạo lần đầu, 4 bữa | 5/5 |
| Tạo lại sau "Ít bữa hơn", 3 bữa | 5/5 |
| Món cá hoặc bò trong thực đơn | 0 trong cả 5 lượt (84 món mỗi thực đơn lần đầu) |
| "Không ăn cay" | Bị từ chối rõ ràng 5/5, không tạo job hay bản ghi mới |
| Xác nhận lưu | 5/5, thực đơn lưu với 63 dòng |
| Xác nhận lần hai | 5/5 cho cùng kết quả, đúng 1 chương trình |
| Độ trễ tạo lần đầu | Khoảng 64 giây (lượt đầu 104 giây vì nạp model) |
| Độ trễ cả luồng | Khoảng 121 đến 130 giây (lượt đầu 170 giây) |
| Độ trễ hàng đợi, lưu | Khoảng 135 ms và 250 ms |

Thời gian tạo gần như y hệt giữa các lượt (khoảng 64,27 giây) vì model chạy nhiệt độ 0 với cùng câu lệnh, nên số token sinh ra như nhau. Đây là độ ổn định của thời gian, không phải bằng chứng đã đo nhiều biến thể.

### 4.3 Model qwen3:30b (đúng cấu hình, qua tunnel RunPod)

Mười lượt liên tiếp (20 lần tạo thực đơn).

| Chỉ số | Kết quả |
|---|---|
| Tạo lần đầu, 4 bữa | 10/10 |
| Tạo lại sau "Ít bữa hơn", 3 bữa | **3/10** |
| Thất bại | 7 lần, đều `fat_target_mismatch`, một số lần kèm `calorie_target_mismatch` |
| Tổng số lần tạo thành công | 13/20 |
| Món cá hoặc bò | 0 trong cả 10 lượt ở bản xem trước lần đầu |
| "Không ăn cay" | Bị từ chối 10/10 |
| Bản chỉnh sửa ra 3 bữa | Có, ở mọi lượt (số bữa đúng, dù có lượt thất bại bất biến) |
| Xác nhận lưu và gọi lại | Đạt ở 3 lượt qua được bước tạo lại; 7 lượt kia không đi tới đây vì không có bản xem trước |
| Độ trễ tạo | Khoảng 16,07 giây |
| Độ trễ cả luồng | Khoảng 27 giây |
| Độ trễ hàng đợi, lưu | Khoảng 470 ms và 230 ms |
| GPU | 100% GPU, 21 GB VRAM khi nạp, khoảng 74 token/giây |

Số độ trễ ở 30B lấy từ 3 lượt hoàn tất trọn vẹn (các lượt kia dừng ở bước tạo lại). Với thời gian tạo, lượt thất bại cũng tốn thời gian tương đương vì lỗi phát hiện sau khi model sinh xong.

### 4.4 So sánh

| Bước | 1,5B | 4B | 30B |
|---|---|---|---|
| Tạo lần đầu | 2/4 | 5/5 | 10/10 |
| Tạo lại sau chỉnh sửa | không đo riêng | 5/5 | 3/10 |
| Thời gian tạo | khoảng 8 giây | khoảng 64 giây (GPU 4 GB) | khoảng 16 giây (A40) |
| Chi phí | miễn phí | miễn phí | thuê pod theo giờ |

## 5. Phân tích nguyên nhân (đã chứng minh và chưa chứng minh)

Đã có bằng chứng:
- Bất biến `fat_target_mismatch` là bước kiểm tra sau khi sinh (`nutrition-plan-invariant.service`). Nó từ chối thực đơn có tổng chất béo hoặc calo lệch mục tiêu quá ngưỡng. Hệ thống làm đúng chức năng của nó.
- Cả hai model cho thực đơn hợp lệ ở 4 bữa. Với 3 bữa, 30B chọn món khiến chất béo và calo lệch, còn 4B thì không. Nghĩa là kết quả phụ thuộc model và template, không phụ thuộc mục tiêu hay loại trừ.
- Processor sinh thực đơn chỉ chạy một lần: nếu vi phạm bất biến thì thất bại ngay, không có thử lại hay hiệu chỉnh (đã đọc trong `nutrition.processor.ts` và `ai.worker.ts`).

Chưa chứng minh (đừng coi là kết luận):
- Chưa biết vì sao riêng bước 3 bữa gây lỗi với 30B. Không đo trên nhiều hồ sơ, nhiều câu lệnh chỉnh sửa khác. Mẫu chỉ 10 lượt, một hồ sơ, một kịch bản.
- Chưa đo chất lượng dinh dưỡng của thực đơn theo chuyên môn, chỉ kiểm tra các bất biến của hệ thống.

## 6. Phương án thay thế RunPod (CODE AUDIT và CONFIG READ)

### 6.1 Bedrock

- Code hỗ trợ `LLM_PROVIDER=bedrock` (chat và vision) và `EMBEDDING_PROVIDER=bedrock`, chọn độc lập nhau (`services/llm.service.ts`, `services/bedrock.client.ts`, `services/embedding-config.ts`).
- Lambda `fitness-assistant-dev-ai` **đang chạy `LLM_PROVIDER=bedrock`**: chat và vision dùng `apac.amazon.nova-pro-v1:0`, embedding `cohere.embed-multilingual-v3` (1024 chiều), vector store OpenSearch, vùng `ap-southeast-1`. Vậy qwen3:30b qua RunPod chỉ là cấu hình chạy local, không phải cấu hình đang chạy trên AWS.
- Bedrock tính phí theo token, không theo giờ. Tôi chưa tra giá hiện hành nên không đưa số liệu chi phí.
- Chưa xác nhận được quyền dùng model: gọi `get-foundation-model-availability` cho Nova Pro, Nova Lite và Cohere embed đều trả `NOT_AUTHORIZED` với credential tôi đang dùng, và Cohere embed còn báo `agreement: NOT_AVAILABLE`. Không rõ là chưa bật model access hay do quyền IAM của identity này. Tôi không gọi model thật nên chưa đo.
- Embedding Bedrock (1024 chiều) không trộn được với Qdrant local đang dùng `nomic-embed-text` (768 chiều). Đổi embedding phải nạp lại dữ liệu.
- Nên tạo IAM user riêng chỉ có quyền `bedrock:InvokeModel` thay vì dùng credential quản trị.

### 6.2 Chọn GPU RunPod (giá đọc từ ảnh bạn gửi)

Model 30B Q4 cần khoảng 19 GB VRAM cho trọng số (ước lượng) cộng bộ nhớ ngữ cảnh. Khuyến nghị RTX A40 (48 GB, $0,49/giờ): dư VRAM, còn nhiều chỗ. RTX 3090 ($0,50) và RTX 4090 ($0,74) đều chỉ 24 GB, sát giới hạn. RTX A5000 rẻ ($0,27) nhưng đang hết chỗ. L4 chậm hơn do băng thông thấp. Các card 16 đến 20 GB không đủ. H100, H200, B200, A100 quá đắt cho việc thử nghiệm.

Kết quả đo thực tế trên A40 (mục 4.3) khớp khuyến nghị: model chạy 100% GPU, khoảng 21 GB VRAM, dư nhiều chỗ.

## 7. Phát hiện và mức độ

| Mã | Mức | Nội dung |
|---|---|---|
| F1 | MEDIUM (rủi ro demo) | Với model cấu hình 30B, chỉnh sửa thực đơn sang 3 bữa thất bại 7/10 lần vì bất biến chất béo và calo. Hệ thống thất bại trung thực, không lưu dữ liệu sai. |
| F2 | INFO | Model 4B local ổn định hơn 30B ở kịch bản này (10/10) và miễn phí, nhưng chậm hơn (khoảng 64 giây, GPU 4 GB). |
| F3 | INFO | Kiểm tra sức khoẻ provider yêu cầu cả model chat và `nomic-embed-text` trên cùng địa chỉ Ollama. |
| F4 | INFO | Cấu hình không nhất quán: `.env` gốc đặt `LLM_PROVIDER=anthropic` (có key), còn `.env` của ai-service đặt `ollama` qua cổng 11435. Chưa xác minh môi trường demo dùng cấu hình nào. |
| F5 | INFO | Quyền model Bedrock chưa xác nhận (mục 6.1). |

CRITICAL và HIGH: không phát hiện trong phạm vi này.

## 8. Thay đổi trong repo

- Sửa `test/ai-coach-production-readiness/live-nutrition.ts` (harness kiểm thử của tôi): thêm biến `LIVE_LLM_MODEL` và `LIVE_LLM_BASE_URL`, cập nhật ghi chú provider-health khi dùng tunnel. Mặc định giữ nguyên hành vi cũ.
- Không sửa code production, không thêm migration, không commit.
- Trên pod RunPod: cài Ollama và tải hai model. Đây là thay đổi ngoài repo, mất khi dừng pod.

## 9. Khuyến nghị

1. **Chưa nên demo chỉnh sửa thực đơn bằng model 30B** cho tới khi xử lý F1. Chọn một: (a) dùng 4B cho demo, hoặc (b) chạy 30B nhưng tránh thao tác chỉnh sửa, hoặc (c) sửa generator.
2. Nếu sửa generator (cần bạn quyết định, tôi chưa làm): (a) tự động thử lại một lần, kèm thông báo bất biến vi phạm vào câu lệnh; hoặc (b) bước hiệu chỉnh xác định, để code chỉnh lượng thực phẩm cho đạt chất béo và calo. Cả hai đều chạm vào lõi sinh thực đơn, cần hồi quy đầy đủ sau đó.
3. Nếu muốn tiết kiệm chi phí: dùng 4B local cho demo, hoặc Bedrock sau khi xác nhận model access.
4. Chạy thêm với model 30B: luồng roadmap, workout và PT (chưa thử), và nhiều hồ sơ, nhiều câu lệnh chỉnh sửa khác để có tỉ lệ thành công đáng tin.
5. Bật kiểm thử trình duyệt có đăng nhập cho hành trình thực đơn (vẫn chưa làm).

## 10. Việc dọn dẹp

- Tunnel SSH trên máy dev đã tắt.
- Pod RunPod vẫn đang chạy tại thời điểm viết. Bấm **Stop** trên trang RunPod nếu không cần chạy thêm để tránh tốn phí theo giờ. Model nằm trên đĩa container nên sẽ mất khi dừng; tải lại mất khoảng một phút.
- File log tạm của các lượt chạy đã xoá; số liệu quan trọng đã chép vào tài liệu này.

## 11. Lệnh đã dùng (không chứa bí mật)

```bash
# Model 4B local
LIVE_LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M \
  npx tsx test/ai-coach-production-readiness/live-nutrition.ts

# Model 30B qua tunnel (tunnel: ssh -N -L 11435:127.0.0.1:11434 <pod>)
LIVE_LLM_MODEL=qwen3:30b-a3b-instruct-2507-q4_K_M \
LIVE_LLM_BASE_URL=http://127.0.0.1:11435 \
  npx tsx test/ai-coach-production-readiness/live-nutrition.ts

# Trên pod
ollama pull qwen3:30b-a3b-instruct-2507-q4_K_M
ollama pull nomic-embed-text
```

Hạ tầng test: `docker compose -f docker-compose.test.yml up -d postgres-test redis-test`.
