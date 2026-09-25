import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Package, Pencil, Plus } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Segmented,
  Stagger,
  StaggerItem,
  Tappable,
  useToast,
} from "../../src/components/ui";
import { ptServicePackageService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { formatVND } from "../../src/utils/currency";
import {
  EMPTY_PACKAGE,
  type PackageForm,
  packageFormError,
  packageFormFrom,
  packagePayload,
  perSessionPrice,
} from "../../src/features/pt/pt";

const MODES = ["Tại phòng gym", "Online"];

/**
 * PT-10 — "Gói dịch vụ". Web nests this inside PTProfilePage; on a phone it is its own screen
 * reached from the profile hub, the same shape the client's "Cá nhân" hub uses, so neither page
 * turns into a scroll marathon.
 *
 * These packages are what a client picks when requesting a contract (PT-07's other end), so the
 * per-session price is shown next to the total — that is the number clients compare.
 *
 * Deleting is a soft archive server-side: signed contracts reference the package, so it is never
 * hard-deleted. The confirmation says so rather than promising a delete that does not happen.
 */
export default function PtPackagesScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState<PackageForm>(EMPTY_PACKAGE);

  const query = useQuery({ queryKey: ["pt-service-packages", uid], queryFn: () => ptServicePackageService.getMyPackages() });
  const packages: any[] = (query.data as any)?.packages ?? [];
  const live = packages.filter((p) => !p.archivedAt);
  const archived = packages.filter((p) => p.archivedAt);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pt-service-packages", uid] });
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const save = useMutation({
    mutationFn: () =>
      form.id
        ? ptServicePackageService.updatePackage(form.id, packagePayload(form))
        : ptServicePackageService.createPackage(packagePayload(form) as any),
    onSuccess: () => {
      toast.show(form.id ? "Đã cập nhật gói" : "Đã thêm gói dịch vụ", "success");
      setSheet(false);
      setForm(EMPTY_PACKAGE);
      invalidate();
    },
    onError: (e) => fail(e, "Không lưu được gói dịch vụ"),
  });

  const archive = useMutation({
    mutationFn: (id: string) => ptServicePackageService.archivePackage(id),
    onSuccess: (res: any) => {
      toast.show(
        res?.hasActiveContracts
          ? "Đã ngừng bán — hợp đồng đang chạy vẫn giữ nguyên gói này"
          : "Đã ngừng bán gói này",
        "success",
      );
      invalidate();
    },
    onError: (e) => fail(e, "Không ngừng bán được gói"),
  });

  const toggleActive = useMutation({
    mutationFn: (p: any) => ptServicePackageService.updatePackage(p.id, { isActive: !p.isActive }),
    onSuccess: () => invalidate(),
    onError: (e) => fail(e, "Không đổi được trạng thái gói"),
  });

  const askArchive = (p: any) =>
    Alert.alert(
      "Ngừng bán gói này?",
      `"${p.name}" sẽ không còn hiện với khách. Hợp đồng đã ký vẫn giữ nguyên gói — hệ thống không xoá hẳn.`,
      [
        { text: "Không", style: "cancel" },
        { text: "Ngừng bán", style: "destructive", onPress: () => archive.mutate(p.id) },
      ],
    );

  const error = packageFormError(form);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/profile"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Gói dịch vụ" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="font-body text-sm text-muted-foreground">
            Khách chọn một gói ở đây khi gửi yêu cầu hợp đồng.
          </Text>
          <Tappable
            accessibilityLabel="Thêm gói dịch vụ"
            onPress={() => {
              setForm(EMPTY_PACKAGE);
              setSheet(true);
            }}
            className="flex-row items-center gap-1"
          >
            <Plus size={14} color={accent.primary} />
            <Text className="font-body-semibold text-xs text-primary">Thêm</Text>
          </Tappable>
        </View>

        {query.isLoading ? (
          <ActivityIndicator className="mt-8" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được gói dịch vụ. Kéo xuống để thử lại.</Text>
        ) : packages.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Chưa có gói nào"
            description="Thêm ít nhất một gói để khách có thể gửi yêu cầu hợp đồng cho bạn."
          />
        ) : (
          <Stagger className="gap-3">
            {[...live, ...archived].map((p) => (
              <StaggerItem key={p.id}>
                <Card className={`gap-3 p-4 ${p.archivedAt ? "opacity-60" : ""}`}>
                  <View className="flex-row items-start gap-2">
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground">
                        {p.sessionCount} buổi · {p.sessionMode === "ONLINE" ? "Online" : "Tại phòng gym"} ·{" "}
                        {p.sessionDurationMinutes} phút/buổi
                      </Text>
                      {p.description ? (
                        <Text className="mt-0.5 font-body text-xs text-muted-foreground" numberOfLines={2}>
                          {p.description}
                        </Text>
                      ) : null}
                    </View>
                    <View className="items-end">
                      <Text className="font-display text-sm text-primary">{formatVND(Number(p.price))}</Text>
                      <Text className="font-body text-xs text-muted-foreground">
                        {formatVND(perSessionPrice(p))}/buổi
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2">
                    {p.archivedAt ? (
                      <Badge tone="neutral">Đã ngừng bán</Badge>
                    ) : p.isActive ? (
                      <Badge tone="success">Đang bán</Badge>
                    ) : (
                      <Badge tone="warning">Tạm ẩn</Badge>
                    )}
                    {p.validityDays ? (
                      <Text className="font-body text-xs text-muted-foreground">Hạn {p.validityDays} ngày</Text>
                    ) : null}
                  </View>

                  {p.archivedAt ? null : (
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Pencil}
                        onPress={() => {
                          setForm(packageFormFrom(p));
                          setSheet(true);
                        }}
                      >
                        Sửa
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggleActive.isPending}
                        onPress={() => toggleActive.mutate(p)}
                      >
                        {p.isActive ? "Tạm ẩn" : "Bán lại"}
                      </Button>
                      <Button size="sm" variant="ghost" icon={Archive} onPress={() => askArchive(p)}>
                        Ngừng bán
                      </Button>
                    </View>
                  )}
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </ScrollView>

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={form.id ? "Sửa gói dịch vụ" : "Thêm gói dịch vụ"}>
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <Input label="Tên gói *" value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} placeholder="Gói 10 buổi tăng cơ" />
            <Input
              label="Mô tả"
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              placeholder="Kèm 1-1 tại phòng tập, giáo án riêng"
              multiline
            />
            <Segmented
              options={MODES}
              value={form.sessionMode === "ONLINE" ? MODES[1] : MODES[0]}
              onChange={(v) => setForm((f) => ({ ...f, sessionMode: v === MODES[1] ? "ONLINE" : "OFFLINE" }))}
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Input
                  label="Số buổi *"
                  value={form.sessionCount}
                  onChangeText={(t) => setForm((f) => ({ ...f, sessionCount: t.replace(/[^\d]/g, "") }))}
                  keyboardType="number-pad"
                />
              </View>
              <View className="flex-1">
                <Input
                  label="Phút/buổi *"
                  value={form.sessionDurationMinutes}
                  onChangeText={(t) => setForm((f) => ({ ...f, sessionDurationMinutes: t.replace(/[^\d]/g, "") }))}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <Input
              label="Giá cả gói (₫) *"
              value={form.price ? Number(form.price).toLocaleString("vi-VN") : ""}
              onChangeText={(t) => setForm((f) => ({ ...f, price: t.replace(/[^\d]/g, "") }))}
              keyboardType="number-pad"
              placeholder="3.000.000"
            />
            {Number(form.price) > 0 && Number(form.sessionCount) > 0 ? (
              <Text className="font-body text-xs text-muted-foreground">
                Tương đương {formatVND(perSessionPrice({ price: form.price, sessionCount: form.sessionCount }))}/buổi
              </Text>
            ) : null}
            <Input
              label="Hạn dùng (ngày, để trống nếu không giới hạn)"
              value={form.validityDays}
              onChangeText={(t) => setForm((f) => ({ ...f, validityDays: t.replace(/[^\d]/g, "") }))}
              keyboardType="number-pad"
              placeholder="90"
            />
            {error && (form.name || form.price) ? (
              <Text className="font-body text-xs text-destructive">{error}</Text>
            ) : null}
            <Button full disabled={!!error || save.isPending} onPress={() => save.mutate()}>
              {save.isPending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Thêm gói"}
            </Button>
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
