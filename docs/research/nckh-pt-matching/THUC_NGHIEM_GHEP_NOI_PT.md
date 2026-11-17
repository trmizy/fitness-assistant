# Thực nghiệm — Ghép nối huấn luyện viên cá nhân bằng LLM kết hợp chấm điểm tương thích đa tiêu chí

Đề tài: *"Nghiên cứu và ứng dụng mô hình ngôn ngữ lớn kết hợp chấm điểm tương thích đa tiêu chí trong ghép nối huấn luyện viên cá nhân dựa trên mục tiêu, chỉ số cơ thể và lịch rảnh của người tập"*

Hệ thống: Gymini (nhánh `feature/payment-gateways`, HEAD `3e453ed3`). Ngày chạy: 07/11/2026.
Nhãn bằng chứng: **TEST FIXTURE / mô phỏng offline**. Đây không phải thử nghiệm với người dùng thật và không chạy LLM trực tiếp (xem mục 6).

---

## 1. Hệ thống được thực nghiệm (gồm 4 tầng)

| Tầng | Vai trò | Mã nguồn thật |
|---|---|---|
| T1. LLM hội thoại + điền khe (slot-filling) | Hỏi đáp nhiều lượt để lấy mục tiêu, các ngày rảnh, thời lượng buổi tập, ngân sách. Hiểu cả cách nói tự nhiên như "1.5 triệu" hay "không giới hạn" | `ai-service/.../find-pt-program.workflow.ts` |
| T2. Lọc ràng buộc cứng | Chỉ giữ PT đã duyệt, không bị đình chỉ, còn nhận học viên; chuyên môn khớp mục tiêu; **rảnh đủ mọi ngày người tập chọn**; có gói ≤ ngân sách và thời lượng ≤ mong muốn; **còn đủ khung giờ trống trong 28 ngày tới** | `user-service/.../agentic-fitness.service.ts::candidates()` |
| T3. Chấm điểm tương thích đa tiêu chí `scorePT` (compatibility-v2) | Tổng có trọng số: mục tiêu 30, lịch 25, ngân sách 20, uy tín 10, bằng chứng 15. Thành phần *bằng chứng* = số hành trình cũ của PT với khách **có chỉ số cơ thể tương tự** (cân nặng, % mỡ, tần suất, thời lượng; `journeySimilarity` ≥ 0,65; cần ít nhất 5 hành trình). PT mới (cold-start) không bị phạt | `backend/shared/src/fitness-agent-scoring.ts` |
| T4. LLM diễn giải có kiểm soát (Claim Catalog) | LLM **chỉ được chọn ID mệnh đề** trong danh mục dựng sẵn từ dữ liệu thật; câu chữ do bộ dựng tất định tạo ra. ID lạ hoặc bịa thì bị loại và dùng phương án dự phòng | `ai-service/src/llm/recommendation_narrator.ts`, `recommendation_claims.ts` |

Thứ tự trong sản phẩm: T1 → T2 → T3 (sắp điểm giảm dần, hoà thì theo id, lấy top 5) → T4.

## 2. Dữ liệu đầu vào và cách thực nghiệm

### 2.1 Thực nghiệm A — chất lượng ghép nối (T2 + T3)

**Dữ liệu mô phỏng có seed cố định** (5 seed: 11, 23, 37, 41, 53), nên chạy lại cho đúng kết quả cũ.

*Hồ sơ PT* (80 hoặc 250 PT mỗi seed):
- Chuyên môn: 1–2 trong 4 mục tiêu (giảm mỡ, tăng cơ, duy trì, hiệu suất thể thao).
- Lịch: rảnh 3–6 ngày/tuần.
- Gói tập: 1–3 gói (8/12/16 buổi; buổi 45/60/90 phút), giá tăng theo năng lực.
- Khoảng 10% PT thiếu khung giờ trống; khoảng 5% PT không nhận khách.
- **30% PT mới** (0–3 khách cũ); số còn lại có 5–50 hành trình khách cũ, mỗi hành trình gồm cân nặng, % mỡ, mục tiêu, trình độ, số buổi giao và số buổi hoàn thành, kết quả.
- Mỗi PT có một **chất lượng ẩn** q ∈ [0,1], khác nhau theo mục tiêu × nhóm thể trạng (gầy <18% mỡ / trung bình 18–27% / cao ≥27%). Mỗi PT giỏi hơn với một nhóm thể trạng sở trường. Hệ thống không nhìn thấy q. Kết quả hành trình cũ và điểm sao được sinh ngẫu nhiên có nhiễu dựa trên q.

