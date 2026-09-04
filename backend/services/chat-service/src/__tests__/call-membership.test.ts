/**
 * Regression tests for the P0 vulnerability found and fixed in this pass:
 * `call:ice_candidate` and `call:media_toggle` computed their relay target
 * as `user.id === call.callerId ? call.calleeId : call.callerId` with NO
 * membership check first. That ternary's "else" branch is also taken by
 * anyone who ISN'T the callee either — so any authenticated user who
 * knew/guessed an active callSessionId could inject a fake ICE candidate or
 * media-toggle event that got relayed straight to the real caller, despite
 * never being part of that call at all.
 *
 * `isCallParticipant` is the shared guard the fix introduced (used by both
 * handlers instead of two copies of the same inline ternary-based check).
 * These tests cover both the pure predicate and — using a real CallSession
 * row in a real (test-only) database, matching this project's established
 * gated-real-DB convention — the exact caller/callee/attacker scenario the
 * vulnerability was about.
 *
 * Run with (from backend/services/chat-service):
 *   CHAT_DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_chat_test" \
 *     npx tsx --test src/__tests__/call-membership.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

// call.handler.ts transitively imports joinToken.ts, which throws at import
// time if INTERNAL_API_SECRET is unset (a deliberate fail-closed guard,
// unrelated to what this test file covers) — set a harmless test value
// before the (lazy, dynamic) import below ever runs.
process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

const chatDatabaseUrl = process.env.CHAT_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /_test/i.test(chatDatabaseUrl);

if (process.env.CHAT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.CHAT_DATABASE_URL;
}

const skipOpts = {
  skip: canUseIntegrationDb ? false : "Requires CHAT_DATABASE_URL pointing at a *_test database.",
};

type IsCallParticipantLike = (typeof import("../socket/call.handler"))["isCallParticipant"];
type CallServiceLike = (typeof import("../services/call.service"))["callService"];
type PrismaClientLike = (typeof import("../repositories/chat.repository"))["prisma"];

let isCallParticipant: IsCallParticipantLike | undefined;
let callService: CallServiceLike | undefined;
let prisma: PrismaClientLike | undefined;

async function loadModules() {
  if (!isCallParticipant) {
    const handlerModule = await import("../socket/call.handler");
    const callServiceModule = await import("../services/call.service");
    const prismaModule = await import("../repositories/chat.repository");
    isCallParticipant = handlerModule.isCallParticipant;
    callService = callServiceModule.callService;
    prisma = prismaModule.prisma;
  }
  return { isCallParticipant: isCallParticipant!, callService: callService!, prisma: prisma! };
}

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

test("isCallParticipant: true for the caller", async () => {
  const { isCallParticipant: check } = await loadModules();
  assert.equal(check("caller-1", { callerId: "caller-1", calleeId: "callee-1" }), true);
});

test("isCallParticipant: true for the callee", async () => {
  const { isCallParticipant: check } = await loadModules();
  assert.equal(check("callee-1", { callerId: "caller-1", calleeId: "callee-1" }), true);
});

test("SECURITY: isCallParticipant is false for an unrelated third party — the exact bug this fixed", async () => {
  const { isCallParticipant: check } = await loadModules();
  assert.equal(check("attacker-1", { callerId: "caller-1", calleeId: "callee-1" }), false);
});

test(
  "SECURITY: an unrelated user's ICE-candidate attempt against a real call session must be rejected by the membership check",
  skipOpts,
  async () => {
    const { isCallParticipant: check, callService: service, prisma: db } = await loadModules();
    const callerId = `caller-${Date.now()}`;
    const calleeId = `callee-${Date.now()}`;
    const attackerId = `attacker-${Date.now()}`;

    const call = await db.callSession.create({
      data: {
        callerId,
        calleeId,
        callType: "VIDEO",
        origin: "CHAT",
      },
    });

    try {
      const found = await service.findById(call.id);
      assert.ok(found);

      // This mirrors exactly what call.handler.ts's call:ice_candidate does
      // after the fix: look up the call, then require membership before
      // computing/relaying to a target.
      assert.equal(check(attackerId, found!), false, "an unrelated third party must not be treated as a call participant");
      assert.equal(check(callerId, found!), true);
      assert.equal(check(calleeId, found!), true);
    } finally {
      await db.callSession.delete({ where: { id: call.id } });
    }
  },
);
