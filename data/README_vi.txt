GYM RAG DATASET (VI) - synthetic domain dataset
================================================

Muc tieu:
- Dung cho RAG tieng Viet ve gym, fitness, nutrition va workout planning.
- Dung cho retrieval evaluation, prompt policy tests va instruction examples.
- Khong phai bo du lieu fine-tune dang duoc train trong repo hien tai.

File nen index truc tiep cho RAG:
1. data/catalog/rag/gym_rag_master_dataset.csv
2. data/catalog/qa/gym_faq_qa.csv
3. data/catalog/qa/gym_health_guidance.csv
4. data/catalog/plans/gym_exercises.csv
5. data/catalog/plans/gym_workout_plans.csv + data/catalog/plans/gym_workout_plan_days.csv
6. data/catalog/nutrition/gym_meal_plans.csv + data/catalog/nutrition/gym_foods.csv

File huu ich cho retrieval/eval:
- data/catalog/rag/gym_queries.csv
- data/catalog/rag/gym_instruction_tuning_pairs.csv
- data/catalog/meta/manifest.csv

Ghi chu ve instruction examples:
- data/catalog/rag/gym_instruction_tuning_pairs.csv la cac cap prompt-response co the dung cho evaluation, regression tests, prompt examples hoac future fine-tuning research.
- Repo hien tai khong co pipeline LoRA/QLoRA/Transformers va khong fine-tune model weights.

File dau vao cho AI ingest (Qdrant):
- data/processed/rag/exercises.csv
- data/catalog/rag/gym_rag_master_dataset.csv
- data/catalog/qa/gym_faq_qa.csv
- data/processed/evidence/*.jsonl

So do thu muc data:
- data/raw: du lieu tho
- data/processed/rag: du lieu da xu ly de ingest
- data/processed/evidence: evidence chunks da xu ly cho fitness_evidence
- data/catalog: du lieu domain da phan nhom theo muc dich
- data/eval/retrieval: ground truth cho retrieval
- data/eval/model: ket qua danh gia model/response

Luu y quan trong:
- Day la bo du lieu tong hop (synthetic) duoc tao tu tri thuc mien gym/fitness pho thong.
- Macro thuc pham la xap xi.
- Cac muc lien quan dau, chan thuong, benh ly chi mang tinh giao duc; can safety guard trong production.
- Khi dua vao RAG, nen chunk theo doc_id hoac title_vi + content_vi; luu tags va metadata_json lam metadata vector.

Khuyen nghi schema cho vector DB:
- id = doc_id hoac row id on dinh
- text = title_vi + "\n" + content_vi
- metadata = doc_type, category, subcategory, tags, metadata_json

Tong so hang:
- master_dataset: 7072
- faq_qa: 5946
- queries: 25220
- instruction_examples: 25220
- exercises: 205
- foods: 149
- workout_plans: 57
- meal_plans: 120

Goi y pipeline:
1. Lam sach / normalize dau cau
2. Index data/catalog/rag/gym_rag_master_dataset.csv vao vector store
3. Index data/catalog/qa/gym_faq_qa.csv vao vector store
4. Index data/processed/evidence/*.jsonl vao fitness_evidence
5. Dung data/eval/retrieval/*.csv de test hit@k, recall@k va MRR
