import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { RTCView, type MediaStream } from "react-native-webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Clock,
  LogOut,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  SwitchCamera,
  TriangleAlert,
  UserX,
  Video,
  VideoOff,
} from "lucide-react-native";

import { Tappable, useToast } from "../../components/ui";
import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { useCall } from "./CallProvider";
import { formatCountdown, formatDuration, ROOM_CLOSING_SOON_MS } from "./callState";

/**
 * Phase 14.4 — the call UI (web: components/call/CallOverlay.tsx), one full-screen Modal over
 * whatever screen is open, driven only by the call state.
 *
 * Android Back deliberately does nothing here (Modal onRequestClose is a no-op), exactly as web
 * refuses useBackDismissible: dismissing a call means hanging up on a real person, and Back is
 * pressed by reflex. Hanging up stays an explicit tap on the red button.
 */
export function CallOverlay() {
  const { state } = useCall();
  if (state.uiState === "idle") return null;

  const body = (() => {
    switch (state.uiState) {
      case "incoming":
        return <IncomingCall />;
      case "outgoing":
        return <OutgoingCall />;
      case "preview":
        return <Preview />;
      case "waiting":
        return <Waiting />;
      case "connecting":
        return <Connecting />;
      case "active":
        return <ActiveCall />;
      default:
        return null;
    }
  })();

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      {body}
    </Modal>
  );
}

// ── Pieces ────────────────────────────────────────────────────────

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-black/80 px-6">
      <View className="w-full max-w-sm items-center rounded-3xl border border-border bg-card p-7">{children}</View>
    </View>
  );
}

function RoundButton({
  onPress,
  label,
  tone = "neutral",
  size = 56,
  children,
}: {
  onPress: () => void;
  label: string;
  tone?: "neutral" | "danger" | "success" | "off";
  size?: number;
  children: ReactNode;
}) {
  const bg =
    tone === "danger"
      ? darkColors.destructive
      : tone === "success"
        ? designTokens.primaryDeep
        : tone === "off"
          ? `${darkColors.destructive}33`
          : darkColors.muted;
  return (
    <Tappable
      onPress={onPress}
      accessibilityLabel={label}
      className="items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      {children}
    </Tappable>
  );
}

function Initial({ name, color }: { name?: string; color: string }) {
  return (
    <View
      className="mb-4 h-20 w-20 items-center justify-center rounded-full"
      style={{ backgroundColor: `${color}26` }}
    >
      <Text className="font-display text-3xl" style={{ color }}>
        {(name?.trim().charAt(0) || "?").toUpperCase()}
      </Text>
    </View>
  );
}

