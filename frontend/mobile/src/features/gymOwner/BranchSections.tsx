import { useState } from "react";
import { ActivityIndicator, Alert, Image, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, Lock, Plus, Star, Trash2, Unlock, Upload } from "lucide-react-native";

import { Badge, Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { SelectField } from "../../components/SelectSheet";
import { gymPhotoUrl, gymService, locationService } from "../../services/api";
import { shareLocalFile } from "../../services/files";
import { pickApplicationFile, pickImages } from "../../lib/pickFile";
import { formatVND } from "../../utils/currency";
import { toDateInputValue } from "../../utils/date";
import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import type { BranchDocumentType, GymFacility, GymOperatingHoursDay, GymPhoto } from "../../types";
import { MapPinPicker } from "./MapPinPicker";
import {
  ABOUT_MAX,
  ALL_DAYS,
  BRANCH_DOC_LABEL,
  BRANCH_DOC_ORDER,
  DAY_LABEL,
  DAY_TYPE_OPTIONS,
  FACILITY_GROUPS,
  FACILITY_LABEL,
  MAX_PHOTOS,
  PARTNER_DOC_LABEL,
  WEEKDAYS_AFTER_MONDAY,
  aboutError,
  closePayload,
  copyMondayTo,
  docStatus,
  hoursDirty,
  hoursIssues,
  hoursPayload,
  hoursRows,
  isPdfToken,
  movedPhotoIds,
  nameAddressError,
  operationalActions,
  reopenDateError,
  sameFacilities,
  setDayType,
  toggleFacility,
  type ClosingMode,
  type HoursRow,
} from "./branchManage";
import { memberLabel } from "./gymOwner";

/**
 * 14B.5 (PG-A7, GY-03) — the sections of web `GymManagePage`'s "Cài đặt" panel, one card each.
 * Unlike web, every section edits locally and saves with its own button (web saves hours and
 * facilities on every tap/keystroke) — one toast per save instead of one per change.
 */

/** The shared Input is one line tall (h-12); a multi-line field needs room for its text and placeholder. */
const MULTILINE = { height: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" } as const;

const serverMessage = (e: any, fallback: string) => e?.response?.data?.error?.message || e?.message || fallback;

export function branchKeys(uid: string, gymId: string) {
  return {
    gym: ["owned-gym", uid, gymId] as const,
    hours: ["owned-gym-hours", uid, gymId] as const,
    photos: ["owned-gym-photos", uid, gymId] as const,
    docs: ["owned-gym-documents", uid, gymId] as const,
    impact: ["owned-gym-closure-impact", uid, gymId] as const,
    members: ["owned-gym-memberships", gymId] as const, // same key the dashboard uses
  };
}

function SectionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="gap-3 p-4">
      <View className="gap-1">
        <Text className="font-body-semibold text-sm text-foreground">{title}</Text>
        {hint ? <Text className="font-body text-[11px] leading-4 text-muted-foreground">{hint}</Text> : null}
      </View>
      {children}
    </Card>
  );
}

/** One `PATCH /owner/gyms/:id` mutation per section, refreshing the branch and the branch list. */
function useUpdateGym(uid: string, gymId: string, successText: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => gymService.updateGym(gymId, payload as any),
    onSuccess: () => {
      toast.show(successText, "success");
      void qc.invalidateQueries({ queryKey: branchKeys(uid, gymId).gym });
      void qc.invalidateQueries({ queryKey: ["owned-gyms", uid] });
    },
    onError: (e) => toast.show(serverMessage(e, "Không thể lưu thay đổi"), "danger"),
  });
}

// ── Name & address (shown publicly only after admin approval) ─────────────────────────────────

