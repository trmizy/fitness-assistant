import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  ChevronRight,
  FileText,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Ticket,
  UserSearch,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Stagger,
  StaggerItem,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import { contractService, gymService, profileService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { formatVND } from "../../../src/utils/currency";
import { QUICK_FILTERS } from "../../../src/constants/specialties";
import {
  daysRemaining,
  groupByBrand,
  gymBlockedReason,
  membershipStatusLabel,
  normalizeGyms,
  normalizeMemberships,
  searchGyms,
  type GymRow,
} from "../../../src/features/services/gymDirectory";
import {
  CLIENT_TERMINATION_CHOICES,
  contractStatus,
  endActionFor,
  isOpen,
  normalizeContracts,
  normalizeMoneyBreakdown,
  sessionProgress,
  type ContractRow,
  type TerminationChoice,
} from "../../../src/features/services/contracts";
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

      {tab === "Tìm PT" ? (
        <FindPtTab />
      ) : tab === "Phòng gym" ? (
        <GymsTab />
      ) : tab === "Hội viên" ? (
        <MembershipsTab onBrowseGyms={() => setTab("Phòng gym")} />
      ) : (
        <ContractsTab onFindPt={() => setTab("Tìm PT")} />
      )}
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

/** CL-09's list half — branches gathered under their brand, which is how the data model has them. */
function GymsTab() {
  const accent = useWorkspaceAccent();
  const [query, setQuery] = useState("");

  const gymsQuery = useQuery({
    queryKey: ["gyms"],
    queryFn: () => gymService.listGyms(),
  });
  const { refreshing, onRefresh } = usePullToRefresh([["gyms"]]);

  const gyms = useMemo(() => normalizeGyms(gymsQuery.data), [gymsQuery.data]);
  const groups = useMemo(() => groupByBrand(searchGyms(gyms, query)), [gyms, query]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 120, paddingTop: 12 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />
      }
    >
      <View className="px-5">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Tìm theo tên, thương hiệu hoặc thành phố..."
          icon={Search}
          returnKeyType="search"
        />
      </View>

      {gymsQuery.isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Không tìm thấy phòng gym phù hợp"
          description="Thử từ khoá khác, hoặc kéo xuống để tải lại."
        />
      ) : (
        <Stagger className="mt-4 gap-6 px-5">
          {groups.map((group) => (
            <StaggerItem key={group.brandId || group.brandName}>
              <View className="mb-2.5 flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                  <Building2 size={16} color={accent.primary} />
                </View>
                <View className="flex-1">
                  <Text className="font-display text-base text-foreground" numberOfLines={1}>
                    {group.brandName}
                  </Text>
                  <Text className="font-body text-[11px] text-muted-foreground">
                    {group.branches.length} chi nhánh
                  </Text>
                </View>
              </View>
              <View className="gap-3">
                {group.branches.map((gym) => (
                  <GymCard
                    key={gym.id}
                    gym={gym}
                    onPress={() =>
                      router.push({ pathname: "/client/services/gyms/[id]", params: { id: gym.id } })
                    }
                  />
                ))}
              </View>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </ScrollView>
  );
}

function GymCard({ gym, onPress }: { gym: GymRow; onPress: () => void }) {
  const accent = useWorkspaceAccent();
  const closed = gymBlockedReason(gym);
  return (
    <Tappable onPress={onPress}>
      <Card className="gap-2 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="font-display text-base text-foreground" numberOfLines={1}>
              {gym.name}
            </Text>
            {gym.city || gym.address ? (
              <View className="mt-0.5 flex-row items-center gap-1">
                <MapPin size={12} color="#8b9299" />
                <Text className="flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
                  {[gym.address, gym.city].filter(Boolean).join(", ")}
                </Text>
              </View>
            ) : null}
          </View>
          {gym.rating != null ? <Badge tone="warning">{`★ ${gym.rating.toFixed(1)}`}</Badge> : null}
        </View>

        <View className="flex-row items-center justify-between">
          {/* Only a real price is accented — "no plans yet" in the same green would read as one. */}
          <Text
            className="font-body-medium text-sm"
            style={{ color: gym.fromPrice != null ? accent.primary : "#8b9299" }}
          >
            {gym.fromPrice != null ? `Từ ${formatVND(gym.fromPrice)}` : "Chưa mở bán gói"}
          </Text>
          <View className="flex-row items-center gap-1">
            <Text className="font-body text-sm text-muted-foreground">Xem gói</Text>
            <ChevronRight size={16} color="#8b9299" />
          </View>
        </View>

        {closed ? <Badge tone="danger">{closed}</Badge> : null}
      </Card>
    </Tappable>
  );
}

/** What the client already holds — the ones waiting to be paid for included. */
function MembershipsTab({ onBrowseGyms }: { onBrowseGyms: () => void }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();

  const membershipsQuery = useQuery({
    queryKey: ["my-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });
  // A membership row carries a gymId but no gym name, so the directory is read alongside to name it.
  const gymsQuery = useQuery({
    queryKey: ["gyms"],
    queryFn: () => gymService.listGyms(),
  });
  const { refreshing, onRefresh } = usePullToRefresh([["my-memberships"], ["gyms"]]);

  const memberships = useMemo(
    () => normalizeMemberships(membershipsQuery.data),
    [membershipsQuery.data],
  );
  const gymsById = useMemo(() => {
    const map = new Map<string, GymRow>();
    for (const gym of normalizeGyms(gymsQuery.data)) map.set(gym.id, gym);
    return map;
  }, [gymsQuery.data]);

  const cancelMutation = useMutation({
    mutationFn: (membershipId: string) => gymService.cancelMembership(membershipId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-memberships"] });
      toast.show("Đã huỷ yêu cầu chờ thanh toán.", "success");
    },
    onError: (error: any) => {
      toast.show(error?.response?.data?.error ?? "Không huỷ được yêu cầu", "danger");
    },
  });

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 120, paddingTop: 12 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />
      }
    >
      {membershipsQuery.isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : memberships.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Bạn chưa có gói hội viên nào"
          description="Chọn một phòng gym để xem các gói đang mở bán."
          actionLabel="Xem phòng gym"
          onAction={onBrowseGyms}
        />
      ) : (
        <Stagger className="gap-3 px-5">
          {memberships.map((membership) => {
            const gym = gymsById.get(membership.gymId);
            const status = membershipStatusLabel(membership.status);
            const left = daysRemaining(membership);
            return (
              <StaggerItem key={membership.id}>
                <Card className="gap-2 p-4">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="font-display text-base text-foreground" numberOfLines={1}>
                        {gym?.name ?? "Phòng gym"}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {gym?.brandName ?? ""}
                      </Text>
                    </View>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </View>

                  <Text className="font-body text-sm text-foreground">
                    {formatVND(membership.price)}
                    <Text className="font-body text-xs text-muted-foreground">
                      {` · ${membership.durationDays} ngày`}
                      {membership.totalVisits != null
                        ? ` · ${membership.usedVisits}/${membership.totalVisits} lượt`
                        : ""}
                    </Text>
                  </Text>

                  {membership.status === "ACTIVE" && left != null ? (
                    <Text className="font-body text-xs text-muted-foreground">{`Còn ${left} ngày`}</Text>
                  ) : null}

                  {membership.status === "PENDING_PAYMENT" ? (
                    <>
                      <Text className="font-body text-xs text-muted-foreground">
                        Cổng thanh toán sẽ mở trong bản cập nhật tới. Huỷ yêu cầu nếu bạn muốn chọn
                        gói khác tại phòng gym này.
                      </Text>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={cancelMutation.isPending}
                        onPress={() => cancelMutation.mutate(membership.id)}
                      >
                        Huỷ yêu cầu
                      </Button>
                    </>
                  ) : null}
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </ScrollView>
  );
}

/**
 * CL-04's last tab — the client's PT contracts.
 *
 * Ending a contract is TWO different endpoints and the screen must not blur them: before money
 * settles the client withdraws the request, once ACTIVE they terminate it with a reason that
 * selects the refund formula. An active contract therefore also shows what ending it right now
 * would return, straight from the server's own breakdown rather than a number computed here.
 */
function ContractsTab({ onFindPt }: { onFindPt: () => void }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [ending, setEnding] = useState<ContractRow | null>(null);
  const [reason, setReason] = useState<TerminationChoice["reason"]>("CLIENT_CANCELLED");

  const contractsQuery = useQuery({
    queryKey: ["client-contracts"],
    queryFn: () => contractService.getByClient(),
  });
  const { refreshing, onRefresh } = usePullToRefresh([["client-contracts"]]);

  const contracts = useMemo(
    () => normalizeContracts(contractsQuery.data),
    [contractsQuery.data],
  );
  const open = contracts.filter(isOpen);
  const past = contracts.filter((contract) => !isOpen(contract));

  const endMutation = useMutation({
    mutationFn: async (input: { contract: ContractRow; reason: TerminationChoice["reason"] }) =>
      endActionFor(input.contract) === "withdraw"
        ? contractService.cancelContract(input.contract.id, "Khách rút yêu cầu")
        : contractService.terminateContract(input.contract.id, input.reason),
    onSuccess: () => {
      setEnding(null);
      void queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
      toast.show("Đã cập nhật hợp đồng.", "success");
    },
    onError: (error: any) => {
      // The server re-counts PT_REPEATED_NO_SHOW itself and answers 403 with the real reason —
      // show that sentence rather than a generic failure.
      toast.show(
        error?.response?.data?.error ?? error?.response?.data?.message ?? "Không thực hiện được",
        "danger",
      );
    },
  });

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />
        }
      >
        {contractsQuery.isLoading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : contracts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Bạn chưa có hợp đồng nào"
            description="Tìm một huấn luyện viên và gửi yêu cầu huấn luyện để bắt đầu."
            actionLabel="Tìm PT"
            onAction={onFindPt}
          />
        ) : (
          <View className="gap-3 px-5">
            {open.length > 0 ? (
              <Text className="font-body-medium text-xs text-muted-foreground">Đang diễn ra</Text>
            ) : null}
            {open.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                onEnd={() => {
                  setReason("CLIENT_CANCELLED");
                  setEnding(contract);
                }}
              />
            ))}

            {past.length > 0 ? (
              <Text className="mt-2 font-body-medium text-xs text-muted-foreground">Đã kết thúc</Text>
            ) : null}
            {past.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </View>
        )}
      </ScrollView>

      <BottomSheet
        open={!!ending}
        onClose={() => setEnding(null)}
        title={ending && endActionFor(ending) === "withdraw" ? "Rút yêu cầu" : "Chấm dứt hợp đồng"}
      >
        <View className="gap-4 pb-2">
          {ending && endActionFor(ending) === "withdraw" ? (
            <Text className="font-body text-sm leading-6 text-foreground">
              Yêu cầu này chưa phát sinh thanh toán, nên rút lại là xong — không có khoản nào phải
              hoàn.
            </Text>
          ) : (
            <>
              <Text className="font-body text-sm leading-6 text-foreground">
                Lý do bạn chọn quyết định phần tiền được hoàn, nên hãy chọn đúng.
              </Text>
              {CLIENT_TERMINATION_CHOICES.map((choice) => {
                const active = choice.reason === reason;
                return (
                  <Tappable
                    key={choice.reason}
                    className={`rounded-xl border p-3.5 ${
                      active ? "border-primary bg-primary/10" : "border-border bg-panel"
                    }`}
                    onPress={() => setReason(choice.reason)}
                  >
                    <Text className="font-body-medium text-sm text-foreground">{choice.label}</Text>
                    <Text className="mt-1 font-body text-xs text-muted-foreground">
                      {choice.description}
                    </Text>
                  </Tappable>
                );
              })}
            </>
          )}

          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setEnding(null)}>
              Để sau
            </Button>
            <Button
              className="flex-1"
              disabled={endMutation.isPending}
              onPress={() => ending && endMutation.mutate({ contract: ending, reason })}
            >
              Xác nhận
            </Button>
          </View>
        </View>
      </BottomSheet>
    </>
  );
}

function ContractCard({
  contract,
  onEnd,
}: {
  contract: ContractRow;
  onEnd?: () => void;
}) {
  const accent = useWorkspaceAccent();
  const status = contractStatus(contract.status);
  const action = endActionFor(contract);

  // Only an ACTIVE contract has money in escrow worth previewing, and the server is the one that
  // says how much — this never computes a refund locally.
  const breakdownQuery = useQuery({
    queryKey: ["contract-money", contract.id],
    queryFn: () => contractService.getMoneyBreakdown(contract.id),
    enabled: contract.status === "ACTIVE",
  });
  const money = useMemo(
    () => normalizeMoneyBreakdown(breakdownQuery.data),
    [breakdownQuery.data],
  );

  return (
    <Card className="gap-2 p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-display text-base text-foreground" numberOfLines={1}>
            {contract.packageName}
          </Text>
          <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
            {contract.ptName}
            {contract.source === "GYM" ? " · qua phòng gym" : ""}
          </Text>
        </View>
        <Badge tone={status.tone}>{status.label}</Badge>
      </View>

      <Text className="font-body text-sm text-foreground">
        {formatVND(contract.price)}
        <Text className="font-body text-xs text-muted-foreground">
          {` · ${contract.usedSessions}/${contract.totalSessions} buổi`}
        </Text>
      </Text>

      {contract.status === "ACTIVE" && contract.totalSessions > 0 ? (
        <View className="h-1.5 overflow-hidden rounded-full bg-panel">
          <View
            className="h-full rounded-full"
            style={{
              width: `${Math.round(sessionProgress(contract) * 100)}%`,
              backgroundColor: accent.primary,
            }}
          />
        </View>
      ) : null}

      {status.note ? (
        <Text className="font-body text-xs text-muted-foreground">{status.note}</Text>
      ) : null}

      {contract.status === "PENDING_PAYMENT" ? (
        <Text className="font-body text-xs text-muted-foreground">
          Cổng thanh toán sẽ mở trong bản cập nhật tới.
        </Text>
      ) : null}

      {contract.status === "REJECTED" && contract.rejectionReason ? (
        <Text className="font-body text-xs text-muted-foreground">
          {`Lý do: ${contract.rejectionReason}`}
        </Text>
      ) : null}

      {money?.refundIfCancelledNow != null ? (
        <Text className="font-body text-xs text-muted-foreground">
          {`Dừng bây giờ được hoàn khoảng ${formatVND(money.refundIfCancelledNow)}`}
        </Text>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        {contract.status === "ACTIVE" ? (
          <Button
            variant="secondary"
            size="sm"
            icon={CalendarClock}
            onPress={() => router.push("/client/services/booking")}
          >
            Buổi tập
          </Button>
        ) : null}
        {action && onEnd ? (
          <Button variant="secondary" size="sm" onPress={onEnd}>
            {action === "withdraw" ? "Rút yêu cầu" : "Chấm dứt hợp đồng"}
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
