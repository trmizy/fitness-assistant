import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  mediaDevices,
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type SessionDescription = { type: string | null; sdp: string };
type IceCandidateInit = { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null };

/**
 * Phase 14.4 — web's hooks/useWebRTC.ts on react-native-webrtc. Same steps, same guarantees:
 * media is acquired first (a VIDEO call whose camera fails still joins audio-only), then a peer
 * connection is built per (re)negotiation, ICE candidates that arrive before the remote
 * description are queued, and closing just the peer keeps local media running (open rooms).
 *
 * The one real difference: the remote side is held as the stream the track event carries, in
 * state, because RTCView renders a stream URL — it cannot watch a mutable MediaStream the way a
 * <video srcObject> does on web.
 */
export function useRNWebRTC(
  onIceCandidate: (candidate: IceCandidateInit) => void,
  onConnectionStateChange?: (state: string) => void,
) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const iceQueue = useRef<IceCandidateInit[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const onIceRef = useRef(onIceCandidate);
  useLayoutEffect(() => {
    onIceRef.current = onIceCandidate;
  });
  const onStateRef = useRef(onConnectionStateChange);
  useLayoutEffect(() => {
    onStateRef.current = onConnectionStateChange;
  });

  /** Mic is required; for VIDEO a failed camera falls back to audio-only (web's same fix). */
  const acquireMedia = useCallback(async (callType: "VOICE" | "VIDEO") => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    let stream: MediaStream;
    if (callType === "VIDEO") {
      try {
        stream = await mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
      } catch {
        stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      }
    } else {
      stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    }
    localRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const dropRemote = useCallback(() => {
    setRemoteStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const createConnection = useCallback(
    (iceServers: IceServer[]) => {
      pcRef.current?.close();
      dropRemote();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      localRef.current?.getTracks().forEach((track) => pc.addTrack(track, localRef.current!));
      // The on* setters are what this version's typings expose (addEventListener is inherited from
      // an untyped EventTarget); the event payloads are the standard WebRTC shapes.
      pc.ontrack = (event: any) => {
        const stream = event?.streams?.[0] as MediaStream | undefined;
        if (stream) setRemoteStream(stream);
      };
      pc.onicecandidate = (event: any) => {
        if (event?.candidate) onIceRef.current(event.candidate.toJSON() as IceCandidateInit);
      };
      pc.onconnectionstatechange = () => {
        onStateRef.current?.(pc.connectionState);
      };
      return pc;
    },
    [dropRemote],
  );

  const flushIce = async (pc: RTCPeerConnection) => {
    for (const candidate of iceQueue.current) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate as never)).catch(() => undefined);
    }
    iceQueue.current = [];
  };

  const createOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) throw new Error("PeerConnection not initialized");
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    return offer as SessionDescription;
  }, []);

  const createAnswer = useCallback(async (offer: SessionDescription) => {
    const pc = pcRef.current;
    if (!pc) throw new Error("PeerConnection not initialized");
    await pc.setRemoteDescription(new RTCSessionDescription(offer as never));
    await flushIce(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer as SessionDescription;
  }, []);

  const setRemoteAnswer = useCallback(async (answer: SessionDescription) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer as never));
    await flushIce(pc);
  }, []);

  const addIceCandidate = useCallback(async (candidate: IceCandidateInit) => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) {
      iceQueue.current.push(candidate);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(candidate as never)).catch(() => undefined);
  }, []);

  /** Returns the NEW muted state. */
  const toggleMute = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled;
  }, []);

  /** Returns the NEW video-off state. */
  const toggleVideo = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled;
  }, []);

  /** Mobile-only: front ↔ back camera (a phone has two; web never needed this). */
  const switchCamera = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0] as unknown as { _switchCamera?: () => void } | undefined;
    track?._switchCamera?.();
  }, []);

  const closePeerConnection = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    dropRemote();
    iceQueue.current = [];
  }, [dropRemote]);

  const cleanup = useCallback(() => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocalStream(null);
    closePeerConnection();
  }, [closePeerConnection]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    localStream,
    remoteStream,
    acquireMedia,
    createConnection,
    createOffer,
    createAnswer,
    setRemoteAnswer,
    addIceCandidate,
    toggleMute,
    toggleVideo,
    switchCamera,
    closePeerConnection,
    cleanup,
  };
}
