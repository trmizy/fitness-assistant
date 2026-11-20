# 14 — Audit Coverage & Evidence Manifest

All counts below are derived from the structural-discovery agents' direct enumeration (Phase 1-3, see `AUDIT_PROGRESS.md`) — they are **manual/agent counts from reading source**, not output of an automated script, so treat them as accurate-to-the-evidence-gathered rather than machine-exact. Where a count could not be derived with confidence, it is marked `NOT_COUNTED` rather than guessed.

## Coverage Completeness Gate (task §28) — self-answered

1. Have all frontend routes been mapped to business capabilities or classified as technical/utility? **Yes** — web (~80 routes/aliases) and mobile (~81 screens) both fully enumerated by dedicated agents; dev-only and infra routes explicitly separated out.
2. Have all backend API groups been mapped? **Yes at the route-file/group level** (56 route files across 7 services + gateway proxy groups); **not at the level of every individual HTTP method+path** (that would be several hundred entries — not attempted, would need a dedicated enumeration pass if required).
3. Have all major database models been mapped? **Yes** — 144 Prisma models across 7 services, each assigned an owning service.
4. Have all role-specific interfaces been examined? **Yes** — 4 roles × web × mobile × backend authorization = fully cross-checked with no contradictions found.
5. Have all domain service groups been classified? **Yes** — 14 business domains (DOM-01..DOM-14), including one genuinely new discovered domain (Gym Management/Partner Portal) not in the task's own candidate list.
6. Have all AI entry points been mapped? **Yes at the capability level** (16 distinct AI capabilities/flags); the underlying ~25+ agent tools in `fitness-agent-tools.ts` were enumerated by category, not individually line-itemized.
7. Have all side-effecting workflows been identified? **Partially** — 8 major cross-domain workflows traced in depth (`04-business-workflow-catalog.md`); narrower single-domain CRUD workflows (e.g. "edit a food log entry") were not individually traced, as they're adequately covered by the domain inventory's capability-level status.
8. Have all existing feature flags been inventoried? **Yes** — ~15 flags found and classified (`06-ai-capability-and-integration-audit.md` §2-3, `05-...` §7), cross-checked against actual prod-compose defaults via the independent production-readiness audit.
9. Have all background/event-driven workflows been considered? **Yes** — 16 background jobs/sweeps/queues enumerated across all 7 services.
10. Have all major integrations been categorized? **Yes** — LLM providers (4), vector stores (2), payment providers (5, one enum-only), AWS services (S3, Lambda, Secrets Manager, SQS, DynamoDB, SES via nodemailer), socket.io, WebRTC, Dropbox Sign.
11. Have all PT-client workflows been examined? **Yes, in depth** — dedicated deep-dive agent, authorization fully traced, 5 priority copilot use cases individually assessed.
12. Have every observed business domain's core flows been traced? **Yes for the 8 cataloged cross-domain workflows and all 14 domains' capability lists**; single-domain CRUD flows within a domain were assessed at capability-status granularity, not full 14-stage lifecycle granularity, except where a known-failure case required it.
13. Have all major gaps been supported with evidence? **Yes** — every one of the 20 business-domain gaps (BDG-01..BDG-20) plus the 36 external gaps (G-01..G-36) cites a specific file/function/finding mechanism, not a general impression.
14. Have uncertain/missing sources been explicitly recorded? **Yes** — see §3 below, "Explicitly unresolved items."

## Numeric coverage

