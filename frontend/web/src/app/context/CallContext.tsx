import { createContext, useContext, useReducer, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { connectSocket, getSocket } from '../services/socket';
import { useWebRTC } from '../hooks/useWebRTC';
import { useApp } from './AppContext';
import type { CallUIState, CallSessionInfo, CallType } from '../types';

// ── State ──────────────────────────────────────────────────────
interface CallState {
  uiState: CallUIState;
  callInfo: CallSessionInfo | null;
  isMuted: boolean;
  isVideoOff: boolean;
  remoteMuted: boolean;
  remoteVideoOff: boolean;
  callDuration: number;
}

const initialState: CallState = {
  uiState: 'idle',
  callInfo: null,
  isMuted: false,
  isVideoOff: false,
  remoteMuted: false,
  remoteVideoOff: false,
  callDuration: 0,
};

type Action =
  | { type: 'SET_OUTGOING'; payload: CallSessionInfo }
  | { type: 'SET_INCOMING'; payload: CallSessionInfo }
  | { type: 'SET_CONNECTING' }
  | { type: 'SET_ACTIVE' }
  | { type: 'SET_IDLE' }
  | { type: 'TOGGLE_MUTE'; payload: boolean }
  | { type: 'TOGGLE_VIDEO'; payload: boolean }
  | { type: 'SET_REMOTE_MEDIA'; payload: { kind: 'audio' | 'video'; enabled: boolean } }
  | { type: 'TICK_DURATION' }
  | { type: 'UPDATE_CALL_SESSION_ID'; payload: string };

function callReducer(state: CallState, action: Action): CallState {
  switch (action.type) {
    case 'SET_OUTGOING':
      return { ...state, uiState: 'outgoing', callInfo: action.payload };
    case 'SET_INCOMING':
      return { ...state, uiState: 'incoming', callInfo: action.payload };
    case 'SET_CONNECTING':
      return { ...state, uiState: 'connecting' };
    case 'SET_ACTIVE':
      return { ...state, uiState: 'active', callDuration: 0 };
    case 'SET_IDLE':
      return initialState;
    case 'TOGGLE_MUTE':
      return { ...state, isMuted: action.payload };
    case 'TOGGLE_VIDEO':
      return { ...state, isVideoOff: action.payload };
    case 'SET_REMOTE_MEDIA':
      if (action.payload.kind === 'audio') return { ...state, remoteMuted: !action.payload.enabled };
      return { ...state, remoteVideoOff: !action.payload.enabled };
    case 'TICK_DURATION':
      return { ...state, callDuration: state.callDuration + 1 };
    case 'UPDATE_CALL_SESSION_ID':
      return state.callInfo
        ? { ...state, callInfo: { ...state.callInfo, callSessionId: action.payload } }
        : state;
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────
interface CallContextValue {
  state: CallState;
  initiateCall: (calleeId: string, callType: CallType, conversationId: string) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
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

  // ── WebRTC ─────────────────────────────────────────────────
  const handleIceCandidate = useCallback((candidate: RTCIceCandidate) => {
    const s = stateRef.current;
    if (s.callInfo?.callSessionId) {
      const socket = getSocket();
      socket.emit('call:ice_candidate', {
        callSessionId: s.callInfo.callSessionId,
        candidate: candidate.toJSON(),
      });
    }
  }, []);

  const handleConnectionStateChange = useCallback((connState: RTCPeerConnectionState) => {
    if (connState === 'connected') {
      dispatch({ type: 'SET_ACTIVE' });
      if (durationRef.current) clearInterval(durationRef.current);
      durationRef.current = setInterval(() => dispatch({ type: 'TICK_DURATION' }), 1000);
    } else if (connState === 'failed') {
      const s = stateRef.current;
      if (s.callInfo?.callSessionId) {
        const socket = getSocket();
        socket.emit('call:end', { callSessionId: s.callInfo.callSessionId, reason: 'ice_failed' });
      }
      toast.error('Connection failed');
      doCleanup();
    }
  }, []);

  const webrtc = useWebRTC(handleIceCandidate, handleConnectionStateChange);
  const webrtcRef = useRef(webrtc);
  webrtcRef.current = webrtc;

  const doCleanup = useCallback(() => {
    webrtcRef.current.cleanup();
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    dispatch({ type: 'SET_IDLE' });
  }, []);

  // ── Socket listeners (registered once) ─────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = connectSocket();

    const onIncoming = (data: any) => {
      if (stateRef.current.uiState !== 'idle') return;
      iceServersRef.current = data.iceServers || [];
      dispatch({
        type: 'SET_INCOMING',
        payload: {
          callSessionId: data.callSessionId,
          callerId: data.callerId,
          calleeId: '',
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
      dispatch({ type: 'UPDATE_CALL_SESSION_ID', payload: data.callSessionId });
    };

    // Caller receives accepted → create PeerConnection + offer (media already acquired)
    const onAccepted = async (data: any) => {
      if (!isCallerRef.current) return;
      iceServersRef.current = data.iceServers || iceServersRef.current;
      dispatch({ type: 'SET_CONNECTING' });
      try {
        webrtcRef.current.createConnection(iceServersRef.current);
        const offer = await webrtcRef.current.createOffer();
        socket.emit('call:offer', { callSessionId: data.callSessionId, sdp: offer });
      } catch (err) {
        console.error('Failed to create offer:', err);
        socket.emit('call:end', { callSessionId: data.callSessionId, reason: 'webrtc_error' });
        toast.error('Failed to establish connection');
        doCleanup();
      }
    };

    // Callee receives offer → create PeerConnection + answer (media already acquired)
    const onOffer = async (data: any) => {
      if (isCallerRef.current) return;
      dispatch({ type: 'SET_CONNECTING' });
      try {
        webrtcRef.current.createConnection(iceServersRef.current);
        const answer = await webrtcRef.current.createAnswer(data.sdp);
        socket.emit('call:answer', { callSessionId: data.callSessionId, sdp: answer });
      } catch (err) {
        console.error('Failed to create answer:', err);
        socket.emit('call:end', { callSessionId: data.callSessionId, reason: 'webrtc_error' });
        toast.error('Failed to establish connection');
        doCleanup();
      }
    };

    const onAnswer = async (data: any) => {
      try {
        await webrtcRef.current.setRemoteAnswer(data.sdp);
      } catch (err) {
        console.error('Failed to set remote answer:', err);
      }
    };

    const onIceCandidate = async (data: any) => {
      try {
        await webrtcRef.current.addIceCandidate(data.candidate);
      } catch (err) {
        console.error('Failed to add ICE candidate:', err);
      }
    };

    const onCallEnd = () => doCleanup();

    const onMediaToggled = (data: any) => {
      dispatch({ type: 'SET_REMOTE_MEDIA', payload: { kind: data.kind, enabled: data.enabled } });
    };

    const onError = (data: any) => {
      toast.error(data.message || 'Call error');
      doCleanup();
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:initiated', onInitiated);
    socket.on('call:accepted', onAccepted);
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice_candidate', onIceCandidate);
    socket.on('call:rejected', onCallEnd);
    socket.on('call:cancelled', onCallEnd);
    socket.on('call:ended', onCallEnd);
    socket.on('call:missed', onCallEnd);
    socket.on('call:failed', onCallEnd);
    socket.on('call:accepted_elsewhere', onCallEnd);
    socket.on('call:media_toggled', onMediaToggled);
    socket.on('call:error', onError);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:initiated', onInitiated);
      socket.off('call:accepted', onAccepted);
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:ice_candidate', onIceCandidate);
      socket.off('call:rejected', onCallEnd);
      socket.off('call:cancelled', onCallEnd);
      socket.off('call:ended', onCallEnd);
      socket.off('call:missed', onCallEnd);
      socket.off('call:failed', onCallEnd);
      socket.off('call:accepted_elsewhere', onCallEnd);
      socket.off('call:media_toggled', onMediaToggled);
      socket.off('call:error', onError);
    };
  }, [isAuthenticated, doCleanup]);

  // ── Actions (acquire media in click context, THEN signal) ──

  const initiateCall = useCallback(async (calleeId: string, callType: CallType, conversationId: string) => {
    if (stateRef.current.uiState !== 'idle') return;

    // 1. Acquire media FIRST (user gesture context = click)
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('getUserMedia not supported — use HTTPS or localhost');
      return;
    }
    try {
      await webrtcRef.current.acquireMedia(callType);
    } catch (err: any) {
      console.error('getUserMedia failed:', err?.name, err?.message, err);
      toast.error(`Mic/camera error: ${err?.name || 'Unknown'} — ${err?.message || ''}`);
      return;
    }

    // 2. Now emit socket event
    const socket = connectSocket();
    isCallerRef.current = true;

    dispatch({
      type: 'SET_OUTGOING',
      payload: {
        callSessionId: '',
        callerId: '',
        calleeId,
        callType,
        origin: 'CHAT',
        conversationId,
      },
    });

    socket.emit('call:initiate', { calleeId, callType, conversationId, origin: 'CHAT' });
  }, []);

  const acceptCall = useCallback(async () => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;

    // 1. Acquire media FIRST (user gesture context = click)
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('getUserMedia not supported — use HTTPS or localhost');
      doCleanup();
      return;
    }
    try {
      await webrtcRef.current.acquireMedia(s.callInfo.callType || 'VOICE');
    } catch (err: any) {
      console.error('getUserMedia failed:', err?.name, err?.message, err);
      toast.error(`Mic/camera error: ${err?.name || 'Unknown'} — ${err?.message || ''}`);

      // Reject the call since we can't take it
      const socket = connectSocket();
      socket.emit('call:reject', { callSessionId: s.callInfo.callSessionId });
      doCleanup();
      return;
    }

    // 2. Now accept on server
    isCallerRef.current = false;
    const socket = connectSocket();
    socket.emit('call:accept', { callSessionId: s.callInfo.callSessionId });
  }, [doCleanup]);

  const rejectCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;
    const socket = connectSocket();
    socket.emit('call:reject', { callSessionId: s.callInfo.callSessionId });
    doCleanup();
  }, [doCleanup]);

  const cancelCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;
    const socket = connectSocket();
    socket.emit('call:cancel', { callSessionId: s.callInfo.callSessionId });
    doCleanup();
  }, [doCleanup]);

  const endCall = useCallback(() => {
    const s = stateRef.current;
    if (!s.callInfo?.callSessionId) return;
    const socket = connectSocket();
    socket.emit('call:end', { callSessionId: s.callInfo.callSessionId });
    doCleanup();
  }, [doCleanup]);

  const toggleMute = useCallback(() => {
    const newMuted = webrtcRef.current.toggleMute();
    dispatch({ type: 'TOGGLE_MUTE', payload: newMuted });

    const s = stateRef.current;
    if (s.callInfo?.callSessionId) {
      const socket = getSocket();
      socket.emit('call:media_toggle', {
        callSessionId: s.callInfo.callSessionId,
        kind: 'audio',
        enabled: !newMuted,
      });
    }
  }, []);

  const toggleVideo = useCallback(() => {
    const newOff = webrtcRef.current.toggleVideo();
    dispatch({ type: 'TOGGLE_VIDEO', payload: newOff });

    const s = stateRef.current;
    if (s.callInfo?.callSessionId) {
      const socket = getSocket();
      socket.emit('call:media_toggle', {
        callSessionId: s.callInfo.callSessionId,
        kind: 'video',
        enabled: !newOff,
      });
    }
  }, []);

  return (
    <CallContext.Provider
      value={{
        state,
        initiateCall,
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