export function NameAddressSection({ uid, gym }: { uid: string; gym: any }) {
  const [form, setForm] = useState({ name: String(gym.pendingName ?? gym.name ?? ""), address: String(gym.pendingAddress ?? gym.address ?? "") });
  const save = useUpdateGym(uid, gym.id, "Đã lưu — tên/địa chỉ mới hiển thị công khai sau khi Gymini duyệt");
  const error = nameAddressError(form);
  const unchanged = form.name.trim() === String(gym.pendingName ?? gym.name ?? "").trim() && form.address.trim() === String(gym.pendingAddress ?? gym.address ?? "").trim();
  return (
    <SectionCard
      title="Tên & địa chỉ"
      hint="Đổi tên/địa chỉ không hiển thị công khai ngay — phải chờ Gymini duyệt. Trong lúc chờ, chi nhánh vẫn bán gói và cho check-in bình thường."
    >
      <Input label="Tên chi nhánh" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} maxLength={150} />
      <Input label="Địa chỉ" value={form.address} onChangeText={(v) => setForm((f) => ({ ...f, address: v }))} maxLength={300} />
      <Button disabled={!!error || unchanged || save.isPending} onPress={() => save.mutate({ name: form.name.trim(), address: form.address.trim() })}>
        {save.isPending ? "Đang lưu…" : "Lưu tên & địa chỉ"}
      </Button>
      {error ? <Text className="text-center font-body text-xs text-muted-foreground">{error}</Text> : null}
    </SectionCard>
  );
}

// ── About & contact (immediate) ───────────────────────────────────────────────────────────────

export function AboutSection({ uid, gym }: { uid: string; gym: any }) {
  const [form, setForm] = useState({ description: String(gym.description ?? ""), phone: String(gym.phone ?? ""), email: String(gym.email ?? "") });
  const save = useUpdateGym(uid, gym.id, "Đã lưu giới thiệu & liên hệ");
  const error = aboutError(form);
  return (
    <SectionCard title="Giới thiệu & liên hệ" hint={`Hiện ở mục "Chi tiết" khi khách xem chi nhánh. Có hiệu lực ngay, không cần Gymini duyệt.`}>
      <Input
        label={`Giới thiệu · ${form.description.trim().length}/${ABOUT_MAX}`}
        value={form.description}
        onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
        placeholder="Không gian, thiết bị, lớp tập, đội ngũ huấn luyện viên…"
        placeholderTextColor={inputPlaceholderColor}
        multiline
        numberOfLines={4}
        style={MULTILINE}
        maxLength={Math.max(ABOUT_MAX, form.description.length)}
      />
      <Input label="Điện thoại chi nhánh" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} keyboardType="phone-pad" maxLength={20} />
      <Input label="Email chi nhánh" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} keyboardType="email-address" autoCapitalize="none" maxLength={200} />
      <Button
        disabled={!!error || save.isPending}
        onPress={() => save.mutate({ description: form.description.trim(), phone: form.phone.trim(), email: form.email.trim() })}
      >
        {save.isPending ? "Đang lưu…" : "Lưu giới thiệu & liên hệ"}
      </Button>
      {error ? <Text className="text-center font-body text-xs text-destructive">{error}</Text> : null}
    </SectionCard>
  );
}

// ── Location (immediate) ──────────────────────────────────────────────────────────────────────

