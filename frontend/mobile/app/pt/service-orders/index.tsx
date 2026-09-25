import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronRight, Package, Plus } from "lucide-react-native";

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
  useToast,
} from "../../../src/components/ui";
import { SelectField } from "../../../src/components/SelectSheet";
import { personalizedServiceApi } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { formatVND } from "../../../src/utils/currency";
import { ORDER_STATUS_LABEL, orderStatusTone } from "../../../src/features/plans/personalizedOrder";
import { sellerOrderAction, sellerOrderLabel } from "../../../src/features/pt/pt";
import { MODERATION_LABEL, SERVICE_TYPE_LABELS } from "../../../src/features/plans/marketplace";

const TABS = ["Đơn hàng", "Dịch vụ của tôi"];

/**
 * PT-09 (list) + PT-08 (the trainer's own 1-1 service listings).
 *
 * Web keeps these apart - orders at `/pt/service-orders/:id` with no list, and the seller's
 * catalogue as a `MyServicesTab` inside the CLIENT plans page gated on `isPT`. On a phone that
 * split makes no sense: a listing and the orders it produces are one job, and burying the
 * trainer's own catalogue inside the client workspace means switching spaces to edit it. Both
 * live here, one segment each.
 *
 * Orders that owe the trainer work lead the list so the queue is obvious.
 */
