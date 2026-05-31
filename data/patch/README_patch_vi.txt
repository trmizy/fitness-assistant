Bộ patch này bổ sung cho dataset gym RAG hiện có.

Mục tiêu:
- Sửa hành vi trả lời quá chung chung
- Tăng khả năng trả lời cụ thể theo số buổi tập/tuần
- Khóa quy tắc bilingual: câu Việt + gym terms tiếng Anh
- Thêm rule cho safety, InBody/personalization, output dạng bảng
- Thêm các template workout/meal có cấu trúc rõ ràng

File chính:
- gym_rag_patch_master_dataset.csv: file master để index vào vector DB
- bilingual_glossary_terms.csv: glossary khóa thuật ngữ gym
- intent_policies.csv: policy theo intent
- safety_rules.csv: rule an toàn
- user_profile_fields.csv: các field cần thu thập
- inbody_interpretation_rules.csv: rule đọc InBody đơn giản
- workout_split_templates.csv + workout_day_details.csv: template plan tập
- nutrition_rules.csv + meal_plan_templates_structured.csv: rule ăn uống
- corrected_response_pairs.csv: case sai -> hành vi đúng
- rag_eval_queries.csv: tập test retrieval/answer
- system_prompt_bilingual_vi_en.txt: prompt hệ thống
- router_prompt_intent.txt: prompt route intent

Gợi ý dùng:
1. Index file gym_rag_patch_master_dataset.csv cùng với master cũ.
2. Với retriever metadata-aware, ưu tiên category assistant_behavior, workout_plan, safety khi câu hỏi mang tính planning.
3. Dùng system_prompt_bilingual_vi_en.txt làm system prompt gốc.
4. Dùng router_prompt_intent.txt cho bước intent classification trước khi build answer prompt.
5. Nếu có rule engine, map user profile và InBody trước rồi mới gọi LLM.
