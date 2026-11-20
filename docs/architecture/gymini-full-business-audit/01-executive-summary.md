# 01 — Executive Summary

**Gymini Full Business Domain & AI Capability Audit.** Read-only discovery and documentation audit — no source, schema, infrastructure, or production/test data was modified. START_HEAD `003545c6` (branch `aws-deploy`). END_HEAD unchanged — this audit touched no tracked files outside `docs/architecture/gymini-full-business-audit/`.

## What this audit is, and is not

This is a **discovery and reconciliation** exercise, not an implementation project. 7 background agents performed independent, read-only structural discovery and deep code tracing across the entire monorepo (7 backend services + gateway, 2 independent frontend apps, ~218 pre-existing documentation files). Every finding below cites a file, function, or specific evidence source — this audit deliberately avoided asserting anything as "implemented" or "fixed" without a direct code citation, and marks items `UNKNOWN_INSUFFICIENT_EVIDENCE` rather than guessing wherever static reading couldn't settle a question.

## Top-level numbers

- **10 deployable applications/services** (7 backend services, 1 gateway, 2 independent frontends — `frontend/web` is Capacitor-wrapped, `frontend/mobile` is a fully separate Expo/React Native app, NOT the Capacitor shell as commonly assumed in the repo's own docs).
- **4 confirmed user roles** (CUSTOMER/PT/ADMIN/GYM_OWNER), with MANAGER confirmed to be a permission inside a GYM_OWNER account, not a separate role, and client+PT "dual capability" confirmed to work via identity-based authorization rather than a true multi-role data model.
- **14 business domains**, **101 business capabilities**, **8 major cross-domain workflows** traced in depth.
- **144 database entities** across 7 independently-owned Postgres schemas, **56 backend route files**, **~161 frontend routes/screens**, **16 background jobs**, **16 distinct AI capabilities**.
- **20 new business-domain/AI gaps found by this audit** (BDG-01..BDG-20: 0 P0, 7 P1, 9 P2, 4 P3), on top of an **independent, pre-existing 36-gap security/infra register** (G-01..G-36: 4 P0, 20 P1, 10 P2, 2 P3, verdict **NO-GO for public production**) in `docs/production-readiness/`, which this audit read in full and treats as authoritative for its scope rather than re-deriving.

## Highest-risk findings

1. **A disclosed physical limitation (e.g. leg pain) never becomes a persistent exercise-exclusion constraint anywhere in the AI chat system** (BDG-16, BDG-17, P1, health-safety-relevant). The system correctly detects and reacts to the disclosure in the moment, but nothing threads it into subsequent plan generation — not because a correction overwrites it, but because the workout-plan workflow never has a slot to capture it in the first place. **The fix pattern already exists and is proven in production for the nutrition workflow** — this is a port, not a from-scratch build.
2. **A "move this session to another day" request executes as a full plan regeneration**, discarding every other day of the existing plan (BDG-15, P1) — confirmed exactly matching a known reported symptom, with precise file:line reproduction.
3. **An AI-drafted roadmap's duration is hardcoded to 16 weeks on the chat path**, regardless of what the user said about their timeline — including an explicit "no deadline" request (BDG-18, P1). The deterministic fallback then computes `min(16,6)=6`, which is the literal mechanism behind the originally-reported "unlimited request gets a 6-week roadmap" symptom.
4. **The production-readiness security register's own P0s remain the most severe risks in the whole system** (JWT public-literal fallback, bearer tokens logged, no TLS, a destructive migration with no backup gate) — this audit did not re-investigate these (out of its own scope), but the executive summary would be incomplete without restating that they outrank every business-domain finding below in urgency.
5. **No PT-dashboard cross-client aggregate exists** (BDG-08, P2, confirmed by direct trace) — this single missing piece blocks 3 of the task's 5 priority "PT AI Copilot" use cases simultaneously (falling-behind clients, missed workouts, nutrition-target misses). It is the single highest-leverage new build identified by this audit.

## Highest-confidence positive findings (stated plainly, because they're genuinely strong)

- **PT→client authorization is robust.** Direct trace of every PT-facing authorization-gated handler confirms the client id source is always the URL path, never the request body, with a fail-closed, freshly-re-verified relationship check on every call. No path was found anywhere for a PT to reach another PT's client.
- **AI never autonomously messages a client or writes to a client's data.** Every tool in ai-service acts only on the calling user's own account; the one PT-facing AI-generation surface is confirmed draft-only.
- **The "AI is not authoritative" / proposed-vs-persisted boundary from CLAUDE.md is real in code, independently confirmed three separate times** (structural discovery, the PT-copilot agent's direct trace, and the pre-existing production-readiness audit's own grep check) — not merely a stated policy.
- **Exercise-catalog grounding is solid** across all three AI generation surfaces — no path was found that silently persists an unresolvable exercise reference.
- **Gym-partner self-onboarding is the single most mature workflow found** — independently confirmed robust from three discovery angles (web, mobile, backend) with zero contradictions.

## Audit limitations (stated per task requirements)

- No live/runtime testing was performed; all findings are `CODE_INSPECTION` unless a cited source says otherwise. Several items are explicitly marked `UNKNOWN_INSUFFICIENT_EVIDENCE` or `NOT_VERIFIED_FROM_STATIC_READING` rather than guessed (10 items listed in `14-audit-coverage-and-evidence-manifest.md`).
- This audit did not re-verify the 36 pre-existing security/infra gaps in `docs/production-readiness/` — it read that package in full, cross-checked a handful of its architectural claims against current code (all confirmed accurate), and treats it as authoritative for its own scope rather than duplicating it.
- One area of the codebase (`bedrock.client.ts`/`bedrock-credentials.ts`) is **currently being actively edited by a different concurrent agent session** fixing a real production Bedrock-access blocker; this audit read those files for inventory only and explicitly flags that neither this audit nor the AI-capability findings about the Bedrock provider path should be read as a final verdict while that work is in flight.
- A full line-by-line enumeration of every individual HTTP method+path (beyond the 56 route-file/group level) was not attempted — scoped out as lower-value relative to effort for a business-domain audit.

## Verdicts (per task §35)

- **Audit verdict**: `BUSINESS_AUDIT_PARTIAL_WITH_KNOWN_GAPS`
- **AI business coverage verdict**: `AI_BUSINESS_COVERAGE_MAPPED`
- **Prioritization readiness verdict**: `READY_FOR_BUSINESS_GAP_PRIORITIZATION`

## Where to go next

- For the full gap list with evidence: `10-business-gap-register.md` (this audit) + `docs/production-readiness/15-production-gap-register.md` (pre-existing, security/infra).
- For the recommended phased roadmap and the "one platform vs. many agents" architecture question: `13-business-first-ai-development-roadmap.md` (recommendation: **bounded hybrid — keep the current architecture**, grounded in this audit's own evidence, not fashion).
- For exact numeric coverage and explicitly unresolved items: `14-audit-coverage-and-evidence-manifest.md`.
- Machine-readable: `capabilities.json`, `roles-and-permissions.json`, `workflows.json`, `ai-integrations.json`, `gaps.json`, `tests-and-invariants.json`, `coverage-manifest.json`.
- Full phase-by-phase process record (for anyone resuming or auditing this audit itself): `AUDIT_PROGRESS.md`.