*Hồ sơ người tập* (300 người mỗi seed, tổng 1.500 truy vấn mỗi kịch bản):
- Mục tiêu, trình độ, nhóm thể trạng (35% mỡ cao / 40% trung bình / 25% gầy), cân nặng và % mỡ theo nhóm.
- Lịch: 2–4 ngày rảnh.
- Thời lượng buổi: 45/60/90 phút.
- Ngân sách: 1,5–6 triệu đồng.

*Nhãn đúng (ground truth)*: độ phù hợp của cặp (người tập, PT) = q[mục tiêu][nhóm thể trạng] nếu PT thoả mọi ràng buộc cứng, bằng 0 nếu không. Một PT được tính là "phù hợp" khi độ phù hợp ≥ 0,6.

*4 kịch bản thị trường*:

| Kịch bản | Số PT | Điểm sao |
|---|---|---|
| S1 | 80 | Phản ánh chất lượng (nhiễu σ = 0,3) |
| S2 | 80 | Bị thổi phồng: dồn về 4,3–5 sao như các sàn thật |
| S3 | 250 | Phản ánh chất lượng |
| S4 | 250 | Bị thổi phồng |

**Các phương pháp so sánh**:

| Mã | Phương pháp | Ý nghĩa |
|---|---|---|
| M0 | Ngẫu nhiên | Mốc dưới |
| M1 | Chỉ sắp theo sao | Cách làm phổ biến của sàn tìm PT |
| M2 | Chấm điểm đa tiêu chí, **không** lọc cứng | Chỉ có tầng "mềm" |
| M3 | Lọc cứng + giá rẻ nhất | Kiểu "lọc rồi sắp theo giá" |
| M4 | Lọc cứng + sắp theo sao | Đối chứng mạnh |
| M5 | Lọc cứng + đa tiêu chí **v1** | Bản cũ, phạt PT mới |
| **M6** | **Lọc cứng + đa tiêu chí v2** | **Phương pháp của hệ thống** |
| A1–A3 | M6 bỏ lần lượt (mục tiêu + lịch + ngân sách) / uy tín / bằng chứng chỉ số cơ thể | Ablation |
| X1 | M6, bằng chứng tính thêm tỉ lệ hoàn thành của nhóm khách tương tự | Thử nghiệm, chưa có trong sản phẩm |
| X2 | M6 không làm tròn điểm, hoà thì ưu tiên sao | Cải tiến nhỏ đề xuất |

**Chỉ số đo (K = 5)**:
- NDCG@5 (chỉ số chính).
- Precision@5 (trên số kết quả trả về) và Recall@5.
- HitRate@1: top-1 có trùng PT tốt nhất thực sự không.
- **Vi phạm@5**: tỉ lệ PT trong top-5 không đáp ứng mục tiêu, lịch, ngân sách hoặc thời lượng.
- Tỉ lệ hoà điểm@5.
- Cold-start Hit@5: khi PT tốt nhất là PT mới, PT đó có lọt top-5 không.
- Thời gian xử lý mỗi truy vấn.

Kết quả báo cáo dạng trung bình ± độ lệch chuẩn qua 5 seed.

Ngoài ra có thêm hai thí nghiệm phụ:
- **Độ nhạy trọng số**: quét lưới trọng số uy tín {0, 5, 10, 20, 30} × bằng chứng {0, 5, 15, 25, 35}, trên kịch bản S4.
- **Khả năng mở rộng**: đo thời gian với 100 / 500 / 1.000 / 5.000 PT.

### 2.2 Thực nghiệm B — tầng LLM (T1 + T4)

