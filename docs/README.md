# Fitness Assistant documentation

Updated 2026-09-07. Use the topic guides below; session reports and duplicate
roadmaps have been retired. Current code, migrations, package scripts and
`.env.example` take precedence over historical text.

## Start here

- [Fitness Assistant](../README.md)
- [Work remaining and documentation policy](STATUS.md)
- [Nutrition — architecture and continuation](nutrition.md)
- [Development Setup](setup/README.md)
- [Docker Test Environment](../docker/test/README.md)

## Operations and architecture

- [AI Service Operations](ai-service-operations.md)
- [AI Fitness Assistant: RAG Architecture](ai-rag-architecture.md)
- [Database Architecture - Fitness Assistant](setup/DATABASE_ARCHITECTURE.md)
- [AWS deployment runbook — dev](aws-deployment/AWS_DEPLOYMENT_RUNBOOK.md)
- [Realtime Socket.IO Architecture](realtime-socket-architecture.md)
- [Ứng dụng di động (Capacitor) — tài liệu bàn giao](mobile-capacitor.md)

## Business rules and training

- [Dòng tiền — hợp đồng PT, gói hội viên, ví hai ngăn](money-flow.md)
- [Lịch rảnh, dời lịch hai phía, tìm kiếm và ưu tiên PT](pt-scheduling-and-discovery.md)
- [Session Feedback, PT/Coach Mode & Plan Marketplace — Audit + Design](SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md)
- [Training Progression Architecture — Target Design](TRAINING_PROGRESSION_ARCHITECTURE.md)
- [Body State & Adaptive Planning](body-state-and-adaptive-planning.md)
- [Đánh giá chu kỳ tập luyện và điều chỉnh lịch tập thích ứng (Adaptive Training Cycle Evaluation)](adaptive-training-cycle-evaluation.md)
- [Use Case & Test Case — Chức năng Chu kỳ tập luyện (Training Cycle)](training-cycle-usecases-and-testcases.md)

## Design and provenance referenced by source code

These records are retained because code, tests, migrations, or data provenance
refer to them. Their original status claims are historical, not a current backlog.
Use [STATUS](STATUS.md) for follow-ups.

