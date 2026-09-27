import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Dumbbell, MapPin, Pencil, Plus, Star, Users } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { SelectField } from "../../src/components/SelectSheet";
import { gymService, locationService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import {
  ABOUT_MAX,
  branchAddress,
  branchFormError,
  branchName,
  branchStatus,
  branchesOfBrand,
  brandDisplayName,
  brandNameError,
  brandPendingName,
  branchPayload,
  draftGyms,
  EMPTY_BRANCH_FORM,
  isBrandOwner,
  operationalStatus,
  ownedGyms,
  showsBranchStats,
  standaloneGyms,
  theBrand,
  type BranchForm,
  type OwnedGym,
} from "../../src/features/gymOwner/gymOwner";
import { geocodeAddress, PRECISION_TEXT } from "../../src/features/gymOwner/geocode";
import { MapPinPicker } from "../../src/features/gymOwner/MapPinPicker";

/**
 * GY-02 — "Phòng gym": the owner's one brand, and every branch under it.
 *
 * THE INVARIANT, on screen: there is no brand selector anywhere here, no "new brand" button, and
 * the create-branch sheet has no brandId field. `createGym` derives the brand from ownership and
 * ignores anything a client sends, so offering a choice would be offering a lie. What the sheet
 * does instead is state, in one read-only line, which brand the new branch will join.
 *
 * Which creation path: web has both a 7-step wizard (`AddBranchWizardPage`, still behind a "thử
 * wizard mới" button) and the dialog in `MyGymsPage`. The dialog is the live path, so that is what
 * is ported — same fields, same two required ones.
 *
 * A MANAGER sees the branches and nothing that edits the brand or adds to it (spec §61): the
 * controls are hidden rather than shown and then refused.
 */
export default function GymOwnerGymsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const brandsQuery = useQuery({ queryKey: ["owned-brands", uid], queryFn: () => gymService.listOwnedBrands() });
  const statusQuery = useQuery({
    queryKey: ["partner-onboarding-status", uid],
    queryFn: () => gymService.getOnboardingStatus(),
  });

  const gyms = ownedGyms(gymsQuery.data);
  const brand = theBrand(brandsQuery.data);
  const isOwner = isBrandOwner(statusQuery.data);
  const loading = gymsQuery.isLoading || brandsQuery.isLoading;

  const branches = brand ? branchesOfBrand(gyms, brand.id) : [];
  const drafts = draftGyms(gyms);
  const loose = standaloneGyms(gyms);

  const [sheet, setSheet] = useState<null | "brand" | "branch" | "rename">(null);
  const [brandForm, setBrandForm] = useState({ name: "", description: "" });
  const [renameValue, setRenameValue] = useState("");
  const [form, setForm] = useState<BranchForm>(EMPTY_BRANCH_FORM);

  // The auto-pin's own state lives up here beside the form it belongs to, so opening the sheet
  // clears it in the same place the form is cleared — no effect watching visibility.
  const [pinHint, setPinHint] = useState<string | null>(null);
  const lastGeocodeKey = useRef<string | null>(null);
  const pinnedByHand = useRef(false);
  /** Look up this address only once, and never over a pin the owner placed themselves. */
  const shouldGeocode = (key: string) => !pinnedByHand.current && key !== lastGeocodeKey.current;
  const markGeocoded = (key: string) => {
    lastGeocodeKey.current = key;
  };
  const markPinnedByHand = () => {
    pinnedByHand.current = true;
  };
  const openBranchSheet = () => {
    setForm(EMPTY_BRANCH_FORM);
    setPinHint(null);
    lastGeocodeKey.current = null;
    pinnedByHand.current = false;
    setSheet("branch");
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["owned-gyms", uid] });
    void qc.invalidateQueries({ queryKey: ["owned-brands", uid] });
  };
  const serverMessage = (e: any, fallback: string) => e?.response?.data?.error?.message || fallback;

  const createBrand = useMutation({
    mutationFn: () => gymService.createBrand({ name: brandForm.name.trim(), description: brandForm.description.trim() || undefined }),
    onSuccess: () => {
      toast.show("Đã đặt tên thương hiệu — giờ có thể thêm chi nhánh đầu tiên", "success");
      setBrandForm({ name: "", description: "" });
      setSheet(null);
      invalidate();
    },
    onError: (e) => toast.show(serverMessage(e, "Không tạo được thương hiệu"), "danger"),
  });

  // A rename only ever moves `pendingName`; what the public sees stays put until an admin approves.
  const renameBrand = useMutation({
    mutationFn: () => gymService.updateBrand(brand!.id, { name: renameValue.trim() }),
    onSuccess: () => {
      toast.show("Đã lưu — tên mới hiển thị công khai sau khi Gymini duyệt", "success");
      setSheet(null);
      invalidate();
    },
    onError: (e) => toast.show(serverMessage(e, "Không đổi được tên thương hiệu"), "danger"),
  });

  const createBranch = useMutation({
    mutationFn: () => gymService.createGym(branchPayload(form)),
    onSuccess: () => {
      toast.show("Đã thêm chi nhánh — đang chờ Gymini duyệt", "success");
      setForm(EMPTY_BRANCH_FORM);
      setPinHint(null);
      setSheet(null);
      invalidate();
    },
    onError: (e) => toast.show(serverMessage(e, "Không tạo được chi nhánh"), "danger"),
  });

  const refreshing = gymsQuery.isRefetching || brandsQuery.isRefetching;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void gymsQuery.refetch();
              void brandsQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Phòng gym</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">
            Thương hiệu của bạn và các chi nhánh thuộc nó
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : gymsQuery.isError || brandsQuery.isError ? (
          <Text className="mt-6 px-5 font-body text-sm text-destructive">
            Không tải được dữ liệu. Kéo xuống để thử lại.
          </Text>
        ) : (
          <Stagger className="gap-5 px-5 pt-5">
            {/* First run: nothing else matters until the brand has a name — createGym refuses
                without one, so the app says so up front instead of letting the form fail. */}
            {!brand ? (
              <StaggerItem>
                <Card className="gap-3 p-5">
                  <Building2 size={22} color={accent.primary} />
                  <Text className="font-display text-base text-foreground">Đặt tên thương hiệu của bạn</Text>
                  <Text className="font-body text-xs leading-5 text-muted-foreground">
                    Đây là tên khách thấy khi tìm kiếm. Mọi phòng gym bạn tạo sau này đều là một chi nhánh của
                    thương hiệu này — bạn chỉ có một thương hiệu, và có thể đổi tên sau.
                  </Text>
                  {isOwner ? (
                    <Button icon={Plus} onPress={() => setSheet("brand")}>
                      Đặt tên thương hiệu
                    </Button>
                  ) : (
                    <Text className="font-body text-xs text-muted-foreground">
                      Chủ thương hiệu là người đặt tên. Tài khoản quản lý chi nhánh không thực hiện bước này.
                    </Text>
                  )}
                </Card>
              </StaggerItem>
            ) : (
              <StaggerItem>
                <Card className="gap-3 p-5">
                  <View className="flex-row items-center gap-2">
                    <Building2 size={16} color={accent.primary} />
                    <Text className="min-w-0 flex-1 font-display text-lg text-foreground" numberOfLines={1}>
                      {brandDisplayName(brand)}
                    </Text>
                    {isOwner ? (
                      <Tappable
                        accessibilityLabel="Đổi tên thương hiệu"
                        onPress={() => {
                          setRenameValue(brandDisplayName(brand));
                          setSheet("rename");
                        }}
                        // Icon 16dp trong một ô 8dp padding vẫn dưới chuẩn chạm 44dp — hitSlop
                        // bù phần còn thiếu thay vì phình ô ra và phá bố cục hàng tiêu đề.
                        hitSlop={14}
                        className="p-2"
                      >
                        <Pencil size={16} color={designTokens.mutedForeground} />
                      </Tappable>
                    ) : null}
                  </View>
                  <Text className="font-body text-xs text-muted-foreground">
                    {branches.length} chi nhánh thuộc thương hiệu này
                  </Text>
                  {brandPendingName(brand) ? (
                    <Text className="font-body text-[11px] text-warning">
                      Tên mới đang chờ Gymini duyệt: {brandPendingName(brand)}
                    </Text>
                  ) : null}
                  {isOwner ? (
                    <Button
                      variant="secondary"
                      icon={Plus}
                      onPress={openBranchSheet}
                    >
                      Thêm chi nhánh
                    </Button>
                  ) : null}
                </Card>
              </StaggerItem>
            )}

            {branches.length > 0 ? (
              <StaggerItem>
                <View className="gap-3">
                  {branches.map((g) => (
                    <BranchCard key={g.id} gym={g} />
                  ))}
                </View>
              </StaggerItem>
            ) : brand ? (
              <StaggerItem>
                <EmptyState
                  icon={Dumbbell}
                  title="Chưa có chi nhánh nào"
                  description="Thêm chi nhánh đầu tiên để bắt đầu bán gói hội viên."
                />
              </StaggerItem>
            ) : null}

            {/* Drafts are branches half-set-up in the 7-step wizard, which lives on web only. They
                are listed so they are not invisible, and honestly labelled rather than linked to a
                screen this app does not have. */}
            {drafts.length > 0 ? (
              <StaggerItem>
                <Text className="mb-2 px-1 font-body-semibold text-sm text-foreground">Đang thiết lập dở</Text>
                <Card className="gap-2 p-4">
                  {drafts.map((d) => (
                    <Text key={d.id} className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                      • {(d.name ?? "").trim() || "Chi nhánh mới"}
                    </Text>
                  ))}
                  <Text className="mt-1 font-body text-[11px] text-muted-foreground">
                    Các bản nháp này được tạo bằng trình thiết lập 7 bước trên web — hãy hoàn tất ở đó. Nút
                    “Thêm chi nhánh” phía trên là một đường tạo khác, ngắn hơn.
                  </Text>
                </Card>
              </StaggerItem>
            ) : null}

            {loose.length > 0 ? (
              <StaggerItem>
                <Text className="mb-2 px-1 font-body-semibold text-sm text-foreground">Phòng gym độc lập</Text>
                <View className="gap-3">
                  {loose.map((g) => (
                    <BranchCard key={g.id} gym={g} />
                  ))}
                </View>
                <Text className="mt-2 px-1 font-body text-[11px] text-muted-foreground">
                  Có từ trước khi mỗi phòng gym bắt buộc thuộc một thương hiệu. Chỉ hiển thị — chi nhánh mới
                  luôn thuộc thương hiệu của bạn.
                </Text>
              </StaggerItem>
            ) : null}
          </Stagger>
        )}
      </ScrollView>

      <BottomSheet open={sheet === "brand"} onClose={() => setSheet(null)} title="Đặt tên thương hiệu">
        <View className="gap-3">
          <Input
            label="Tên thương hiệu"
            value={brandForm.name}
            onChangeText={(v) => setBrandForm((f) => ({ ...f, name: v }))}
            placeholder="Ví dụ: Gymini Fitness"
            placeholderTextColor={inputPlaceholderColor}
          />
          <Input
            label={`Giới thiệu (tuỳ chọn) · ${brandForm.description.length}/${ABOUT_MAX}`}
            value={brandForm.description}
            onChangeText={(v) => setBrandForm((f) => ({ ...f, description: v.slice(0, ABOUT_MAX) }))}
            placeholder="Một vài dòng về thương hiệu"
            placeholderTextColor={inputPlaceholderColor}
            multiline
            numberOfLines={3}
          />
          <Button
            disabled={!!brandNameError(brandForm.name) || createBrand.isPending}
            onPress={() => createBrand.mutate()}
          >
            {createBrand.isPending ? "Đang lưu…" : "Tiếp tục"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={sheet === "rename"} onClose={() => setSheet(null)} title="Đổi tên thương hiệu">
        <View className="gap-3">
          <Input
            label="Tên thương hiệu"
            value={renameValue}
            onChangeText={setRenameValue}
            placeholderTextColor={inputPlaceholderColor}
          />
          <Text className="font-body text-[11px] text-muted-foreground">
            Tên mới chỉ hiển thị công khai sau khi Gymini duyệt; tới lúc đó khách vẫn thấy tên cũ.
          </Text>
          <Button
            icon={Check}
            disabled={!!brandNameError(renameValue) || renameBrand.isPending}
            onPress={() => renameBrand.mutate()}
          >
            {renameBrand.isPending ? "Đang lưu…" : "Lưu tên mới"}
          </Button>
        </View>
      </BottomSheet>

      <BranchSheet
        visible={sheet === "branch"}
        onClose={() => setSheet(null)}
        form={form}
        setForm={setForm}
        pinHint={pinHint}
        setPinHint={setPinHint}
        shouldGeocode={shouldGeocode}
        markGeocoded={markGeocoded}
        markPinnedByHand={markPinnedByHand}
        brandLabel={brandDisplayName(brand)}
        submitting={createBranch.isPending}
        onSubmit={() => createBranch.mutate()}
      />
    </View>
  );
}

