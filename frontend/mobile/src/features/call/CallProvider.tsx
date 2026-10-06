import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useReducer, useRef, type ReactNode } from "react";
import type { MediaStream } from "react-native-webrtc";

import { useToast } from "../../components/ui";
import { useApp } from "../../context/AppContext";
import { isChatWsEnabled } from "../../config/serverUrl";
import { connectSocket, disconnectSocket, getSocket, watchAppStateForSocketRecovery } from "../../services/socket";
import type { CallType } from "../../types";
import { callErrorMessage, callReducer, initialCallState, isFinishedCallStatus, type CallState } from "./callState";
import { useRNWebRTC } from "./useRNWebRTC";
import { dismissCallPush } from "../push/pushDevice";

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

export interface PendingSessionJoin {
  id: string;
  otherUserId: string;
  joinToken: string;
  roomClosesAt?: string;
}

interface CallContextValue {
  state: CallState;
  initiateCall: (calleeId: string, callType: CallType, conversationId: string, calleeName?: string) => void;
  startSessionPreview: (session: PendingSessionJoin) => Promise<void>;
  confirmJoinFromPreview: () => void;
  cancelPreview: () => void;
  acceptCall: () => void;
  rejectCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  switchCamera: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

/**
 * Phase 14.4 — voice/video calls (web: context/CallContext.tsx), over chat-service's socket
 * (`services/socket.ts`, the gateway's `/chat-socket.io`) and react-native-webrtc.
 *
 * The state machine and every signaling rule are web's, unchanged, because the other end of a call
 * may well be the web app: media first (in the tap), then signal; only the row's caller ever
 * offers; events for a call this side is no longer part of are ignored; an open-room SESSION call
 * is only ever LEFT (call:leave_room), never ended for the other party; a local ICE failure leaves
 * a room instead of ending it.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useApp();
  const userId = user?.id ?? null;
  const isAuthenticatedRef = useRef(isAuthenticated);
  useLayoutEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  });
  const toast = useToast();
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceServersRef = useRef<unknown[]>([]);
  const isCallerRef = useRef(false);
  const pendingJoinRef = useRef<PendingSessionJoin | null>(null);
  const enabled = isChatWsEnabled();

  const toastRef = useRef(toast);
  useLayoutEffect(() => {
    toastRef.current = toast;
  });

  const handleIceCandidate = useCallback(
    (candidate: unknown) => {
      const id = stateRef.current.callInfo?.callSessionId;
      if (id && enabled) getSocket().emit("call:ice_candidate", { callSessionId: id, candidate });
    },
    [enabled],
  );

  // Filled in right below — the connection-state handler needs doCleanup, which needs webrtc.
  const doCleanupRef = useRef<() => void>(() => undefined);

  const handleConnectionStateChange = useCallback(
    (connState: string) => {
      if (connState === "connected") {
        dispatch({ type: "SET_ACTIVE" });
        if (durationRef.current) clearInterval(durationRef.current);
        durationRef.current = setInterval(() => dispatch({ type: "TICK_DURATION" }), 1000);
        // Media really flows now — the server starts the call's duration from the first report
        // (web sends the same event; GAP-23).
        const connectedId = stateRef.current.callInfo?.callSessionId;
        if (connectedId && enabled) getSocket().emit("call:connected", { callSessionId: connectedId });
      } else if (connState === "failed") {
        const info = stateRef.current.callInfo;
        if (info?.callSessionId && enabled) {
          if (info.origin === "SESSION") {
            getSocket().emit("call:leave_room", { callSessionId: info.callSessionId });
            toastRef.current.show("Kết nối gián đoạn. Vui lòng vào lại phòng.", "danger");
            doCleanupRef.current();
            return;
          }
          getSocket().emit("call:end", { callSessionId: info.callSessionId, reason: "ice_failed" });
        }
        toastRef.current.show("Không kết nối được cuộc gọi.", "danger");
        doCleanupRef.current();
      }
    },
    [enabled],
  );

  const webrtc = useRNWebRTC(handleIceCandidate, handleConnectionStateChange);
  const webrtcRef = useRef(webrtc);
  useLayoutEffect(() => {
    webrtcRef.current = webrtc;
  });

  const doCleanup = useCallback(() => {
    webrtcRef.current.cleanup();
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    dispatch({ type: "SET_IDLE" });
  }, []);
  useLayoutEffect(() => {
    doCleanupRef.current = doCleanup;
  }, [doCleanup]);

  // Signing out mid-call must not leave a live mic/camera behind for the next account.
  useEffect(() => {
    if (!isAuthenticated && stateRef.current.uiState !== "idle") doCleanup();
  }, [isAuthenticated, doCleanup]);

  // ── Socket listeners ────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !enabled || !userId) return;
    const socket = connectSocket();
    // Android drops this socket once the app has sat in the background a while, and its own
    // reconnect gives up after 5 tries — without this, calls stopped arriving until a restart.
    const stopRecovery = watchAppStateForSocketRecovery();

    const isRelevant = (id?: string) => !!id && stateRef.current.callInfo?.callSessionId === id;

    // The server's call id must be visible to the NEXT socket event at once. stateRef only catches up
    // in a layout effect after React commits, and events can arrive back to back: on a session-room
    // REJOIN the server sends `call:existing` (the id) and the peer's `call:offer` follows within
    // milliseconds — the offer then failed isRelevant() and was dropped, leaving the phone on
    // "Đang kết nối…" forever (real phone, 6/10). Apply the id to the ref synchronously as well.
    const adoptCallSessionId = (callSessionId: string) => {
      dispatch({ type: "UPDATE_CALL_SESSION_ID", payload: callSessionId });
      stateRef.current = callReducer(stateRef.current, { type: "UPDATE_CALL_SESSION_ID", payload: callSessionId });
    };

    const giveUp = (callSessionId: string, reason: string) => {
      const isSession = stateRef.current.callInfo?.origin === "SESSION";
      socket.emit(isSession ? "call:leave_room" : "call:end", { callSessionId, ...(isSession ? {} : { reason }) });
      doCleanup();
    };

    const sendFreshOffer = async (callSessionId: string) => {
      dispatch({ type: "SET_CONNECTING" });
      try {
        webrtcRef.current.createConnection(iceServersRef.current as never);
        const offer = await webrtcRef.current.createOffer();
        socket.emit("call:offer", { callSessionId, sdp: offer });
      } catch {
        giveUp(callSessionId, "webrtc_error");
        toastRef.current.show("Không thiết lập được kết nối.", "danger");
      }
    };

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
      adoptCallSessionId(data.callSessionId);
      if (stateRef.current.callInfo?.origin === "SESSION") dispatch({ type: "SET_WAITING" });
    };

    const onAccepted = async (data: any) => {
      if (!isCallerRef.current || !isRelevant(data.callSessionId)) return;
      iceServersRef.current = data.iceServers || iceServersRef.current;
      await sendFreshOffer(data.callSessionId);
    };

    const onOffer = async (data: any) => {
      if (isCallerRef.current || !isRelevant(data.callSessionId)) return;
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
      dispatch({ type: "SET_CONNECTING" });
      try {
        webrtcRef.current.createConnection(iceServersRef.current as never);
        const answer = await webrtcRef.current.createAnswer(data.sdp);
        socket.emit("call:answer", { callSessionId: data.callSessionId, sdp: answer });
      } catch {
        giveUp(data.callSessionId, "webrtc_error");
        toastRef.current.show("Không thiết lập được kết nối.", "danger");
      }
    };

    const onAnswer = async (data: any) => {
      if (!isRelevant(data.callSessionId)) return;
      await webrtcRef.current.setRemoteAnswer(data.sdp).catch(() => undefined);
    };

    const onIceCandidate = async (data: any) => {
      if (!isRelevant(data.callSessionId)) return;
      await webrtcRef.current.addIceCandidate(data.candidate).catch(() => undefined);
    };

    const onCallEnd = (data?: { callSessionId?: string }) => {
      if (data?.callSessionId && !isRelevant(data.callSessionId)) return;
      doCleanup();
    };

    const onMissed = (data?: { callSessionId?: string }) => {
      if (data?.callSessionId && !isRelevant(data.callSessionId)) return;
      if (stateRef.current.callInfo?.origin === "SESSION") {
        toastRef.current.show("Người còn lại chưa online trong buổi học. Vui lòng chờ hoặc thử lại sau.");
      } else if (stateRef.current.uiState === "outgoing") {
        toastRef.current.show("Không có người nghe máy.");
      }
      doCleanup();
    };

    const onExisting = async (data: any) => {
      if (isFinishedCallStatus(data.status)) {
        toastRef.current.show("Buổi học này đã kết thúc.", "danger");
        doCleanup();
        return;
      }
      isCallerRef.current = !!data.isCaller;
      iceServersRef.current = data.iceServers?.length ? data.iceServers : DEFAULT_ICE_SERVERS;
      adoptCallSessionId(data.callSessionId);
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
      if (data.isCaller) await sendFreshOffer(data.callSessionId);
      else dispatch({ type: "SET_CONNECTING" });
    };

    const onPeerRejoined = async (data: any) => {
      if (!isCallerRef.current || !isRelevant(data.callSessionId)) return;
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
      await sendFreshOffer(data.callSessionId);
    };

    const onPeerLeftRoom = (data: any) => {
      if (!isRelevant(data.callSessionId)) return;
      webrtcRef.current.closePeerConnection();
      dispatch({ type: "SET_PEER_PRESENT", payload: false });
    };

    const onPeerDisconnected = (data: any) => {
      if (!isRelevant(data.callSessionId)) return;
      if (stateRef.current.callInfo?.origin === "SESSION") webrtcRef.current.closePeerConnection();
      dispatch({ type: "SET_PEER_PRESENT", payload: false });
    };

    const onPeerReconnected = (data: any) => {
      if (!isRelevant(data.callSessionId)) return;
      dispatch({ type: "SET_PEER_PRESENT", payload: true });
    };

    const onMediaToggled = (data: any) => {
      if (!isRelevant(data.callSessionId)) return;
      dispatch({ type: "SET_REMOTE_MEDIA", payload: { kind: data.kind, enabled: data.enabled } });
    };

    const onError = (data: { message?: string }) => {
      toastRef.current.show(callErrorMessage(data?.message), "danger");
      doCleanup();
    };

    const handlers: Record<string, (d: any) => void> = {
      "call:incoming": onIncoming,
      "call:initiated": onInitiated,
      "call:accepted": onAccepted,
      "call:offer": onOffer,
      "call:answer": onAnswer,
      "call:ice_candidate": onIceCandidate,
      "call:rejected": onCallEnd,
      "call:cancelled": onCallEnd,
      "call:ended": onCallEnd,
      "call:missed": onMissed,
      "call:failed": onCallEnd,
      "call:accepted_elsewhere": onCallEnd,
      "call:existing": onExisting,
      "call:peer_rejoined": onPeerRejoined,
      "call:peer_left_room": onPeerLeftRoom,
      "call:peer_disconnected": onPeerDisconnected,
      "call:peer_reconnected": onPeerReconnected,
      "call:media_toggled": onMediaToggled,
      "call:error": onError,
    };
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
    // E2 — a phone woken by the "đang gọi" push connects after the ring went out to an empty
    // room: ask for anything still ringing for us, now that the listeners above exist, and again
    // after every reconnect.
    const sync = () => socket.emit("call:sync");
    socket.on("connect", sync);
    if (socket.connected) sync();
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn);
      socket.off("connect", sync);
      stopRecovery();
      // Signed out or another account signed in: this connection authenticated as the previous
      // user, so it must go — otherwise their calls would ring for whoever is signed in now.
      disconnectSocket();
    };
  }, [isAuthenticated, enabled, userId, doCleanup]);

  // ── Actions: media first (inside the tap), then signal ───────────
  const realtimeOff = useCallback(() => {
    toastRef.current.show("Gọi thoại/video chưa được bật trong môi trường này.");
  }, []);

  // Getting media can wait on the OS permission dialog for as long as the user likes; the call can
  // be missed, cancelled or signed out of meanwhile. One acquisition at a time, and every caller
  // re-checks the call is still the one it was for before signaling (else the media is released).
  const acquiringRef = useRef(false);
  const acquire = useCallback(async (callType: CallType) => {
    if (acquiringRef.current) return false;
    acquiringRef.current = true;
    try {
      const stream = await webrtcRef.current.acquireMedia(callType);
      if (callType === "VIDEO" && stream.getVideoTracks().length === 0) {
        toastRef.current.show("Không mở được camera — đã vào cuộc gọi chỉ với âm thanh.");
      }
      return true;
    } catch {
      toastRef.current.show("Không truy cập được micro/camera. Hãy cấp quyền cho Gymini rồi thử lại.", "danger");
      return false;
    } finally {
      acquiringRef.current = false;
    }
  }, []);

  /** The moment passed while the permission dialog was up: let go of the mic/camera, send nothing. */
  const stillIdleAfterAcquire = useCallback(() => {
    if (stateRef.current.uiState === "idle" && isAuthenticatedRef.current) return true;
    if (stateRef.current.uiState === "idle") webrtcRef.current.cleanup();
    return false;
  }, []);