Dùng bộ đánh giá có sẵn của dự án. Phản hồi LLM được giả lập bằng mock để kiểm **cơ chế kiểm soát**, không kiểm chất lượng ngôn ngữ của một mô hình cụ thể.
- **Chống bịa đặt khi diễn giải**: 50 câu bịa trực tiếp ở thế hệ 1 (điểm, chứng chỉ, lịch, giá, đánh giá, cam kết kết quả, y khoa/doping…); 30 câu diễn đạt lại ở thế hệ 2; 50 câu ám chỉ tinh vi ở thế hệ 3 (ví dụ "chứng chỉ đã được thẩm định", "được công nhận"…). Cả ba thế hệ đều chạy qua *bộ kiểm văn bản tự do*. Thêm 12 ca tấn công vào *kiến trúc chọn mệnh đề* (ID bịa, ID của PT khác, chứng chỉ chưa xác minh, mệnh đề doping…).
- **Hội thoại điền khe**: 19 + 30 kịch bản nhiều lượt. Gồm: dùng lại dữ liệu hồ sơ đã có, sửa câu ("Không, 70kg", "72kg… à không 70kg"), ngân sách "1.500.000" hoặc "Không giới hạn", mục tiêu cân nặng không an toàn, xác nhận đã hết hạn, thao tác đồng thời, luồng từ tìm PT đến thuê theo 2 bước.

## 3. Thu thập dữ liệu

- Kịch bản `experiment/run_pt_matching_experiment.ts` **import thẳng các hàm của sản phẩm**: `scorePT`, `journeySimilarity`, `summarizeJourneys`, `GOAL_SPECIALTIES`, `FITNESS_SCORING`. Bộ lọc cứng chép đúng điều kiện của `candidates()`. Thứ tự sắp và cách phá hoà giống `fitness-agent.service.ts:578-580`.
- Mỗi truy vấn: đo thời gian bằng `process.hrtime`, ghi top-5 của từng phương pháp, tính chỉ số theo nhãn đúng.
- Toàn bộ kết quả thô nằm ở `results/pt_matching_results.json`.
- Thực nghiệm B: chạy lại `run_agentic_evaluation.ts` ngày 07/11/2026 (380 ca), kết quả ở `results/agentic-evaluation-results.json`. Kết quả hội thoại lấy từ lần chạy lưu sẵn (15/09 và 20/09/2026).

## 4. Tiến hành (tái lập)

```bash
# 1) Thực nghiệm A (~10 giây)
backend/services/ai-service/node_modules/.bin/tsx docs/research/nckh-pt-matching/experiment/run_pt_matching_experiment.ts
# 2) Thực nghiệm B (chạy ở thư mục tạm để không ghi đè kết quả trong repo)
cd <thư_mục_tạm> && tsx <repo>/backend/services/ai-service/src/evaluation/agentic/run_agentic_evaluation.ts
# 3) Bảng + biểu đồ
python docs/research/nckh-pt-matching/experiment/make_figures.py
```

## 5. Kết quả

Bảng đầy đủ (12 phương pháp × 8 chỉ số × 4 kịch bản) nằm ở `results/tables.md`. Dưới đây là phần tóm tắt.

### Bảng 1. So sánh phương pháp (trung bình qua 5 seed)

| Phương pháp | NDCG@5 S1 | NDCG@5 S4 | HitRate@1 S1 | HitRate@1 S4 | Vi phạm@5 S1 | Vi phạm@5 S3 | Hoà điểm@5 S3 |
|---|---|---|---|---|---|---|---|
| M0 Ngẫu nhiên | 0,054 | 0,038 | 0,011 | 0,001 | 94,9% | 94,7% | — |
| M1 Chỉ theo sao | 0,049 | 0,038 | 0,025 | 0,000 | 95,9% | 94,9% | — |
| M2 Chấm điểm, không lọc | 0,598 | 0,538 | 0,208 | 0,124 | 49,6% | 37,8% | 94,1% |
| M3 Lọc + giá rẻ | 0,887 | 0,776 | 0,309 | 0,143 | 0% | 0% | — |
| M4 Lọc + sao | **0,941** | **0,821** | **0,516** | **0,227** | 0% | 0% | — |
| M5 Lọc + đa tiêu chí v1 | 0,906 | 0,809 | 0,377 | 0,212 | 0% | 0% | 77,2% |
| **M6 Lọc + đa tiêu chí v2** | 0,900 | 0,784 | 0,359 | 0,181 | **0%** | **0%** | 85,7% |
| X2 v2 không làm tròn + phá hoà theo sao | 0,906 | 0,782 | 0,366 | 0,172 | 0% | 0% | 59,5% |