/** Open-room countdown; calls onExpire once when it crosses zero (the room really closes client-side). */
function useRoomCountdown(closesAt: string | undefined, onExpire: () => void) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const fired = useRef(false);
  const onExpireRef = useRef(onExpire);
  useLayoutEffect(() => {
    onExpireRef.current = onExpire;
  });
  useEffect(() => {
    fired.current = false;
    if (!closesAt) return;
    const target = new Date(closesAt).getTime();
    const tick = () => {
      const left = target - Date.now();
      setRemaining(left);
      if (left <= 0 && !fired.current) {
        fired.current = true;
        onExpireRef.current();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [closesAt]);
  return closesAt ? remaining : null;
}

function CountdownBadge({ remainingMs }: { remainingMs: number | null }) {
  if (remainingMs == null || remainingMs <= 0) return null;
  const soon = remainingMs <= ROOM_CLOSING_SOON_MS;
  const color = soon ? designTokens.warning : designTokens.mutedForeground;
  return (
    <View
      className="flex-row items-center gap-1.5 rounded-full px-3 py-1"
      style={{ backgroundColor: soon ? `${designTokens.warning}26` : darkColors.muted }}
    >
      {soon ? <TriangleAlert size={12} color={color} /> : <Clock size={12} color={color} />}
      <Text className="font-body-medium text-xs" style={{ color }}>
        {soon ? `Phòng đóng sau ${formatCountdown(remainingMs)}` : `Còn ${formatCountdown(remainingMs)}`}
      </Text>
    </View>
  );
}

function StreamView({ stream, mirror, fit = "cover" }: { stream: MediaStream | null; mirror?: boolean; fit?: "cover" | "contain" }) {
  if (!stream) return null;
  return <RTCView streamURL={stream.toURL()} objectFit={fit} mirror={mirror} style={{ flex: 1 }} zOrder={0} />;
}

// ── States ────────────────────────────────────────────────────────

function IncomingCall() {
  const { state, acceptCall, rejectCall } = useCall();
  const accent = useWorkspaceAccent();
  const info = state.callInfo;
  return (
    <Backdrop>
      <Initial name={info?.callerName} color={accent.primary} />
      <Text className="font-display text-xl text-foreground">{info?.callerName || "Cuộc gọi đến"}</Text>
      <Text className="mb-7 mt-1 font-body text-sm text-muted-foreground">
        {info?.callType === "VIDEO" ? "Đang gọi video cho bạn…" : "Đang gọi thoại cho bạn…"}
      </Text>
      <View className="flex-row gap-10">
        <RoundButton label="Từ chối" tone="danger" onPress={rejectCall}>
          <PhoneOff size={24} color="#fff" />
        </RoundButton>
        <RoundButton label="Nghe máy" tone="success" onPress={acceptCall}>
          {info?.callType === "VIDEO" ? <Video size={24} color="#fff" /> : <Phone size={24} color="#fff" />}
        </RoundButton>
      </View>
    </Backdrop>
  );
}

function OutgoingCall() {
  const { state, cancelCall } = useCall();
  const accent = useWorkspaceAccent();
  return (
    <Backdrop>
      <Initial name={state.callInfo?.callerName} color={accent.primary} />
      <Text className="font-display text-xl text-foreground">{state.callInfo?.callerName || "Đang gọi…"}</Text>
      <Text className="mb-7 mt-1 font-body text-sm text-muted-foreground">
        {state.callInfo?.callType === "VIDEO" ? "Cuộc gọi video — đang chờ bắt máy" : "Cuộc gọi thoại — đang chờ bắt máy"}
      </Text>
      <RoundButton label="Huỷ cuộc gọi" tone="danger" onPress={cancelCall}>
        <PhoneOff size={24} color="#fff" />
      </RoundButton>
    </Backdrop>
  );
}

function MediaToggles({ size = 48 }: { size?: number }) {
  const { state, toggleMute, toggleVideo } = useCall();
  return (
    <>
      <RoundButton label={state.isMuted ? "Bật micro" : "Tắt micro"} tone={state.isMuted ? "off" : "neutral"} size={size} onPress={toggleMute}>
        {state.isMuted ? <MicOff size={20} color={darkColors.destructive} /> : <Mic size={20} color={darkColors.foreground} />}
      </RoundButton>
      <RoundButton label={state.isVideoOff ? "Bật camera" : "Tắt camera"} tone={state.isVideoOff ? "off" : "neutral"} size={size} onPress={toggleVideo}>
        {state.isVideoOff ? <VideoOff size={20} color={darkColors.destructive} /> : <Video size={20} color={darkColors.foreground} />}
      </RoundButton>
    </>
  );
}

function Preview() {
  const { state, confirmJoinFromPreview, cancelPreview, localStream } = useCall();
  const accent = useWorkspaceAccent();
  return (
    <Backdrop>
      <Text className="font-display text-xl text-foreground">Sẵn sàng vào phòng?</Text>
      <Text className="mb-4 mt-1 text-center font-body text-sm text-muted-foreground">
        Chỉnh camera/micro trước khi tham gia buổi tập
      </Text>
      <View className="mb-4 aspect-[3/4] w-full overflow-hidden rounded-2xl bg-panel">
        {!state.isVideoOff ? <StreamView stream={localStream} mirror /> : null}
        {state.isVideoOff ? (
          <View className="absolute inset-0 items-center justify-center">
            <VideoOff size={36} color={designTokens.mutedForeground} />
          </View>
        ) : null}
      </View>
      <View className="mb-5 flex-row gap-4">
        <MediaToggles />
      </View>
      <View className="w-full flex-row gap-3">
        <Tappable className="h-12 flex-1 items-center justify-center rounded-xl border border-border bg-panel" onPress={cancelPreview}>
          <Text className="font-body-medium text-foreground">Huỷ</Text>
        </Tappable>
        <Tappable
          className="h-12 flex-1 items-center justify-center rounded-xl"
          style={{ backgroundColor: accent.primary }}
          onPress={confirmJoinFromPreview}
        >
          <Text className="font-body-semibold" style={{ color: accent.onPrimary }}>
            Vào phòng
          </Text>
        </Tappable>
      </View>
    </Backdrop>
  );
}

function Waiting() {
  const { state, endCall } = useCall();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const remaining = useRoomCountdown(state.callInfo?.roomClosesAt, () => {
    toast.show("Phòng học đã hết giờ.");
    endCall();
  });
  return (
    <Backdrop>
      <ActivityIndicator size="large" color={accent.primary} />
      <Text className="mt-4 font-display text-xl text-foreground">Đã vào phòng</Text>
      <Text className="mb-4 mt-1 text-center font-body text-sm text-muted-foreground">
        Đang chờ người còn lại tham gia buổi tập…
      </Text>
      <View className="mb-6">
        <CountdownBadge remainingMs={remaining} />
      </View>
      <RoundButton label="Rời phòng" tone="danger" onPress={endCall}>
        <LogOut size={22} color="#fff" />
      </RoundButton>
    </Backdrop>
  );
}

function Connecting() {
  const { state, endCall } = useCall();
  const accent = useWorkspaceAccent();
  const isSession = state.callInfo?.origin === "SESSION";
  // Web has no button here (a stuck tab can be reloaded); the app's overlay is a Modal that ignores
  // Back, so without one a peer that never answers the offer would trap the user on this screen.
  return (
    <Backdrop>
      <ActivityIndicator size="large" color={accent.primary} />
      <Text className="mt-4 font-display text-xl text-foreground">Đang kết nối…</Text>
      <Text className="mb-7 mt-1 font-body text-sm text-muted-foreground">Đang thiết lập cuộc gọi</Text>
      <RoundButton label={isSession ? "Rời phòng" : "Kết thúc cuộc gọi"} tone="danger" onPress={endCall}>
        <PhoneOff size={24} color="#fff" />
      </RoundButton>
    </Backdrop>
  );
}

function ActiveCall() {
  const { state, endCall, switchCamera, localStream, remoteStream } = useCall();
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const isVideo = state.callInfo?.callType === "VIDEO";
  const isSession = state.callInfo?.origin === "SESSION";
  const remaining = useRoomCountdown(state.callInfo?.roomClosesAt, () => {
    toast.show("Phòng học đã hết giờ.");
    endCall();
  });

  return (
    <View className="flex-1 bg-background">
      {isVideo ? (
        <View className="flex-1 bg-black">
          {!state.remoteVideoOff ? <StreamView stream={remoteStream} fit="cover" /> : null}
          {state.remoteVideoOff ? (
            <View className="absolute inset-0 items-center justify-center bg-card">
              <VideoOff size={48} color={designTokens.mutedForeground} />
              <Text className="mt-2 font-body text-sm text-muted-foreground">Đối phương đã tắt camera</Text>
            </View>
          ) : null}
          <View
            className="absolute right-4 h-44 w-32 overflow-hidden rounded-2xl border-2 border-border bg-panel"
            style={{ top: insets.top + 12 }}
          >
            {!state.isVideoOff ? <StreamView stream={localStream} mirror /> : null}
            {state.isVideoOff ? (
              <View className="absolute inset-0 items-center justify-center">
                <VideoOff size={22} color={designTokens.mutedForeground} />
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center">
          <Initial name={state.callInfo?.callerName} color={accent.primary} />
          <Text className="font-display text-2xl text-foreground">{state.callInfo?.callerName || "Đang gọi"}</Text>
          <Text className="mt-1 font-body-medium text-sm" style={{ color: accent.primary }}>
            {formatDuration(state.callDuration)}
          </Text>
          {state.remoteMuted ? <Text className="mt-2 font-body text-xs text-muted-foreground">Đối phương đang tắt micro</Text> : null}
        </View>
      )}

      {isSession && !state.peerPresent ? (
        <View
          className="absolute left-4 right-4 flex-row items-center gap-2 rounded-full px-4 py-2"
          style={{ top: insets.top + 12, backgroundColor: designTokens.warning }}
        >
          <UserX size={16} color="#000" />
          <Text className="flex-1 font-body-medium text-sm text-black">Đối phương tạm rời phòng — đang chờ quay lại…</Text>
        </View>
      ) : null}

      <View
        className="items-center gap-3 border-t border-border bg-card px-6 pt-4"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <View className="flex-row items-center gap-3">
          {isVideo ? (
            <Text className="font-body-medium text-sm" style={{ color: accent.primary }}>
              {formatDuration(state.callDuration)}
            </Text>
          ) : null}
          {isSession ? <CountdownBadge remainingMs={remaining} /> : null}
        </View>
        <View className="flex-row items-center gap-4">
          {isVideo ? <MediaToggles /> : <MediaTogglesAudioOnly />}
          {isVideo ? (
            <RoundButton label="Đổi camera" size={48} onPress={switchCamera}>
              <SwitchCamera size={20} color={darkColors.foreground} />
            </RoundButton>
          ) : null}
          <RoundButton label={isSession ? "Rời phòng" : "Kết thúc cuộc gọi"} tone="danger" onPress={endCall}>
            {isSession ? <LogOut size={24} color="#fff" /> : <PhoneOff size={24} color="#fff" />}
          </RoundButton>
        </View>
      </View>
    </View>
  );
}

function MediaTogglesAudioOnly() {
  const { state, toggleMute } = useCall();
  return (
    <RoundButton label={state.isMuted ? "Bật micro" : "Tắt micro"} tone={state.isMuted ? "off" : "neutral"} size={48} onPress={toggleMute}>
      {state.isMuted ? <MicOff size={20} color={darkColors.destructive} /> : <Mic size={20} color={darkColors.foreground} />}
    </RoundButton>
  );
}
