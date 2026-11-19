import type { CallSessionInfo, CallState as BaseCallState } from "../../types";

/**
 * Phase 14.4 — the pure half of a voice/video call (web: context/CallContext.tsx's reducer,
 * components/call/CallOverlay.tsx's formatting). Kept byte-for-byte in behaviour with web: the
 * signaling protocol (chat-service `call.handler.ts`) is shared, so both clients must walk the
 * same states for a web↔mobile call to work.
 */

export interface CallState extends BaseCallState {
  /** Open-room sessions only: is the other party currently in the room? Never ends the call by
   * itself — it only drives the "đang chờ quay lại" banner. */
  peerPresent: boolean;
}

export const initialCallState: CallState = {
  uiState: "idle",
  callInfo: null,
  isMuted: false,
  isVideoOff: false,
  remoteMuted: false,
  remoteVideoOff: false,
  callDuration: 0,
  peerPresent: true,
};

export type CallAction =
  | { type: "SET_OUTGOING"; payload: CallSessionInfo }
  | { type: "SET_INCOMING"; payload: CallSessionInfo }
  | { type: "SET_PREVIEW"; payload: CallSessionInfo }
  | { type: "SET_WAITING" }
  | { type: "SET_CONNECTING" }
  | { type: "SET_ACTIVE" }
  | { type: "SET_IDLE" }
  | { type: "SET_PEER_PRESENT"; payload: boolean }
  | { type: "TOGGLE_MUTE"; payload: boolean }
  | { type: "TOGGLE_VIDEO"; payload: boolean }
  | { type: "SET_REMOTE_MEDIA"; payload: { kind: "audio" | "video"; enabled: boolean } }
  | { type: "TICK_DURATION" }
  | { type: "UPDATE_CALL_SESSION_ID"; payload: string };

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "SET_OUTGOING":
      return { ...state, uiState: "outgoing", callInfo: action.payload };
    case "SET_INCOMING":
      return { ...state, uiState: "incoming", callInfo: action.payload };
    case "SET_PREVIEW":
      return { ...state, uiState: "preview", callInfo: action.payload };
    case "SET_WAITING":
      return { ...state, uiState: "waiting", peerPresent: true };
    case "SET_CONNECTING":
      return { ...state, uiState: "connecting", peerPresent: true };
    case "SET_ACTIVE":
      return { ...state, uiState: "active", callDuration: 0, peerPresent: true };
    case "SET_IDLE":
      return initialCallState;
    case "SET_PEER_PRESENT":
      return { ...state, peerPresent: action.payload };
    case "TOGGLE_MUTE":
      return { ...state, isMuted: action.payload };
    case "TOGGLE_VIDEO":
      return { ...state, isVideoOff: action.payload };
    case "SET_REMOTE_MEDIA":
      return action.payload.kind === "audio"
        ? { ...state, remoteMuted: !action.payload.enabled }
        : { ...state, remoteVideoOff: !action.payload.enabled };
    case "TICK_DURATION":
      return { ...state, callDuration: state.callDuration + 1 };
    case "UPDATE_CALL_SESSION_ID":
      return state.callInfo
        ? { ...state, callInfo: { ...state.callInfo, callSessionId: action.payload } }
        : state;
    default:
      return state;
  }
}

/** A call row in one of these is retired — there is nothing left to join. */
export function isFinishedCallStatus(status: string | null | undefined): boolean {
  return ["ENDED", "REJECTED", "CANCELLED", "MISSED", "FAILED"].includes(String(status));
}

/** Last 5 minutes of an open room are flagged (web's "cảnh báo trước 5 phút"). */
export const ROOM_CLOSING_SOON_MS = 5 * 60 * 1000;

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The chat-service error that means "your join ticket is stale" — worded for a person. */
export function callErrorMessage(message: string | null | undefined): string {
  if (message && /token|join/i.test(message)) {
    return "Phiên tham gia không hợp lệ hoặc đã hết hạn. Vui lòng bấm tham gia lại.";
  }
  if (message && /[À-ỹ]/.test(message)) return message;
  return "Cuộc gọi gặp lỗi. Vui lòng thử lại.";
}

export interface JoinState {
  visible: boolean;
  enabled: boolean;
  reason?: string;
}

/**
 * The room is open exactly when the server says (joinOpensAt .. joinClosesAt on the session: ROOM_OPEN_BEFORE_MINUTES before
 * the start, the scheduled end with no grace tail). Responses without them fall back to the same default rule, so the button
 * is never enabled for a window the server then refuses.
 */
const DEFAULT_OPEN_BEFORE_MS = 15 * 60 * 1000;

/** "Mở phòng lúc 09:45", with the day ("20/11") when it is not today. */
export function roomOpensLabel(opensAtMs: number, nowMs: number = Date.now()): string {
  const d = new Date(opensAtMs);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const n = new Date(nowMs);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? `Mở phòng lúc ${hhmm}` : `Mở phòng lúc ${hhmm} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Web: utils/sessionUtils.ts getJoinSessionState. Only a CONFIRMED, ONLINE session shows the button;
 * it is usable while the server's room is open (see above). Membership of the session is
 * implied here (these lists are the caller's own) and enforced by the server when it mints the token.
 */
export function joinSessionState(
  s: {
    sessionMode: string | null | undefined;
    status: string;
    startAt: string | null | undefined;
    endAt: string | null | undefined;
    joinOpensAt?: string | null;
    joinClosesAt?: string | null;
  },
  now = Date.now(),
): JoinState {
  if (s.sessionMode !== "ONLINE" || s.status !== "CONFIRMED" || !s.startAt) return { visible: false, enabled: false };
  const opens = s.joinOpensAt ? new Date(s.joinOpensAt).getTime() : new Date(s.startAt).getTime() - DEFAULT_OPEN_BEFORE_MS;
  const closes = s.joinClosesAt ? new Date(s.joinClosesAt).getTime() : new Date(s.endAt ?? s.startAt).getTime();
  if (now < opens) return { visible: true, enabled: false, reason: roomOpensLabel(opens, now) };
  if (now >= closes) return { visible: true, enabled: false, reason: "Buổi học đã kết thúc" };
  return { visible: true, enabled: true };
}
