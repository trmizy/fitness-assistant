import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Gauge,
  Package,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Trash2,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Input, Tappable, useToast } from "../../components/ui";
import {
  marketplaceService,
  personalizedServiceApi,
  planService,
  trainingPackageService,
  type PublishedPlanListing,
  type TrainingPackage,
} from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import { designTokens } from "../../theme/colors";
import { formatVND } from "../../utils/currency";
import { apiErrorMessage } from "./aiPlans";
import {
  canRepublish,
  DURATION_FILTERS,
  lowestPackagePrice,
  MARKET_TABS,
  MODERATION_LABEL,
  qualityScoreLabel,
  SORT_OPTIONS,
  type BrowseSort,
  type MarketTab as MarketTabValue,
} from "./marketplace";
import { ORDER_STATUS_LABEL, orderStatusTone } from "./personalizedOrder";
import { FieldLabel, TextArea } from "./PlanWidgets";
import { SellPackagesSection } from "./SellPackages";

/**
 * CL-18, "Chợ kế hoạch" half — the design's three MarketSections (Cộng đồng miễn phí / Gói tập PT
 * bán / Dịch vụ cá nhân hoá 1-1) spread over web's client tabs, since each has its own list, detail
 * and action that do not fit one scroll: Miễn phí (browse + adopt), Dịch vụ PT (1-1), Gói tập PT
 * (wallet purchase), Kế hoạch của tôi (publish / republish / withdraw), Đơn dịch vụ (my 1-1 orders).
 * The PT-only selling tabs belong to PT-08/PT-11.
 */
