# Nguồn gốc pilot_A01.csv / pilot_A02.csv — BẢN GIẢ LẬP

- Người tạo: Claude (AI), ngày 2026-10-11, theo yêu cầu của chủ dự án để pipeline chạy thử trong khi chưa có người gán nhãn.
- A01 và A02 **không phải hai người độc lập**: cùng một mô hình đóng hai vai (A01 đọc guideline sát chữ và thận trọng; A02 thực dụng hơn ở ca ranh giới).
- Mô hình đã viết luôn 149 câu nên đã biết nhãn ý định của Writer. Điều này vi phạm mục "Không dùng ChatGPT/Claude/Qwen để quyết định label hộ" trong hướng dẫn.

Chỉ được dùng để: chạy thử `agreement`, kiểm tra schema, debug pipeline.
**Không** được dùng để: báo cáo inter-annotator agreement, làm gold label, hoặc huấn luyện/đánh giá classifier.

Trước khi có số liệu thật, hãy thay hai file này bằng nhãn của hai người thật làm độc lập.