Bối cảnh dữ liệu:
- Với 80 PT, mỗi truy vấn trung bình còn **4,4 PT hợp lệ**, và 10,9% truy vấn không còn PT nào.
- Với 250 PT, con số là **12,2 PT hợp lệ**, và 2,5% truy vấn rỗng.
- Chỉ **19–28%** PT hợp lệ có đủ từ 5 hành trình khách tương tự để thành phần *bằng chứng* được tính.

### Bảng 2. Ablation (S3: 250 PT, sao phản ánh chất lượng)

| Biến thể | NDCG@5 | HitRate@1 | Hoà điểm@5 | Cold-start Hit@5 |
|---|---|---|---|---|
| **M6 v2 đầy đủ** | 0,810 ± 0,016 | 0,198 | 85,7% | 0,289 |
| A1 bỏ mục tiêu + lịch + ngân sách | 0,812 | 0,200 | 59,0% | 0,269 |
| A2 bỏ uy tín (sao) | 0,784 | 0,161 | 96,8% | 0,636 |
| A3 bỏ bằng chứng chỉ số cơ thể | **0,850** | **0,259** | 93,1% | 0,269 |
| X1 bằng chứng tính theo kết quả | 0,813 | 0,200 | 83,6% | 0,276 |
| M5 v1 (phạt PT mới) | 0,823 | 0,230 | 77,2% | 0,269 |

### Bảng 3. Tầng LLM

| Nhóm ca | Kết quả |
|---|---|
| Bộ kiểm văn bản tự do, thế hệ 1 (bịa trực tiếp) | chặn 50/50 (100%) |
| Bộ kiểm văn bản tự do, thế hệ 2 (diễn đạt lại) | chặn 30/30 (100%) |
| Bộ kiểm văn bản tự do, thế hệ 3 (ám chỉ tinh vi) | **chặn 2/50 (4%)**; chặn nhầm câu hợp lệ 2/18 |
| **Kiến trúc LLM chỉ chọn mệnh đề (Claim Catalog)** | **12/12 (100%)**: ID bịa, ID của PT khác, chứng chỉ chưa xác minh, mệnh đề doping/y khoa đều không thể hiển thị |
| Hội thoại điền khe tìm PT (v1 + v2) | 19/19 + 30/30 đạt |
| Ca cần LLM thật để kiểm (chọn công cụ, prompt injection, RAG) | 33 bỏ qua + 10 bị chặn: chưa đo |

### Biểu đồ (`figures/`)

- `fig1_ndcg_methods.png`: NDCG@5 của 8 phương pháp ở S1 và S4.
- `fig2_violation.png`: tỉ lệ vi phạm ràng buộc trong top-5.
- `fig3_ablation.png`: ablation từng tiêu chí.
- `fig4_sensitivity.png`: heatmap độ nhạy trọng số uy tín × bằng chứng.
- `fig5_llm_grounding.png`: khả năng chặn bịa đặt, văn bản tự do so với chọn mệnh đề.
- `fig6_scalability.png`: 0,04 ms/truy vấn ở 100 PT; 0,41 ms ở 1.000 PT; 2,9 ms ở 5.000 PT.

## 6. Đánh giá và nhận xét

**N1. Ràng buộc cứng về mục tiêu và lịch rảnh là thành phần quyết định.**
- Các cách xếp không lọc (ngẫu nhiên, theo sao) gợi ý **~95% PT không dùng được**: sai chuyên môn, không rảnh đúng ngày, vượt ngân sách.
- Chỉ chấm điểm mềm vẫn còn **38–50%** vi phạm. Nguyên nhân: một PT khớp 2/3 ngày rảnh vẫn được điểm cao.
- Đưa ràng buộc thành bộ lọc cứng (gồm cả kiểm tra khung giờ trống thật trong 28 ngày) giảm vi phạm về **0%** và tăng NDCG@5 từ 0,04–0,60 lên 0,78–0,94.
- Đây là bằng chứng rõ nhất cho giá trị của việc dùng *lịch rảnh* và *mục tiêu* trong ghép nối.

