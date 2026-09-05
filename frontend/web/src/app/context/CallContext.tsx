import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { connectSocket, getSocket } from "../services/socket";
import { isChatWsEnabled } from "../config/serverUrl";
import { useWebRTC } from "../hooks/useWebRTC";
import { useApp } from "./AppContext";
import type { CallUIState, CallSessionInfo, CallType } from "../types";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

interface ExistingCallData {
  callSessionId: string;
  status: string;
  iceServers?: RTCIceServer[];
  /** Which role this client plays on the existing row — fixed for its whole lifetime,
   * since call:offer/call:answer are only ever relayed caller→callee / callee→caller. */
  isCaller?: boolean;
}
interface PendingSessionJoin {
  id: string;
  otherUserId: string;
  joinToken: string;
  /** When the room closes for good — see CallSessionInfo.roomClosesAt. */
  roomClosesAt?: string;
}
interface MediaToggledData {
  callSessionId: string;
  userId: string;
  kind: "audio" | "video";
  enabled: boolean;
}
interface CallErrorData {
  message?: string;
}

// ── State ──────────────────────────────────────────────────────
interface CallState {
  uiState: CallUIState;
  callInfo: CallSessionInfo | null;
  isMuted: boolean;
  isVideoOff: boolean;
  remoteMuted: boolean;
  remoteVideoOff: boolean;
  callDuration: number;
  /** Open-room sessions only: is the other party currently connected? Toggled by
   * call:peer_left_room / call:peer_disconnected (false) and a fresh call:offer / their
   * rejoin (true) — never ends the call by itself, just drives the "waiting for them to come
   * back" banner while this side stays fully connected and ready. */
  peerPresent: boolean;
}

const initialState: CallState = {
  uiState: "idle",
  callInfo: null,
  isMuted: false,
  isVideoOff: false,
  remoteMuted: false,
  remoteVideoOff: false,
  callDuration: 0,
  peerPresent: true,
};

type Action =
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
  | {
      type: "SET_REMOTE_MEDIA";
      payload: { kind: "audio" | "video"; enabled: boolean };
    }
  | { type: "TICK_DURATION" }
  | { type: "UPDATE_CALL_SESSION_ID"; payload: string };

