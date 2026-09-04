# Fitness Assistant Documentation

This index separates current operational documentation from design proposals
and historical reports. When documentation disagrees with executable code, use
this precedence order:

1. `infra/compose/docker-compose.dev.yml` and package scripts
2. `.env.example` and service-level `.env.example` files
3. current architecture and operations guides listed below
4. audits, plans, roadmaps, and implementation reports

## Start Here

| Document | Purpose | Status |
| --- | --- | --- |
| [Root README](../README.md) | Product overview, architecture, quick start, portfolio entry point | Current |
| [Development setup](setup/README.md) | Windows, Ollama, Docker, profiles, health checks, troubleshooting | Canonical |
| [AI operations](ai-service-operations.md) | AI runtime, models, RAG, health, ingestion, diagnostics | Canonical |
| [AI RAG architecture](ai-rag-architecture.md) | Retrieval boundaries, collections, safety, evaluation | Current |
| [Database architecture](setup/DATABASE_ARCHITECTURE.md) | Database ownership and service boundaries | Current reference |
| [Database inspection](setup/DB_INSPECTION_COMMANDS.md) | Read-only database inspection commands | Current reference |
| [Database schema guide](setup/DB_FULL_SCHEMA_GUIDE.md) | Detailed schema inventory | Reference; verify against Prisma |

## Product And Training

| Document | Purpose | Status |
| --- | --- | --- |
| [Adaptive training cycle](adaptive-training-cycle-evaluation.md) | Current adaptive evaluation flow | Current |
| [Training-cycle use cases](training-cycle-usecases-and-testcases.md) | Functional scenarios and acceptance cases | Current reference |
| [Advanced set logging](advanced-set-logging.md) | Set-level logging design and behavior | Current reference |
| [Workout log QA](workout-log-qa.md) | Manual QA checklist | Current |
| [Workout log audit](workout-log-audit.md) | Investigation record behind workout-log work | Historical audit |
| [Realtime sockets](realtime-socket-architecture.md) | Chat and notification realtime flow | Current reference |
| [Session feedback and PT plan audit](SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md) | Design baseline for in-progress feedback/PT work | Active design record |

The following files preserve earlier design reasoning. They are not setup
instructions and may describe gaps that were later closed:

- [Training cycle v2](training-cycle-v2.md)
- [Training Cycle Decision Engine](TRAINING_CYCLE_DECISION_ENGINE.md)
- [User-level personalization plan](USER_LEVEL_PERSONALIZATION_PLAN.md)
- [Training knowledge-base plan](TRAINING_KNOWLEDGE_BASE_PLAN.md)
- [Adaptive cycle research](adaptive-training-cycle-evaluation.md)

## AI And Knowledge

| Document | Purpose | Status |
| --- | --- | --- |
| [AI plan evidence](ai-plan-evidence.md) | Evidence contract used by plan generation | Current |
| [Knowledge automation](ai-knowledge-automation.md) | Controlled research refresh and review queue | Current |
| [AI chat performance audit](ai-chat-performance-audit.md) | Latency paths, fallback behavior, diagnostics | Current audit |
| [AI service flow](report/AI_SERVICE_FLOW.md) | Code-path inventory | Reference; verify routes against code |
| [RAG layered refactor report](report/RAG_LAYERED_REFACTOR_REPORT.md) | Refactor outcome | Historical report |
| [Dataset integration](../backend/services/ai-service/DATASETS.md) | Dataset sources and ingestion roles | Current |
| [Gym and fitness research](gym-fitness-research.md) | Domain research notes | Research reference |

The large architecture proposal
[`ai_gym_assistant_kien_truc_pipeline.md`](ai_gym_assistant_kien_truc_pipeline.md)
and prompt collection [`codex_prompts_gym_ai.md`](codex_prompts_gym_ai.md) are
research artifacts. They are intentionally retained, but they do not define the
runtime contract.

## Quality And Reports

These documents capture a point in time. Treat checked boxes and service counts
as historical evidence, not as a substitute for running the current tests.

- [Project roadmap and issue tracker](../PROJECT_ROADMAP.md)
- [Project audit](project-audit-report.md)
- [Fitness data and feature audit](FITNESS_APP_DATA_AND_FEATURE_AUDIT.md)
- [CloudCode implementation audit](CLOUDCODE_IMPLEMENTATION_AUDIT.md)
- [Production hardening checkpoint](production-hardening-checkpoint.md)
- [Phase 13 production hardening report](PHASE_13_PRODUCTION_HARDENING_REPORT.md)

## Component Documentation

- [Web client](../frontend/web/README.md)
- [Mobile client](../apps/mobile/README.md)
- [Mobile API map](../apps/mobile/API_MAP.md)
- [Mobile known limitations](../apps/mobile/BLOCKED.md)
- [n8n integration](../infra/n8n/README.md)
- [Docker test environment](../docker/test/README.md)
- [Playwright E2E handoff](../fitnessassistant-playwright-e2e/AGENT_HANDOFF.md)
- [InBody local vision extraction](features/INBODY_LOCAL_VISION_MIGRATION.md) — the live path (`inbody-vision.service.ts`, Ollama vision model by default). The `inbody_extractor/` Python folder linked here previously is dead code (Tesseract OCR prototype, never wired into the running service) — not the real pipeline.
- [Optional fine-tuning pipeline](../training/README.md)
- [RunPod training runbook](../training/RUNPOD_RUNBOOK.md)

## Documentation Rules

- Put executable setup commands in `docs/setup/README.md` only.
- Put AI runtime and RAG commands in `docs/ai-service-operations.md` only.
- Keep component-specific commands beside the component.
- Label proposals and audits with their date and implementation status.
- Never commit credentials, private health data, SSH keys, or provider secrets.
- Update this index when adding, replacing, or retiring a document.
