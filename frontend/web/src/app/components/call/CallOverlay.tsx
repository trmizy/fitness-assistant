import { useEffect, useRef } from "react";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, X, LogOut, UserX } from "lucide-react";
import { useCall } from "../../context/CallContext";

/**
 * NOTE: the overlays in this file deliberately do NOT register with `useBackDismissible`.
 *
 * Every other overlay in the app treats Android Back as "close this". A call is different:
 * dismissing it means rejecting or hanging up on a real person, and Back is pressed by
 * reflex. Silently ending someone's call because they tried to go back is a far worse
 * outcome than Back appearing to do nothing here. Hanging up stays an explicit, deliberate
 * tap on the call controls.
 */

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Incoming call modal ────────────────────────────────────────
function IncomingCallUI() {
  const { state, acceptCall, rejectCall } = useCall();
  const info = state.callInfo;
  if (!info) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 text-center shadow-2xl">
        <div className="w-16 h-16 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-2xl font-bold text-emerald-400 mx-auto mb-4">
          {info.callerName?.charAt(0) || "U"}
        </div>
        <h3 className="text-zinc-100 font-bold text-lg mb-1">
          {info.callerName || "Unknown"}
        </h3>
        <p className="text-zinc-400 text-sm mb-6">
          Incoming {info.callType === "VIDEO" ? "video" : "voice"} call...
        </p>
        <div className="flex items-center justify-center gap-6">
          <button
            onClick={rejectCall}
            className="w-14 h-14 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-full flex items-center justify-center transition-colors"
          >
            <PhoneOff className="w-6 h-6 text-red-400" />
          </button>
          <button
            onClick={acceptCall}
            className="w-14 h-14 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-full flex items-center justify-center transition-colors animate-pulse"
          >
            <Phone className="w-6 h-6 text-green-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Outgoing call (ringing) ────────────────────────────────────
function OutgoingCallUI() {
  const { state, cancelCall } = useCall();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 text-center shadow-2xl">
        <div className="w-16 h-16 bg-blue-500/15 border border-blue-500/20 rounded-full flex items-center justify-center text-2xl font-bold text-blue-400 mx-auto mb-4">
          <Phone className="w-7 h-7 animate-bounce" />
        </div>
        <h3 className="text-zinc-100 font-bold text-lg mb-1">Calling...</h3>
        <p className="text-zinc-400 text-sm mb-6">
          {state.callInfo?.callType === "VIDEO" ? "Video" : "Voice"} call —
          waiting for answer
        </p>
        <button
          onClick={cancelCall}
          className="w-14 h-14 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-full flex items-center justify-center transition-colors mx-auto"
        >
          <PhoneOff className="w-6 h-6 text-red-400" />
        </button>
      </div>
    </div>
  );
}

