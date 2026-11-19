/**
 * Double "Chấp nhận" (owner's manual test): the callee taps accept twice quickly, or accepts on two devices.
 *
 * BEFORE the fix the second `call:accept` lost the first-accept-wins race AGAINST ITSELF: callService.acceptCall answered
 * `alreadyHandled`, so the handler told the very socket that held the live call `call:accepted_elsewhere` + `call:error`.
 * The callee client reacts to both with cleanup() (drops its microphone/peer connection, back to idle) while the caller had
 * already received `call:accepted` and was sending its offer -> the caller waits on a callee that is gone: both sides break.
 *
 * TEST FIXTURE (BACKEND INTEGRATION-style unit test): the real socket handler runs against a fake socket/io and a stateful
 * fake of callService.acceptCall that keeps the same first-wins contract as callRepository.claimRinging. No database.
 *
 *   npx tsx --test src/__tests__/call-accept-idempotent.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused_test";
process.env.INTERNAL_API_SECRET ??= "test-only-internal-api-secret";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

type Handler = (payload: any) => Promise<void>;

async function setup(opts: { failFirst?: boolean } = {}) {
  const { callService } = await import("../services/call.service");
  const { registerCallHandlers, __resetAcceptsSeenForTests } = await import("../socket/call.handler");
  __resetAcceptsSeenForTests();

  // first-accept-wins, with a real await so concurrent accepts interleave like they do against the database
  let status: "RINGING" | "ACCEPTED" = "RINGING";
  let acceptCalls = 0;
  const call = { id: "call-1", callerId: "caller-1", calleeId: "callee-1", callType: "VIDEO", origin: "CHAT", conversationId: "conv-1" };
  const restore = patch(callService, "acceptCall", async (_id: string, userId: string) => {
    acceptCalls++;
    if (opts.failFirst && acceptCalls === 1) return { error: "Failed to accept call" };
    await new Promise((r) => setImmediate(r));
    if (userId !== call.calleeId) return { error: "Not authorized" };
    if (status !== "RINGING") return { error: "Call is no longer ringing", alreadyHandled: true };
    status = "ACCEPTED";
    await new Promise((r) => setImmediate(r));
    return { call };
  });

  const toRoom: Array<{ room: string; event: string; payload: any }> = [];
  const io: any = { to: (room: string) => ({ emit: (event: string, payload: any) => void toRoom.push({ room, event, payload }) }) };
  const device = (socketId: string) => {
    const handlers = new Map<string, Handler>();
    const toSocket: Array<{ event: string; payload: any }> = [];
    const socket: any = {
      id: socketId,
      handshake: { auth: { token: "t" } },
      on: (e: string, h: Handler) => handlers.set(e, h),
      emit: (event: string, payload: any) => void toSocket.push({ event, payload }),
    };
    registerCallHandlers(io, socket, { id: "callee-1", email: "callee-1@x.test" });
    return { accept: () => handlers.get("call:accept")!({ callSessionId: "call-1" }), toSocket };
  };
  return { device, toRoom, restore, acceptCalls: () => acceptCalls };
}

const callerAccepted = (toRoom: Array<{ room: string; event: string }>) =>
  toRoom.filter((e) => e.room === "user:caller-1" && e.event === "call:accepted").length;

test("double tap (two back-to-back call:accept on ONE socket): caller told once, the callee's own socket gets no 'accepted elsewhere' / error", async () => {
  const { device, toRoom, restore, acceptCalls } = await setup();
  try {
    const d = device("s-phone");
    await Promise.all([d.accept(), d.accept()]);
    assert.equal(callerAccepted(toRoom), 1, "the caller is told exactly once");
    assert.deepEqual(d.toSocket, [], "nothing that would make the callee client tear the call down");
    assert.equal(acceptCalls(), 1, "the duplicate does not re-run the accept at all");
  } finally {
    restore();
  }
});

test("a later duplicate on the same socket (after the first finished) is ignored too", async () => {
  const { device, toRoom, restore } = await setup();
  try {
    const d = device("s-phone");
    await d.accept();
    await d.accept();
    assert.equal(callerAccepted(toRoom), 1);
    assert.deepEqual(d.toSocket, []);
  } finally {
    restore();
  }
});

test("second DEVICE of the same user: it loses (accepted_elsewhere for ITSELF only); the caller and the winning device are not touched", async () => {
  const { device, toRoom, restore } = await setup();
  try {
    const winner = device("s-phone");
    const other = device("s-laptop");
    await winner.accept();
    await other.accept();
    assert.equal(callerAccepted(toRoom), 1, "the established call is not re-announced");
    assert.deepEqual(winner.toSocket, [], "the winning device receives nothing");
    assert.ok(other.toSocket.some((e) => e.event === "call:accepted_elsewhere"), "the losing device is told to dismiss its own screen");
    assert.deepEqual(
      toRoom.filter((e) => e.event !== "call:accepted"),
      [],
      "no room event (caller / callee user room) is emitted for the losing accept",
    );
    // and that device's own repeated tap does not keep re-firing errors
    await other.accept();
    assert.equal(other.toSocket.filter((e) => e.event === "call:accepted_elsewhere").length, 1);
  } finally {
    restore();
  }
});

test("a genuinely failed accept (not a race) can be retried by the same socket", async () => {
  const { device, toRoom, restore, acceptCalls } = await setup({ failFirst: true });
  try {
    const d = device("s-phone");
    await d.accept();
    assert.ok(d.toSocket.some((e) => e.event === "call:error"));
    await d.accept();
    assert.equal(acceptCalls(), 2);
    assert.equal(callerAccepted(toRoom), 1);
  } finally {
    restore();
  }
});
