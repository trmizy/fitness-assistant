import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type Svg from "react-native-svg";
import { Maximize2, QrCode as QrIcon, RefreshCw, Share2, X } from "lucide-react-native";

import { Button, Card, EmptyState, ScreenHeader, useToast } from "../../src/components/ui";
import { QrCode } from "../../src/components/QrCode";
import { gymService } from "../../src/services/api";
import { shareLocalFile, writeLocalBase64File } from "../../src/services/files";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors } from "../../src/theme/colors";
import { checkinTimeLabel, qrExpiryLabel, shortMemberId } from "../../src/features/gymOwner/checkinQr";

type QrResponse = { token: string; expiresAt?: number; gymId: string; gymName: string };
type Checkin = { id: string; clientId: string; createdAt: string };

/**
 * E1 — the front-desk check-in QR for one branch (web: `GymCheckinPanel` on GymManagePage). The
 * member scans it with their own phone (14.3); identity comes from their session, so the code on
 * the wall reveals nothing. OWNER sees every branch, a MANAGER only branches in scope — gym-service
 * enforces that (`requireGymScope`), this screen just shows the refusal.
 *
 * Mobile additions over web: the server-signed expiry date (a printed code stops working then), and
 * "Lưu ảnh để in" — a phone cannot print a page the way a browser can, so the QR is rendered to a
 * PNG and handed to the share sheet (print service, Zalo, Drive…).
 */
export default function GymCheckinQrScreen() {
  const { gymId, name } = useLocalSearchParams<{ gymId: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const svgRef = useRef<Svg>(null);
  const [full, setFull] = useState(false);
  const [sharing, setSharing] = useState(false);

  const qrQuery = useQuery<QrResponse>({
    queryKey: ["gym-checkin-qr", gymId],
    queryFn: () => gymService.getGymCheckinQr(gymId),
    enabled: !!gymId,
  });
  const checkinsQuery = useQuery<Checkin[]>({
    queryKey: ["gym-checkins", gymId],
    queryFn: async () => {
      const r = await gymService.listCheckins(gymId);
      return Array.isArray(r) ? r : [];
    },
    enabled: !!gymId,
    // The desk watches arrivals appear as members scan (web polls the same 10 s).
    refetchInterval: 10_000,
  });

  const qr = qrQuery.data;
  const title = qr?.gymName || name || "Chi nhánh";
  const qrSize = Math.min(width - 96, 280);
  const expiry = qrExpiryLabel(qr?.expiresAt);
  const forbidden = (qrQuery.error as any)?.response?.status === 403;

  const sharePng = () => {
    if (!svgRef.current || sharing) return;
    setSharing(true);
    const svg = svgRef.current as unknown as { toDataURL: (cb: (b64: string) => void, o?: object) => void };
    svg.toDataURL(
      async (base64) => {
        try {
          const uri = writeLocalBase64File(`ma-qr-checkin-${String(qr?.gymId ?? gymId).slice(0, 8)}.png`, base64);
          await shareLocalFile(uri, "image/png");
        } catch (e: any) {
          toast.show(e?.message || "Không lưu được ảnh mã QR.", "danger");
        } finally {
          setSharing(false);
        }
      },
      { width: 1024, height: 1024 },
    );
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Mã QR check-in" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={qrQuery.isRefetching || checkinsQuery.isRefetching}
            onRefresh={() => {
              void qrQuery.refetch();
              void checkinsQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        {qrQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : qrQuery.isError || !qr?.token ? (
          <EmptyState
            icon={QrIcon}
            title={forbidden ? "Không có quyền với chi nhánh này" : "Chưa tải được mã QR"}
            description={
              forbidden ? "Chỉ chủ phòng gym hoặc quản lý của chi nhánh mới xem được mã." : "Kéo xuống để thử lại."
            }
          />
        ) : (
          <Card className="items-center gap-3 p-5">
            <Text className="text-center font-display text-lg text-foreground" numberOfLines={2}>
              {title}
            </Text>
            <Text className="text-center font-body text-xs leading-5 text-muted-foreground">
              In mã này và đặt tại quầy lễ tân. Hội viên mở app, quét mã, rồi đưa màn hình xác nhận cho nhân viên kiểm
              tra.
            </Text>
            <Pressable
              onPress={() => setFull(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Phóng to mã QR"
              className="mt-1 overflow-hidden rounded-2xl"
            >
              <QrCode ref={svgRef} value={qr.token} size={qrSize} />
            </Pressable>
            {expiry ? <Text className="font-body text-xs text-muted-foreground">{expiry}</Text> : null}
            <View className="mt-1 w-full flex-row gap-2">
              <View className="flex-1">
                <Button variant="secondary" full icon={Maximize2} onPress={() => setFull(true)}>
                  Phóng to
                </Button>
              </View>
              <View className="flex-1">
                <Button full icon={Share2} disabled={sharing} onPress={sharePng}>
                  {sharing ? "Đang lưu…" : "Lưu ảnh để in"}
                </Button>
              </View>
            </View>
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              className="self-center"
              disabled={qrQuery.isRefetching}
              onPress={() => void qrQuery.refetch()}
            >
              Tạo lại mã
            </Button>
          </Card>
        )}

        {!forbidden ? (
          <Card className="gap-2 p-4">
            <Text className="font-body-semibold text-sm text-foreground">Check-in gần đây</Text>
            {checkinsQuery.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : (checkinsQuery.data ?? []).length === 0 ? (
              <Text className="font-body text-xs text-muted-foreground">Chưa có lượt check-in nào.</Text>
            ) : (
              (checkinsQuery.data ?? []).slice(0, 20).map((c) => (
                <View key={c.id} className="flex-row items-center justify-between rounded-lg bg-panel px-3 py-2">
                  <Text className="font-body text-xs text-foreground">{shortMemberId(c.clientId)}</Text>
                  <Text className="font-body text-xs text-muted-foreground">{checkinTimeLabel(c.createdAt)}</Text>
                </View>
              ))
            )}
          </Card>
        ) : null}
      </ScrollView>

      {/* Blown up so a phone can read it from across the desk. */}
      <Modal
        visible={full && !!qr?.token}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setFull(false)}
      >
        <Pressable className="flex-1 items-center justify-center bg-black/95 px-6" onPress={() => setFull(false)}>
          <Pressable
            onPress={() => setFull(false)}
            accessibilityRole="button"
            accessibilityLabel="Đóng"
            hitSlop={12}
            className="absolute right-5"
            style={{ top: insets.top + 16 }}
          >
            <X size={26} color={darkColors.foreground} />
          </Pressable>
          <Text className="mb-5 text-center font-display text-xl text-foreground">{title}</Text>
          {qr?.token ? <QrCode value={qr.token} size={Math.min(width - 48, height * 0.6)} /> : null}
          <Text className="mt-5 font-body text-sm text-muted-foreground">Quét mã để check-in</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
