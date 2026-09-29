import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CalendarClock,
  ChevronRight,
  Copy,
  Gift,
  Handshake,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Plus,
  Star,
  Trash2,
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
} from "../../src/components/ui";
import { SelectField } from "../../src/components/SelectSheet";
import { availabilityService, locationService, profileService, trainingLocationService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors, designTokens } from "../../src/theme/colors";
import { availabilityFromServer } from "../../src/features/pt/pt";
import { DAYS } from "../../src/features/ptApplication/ptApplication";

type LocForm = { id: string | null; provinceCode: string; wardCode: string; gymName: string; addressLine: string; isPrimary: boolean; note: string };
const EMPTY_LOC: LocForm = { id: null, provinceCode: "", wardCode: "", gymName: "", addressLine: "", isPrimary: false, note: "" };

/**
 * PT-06 — "Hồ sơ". Web's PTProfilePage is the source for the two things here that really exist:
 * the referral code and the training locations CRUD.
 *
 * What is NOT ported, deliberately: web's "Public Profile" block (display name "Sarah Mitchell",
 * a bio, "6 years", four English specialty chips) and its "Profile Stats" card ("4.9", "48
 * reviews") are hardcoded literals with `defaultValue` inputs — the Edit button toggles them and
 * saves nowhere. Copying them would put fabricated numbers in front of a real trainer. The real
 * equivalents are used instead: `specialties` off the profile row, and the actual rating
 * aggregate from `GET /profile/pts/:userId`, which is what clients genuinely see.
 *
 * Service packages (PT-10) and gym collaboration (PT-13) are nested in web's page but belong to
 * Phase 11 in the manifest, so they are not here yet.
 */
