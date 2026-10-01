/**
 * GAP-23: the call-log message ("Video call ended (m:ss)") measured endedAt − startedAt, but nothing
 * ever wrote startedAt, so every call logged 0:00. Clients now send `call:connected` when their
 * RTCPeerConnection reaches "connected"; callService.markConnected stamps startedAt on the FIRST
 * report only. These tests pin that down against a real CallSession row in the test database.
 *
 * Run with (from backend/services/chat-service):
 *   CHAT_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_chat_test" \
 *     npx tsx --test src/__tests__/call-connected.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

const chatDatabaseUrl = process.env.CHAT_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /_test/i.test(chatDatabaseUrl);

if (process.env.CHAT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.CHAT_DATABASE_URL;
}

const skipOpts = {
  skip: canUseIntegrationDb ? false : "Requires CHAT_DATABASE_URL pointing at a *_test database.",
};

type CallServiceLike = (typeof import("../services/call.service"))["callService"];
type PrismaClientLike = (typeof import("../repositories/chat.repository"))["prisma"];

let callService: CallServiceLike | undefined;
let prisma: PrismaClientLike | undefined;

async function loadModules() {
  if (!callService) {
    callService = (await import("../services/call.service")).callService;
    prisma = (await import("../repositories/chat.repository")).prisma;
  }
  return { callService: callService!, prisma: prisma! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function withCall(
  status: "ACCEPTED" | "CONNECTING" | "ACTIVE" | "ENDED" | "RINGING",
  run: (ids: { id: string; callerId: string; calleeId: string }) => Promise<void>,
) {
  const { prisma: db } = await loadModules();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const callerId = `caller-${stamp}`;
  const calleeId = `callee-${stamp}`;
  const call = await db.callSession.create({
    data: { callerId, calleeId, callType: "VIDEO", origin: "CHAT", status },
  });
  try {
    await run({ id: call.id, callerId, calleeId });
  } finally {
    await db.callSession.delete({ where: { id: call.id } });
  }
}

test("first call:connected stamps startedAt and moves the call to ACTIVE", skipOpts, async () => {
  const { callService: service, prisma: db } = await loadModules();
  await withCall("CONNECTING", async ({ id, calleeId }) => {
    const before = Date.now();
    const result = await service.markConnected(id, calleeId);
    assert.deepEqual(result, { started: true });
    const row = await db.callSession.findUnique({ where: { id } });
    assert.equal(row!.status, "ACTIVE");
    assert.ok(row!.startedAt && row!.startedAt.getTime() >= before - 1000);
  });
});

test("the other side's report (and any later one) never moves startedAt", skipOpts, async () => {
  const { callService: service, prisma: db } = await loadModules();
  await withCall("CONNECTING", async ({ id, callerId, calleeId }) => {
    await service.markConnected(id, calleeId);
    const first = (await db.callSession.findUnique({ where: { id } }))!.startedAt!;
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await service.markConnected(id, callerId), { started: false });
    // Open-room renegotiation: call:offer drops the row back to CONNECTING; reconnecting lifts it
    // to ACTIVE again but keeps the original start.
    await db.callSession.update({ where: { id }, data: { status: "CONNECTING" } });
    assert.deepEqual(await service.markConnected(id, calleeId), { started: false });
    const row = (await db.callSession.findUnique({ where: { id } }))!;
    assert.equal(row.status, "ACTIVE");
    assert.equal(row.startedAt!.getTime(), first.getTime());
  });
});

test("two simultaneous first reports stamp startedAt exactly once", skipOpts, async () => {
  const { callService: service } = await loadModules();
  await withCall("CONNECTING", async ({ id, callerId, calleeId }) => {
    const results = await Promise.all([service.markConnected(id, callerId), service.markConnected(id, calleeId)]);
    const started = results.filter((r) => "started" in r && r.started).length;
    assert.equal(started, 1);
  });
});

test("SECURITY: a non-participant cannot mark someone else's call connected", skipOpts, async () => {
  const { callService: service, prisma: db } = await loadModules();
  await withCall("CONNECTING", async ({ id }) => {
    assert.deepEqual(await service.markConnected(id, "attacker-1"), { error: "Not authorized" });
    const row = (await db.callSession.findUnique({ where: { id } }))!;
    assert.equal(row.status, "CONNECTING");
    assert.equal(row.startedAt, null);
  });
});

test("a finished or still-ringing call is never revived by a late report", skipOpts, async () => {
  const { callService: service, prisma: db } = await loadModules();
  for (const status of ["ENDED", "RINGING"] as const) {
    await withCall(status, async ({ id, calleeId }) => {
      assert.deepEqual(await service.markConnected(id, calleeId), { started: false });
      const row = (await db.callSession.findUnique({ where: { id } }))!;
      assert.equal(row.status, status);
      assert.equal(row.startedAt, null);
    });
  }
});

test("unknown call id is reported, not thrown", skipOpts, async () => {
  const { callService: service } = await loadModules();
  assert.deepEqual(await service.markConnected("00000000-0000-0000-0000-000000000000", "x"), {
    error: "Call not found",
  });
});
