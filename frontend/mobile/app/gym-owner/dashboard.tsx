import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  ClipboardList,
  Handshake,
  QrCode,
  Star,
  Ticket,
  TriangleAlert,
  Users,
  Wallet as WalletIcon,
} from "lucide-react-native";

import { Badge, Card, CountUp, EmptyState, Stagger, StaggerItem, Tappable } from "../../src/components/ui";
import { collaborationService, gymService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { formatVND } from "../../src/utils/currency";
import { money } from "../../src/features/wallet/wallet";
import { membershipStatusLabel } from "../../src/features/services/gymDirectory";
import { BranchSwitcher } from "../../src/features/gymOwner/BranchSwitcher";
import {
  acceptedCollabCount,
  attentionItems,
  branchAddress,
  branchName,
  checkinTrend,
  countByStatus,
  isManagerAccount,
  memberLabel,
  membershipMix,
  ownedGyms,
  pendingCollabCount,
  recentMemberships,
  todayCheckinCount,
} from "../../src/features/gymOwner/gymOwner";

/**
 * GY-01 — "Tổng quan" of the gym owner workspace: web's `GymOwnerDashboard`, same seven reads,
 * everything scoped to one selected branch.
 *
 * The switcher at the top switches BRANCHES, never brands. An owner has exactly one brand
 * (`GymBrand.@@unique([ownerId])`), so there is nothing to choose — see features/gymOwner/gymOwner.ts.
 *
 * Membership plans hang off the BRAND, not the branch, so `listOwnedPlans` takes the brandId read
 * off the selected branch. Web carries a comment about exactly this: passing a gymId there is a 404
 * on every dashboard load and a "Gói hội viên" tile permanently stuck at 0.
 *
 * "Cần chú ý" sits ABOVE the numbers (GYM_MANAGEMENT master spec §61/§66 — the owner opens the
 * dashboard and sees what needs them first), and is derived from the branch rows already fetched.
 */
export default function GymOwnerDashboardScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [selectedId, setSelectedId] = useState<string>("");

  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const gyms = ownedGyms(gymsQuery.data);
  const active = gyms.find((g) => g.id === selectedId) ?? gyms[0] ?? null;
  const activeId = active?.id ?? "";
  const brandId = active?.brandId ?? null;

  // Wallet and collaborations are OWNER-only on the server (403 OWNER_ROLE_REQUIRED); a manager's
  // dashboard leaves them out, as web's nav does, instead of showing a load error.
  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const manager = isManagerAccount(statusQuery.data);
  const ownerKnown = statusQuery.isSuccess && !manager;

  const walletQuery = useQuery({
    queryKey: ["owned-gym-wallet", activeId],
    queryFn: () => gymService.getOwnedWallet(activeId),
    enabled: !!activeId && ownerKnown,
  });
  const plansQuery = useQuery({
    queryKey: ["owned-brand-plans", brandId],
    queryFn: () => gymService.listOwnedPlans(brandId!),
    enabled: !!brandId,
  });
  const membershipsQuery = useQuery({
    queryKey: ["owned-gym-memberships", activeId],
    queryFn: () => gymService.listOwnedMemberships(activeId),
    enabled: !!activeId,
  });
  const checkinsQuery = useQuery({
    queryKey: ["owned-gym-checkins", activeId],
    queryFn: () => gymService.listCheckins(activeId),
    enabled: !!activeId,
  });
  const reviewsQuery = useQuery({
    queryKey: ["owned-gym-reviews", activeId],
    queryFn: () => gymService.getGymReviews(activeId),
    enabled: !!activeId,
  });
  const collabQuery = useQuery({
    queryKey: ["owner-collaborations", uid],
    queryFn: () => collaborationService.listForOwner(),
    enabled: ownerKnown,
  });

  const asList = (v: unknown): any[] => (Array.isArray(v) ? v : Array.isArray((v as any)?.data) ? (v as any).data : []);
  const memberships = asList(membershipsQuery.data);
  const checkins = asList(checkinsQuery.data);
  const plans = asList(plansQuery.data);
  const collabs = asList(collabQuery.data);

  const attention = attentionItems(gyms);
  const activeMembers = countByStatus(memberships, "ACTIVE");
  const activePlans = countByStatus(plans, "ACTIVE");
  const todayCheckins = todayCheckinCount(checkins);
  const trend = checkinTrend(checkins);
  const trendMax = Math.max(1, ...trend.map((d) => d.count));
  const mix = membershipMix(memberships);
  const recent = recentMemberships(memberships);
  const avgRating = Number((reviewsQuery.data as any)?.averageRating ?? 0);
  const ratingCount = Number((reviewsQuery.data as any)?.count ?? 0);
  const partneredPts = acceptedCollabCount(collabs, activeId);
  const pendingCollabs = pendingCollabCount(collabs);

  const refreshing =
    gymsQuery.isRefetching || walletQuery.isRefetching || membershipsQuery.isRefetching || checkinsQuery.isRefetching;
  const refresh = () => {
    void gymsQuery.refetch();
    void walletQuery.refetch();
    void membershipsQuery.refetch();
    void checkinsQuery.refetch();
    void reviewsQuery.refetch();
    void plansQuery.refetch();
    void collabQuery.refetch();
  };

  const today = new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground" numberOfLines={1}>
            {user?.firstName ? `Xin chào, ${user.firstName}` : "Xin chào"}
          </Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">{today}</Text>
        </View>

        {gymsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : gymsQuery.isError ? (
          <Text className="mt-6 px-5 font-body text-sm text-destructive">
            Không tải được danh sách chi nhánh. Kéo xuống để thử lại.
          </Text>
        ) : gyms.length === 0 ? (
          <View className="px-5 pt-8">
            <EmptyState
              icon={Building2}
              title="Chưa có chi nhánh nào"
              description="Tạo chi nhánh đầu tiên ở tab Phòng gym để bắt đầu vận hành."
              actionLabel="Mở tab Phòng gym"
              onAction={() => router.push("/gym-owner/gyms")}
            />
          </View>
        ) : (
          <>
            {/* Branch switcher — branches of the one brand, never a brand picker. */}
            <BranchSwitcher gyms={gyms} activeId={activeId} onChange={setSelectedId} />

            <Stagger className="gap-5 px-5 pt-5">
              {attention.length > 0 ? (
                <StaggerItem>
                  <Text className="mb-2 px-1 font-body-semibold text-sm text-foreground">Cần chú ý</Text>
                  <Card className="overflow-hidden">
                    {attention.map((a, i) => (
                      <Tappable
                        key={`${a.kind}-${a.gymId}`}
                        accessibilityLabel={a.title}
                        onPress={() => router.push("/gym-owner/gyms")}
                        className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
                      >
                        <TriangleAlert size={17} color={designTokens.warning} />
                        <View className="min-w-0 flex-1">
                          <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                            {a.title}
                          </Text>
                          <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
                            {a.detail}
                          </Text>
                        </View>
                        <ChevronRight size={16} color={designTokens.mutedForeground} />
                      </Tappable>
                    ))}
                  </Card>
                </StaggerItem>
              ) : null}

              {manager ? null : (
              <StaggerItem>
                <Card className="overflow-hidden p-5">
                  <View className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-primary/15" />
                  <View className="flex-row items-center gap-1.5">
                    <WalletIcon size={15} color={designTokens.mutedForeground} />
                    <Text className="font-body text-sm text-muted-foreground">Ví chi nhánh · khả dụng</Text>
                  </View>
                  {walletQuery.isLoading ? (
                    <ActivityIndicator className="mt-3 self-start" color={accent.primary} />
                  ) : walletQuery.isError ? (
                    <Text className="mt-2 font-body text-sm text-destructive">Không tải được ví chi nhánh.</Text>
                  ) : (
                    <CountUp
                      to={money((walletQuery.data as any)?.availableBalance)}
                      suffix=" ₫"
                      locale="vi-VN"
                      className="mt-1 font-display text-4xl text-foreground"
                    />
                  )}
                  {active ? (
                    <Text className="mt-2 font-body text-xs text-muted-foreground" numberOfLines={1}>
                      {branchName(active)} · {branchAddress(active)}
                    </Text>
                  ) : null}
                </Card>
              </StaggerItem>
              )}

              <StaggerItem>
                <View className="flex-row flex-wrap gap-3">
                  <Metric icon={Users} label="Hội viên đang hoạt động" value={activeMembers} loading={membershipsQuery.isLoading} />
                  <Metric icon={QrCode} label="Lượt check-in hôm nay" value={todayCheckins} loading={checkinsQuery.isLoading} />
                  <Metric icon={Ticket} label="Gói hội viên đang bán" value={activePlans} loading={plansQuery.isLoading} />
                  <Metric
                    icon={Star}
                    label={ratingCount > 0 ? `Đánh giá · ${ratingCount} lượt` : "Chưa có đánh giá"}
                    value={avgRating}
                    decimals={1}
                    loading={reviewsQuery.isLoading}
                  />
                </View>
              </StaggerItem>

              <StaggerItem>
                <Card className="gap-3 p-4">
                  <Text className="font-body-semibold text-sm text-foreground">Lượt check-in 7 ngày qua</Text>
                  {checkinsQuery.isLoading ? (
                    <ActivityIndicator className="self-start" color={accent.primary} />
                  ) : checkinsQuery.isError ? (
                    <Text className="font-body text-xs text-destructive">Không tải được dữ liệu check-in.</Text>
                  ) : (
                    <View className="h-28 flex-row items-end gap-2">
                      {trend.map((d, i) => (
                        <View key={i} className="flex-1 items-center gap-1.5">
                          <Text className="font-body text-[10px] text-muted-foreground">{d.count || ""}</Text>
                          <View
                            className="w-full rounded-t-md bg-primary"
                            style={{ height: Math.max(3, Math.round((d.count / trendMax) * 72)) }}
                          />
                          <Text className="font-body text-[10px] text-muted-foreground" numberOfLines={1}>
                            {d.day}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Card>
              </StaggerItem>

              <StaggerItem>
                <Card className="gap-3 p-4">
                  <Text className="font-body-semibold text-sm text-foreground">Phân bổ hội viên</Text>
                  {membershipsQuery.isLoading ? (
                    <ActivityIndicator className="self-start" color={accent.primary} />
                  ) : mix.length === 0 ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      Chưa có hội viên. Danh sách xuất hiện khi có người mua gói.
                    </Text>
                  ) : (
                    mix.map((row) => {
                      const s = membershipStatusLabel(row.status);
                      const pct = Math.round((row.count / memberships.length) * 100);
                      return (
                        <View key={row.status} className="gap-1.5">
                          <View className="flex-row items-center justify-between">
                            <Badge tone={s.tone}>{s.label}</Badge>
                            <Text className="font-body text-xs text-muted-foreground">
                              {row.count} · {pct}%
                            </Text>
                          </View>
                          <View className="h-1.5 overflow-hidden rounded-full bg-panel">
                            <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </View>
                        </View>
                      );
                    })
                  )}
                </Card>
              </StaggerItem>

              <StaggerItem>
                <Text className="mb-2 px-1 font-display text-lg text-foreground">Hội viên gần đây</Text>
                <Card className="overflow-hidden">
                  {membershipsQuery.isLoading ? (
                    <ActivityIndicator className="m-5 self-start" color={accent.primary} />
                  ) : recent.length === 0 ? (
                    <Text className="p-5 font-body text-xs text-muted-foreground">
                      Danh sách sẽ hiện ở đây khi có người mua gói hội viên.
                    </Text>
                  ) : (
                    recent.map((m: any, i: number) => {
                      const s = membershipStatusLabel(m.status);
                      return (
                        <View key={m.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                          <View className="min-w-0 flex-1">
                            <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                              {memberLabel(m.clientId)}
                            </Text>
                            <Text className="font-body text-xs text-muted-foreground">
                              {m.usedVisits ?? 0} / {m.totalVisits ?? "∞"} lượt · {formatVND(money(m.priceAtPurchase))}
                            </Text>
                          </View>
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </View>
                      );
                    })
                  )}
                </Card>
              </StaggerItem>

              <StaggerItem>
                <Card className="overflow-hidden">
                  <View className="flex-row items-center gap-2 border-b border-border p-4">
                    <ClipboardList size={15} color={accent.primary} />
                    <Text className="font-body-semibold text-sm text-foreground">Thông tin nhanh</Text>
                  </View>
                  {/* Con số và đường đi vào nằm cùng một chỗ — thấy số thì bấm được ngay vào nơi
                      sửa nó, không phải đi tìm trong một menu khác. */}
                  <Tappable
                    accessibilityLabel="Quản lý gói hội viên"
                    onPress={() => router.push("/gym-owner/plans")}
                    className="flex-row items-center justify-between p-4"
                  >
                    <Text className="font-body text-xs text-muted-foreground">Gói hội viên đang bán</Text>
                    <View className="flex-row items-center gap-1.5">
                      <Text className="font-body-semibold text-sm text-foreground">{activePlans}</Text>
                      <ChevronRight size={15} color={designTokens.mutedForeground} />
                    </View>
                  </Tappable>
                  {manager ? null : (
                    <>
                  <Tappable
                    accessibilityLabel="Quản lý hợp tác huấn luyện viên"
                    onPress={() => router.push("/gym-owner/collaborations")}
                    className="flex-row items-center justify-between border-t border-border p-4"
                  >
                    <Text className="font-body text-xs text-muted-foreground">Huấn luyện viên đang hợp tác</Text>
                    <View className="flex-row items-center gap-1.5">
                      <Text className="font-body-semibold text-sm text-foreground">{partneredPts}</Text>
                      <ChevronRight size={15} color={designTokens.mutedForeground} />
                    </View>
                  </Tappable>
                  {pendingCollabs > 0 ? (
                    <Tappable
                      accessibilityLabel="Xem đề nghị hợp tác đang chờ"
                      onPress={() => router.push("/gym-owner/collaborations")}
                      className="flex-row items-center gap-2 border-t border-border p-4"
                    >
                      <Handshake size={15} color={designTokens.warning} />
                      <Text className="flex-1 font-body text-xs text-muted-foreground">
                        {pendingCollabs} đề nghị hợp tác đang chờ bạn trả lời
                      </Text>
                      <ChevronRight size={15} color={designTokens.mutedForeground} />
                    </Tappable>
                  ) : null}
                    </>
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

function Metric({
  icon: Icon,
  label,
  value,
  decimals,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  decimals?: number;
  loading?: boolean;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Card className="min-w-[45%] flex-1 p-4">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
        <Icon size={17} color={accent.primary} />
      </View>
      {loading ? (
        <ActivityIndicator className="mt-2 self-start" color={accent.primary} />
      ) : (
        <CountUp to={value} decimals={decimals ?? 0} className="mt-2 font-display text-2xl text-foreground" />
      )}
      <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}
