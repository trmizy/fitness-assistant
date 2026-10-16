# AI runtime schema repair

REAL HTTP/API: CloudWatch reported Prisma P2022 on /ai/ask/stream after the
full code rollout: fitness_agent_actions.updated_at did not exist. The user
observed the generic error while requesting analysis of their latest InBody.
Health-only deployment smoke did not exercise this query.

The migration Lambda was still the September 15 package. Updated that manual
maintenance function using its backed-up runtime dependencies, the current
repository schema/migrations and the transpiled migration handler. Added an
explicit read-only status operation and an explicit, narrowly named Prisma
resolve operation for the existing workflow-table baseline. Application
Lambda code, secrets and configuration were not changed during this repair.

The first status invocation reached the old handler before its replacement
completed. The old handler ignored operation and attempted migration deploy;
PostgreSQL rejected CREATE TABLE agent_workflow_sessions because it already
existed. Subsequent invocations waited for function-updated-v2 first.

Read-only inspection confirmed all 13 existing workflow-table columns,
nullability, defaults, timestamp precision, primary-key index and session index
matched 20260915120000_agent_workflow_session, with zero duplicate active
workflow groups. Marked that migration applied using prisma migrate resolve;
no existing table was dropped or recreated. Of 22 previously applied migration
checksums, 21 matched repository bytes; the agentic_fitness migration matched
the original deployed package exactly and differed from repository bytes only
by CRLF versus LF (normalized SQL identical). No history checksum was rewritten.

REAL HTTP/API: prisma migrate deploy then successfully applied:

- 20260916090000_agent_workflow_session_active_unique
- 20260916110000_adopt_personalized_service_escrow_milestones
- 20260927150000_fitness_agent_action_updated_at

Fresh read-only inspection: 26 applied migrations, zero unresolved failures,
updated_at present, zero duplicate active workflow groups. The timestamp
migration backfilled existing actions from created_at, as its SQL specifies.

TEST FIXTURE: node --test scripts/ci/ai-migrate-status.test.cjs: 3/3 passed.
Proves read-only metadata transaction, rejection of unsupported operations,
and rejection of a non-AI database before credentials or database access.

The missing-column defect is repaired. The authenticated InBody conversation
still requires user retry to establish the complete real functional outcome;
this report does not claim browser E2E or successful model generation.