**N2. Sau khi lọc, công thức đa tiêu chí hiện tại chưa vượt được cách đơn giản "lọc + sắp theo sao".**
- M6 thấp hơn M4 từ 0,02 đến 0,08 NDCG@5: S1 0,041; S2 0,022; S3 0,075; S4 0,037. Khoảng cách hẹp lại khi điểm sao bị thổi phồng (S1 → S2, S3 → S4), vì sao kém tin cậy hơn.
- Có ba nguyên nhân, đều đo được:
  - (a) Mục tiêu, lịch và ngân sách đã bị lọc cứng nên trở thành hằng số. Bỏ cả ba (A1) gần như không đổi kết quả (0,812 so với 0,810), tức 75/100 trọng số không giúp phân biệt ứng viên. Đây cũng là lỗi mà dự án từng phát hiện ở bộ chấm chương trình tập (v1 → v2).
  - (b) Điểm bị làm tròn thành số nguyên, khiến **69–89% danh sách top-5 có điểm hoà**, và khi hoà thì thứ tự đang quyết định theo id, tức là tuỳ ý.
  - (c) Thành phần *bằng chứng chỉ số cơ thể* hiện chỉ đếm **số lượng** khách tương tự, không xét **kết quả** của họ. Thành phần này chỉ có giá trị với 19–28% ứng viên. Bỏ nó đi (A3) còn tăng NDCG lên 0,850.
- Kết luận: cách dùng chỉ số cơ thể *hiện tại* chưa đóng góp vào chất lượng xếp hạng trong mô phỏng.

**N3. Uy tín cần giữ, và ngưỡng ≥ 5 đánh giá có lợi.**
- Bỏ uy tín (A2) làm NDCG giảm (0,784) và tỉ lệ hoà tăng lên 97%.
- Heatmap cho thấy trọng số uy tín bằng 0 là vùng kém nhất. Vùng tốt nhất là uy tín 5–20 và bằng chứng 0–5 (NDCG 0,827), so với 0,803 của cấu hình hiện tại (10/15).

**N4. Sửa lỗi cold-start (v1 → v2) giúp PT mới công bằng hơn nhưng đánh đổi một chút độ chính xác.**
- Cold-start Hit@5 tăng 1–2 điểm % (0,818 → 0,838 ở S1; 0,269 → 0,289 ở S3).
- NDCG giảm khoảng 0,006–0,025.
- Đây là đánh đổi có chủ đích giữa công bằng cho PT mới và độ chính xác, nên trình bày như vậy trong bài.

**N5. LLM chỉ đáng tin khi bị giới hạn về mặt kiến trúc.**
- Kiểm văn bản tự do bằng luật bắt được câu bịa thô (100%) nhưng chỉ bắt được **4%** câu ám chỉ tinh vi, và còn chặn nhầm câu hợp lệ.
- Khi LLM chỉ được *chọn ID mệnh đề* sinh từ dữ liệu thật, lời giải thích **không thể chứa thông tin bịa** (12/12 ca tấn công bị vô hiệu), và nếu LLM lỗi thì có phương án dự phòng tất định.
- LLM phát huy tốt ở việc **thu thập tiêu chí bằng hội thoại**: 49/49 kịch bản điền khe, gồm sửa câu, "không giới hạn", dữ liệu đã có trong hồ sơ.
- Kết luận cho đề tài: phân vai đúng là **LLM để hiểu người dùng và giải thích; thuật toán tất định để quyết định thứ tự**.

**N6. Tính khả thi.** Lọc + chấm + xếp chỉ mất dưới 3 ms/truy vấn kể cả với 5.000 PT. Độ trễ thực tế sẽ nằm ở lời gọi LLM, phần này chưa đo.

**Đề xuất cải tiến rút ra từ thực nghiệm** (chưa áp dụng vào sản phẩm):
1. Bỏ mục tiêu, lịch và ngân sách khỏi công thức điểm (đã là bộ lọc), hoặc đổi chúng thành mức độ khớp *liên tục*, ví dụ số khung giờ trống hay giá so với ngân sách.
2. Không làm tròn điểm; khi hoà thì ưu tiên uy tín (X2 giảm tỉ lệ hoà từ 86% xuống 59%).
3. Thiết kế lại thành phần chỉ số cơ thể theo **kết quả** của nhóm khách tương tự (X1 mới là bước đầu, tác dụng nhỏ), đồng thời mở rộng độ phủ bằng cách nới điều kiện "cùng trình độ".
4. Hiệu chỉnh trọng số theo vùng tốt ở Hình 4.

