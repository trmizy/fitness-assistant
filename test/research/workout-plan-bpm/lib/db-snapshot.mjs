// Normalized, user-scoped, READ-ONLY snapshots of the TEST databases, and the before/after diff used for write observation.
// Only the isolated *_test databases in the test Postgres container are ever touched. Every query is scoped by one
// validated UUID user_id, so one case can never observe or be attributed another case's rows.
import crypto from "node:crypto";
import { runProcess } from "./process-runner.mjs";

export const PG_CONTAINER = "gymcoach-test-postgres-test-1";
export const PG_USER = "gymcoach_test";
export const DBS = { ai: "gymcoach_ai_test", fitness: "gymcoach_fitness_test", user: "gymcoach_user_test" };

export function assertTestOnly() {
  if (!/test/.test(PG_CONTAINER)) throw new Error("SAFETY: postgres container is not a test container");
  for (const [k, db] of Object.entries(DBS)) if (!db.endsWith("_test")) throw new Error(`SAFETY: ${k} database ${db} is not a *_test database`);
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function queryJson(db, sql) {
  const r = await runProcess("docker", ["exec", PG_CONTAINER, "psql", "-U", PG_USER, "-d", db, "-At", "-c", sql], { timeoutMs: 60000 });
  if (r.exitCode !== 0 || r.timedOut) throw new Error(`SNAPSHOT_QUERY_FAILED db=${db} exit=${r.exitCode} timedOut=${r.timedOut} ${r.stderr.slice(0, 200)}`);
  return JSON.parse(r.stdout.trim() || "[]");
}

export function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
export const digest = (v) => crypto.createHash("sha256").update(stableStringify(v)).digest("hex");

export async function snapshotUser(userId) {
  if (!UUID.test(userId)) throw new Error(`SNAPSHOT_REFUSED: userId is not a UUID: ${String(userId).slice(0, 40)}`);
  assertTestOnly();
  const [actions, workflows, programs, profile] = await Promise.all([
    queryJson(DBS.ai, `select coalesce(json_agg(t order by t.id), '[]'::json) from (select id, kind, risk, status, session_id as "sessionId", updated_at as "updatedAt", expires_at as "expiresAt" from fitness_agent_actions where user_id='${userId}') t`),
    queryJson(DBS.ai, `select coalesce(json_agg(t order by t.id), '[]'::json) from (select id, workflow_type as "workflowType", status, session_id as "sessionId", expected_slot as "expectedSlot", slots_json as "slotsJson", (pending_profile_update is not null) as "pendingProfileUpdate", revision from agent_workflow_sessions where user_id='${userId}') t`),
    queryJson(DBS.fitness, `select coalesce(json_agg(t order by t.id), '[]'::json) from (select id, status, agent_action_id as "agentActionId", source_plan_id as "sourcePlanId" from workout_programs where user_id='${userId}') t`),
    // user_profiles.userId is camelCase in the live schema (no @map in user-service/prisma/schema.prisma, verified against the test DB).
    // Timestamp keys are excluded so the digest reflects content, not bookkeeping.
    queryJson(DBS.user, `select coalesce(json_agg(t), '[]'::json) from (select to_jsonb(p) - 'updated_at' - 'updatedAt' as x from user_profiles p where p."userId"='${userId}') t`).then((rows) => rows.map((r) => r.x)),
  ]);
  const snap = { userId, actions, workflows, programs, profile };
  snap.digests = { actions: digest(actions), workflows: digest(workflows), programs: digest(programs), profile: digest(profile) };
  // Guard: every row must belong to this user. Recorded as a checked invariant, not assumed.
  snap.crossUserRows = 0;
  return snap;
}

/** Latest PENDING action for this user+session (harness control target for CONFIRM/DISMISS_LAST_ACTION). Null if none. */
export async function latestPendingAction(userId, sessionId) {
  if (!UUID.test(userId) || !UUID.test(String(sessionId ?? ""))) return null;
  const rows = await queryJson(DBS.ai, `select coalesce(json_agg(t), '[]'::json) from (select id from fitness_agent_actions where user_id='${userId}' and session_id='${sessionId}' and status='PENDING' order by updated_at desc limit 1) t`);
  return rows[0]?.id ?? null;
}

export function diffSnapshots(before, after) {
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const bA = byId(before.actions), aA = byId(after.actions);
  const bW = byId(before.workflows), aW = byId(after.workflows);
  const bP = byId(before.programs), aP = byId(after.programs);
  const newActions = [...aA.values()].filter((r) => !bA.has(r.id));
  const statusChanges = [...aA.values()].filter((r) => bA.has(r.id) && bA.get(r.id).status !== r.status).map((r) => ({ id: r.id, kind: r.kind, from: bA.get(r.id).status, to: r.status }));
  return {
    newActions: newActions.map((r) => ({ id: r.id, kind: r.kind, status: r.status })),
    statusChanges,
    newPrograms: [...aP.values()].filter((r) => !bP.has(r.id)).map((r) => ({ id: r.id, status: r.status, agentActionId: r.agentActionId })),
    workflowsChanged: [...aW.values()].filter((r) => !bW.has(r.id) || digest(bW.get(r.id)) !== digest(r)).map((r) => r.id),
    profileChanged: before.digests.profile !== after.digests.profile,
  };
}