function BranchCard({ gym }: { gym: OwnedGym }) {
  const st = branchStatus(gym.status);
  const op = operationalStatus(gym.operationalStatus);
  const stats = showsBranchStats(gym);
  return (
    <Card className="gap-2 p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <Dumbbell size={18} color={designTokens.mutedForeground} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
            {branchName(gym)}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1">
            <MapPin size={11} color={designTokens.mutedForeground} />
            <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
              {branchAddress(gym)}
            </Text>
          </View>
        </View>
        <Badge tone={st.tone}>{st.label}</Badge>
      </View>
      <View className="flex-row items-center gap-4 border-t border-border pt-2">
        {gym.status === "PENDING_REVIEW" ? (
          <Text className="font-body text-xs text-warning">Đang chờ Gymini duyệt…</Text>
        ) : stats ? (
          <>
            <View className="flex-row items-center gap-1">
              <Users size={12} color={designTokens.mutedForeground} />
              <Text className="font-body text-xs text-muted-foreground">{gym.activeMemberCount ?? 0} hội viên</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Star size={12} color={designTokens.warning} />
              <Text className="font-body text-xs text-muted-foreground">
                {Number(gym.averageRating ?? 0).toFixed(1)}
                {gym.reviewCount ? ` · ${gym.reviewCount} đánh giá` : ""}
              </Text>
            </View>
            {op ? <Text className="font-body text-xs text-muted-foreground">{op.label}</Text> : null}
          </>
        ) : (
          <Text className="font-body text-xs text-muted-foreground">
            {gym.status === "REJECTED" ? "Chi nhánh bị từ chối" : "Chưa mở bán"}
          </Text>
        )}
      </View>
    </Card>
  );
}