## 7. Hạn chế

- Dữ liệu là **mô phỏng**. Nhãn đúng dựa trên giả định về chất lượng ẩn của PT và cách điểm sao/kết quả phản ánh chất lượng đó, nên kết luận về thứ hạng giữa M4 và M6 phụ thuộc giả định này. Kịch bản S2/S4 (sao bị thổi phồng) được thêm để kiểm độ bền.
- Không chạy LLM thật: máy chưa có Ollama, và khoá API hiện có chỉ dành cho InBody. Phản hồi LLM được mock, nên chưa đo chất lượng ngôn ngữ, độ trễ, tỉ lệ phải dùng dự phòng, prompt injection hay RAG (43 ca chưa chạy).
- Chưa có khảo sát người dùng (mức hài lòng, tỉ lệ thuê PT thật).
- Giả định người tập không có chấn thương (`constraints` rỗng), và mọi gói tập đều là OFFLINE trong cùng tỉnh/thành.

## 8. Tệp đi kèm

```
docs/research/nckh-pt-matching/
├─ THUC_NGHIEM_GHEP_NOI_PT.md          (tài liệu này)
├─ experiment/run_pt_matching_experiment.ts, make_figures.py
├─ results/pt_matching_results.json, agentic-evaluation-results.json, tables.md
└─ figures/fig1…fig6 (.png, 200 dpi)
```

---

## 9. Thực nghiệm C — Benchmark 20 PT × 30 client của nhóm nghiên cứu

### 9.1 Dữ liệu đầu vào

Nguồn: `D:\Nghiên cứu khoa học\Gymini_Research`, snapshot `GYMINI_SIM_COMPLETE_V2_2026-11-03`, SHA256 của tệp PT `c6dd0baf…d6c3`. Script kiểm tra gói chạy ra `PASS`.

**20 PT (PT001–PT020)**:
- Hồ sơ huấn luyện viên đang hành nghề tại TP.HCM, tham chiếu từ website phòng tập công khai (`PUBLIC_PT_SOURCE_LEDGER.csv`): chuyên môn, kinh nghiệm theo website.
- Các thuộc tính vận hành không được công bố gồm giá theo buổi, lịch rảnh theo giờ, quận phục vụ, hình thức online/offline, đặc điểm huấn luyện. Nhóm **đã liên hệ xin trực tiếp nhưng không được cung cấp**, nên các thuộc tính này được bổ sung bằng giá trị mô phỏng có kiểm soát và được khoá trước khi chạy.

**30 client (C01–C30)**:
- Tình huống giả lập chi tiết: tuổi, giới tính, chiều cao, cân nặng, % mỡ, trình độ, 7 loại mục tiêu, khung giờ rảnh theo ngày và giờ, ngân sách theo buổi (có 3 ca không giới hạn), hình thức tập (OFFLINE 20 / ONLINE 6 / HYBRID 4), quận, ưu tiên mềm.
- Mỗi ca có ít nhất 1 PT hợp lệ: 18 ca có 1 PT, 6 ca có 2, 3 ca có 3, 2 ca có 4, 1 ca có 5.

**Nhãn đúng**: chấm H0–H5 tự động theo rubric đã khoá (`H0_H5_RUBRIC.csv`). Kết quả **khớp 30/30** với bảng precheck độc lập của nhóm (`CLIENT_COVERAGE_PRECHECK_PRIVATE.csv`).

### 9.2 Phương pháp

| Mã | Mô tả |
|---|---|
| R | Chọn ngẫu nhiên 3/20 PT (trung bình 200 lần) |
| G0 | **Pipeline Gymini hiện tại** (chép đúng `candidates()` + `scorePT`): lọc mục tiêu theo `GOAL_SPECIALTIES`, PT phải rảnh **mọi ngày** khách chọn (chỉ xét ngày, không xét giờ), giá gói ≤ ngân sách, hình thức tập, địa điểm chỉ đến tỉnh/thành. Mục tiêu của client được ánh xạ về 4 mục tiêu của Gymini |
| G1 | Gymini + **ràng buộc đầy đủ** theo giờ (trùng ≥ 60 phút), quận, giá theo buổi, cùng một gói dịch vụ; sau đó xếp bằng `scorePT` |