export default function PtServiceOrdersScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const [tab, setTab] = useState(TABS[0]);

  const query = useQuery({
    queryKey: ["pt-selling-orders", uid],
    queryFn: () => personalizedServiceApi.listOrdersForSeller(),
  });
  const all: any[] = Array.isArray(query.data) ? query.data : [];
  const rows = [...all.filter((o) => sellerOrderAction(o.status)), ...all.filter((o) => !sellerOrderAction(o.status))];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Dịch vụ 1-1"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/pt/dashboard"))}
      />
      <View className="px-5 pt-3">
        <Segmented options={TABS} value={tab} onChange={setTab} />
      </View>
      {tab === TABS[1] ? (
        <MyServicesSection uid={uid} />
      ) : (
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
        {query.isLoading ? (
          <ActivityIndicator className="mt-8" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được đơn dịch vụ. Kéo xuống để thử lại.</Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Chưa có đơn nào"
            description="Đơn khách đặt cho dịch vụ 1-1 của bạn sẽ hiện ở đây."
          />
        ) : (
          <Stagger className="gap-3">
            {rows.map((o) => {
              const needs = !!sellerOrderAction(o.status);
              const label = sellerOrderLabel(o.status, ORDER_STATUS_LABEL[o.status as never] ?? o.status);
              return (
                <StaggerItem key={o.id}>
                  <Card
                    className={`flex-row items-center gap-3 p-4 ${needs ? "border-primary/30 bg-primary/5" : ""}`}
                    onPress={() => router.push(`/pt/service-orders/${o.id}` as never)}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {o.titleSnapshot || "Đơn dịch vụ"}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground">
                        {o.priceSnapshot != null ? formatVND(Number(o.priceSnapshot)) : ""}
                      </Text>
                      <View className="mt-1 flex-row">
                        <Badge tone={needs ? "warning" : orderStatusTone(o.status)}>{label}</Badge>
                      </View>
                    </View>
                    <ChevronRight size={18} color={designTokens.mutedForeground} />
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>
      )}
    </View>
  );
}

/**
 * PT-08 - the trainer's own service listings. Creating one submits it for moderation; the badge
 * shows where it sits in that queue. Archiving is the only removal the API offers (a listing with
 * orders behind it is never hard-deleted), so the confirmation says "ngừng bán", not "xoá".
 */
function MyServicesSection({ uid }: { uid: string }) {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    serviceType: "PERSONALIZED_WORKOUT",
    title: "",
    description: "",
    price: "",
    deliverables: "",
    initialDeliveryDays: "7",
    revisionLimit: "2",
  });

  const query = useQuery({ queryKey: ["pt-my-services", uid], queryFn: () => personalizedServiceApi.listMine() });
  const items: any[] = Array.isArray(query.data) ? query.data : [];

  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const create = useMutation({
    mutationFn: () =>
      personalizedServiceApi.create({
        serviceType: form.serviceType as never,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        price: Number(form.price),
        deliverables: form.deliverables
          .split("\n")
          .map((d) => d.trim())
          .filter(Boolean),
        initialDeliveryDays: Number(form.initialDeliveryDays) || 7,
        revisionLimit: form.revisionLimit.trim() ? Number(form.revisionLimit) : null,
      }),
    onSuccess: () => {
      toast.show("Đã tạo dịch vụ — chờ admin duyệt", "success");
      setOpen(false);
      setForm((f) => ({ ...f, title: "", description: "", price: "", deliverables: "" }));
      void queryClient.invalidateQueries({ queryKey: ["pt-my-services", uid] });
    },
    onError: (e) => fail(e, "Không tạo được dịch vụ"),
  });

  const archive = useMutation({
    mutationFn: (id: string) => personalizedServiceApi.archive(id),
    onSuccess: () => {
      toast.show("Đã ngừng bán dịch vụ", "success");
      void queryClient.invalidateQueries({ queryKey: ["pt-my-services", uid] });
    },
    onError: (e) => fail(e, "Không ngừng bán được"),
  });

  const askArchive = (svc: any) =>
    Alert.alert("Ngừng bán dịch vụ?", `"${svc.title}" sẽ không còn hiện trên chợ. Đơn đang chạy không bị ảnh hưởng.`, [
      { text: "Không", style: "cancel" },
      { text: "Ngừng bán", style: "destructive", onPress: () => archive.mutate(svc.id) },
    ]);

  const error = !form.title.trim()
    ? "Đặt tên cho dịch vụ."
    : !(Number(form.price) > 0)
      ? "Nhập giá dịch vụ (> 0)."
      : !form.deliverables.split("\n").some((d) => d.trim())
        ? "Ghi ít nhất một hạng mục bàn giao."
        : null;

  return (
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
      <Button full icon={Plus} className="mb-4" onPress={() => setOpen(true)}>
        Tạo dịch vụ mới
      </Button>

      {query.isLoading ? (
        <ActivityIndicator className="mt-6" color={accent.primary} />
      ) : query.isError ? (
        <Text className="font-body text-sm text-destructive">Không tải được dịch vụ. Kéo xuống để thử lại.</Text>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Chưa có dịch vụ nào"
          description="Tạo một dịch vụ 1-1 để khách đặt trên chợ."
        />
      ) : (
        <Stagger className="gap-3">
          {items.map((svc) => {
            const mod = MODERATION_LABEL[svc.moderationStatus] ?? { label: svc.moderationStatus, tone: "neutral" as const };
            return (
              <StaggerItem key={svc.id}>
                <Card className={`gap-2 p-4 ${svc.archivedAt ? "opacity-60" : ""}`}>
                  <View className="flex-row items-start gap-2">
                    <View className="min-w-0 flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {svc.title}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground">
                        {SERVICE_TYPE_LABELS[svc.serviceType as never] ?? svc.serviceType}
                      </Text>
                    </View>
                    <Text className="font-display text-sm text-primary">{formatVND(Number(svc.price ?? 0))}</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Badge tone={mod.tone}>{mod.label}</Badge>
                    {svc.archivedAt ? <Badge tone="neutral">Đã ngừng bán</Badge> : null}
                  </View>
                  {svc.archivedAt ? null : (
                    <Button size="sm" variant="ghost" icon={Archive} onPress={() => askArchive(svc)}>
                      Ngừng bán
                    </Button>
                  )}
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Tạo dịch vụ 1-1">
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <SelectField
              label="Loại dịch vụ"
              value={form.serviceType}
              options={Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(v) => setForm((f) => ({ ...f, serviceType: v }))}
            />
            <Input label="Tên dịch vụ *" value={form.title} onChangeText={(t) => setForm((f) => ({ ...f, title: t }))} />
            <Input
              label="Mô tả"
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              multiline
            />
            <Input
              label="Giá (₫) *"
              value={form.price ? Number(form.price).toLocaleString("vi-VN") : ""}
              onChangeText={(t) => setForm((f) => ({ ...f, price: t.replace(/[^\d]/g, "") }))}
              keyboardType="number-pad"
            />
            <Input
              label="Bàn giao gồm gì * (mỗi dòng một mục)"
              value={form.deliverables}
              onChangeText={(t) => setForm((f) => ({ ...f, deliverables: t }))}
              multiline
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Input
                  label="Giao sau (ngày)"
                  value={form.initialDeliveryDays}
                  onChangeText={(t) => setForm((f) => ({ ...f, initialDeliveryDays: t.replace(/[^\d]/g, "") }))}
                  keyboardType="number-pad"
                />
              </View>
              <View className="flex-1">
                <Input
                  label="Số lần sửa"
                  value={form.revisionLimit}
                  onChangeText={(t) => setForm((f) => ({ ...f, revisionLimit: t.replace(/[^\d]/g, "") }))}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            {error && form.title ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
            <Button full disabled={!!error || create.isPending} onPress={() => create.mutate()}>
              {create.isPending ? "Đang tạo…" : "Tạo dịch vụ"}
            </Button>
          </View>
        </ScrollView>
      </BottomSheet>
    </ScrollView>
  );
}