// ── Open-room preview (mic/cam choice before entering) ──────────
// Meet/Teams-style: joining never forces the camera or mic open — media was already
// acquired (for this live self-view) by startSessionPreview, but toggleMute/toggleVideo work
// on it exactly like they do mid-call, so turning either off here is genuinely "off" the
// moment the room is entered, not just muted-after-the-fact.
function PreviewUI() {
  const { state, confirmJoinFromPreview, cancelPreview, toggleMute, toggleVideo, localStream } =
    useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
        <h3 className="text-zinc-100 font-bold text-lg mb-1">Sẵn sàng vào phòng?</h3>
        <p className="text-zinc-400 text-sm mb-4">
          Chỉnh camera/micro trước khi tham gia buổi tập
        </p>
        <div className="relative w-full aspect-video bg-zinc-800 rounded-xl overflow-hidden mb-4">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {state.isVideoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
              <VideoOff className="w-10 h-10 text-zinc-600" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            onClick={toggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              state.isMuted
                ? "bg-red-500/20 border border-red-500/30"
                : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            {state.isMuted ? (
              <MicOff className="w-5 h-5 text-red-400" />
            ) : (
              <Mic className="w-5 h-5 text-zinc-300" />
            )}
          </button>
          <button
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              state.isVideoOff
                ? "bg-red-500/20 border border-red-500/30"
                : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            {state.isVideoOff ? (
              <VideoOff className="w-5 h-5 text-red-400" />
            ) : (
              <Video className="w-5 h-5 text-zinc-300" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={cancelPreview}
            className="flex-1 py-3 rounded-xl bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
          >
            Huỷ
          </button>
          <button
            onClick={confirmJoinFromPreview}
            className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors"
          >
            Vào phòng
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Open-room waiting screen (joined, alone) ────────────────────
function WaitingUI() {
  const { endCall } = useCall();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 text-center shadow-2xl">
        <div className="w-16 h-16 bg-blue-500/15 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <div className="w-8 h-8 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
        </div>
        <h3 className="text-zinc-100 font-bold text-lg mb-1">Đã vào phòng</h3>
        <p className="text-zinc-400 text-sm mb-6">
          Đang chờ người còn lại tham gia buổi tập...
        </p>
        <button
          onClick={endCall}
          className="w-14 h-14 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-full flex items-center justify-center transition-colors mx-auto"
          title="Rời phòng"
        >
          <LogOut className="w-6 h-6 text-red-400" />
        </button>
      </div>
    </div>
  );
}

// ── Connecting ─────────────────────────────────────────────────
function ConnectingUI() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 text-center shadow-2xl">
        <div className="w-12 h-12 border-4 border-green-500/30 border-t-green-500 rounded-full animate-spin mx-auto mb-4" />
        <h3 className="text-zinc-100 font-bold text-lg mb-1">Connecting...</h3>
        <p className="text-zinc-400 text-sm">Establishing peer connection</p>
      </div>
    </div>
  );
}

// ── Active call UI ─────────────────────────────────────────────
function ActiveCallUI() {
  const { state, endCall, toggleMute, toggleVideo, localStream, remoteStream } =
    useCall();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const isVideo = state.callInfo?.callType === "VIDEO";
  const isSession = state.callInfo?.origin === "SESSION";

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-zinc-950">
      {/* Open-room sessions: the other party stepped out (voluntarily or a network drop) —
          this side stays fully connected and simply waits; the room itself is never ended
          by this. */}
      {isSession && !state.peerPresent && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-amber-500/90 text-black text-sm font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
          <UserX className="w-4 h-4" />
          Đối phương tạm rời phòng — đang chờ quay lại...
        </div>
      )}
      {/* Video area */}
      {isVideo ? (
        <div className="flex-1 min-h-0 relative bg-black">
          {/* Remote video (full) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
          {state.remoteVideoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
              <VideoOff className="w-16 h-16 text-zinc-600" />
            </div>
          )}
          {/* Local video (PiP) */}
          <div className="absolute top-4 right-4 w-32 h-24 sm:w-48 sm:h-36 rounded-xl overflow-hidden border-2 border-zinc-700 shadow-lg">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {state.isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
                <VideoOff className="w-6 h-6 text-zinc-500" />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Voice call — centered avatar */
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-24 h-24 bg-emerald-500/15 border-2 border-emerald-500/20 rounded-full flex items-center justify-center text-4xl font-bold text-emerald-400 mb-4">
            {state.callInfo?.callerName?.charAt(0) || "U"}
          </div>
          <h3 className="text-zinc-100 font-bold text-xl mb-1">
            {state.callInfo?.callerName || "In Call"}
          </h3>
          <p className="text-green-400 text-sm font-medium mb-2">
            {formatDuration(state.callDuration)}
          </p>
          {state.remoteMuted && (
            <p className="text-zinc-500 text-xs">Other party is muted</p>
          )}
          {/* Hidden audio element for voice calls */}
          <audio ref={remoteVideoRef as any} autoPlay />
        </div>
      )}

      {/* Controls bar */}
      <div className="bg-zinc-900 border-t border-zinc-800 px-6 py-4 flex items-center justify-center gap-4">
        {isVideo && (
          <p className="text-green-400 text-sm font-medium mr-4">
            {formatDuration(state.callDuration)}
          </p>
        )}
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            state.isMuted
              ? "bg-red-500/20 border border-red-500/30"
              : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700"
          }`}
        >
          {state.isMuted ? (
            <MicOff className="w-5 h-5 text-red-400" />
          ) : (
            <Mic className="w-5 h-5 text-zinc-300" />
          )}
        </button>
        {isVideo && (
          <button
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              state.isVideoOff
                ? "bg-red-500/20 border border-red-500/30"
                : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700"
            }`}
          >
            {state.isVideoOff ? (
              <VideoOff className="w-5 h-5 text-red-400" />
            ) : (
              <Video className="w-5 h-5 text-zinc-300" />
            )}
          </button>
        )}
        <button
          onClick={endCall}
          title={isSession ? "Rời phòng" : "Kết thúc cuộc gọi"}
          className="w-14 h-14 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center transition-colors shadow-lg shadow-red-500/20"
        >
          {isSession ? (
            <LogOut className="w-6 h-6 text-white" />
          ) : (
            <PhoneOff className="w-6 h-6 text-white" />
          )}
        </button>
      </div>
    </div>
  );
}

// ── Main overlay (renders based on call state) ─────────────────
export function CallOverlay() {
  const { state } = useCall();

  switch (state.uiState) {
    case "incoming":
      return <IncomingCallUI />;
    case "outgoing":
      return <OutgoingCallUI />;
    case "preview":
      return <PreviewUI />;
    case "waiting":
      return <WaitingUI />;
    case "connecting":
      return <ConnectingUI />;
    case "active":
      return <ActiveCallUI />;
    default:
      return null;
  }
}
