import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

/**
 * Phase 4 (PT Copilot, step 2) — POST /coach/clients/:clientId/ai-proposals/decision: the audited approve/dismiss of an AI-DRAFTED proposal.
 * REAL HTTP against the real Express app + the isolated fitness test DB (skipped, not failed, without one). Only the cross-service relationship
 * check (coachDeps) and token verification are stubbed, by the repo's convention.
 *
 * What must hold: the relationship is RE-VERIFIED at decision time (a PT who is not the client's active PT gets 403 and NOTHING is written);
 * a decision writes exactly one audit row and NO client data; the body is strictly validated.
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 90_000 };

const RUN = randomUUID().slice(0, 8);
const PT_A = `dec-pt-a-${RUN}`, PT_B = `dec-pt-b-${RUN}`, CLIENT = `dec-client-${RUN}`;
const relationships = new Set([`${PT_A}|${CLIENT}`]);
let prisma: (typeof import("../repositories/prisma"))["prisma"];
let server: import("node:http").Server | undefined;
let base = "";

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  const coach = await import("../services/coach.service");
  coach.coachDeps.isActivePtClientRelationship = async (pt: string, client: string) => relationships.has(`${pt}|${client}`);
  const { authServiceClient } = await import("../clients/auth-service.client");
  (authServiceClient as any).verifyToken = async (header: string) => {
    const map: Record<string, string> = { "pt-a": PT_A, "pt-b": PT_B };
    const token = header.replace("Bearer ", "");
    if (!map[token]) throw new Error("bad token");
    return { user: { id: map[token], email: "", role: "PT" } };
  };
  const app = (await import("../app")).default;
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server!.once("listening", r));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});
test.after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((r) => server!.close(() => r(undefined))); }
  if (!canUseIntegrationDb) return;
  await prisma.coachClientActionAudit.deleteMany({ where: { ptUserId: { in: [PT_A, PT_B] } } });
  await prisma.$disconnect();
});

const body = (over: Record<string, unknown> = {}) => ({ decision: "APPROVED", proposalId: randomUUID(), proposalTypes: ["MESSAGE_DRAFT", "PLAN_REVIEW_SUGGESTION"], basedOnCount: 2, ...over });
const post = (token: string | null, clientId: string, payload: unknown) =>
  fetch(`${base}/coach/clients/${clientId}/ai-proposals/decision`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
const auditCount = (pt: string) => prisma.coachClientActionAudit.count({ where: { ptUserId: pt, clientUserId: CLIENT, action: { in: ["AI_PROPOSAL_APPROVED", "AI_PROPOSAL_DISMISSED"] } } });
const clientDataCounts = async () => [
  await prisma.workoutSchedule.count({ where: { userId: CLIENT } }), await prisma.nutritionProgram.count({ where: { userId: CLIENT } }),
  await prisma.workoutProgram.count({ where: { userId: CLIENT } }), await prisma.nutritionGoal.count({ where: { userId: CLIENT } }),
];

test("the client's active PT: approval writes ONE audit row (no send, no client data change); dismissal likewise", skipOpts, async () => {
  const before = await clientDataCounts();
  const approved: any = body();
  const r = await post("pt-a", CLIENT, approved);
  assert.equal(r.status, 200);
  const data: any = ((await r.json()) as any).data;
  assert.deepEqual({ recorded: data.recorded, sentToClient: data.sentToClient, clientDataChanged: data.clientDataChanged, action: data.action }, { recorded: true, sentToClient: false, clientDataChanged: false, action: "AI_PROPOSAL_APPROVED" });
  const row = await prisma.coachClientActionAudit.findFirstOrThrow({ where: { ptUserId: PT_A, clientUserId: CLIENT, action: "AI_PROPOSAL_APPROVED" } });
  assert.equal((row.metadata as any).proposalId, approved.proposalId);
  assert.deepEqual((row.metadata as any).proposalTypes, ["MESSAGE_DRAFT", "PLAN_REVIEW_SUGGESTION"]);
  assert.equal((row.metadata as any).sentToClient, false);
  assert.equal((row.metadata as any).clientDataChanged, false);
  assert.equal((await post("pt-a", CLIENT, body({ decision: "DISMISSED" }))).status, 200);
  assert.equal(await auditCount(PT_A), 2);
  assert.deepEqual(await clientDataCounts(), before, "no client data was written by either decision");
});

test("re-verified at decision time: another PT, or a PT whose contract ended, gets 403 and NOTHING is written", skipOpts, async () => {
  const before = await auditCount(PT_B);
  assert.equal((await post("pt-b", CLIENT, body())).status, 403, "PT B is not this client's PT");
  assert.equal(await auditCount(PT_B), before);
  relationships.delete(`${PT_A}|${CLIENT}`);
  try {
    const a = await auditCount(PT_A);
    assert.equal((await post("pt-a", CLIENT, body())).status, 403, "the contract ended after the proposal was drafted");
    assert.equal(await auditCount(PT_A), a);
  } finally { relationships.add(`${PT_A}|${CLIENT}`); }
});

test("strict validation: unknown decision/type, empty or oversized lists, missing ids -> 400; no token -> 401", skipOpts, async () => {
  for (const bad of [
    body({ decision: "SENT" }), body({ proposalTypes: [] }), body({ proposalTypes: ["SEND_MESSAGE"] }), body({ proposalTypes: Array(7).fill("MESSAGE_DRAFT") }),
    body({ basedOnCount: -1 }), body({ basedOnCount: 999 }), body({ proposalId: "" }), body({ proposalId: "x".repeat(65) }), {},
  ]) assert.equal((await post("pt-a", CLIENT, bad)).status, 400, JSON.stringify(bad).slice(0, 70));
  assert.equal((await post(null, CLIENT, body())).status, 401);
  assert.equal((await post("bad", CLIENT, body())).status, 401);
});
