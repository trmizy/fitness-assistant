import { useMemo } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Award,
  Bell,
  ChevronRight,
  Download,
  Dumbbell,
  LogOut,
  ScanLine,
  Settings as SettingsIcon,
  Upload,
  UserPen,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";

import { Avatar, Badge, Card, CountUp, Stagger, StaggerItem, Tappable } from "../../../src/components/ui";
import { inbodyService, profileService, statsService, walletService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { darkColors, designTokens } from "../../../src/theme/colors";
import { formatVND } from "../../../src/utils/currency";
import { addDays, toDateInputValue } from "../../../src/utils/date";
import { profileStats } from "../../../src/features/profile/profile";

/**
 * CL-05 — "Cá nhân", the design's Profile hub (screens/Profile.tsx): identity card + three stats,
 * the workspace switch, the PT application entry, the settings menu, log out.
 *
 * Kept from the design only what is real for THIS account:
 *  - the three stats are counted from the activity heatmap and InBody history (the design's "PR"
 *    has no per-user total anywhere in the API, so InBody scans take its place);
 *  - "Vào không gian Huấn luyện viên" shows only for an approved PT. The design's Gym-owner and
 *    Admin cards never apply here: those roles cannot enter the client workspace at all.
 * The editable profile form (web's ProfilePage) is one tap away under "Chỉnh sửa hồ sơ".
 */
export default function ClientProfileScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user, logout, setActiveView } = useApp();
  const userId = user?.id ?? "guest";

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => (await profileService.getProfile())?.profile ?? null,
    enabled: !!user?.id,
  });
  const profile: any = profileQuery.data;

  const range = useMemo(() => {
    const to = new Date();
    return { from: toDateInputValue(addDays(to, -364)), to: toDateInputValue(to) };
  }, []);
  const activityQuery = useQuery({
    queryKey: ["activity-heatmap", "profile-year", range.from],
    queryFn: () => statsService.getActivityHeatmap(range.from, range.to),
  });
  const inbodyQuery = useQuery({ queryKey: ["inbody-history"], queryFn: inbodyService.getHistory });
  const walletQuery = useQuery({ queryKey: ["client-wallet", userId], queryFn: () => walletService.getWallet() });

  const stats = profileStats(activityQuery.data?.days, inbodyQuery.data);
  const isPT = !!(user?.isPT || user?.role === "PT" || profile?.isPT);
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Bạn";
  const balance = (walletQuery.data as any)?.availableBalance;

  const menu: { icon: LucideIcon; label: string; hint?: string; href: Href }[] = [
    { icon: UserPen, label: "Chỉnh sửa hồ sơ", href: "/client/profile/edit" },
    { icon: ScanLine, label: "Kết quả InBody", hint: stats.inbodyScans ? `${stats.inbodyScans} lần đo` : undefined, href: "/client/inbody" },
    { icon: Dumbbell, label: "Thiết bị tập luyện", href: "/client/profile/equipment" },
    { icon: Wallet, label: "Ví của tôi", hint: balance != null ? formatVND(Number(balance)) : undefined, href: "/client/profile/wallet" },
    { icon: Bell, label: "Thông báo", href: "/client/profile/notification-prefs" },
    { icon: SettingsIcon, label: "Cài đặt", href: "/client/profile/settings" },
    { icon: Upload, label: "Nhập lịch sử tập", href: "/client/workout/import" },
    { icon: Download, label: "Xuất dữ liệu", href: "/client/profile/export" },
  ];

  const refreshing = profileQuery.isRefetching || activityQuery.isRefetching || walletQuery.isRefetching;
  const refresh = () => {
    void profileQuery.refetch();
    void activityQuery.refetch();
    void inbodyQuery.refetch();
    void walletQuery.refetch();
  };

  const confirmLogout = () =>
    Alert.alert("Đăng xuất?", "Bạn sẽ cần đăng nhập lại để dùng Gymini.", [
      { text: "Huỷ", style: "cancel" },
      { text: "Đăng xuất", style: "destructive", onPress: () => void logout() },
    ]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 112, paddingHorizontal: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <Text className="mb-5 font-display text-2xl text-foreground">Cá nhân</Text>
      <Stagger className="gap-5">
        <StaggerItem>
          <Card className="p-5">
            <View className="flex-row items-center gap-4">
              <Avatar uri={profile?.photoUrl} name={name} size={64} />
              <View className="min-w-0 flex-1">
                <Text className="font-display text-lg text-foreground" numberOfLines={1}>
                  {name}
                </Text>
                <Text className="font-body text-sm text-muted-foreground" numberOfLines={1}>
                  {user?.email}
                </Text>
                <View className="mt-1.5 flex-row">
                  <Badge tone="success">{isPT ? "Huấn luyện viên" : "Hội viên"}</Badge>
                </View>
              </View>
            </View>
            <View className="mt-5 flex-row rounded-xl bg-panel py-3.5">
              <Stat value={stats.sessions} label="Buổi tập (12 tháng)" />
              <View className="w-px bg-border" />
              <Stat value={stats.streak} label="Chuỗi ngày" />
              <View className="w-px bg-border" />
              <Stat value={stats.inbodyScans} label="Lần đo InBody" />
            </View>
          </Card>
        </StaggerItem>

        {isPT ? (
          <StaggerItem>
            <Card
              className="flex-row items-center gap-3 border-primary/30 bg-primary/5 p-4"
              onPress={() => {
                setActiveView("pt");
                router.replace("/pt/dashboard");
              }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                <ArrowLeftRight size={20} color={accent.primary} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">Vào không gian Huấn luyện viên</Text>
                <Text className="font-body text-xs text-muted-foreground">Quản lý học viên, lịch dạy & thu nhập</Text>
              </View>
              <ChevronRight size={18} color={designTokens.mutedForeground} />
            </Card>
          </StaggerItem>
        ) : (
          <StaggerItem>
            <Card className="flex-row items-center gap-3 p-4" onPress={() => router.push("/client/profile/pt-application")}>
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                <Award size={20} color={designTokens.mutedForeground} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">Hồ sơ ứng tuyển PT</Text>
                <Text className="font-body text-xs text-muted-foreground">Nộp đơn hoặc xem trạng thái đơn của bạn</Text>
              </View>
              <ChevronRight size={18} color={designTokens.mutedForeground} />
            </Card>
          </StaggerItem>
        )}

        <StaggerItem>
          <Card className="overflow-hidden">
            {menu.map((m, i) => (
              <Tappable
                key={m.label}
                onPress={() => router.push(m.href)}
                className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <View className="h-9 w-9 items-center justify-center rounded-lg bg-panel">
                  <m.icon size={17} color={designTokens.mutedForeground} />
                </View>
                <Text className="flex-1 font-body-semibold text-sm text-foreground">{m.label}</Text>
                {m.hint ? <Text className="font-body text-sm text-muted-foreground">{m.hint}</Text> : null}
                <ChevronRight size={16} color={designTokens.mutedForeground} />
              </Tappable>
            ))}
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Tappable onPress={confirmLogout} className="flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5">
            <LogOut size={17} color={darkColors.destructive} />
            <Text className="font-body-semibold text-sm text-destructive">Đăng xuất</Text>
          </Tappable>
        </StaggerItem>
      </Stagger>
    </ScrollView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 items-center px-1">
      <CountUp to={value} className="font-display text-xl text-foreground" />
      <Text className="mt-0.5 text-center font-body text-[11px] text-muted-foreground">{label}</Text>
    </View>
  );
}