export function LocationSection({ uid, gym }: { uid: string; gym: any }) {
  const [loc, setLoc] = useState({
    provinceCode: gym.provinceCode != null ? String(gym.provinceCode) : "",
    wardCode: gym.wardCode != null ? String(gym.wardCode) : "",
    latitude: (gym.latitude ?? null) as number | null,
    longitude: (gym.longitude ?? null) as number | null,
    locationNote: String(gym.locationNote ?? ""),
  });
  const provincesQuery = useQuery({ queryKey: ["locations", "provinces"], queryFn: () => locationService.getProvinces(), staleTime: Infinity });
  const wardsQuery = useQuery({
    queryKey: ["locations", "wards", loc.provinceCode],
    queryFn: () => locationService.getWards(Number(loc.provinceCode)),
    staleTime: Infinity,
    enabled: !!loc.provinceCode,
  });
  const provinces = (provincesQuery.data ?? []) as { code: number; name: string }[];
  const wards = (wardsQuery.data ?? []) as { code: number; name: string }[];
  const save = useUpdateGym(uid, gym.id, "Đã lưu vị trí");
  return (
    <SectionCard title="Vị trí" hint="Để khách tìm được chi nhánh theo tỉnh/thành và thấy đúng chi nhánh gần mình. Có hiệu lực ngay, không cần Gymini duyệt.">
      <SelectField
        label="Tỉnh/Thành phố"
        value={loc.provinceCode}
        options={provinces.map((p) => ({ value: String(p.code), label: p.name }))}
        loading={provincesQuery.isLoading}
        onChange={(v) => setLoc((l) => ({ ...l, provinceCode: v, wardCode: "" }))}
        allowClear
      />
      {loc.provinceCode ? (
        <SelectField
          label="Phường/Xã"
          value={loc.wardCode}
          options={wards.map((w) => ({ value: String(w.code), label: w.name }))}
          loading={wardsQuery.isLoading}
          onChange={(v) => setLoc((l) => ({ ...l, wardCode: v }))}
          allowClear
        />
      ) : null}
      <MapPinPicker latitude={loc.latitude} longitude={loc.longitude} onChange={(p) => setLoc((l) => ({ ...l, ...p }))} />
      <Input
        label="Hướng dẫn tới nơi (tuỳ chọn)"
        value={loc.locationNote}
        onChangeText={(v) => setLoc((l) => ({ ...l, locationNote: v }))}
        placeholder="Ví dụ: Toà nhà màu xanh, cổng sau, tầng 3"
        placeholderTextColor={inputPlaceholderColor}
        maxLength={300}
      />
      <Button
        disabled={save.isPending}
        onPress={() =>
          save.mutate({
            provinceCode: loc.provinceCode ? Number(loc.provinceCode) : null,
            wardCode: loc.wardCode ? Number(loc.wardCode) : null,
            latitude: loc.latitude,
            longitude: loc.longitude,
            locationNote: loc.locationNote.trim(),
          })
        }
      >
        {save.isPending ? "Đang lưu…" : "Lưu vị trí"}
      </Button>
    </SectionCard>
  );
}

// ── Opening hours ─────────────────────────────────────────────────────────────────────────────