function callReducer(state: CallState, action: Action): CallState {
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
      return initialState;
    case "SET_PEER_PRESENT":
      return { ...state, peerPresent: action.payload };
    case "TOGGLE_MUTE":
      return { ...state, isMuted: action.payload };
    case "TOGGLE_VIDEO":
      return { ...state, isVideoOff: action.payload };
    case "SET_REMOTE_MEDIA":
      if (action.payload.kind === "audio")
        return { ...state, remoteMuted: !action.payload.enabled };
      return { ...state, remoteVideoOff: !action.payload.enabled };
    case "TICK_DURATION":
      return { ...state, callDuration: state.callDuration + 1 };
    case "UPDATE_CALL_SESSION_ID":
      return state.callInfo
        ? {
            ...state,
            callInfo: { ...state.callInfo, callSessionId: action.payload },
          }
        : state;
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────
interface CallContextValue {
  state: CallState;
  initiateCall: (
    calleeId: string,
    callType: CallType,
    conversationId: string,
  ) => void;
  /** Open-room sessions: acquire media and show the mic/cam preview screen — does NOT
   * signal anything yet. See confirmJoinFromPreview. */
  startSessionPreview: (session: PendingSessionJoin) => Promise<void>;
  /** Open-room sessions: actually enters the room after the preview screen — the point at
   * which call:initiate is finally emitted. */
  confirmJoinFromPreview: () => void;
  /** Open-room sessions: back out of the preview screen before ever signaling anything. */
  cancelPreview: () => void;
  acceptCall: () => void;
  rejectCall: () => void;
  cancelCall: () => void;
  /** Ends a CHAT call for both parties, or — for an open-room SESSION call — leaves the
   * room without ending it for the other party (see call:leave_room). */
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────
export function CallProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useApp();
  const [state, dispatch] = useReducer(callReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const isCallerRef = useRef(false);
  // Open-room sessions: what startSessionPreview acquired media for, waiting on a click on
  // the preview screen (confirmJoinFromPreview) to actually signal anything.
  const pendingJoinRef = useRef<PendingSessionJoin | null>(null);
  const chatWsEnabled = isChatWsEnabled();

  const showRealtimeDisabled = useCallback(() => {
    toast.info("Realtime chat/call chưa được bật trong môi trường này.");
  }, []);

  // ── WebRTC ─────────────────────────────────────────────────
  const handleIceCandidate = useCallback((candidate: RTCIceCandidate) => {
    const s = stateRef.current;
    if (s.callInfo?.callSessionId) {
      if (!chatWsEnabled) return;
      const socket = getSocket();
      socket.emit("call:ice_candidate", {
        callSessionId: s.callInfo.callSessionId,
        candidate: candidate.toJSON(),
      });
    }
  }, []);

  const handleConnectionStateChange = useCallback(
    (connState: RTCPeerConnectionState) => {
      if (connState === "connected") {
        dispatch({ type: "SET_ACTIVE" });
        if (durationRef.current) clearInterval(durationRef.current);
        durationRef.current = setInterval(
          () => dispatch({ type: "TICK_DURATION" }),
          1000,
        );
      } else if (connState === "failed") {
        const s = stateRef.current;
        if (s.callInfo?.callSessionId && chatWsEnabled) {
          const socket = getSocket();
          if (s.callInfo.origin === "SESSION") {
            // A technical hiccup, not a real end — leave the room instead of ending it for
            // the other party; they simply keep waiting while this side can rejoin.
            socket.emit("call:leave_room", {
              callSessionId: s.callInfo.callSessionId,
            });
            toast.error("Kết nối gián đoạn. Vui lòng vào lại phòng.");
            doCleanup();
            return;
          }
          socket.emit("call:end", {
            callSessionId: s.callInfo.callSessionId,
            reason: "ice_failed",
          });
        }
        toast.error("Connection failed");
        doCleanup();
      }
    },
    [],
  );

  const webrtc = useWebRTC(handleIceCandidate, handleConnectionStateChange);
  const webrtcRef = useRef(webrtc);
  webrtcRef.current = webrtc;

  const doCleanup = useCallback(() => {
    webrtcRef.current.cleanup();
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    dispatch({ type: "SET_IDLE" });
  }, []);

  // ── Socket listeners (registered once) ─────────────────────
  useEffect(() => {
    if (!isAuthenticated || !chatWsEnabled) return;

    const socket = connectSocket();

    const onIncoming = (data: any) => {
      if (stateRef.current.uiState !== "idle") return;
      iceServersRef.current = data.iceServers || [];
      dispatch({
        type: "SET_INCOMING",
        payload: {
          callSessionId: data.callSessionId,
          callerId: data.callerId,
          calleeId: "",
          callerName: data.callerName,
          callType: data.callType,
          origin: data.origin,
          conversationId: data.conversationId,
          iceServers: data.iceServers,
        },
      });
    };

    const onInitiated = (data: any) => {
      iceServersRef.current = data.iceServers || [];
      isCallerRef.current = data.isCaller ?? true;
      dispatch({ type: "UPDATE_CALL_SESSION_ID", payload: data.callSessionId });
      // A brand new SESSION room: this is the first (and so far only) person in it — show
      // the "waiting for the other party" screen instead of a CHAT-style ringing UI.
      if (stateRef.current.callInfo?.origin === "SESSION") {
        dispatch({ type: "SET_WAITING" });
      }
    };

    // A stray event for a call this side is no longer part of (explicitly left, or never
    // joined at all) must be ignored outright. Without this, ANY call:offer/peer_rejoined
    // arriving on this socket — which stays connected long after the user backs out of the
    // call UI, since leaving a SESSION room never disconnects the socket itself — would
    // silently pull them straight back into "Connecting..." the instant the OTHER party
    // (re)joins, even though THIS side never asked to rejoin anything. doCleanup() resets
    // callInfo to null on every real exit (leave, hang up, error), so comparing against the
    // CURRENTLY-tracked callSessionId is exactly "am I still meant to be part of this call
    // right now" — a stale/unrelated event for any other id (or none at all) is a no-op.
    const isRelevantCall = (callSessionId: string) =>
      stateRef.current.callInfo?.callSessionId === callSessionId;

    // Whoever is this row's caller (re)sends an offer whenever the callee (re)joins — first
    // ever handshake (CHAT accept, or a SESSION room's second arrival) and every SESSION
    // reconnect afterward all funnel through here, since call:offer may only ever come from
    // the DB's callerId, never the other way, even mid-row.
    const sendFreshOffer = async (callSessionId: string) => {
      dispatch({ type: "SET_CONNECTING" });
      try {
        webrtcRef.current.createConnection(iceServersRef.current);
        const offer = await webrtcRef.current.createOffer();
        socket.emit("call:offer", { callSessionId, sdp: offer });
      } catch (err) {
        console.error("Failed to create offer:", err);
        giveUp(callSessionId, "webrtc_error");
        toast.error("Failed to establish connection");
      }
    };

    // A local WebRTC failure must not end a SESSION room for the other party — only a CHAT
    // call actually ends here; a SESSION call just leaves (see call:leave_room) so this side
    // can retry joining without cutting the other party off.
    const giveUp = (callSessionId: string, reason: string) => {
      const isSession = stateRef.current.callInfo?.origin === "SESSION";
      socket.emit(isSession ? "call:leave_room" : "call:end", {
        callSessionId,
        ...(isSession ? {} : { reason }),
      });
      doCleanup();
    };

    // Caller receives accepted (CHAT only — a SESSION room's equivalent is
    // call:existing/call:peer_rejoined below) → create PeerConnection + offer.
    const onAccepted = async (data: any) => {
      if (!isCallerRef.current || !isRelevantCall(data.callSessionId)) return;
      iceServersRef.current = data.iceServers || iceServersRef.current;
      await sendFreshOffer(data.callSessionId);
    };

    // Whoever is this row's callee receives an offer whenever the caller (re)sends one —
    // create PeerConnection + answer. Receiving one at all means the peer is right here now.
    const onOffer = async (data: any) => {
      if (isCallerRef.current || !isRelevantCall(data.callSessionId)) return;
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
      dispatch({ type: "SET_CONNECTING" });
      try {
        webrtcRef.current.createConnection(iceServersRef.current);
        const answer = await webrtcRef.current.createAnswer(data.sdp);
        socket.emit("call:answer", {
          callSessionId: data.callSessionId,
          sdp: answer,
        });
      } catch (err) {
        console.error("Failed to create answer:", err);
        giveUp(data.callSessionId, "webrtc_error");
        toast.error("Failed to establish connection");
      }
    };

    const onAnswer = async (data: any) => {
      if (!isRelevantCall(data.callSessionId)) return;
      try {
        await webrtcRef.current.setRemoteAnswer(data.sdp);
      } catch (err) {
        console.error("Failed to set remote answer:", err);
      }
    };

    const onIceCandidate = async (data: any) => {
      if (!isRelevantCall(data.callSessionId)) return;
      try {
        await webrtcRef.current.addIceCandidate(data.candidate);
      } catch (err) {
        console.error("Failed to add ICE candidate:", err);
      }
    };

    const onCallEnd = (data?: { callSessionId?: string }) => {
      if (data?.callSessionId && !isRelevantCall(data.callSessionId)) return;
      doCleanup();
    };

    const onMissed = (data?: { callSessionId?: string }) => {
      if (data?.callSessionId && !isRelevantCall(data.callSessionId)) return;
      const s = stateRef.current;
      if (s.callInfo?.origin === "SESSION") {
        toast.info(
          "Người còn lại chưa online trong buổi học. Vui lòng chờ hoặc thử lại sau.",
        );
      }
      doCleanup();
    };

    // A room for this coaching session already exists — either the very first time the
    // second party arrives, or a rejoin after this same person left/disconnected earlier.
    // Terminal statuses mean the row is retired (e.g. the sweep or a manual action already
    // ended it) — nothing to join, treat it like any other failure.
    const onExisting = async (data: ExistingCallData) => {
      const { callSessionId, status, iceServers, isCaller } = data;
      if (["ENDED", "REJECTED", "CANCELLED", "MISSED", "FAILED"].includes(status)) {
        toast.error("Buổi học này đã kết thúc.");
        doCleanup();
        return;
      }
      isCallerRef.current = !!isCaller;
      iceServersRef.current = iceServers?.length ? iceServers : DEFAULT_ICE_SERVERS;
      dispatch({ type: "UPDATE_CALL_SESSION_ID", payload: callSessionId });
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
      if (isCaller) {
        // We are this row's caller, (re)joining — only the caller may ever offer, so it's
        // on us to (re)negotiate immediately rather than wait for anything from the server.
        await sendFreshOffer(callSessionId);
      } else {
        // We are the callee — the server has separately nudged the caller
        // (call:peer_rejoined) to send us a fresh offer; just wait for call:offer.
        dispatch({ type: "SET_CONNECTING" });
      }
    };

    // Open-room sessions only: sent to whoever is this row's caller when the callee
    // (re)joins — the caller cannot otherwise learn this happened. Critically also gated on
    // isRelevantCall: leaving a SESSION room never disconnects the socket (see
    // call:leave_room), so a caller who has themselves already left — and is now sitting
    // idle — is STILL registered in this row's caller slot and would otherwise be silently
    // pulled back into "Connecting..." the instant the other party rejoins, despite never
    // asking to rejoin anything themselves.
    const onPeerRejoined = async (data: any) => {
      if (!isCallerRef.current || !isRelevantCall(data.callSessionId)) return;
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
      await sendFreshOffer(data.callSessionId);
    };

    // Open-room sessions only: the other party explicitly left (or their connection failed
    // locally) — the room itself stays open on our side. Proactively closing OUR OWN peer
    // connection here (not the whole call — local media keeps running) matters, not just
    // tidiness: left alone, this side's RTCPeerConnection would eventually notice the far
    // end is gone and fire connectionState "failed" on its own a few seconds later, which
    // handleConnectionStateChange would misread as THIS side's connection having broken and
    // wrongly leave/end the call on the side that never actually left.
    const onPeerLeftRoom = (data: { callSessionId: string }) => {
      if (!isRelevantCall(data.callSessionId)) return;
      webrtcRef.current.closePeerConnection();
      dispatch({ type: "SET_PEER_PRESENT", payload: false });
    };

    // CHAT and SESSION both: a network drop, distinct from a voluntary leave. Only closes
    // the peer connection for SESSION calls (same reasoning as onPeerLeftRoom above) — a
    // CHAT call's 30s grace-timer already ends it server-side regardless, so leaving CHAT's
    // existing behavior here untouched.
    const onPeerDisconnected = (data: { callSessionId: string }) => {
      if (!isRelevantCall(data.callSessionId)) return;
      if (stateRef.current.callInfo?.origin === "SESSION") {
        webrtcRef.current.closePeerConnection();
      }
      dispatch({ type: "SET_PEER_PRESENT", payload: false });
    };
    const onPeerReconnected = (data: { callSessionId: string }) => {
      if (!isRelevantCall(data.callSessionId)) return;
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
    };

    const onMediaToggled = (data: MediaToggledData) => {
      if (!isRelevantCall(data.callSessionId)) return;
      dispatch({
        type: "SET_REMOTE_MEDIA",
        payload: { kind: data.kind, enabled: data.enabled },
      });
    };

    const onError = (data: CallErrorData) => {
      const isTokenError =
        data.message?.includes("token") || data.message?.includes("join");
      toast.error(
        isTokenError
          ? "Phiên tham gia không hợp lệ hoặc đã hết hạn. Vui lòng bấm tham gia lại."
          : data.message || "Lỗi cuộc gọi",
      );
      doCleanup();
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:initiated", onInitiated);
    socket.on("call:accepted", onAccepted);
    socket.on("call:offer", onOffer);
    socket.on("call:answer", onAnswer);
    socket.on("call:ice_candidate", onIceCandidate);
    socket.on("call:rejected", onCallEnd);
    socket.on("call:cancelled", onCallEnd);
    socket.on("call:ended", onCallEnd);
    socket.on("call:missed", onMissed);
    socket.on("call:failed", onCallEnd);
    socket.on("call:accepted_elsewhere", onCallEnd);
    socket.on("call:existing", onExisting);
    socket.on("call:peer_rejoined", onPeerRejoined);
    socket.on("call:peer_left_room", onPeerLeftRoom);
    socket.on("call:peer_disconnected", onPeerDisconnected);
    socket.on("call:peer_reconnected", onPeerReconnected);
    socket.on("call:media_toggled", onMediaToggled);
    socket.on("call:error", onError);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:initiated", onInitiated);
      socket.off("call:accepted", onAccepted);
      socket.off("call:offer", onOffer);
      socket.off("call:answer", onAnswer);
      socket.off("call:ice_candidate", onIceCandidate);
      socket.off("call:rejected", onCallEnd);
      socket.off("call:cancelled", onCallEnd);
      socket.off("call:ended", onCallEnd);
      socket.off("call:missed", onMissed);
      socket.off("call:failed", onCallEnd);
      socket.off("call:accepted_elsewhere", onCallEnd);
      socket.off("call:existing", onExisting);
      socket.off("call:peer_rejoined", onPeerRejoined);
      socket.off("call:peer_left_room", onPeerLeftRoom);
      socket.off("call:peer_disconnected", onPeerDisconnected);
      socket.off("call:peer_reconnected", onPeerReconnected);
      socket.off("call:media_toggled", onMediaToggled);
      socket.off("call:error", onError);
    };
  }, [isAuthenticated, chatWsEnabled, doCleanup]);

  // ── Actions (acquire media in click context, THEN signal) ──

  const initiateCall = useCallback(
    async (calleeId: string, callType: CallType, conversationId: string) => {
      if (stateRef.current.uiState !== "idle") return;
      if (!chatWsEnabled) {
        showRealtimeDisabled();
        return;
      }

      // 1. Acquire media FIRST (user gesture context = click)
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("getUserMedia not supported — use HTTPS or localhost");
        return;
      }
      try {
        await webrtcRef.current.acquireMedia(callType);
      } catch (err: any) {
        console.error("getUserMedia failed:", err?.name, err?.message, err);
        toast.error(
          `Mic/camera error: ${err?.name || "Unknown"} — ${err?.message || ""}`,
        );
        return;
      }

      // 2. Now emit socket event
      const socket = connectSocket();
      isCallerRef.current = true;

      dispatch({
        type: "SET_OUTGOING",
        payload: {
          callSessionId: "",
          callerId: "",
          calleeId,
          callType,
          origin: "CHAT",
          conversationId,
        },
      });

      socket.emit("call:initiate", {
        calleeId,
        callType,
        conversationId,
        origin: "CHAT",
      });
    },
    [chatWsEnabled, showRealtimeDisabled],
  );

  // Open-room sessions: acquire media for a live self-view and show the mic/cam preview
  // screen — like Meet/Teams, nothing is signaled to the other party yet, and the user can
  // still toggle their own mic/cam off before ever entering (toggleMute/toggleVideo already
  // work on the acquired tracks, no separate mechanism needed).
  const startSessionPreview = useCallback(
    async (session: PendingSessionJoin): Promise<void> => {
      if (stateRef.current.uiState !== "idle") return;
      if (!chatWsEnabled) {
        showRealtimeDisabled();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error(
          "Trình duyệt không hỗ trợ camera/micro hoặc cần chạy trên HTTPS/localhost",
        );
        return;
      }
      try {
        await webrtcRef.current.acquireMedia("VIDEO");
      } catch (err: any) {
        toast.error(
          "Không thể truy cập camera/micro. Vui lòng kiểm tra quyền trình duyệt.",
        );
        return;
      }

      pendingJoinRef.current = session;
      dispatch({
        type: "SET_PREVIEW",
        payload: {
          callSessionId: "",
          callerId: "",
          calleeId: session.otherUserId,
          callType: "VIDEO",
          origin: "SESSION",
          conversationId: "",
          coachingSessionId: session.id,
          roomClosesAt: session.roomClosesAt,
        },
      });
    },
    [chatWsEnabled, showRealtimeDisabled],
  );

  // The actual "enter the room" step — media was already acquired for the preview, so this
  // is signaling only. call:initiated (brand new room) or call:existing (someone's already
  // there) both take it from here.
  const confirmJoinFromPreview = useCallback(() => {
    const s = stateRef.current;
    const pending = pendingJoinRef.current;
    if (s.uiState !== "preview" || !s.callInfo || !pending) return;

    const socket = connectSocket();
    isCallerRef.current = true; // corrected from call:existing's own isCaller if this room already had someone in it
    dispatch({ type: "SET_WAITING" });
    socket.emit("call:initiate", {
      calleeId: s.callInfo.calleeId,
      callType: "VIDEO",
      origin: "SESSION",
      coachingSessionId: pending.id,
      joinToken: pending.joinToken,
    });
  }, []);

  // Back out of the preview screen — nothing was ever signaled, so this is just local cleanup.
  const cancelPreview = useCallback(() => {
    pendingJoinRef.current = null;
    doCleanup();
  }, [doCleanup]);

  const acceptCall = useCallback(async () => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;
    if (!chatWsEnabled) {
      doCleanup();
      return;
    }

    // 1. Acquire media FIRST (user gesture context = click)
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("getUserMedia not supported — use HTTPS or localhost");
      doCleanup();
      return;
    }
    try {
      await webrtcRef.current.acquireMedia(s.callInfo.callType || "VOICE");
    } catch (err: any) {
      console.error("getUserMedia failed:", err?.name, err?.message, err);
      toast.error(
        `Mic/camera error: ${err?.name || "Unknown"} — ${err?.message || ""}`,
      );

      // Reject the call since we can't take it
      const socket = connectSocket();
      socket.emit("call:reject", { callSessionId: s.callInfo.callSessionId });
      doCleanup();
      return;
    }

    // 2. Now accept on server
    isCallerRef.current = false;
    const socket = connectSocket();
    socket.emit("call:accept", { callSessionId: s.callInfo.callSessionId });
  }, [chatWsEnabled, doCleanup]);

  const rejectCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;
    if (!chatWsEnabled) {
      doCleanup();
      return;
    }
    const socket = connectSocket();
    socket.emit("call:reject", { callSessionId: s.callInfo.callSessionId });
    doCleanup();
  }, [chatWsEnabled, doCleanup]);

  const cancelCall = useCallback(() => {
    const s = stateRef.current;
    if (!chatWsEnabled) {
      doCleanup();
      return;
    }
    if (s.callInfo?.callSessionId) {
      const socket = connectSocket();
      socket.emit("call:cancel", { callSessionId: s.callInfo.callSessionId });
    }
    doCleanup();
  }, [chatWsEnabled, doCleanup]);

  // Ends a CHAT call for both parties. For an open-room SESSION call, "ending" isn't a thing
  // either side can do to the other — this only ever LEAVES the room (see call:leave_room's
  // own doc comment): the other party is simply notified and keeps waiting, and the room
  // itself only ever closes on its own schedule, via user-service's room-close sweep.
  const endCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;
    if (!chatWsEnabled) {
      doCleanup();
      return;
    }
    const socket = connectSocket();
    if (s.callInfo.origin === "SESSION") {
      socket.emit("call:leave_room", { callSessionId: s.callInfo.callSessionId });
    } else {
      socket.emit("call:end", { callSessionId: s.callInfo.callSessionId });
    }
    doCleanup();
  }, [chatWsEnabled, doCleanup]);

  const toggleMute = useCallback(() => {
    const newMuted = webrtcRef.current.toggleMute();
    dispatch({ type: "TOGGLE_MUTE", payload: newMuted });

    const s = stateRef.current;
    if (chatWsEnabled && s.callInfo?.callSessionId) {
      const socket = getSocket();
      socket.emit("call:media_toggle", {
        callSessionId: s.callInfo.callSessionId,
        kind: "audio",
        enabled: !newMuted,
      });
    }
  }, [chatWsEnabled]);

  const toggleVideo = useCallback(() => {
    const newOff = webrtcRef.current.toggleVideo();
    dispatch({ type: "TOGGLE_VIDEO", payload: newOff });

    const s = stateRef.current;
    if (chatWsEnabled && s.callInfo?.callSessionId) {
      const socket = getSocket();
      socket.emit("call:media_toggle", {
        callSessionId: s.callInfo.callSessionId,
        kind: "video",
        enabled: !newOff,
      });
    }
  }, [chatWsEnabled]);

  return (
    <CallContext.Provider
      value={{
        state,
        initiateCall,
        startSessionPreview,
        confirmJoinFromPreview,
        cancelPreview,
        acceptCall,
        rejectCall,
        cancelCall,
        endCall,
        toggleMute,
        toggleVideo,
        localStream: webrtc.localStream,
        remoteStream: webrtc.remoteStream,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}