Chỉ số lấy đúng theo kế hoạch nghiên cứu: Valid@3, Top-1 Validity, Case Success, Coverage@3, số ca trả rỗng dù có PT hợp lệ.

### 9.3 Kết quả

| Phương pháp | Coverage@3 | **Valid@3** | **Top-1 Validity** | **Case Success** | Recall PT hợp lệ | Trả rỗng sai | Hoà điểm |
|---|---|---|---|---|---|---|---|
| R Ngẫu nhiên | 100% | 8,8% | 8,8% | 24,7% | 16,1% | 0 | — |
| G0 Gymini hiện tại | 57,8% (52/90) | 26,9% (14/52) | 33,3% (10/30) | 36,7% (11/30) | 27,2% | 4 ca | 100% |
| G1 Gymini + ràng buộc đầy đủ | 53,3% (48/90 = tối đa có thể) | 100% | 100% | 100% | 100% | 0 | 58% |

Phân rã 38 vị trí đề xuất sai của G0 (Hình 8):
- **H5 sai quận: 25 vị trí.**
- **H2 không trùng giờ: 16 vị trí.**
- H1 thiếu chuyên môn: 7 vị trí, đều ở các mục tiêu ENDURANCE/FUNCTIONAL mà Gymini không có nhãn tương ứng.
- H3 và H4: 0 vị trí.

4 ca G0 trả rỗng dù có PT hợp lệ là C02, C14, C17, C29. Nguyên nhân là G0 đòi PT rảnh **mọi** ngày khách liệt kê, hoặc mục tiêu không ánh xạ được.

Lưu ý G0: ở đây G0 cho phép bỏ trống ngân sách (bản sửa của partner trên nhánh `aws-deploy`). Trên nhánh `feature/payment-gateways` hiện tại, 3 ca không giới hạn ngân sách (C14, C22, C30) bị lỗi 422. Khi đó Case Success của G0 giảm còn 33,3% và Top-1 Validity còn 30%.

Hình: `figures/fig7_benchmark_validity.png`, `figures/fig8_benchmark_violations.png`. Danh sách top-3 từng ca của G0 và G1: `benchmark/benchmark_top3_per_client.csv`.

### 9.4 Nhận xét

- **C1.** Mô hình dữ liệu hiện tại của Gymini chưa thể hiện đủ nhu cầu người tập: lịch chỉ có ngày, không có giờ; địa điểm chỉ có tỉnh/thành, không có quận; chỉ có 4 mục tiêu. Riêng điều này đã làm 73% đề xuất sai (38/52). Đây là phát hiện quan trọng nhất của benchmark: **ràng buộc lịch rảnh và địa điểm phải được biểu diễn ở mức giờ và quận** thì ghép nối mới dùng được.
- **C2.** Khi bổ sung đủ ràng buộc (G1), mọi đề xuất đều hợp lệ và mọi ca đều tìm được PT. **Lưu ý trung thực:** G1 hợp lệ 100% *theo định nghĩa*, vì bộ lọc của nó chính là rubric. Ý nghĩa của G1 là chỉ ra phần ràng buộc còn thiếu, không phải chứng minh độ chính xác.
- **C3.** Trên bộ dữ liệu này, `scorePT` gần như không phân biệt được các PT hợp lệ (58–100% hoà điểm), vì không có điểm đánh giá và lịch sử khách. **Chỉ số cơ thể của client hiện không ảnh hưởng tới thứ hạng**, chỉ có tác dụng làm ngữ cảnh cho LLM. Thứ tự giữa các PT hợp lệ cần được đánh giá bằng Likert do người chấm, hoặc bằng LLM xếp hạng theo ưu tiên mềm (xem 9.5).

### 9.5 Còn thiếu so với kế hoạch nghiên cứu

120 lượt chạy LLM (30 client × 4 kiểu prompt: zero-shot / one-shot / few-shot 3 / few-shot động 3) **chưa được thực hiện**, nên chưa có số liệu Valid@3 và Likert cho LLM. Khi có kết quả, đặt LLM cạnh R, G0, G1 trong cùng bảng 9.3.
