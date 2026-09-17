import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search, ShieldCheck, SlidersHorizontal, Star, UserSearch } from "lucide-react-native";

import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Stagger,
  StaggerItem,
  Tappable,
} from "../../../src/components/ui";
import { profileService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { formatVND } from "../../../src/utils/currency";
import { QUICK_FILTERS } from "../../../src/constants/specialties";
import {
  EMPTY_PT_FILTERS,
  SESSION_MODES,
  activeFilterCount,
  buildListParams,
  filterError,
  matchesSpecialty,
  normalizePts,
  type PtFilters,
  type PtRow,
} from "../../../src/features/services/ptDiscovery";

const TABS = ["Tìm PT", "Phòng gym", "Hội viên", "Hợp đồng"] as const;
type Tab = (typeof TABS)[number];

/**
 * CL-04 — the Dịch vụ tab's host.
 *
 * Four tabs, exactly the design's, and the tab bar is a scrolling pill row rather than a
 * `Segmented`: four Vietnamese labels do not fit four equal segments at phone width.
 *
 * Phase 7 builds these in order (Tìm PT → Phòng gym/Hội viên → Hợp đồng); a tab still being built
 * says so plainly instead of rendering an empty state that would read as "you have nothing here".
 */
export default function ClientServicesScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("Tìm PT");

  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top + 12 }} className="px-5 pb-1">
        <Text className="mb-3 font-display text-2xl text-foreground">Dịch vụ</Text>
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
          >
            {TABS.map((item) => {
              const active = item === tab;
              return (
                <Tappable
                  key={item}
                  className={`rounded-full border px-4 py-2 ${
                    active ? "border-primary" : "border-border bg-card"
                  }`}
                  style={active ? { backgroundColor: accent.primary } : undefined}
                  onPress={() => setTab(item)}
                >
                  <Text
                    className={`font-body-medium text-sm ${
                      active ? "text-background" : "text-muted-foreground"
                    }`}
                  >
                    {item}
                  </Text>
                </Tappable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {tab === "Tìm PT" ? <FindPtTab /> : <ComingInThisPhase tab={tab} />}
    </View>
  );
}

/** CL-10's list half — the search, the chips and the trainer cards. */
function FindPtTab() {
  const accent = useWorkspaceAccent();

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("Tất cả");
  const [filters, setFilters] = useState<PtFilters>(EMPTY_PT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The query text is a filter like any other, but it is applied on its own so typing does not
  // reopen the sheet's draft state.
  const applied = useMemo<PtFilters>(() => ({ ...filters, q: query }), [filters, query]);
  const params = useMemo(() => buildListParams(applied), [applied]);

  const ptsQuery = useQuery({
    queryKey: ["pts-list", params],
    queryFn: () => profileService.listPTs(params),
  });

  const { refreshing, onRefresh } = usePullToRefresh([["pts-list", params]]);

  const trainers = useMemo(() => normalizePts(ptsQuery.data), [ptsQuery.data]);
  const visible = useMemo(
    () => trainers.filter((pt) => matchesSpecialty(pt, chip)),
    [trainers, chip],
  );
  const badge = activeFilterCount(filters);

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />
        }
      >
        <View className="flex-row items-center gap-2 px-5">
          <View className="flex-1">
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Tìm theo tên, chuyên môn, khu vực..."
              icon={Search}
              returnKeyType="search"
            />
          </View>
          <Tappable
            className={`h-12 w-12 items-center justify-center rounded-xl border ${
              badge > 0 ? "border-primary bg-primary/10" : "border-border bg-card"
            }`}
            onPress={() => setSheetOpen(true)}
            accessibilityLabel="Bộ lọc"
          >
            <SlidersHorizontal size={18} color={badge > 0 ? accent.primary : "#8b9299"} />
            {badge > 0 ? (
              <View
                className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full px-1"
                style={{ backgroundColor: accent.primary }}
              >
                <Text className="font-body-medium text-[10px] text-background">{badge}</Text>
              </View>
            ) : null}
          </Tappable>
        </View>

        <View className="mt-3">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
          >
            {["Tất cả", ...QUICK_FILTERS].map((item) => {
              const active = item === chip;
              return (
                <Tappable
                  key={item}
                  className={`rounded-full border px-3.5 py-1.5 ${
                    active ? "border-primary" : "border-border bg-card"
                  }`}
                  style={active ? { backgroundColor: accent.primary } : undefined}
                  onPress={() => setChip(item)}
                >
                  <Text
                    className={`font-body-medium text-xs ${
                      active ? "text-background" : "text-muted-foreground"
                    }`}
                  >
                    {item}
                  </Text>
                </Tappable>
              );
            })}
          </ScrollView>
        </View>

        {ptsQuery.isLoading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : ptsQuery.isError ? (
          <EmptyState
            icon={UserSearch}
            title="Không tải được danh sách huấn luyện viên"
            description="Kiểm tra kết nối rồi kéo xuống để thử lại."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={UserSearch}
            title="Không tìm thấy PT phù hợp"
            description="Thử bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm."
          />
        ) : (
          <Stagger className="mt-4 gap-3 px-5">
            {visible.map((pt) => (
              <StaggerItem key={pt.userId}>
                <TrainerCard pt={pt} onPress={() => router.push(`/client/services/pt/${pt.userId}`)} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </ScrollView>

      <FilterSheet
        key={sheetOpen ? "filters-open" : "filters-closed"}
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
      />
    </>
  );
}

function TrainerCard({ pt, onPress }: { pt: PtRow; onPress: () => void }) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable onPress={onPress}>
      <Card className="p-4">
        <View className="flex-row gap-3.5">
          <Avatar uri={pt.photoUrl} name={pt.name} size={60} />
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text className="font-display text-base text-foreground" numberOfLines={1}>
                {pt.name}
              </Text>
              <ShieldCheck size={15} color={accent.primary} />
            </View>
            <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
              {pt.specialties.length ? pt.specialties.join(" · ") : "Chưa cập nhật chuyên môn"}
            </Text>
            <View className="mt-1.5 flex-row items-center gap-3">
              {pt.rating != null ? (
                <View className="flex-row items-center gap-1">
                  <Star size={13} color="#f59e0b" fill="#f59e0b" />
                  <Text className="font-body-medium text-xs text-foreground">
                    {pt.rating.toFixed(1)}
                  </Text>
                  <Text className="font-body text-xs text-muted-foreground">({pt.ratingCount})</Text>
                </View>
              ) : (
                <Text className="font-body text-xs text-muted-foreground">Chưa có đánh giá</Text>
              )}
              {pt.area ? (
                <View className="flex-row items-center gap-1">
                  <MapPin size={12} color="#8b9299" />
                  <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                    {pt.area}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View className="items-end">
            {pt.lowestPrice != null ? (
              <>
                <Text className="font-display text-sm" style={{ color: accent.primary }}>
                  {formatVND(pt.lowestPrice)}
                </Text>
                <Text className="font-body text-[11px] text-muted-foreground">/buổi</Text>
              </>
            ) : (
              <Text className="font-body text-[11px] text-muted-foreground">Chưa báo giá</Text>
            )}
          </View>
        </View>
      </Card>
    </Tappable>
  );
}

/**
 * The filter sheet edits a DRAFT and only hands it back on "Áp dụng" — the list refetches on every
 * filter change, so editing the live filters would fire a request per keystroke in the price box.
 */
function FilterSheet({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: PtFilters;
  onClose: () => void;
  onApply: (filters: PtFilters) => void;
}) {
  const accent = useWorkspaceAccent();
  // Mounted fresh every time the sheet opens (see the key on the call site), so the draft starts
  // from the live filters without an effect that writes state on open.
  const [draft, setDraft] = useState<PtFilters>(initial);
  const error = filterError(draft);

  return (
    <BottomSheet open={open} onClose={onClose} title="Bộ lọc">
      <View className="gap-4 pb-2">
        <View className="gap-2">
          <Text className="font-body-medium text-xs text-muted-foreground">Hình thức</Text>
          <View className="flex-row gap-2">
            {SESSION_MODES.map((mode) => {
              const active = draft.sessionMode === mode.value;
              return (
                <Tappable
                  key={mode.value}
                  className={`flex-1 items-center rounded-xl border py-2.5 ${
                    active ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                  onPress={() =>
                    setDraft((prev) => ({
                      ...prev,
                      sessionMode: active ? "" : mode.value,
                    }))
                  }
                >
                  <Text
                    className="font-body-medium text-sm"
                    style={{ color: active ? accent.primary : "#8b9299" }}
                  >
                    {mode.label}
                  </Text>
                </Tappable>
              );
            })}
          </View>
        </View>

        <View className="gap-2">
          <Text className="font-body-medium text-xs text-muted-foreground">Giá mỗi buổi (đ)</Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input
                value={draft.minPrice}
                onChangeText={(value) => setDraft((prev) => ({ ...prev, minPrice: value }))}
                placeholder="Từ"
                keyboardType="number-pad"
              />
            </View>
            <View className="flex-1">
              <Input
                value={draft.maxPrice}
                onChangeText={(value) => setDraft((prev) => ({ ...prev, maxPrice: value }))}
                placeholder="Đến"
                keyboardType="number-pad"
              />
            </View>
          </View>
          {error ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
        </View>

        <View className="flex-row gap-2 pt-1">
          <Button
            variant="secondary"
            className="flex-1"
            onPress={() => setDraft({ ...EMPTY_PT_FILTERS, q: draft.q })}
          >
            Xoá lọc
          </Button>
          <Button className="flex-1" disabled={!!error} onPress={() => onApply(draft)}>
            Áp dụng
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}

function ComingInThisPhase({ tab }: { tab: Tab }) {
  return (
    <EmptyState
      icon={UserSearch}
      title={`${tab} đang được dựng`}
      description="Phần này thuộc Phase 7 và sẽ có ngay sau tab Tìm PT."
    />
  );
}