- [CLOUDCODE_IMPLEMENTATION_AUDIT.md](CLOUDCODE_IMPLEMENTATION_AUDIT.md)
- [Rà soát câu hỏi "dạo đầu" — Onboarding Wizard & Intake Form](ONBOARDING_INTAKE_QUESTIONNAIRE_REVIEW.md)
- [Onboarding + PT Intake + Safety — Redesign (Design Record)](ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md)
- [openGym P0 Closure Report](OPENGYM_FINAL_P0_CLOSURE_REPORT.md)
- [openGym P0 Completion Pass — Final Report](OPENGYM_P0_COMPLETION_REPORT.md)
- [openGym Research — Sources](OPENGYM_RESEARCH_SOURCES.md)
- [openGym vs Fitness Assistant — Gap Analysis (Workout/Training Domain)](OPENGYM_VS_FITNESS_ASSISTANT_GAP_ANALYSIS.md)
- [Open Gym Roadmap Closure](OPEN_GYM_ROADMAP_CLOSURE.md)
- [Training Cycle Decision Engine — Đề xuất nâng cấp](TRAINING_CYCLE_DECISION_ENGINE.md)
- [Training Knowledge Base Plan — Nguồn dữ liệu & Schema](TRAINING_KNOWLEDGE_BASE_PLAN.md)
- [User-Level Personalization Plan — 4 nhóm người dùng](USER_LEVEL_PERSONALIZATION_PLAN.md)
- [Advanced Set-Logging (Professional-Athlete Persona)](advanced-set-logging.md)
- [Exercise & Nutrition Data — Impact Map](audit/exercise-nutrition-data-impact-map.md)
- [Audit — Flow AI dinh dưỡng hiện tại (12 câu hỏi)](audit/nutrition-ai-current-flow-audit.md)
- [04 — Backend migration plan](aws-deployment/04-backend-migration-plan.md)
- [Active-Workout Offline Resilience — Impact Analysis](features/ACTIVE_WORKOUT_OFFLINE_RESILIENCE_IMPACT_ANALYSIS.md)
- [Activity Heatmap — Impact Analysis](features/ACTIVITY_HEATMAP_IMPACT_ANALYSIS.md)
- [Canonical Import Framework + Hevy Import — Impact Analysis](features/CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md)
- [Catalog Quality Matrix — Impact Analysis](features/CATALOG_QUALITY_MATRIX_IMPACT_ANALYSIS.md)
- [Custom Exercises — Impact Analysis](features/CUSTOM_EXERCISES_IMPACT_ANALYSIS.md)
- [Exercise History Detail Page — Impact Analysis](features/EXERCISE_HISTORY_DETAIL_IMPACT_ANALYSIS.md)
- [Exercise Progress Charts — Impact Analysis](features/EXERCISE_PROGRESS_CHARTS_IMPACT_ANALYSIS.md)
- [FitNotes Import — Impact Analysis](features/FITNOTES_IMPORT_IMPACT_ANALYSIS.md)
- [GYMINI PHOSPHOR ICON MIGRATION REPORT](features/GYMINI_PHOSPHOR_ICON_MIGRATION_REPORT.md)
- [InBody Scan Extraction — Local Vision Model Migration](features/INBODY_LOCAL_VISION_MIGRATION.md)
- [JSON / CSV Export — Impact Analysis](features/JSON_CSV_EXPORT_IMPACT_ANALYSIS.md)
- [Muscle Heatmap — Impact Analysis](features/MUSCLE_HEATMAP_IMPACT_ANALYSIS.md)
- [Notifications/Reminders — Impact Analysis](features/NOTIFICATIONS_REMINDERS_IMPACT_ANALYSIS.md)
- [Planned vs Actual Training Volume — Impact Analysis](features/PLANNED_VS_ACTUAL_VOLUME_IMPACT_ANALYSIS.md)
- [Product Completeness Pass — Impact Analysis](features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md)
- [Reschedule Workout — Impact Analysis](features/RESCHEDULE_WORKOUT_IMPACT_ANALYSIS.md)
- [True Set-by-Set Table UI — Impact Analysis](features/SET_BY_SET_TABLE_UI_IMPACT_ANALYSIS.md)
- [Strong Import — Impact Analysis](features/STRONG_IMPORT_IMPACT_ANALYSIS.md)
- [Superset / Exercise Grouping — Impact Analysis](features/SUPERSET_GROUPING_IMPACT_ANALYSIS.md)
- [Training Consistency and Adherence — Impact Analysis](features/TRAINING_CONSISTENCY_ADHERENCE_IMPACT_ANALYSIS.md)
- [Undo Last Set — Impact Analysis](features/UNDO_LAST_SET_IMPACT_ANALYSIS.md)
- [User Service — AWS Lambda Deployment Prep — Impact Analysis](features/USER_SERVICE_LAMBDA_IMPACT_ANALYSIS.md)
- [Workout Template Sharing/Import — Impact Analysis](features/WORKOUT_TEMPLATE_SHARING_IMPACT_ANALYSIS.md)
- [Nghiên cứu khoa học tập luyện & dinh dưỡng — nền tảng cho các tính năng gym/fitness](gym-fitness-research.md)
- [Báo cáo — Sửa 2 lỗi thật Persona B/C, đưa `24-ai-nutrition-persona-b-c.spec.ts` về xanh](nutrition-persona-testing-and-bugfixes-2026-08-20.md)
- [Checkpoint: Production-Hardening Pass — Chức năng Tập luyện](production-hardening-checkpoint.md)
- [Fitness & Nutrition Data Source and License Review](research/fitness-data-source-and-license-review.md)
- [Fitness & Nutrition Evidence Registry](research/fitness-nutrition-evidence.md)
- [Nutrition AI — Product & Expert Review](research/nutrition-ai-product-and-expert-review.md)
- [Vòng 4 — Tài liệu bàn giao](vong-4.md)
- [Workout Log Audit](workout-log-audit.md)

## Component guides

- [Fitness Assistant Web](../frontend/web/README.md)
- [n8n Workflow Orchestration](../infra/n8n/README.md)
- [Terraform bootstrap](../infra/terraform/bootstrap/README.md)
- [Fitness Assistant AWS dev environment](../infra/terraform/environments/dev/README.md)
- [Dataset Integration — AI Service](../backend/services/ai-service/DATASETS.md)
- [Optional Coach Fine-Tuning Pipeline](../training/README.md)
- [RunPod Launch Runbook — QLoRA Fine-Tune](../training/RUNPOD_RUNBOOK.md)

## Maintenance

Update the existing topic guide instead of adding a session report. Keep active
follow-ups in [STATUS](STATUS.md). Local backup and Git recovery are documented
there. Scientific references, license/attribution files, runtime prompts and
component runbooks are not disposable QA output.