export default function PtProfileScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, logout, setActiveView } = useApp();
  const uid = user?.id ?? "guest";

  const profileQuery = useQuery({ queryKey: ["my-profile", uid], queryFn: () => profileService.getProfile() });
  const publicQuery = useQuery({
    queryKey: ["pt-public-profile", uid],
    queryFn: () => profileService.getPTDetail(user!.id),
    enabled: !!user?.id,
  });
  const locationsQuery = useQuery({ queryKey: ["pt-training-locations", uid], queryFn: () => trainingLocationService.getMyLocations() });
  const availQuery = useQuery({ queryKey: ["pt-availability", uid], queryFn: () => availabilityService.getAvailability("me") });

  const profile: any = (profileQuery.data as any)?.profile ?? profileQuery.data ?? {};
  const pub: any = publicQuery.data ?? {};
  const specialties: string[] = Array.isArray(pub.specialties) ? pub.specialties : Array.isArray(profile.specialties) ? profile.specialties : [];
  const referralCode: string | undefined = profile.referralCode ?? pub.referralCode;
  const ratingCount = Number(pub.ratingCount ?? 0);
  const avgRating = Number(pub.avgRating ?? 0);
  const locations = Array.isArray(locationsQuery.data) ? locationsQuery.data : [];
  const blocks = availabilityFromServer(availQuery.data);

  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState<LocForm>(EMPTY_LOC);

  const provinces = useQuery({ queryKey: ["locations", "provinces"], queryFn: () => locationService.getProvinces(), staleTime: Infinity });
  const wards = useQuery({
    queryKey: ["locations", "wards", form.provinceCode],
    queryFn: () => locationService.getWards(Number(form.provinceCode)),
    enabled: !!form.provinceCode,
    staleTime: Infinity,
  });

  const invalidateLocations = () => void queryClient.invalidateQueries({ queryKey: ["pt-training-locations", uid] });
  const locError = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const saveLocation = useMutation({
    mutationFn: () => {
      const payload = {
        provinceCode: Number(form.provinceCode),
        wardCode: form.wardCode ? Number(form.wardCode) : undefined,
        gymName: form.gymName.trim() || undefined,
        addressLine: form.addressLine.trim() || undefined,
        isPrimary: form.isPrimary,
        note: form.note.trim() || undefined,
      };
      return form.id ? trainingLocationService.update(form.id, payload) : trainingLocationService.create(payload);
    },
    onSuccess: () => {
      toast.show(form.id ? "Đã cập nhật nơi tập" : "Đã thêm nơi tập", "success");
      setSheet(false);
      setForm(EMPTY_LOC);
      invalidateLocations();
    },
    onError: (e) => locError(e, "Không lưu được nơi tập"),
  });

  const deleteLocation = useMutation({
    mutationFn: (id: string) => trainingLocationService.delete(id),
    onSuccess: () => {
      toast.show("Đã xoá nơi tập", "success");
      invalidateLocations();
    },
    onError: (e) => locError(e, "Không xoá được nơi tập"),
  });

  const openAdd = () => {
    setForm({ ...EMPTY_LOC, isPrimary: locations.length === 0 });
    setSheet(true);
  };
  const openEdit = (l: any) => {
    setForm({
      id: l.id,
      provinceCode: String(l.provinceCode ?? ""),
      wardCode: l.wardCode != null ? String(l.wardCode) : "",
      gymName: l.gymName ?? "",
      addressLine: l.addressLine ?? "",
      isPrimary: !!l.isPrimary,
      note: l.note ?? "",
    });
    setSheet(true);
  };
  const askDelete = (l: any) =>
    Alert.alert("Xoá nơi tập?", l.gymName || l.addressLine || "Nơi tập này sẽ bị xoá.", [
      { text: "Không", style: "cancel" },
      { text: "Xoá", style: "destructive", onPress: () => deleteLocation.mutate(l.id) },
    ]);

  const copyCode = async () => {
    if (!referralCode) return;
    await Clipboard.setStringAsync(referralCode);
    toast.show("Đã sao chép mã giới thiệu", "success");
  };

  const askLogout = () =>
    Alert.alert("Đăng xuất?", "Bạn sẽ cần đăng nhập lại để vào Gymini.", [
      { text: "Ở lại", style: "cancel" },
      { text: "Đăng xuất", style: "destructive", onPress: () => void logout() },
    ]);

  const fullName = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Huấn luyện viên";
  const refreshing = profileQuery.isRefetching || locationsQuery.isRefetching;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, padding: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void profileQuery.refetch();
              void publicQuery.refetch();
              void locationsQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <Stagger className="gap-5">
          <StaggerItem>
            <Card className="gap-4 p-5">
              <View className="flex-row items-center gap-4">
                <Avatar uri={pub.photoUrl ?? profile.photoUrl} name={fullName} size={60} />
                <View className="min-w-0 flex-1">
                  <Text className="font-display text-xl text-foreground" numberOfLines={1}>
                    {fullName}
                  </Text>
                  <Text className="font-body text-sm text-muted-foreground" numberOfLines={1}>
                    {user?.email}
                  </Text>
                  <View className="mt-2 flex-row items-center gap-2">
                    <Badge tone="success">Huấn luyện viên</Badge>
                    {ratingCount > 0 ? (
                      <View className="flex-row items-center gap-1">
                        <Star size={13} color={designTokens.warning} />
                        <Text className="font-body-semibold text-xs text-foreground">{avgRating.toFixed(1)}</Text>
                        <Text className="font-body text-xs text-muted-foreground">({ratingCount} đánh giá)</Text>
                      </View>
                    ) : (
                      <Text className="font-body text-xs text-muted-foreground">Chưa có đánh giá</Text>
                    )}
                  </View>
                </View>
              </View>
              {specialties.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {specialties.map((s) => (
                    <View key={s} className="rounded-full border border-border bg-panel px-2.5 py-1">
                      <Text className="font-body text-xs text-muted-foreground">{s}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Button variant="secondary" size="sm" icon={ArrowLeftRight} onPress={() => { setActiveView("client"); router.replace("/client/dashboard"); }}>
                Về không gian cá nhân
              </Button>
            </Card>
          </StaggerItem>

          {referralCode ? (
            <StaggerItem>
              <Card className="flex-row items-center gap-3 p-4">
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                  <Gift size={20} color={accent.primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">Mã giới thiệu</Text>
                  <Text className="font-display text-base tracking-widest text-primary">{referralCode}</Text>
                </View>
                <Tappable accessibilityLabel="Sao chép mã giới thiệu" onPress={copyCode} className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
                  <Copy size={16} color={designTokens.mutedForeground} />
                </Tappable>
              </Card>
            </StaggerItem>
          ) : null}

          <StaggerItem>
            <Card className="gap-3 p-4" onPress={() => router.push("/pt/schedule")}>
              <View className="flex-row items-center gap-2">
                <CalendarClock size={16} color={accent.primary} />
                <Text className="flex-1 font-body-semibold text-sm text-foreground">Khung giờ rảnh</Text>
                <ChevronRight size={16} color={designTokens.mutedForeground} />
              </View>
              {availQuery.isLoading ? (
                <ActivityIndicator className="self-start" color={accent.primary} />
              ) : blocks.length === 0 ? (
                <Text className="font-body text-xs text-muted-foreground">
                  Chưa đặt khung giờ nào — học viên sẽ không đặt được buổi.
                </Text>
              ) : (
                DAYS.filter((d) => blocks.some((b) => b.dayOfWeek === d.value)).map((d) => (
                  <View key={d.value} className="flex-row items-center justify-between">
                    <Text className="font-body text-xs text-muted-foreground">{d.label}</Text>
                    <Text className="font-body-semibold text-xs text-foreground">
                      {blocks
                        .filter((b) => b.dayOfWeek === d.value)
                        .map((b) => `${b.startTime}–${b.endTime}`)
                        .join(", ")}
                    </Text>
                  </View>
                ))
              )}
            </Card>
          </StaggerItem>

          <StaggerItem>
            <View className="mb-3 flex-row items-center justify-between px-1">
              <View className="flex-row items-center gap-2">
                <MapPin size={16} color={accent.primary} />
                <Text className="font-display text-lg text-foreground">Nơi luyện tập</Text>
              </View>
              <Tappable accessibilityLabel="Thêm nơi tập" onPress={openAdd} className="flex-row items-center gap-1">
                <Plus size={14} color={accent.primary} />
                <Text className="font-body-semibold text-xs text-primary">Thêm</Text>
              </Tappable>
            </View>
            {locationsQuery.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : locations.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="Chưa có nơi tập"
                description="Thêm phòng gym hoặc địa điểm bạn nhận dạy trực tiếp."
              />
            ) : (
              <Card className="overflow-hidden">
                {locations.map((l: any, i: number) => (
                  <View key={l.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {l.gymName || l.addressLine || l.province?.name || "Nơi tập"}
                        </Text>
                        {l.isPrimary ? <Badge tone="success">Chính</Badge> : null}
                      </View>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {[l.addressLine, l.ward?.name, l.province?.name].filter(Boolean).join(", ") || "—"}
                      </Text>
                    </View>
                    <Tappable accessibilityLabel="Sửa nơi tập" onPress={() => openEdit(l)} className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
                      <Pencil size={15} color={designTokens.mutedForeground} />
                    </Tappable>
                    <Tappable accessibilityLabel="Xoá nơi tập" onPress={() => askDelete(l)} className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
                      <Trash2 size={15} color={darkColors.destructive} />
                    </Tappable>
                  </View>
                ))}
              </Card>
            )}
          </StaggerItem>

          <StaggerItem>
            <Card className="flex-row items-center gap-3 p-4" onPress={askLogout}>
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                <LogOut size={20} color={darkColors.destructive} />
              </View>
              <Text className="flex-1 font-body-semibold text-sm text-destructive">Đăng xuất</Text>
            </Card>
          </StaggerItem>

          <StaggerItem>
            <Card className="overflow-hidden">
              <Card
                className="flex-row items-center gap-3 rounded-none border-0 p-4"
                onPress={() => router.push("/pt/packages")}
              >
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                  <Package size={20} color={accent.primary} />
                </View>
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">Gói dịch vụ</Text>
                  <Text className="font-body text-xs text-muted-foreground">Khách chọn gói ở đây khi gửi yêu cầu</Text>
                </View>
                <ChevronRight size={16} color={designTokens.mutedForeground} />
              </Card>
              <Card
                className="flex-row items-center gap-3 rounded-none border-0 border-t border-border p-4"
                onPress={() => router.push("/pt/collaborations")}
              >
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                  <Handshake size={20} color={accent.primary} />
                </View>
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">Hợp tác phòng gym</Text>
                  <Text className="font-body text-xs text-muted-foreground">Thoả thuận chia doanh thu với phòng gym</Text>
                </View>
                <ChevronRight size={16} color={designTokens.mutedForeground} />
              </Card>
            </Card>
          </StaggerItem>
        </Stagger>
      </ScrollView>

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={form.id ? "Sửa nơi tập" : "Thêm nơi tập"}>
        <View className="gap-3 pb-2">
          <SelectField
            label="Tỉnh / thành *"
            value={form.provinceCode}
            options={(provinces.data ?? []).map((x: any) => ({ value: String(x.code), label: x.name }))}
            loading={provinces.isLoading}
            onChange={(v) => setForm((f) => ({ ...f, provinceCode: v, wardCode: "" }))}
          />
          {form.provinceCode ? (
            <SelectField
              label="Phường / xã"
              value={form.wardCode}
              options={(wards.data ?? []).map((x: any) => ({ value: String(x.code), label: x.name }))}
              loading={wards.isLoading}
              allowClear
              onChange={(v) => setForm((f) => ({ ...f, wardCode: v }))}
            />
          ) : null}
          <Input label="Tên phòng gym" value={form.gymName} onChangeText={(t) => setForm((f) => ({ ...f, gymName: t }))} />
          <Input label="Địa chỉ" value={form.addressLine} onChangeText={(t) => setForm((f) => ({ ...f, addressLine: t }))} />
          <Tappable
            accessibilityLabel="Đặt làm nơi chính"
            onPress={() => setForm((f) => ({ ...f, isPrimary: !f.isPrimary }))}
            className="flex-row items-center gap-2 py-1"
          >
            <View className={`h-4 w-4 rounded-full border-2 ${form.isPrimary ? "border-primary bg-primary" : "border-border"}`} />
            <Text className="font-body text-xs text-muted-foreground">Đặt làm nơi chính</Text>
          </Tappable>
          <Button full disabled={!form.provinceCode || saveLocation.isPending} onPress={() => saveLocation.mutate()}>
            {saveLocation.isPending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Thêm nơi tập"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}
