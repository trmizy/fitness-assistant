import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, MapPin, Phone, QrCode } from "lucide-react-native";

import { Badge, Card, EmptyState, Input, Stagger, StaggerItem, Tappable, inputPlaceholderColor } from "../../src/components/ui";
import { gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { BranchSwitcher } from "../../src/features/gymOwner/BranchSwitcher";
import { AssistedCheckinPanel, CheckinExceptionsPanel } from "../../src/features/gymOwner/AssistedCheckinPanel";
import { branchAddress, branchName, operationalStatus, ownedGyms, type OwnedGym } from "../../src/features/gymOwner/gymOwner";
import {
  clockLabel,
  filterByName,
  normalizeFrontDeskToday,
  normalizeTodayPts,
  presenceOf,
} from "../../src/features/gymOwner/frontDesk";
import { STAFF_ROLE_LABEL, canUseFrontDesk, staffHomeRoute } from "../../src/features/gymOwner/staffRoles";

/**
 * N15M-08 — "Quầy lễ tân": the receptionist's home (web: `FrontDeskPage`, D15 / D15b / D15c).
 *
 * Only reads a receptionist is allowed (gym-service partner-permissions.ts): their assigned branches
 * (`GET /owner/gyms`, branch info trimmed), today's guests (display name only), today's trainers, the QR
 * check-in, and the assisted check-in. It never calls `/owner/brands`, memberships, plans or the wallet —
 * those answer 403 for this role, and drawing "0 hội viên" from a 403 is a lie.
 */
export default function FrontDeskScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");

  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const allowed = statusQuery.isSuccess ? canUseFrontDesk(statusQuery.data) : false;

  const gymsQuery = useQuery({
    queryKey: ["frontdesk-gyms", uid],
    queryFn: () => gymService.listOwnedGyms(),
    enabled: allowed,
  });
  const gyms = useMemo(() => ownedGyms(gymsQuery.data).filter((g) => g.status !== "DRAFT"), [gymsQuery.data]);
  const active: OwnedGym | null = gyms.find((g) => g.id === selectedId) ?? gyms[0] ?? null;
  const gymId = active?.id ?? "";

  const todayQuery = useQuery({
    queryKey: ["frontdesk-today", uid, gymId],
    queryFn: async () => normalizeFrontDeskToday(await gymService.getFrontDeskToday(gymId)),
    enabled: !!gymId && allowed,
    refetchInterval: 15_000,
  });
  const ptsQuery = useQuery({
    queryKey: ["gym-pt-checkins-today", uid, gymId],
    queryFn: async () => normalizeTodayPts(await gymService.listPtCheckinsToday(gymId)),
    enabled: !!gymId && allowed,
    refetchInterval: 15_000,
  });

  const rows = useMemo(() => filterByName(todayQuery.data?.clients ?? [], search), [todayQuery.data, search]);

  if (statusQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }
  // A role with no front desk (accountant) goes to its own tab; an unreadable role stays shut.
  if (statusQuery.isSuccess && !allowed) {
    return <Redirect href={staffHomeRoute(statusQuery.data) as never} />;
  }
  if (statusQuery.isError) {
    return (
      <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 24 }}>
        <EmptyState icon={Building2} title="Chưa kiểm tra được quyền" description="Kéo xuống hoặc mở lại ứng dụng để thử lại." />
      </View>
    );
  }

  const role = (statusQuery.data as { role?: keyof typeof STAFF_ROLE_LABEL } | undefined)?.role;
  const op = operationalStatus(active?.operationalStatus);
  const phone = (active as { phone?: string | null } | null)?.phone;

  const refresh = () => {
    void gymsQuery.refetch();
    void todayQuery.refetch();
    void ptsQuery.refetch();
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={gymsQuery.isRefetching || todayQuery.isRefetching}
            onRefresh={refresh}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Quầy lễ tân</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">
            {role && STAFF_ROLE_LABEL[role] ? `${STAFF_ROLE_LABEL[role]} · ` : ""}QR check-in, check-in hộ và khách hôm nay
          </Text>
        </View>

        {gymsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : gymsQuery.isError ? (
          <Text className="mt-6 px-5 font-body text-sm text-destructive">Không tải được chi nhánh. Kéo xuống để thử lại.</Text>
        ) : gyms.length === 0 || !active ? (
          <View className="px-5 pt-8">
            <EmptyState
              icon={MapPin}
              title="Chưa có chi nhánh nào được gán"
              description="Hãy nhờ chủ phòng gym gán chi nhánh cho tài khoản của bạn."
            />
          </View>
        ) : (
          <>
            <BranchSwitcher gyms={gyms} activeId={gymId} onChange={setSelectedId} />

            <Stagger className="gap-5 px-5 pt-5">
              <StaggerItem>
                <Card className="gap-2 p-4">
                  <View className="flex-row items-start justify-between gap-3">
                    <Text className="min-w-0 flex-1 font-display text-base text-foreground">{branchName(active)}</Text>
                    {op ? <Badge tone={op.tone}>{op.label}</Badge> : null}
                  </View>
                  <View className="flex-row items-start gap-1.5">
                    <MapPin size={14} color={designTokens.mutedForeground} />
                    <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">{branchAddress(active)}</Text>
                  </View>
                  {phone ? (
                    <View className="flex-row items-center gap-1.5">
                      <Phone size={14} color={designTokens.mutedForeground} />
                      <Text className="font-body text-xs text-muted-foreground">{phone}</Text>
                    </View>
                  ) : null}
                </Card>
              </StaggerItem>

              <StaggerItem>
                <Card className="overflow-hidden">
                  <Tappable
                    accessibilityLabel="Mở mã QR check-in của chi nhánh"
                    onPress={() => router.push({ pathname: "/gym-owner/checkin-qr", params: { gymId, name: branchName(active) } })}
                    className="min-h-[64px] flex-row items-center gap-3 p-4"
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                      <QrCode size={18} color={accent.primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground">Mã QR check-in</Text>
                      <Text className="font-body text-xs text-muted-foreground">Phóng to cho hội viên quét, xem lượt vào gần đây</Text>
                    </View>
                    <ChevronRight size={16} color={designTokens.mutedForeground} />
                  </Tappable>
                </Card>
              </StaggerItem>

              <StaggerItem>
                <AssistedCheckinPanel gymId={gymId} />
              </StaggerItem>

              <StaggerItem>
                <CheckinExceptionsPanel gymId={gymId} />
              </StaggerItem>

              <StaggerItem>
                <Card className="gap-3 p-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="font-body-semibold text-sm text-foreground">Khách hôm nay</Text>
                    <Text className="font-body text-[11px] text-muted-foreground">{todayQuery.data?.clients.length ?? 0} người</Text>
                  </View>
                  <Text className="font-body text-[11px] text-muted-foreground">
                    Người đã check-in hoặc có lịch tập tại chi nhánh này hôm nay.
                  </Text>
                  <Input
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Tìm theo tên"
                    placeholderTextColor={inputPlaceholderColor}
                    accessibilityLabel="Tìm khách theo tên"
                    autoCorrect={false}
                  />
                  {todayQuery.isLoading ? (
                    <ActivityIndicator color={accent.primary} />
                  ) : todayQuery.isError ? (
                    <Text className="font-body text-xs text-destructive">Không tải được danh sách khách hôm nay.</Text>
                  ) : rows.length === 0 ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      {search.trim() ? "Không có khách phù hợp." : "Hôm nay chưa có khách. Khách hiện ở đây khi họ check-in hoặc có lịch tập."}
                    </Text>
                  ) : (
                    rows.map((c, i) => {
                      const p = presenceOf(c);
                      return (
                        <View key={`${i}-${c.displayName}`} className="min-h-11 flex-row items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2">
                          <Text className="min-w-0 flex-1 font-body text-sm text-foreground" numberOfLines={1}>
                            {c.displayName}
                          </Text>
                          <Badge tone={p.kind === "CHECKED_IN" ? "success" : "warning"}>{p.label}</Badge>
                        </View>
                      );
                    })
                  )}
                  {todayQuery.data && !todayQuery.data.bookingsAvailable ? (
                    <Text className="font-body text-[11px] text-warning">
                      Chưa tải được lịch tập hôm nay — danh sách chỉ gồm người đã check-in.
                    </Text>
                  ) : null}
                </Card>
              </StaggerItem>

              <StaggerItem>
                <Card className="gap-2 p-4">
                  <Text className="font-body-semibold text-sm text-foreground">Huấn luyện viên đã check-in hôm nay</Text>
                  {ptsQuery.isLoading ? (
                    <ActivityIndicator color={accent.primary} />
                  ) : ptsQuery.isError ? (
                    <Text className="font-body text-xs text-muted-foreground">Chưa tải được danh sách. Kéo xuống để thử lại.</Text>
                  ) : (ptsQuery.data ?? []).length === 0 ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      Hôm nay chưa có huấn luyện viên nào check-in tại chi nhánh này.
                    </Text>
                  ) : (
                    (ptsQuery.data ?? []).map((p) => (
                      <View key={p.id} className="min-h-11 flex-row items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2">
                        <Text className="min-w-0 flex-1 font-body text-sm text-foreground" numberOfLines={1}>
                          {p.ptName}
                        </Text>
                        <Text className="font-body text-xs text-muted-foreground">{clockLabel(p.firstScanAt)}</Text>
                      </View>
                    ))
                  )}
                </Card>
              </StaggerItem>
            </Stagger>
          </>
        )}
      </ScrollView>
    </View>
  );
}
