import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, ChevronLeft } from "lucide-react-native";

import { Button, Card, Tappable } from "../../../src/components/ui";
import { QrScannerView } from "../../../src/components/QrScannerView";
import { gymService } from "../../../src/services/api";
import {
  checkinErrorMessage,
  isCheckinToken,
  normalizeCheckinResult,
  visitsLabel,
  type CheckinResult,
} from "../../../src/features/services/checkin";
import { designTokens } from "../../../src/theme/colors";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

/**
 * Phase 14.3 — member QR check-in (web: components/gym/CheckinScanModal.tsx, opened from an
 * ACTIVE membership on the Hội viên tab).
 *
 * The camera reads the gym's front-desk QR natively (expo-camera's barcode scanner — no frame
 * decoding in JS, unlike web's jsQR); one scan = one request, and a failed one re-arms after a
 * short pause so the member can re-aim instead of dead-ending. Success replaces the camera with
 * the card the receptionist reads. The camera only runs while this screen is focused.
 */
export default function CheckinScanScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const queryClient = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);
  // The scanner reports the same code many times a second — one request per scan, not per frame.
  const busy = useRef(false);

  const checkIn = useMutation({
    mutationFn: (token: string) => gymService.checkInByScan(token),
    onSuccess: (raw) => {
      setResult(normalizeCheckinResult(raw));
      void queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
    },
    onError: (error) => {
      setErrorText(checkinErrorMessage(error));
      setTimeout(() => {
        busy.current = false;
      }, 2500);
    },
  });

  const onScanned = (data: string) => {
    if (busy.current || result || !isCheckinToken(data)) return;
    busy.current = true;
    setErrorText(null);
    checkIn.mutate(data.trim());
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/client/services?tab=memberships" as never);
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5 pb-4">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={close}
          accessibilityLabel="Quay lại"
        >
          <ChevronLeft size={20} color={designTokens.mutedForeground} />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">
          {result ? "Check-in thành công" : "Quét mã tại phòng gym"}
        </Text>
      </View>

      {result ? (
        <View className="gap-4 px-5">
          <Card className="items-center gap-2 p-6">
            <CheckCircle2 size={56} color={accent.primary} />
            <Text className="font-display text-xl text-foreground">{result.clientName ?? "Hội viên"}</Text>
            {result.gymName ? (
              <Text className="font-body text-xs text-muted-foreground">{result.gymName}</Text>
            ) : null}
          </Card>
          <Card className="px-4">
            {result.planName ? <Row label="Gói tập" value={result.planName} /> : null}
            <Row label="Lượt đã dùng" value={visitsLabel(result)} />
            {result.endDate ? (
              <Row label="Hạn thẻ" value={new Date(result.endDate).toLocaleDateString("vi-VN")} />
            ) : null}
            {result.checkedInAt ? (
              <Row
                label="Thời gian vào"
                value={new Date(result.checkedInAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                last
              />
            ) : null}
          </Card>
          <Text className="text-center font-body text-xs text-muted-foreground">
            Đưa màn hình này cho nhân viên lễ tân xác nhận.
          </Text>
          <Button full onPress={close}>
            Xong
          </Button>
        </View>
      ) : (
        <QrScannerView
          onScanned={onScanned}
          pending={checkIn.isPending}
          errorText={errorText}
          permissionText="Gymini cần quyền camera để quét mã QR tại quầy lễ tân."
          hint="Đưa camera vào mã QR đặt tại quầy lễ tân."
        />
      )}
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${last ? "" : "border-b border-border"}`}>
      <Text className="font-body text-sm text-muted-foreground">{label}</Text>
      <Text className="font-body-semibold text-sm text-foreground">{value}</Text>
    </View>
  );
}
