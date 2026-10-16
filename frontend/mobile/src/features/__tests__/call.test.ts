/**
 * Phase 14.4 — gọi thoại/video: máy trạng thái (khớp web) + cửa sổ "Tham gia buổi học".
 *
 * Chạy: npx tsx --test src/features/__tests__/call.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callErrorMessage,
  callReducer,
  formatCountdown,
  formatDuration,
  initialCallState,
  isFinishedCallStatus,
  joinSessionState,
} from "../call/callState";

const info = {
  callSessionId: "c1",
  conversationId: "conv1",
  callType: "VIDEO" as const,
  peerId: "u2",
  peerName: "An",
} as never;

test("callReducer walks outgoing → connecting → active → idle", () => {
  let s = callReducer(initialCallState, { type: "SET_OUTGOING", payload: info });
  assert.equal(s.uiState, "outgoing");
  s = callReducer(s, { type: "SET_CONNECTING" });
  assert.equal(s.uiState, "connecting");
  s = callReducer(s, { type: "TICK_DURATION" });
  s = callReducer(s, { type: "SET_ACTIVE" });
  assert.equal(s.callDuration, 0, "active resets the timer");
  s = callReducer(s, { type: "TICK_DURATION" });
  assert.equal(s.callDuration, 1);
  s = callReducer(s, { type: "SET_PEER_PRESENT", payload: false });
  assert.equal(s.peerPresent, false);
  assert.deepEqual(callReducer(s, { type: "SET_IDLE" }), initialCallState);
});

test("remote media flags and call id update", () => {
  let s = callReducer(initialCallState, { type: "SET_INCOMING", payload: info });
  s = callReducer(s, { type: "SET_REMOTE_MEDIA", payload: { kind: "audio", enabled: false } });
  s = callReducer(s, { type: "SET_REMOTE_MEDIA", payload: { kind: "video", enabled: false } });
  assert.equal(s.remoteMuted, true);
  assert.equal(s.remoteVideoOff, true);
  s = callReducer(s, { type: "UPDATE_CALL_SESSION_ID", payload: "c9" });
  assert.equal(s.callInfo?.callSessionId, "c9");
  // Without a call there is nothing to rename.
  assert.equal(callReducer(initialCallState, { type: "UPDATE_CALL_SESSION_ID", payload: "x" }), initialCallState);
});

test("finished statuses and formatting", () => {
  for (const st of ["ENDED", "REJECTED", "CANCELLED", "MISSED", "FAILED"]) assert.ok(isFinishedCallStatus(st));
  assert.ok(!isFinishedCallStatus("ACTIVE"));
  assert.ok(!isFinishedCallStatus(null));
  assert.equal(formatDuration(65), "01:05");
  assert.equal(formatCountdown(125_900), "2:05");
  assert.equal(formatCountdown(-5), "0:00");
});

test("callErrorMessage never leaks an English server string", () => {
  assert.match(callErrorMessage("Invalid join token"), /tham gia lại/);
  assert.equal(callErrorMessage("Người kia đang bận"), "Người kia đang bận");
  assert.equal(callErrorMessage("ECONNRESET"), "Cuộc gọi gặp lỗi. Vui lòng thử lại.");
  assert.equal(callErrorMessage(undefined), "Cuộc gọi gặp lỗi. Vui lòng thử lại.");
});

test("joinSessionState — web's 30-minute window, ONLINE + CONFIRMED only", () => {
  const start = Date.parse("2026-10-01T10:00:00Z");
  const s = { sessionMode: "ONLINE", status: "CONFIRMED", startAt: "2026-10-01T10:00:00Z", endAt: "2026-10-01T11:00:00Z" };
  const min = 60_000;
  assert.deepEqual(joinSessionState(s, start - 31 * min), { visible: true, enabled: false, reason: "Chưa đến giờ học" });
  assert.deepEqual(joinSessionState(s, start - 30 * min), { visible: true, enabled: true });
  assert.deepEqual(joinSessionState(s, start + 90 * min), { visible: true, enabled: true });
  assert.deepEqual(joinSessionState(s, start + 91 * min), { visible: true, enabled: false, reason: "Buổi học đã kết thúc" });
  assert.equal(joinSessionState({ ...s, sessionMode: "OFFLINE" }, start).visible, false);
  assert.equal(joinSessionState({ ...s, status: "PENDING" }, start).visible, false);
  assert.equal(joinSessionState({ ...s, startAt: null }, start).visible, false);
  // No end time → the window closes 30 min after the start.
  assert.equal(joinSessionState({ ...s, endAt: null }, start + 31 * min).enabled, false);
});