| Metric | Count | Denominator basis |
|---|---|---|
| Deployable backend services + gateway | 8 | `backend/services/*` (7) + `backend/gateway` (1) |
| Deployable frontend applications | 2 | `frontend/web` (Capacitor-wrapped), `frontend/mobile` (independent Expo/RN) |
| Total deployable applications/services | 10 | sum of above |
| Confirmed user roles | 4 | CUSTOMER/PT/ADMIN/GYM_OWNER (auth-service enum); 1 historically-removed role (GYM_STAFF) noted separately; MANAGER confirmed a permission, not a role |
| Confirmed business domains | 14 | DOM-01 through DOM-14 in `02-business-domain-inventory.md` |
| Business capabilities discovered | ~101 | sum of CAP- rows across all 14 domains |
| Major end-to-end cross-domain workflows traced | 8 | WF-01 through WF-08 in `04-business-workflow-catalog.md` |
| Distinct AI capabilities/flags classified | 16 | `06-ai-capability-and-integration-audit.md` §2 table |
| Backend route files classified | 56 | Phase 1 backend-structural agent (auth 2, user 15, fitness 14, gym 6, payment 6, chat 2, ai 11) |
| Gateway proxy path-prefix groups | ~7 service-level groups, ~90 individual proxy registrations | Phase 1 backend-structural agent |
| Frontend routes/screens classified | ~161 | web ~80 + mobile ~81 |
| Authoritative database entities (Prisma models) classified | 144 | auth 7, user-service 24, fitness-service 50, gym-service 25, payment-service 8, chat-service 4, ai-service 26 |
| Background jobs/scheduled integrations classified | 16 | across all 7 services, see `05-frontend-backend-database-coverage.md` §4 |
| Pre-existing documentation files categorized | ~218 | 23 repo-root `.md` + 183 flat `docs/*.md` + ~12 in small subdirs (excludes the 3 large clusters counted separately) |
| Large doc clusters identified but treated as a group, not individually read | 3 (`deployment/` 71, `ai-training/` 30, `ai-product/` 30) | explicitly out of individual-file scope per the docs-corpus agent's own recommendation |

## Business capability completeness breakdown (from `capabilities.json`)

| Status | Approx. count |
|---|---|
| IMPLEMENTED_AND_VERIFIED | ~48 |
| IMPLEMENTED_NOT_RUNTIME_VERIFIED | ~14 |
| PARTIALLY_IMPLEMENTED | ~20 |
| PLANNED_NOT_IMPLEMENTED | ~6 |
| FEATURE_FLAGGED_OFF | 4 |
| BROKEN_OR_INCONSISTENT | 3 |
| MOCK_OR_SEED_ONLY | 1 |
| UNKNOWN_INSUFFICIENT_EVIDENCE | ~4 |

(Counts are approximate hand-tallies from `capabilities.json` at time of writing; re-derive from that file directly for an exact count if needed — it is the machine-readable source of truth for this table.)

## Explicitly unresolved items (per task §28.14 — recorded, not silently dropped)

1. Post-onboarding profile edits propagating to downstream plans (CAP-02-03) — not traced.
2. Account deletion capability — not confirmed to exist or not exist on either frontend (BDG-11).
3. Web-side query-cache clearing on logout/account-switch — not traced by this or the prior audit (BDG-12).
4. Declining a PT recommendation and getting an alternative without repeating profile (CAP-07-05, task scenario 6) — not traced.
5. Client's own explicit accept/reject step (if any) for a PT-assigned program — not traced (`04-business-workflow-catalog.md` WF-04).
6. Device-switch-while-pending-proposal behavior (task scenario 8, WF-07) — only inferred from the data model (userId+sessionId-keyed Postgres state), not confirmed at runtime.
7. `UserPreference` model's actual usage — flagged "legacy/unmapped" by the structural agent, not independently confirmed dead or alive (BDG-09).
8. Non-chat `/ai/generate-roadmap-draft` route's duration-handling (Case G caveat) — the chat path's defect is confirmed; this route's behavior is NOT_VERIFIED.
9. Exact wire-format/count of every individual HTTP method+path within each of the 56 classified route files — classified at group/file level, not individually enumerated.
10. Live execution of any of the 393 repo-wide test files — inventoried by count only, by both this and the prior audit; no suite was run.

## Verdicts

- **Audit verdict**: `BUSINESS_AUDIT_PARTIAL_WITH_KNOWN_GAPS` — the core discovery, domain inventory, role/permission matrix, AI capability map, PT-copilot audit, conversational-state/known-failure investigation, and gap register are complete and evidence-backed; the explicitly unresolved items in this section are named, not hidden, and some (workflow-catalog depth beyond the 8 cataloged workflows, a full line-by-line endpoint enumeration) were deliberately scoped out as lower-value relative to effort, consistent with this audit's own evidence-over-exhaustiveness principle.
- **AI business coverage verdict**: `AI_BUSINESS_COVERAGE_MAPPED` — every AI capability found maps to a real domain service and a stated governance state (on/off/shadow), with the proposed-vs-persisted authority boundary independently confirmed 3 separate ways.
- **Prioritization readiness verdict**: `READY_FOR_BUSINESS_GAP_PRIORITIZATION` — the gap register (20 business-domain gaps + 36 external gaps, all severity-rated with evidence) and the roadmap's explicit phase ordering are sufficient to start prioritization discussions.
