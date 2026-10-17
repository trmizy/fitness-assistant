import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, ChevronLeft } from "lucide-react-native";

import { Badge, Button, Card, Tappable } from "../../src/components/ui";
import { QrScannerView } from "../../src/components/QrScannerView";
import { gymService } from "../../src/services/api";
import { isCheckinToken } from "../../src/features/services/checkin";
import {
  normalizePtCheckinResult,
  ptCheckinDateLabel,
  ptCheckinErrorMessage,
  ptCheckinTimeLabel,
  type PtCheckinResult,
} from "../../src/features/services/ptCheckin";
import { designTokens } from "../../src/theme/colors";
import { useWorkspaceAccent } from "../../src/theme/workspace";

/**
 * Phase 2 / P2.3 — a trainer's QR check-in at the gym (web: CheckinScanModal in PT mode).
 *
 * Same front-desk QR and same camera as the member scan (QrScannerView), but a different request
 * (`POST /me/pt-gym-checkins`) and a different card: the PT is not a member, so there are no visits
 * and no plan — only "you are checked in at <branch> today". The server grants entry when this
 * trainer has a confirmed in-person session at the branch today; it never completes a session and
 * never touches money. A failed scan re-arms after a short pause, like the member screen.
 */
export default function PtGymCheckinScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<PtCheckinResult | null>(null);
  // The scanner reports the same code many times a second — one request per scan, not per frame.
  const busy = useRef(false);

  const checkIn = useMutation({
    mutationFn: (token: string) => gymService.ptCheckInByScan(token),
    onSuccess: (raw) => setResult(normalizePtCheckinResult(raw)),
    onError: (error) => {
      setErrorText(ptCheckinErrorMessage(error));
      setTimeout(() => {
        busy.current = false;
      }, 2500);
    },
  });

  // PT tabs keep a hidden route mounted after "Xong" / back, so without this the next visit would show the
  // previous scan's success card (and never re-scan). Leaving the screen always starts the next visit clean.
  const resetScan = checkIn.reset;
  useFocusEffect(
    useCallback(
      () => () => {
        setResult(null);
        setErrorText(null);
        busy.current = false;
        resetScan();
      },
      [resetScan],
    ),
  );

  const onScanned = (data: string) => {
    if (busy.current || result || !isCheckinToken(data)) return;
    busy.current = true;
    setErrorText(null);
    checkIn.mutate(data.trim());
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/pt/dashboard" as never);
  };

  const date = ptCheckinDateLabel(result?.localDate);
  const time = ptCheckinTimeLabel(result?.firstScanAt);

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
        <Text className="flex-1 font-display text-xl text-foreground" numberOfLines={1}>
          {result ? "Check-in thành công" : "Check-in phòng gym"}
        </Text>
      </View>

      {result ? (
        <View className="gap-4 px-5">
          <Card className="items-center gap-2 p-6">
            <CheckCircle2 size={56} color={accent.primary} />
            <Text className="text-center font-display text-xl text-foreground">
              {result.gymName ?? "Phòng gym"}
            </Text>
            <View className="items-center">
              <Badge tone="success">Đã check-in</Badge>
            </View>
          </Card>
          {date || time ? (
            <Card className="px-4">
              {date ? <Row label="Ngày" value={date} last={!time} /> : null}
              {time ? <Row label="Lần quét đầu tiên" value={time} last /> : null}
            </Card>
          ) : null}
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