/**
 * The create-branch sheet. Two required fields (name, address) — the same two `createGym` enforces.
 * Province/ward and the map pin are optional here exactly as on web, but the address the owner
 * types drives an automatic pin so most branches land on the map without anyone touching it.
 */
function BranchSheet({
  visible,
  onClose,
  form,
  setForm,
  pinHint,
  setPinHint,
  shouldGeocode,
  markGeocoded,
  markPinnedByHand,
  brandLabel,
  submitting,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  form: BranchForm;
  setForm: (f: BranchForm | ((p: BranchForm) => BranchForm)) => void;
  pinHint: string | null;
  setPinHint: (v: string | null) => void;
  shouldGeocode: (key: string) => boolean;
  markGeocoded: (key: string) => void;
  markPinnedByHand: () => void;
  brandLabel: string;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const provincesQuery = useQuery({
    queryKey: ["locations", "provinces"],
    queryFn: () => locationService.getProvinces(),
    staleTime: Infinity,
    enabled: visible,
  });
  const wardsQuery = useQuery({
    queryKey: ["locations", "wards", form.provinceCode],
    queryFn: () => locationService.getWards(Number(form.provinceCode)),
    staleTime: Infinity,
    enabled: visible && !!form.provinceCode,
  });

  const provinces = (provincesQuery.data ?? []) as { code: number; name: string }[];
  const wards = (wardsQuery.data ?? []) as { code: number; name: string }[];
  const provinceName = provinces.find((p) => String(p.code) === form.provinceCode)?.name ?? null;
  const wardName = wards.find((w) => String(w.code) === form.wardCode)?.name ?? null;

  // Auto-pin, same contract as web's `useAutoPin`: only once the street + ward + province are all
  // there, only after typing stops, only once per distinct address, and never over a pin the owner
  // placed by hand.
  const street = form.address.trim();
  const key = visible && street.length >= 5 && wardName && provinceName ? `${street}|${wardName}|${provinceName}` : null;

  useEffect(() => {
    if (!key || !shouldGeocode(key)) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      markGeocoded(key);
      setPinHint("Đang tìm vị trí theo địa chỉ…");
      geocodeAddress({ street, ward: wardName!, province: provinceName! }, ctrl.signal)
        .then((hit) => {
          if (!hit) return setPinHint("Không tìm thấy địa chỉ trên bản đồ — hãy ghim tay.");
          setForm((f) => ({ ...f, latitude: hit.latitude, longitude: hit.longitude }));
          setPinHint(PRECISION_TEXT[hit.precision]);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setPinHint("Không tra được bản đồ lúc này — bạn vẫn ghim tay được.");
        });
    }, 1200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // street/ward/province đều nằm trong key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const error = useMemo(() => branchFormError(form), [form]);

  return (
    <BottomSheet open={visible} onClose={onClose} title="Thêm chi nhánh">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
        {/* Read-only, and the only mention of the brand in this form: it is derived from who you
            are, never chosen. */}
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-panel p-3">
          <Building2 size={14} color={designTokens.mutedForeground} />
          <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground" numberOfLines={2}>
            Chi nhánh này sẽ thuộc thương hiệu {brandLabel}
          </Text>
        </View>

        <Input
          label="Tên chi nhánh"
          value={form.name}
          onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Ví dụ: Gymini Quận 1"
          placeholderTextColor={inputPlaceholderColor}
        />
        <Input
          label="Số nhà, tên đường"
          value={form.address}
          onChangeText={(v) => setForm((f) => ({ ...f, address: v }))}
          placeholder="123 Lê Lợi"
          placeholderTextColor={inputPlaceholderColor}
        />
        <SelectField
          label="Tỉnh/Thành phố"
          value={form.provinceCode}
          options={provinces.map((p) => ({ value: String(p.code), label: p.name }))}
          loading={provincesQuery.isLoading}
          onChange={(v) => setForm((f) => ({ ...f, provinceCode: v, wardCode: "" }))}
          allowClear
        />
        {form.provinceCode ? (
          <SelectField
            label="Phường/Xã"
            value={form.wardCode}
            options={wards.map((w) => ({ value: String(w.code), label: w.name }))}
            loading={wardsQuery.isLoading}
            onChange={(v) => setForm((f) => ({ ...f, wardCode: v }))}
            allowClear
          />
        ) : null}
        <Input
          label="Thành phố hiển thị (tuỳ chọn)"
          value={form.city}
          onChangeText={(v) => setForm((f) => ({ ...f, city: v }))}
          placeholder="TP. Hồ Chí Minh"
          placeholderTextColor={inputPlaceholderColor}
        />
        <Input
          label={`Giới thiệu (tuỳ chọn) · ${form.description.length}/${ABOUT_MAX}`}
          value={form.description}
          onChangeText={(v) => setForm((f) => ({ ...f, description: v.slice(0, ABOUT_MAX) }))}
          placeholder="Một vài dòng về chi nhánh"
          placeholderTextColor={inputPlaceholderColor}
          multiline
          numberOfLines={3}
        />

        <MapPinPicker
          latitude={form.latitude}
          longitude={form.longitude}
          hint={pinHint}
          onChange={(p) => {
            markPinnedByHand();
            setPinHint("Đã ghim tay");
            setForm((f) => ({ ...f, ...p }));
          }}
        />

        <Button disabled={!!error || submitting} onPress={onSubmit}>
          {submitting ? "Đang tạo…" : "Tạo chi nhánh"}
        </Button>
        {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}
