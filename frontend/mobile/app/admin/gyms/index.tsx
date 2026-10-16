import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronRight, MapPin, Store, TriangleAlert } from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../../src/components/ui";
import { adminService } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { friendlyError } from "../../../src/features/partnerApplication/partnerApplication";
import { branchStatus } from "../../../src/features/gymOwner/gymOwner";
import {
  approvesBrandToo,
  brandRenameQueue,
  brandRows,
  closedNeedingAttention,
  displayAddress,
  displayName,
  firstTimeQueue,
  gymRows,
  renameQueue,
  searchGyms,
  type AdminGym,
} from "../../../src/features/admin/adminGyms";

type Tab = "first" | "rename" | "brand" | "closed" | "all";

function GymCard({ g, children }: { g: AdminGym; children?: React.ReactNode }) {
  const st = branchStatus(g.status);
  return (
    <Tappable accessibilityLabel={displayName(g)} onPress={() => router.push(`/admin/gyms/${g.id}`)}>
      <Card className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
              {displayName(g)}
            </Text>
            <View className="mt-0.5 flex-row items-center gap-1">
              <MapPin size={11} color={designTokens.mutedForeground} />
              <Text className="flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
                {displayAddress(g)}
              </Text>
            </View>
            {g.brand ? (
              <Text className="mt-0.5 font-body text-[11px] text-muted-foreground" numberOfLines={1}>
                Thương hiệu: {g.brand.name}
              </Text>
            ) : null}
          </View>
          <Badge tone={st.tone}>{st.label}</Badge>
        </View>
        {children}
        <View className="flex-row items-center justify-end gap-1">
          <Text className="font-body-semibold text-xs text-primary">Xem chi tiết</Text>
          <ChevronRight size={13} color={designTokens.mutedForeground} />
        </View>
      </Card>
    </Tappable>
  );
}

/**
 * AD-02 "Duyệt → Chi nhánh phòng gym" — năm hàng việc của web `AdminGymModeration`, gom thành các
 * thẻ lọc có đếm; mọi quyết định trên một chi nhánh làm ở màn chi tiết (`[id].tsx`), nơi người duyệt
 * nhìn thấy đủ ảnh, giờ, giấy tờ trước khi bấm. Riêng duyệt tên thương hiệu làm ngay trên thẻ vì nó
 * chỉ có một hành động và một dòng thông tin.
 */