export function MarketTab({ initialTab }: { initialTab?: MarketTabValue }) {
  const [tab, setTab] = useState<MarketTabValue>(
    initialTab && MARKET_TABS.some((t) => t.value === initialTab) ? initialTab : "browse",
  );

  return (
    <View className="flex-1">
      <View className="pt-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
          {MARKET_TABS.map((t) => {
            const on = tab === t.value;
            return (
              <Tappable
                key={t.value}
                onPress={() => setTab(t.value)}
                className={`rounded-full border px-3.5 py-1.5 ${on ? "border-primary bg-primary" : "border-border bg-panel"}`}
              >
                <Text className={`font-body-semibold text-xs ${on ? "text-on-primary" : "text-muted-foreground"}`}>{t.label}</Text>
              </Tappable>
            );
          })}
        </ScrollView>
      </View>
      {tab === "browse" ? (
        <BrowseSection />
      ) : tab === "pt-services" ? (
        <PtServicesSection />
      ) : tab === "buy-packages" ? (
        <PackagesSection />
      ) : tab === "mine" ? (
        <MineSection />
      ) : (
        <OrdersSection />
      )}
    </View>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  const accent = useWorkspaceAccent();
  return (
    <View className="mb-3 flex-row items-center gap-2 px-1">
      <Icon size={17} color={accent.primary} />
      <Text className="font-display text-base text-foreground">{title}</Text>
    </View>
  );
}

function Loading() {
  const accent = useWorkspaceAccent();
  return (
    <View className="items-center py-16">
      <ActivityIndicator color={accent.primary} />
    </View>
  );
}

function RatingText({ value }: { value: number }) {
  return (
    <View className="flex-row items-center gap-1">
      <Star size={12} color={designTokens.warning} fill={designTokens.warning} />
      <Text className="font-body-semibold text-xs text-foreground">{value.toFixed(1)}</Text>
    </View>
  );
}

export function PtVerifiedBadge() {
  const accent = useWorkspaceAccent();
  return (
    <View className="flex-row items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
      <ShieldCheck size={11} color={accent.primary} />
      <Text className="font-body-semibold text-[10px] text-primary">PT xác thực</Text>
    </View>
  );
}

// ── Miễn phí / cộng đồng ───────────────────────────────────────────────────

function BrowseSection() {
  const accent = useWorkspaceAccent();
  const [sort, setSort] = useState<BrowseSort>("recommended");
  const [days, setDays] = useState<number | undefined>(undefined);
  const [maxWeeks, setMaxWeeks] = useState<number | undefined>(undefined);
  const query = useQuery({
    queryKey: ["marketplace", "browse", sort, days, maxWeeks],
    queryFn: () => marketplaceService.browse({ sort, daysPerWeek: days, durationWeeksMax: maxWeeks }),
  });
  const items = query.data?.items ?? [];

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {SORT_OPTIONS.map((o) => (
          <FilterPill key={o.value} label={o.label} on={sort === o.value} onPress={() => setSort(o.value)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8 }}>
        <FilterPill label="Mọi số buổi" on={days == null} onPress={() => setDays(undefined)} />
        {[2, 3, 4, 5, 6].map((d) => (
          <FilterPill key={d} label={`${d} buổi/tuần`} on={days === d} onPress={() => setDays(d)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 8 }}>
        {DURATION_FILTERS.map((o) => (
          <FilterPill key={o.label} label={o.label} on={maxWeeks === o.value} onPress={() => setMaxWeeks(o.value)} />
        ))}
      </ScrollView>
      {sort === "recommended" ? (
        <Text className="mt-2 px-1 font-body text-[11px] text-muted-foreground">
          Xếp theo mục tiêu và điểm chất lượng phù hợp với bạn (quy tắc cố định, không dùng AI đoán).
        </Text>
      ) : null}

      <View className="mt-5">
        <SectionTitle icon={Store} title="Cộng đồng" />
        {query.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState icon={Store} title="Chưa có kế hoạch nào" description="Chưa có kế hoạch nào được duyệt với bộ lọc này." />
        ) : (
          <View className="gap-3">
            {items.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function FilterPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Tappable onPress={onPress} className={`rounded-full border px-3 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}>
      <Text className={`font-body-semibold text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{label}</Text>
    </Tappable>
  );
}

function ListingCard({ listing }: { listing: PublishedPlanListing }) {
  const minPrice = lowestPackagePrice(listing);
  return (
    <Card className="p-4" onPress={() => router.push(`/client/plans/listing/${listing.id}`)}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text className="font-display text-base text-foreground" numberOfLines={1}>
              {listing.title}
            </Text>
            {listing.publisherIsVerifiedPt ? <PtVerifiedBadge /> : null}
          </View>
          <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
            {listing.goal}
          </Text>
          <View className="mt-1.5 flex-row items-center gap-3">
            <RatingText value={listing.avgRating} />
            <Text className="font-body text-xs text-muted-foreground">{`${listing.ratingCount} đánh giá`}</Text>
          </View>
        </View>
        <Badge tone={minPrice != null ? "warning" : "success"}>{minPrice != null ? `từ ${formatVND(minPrice)}` : "Miễn phí"}</Badge>
      </View>
      {listing.description ? (
        <Text className="mt-2 font-body text-xs text-muted-foreground" numberOfLines={2}>
          {listing.description}
        </Text>
      ) : null}
    </Card>
  );
}

// ── Dịch vụ PT 1-1 ─────────────────────────────────────────────────────────

function PtServicesSection() {
  const accent = useWorkspaceAccent();
  const query = useQuery({ queryKey: ["personalized-services", "browse"], queryFn: () => personalizedServiceApi.browse() });
  const items = query.data?.items ?? [];
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <SectionTitle icon={UserRound} title="Dịch vụ cá nhân hoá 1-1" />
      <Text className="mb-3 px-1 font-body text-xs text-muted-foreground">
        PT soạn giáo án riêng sau khi đọc phiếu thông tin của bạn — không phải file soạn sẵn.
      </Text>
      {query.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon={UserRound} title="Chưa có dịch vụ nào" description="Chưa có PT nào đăng dịch vụ cá nhân hoá." />
      ) : (
        <View className="gap-3">
          {items.map((svc) => (
            <Card key={svc.id} className="flex-row items-center gap-3 p-4" onPress={() => router.push(`/client/plans/service/${svc.id}`)}>
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                <UserRound size={20} color={accent.primary} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
                  {svc.title}
                </Text>
                <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                  {[svc.seller?.displayName, svc.supportWeeks ? `${svc.supportWeeks} tuần hỗ trợ` : null].filter(Boolean).join(" · ") || "PT đã xác minh"}
                </Text>
                <Text className="mt-0.5 font-display text-sm text-primary">{formatVND(svc.price)}</Text>
              </View>
              <ChevronRight size={18} color="#8b9299" />
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ── Gói tập PT bán (ví) ────────────────────────────────────────────────────

function PackagesSection() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [buying, setBuying] = useState<TrainingPackage | null>(null);
  const browse = useQuery({ queryKey: ["packages", "browse"], queryFn: () => trainingPackageService.browse() });
  const mine = useQuery({ queryKey: ["packages", "purchases", "mine"], queryFn: () => trainingPackageService.listMyPurchases() });
  const purchase = useMutation({
    mutationFn: (id: string) => trainingPackageService.purchase(id),
    onSuccess: () => {
      setBuying(null);
      toast.show("Mua gói thành công — giờ bạn áp dụng được kế hoạch của gói.", "success");
      void queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    // 402 = the wallet transfer failed (not enough balance); the server's reason is shown as-is.
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể mua gói này"), "danger"),
  });
  const items = browse.data?.items ?? [];
  const purchases = mine.data ?? [];
  const bought = new Set(purchases.map((p) => p.packageId));

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={browse.isRefetching} onRefresh={() => void browse.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <SectionTitle icon={Package} title="Gói tập PT bán" />
      {browse.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Chưa có gói tập nào" description="Chưa có PT nào bán gói tập." />
      ) : (
        <View className="gap-3">
          {items.map((pkg) => {
            const own = pkg.sellerId === user?.id;
            const have = bought.has(pkg.id);
            return (
              <Card key={pkg.id} className="p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text className="font-display text-base text-foreground">{pkg.name}</Text>
                    {pkg.publishedPlan ? (
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {`${pkg.publishedPlan.title} · ${pkg.publishedPlan.goal}`}
                      </Text>
                    ) : null}
                    {pkg.publishedPlan?.avgRating != null ? (
                      <View className="mt-1">
                        <RatingText value={pkg.publishedPlan.avgRating} />
                      </View>
                    ) : null}
                  </View>
                  <View className="items-end">
                    <Text className="font-display text-base text-primary">{formatVND(pkg.price)}</Text>
                    {own ? (
                      <Text className="font-body text-xs text-muted-foreground">Gói của bạn</Text>
                    ) : have ? (
                      <Text className="font-body text-xs text-primary">Đã mua</Text>
                    ) : (
                      <Tappable onPress={() => setBuying(pkg)}>
                        <Text className="font-body-semibold text-xs text-muted-foreground">Mua ngay</Text>
                      </Tappable>
                    )}
                  </View>
                </View>
                {pkg.description ? (
                  <Text className="mt-2 font-body text-xs text-muted-foreground">{pkg.description}</Text>
                ) : null}
                {have && pkg.publishedPlanId ? (
                  <View className="mt-3">
                    <Button size="sm" variant="secondary" onPress={() => router.push(`/client/plans/listing/${pkg.publishedPlanId}`)}>
                      Mở kế hoạch để áp dụng
                    </Button>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}

      <View className="mt-6">
        <SectionTitle icon={ShoppingCart} title="Gói đã mua" />
        {purchases.length === 0 ? (
          <Text className="px-1 font-body text-sm text-muted-foreground">Bạn chưa mua gói tập nào.</Text>
        ) : (
          <View className="gap-2">
            {purchases.map((p) => (
              <Card key={p.id} className="flex-row items-center justify-between p-3.5">
                <Text className="flex-1 font-body-semibold text-sm text-foreground">{p.package?.name ?? "Gói tập"}</Text>
                <Text className="font-body-semibold text-sm text-primary">{formatVND(p.priceAtPurchase)}</Text>
              </Card>
            ))}
          </View>
        )}
      </View>

      <BottomSheet open={Boolean(buying)} onClose={() => setBuying(null)} title="Mua gói tập">
        {buying ? (
          <View>
            <View className="mb-4 flex-row items-center justify-between rounded-xl bg-panel p-3.5">
              <Text className="flex-1 font-body text-sm text-muted-foreground">{buying.name}</Text>
              <Text className="font-display text-lg text-foreground">{formatVND(buying.price)}</Text>
            </View>
            <Text className="mb-4 font-body text-xs text-muted-foreground">
              Thanh toán trừ thẳng vào ví Gymini của bạn. Mua xong, bạn áp dụng kế hoạch của gói vào lịch tập.
            </Text>
            <Button full size="lg" icon={ShoppingCart} disabled={purchase.isPending} onPress={() => purchase.mutate(buying.id)}>
              {purchase.isPending ? "Đang thanh toán…" : `Thanh toán ${formatVND(buying.price)}`}
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </ScrollView>
  );
}

// ── Kế hoạch của tôi (đăng lên chợ) ────────────────────────────────────────

function MineSection() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [publishOpen, setPublishOpen] = useState(false);
  const [sourcePlanId, setSourcePlanId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [republishing, setRepublishing] = useState<PublishedPlanListing | null>(null);
  const [changelog, setChangelog] = useState("");
  const [reason, setReason] = useState("");
  const [withdrawing, setWithdrawing] = useState<PublishedPlanListing | null>(null);
  const [suggestFor, setSuggestFor] = useState<string | null>(null);

  const mine = useQuery({ queryKey: ["marketplace", "mine"], queryFn: () => marketplaceService.listMine() });
  const plans = useQuery({
    queryKey: ["ai-plans", "current", user?.id ?? "guest"],
    queryFn: () => planService.getCurrentPlans(),
    enabled: publishOpen,
  });
  const completedPlans = (plans.data ?? []).filter((p) => p.status === "COMPLETED");

  const publish = useMutation({
    mutationFn: () => marketplaceService.publish(sourcePlanId, title.trim(), description.trim() || undefined),
    onSuccess: () => {
      toast.show("Đã gửi kế hoạch để admin duyệt", "success");
      setPublishOpen(false);
      setSourcePlanId("");
      setTitle("");
      setDescription("");
      void queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể đăng kế hoạch"), "danger"),
  });
  const republish = useMutation({
    mutationFn: () => marketplaceService.republish(republishing!.id, { changelog: changelog.trim(), improvementReason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.show("Đã đăng phiên bản mới để duyệt lại", "success");
      setRepublishing(null);
      setChangelog("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể đăng phiên bản mới"), "danger"),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => marketplaceService.withdraw(id),
    onSuccess: () => {
      setWithdrawing(null);
      toast.show("Đã gỡ kế hoạch khỏi chợ", "success");
      void queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể gỡ kế hoạch"), "danger"),
  });
  const suggestions = useQuery({
    queryKey: ["marketplace", "improvement-suggestions", suggestFor],
    queryFn: () => marketplaceService.listImprovementSuggestions(suggestFor!),
    enabled: !!suggestFor,
  });
  const generateSuggestions = useMutation({
    mutationFn: () => marketplaceService.generateImprovementSuggestions(suggestFor!),
    onSuccess: () => void suggestions.refetch(),
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể tạo gợi ý"), "danger"),
  });

  const items = mine.data ?? [];
  const latestSuggestion = suggestions.data?.[0];

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <Button full icon={Upload} onPress={() => setPublishOpen(true)}>
        Đăng kế hoạch lên chợ
      </Button>
      <Text className="mb-4 mt-2 px-1 font-body text-[11px] text-muted-foreground">
        Chia sẻ miễn phí một kế hoạch AI đã hoàn thành. Admin duyệt trước khi hiện trên chợ.
      </Text>
      {mine.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="Bạn chưa đăng kế hoạch nào" />
      ) : (
        <View className="gap-3">
          {items.map((l) => {
            const mod = MODERATION_LABEL[l.moderationStatus];
            const q = qualityScoreLabel(l.qualityScore);
            return (
              <Card key={l.id} className="p-4">
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                    {l.title}
                  </Text>
                  {mod ? <Badge tone={mod.tone}>{mod.label}</Badge> : null}
                  {l.version && l.version > 1 ? <Badge>{`v${l.version}`}</Badge> : null}
                  <Tappable onPress={() => setWithdrawing(l)} accessibilityLabel="Gỡ kế hoạch" className="h-8 w-8 items-center justify-center rounded-full">
                    <Trash2 size={16} color="#8b9299" />
                  </Tappable>
                </View>
                {l.moderationStatus === "REJECTED" && l.moderationNote ? (
                  <Text className="mt-1 font-body text-xs text-destructive">{`Lý do: ${l.moderationNote}`}</Text>
                ) : null}
                <Text className="mt-1 font-body text-xs text-muted-foreground">
                  {`${l.avgRating.toFixed(1)}★ (${l.ratingCount} đánh giá)${q ? ` · chất lượng ${q}` : ""}`}
                </Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {canRepublish(l.moderationStatus) ? (
                    <Button size="sm" variant="secondary" onPress={() => setRepublishing(l)}>
                      {l.moderationStatus === "REJECTED" ? "Sửa & đăng lại" : "Đăng phiên bản mới"}
                    </Button>
                  ) : null}
                  {l.moderationStatus === "APPROVED" ? (
                    <Button size="sm" variant="ghost" icon={Sparkles} onPress={() => setSuggestFor(l.id)}>
                      Gợi ý cải thiện
                    </Button>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <BottomSheet open={publishOpen} onClose={() => setPublishOpen(false)} title="Đăng kế hoạch lên chợ">
        <View className="gap-4">
          <View>
            <FieldLabel>Chọn kế hoạch đã hoàn thành</FieldLabel>
            {plans.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : completedPlans.length === 0 ? (
              <Text className="font-body text-sm text-muted-foreground">Bạn chưa có kế hoạch AI nào hoàn thành.</Text>
            ) : (
              <View className="gap-2">
                {completedPlans.slice(0, 8).map((p) => (
                  <Tappable
                    key={p.id}
                    onPress={() => {
                      setSourcePlanId(p.id);
                      if (!title.trim()) setTitle(p.name ?? "");
                    }}
                    className={`rounded-xl border px-3.5 py-3 ${sourcePlanId === p.id ? "border-primary bg-primary/10" : "border-border bg-panel"}`}
                  >
                    <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                      {p.name || "Kế hoạch AI"}
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground">{`${p.goal ?? "--"} · ${p.daysPerWeek ?? "--"} buổi/tuần`}</Text>
                  </Tappable>
                ))}
              </View>
            )}
          </View>
          <Input label="Tiêu đề hiển thị" value={title} onChangeText={setTitle} placeholder="VD: Upper/Lower 4 buổi cho người mới" />
          <View>
            <FieldLabel>Mô tả (không bắt buộc)</FieldLabel>
            <TextArea value={description} onChangeText={setDescription} rows={3} placeholder="Kế hoạch phù hợp với ai, cần dụng cụ gì…" />
          </View>
          <Button full size="lg" icon={Upload} disabled={!sourcePlanId || !title.trim() || publish.isPending} onPress={() => publish.mutate()}>
            {publish.isPending ? "Đang gửi…" : "Gửi duyệt"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={Boolean(republishing)} onClose={() => setRepublishing(null)} title="Đăng phiên bản mới">
        <View className="gap-4">
          {republishing?.moderationStatus === "REJECTED" ? (
            <Text className="font-body text-xs text-muted-foreground">Sửa lại nội dung rồi đăng phiên bản mới để admin duyệt lại.</Text>
          ) : null}
          <View>
            <FieldLabel>Phiên bản này thay đổi gì? (bắt buộc)</FieldLabel>
            <TextArea value={changelog} onChangeText={setChangelog} rows={3} />
          </View>
          <View>
            <FieldLabel>Lý do cải thiện (không bắt buộc)</FieldLabel>
            <TextArea value={reason} onChangeText={setReason} rows={2} placeholder="VD: dựa trên phản hồi người dùng" />
          </View>
          <Button full size="lg" disabled={!changelog.trim() || republish.isPending} onPress={() => republish.mutate()}>
            {republish.isPending ? "Đang đăng…" : "Đăng phiên bản mới"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={Boolean(withdrawing)} onClose={() => setWithdrawing(null)} title="Gỡ kế hoạch?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">
          {`"${withdrawing?.title ?? ""}" sẽ không còn hiện trên chợ.`}
        </Text>
        <Button variant="destructive" full size="lg" disabled={withdraw.isPending} onPress={() => withdrawing && withdraw.mutate(withdrawing.id)}>
          {withdraw.isPending ? "Đang gỡ…" : "Gỡ kế hoạch"}
        </Button>
      </BottomSheet>

      <BottomSheet open={Boolean(suggestFor)} onClose={() => setSuggestFor(null)} title="Gợi ý cải thiện bằng AI">
        <View className="gap-3">
          <Text className="font-body text-xs text-muted-foreground">
            Chỉ là gợi ý dựa trên đánh giá hiện có — kế hoạch không tự đổi; bạn tự đăng phiên bản mới nếu muốn áp dụng.
          </Text>
          {suggestions.isLoading ? (
            <ActivityIndicator color={accent.primary} />
          ) : latestSuggestion ? (
            <View className="rounded-xl bg-panel p-3.5">
              <Text className="font-body text-sm text-foreground">{latestSuggestion.summary}</Text>
              {latestSuggestion.suggestions.map((s, i) => (
                <Text key={i} className="mt-1 font-body text-xs text-muted-foreground">{`• ${s}`}</Text>
              ))}
            </View>
          ) : (
            <Text className="font-body text-sm text-muted-foreground">Chưa có gợi ý nào.</Text>
          )}
          <Button full variant="secondary" icon={Gauge} disabled={generateSuggestions.isPending} onPress={() => generateSuggestions.mutate()}>
            {generateSuggestions.isPending ? "AI đang phân tích…" : "Tạo gợi ý mới"}
          </Button>
        </View>
      </BottomSheet>
      {/* 14B.6 (PG-B7) — a PT can sell an approved plan as a paid package (web "Gói bán" tab). */}
      {user?.isPT || user?.role === "PT" ? <SellPackagesSection /> : null}
    </ScrollView>
  );
}

// ── Đơn dịch vụ 1-1 của tôi ────────────────────────────────────────────────

function OrdersSection() {
  const accent = useWorkspaceAccent();
  const query = useQuery({ queryKey: ["personalized-service-orders", "mine"], queryFn: () => personalizedServiceApi.listMyOrders() });
  const orders = query.data ?? [];
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
    >
      <SectionTitle icon={UserRound} title="Đơn dịch vụ 1-1" />
      {query.isLoading ? (
        <Loading />
      ) : orders.length === 0 ? (
        <EmptyState icon={UserRound} title="Chưa có đơn nào" description="Bạn chưa mua dịch vụ PT cá nhân hoá nào." />
      ) : (
        <View className="gap-2.5">
          {orders.map((o) => (
            <Card key={o.id} className="flex-row items-center gap-3 p-4" onPress={() => router.push(`/client/plans/orders/${o.id}`)}>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
                  {o.titleSnapshot}
                </Text>
                <Text className="font-body text-xs text-muted-foreground">{formatVND(o.priceAtPurchase)}</Text>
              </View>
              <Badge tone={orderStatusTone(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
