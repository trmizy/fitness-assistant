import { useRef, useCallback, useEffect, useState } from "react";

export interface WebRTCHandle {
  /** Acquire mic/camera — call from user gesture (click handler) */
  acquireMedia: (callType: "VOICE" | "VIDEO") => Promise<MediaStream>;
  /** Create RTCPeerConnection with ICE servers + previously acquired stream */
  createConnection: (iceServers: RTCIceServer[]) => RTCPeerConnection;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  createAnswer: (
    offerSdp: RTCSessionDescriptionInit,
  ) => Promise<RTCSessionDescriptionInit>;
  setRemoteAnswer: (answerSdp: RTCSessionDescriptionInit) => Promise<void>;
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  toggleMute: () => boolean;
  toggleVideo: () => boolean;
  /** Open-room sessions: tears down just the peer connection (a peer who left/dropped),
   * keeping local media running — see the doc comment on the implementation. */
  closePeerConnection: () => void;
  cleanup: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream;
}

export function useWebRTC(
  onIceCandidate: (candidate: RTCIceCandidate) => void,
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void,
): WebRTCHandle {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream] = useState<MediaStream>(() => remoteStreamRef.current);
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);

  const onIceCandidateRef = useRef(onIceCandidate);
  onIceCandidateRef.current = onIceCandidate;
  const onConnStateRef = useRef(onConnectionStateChange);
  onConnStateRef.current = onConnectionStateChange;

  /** Step 1: Acquire media — MUST be called from a user gesture (click) */
  const acquireMedia = useCallback(async (callType: "VOICE" | "VIDEO") => {
    // Stop any existing tracks
    localStreamRef.current?.getTracks().forEach((t) => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === "VIDEO",
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  /** Step 2: Create PeerConnection — can be called from socket handler */
  const createConnection = useCallback((iceServers: RTCIceServer[]) => {
    pcRef.current?.close();

    // Open-room reconnects call this a second (or third...) time on the SAME hook instance.
    // Any tracks left in the shared remoteStream belonged to the now-closed connection above
    // and will never receive more frames — without clearing them, the old frame would freeze
    // in place forever alongside the new track once the fresh connection comes up.
    remoteStreamRef.current.getTracks().forEach((t) => {
      remoteStreamRef.current.removeTrack(t);
      t.stop();
    });

    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    // Add local tracks (already acquired via acquireMedia)
    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
    }

    pc.ontrack = (event) => {
      for (const track of event.streams[0]?.getTracks() || []) {
        remoteStreamRef.current.addTrack(track);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) onIceCandidateRef.current(event.candidate);
    };

    pc.onconnectionstatechange = () => {
      onConnStateRef.current?.(pc.connectionState);
    };

    return pc;
  }, []);

  const createOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) throw new Error("PeerConnection not initialized");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }, []);

  const createAnswer = useCallback(
    async (offerSdp: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      if (!pc) throw new Error("PeerConnection not initialized");
      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      // Process queued candidates
      for (const candidate of iceQueueRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
      iceQueueRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return answer;
    },
    [],
  );

  const setRemoteAnswer = useCallback(
    async (answerSdp: RTCSessionDescriptionInit) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
      // Process queued candidates
      for (const candidate of iceQueueRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
      iceQueueRef.current = [];
    },
    [],
  );

  const addIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        iceQueueRef.current.push(candidate);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled;
  }, []);

  const toggleVideo = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled;
  }, []);

  /**
   * Open-room sessions: tears down ONLY the peer connection to someone who just left —
   * local media (camera/mic preview) stays running so this side's own UI stays exactly as
   * it was. Closing here deliberately fires connectionState "closed", never "failed" — the
   * caller (CallContext's onPeerLeftRoom/onPeerDisconnected) uses this specifically so the
   * peer leaving doesn't get misread, a few seconds later, as THIS side's own connection
   * having failed (which would otherwise wrongly end the call on the side that stayed).
   */
  const closePeerConnection = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    remoteStreamRef.current.getTracks().forEach((t) => {
      remoteStreamRef.current.removeTrack(t);
      t.stop();
    });
    iceQueueRef.current = [];
  }, []);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);

    pcRef.current?.close();
    pcRef.current = null;

    remoteStreamRef.current.getTracks().forEach((t) => {
      remoteStreamRef.current.removeTrack(t);
      t.stop();
    });
    iceQueueRef.current = [];
  }, []);

  useEffect(
    () => () => {
      cleanup();
    },
    [cleanup],
  );

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
    closePeerConnection,
    cleanup,
  };
}