export default function AdminGymsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("first");
  const [q, setQ] = useState("");

  const gymsQuery = useQuery({ queryKey: ["admin-gyms-all"], queryFn: () => adminService.listGymsForAdmin() });
  const brandsQuery = useQuery({ queryKey: ["admin-brands"], queryFn: () => adminService.listBrandsForAdmin() });
  const closedQuery = useQuery({ queryKey: ["admin-gyms-closed"], queryFn: () => adminService.listPermanentlyClosedGyms() });

  const gyms = useMemo(() => gymRows(gymsQuery.data), [gymsQuery.data]);
  const first = firstTimeQueue(gyms);
  const renames = renameQueue(gyms);
  const brandQueue = brandRenameQueue(brandRows(brandsQuery.data));
  const closed = gymRows(closedQuery.data);
  const closedCount = closedNeedingAttention(closed);
  const all = useMemo(() => searchGyms(gyms, q), [gyms, q]);

  const approveBrand = useMutation({
    mutationFn: (id: string) => adminService.approveBrandRename(id),
    onSuccess: async () => {
      toast.show("Đã duyệt tên thương hiệu", "success");
      await qc.invalidateQueries({ queryKey: ["admin-brands"] });
      await qc.invalidateQueries({ queryKey: ["admin-gyms-all"] });
    },
    onError: (e) => toast.show(friendlyError(e, "Không duyệt được tên thương hiệu"), "danger"),
  });

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "first", label: "Chờ duyệt lần đầu", count: first.length },
    { key: "rename", label: "Đổi tên/địa chỉ", count: renames.length },
    { key: "brand", label: "Tên thương hiệu", count: brandQueue.length },
    { key: "closed", label: "Đã đóng cửa", count: closedCount },
    { key: "all", label: "Tất cả chi nhánh", count: 0 },
  ];

  const refresh = () => {
    void gymsQuery.refetch();
    void brandsQuery.refetch();
    void closedQuery.refetch();
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/approvals"));
  const loading = gymsQuery.isLoading || (tab === "brand" && brandsQuery.isLoading) || (tab === "closed" && closedQuery.isLoading);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Chi nhánh phòng gym" onBack={back} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={gymsQuery.isRefetching} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 20, paddingBottom: 12 }}>
          {tabs.map((t) => {
            const on = t.key === tab;
            return (
              <Tappable
                key={t.key}
                accessibilityLabel={t.label}
                onPress={() => setTab(t.key)}
                className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{t.label}</Text>
                {t.count > 0 ? (
                  <View className="rounded-full bg-warning/20 px-1.5">
                    <Text className="font-body-semibold text-[10px] text-warning">{t.count}</Text>
                  </View>
                ) : null}
              </Tappable>
            );
          })}
        </ScrollView>

        <View className="gap-3 px-5">
          {gymsQuery.isError ? (
            <Card className="items-center gap-3 p-6">
              <Text className="text-center font-body text-sm text-destructive">Không tải được danh sách chi nhánh.</Text>
              <Button variant="secondary" onPress={refresh}>
                Thử lại
              </Button>
            </Card>
          ) : loading ? (
            <ActivityIndicator className="mt-8" color={accent.primary} />
          ) : tab === "first" ? (
            first.length === 0 ? (
              <EmptyState icon={Building2} title="Không có chi nhánh nào chờ duyệt lần đầu" />
            ) : (
              first.map((g) => (
                <GymCard key={g.id} g={g}>
                  {approvesBrandToo(g) ? (
                    <View className="flex-row items-start gap-1.5">
                      <TriangleAlert size={12} color={designTokens.warning} />
                      <Text className="flex-1 font-body text-[11px] text-warning">
                        Chi nhánh đầu của thương hiệu — duyệt chi nhánh này là duyệt luôn tên thương hiệu.
                      </Text>
                    </View>
                  ) : null}
                </GymCard>
              ))
            )
          ) : tab === "rename" ? (
            renames.length === 0 ? (
              <EmptyState icon={Building2} title="Không có chi nhánh nào xin đổi tên hay địa chỉ" />
            ) : (
              renames.map((g) => (
                <GymCard key={g.id} g={g}>
                  {g.pendingName ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      Tên mới: <Text className="font-body-semibold text-warning">{g.pendingName}</Text>
                    </Text>
                  ) : null}
                  {g.pendingAddress ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      Địa chỉ mới: <Text className="font-body-semibold text-warning">{g.pendingAddress}</Text>
                    </Text>
                  ) : null}
                  {g.changesRequestedAt ? <Badge tone="info">Đã yêu cầu sửa</Badge> : null}
                </GymCard>
              ))
            )
          ) : tab === "brand" ? (
            brandQueue.length === 0 ? (
              <EmptyState icon={Store} title="Không có thương hiệu nào xin đổi tên" />
            ) : (
              brandQueue.map((b) => (
                <Card key={b.id} className="gap-3 p-4">
                  <View className="gap-1">
                    <Text className="font-body text-xs text-muted-foreground">
                      Đang hiển thị: <Text className="text-foreground">{b.approvedName ?? "(chưa từng được duyệt)"}</Text>
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground">
                      Xin đổi thành: <Text className="font-body-semibold text-warning">{b.pendingName}</Text>
                    </Text>
                  </View>
                  <Button
                    size="sm"
                    icon={Check}
                    disabled={approveBrand.isPending}
                    onPress={() =>
                      Alert.alert("Duyệt tên thương hiệu?", `"${b.pendingName}" sẽ hiển thị công khai trên mọi chi nhánh.`, [
                        { text: "Không", style: "cancel" },
                        { text: "Duyệt", onPress: () => approveBrand.mutate(b.id) },
                      ])
                    }
                  >
                    Duyệt tên mới
                  </Button>
                </Card>
              ))
            )
          ) : tab === "closed" ? (
            <>
              <Text className="font-body text-xs leading-5 text-muted-foreground">
                Chỉ để biết chi nhánh nào cần xử lý. Hoàn tiền cho hội viên còn hoạt động làm ở “Xử lý” (lý do: phòng gym
                đóng cửa).
              </Text>
              {closed.length === 0 ? (
                <EmptyState icon={Building2} title="Không có chi nhánh nào đóng cửa vĩnh viễn" />
              ) : (
                closed.map((g) => (
                  <Card key={g.id} className="gap-1.5 p-4">
                    <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                      {displayName(g)}
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground">
                      Đóng cửa {g.closedAt ? new Date(g.closedAt).toLocaleDateString("vi-VN") : ""}
                      {g.closureReason ? ` — ${g.closureReason}` : ""}
                    </Text>
                    {(g.activeMembershipCount ?? 0) > 0 ? (
                      <Badge tone="danger">{`${g.activeMembershipCount} hội viên cần hoàn tiền`}</Badge>
                    ) : (
                      <Badge tone="neutral">Không còn hội viên hoạt động</Badge>
                    )}
                  </Card>
                ))
              )}
            </>
          ) : (
            <>
              <Input
                value={q}
                onChangeText={setQ}
                placeholder="Tìm theo tên, địa chỉ, thương hiệu"
                placeholderTextColor={inputPlaceholderColor}
                autoCorrect={false}
              />
              <Text className="font-body text-xs text-muted-foreground">
                {all.length === gyms.length ? `${gyms.length} chi nhánh` : `${all.length} / ${gyms.length} chi nhánh`}
              </Text>
              {all.slice(0, 50).map((g) => (
                <GymCard key={g.id} g={g} />
              ))}
              {all.length > 50 ? (
                <Text className="text-center font-body text-xs text-muted-foreground">
                  Hiện 50 chi nhánh đầu — gõ thêm để thu hẹp.
                </Text>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
