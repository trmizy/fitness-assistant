GYM RAG DATASET (VI) - synthetic domain dataset
================================================

Mục tiêu:
- Dùng cho RAG tiếng Việt về gym/fitness/nutrition/workout planning.
- Có thể dùng một phần cho instruction-tuning / evaluation.

File nên index trực tiếp cho RAG:
1. data/catalog/rag/gym_rag_master_dataset.csv
2. data/catalog/qa/gym_faq_qa.csv
3. data/catalog/qa/gym_health_guidance.csv
4. data/catalog/plans/gym_exercises.csv
5. data/catalog/plans/gym_workout_plans.csv + data/catalog/plans/gym_workout_plan_days.csv
6. data/catalog/nutrition/gym_meal_plans.csv + data/catalog/nutrition/gym_foods.csv

File hữu ích cho retrieval/eval:
- data/catalog/rag/gym_queries.csv
- data/catalog/meta/manifest.csv

File hữu ích cho supervised fine-tuning:
- data/catalog/rag/gym_instruction_tuning_pairs.csv

File đầu vào cho AI ingest (Qdrant):
- data/processed/rag/exercises.csv

So đồ thư mục data (moi):
- data/raw: du lieu tho
- data/processed/rag: du lieu da xu ly de ingest
- data/catalog: du lieu domain da phan nhom theo muc dich
- data/eval/retrieval: ground truth cho retrieval
- data/eval/model: ket qua danh gia model

Lưu ý quan trọng:
- Đây là bộ dữ liệu tổng hợp (synthetic) được tạo từ tri thức miền gym/fitness phổ thông.
- Macro thực phẩm là xấp xỉ.
- Các mục liên quan đau, chấn thương, bệnh lý chỉ mang tính giáo dục; cần thêm lớp an toàn trong production.
- Khi đưa vào RAG, nên chunk theo doc_id hoặc title_vi + content_vi; lưu tags và metadata_json làm metadata vector.

Khuyến nghị schema cho vector DB:
- id = doc_id
- text = title_vi + "\n" + content_vi
- metadata = doc_type, category, subcategory, tags, metadata_json

Tổng số hàng:
- master_dataset: 7072
- faq_qa: 5946
- queries: 25220
- instruction_tuning_pairs: 25220
- exercises: 205
- foods: 149
- workout_plans: 57
- meal_plans: 120

Gợi ý pipeline:
1. Làm sạch / normalize dấu câu
2. Index data/catalog/rag/gym_rag_master_dataset.csv vào vector store
3. Dùng data/catalog/rag/gym_queries.csv để test recall@k
4. Nếu muốn fine-tune, dùng data/catalog/rag/gym_instruction_tuning_pairs.csv