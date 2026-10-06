import { useState } from "react";
import { Text, View } from "react-native";
import { Video } from "lucide-react-native";

import { Button, useToast } from "../../components/ui";
import { sessionService } from "../../services/api";
import { useCall } from "./CallProvider";
import { joinSessionState } from "./callState";

/**
 * Phase 14.4 — "Tham gia buổi học" for an ONLINE coaching session (web: BookingPage /
 * PTDashboard handleJoinSession). Same for both sides: the server mints a join token for the
 * caller (`POST /sessions/:id/join`), then the mic/cam preview opens; nothing is signaled to the
 * other party until "Vào phòng" there.
 */
export function JoinSessionButton({
  session,
}: {
  session: { id: string; sessionMode: string | null | undefined; status: string; startAt: string | null | undefined; endAt: string | null | undefined };
}) {
  const { startSessionPreview } = useCall();
  const toast = useToast();
  const [joining, setJoining] = useState(false);
  const join = joinSessionState(session);
  if (!join.visible) return null;

  const onPress = async () => {
    if (joining || !join.enabled) return;
    setJoining(true);
    try {
      const r = await sessionService.joinSession(session.id);
      await startSessionPreview({
        id: r.sessionId,
        otherUserId: r.otherUserId,
        joinToken: r.joinToken,
        roomClosesAt: r.roomClosesAt,
      });
    } catch (e: any) {
      const msg = e?.response?.data?.error;
      toast.show(typeof msg === "string" && /[À-ỹ]/.test(msg) ? msg : "Chưa vào được phòng học. Thử lại sau.", "danger");
    } finally {
      setJoining(false);
    }
  };

  return (
    <View className="gap-1">
      <Button size="sm" icon={Video} disabled={!join.enabled || joining} onPress={() => void onPress()}>
        {joining ? "Đang vào…" : "Tham gia buổi học"}
      </Button>
      {!join.enabled && join.reason ? (
        <Text className="font-body text-[11px] text-muted-foreground">{join.reason}</Text>
      ) : null}
    </View>
  );
}