export function HoursSection({ uid, gymId }: { uid: string; gymId: string }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const keys = branchKeys(uid, gymId);
  const query = useQuery({ queryKey: keys.hours, queryFn: () => gymService.getGymHours(gymId) as Promise<GymOperatingHoursDay[]> });
  const [rows, setRows] = useState<HoursRow[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  if (query.data && query.dataUpdatedAt !== loadedAt) {
    setLoadedAt(query.dataUpdatedAt);
    setRows(hoursRows(query.data));
  }
  const save = useMutation({
    mutationFn: (next: HoursRow[]) => gymService.setGymHours(gymId, hoursPayload(gymId, next)),
    onSuccess: () => {
      toast.show("Đã lưu giờ hoạt động", "success");
      void qc.invalidateQueries({ queryKey: keys.hours });
    },
    onError: (e) => toast.show(serverMessage(e, "Không thể lưu giờ hoạt động"), "danger"),
  });

  if (query.isLoading || !rows) return <SectionCard title="Giờ hoạt động"><ActivityIndicator color={accent.primary} /></SectionCard>;
  if (query.isError) return <SectionCard title="Giờ hoạt động"><Text className="font-body text-xs text-destructive">Không tải được giờ hoạt động.</Text></SectionCard>;
  const issues = hoursIssues(rows);
  const edit = (day: HoursRow["day"], patch: Partial<HoursRow>) => setRows((rs) => (rs ?? []).map((r) => (r.day === day ? { ...r, ...patch } : r)));

  return (
    <SectionCard title="Giờ hoạt động" hint="Mỗi ngày một khung giờ liên tục, giờ theo dạng HH:MM. Sửa được bất cứ lúc nào, kể cả sau khi đã duyệt.">
      <View className="flex-row flex-wrap gap-2">
        <Button size="sm" variant="secondary" onPress={() => setRows((rs) => copyMondayTo(rs ?? [], WEEKDAYS_AFTER_MONDAY))}>
          Giờ Thứ 2 → Thứ 3–6
        </Button>
        <Button size="sm" variant="secondary" onPress={() => setRows((rs) => copyMondayTo(rs ?? [], ALL_DAYS.filter((d) => d !== "MONDAY")))}>
          Giờ Thứ 2 → cả tuần
        </Button>
      </View>
      {rows.map((r) => (
        <View key={r.day} className="gap-2 rounded-xl border border-border bg-panel p-3">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="font-body-semibold text-sm text-foreground">{DAY_LABEL[r.day]}</Text>
            <View className="flex-row gap-1">
              {DAY_TYPE_OPTIONS.map((o) => {
                const on = r.type === o.value;
                return (
                  <Tappable
                    key={o.value}
                    accessibilityLabel={`${DAY_LABEL[r.day]}: ${o.label}`}
                    onPress={() => setRows((rs) => setDayType(rs ?? [], r.day, o.value))}
                    className={`rounded-lg border px-2.5 py-1.5 ${on ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <Text className={`font-body-semibold text-[11px] ${on ? "text-primary" : "text-muted-foreground"}`}>{o.label}</Text>
                  </Tappable>
                );
              })}
            </View>
          </View>
          {r.type === "OPEN" ? (
            <View className="flex-row items-center gap-2">
              <Input className="flex-1" value={r.open} onChangeText={(v) => edit(r.day, { open: v })} placeholder="06:00" placeholderTextColor={inputPlaceholderColor} maxLength={5} accessibilityLabel={`${DAY_LABEL[r.day]} — giờ mở cửa`} />
              <Text className="font-body text-xs text-muted-foreground">đến</Text>
              <Input className="flex-1" value={r.close} onChangeText={(v) => edit(r.day, { close: v })} placeholder="22:00" placeholderTextColor={inputPlaceholderColor} maxLength={5} accessibilityLabel={`${DAY_LABEL[r.day]} — giờ đóng cửa`} />
            </View>
          ) : null}
        </View>
      ))}
      {issues.length > 0 ? (
        <View className="gap-0.5">
          {issues.map((i) => (
            <Text key={i} className="font-body text-[11px] text-warning">
              {i}
            </Text>
          ))}
        </View>
      ) : null}
      <Button disabled={issues.length > 0 || !hoursDirty(rows, query.data) || save.isPending} onPress={() => save.mutate(rows)}>
        {save.isPending ? "Đang lưu…" : "Lưu giờ hoạt động"}
      </Button>
    </SectionCard>
  );
}

// ── Facilities ────────────────────────────────────────────────────────────────────────────────

export function FacilitiesSection({ uid, gym }: { uid: string; gym: any }) {
  const accent = useWorkspaceAccent();
  const saved: GymFacility[] = Array.isArray(gym.facilities) ? gym.facilities : [];
  const [list, setList] = useState<GymFacility[]>(saved);
  const save = useUpdateGym(uid, gym.id, "Đã lưu tiện ích & dịch vụ");
  return (
    <SectionCard title="Tiện ích & dịch vụ" hint="Chọn những tiện ích chi nhánh này thực sự có — khách thấy danh sách này khi tìm phòng gym.">
      {FACILITY_GROUPS.map((g) => (
        <View key={g.label} className="gap-2">
          <Text className="font-body text-[11px] uppercase tracking-wider text-muted-foreground">{g.label}</Text>
          <View className="flex-row flex-wrap gap-2">
            {g.items.map((f) => {
              const on = list.includes(f);
              return (
                <Tappable
                  key={f}
                  accessibilityLabel={`${FACILITY_LABEL[f]}${on ? " (đã chọn)" : ""}`}
                  onPress={() => setList((l) => toggleFacility(l, f))}
                  className={`flex-row items-center gap-1 rounded-full border px-3 py-2 ${on ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  {on ? <Check size={12} color={accent.primary} /> : null}
                  <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{FACILITY_LABEL[f]}</Text>
                </Tappable>
              );
            })}
          </View>
        </View>
      ))}
      <Text className="font-body text-[11px] text-muted-foreground">Đã chọn {list.length} tiện ích.</Text>
      <Button disabled={sameFacilities(list, saved) || save.isPending} onPress={() => save.mutate({ facilities: list })}>
        {save.isPending ? "Đang lưu…" : "Lưu tiện ích"}
      </Button>
    </SectionCard>
  );
}

// ── Photos ────────────────────────────────────────────────────────────────────────────────────

export function PhotosSection({ uid, gymId }: { uid: string; gymId: string }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const key = branchKeys(uid, gymId).photos;
  const query = useQuery({ queryKey: key, queryFn: () => gymService.listGymPhotos(gymId) as Promise<(GymPhoto & { url?: string | null })[]> });
  const photos = query.data ?? [];
  const [uploading, setUploading] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (fallback: string) => (e: unknown) => toast.show(serverMessage(e, fallback), "danger");
  const remove = useMutation({ mutationFn: (id: string) => gymService.deleteGymPhoto(gymId, id), onSuccess: refresh, onError: onError("Không thể xoá ảnh") });
  // Refetch after cover/reorder (the response has carried `url` since GAP-27 was fixed 5/10, but a
  // refetch also picks up a fresh signed link, which expires after a few minutes).
  const cover = useMutation({
    mutationFn: (id: string) => gymService.setGymPhotoCover(gymId, id),
    onSuccess: refresh,
    onError: onError("Không thể đặt ảnh bìa"),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => gymService.reorderGymPhotos(gymId, ids),
    onSuccess: refresh,
    onError: onError("Không thể sắp xếp lại"),
  });

  const add = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return toast.show(`Tối đa ${MAX_PHOTOS} ảnh cho mỗi chi nhánh`, "danger");
    try {
      const files = await pickImages(room, 8 * 1024 * 1024);
      for (let i = 0; i < files.length; i++) {
        setUploading(`${i + 1}/${files.length}`);
        await gymService.uploadGymPhoto(gymId, files[i]);
      }
      if (files.length) toast.show(files.length > 1 ? `Đã tải lên ${files.length} ảnh` : "Đã tải ảnh lên", "success");
    } catch (e) {
      toast.show(serverMessage(e, "Không thể tải ảnh lên"), "danger");
    } finally {
      setUploading(null);
      void refresh();
    }
  };

  const busy = remove.isPending || cover.isPending || reorder.isPending || uploading != null;
  return (
    <SectionCard title="Hình ảnh" hint={`Thư viện ảnh công khai — khách xem khi tìm phòng gym. Tối đa ${MAX_PHOTOS} ảnh, JPG/PNG/WEBP, mỗi ảnh ≤ 8 MB.`}>
      <Button variant="secondary" icon={Plus} disabled={busy || photos.length >= MAX_PHOTOS} onPress={() => void add()}>
        {uploading ? `Đang tải ảnh lên ${uploading}…` : `Thêm ảnh (${photos.length}/${MAX_PHOTOS})`}
      </Button>
      {query.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : photos.length === 0 ? (
        <Text className="font-body text-xs text-muted-foreground">Chưa có ảnh nào — thêm ít nhất một ảnh để khách hình dung được không gian tập.</Text>
      ) : (
        <View className="flex-row flex-wrap justify-between gap-y-3">
          {photos.map((p, i) => (
            <View key={p.id} className="w-[48.5%] overflow-hidden rounded-xl border border-border bg-panel">
              <Image source={{ uri: gymPhotoUrl(p.fileName, p.url) }} style={{ width: "100%", aspectRatio: 1 }} resizeMode="cover" />
              {p.isCover ? (
                <View className="absolute left-1.5 top-1.5 flex-row items-center gap-1 rounded-full bg-primary px-2 py-0.5">
                  <Star size={10} color={designTokens.onPrimary} fill={designTokens.onPrimary} />
                  <Text className="font-body-semibold text-[10px] text-on-primary">Ảnh bìa</Text>
                </View>
              ) : null}
              <View className="flex-row items-center justify-between px-1 py-1">
                <View className="flex-row">
                  <PhotoButton icon={ArrowLeft} label="Đưa lên trước" disabled={busy || i === 0} onPress={() => { const ids = movedPhotoIds(photos.map((x) => x.id), i, -1); if (ids) reorder.mutate(ids); }} />
                  <PhotoButton icon={ArrowRight} label="Đưa ra sau" disabled={busy || i === photos.length - 1} onPress={() => { const ids = movedPhotoIds(photos.map((x) => x.id), i, 1); if (ids) reorder.mutate(ids); }} />
                </View>
                <View className="flex-row">
                  {!p.isCover ? <PhotoButton icon={Star} label="Đặt làm ảnh bìa" disabled={busy} onPress={() => cover.mutate(p.id)} /> : null}
                  <PhotoButton
                    icon={Trash2}
                    label="Xoá ảnh"
                    danger
                    disabled={busy}
                    onPress={() =>
                      Alert.alert("Xoá ảnh này?", "Ảnh sẽ biến khỏi thư viện công khai của chi nhánh.", [
                        { text: "Không", style: "cancel" },
                        { text: "Xoá", style: "destructive", onPress: () => remove.mutate(p.id) },
                      ])
                    }
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

function PhotoButton({ icon: Icon, label, onPress, disabled, danger }: { icon: any; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Tappable accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} className={`p-2 ${disabled ? "opacity-30" : ""}`}>
      <Icon size={16} color={danger ? darkColors.destructive : designTokens.mutedForeground} />
    </Tappable>
  );
}

// ── Branch verification documents ─────────────────────────────────────────────────────────────

export function VerificationSection({ uid, gymId }: { uid: string; gymId: string }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const key = branchKeys(uid, gymId).docs;
  const query = useQuery({ queryKey: key, queryFn: () => gymService.listBranchDocuments(gymId) });
  const [uploadingType, setUploadingType] = useState<BranchDocumentType | null>(null);
  const documents = query.data?.documents ?? [];
  const partnerContext = query.data?.partnerContext ?? [];
  const byType = new Map(documents.map((d) => [d.docType, d]));

  const upload = async (docType: BranchDocumentType) => {
    try {
      const file = await pickApplicationFile(true);
      if (!file) return;
      setUploadingType(docType);
      await gymService.uploadBranchDocument(gymId, docType, file);
      toast.show("Đã nộp giấy tờ — chờ Gymini xem xét", "success");
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.show(serverMessage(e, "Không thể tải tệp lên"), "danger");
    } finally {
      setUploadingType(null);
    }
  };

  return (
    <SectionCard title="Xác minh" hint="Giấy tờ riêng cho ĐỊA ĐIỂM này — không phải giấy tờ pháp nhân đối tác (đã nộp một lần khi thẩm định, xem bên dưới). Chỉ Gymini xem, không công khai.">
      {query.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : query.isError ? (
        <Text className="font-body text-xs text-destructive">Không tải được giấy tờ.</Text>
      ) : (
        <>
          {BRANCH_DOC_ORDER.map((docType) => {
            const doc = byType.get(docType);
            const st = docStatus(doc?.status);
            return (
              <View key={docType} className="gap-2 rounded-xl border border-border bg-panel p-3">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="font-body-semibold text-sm text-foreground">{BRANCH_DOC_LABEL[docType]}</Text>
                    <View className="flex-row">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </View>
                  </View>
                  <Button size="sm" variant="secondary" icon={Upload} disabled={uploadingType != null} onPress={() => void upload(docType)}>
                    {uploadingType === docType ? "Đang tải…" : doc?.fileToken ? "Nộp lại" : "Tải lên"}
                  </Button>
                </View>
                {doc?.fileToken ? <DocumentPreview token={doc.fileToken} label={BRANCH_DOC_LABEL[docType]} /> : null}
              </View>
            );
          })}
          {partnerContext.length > 0 ? (
            <View className="gap-1.5 border-t border-border pt-3">
              <Text className="font-body text-[11px] uppercase tracking-wider text-muted-foreground">Giấy tờ đối tác đã nộp (chỉ xem)</Text>
              {partnerContext.map((d) => {
                const st = docStatus(d.status);
                return (
                  <View key={d.docType} className="flex-row items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
                      {PARTNER_DOC_LABEL[d.docType] ?? d.docType}
                    </Text>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

/** A submitted private file: images as a thumbnail (downloaded with the session token), PDFs opened in the OS viewer. */
function DocumentPreview({ token, label }: { token: string; label: string }) {
  const toast = useToast();
  const pdf = isPdfToken(token);
  const fileQuery = useQuery({ queryKey: ["branch-document-file", token], queryFn: () => gymService.fetchBranchDocumentFile(token), enabled: !pdf, staleTime: Infinity });
  const [opening, setOpening] = useState(false);
  if (pdf) {
    return (
      <Button
        size="sm"
        variant="ghost"
        icon={FileText}
        disabled={opening}
        onPress={async () => {
          setOpening(true);
          try {
            await shareLocalFile(await gymService.fetchBranchDocumentFile(token), "application/pdf");
          } catch (e) {
            toast.show(serverMessage(e, "Không thể mở tệp"), "danger");
          } finally {
            setOpening(false);
          }
        }}
      >
        {opening ? "Đang mở…" : "Xem tệp PDF đã nộp"}
      </Button>
    );
  }
  if (fileQuery.data) return <Image accessibilityLabel={label} source={{ uri: fileQuery.data }} style={{ width: 96, height: 96, borderRadius: 8 }} />;
  return fileQuery.isError ? <Text className="font-body text-[11px] text-muted-foreground">Không xem trước được tệp.</Text> : null;
}

// ── Operational status (OWNER and the branch's MANAGER) ──────────────────────────────────────

export function OperationsSection({ uid, gym }: { uid: string; gym: any }) {
  const toast = useToast();
  const qc = useQueryClient();
  const keys = branchKeys(uid, gym.id);
  const [mode, setMode] = useState<ClosingMode | null>(null);
  const [reason, setReason] = useState("");
  const [reopen, setReopen] = useState("");
  const actions = operationalActions(gym.operationalStatus);
  const impactQuery = useQuery({ queryKey: keys.impact, queryFn: () => gymService.getClosureImpact(gym.id), enabled: mode === "PERMANENTLY_CLOSED" });

  const set = useMutation({
    mutationFn: (p: { operationalStatus: "OPEN" | ClosingMode; reason?: string; expectedReopenAt?: string }) =>
      gymService.setGymOperationalStatus(gym.id, p.operationalStatus, p.reason, p.expectedReopenAt),
    onSuccess: () => {
      toast.show("Đã cập nhật trạng thái hoạt động", "success");
      setMode(null);
      setReason("");
      setReopen("");
      void qc.invalidateQueries({ queryKey: keys.gym });
      void qc.invalidateQueries({ queryKey: ["owned-gyms", uid] });
    },
    onError: (e) => toast.show(serverMessage(e, "Không thể cập nhật"), "danger"),
  });

  const dateError = reopenDateError(reopen, toDateInputValue(new Date()));
  const confirm = () => {
    if (!mode) return;
    const go = () => set.mutate(closePayload(mode, reason, reopen));
    if (mode === "PERMANENTLY_CLOSED") {
      Alert.alert("Đóng cửa vĩnh viễn?", "Hành động này không thể hoàn tác.", [
        { text: "Không", style: "cancel" },
        { text: "Đóng vĩnh viễn", style: "destructive", onPress: go },
      ]);
    } else go();
  };

  return (
    <SectionCard title="Trạng thái hoạt động">
      {gym.operationalStatus === "PERMANENTLY_CLOSED" ? (
        <Text className="font-body text-xs text-muted-foreground">Chi nhánh đã đóng cửa vĩnh viễn — không thể đổi trạng thái nữa.</Text>
      ) : mode ? (
        <View className="gap-3">
          {mode === "PERMANENTLY_CLOSED" ? (
            <View className="gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <View className="flex-row items-center gap-1.5">
                <AlertTriangle size={14} color={darkColors.destructive} />
                <Text className="font-body-semibold text-xs text-destructive">Ảnh hưởng khi đóng cửa vĩnh viễn</Text>
              </View>
              {impactQuery.isLoading ? (
                <ActivityIndicator />
              ) : impactQuery.data ? (
                <View className="gap-0.5">
                  <Text className="font-body text-xs text-foreground">
                    {impactQuery.data.activeMembers} hội viên đang có gói hiệu lực
                    {impactQuery.data.unusedValueTotal > 0 ? ` — giá trị chưa dùng ước tính ${formatVND(impactQuery.data.unusedValueTotal)}` : ""}
                  </Text>
                  <Text className="font-body text-xs text-foreground">{impactQuery.data.activeCollaborations} cộng tác PT đang hoạt động tại chi nhánh này</Text>
                  <Text className="font-body text-xs text-foreground">Số dư ví hiện tại: {formatVND(Number(impactQuery.data.walletBalance ?? 0))}</Text>
                </View>
              ) : (
                <Text className="font-body text-xs text-muted-foreground">Không tải được số liệu ảnh hưởng — vẫn có thể tiếp tục.</Text>
              )}
              <Text className="font-body text-[11px] text-muted-foreground">
                Không thể hoàn tác. Hội viên đang hoạt động sẽ được Gymini xem xét hoàn tiền riêng, không tự động ngay lúc này.
              </Text>
            </View>
          ) : null}
          <Input label="Lý do đóng cửa" value={reason} onChangeText={setReason} multiline numberOfLines={3} style={MULTILINE} maxLength={500} />
          {mode === "TEMPORARILY_CLOSED" ? (
            <Input
              label="Ngày dự kiến mở lại (không bắt buộc, YYYY-MM-DD)"
              value={reopen}
              onChangeText={setReopen}
              placeholder={toDateInputValue(new Date())}
              placeholderTextColor={inputPlaceholderColor}
              maxLength={10}
              error={dateError}
            />
          ) : null}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button full variant="secondary" onPress={() => { setMode(null); setReason(""); setReopen(""); }}>
                Huỷ
              </Button>
            </View>
            <View className="flex-1">
              <Button full variant="destructive" disabled={!reason.trim() || !!dateError || set.isPending} onPress={confirm}>
                {set.isPending ? "Đang lưu…" : mode === "TEMPORARILY_CLOSED" ? "Tạm đóng cửa" : "Đóng vĩnh viễn"}
              </Button>
            </View>
          </View>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {actions.reopen ? (
            <Button size="sm" icon={Unlock} disabled={set.isPending} onPress={() => set.mutate({ operationalStatus: "OPEN" })}>
              Mở lại
            </Button>
          ) : null}
          {actions.closeTemporarily ? (
            <Button size="sm" variant="secondary" icon={Lock} onPress={() => setMode("TEMPORARILY_CLOSED")}>
              Tạm đóng cửa
            </Button>
          ) : null}
          {actions.closePermanently ? (
            <Button size="sm" variant="ghost" icon={Lock} onPress={() => setMode("PERMANENTLY_CLOSED")}>
              Đóng cửa vĩnh viễn
            </Button>
          ) : null}
        </View>
      )}
    </SectionCard>
  );
}

// ── Members of this branch (web lists them on the manage page) ────────────────────────────────

const MEMBERSHIP_STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  ACTIVE: { label: "Đang hiệu lực", tone: "success" },
  PENDING_PAYMENT: { label: "Chờ thanh toán", tone: "warning" },
  EXPIRED: { label: "Hết hạn", tone: "neutral" },
  CANCELLED: { label: "Đã huỷ", tone: "neutral" },
  PENDING_ISSUE: { label: "Đang xử lý sự cố", tone: "danger" },
};

export function MembersSection({ gymId }: { gymId: string }) {
  const accent = useWorkspaceAccent();
  const query = useQuery({ queryKey: branchKeys("", gymId).members, queryFn: () => gymService.listOwnedMemberships(gymId) });
  const rows: any[] = Array.isArray(query.data) ? query.data : [];
  return (
    <SectionCard title={`Hội viên (${rows.length})`}>
      {query.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : rows.length === 0 ? (
        <Text className="font-body text-xs text-muted-foreground">Chưa có hội viên nào.</Text>
      ) : (
        rows.map((m) => {
          const st = MEMBERSHIP_STATUS[m.status] ?? { label: String(m.status ?? ""), tone: "neutral" as const };
          return (
            <View key={m.id} className="flex-row items-center justify-between gap-2 rounded-xl border border-border bg-panel px-3 py-2.5">
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-xs text-foreground" numberOfLines={1}>
                  {memberLabel(m.clientId)}
                </Text>
                {m.status === "ACTIVE" ? (
                  <Text className="font-body text-[11px] text-muted-foreground">
                    {m.totalVisits != null ? `Lượt: ${m.usedVisits}/${m.totalVisits}` : `Đã vào ${m.usedVisits ?? 0} lượt · không giới hạn`}
                  </Text>
                ) : null}
              </View>
              <Badge tone={st.tone}>{st.label}</Badge>
              <Text className="font-body-semibold text-xs text-primary">{formatVND(Number(m.priceAtPurchase ?? 0))}</Text>
            </View>
          );
        })
      )}
    </SectionCard>
  );
}