  const initiateCall = useCallback(
    async (calleeId: string, callType: CallType, conversationId: string, calleeName?: string) => {
      if (stateRef.current.uiState !== "idle") return;
      if (!enabled) return realtimeOff();
      if (!(await acquire(callType))) return;
      if (!stillIdleAfterAcquire()) return;
      const socket = connectSocket();
      isCallerRef.current = true;
      dispatch({
        type: "SET_OUTGOING",
        payload: { callSessionId: "", callerId: "", calleeId, callerName: calleeName, callType, origin: "CHAT", conversationId },
      });
      socket.emit("call:initiate", { calleeId, callType, conversationId, origin: "CHAT" });
    },
    [enabled, acquire, realtimeOff, stillIdleAfterAcquire],
  );

  const startSessionPreview = useCallback(
    async (session: PendingSessionJoin) => {
      if (stateRef.current.uiState !== "idle") return;
      if (!enabled) return realtimeOff();
      if (!(await acquire("VIDEO"))) return;
      if (!stillIdleAfterAcquire()) return;
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
    [enabled, acquire, realtimeOff, stillIdleAfterAcquire],
  );

  const confirmJoinFromPreview = useCallback(() => {
    const s = stateRef.current;
    const pending = pendingJoinRef.current;
    if (s.uiState !== "preview" || !s.callInfo || !pending) return;
    const socket = connectSocket();
    isCallerRef.current = true; // corrected by call:existing if the room already had someone
    dispatch({ type: "SET_WAITING" });
    socket.emit("call:initiate", {
      calleeId: s.callInfo.calleeId,
      callType: "VIDEO",
      origin: "SESSION",
      coachingSessionId: pending.id,
      joinToken: pending.joinToken,
    });
  }, []);

  const cancelPreview = useCallback(() => {
    pendingJoinRef.current = null;
    doCleanup();
  }, [doCleanup]);

  const acceptCall = useCallback(async () => {
    const info = stateRef.current.callInfo;
    if (!info?.callSessionId || acquiringRef.current) return; // second tap while the first is pending
    if (!enabled) return doCleanup();
    const socket = connectSocket();
    const got = await acquire(info.callType || "VOICE");
    const now = stateRef.current;
    if (now.uiState !== "incoming" || now.callInfo?.callSessionId !== info.callSessionId) {
      // Missed/cancelled by the caller while the permission dialog was open — nothing to accept.
      if (got) {
        webrtcRef.current.cleanup();
        toastRef.current.show("Cuộc gọi đã kết thúc trước khi bạn kịp nghe.");
      }
      return;
    }
    if (!got) {
      socket.emit("call:reject", { callSessionId: info.callSessionId });
      doCleanup();
      return;
    }
    isCallerRef.current = false;
    socket.emit("call:accept", { callSessionId: info.callSessionId });
    void dismissCallPush(info.callSessionId);
  }, [enabled, acquire, doCleanup]);

  const rejectCall = useCallback(() => {
    const id = stateRef.current.callInfo?.callSessionId;
    if (id && enabled) connectSocket().emit("call:reject", { callSessionId: id });
    if (id) void dismissCallPush(id);
    doCleanup();
  }, [enabled, doCleanup]);

  const cancelCall = useCallback(() => {
    const id = stateRef.current.callInfo?.callSessionId;
    if (id && enabled) connectSocket().emit("call:cancel", { callSessionId: id });
    doCleanup();
  }, [enabled, doCleanup]);

  const endCall = useCallback(() => {
    const info = stateRef.current.callInfo;
    if (!info?.callSessionId) return doCleanup();
    if (enabled) {
      connectSocket().emit(info.origin === "SESSION" ? "call:leave_room" : "call:end", {
        callSessionId: info.callSessionId,
      });
    }
    doCleanup();
  }, [enabled, doCleanup]);

  const broadcastMedia = useCallback(
    (kind: "audio" | "video", on: boolean) => {
      const id = stateRef.current.callInfo?.callSessionId;
      if (enabled && id) getSocket().emit("call:media_toggle", { callSessionId: id, kind, enabled: on });
    },
    [enabled],
  );

  const toggleMute = useCallback(() => {
    const muted = webrtcRef.current.toggleMute();
    dispatch({ type: "TOGGLE_MUTE", payload: muted });
    broadcastMedia("audio", !muted);
  }, [broadcastMedia]);

  const toggleVideo = useCallback(() => {
    const off = webrtcRef.current.toggleVideo();
    dispatch({ type: "TOGGLE_VIDEO", payload: off });
    broadcastMedia("video", !off);
  }, [broadcastMedia]);

  const switchCamera = useCallback(() => webrtcRef.current.switchCamera(), []);

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
        switchCamera,
        localStream: webrtc.localStream,
        remoteStream: webrtc.remoteStream,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}
