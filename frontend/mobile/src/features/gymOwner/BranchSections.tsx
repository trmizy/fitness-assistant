import { useState } from "react";
import { ActivityIndicator, Alert, Image, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, Lock, Plus, Star, Trash2, Unlock, Upload } from "lucide-react-native";

import { Badge, Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { SelectField } from "../../components/SelectSheet";
import { gymListingService, gymPhotoUrl, gymService, locationService, ownerAmenityService, uploadGymListingPhoto } from "../../services/api";
import { router } from "expo-router";
import {
  amenitySelectionError,
  amenitySelectionPayload,
  gymListingErrorMessage,
  isReviewRequired,
  isUploadRouteRetired,
  normalizeAmenity,
  normalizeCatalog,
  normalizeProposal,
  ownerAmenitiesKey,
  type Amenity,
  type Proposal,
} from "../gymListing/gymListing";
import { InlineAmenityPicker, type InlineProposal } from "../gymListing/InlineAmenityPicker";
import { useServerSeededState } from "../../hooks/useServerSeededState";
import { AmenityBadgeGroups } from "../gymListing/AmenityWidgets";
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
import { facilityLabels } from "../services/gymDirectory";
import { emailInputProps, normalizeEmail } from "../../lib/email";

/**
 * 14B.5 (PG-A7, GY-03) — the sections of web `GymManagePage`'s "Cài đặt" panel, one card each.
 * Unlike web, every section edits locally and saves with its own button (web saves hours and
 * facilities on every tap/keystroke) — one toast per save instead of one per change.
 */

/** The shared Input is one line tall (h-12); a multi-line field needs room for its text and placeholder. */
const MULTILINE = { height: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" } as const;

/**
 * The server's own sentence — except the two refusals Listing Management added to the old routes, which get the app's
 * wording: 409 LISTING_REVIEW_REQUIRED (the change now goes through a reviewed listing) and 410 UPLOAD_ROUTE_RETIRED.
 */
const serverMessage = (e: any, fallback: string) =>
  isReviewRequired(e) || isUploadRouteRetired(e) ? gymListingErrorMessage(e, fallback) : e?.response?.data?.error?.message || e?.message || fallback;

/** Branches whose listing is revised through "Tin đăng & tiện ích" (gym-service: APPROVED / SUSPENDED). Their description, amenities and photos are read-only here. */
const hasReviewedListing = (status: string | null | undefined) => status === "APPROVED" || status === "SUSPENDED";

function EditInListingButton({ gymId }: { gymId: string }) {
  return (
    <Button variant="secondary" onPress={() => router.push({ pathname: "/gym-owner/listing", params: { gymId } } as never)}>
      Sửa ở Tin đăng
    </Button>
  );
}

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
  // Listing Management: once a branch has left DRAFT its description is part of the reviewed listing — PATCH answers
  // 409 LISTING_REVIEW_REQUIRED. Phone and email stay immediate.
  const descriptionLocked = gym.status !== "DRAFT";
  const error = descriptionLocked ? aboutError({ ...form, description: "" }) : aboutError(form);
  return (
    <SectionCard
      title="Giới thiệu & liên hệ"
      hint={
        descriptionLocked
          ? "Điện thoại và email có hiệu lực ngay. Phần giới thiệu là một phần của tin đăng nên sửa ở mục Tin đăng & tiện ích và cần Gymini duyệt."
          : `Hiện ở mục "Chi tiết" khi khách xem chi nhánh. Có hiệu lực ngay, không cần Gymini duyệt.`
      }
    >
      {descriptionLocked ? (
        <View className="gap-1.5">
          <Text className="font-body-medium text-xs text-muted-foreground">Giới thiệu</Text>
          <View className="rounded-xl border border-border bg-panel p-3">
            <Text className="font-body text-sm leading-5 text-foreground">{form.description.trim() || "Chưa có phần giới thiệu."}</Text>
          </View>
          {hasReviewedListing(gym.status) ? <EditInListingButton gymId={gym.id} /> : null}
        </View>
      ) : (
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
      )}
      <Input label="Điện thoại chi nhánh" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} keyboardType="phone-pad" maxLength={20} />
      <Input label="Email chi nhánh" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} {...emailInputProps} maxLength={200} />
      <Button
        disabled={!!error || save.isPending}
        onPress={() =>
          save.mutate({
            // A non-DRAFT branch must not send the description at all (the server refuses the whole PATCH).
            ...(descriptionLocked ? {} : { description: form.description.trim() }),
            phone: form.phone.trim(),
            email: normalizeEmail(form.email),
          })
        }
      >
        {save.isPending ? "Đang lưu…" : descriptionLocked ? "Lưu liên hệ" : "Lưu giới thiệu & liên hệ"}
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
  const reviewed = gym.status !== "DRAFT";
  // GET /owner/gyms/:id carries the REAL selection for the OWNER: `amenities` (custom ones included, any catalogue status) and
  // `amenityProposals` (the owner's PENDING proposals for this branch). `facilities` is only the SYSTEM mirror and is read here
  // only when an older answer has no `amenities` at all.
  const amenities = (Array.isArray(gym.amenities) ? gym.amenities : []).map(normalizeAmenity).filter((a: Amenity | null): a is Amenity => !!a);
  const proposals = (Array.isArray(gym.amenityProposals) ? gym.amenityProposals : []).map(normalizeProposal).filter((p: Proposal | null): p is Proposal => !!p);
  const hasRealList = Array.isArray(gym.amenities);

  if (reviewed) return <ReviewedAmenities gym={gym} amenities={amenities} proposals={proposals} hasRealList={hasRealList} />;
  return <DraftAmenities uid={uid} gym={gym} amenities={amenities} proposals={proposals} hasRealList={hasRealList} />;
}

/** A branch that has left DRAFT edits its amenities through a reviewed listing (PATCH facilities -> 409 LISTING_REVIEW_REQUIRED): shown, not edited. */
function ReviewedAmenities({ gym, amenities, proposals, hasRealList }: { gym: any; amenities: Amenity[]; proposals: Proposal[]; hasRealList: boolean }) {
  const saved: GymFacility[] = Array.isArray(gym.facilities) ? gym.facilities : [];
  const shown = amenities.filter((a) => a.status === "ACTIVE");
  const fallbackLabels = hasRealList ? [] : facilityLabels(saved);
  return (
    <SectionCard title="Tiện ích & dịch vụ" hint="Tiện ích là một phần của tin đăng nên sửa ở mục Tin đăng & tiện ích và cần Gymini duyệt.">
      {shown.length > 0 ? (
        <AmenityBadgeGroups amenities={shown} />
      ) : fallbackLabels.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {fallbackLabels.map((l) => (
            <Badge key={l} tone="neutral">
              {l}
            </Badge>
          ))}
        </View>
      ) : (
        <Text className="font-body text-xs text-muted-foreground">Chưa có tiện ích nào.</Text>
      )}
      {proposals.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {proposals.map((p) => (
            <Badge key={p.id} tone="info">{p.name + " · chờ duyệt"}</Badge>
          ))}
        </View>
      ) : null}
      {hasReviewedListing(gym.status) ? (
        <EditInListingButton gymId={gym.id} />
      ) : (
        <Text className="font-body text-[11px] leading-4 text-muted-foreground">Chi nhánh được duyệt xong mới sửa được tiện ích ở Tin đăng.</Text>
      )}
    </SectionCard>
  );
}

/**
 * A DRAFT branch (the wizard) picks its amenities from the catalogue and saves them with PATCH /owner/gyms/:id/draft
 * ({ amenityIds, proposalIds, proposals }). The selection read back is the server's real one, so a custom amenity chosen on another
 * device is not silently dropped by the next save.
 */
function DraftAmenities({ uid, gym, amenities, proposals, hasRealList }: { uid: string; gym: any; amenities: Amenity[]; proposals: Proposal[]; hasRealList: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const catalogQuery = useQuery({ queryKey: ownerAmenitiesKey(uid), queryFn: async () => normalizeCatalog(await ownerAmenityService.catalog()) });
  const savedIds = amenities.filter((a) => a.status === "ACTIVE").map((a) => a.id);
  // An older answer without `amenities`: start from the system mirror (enum codes -> the SYSTEM amenity ids).
  const mirrorIds = hasRealList ? [] : (Array.isArray(gym.facilities) ? gym.facilities : []).map((f: string) => "amenity-sys-" + f.toLowerCase().replace(/_/g, "-"));
  const initial: string[] = hasRealList ? savedIds : mirrorIds;
  const pending = proposals.filter((p) => p.status === "PENDING");
  const seedKey = JSON.stringify([initial, pending.map((p) => p.id)]);
  const [selected, setSelected] = useServerSeededState<string[]>(initial, seedKey);
  const [kept, setKept] = useServerSeededState<string[]>(pending.map((p) => p.id), seedKey);
  const [newProposals, setNewProposals] = useState<InlineProposal[]>([]);
  const selection = { amenityIds: selected, proposals: newProposals, proposalIds: kept };

  const save = useMutation({
    mutationFn: () => gymService.updateGymDraft(gym.id, amenitySelectionPayload(selection)),
    onSuccess: () => {
      toast.show("Đã lưu tiện ích & dịch vụ", "success");
      setNewProposals([]);
      void qc.invalidateQueries({ queryKey: branchKeys(uid, gym.id).gym });
      void qc.invalidateQueries({ queryKey: ["owned-gyms", uid] });
    },
    onError: (e) => toast.show(serverMessage(e, "Không thể lưu thay đổi"), "danger"),
  });
  const problem = amenitySelectionError(selection);
  const unchanged = newProposals.length === 0 && seedKey === JSON.stringify([selected, kept]);

  return (
    <SectionCard title="Tiện ích & dịch vụ" hint="Chọn những tiện ích chi nhánh này thực sự có — khách thấy danh sách này khi tìm phòng gym. Cần ít nhất một.">
      <InlineAmenityPicker
        catalog={catalogQuery.data?.amenities ?? []}
        loading={catalogQuery.isLoading}
        error={catalogQuery.isError ? gymListingErrorMessage(catalogQuery.error, "Không tải được danh mục tiện ích.") : null}
        onRetry={() => void catalogQuery.refetch()}
        selectedIds={selected}
        onSelectedChange={setSelected}
        proposals={newProposals}
        onProposalsChange={setNewProposals}
        existing={pending}
        keptProposalIds={kept}
        onKeptProposalIdsChange={setKept}
      />
      <Button disabled={!!problem || unchanged || save.isPending} onPress={() => save.mutate()}>
        {save.isPending ? "Đang lưu…" : "Lưu tiện ích"}
      </Button>
    </SectionCard>
  );
}

// ── Photos ────────────────────────────────────────────────────────────────────────────────────

export function PhotosSection({ uid, gymId, status }: { uid: string; gymId: string; status?: string | null }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const key = branchKeys(uid, gymId).photos;
  const query = useQuery({ queryKey: key, queryFn: () => gymService.listGymPhotos(gymId) as Promise<(GymPhoto & { url?: string | null })[]> });
  const photos = query.data ?? [];
  const [uploading, setUploading] = useState<string | null>(null);

  // Listing Management: the old disk-photo write routes answer 410 UPLOAD_ROUTE_RETIRED for every branch. A DRAFT branch (the
  // wizard) uses the new presign / confirm / reorder / cover routes; an approved one edits photos in its reviewed listing; the rest
  // (waiting for first review, rejected) cannot take photo changes at all.
  const draft = status === "DRAFT";

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (fallback: string) => (e: unknown) => toast.show(serverMessage(e, fallback), "danger");
  const remove = useMutation({ mutationFn: (id: string) => gymListingService.deletePhoto(gymId, id), onSuccess: refresh, onError: onError("Không thể xoá ảnh") });
  // Refetch after cover/reorder: it also picks up a fresh signed link, which expires after a few minutes.
  const cover = useMutation({
    mutationFn: (id: string) => gymListingService.setCover(gymId, id),
    onSuccess: refresh,
    onError: onError("Không thể đặt ảnh bìa"),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => gymListingService.reorderPhotos(gymId, ids),
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
        await uploadGymListingPhoto(gymId, files[i]);
      }
      if (files.length) toast.show(files.length > 1 ? `Đã tải lên ${files.length} ảnh` : "Đã tải ảnh lên", "success");
    } catch (e) {
      toast.show(gymListingErrorMessage(e, "Không thể tải ảnh lên"), "danger");
    } finally {
      setUploading(null);
      void refresh();
    }
  };

  const busy = remove.isPending || cover.isPending || reorder.isPending || uploading != null;
  return (
    <SectionCard
      title="Hình ảnh"
      hint={
        draft
          ? `Thư viện ảnh công khai — khách xem khi tìm phòng gym. Tối đa ${MAX_PHOTOS} ảnh, JPG/PNG/WEBP, mỗi ảnh ≤ 8 MB.`
          : "Ảnh là một phần của tin đăng nên thêm, xoá và sắp xếp ở mục Tin đăng & tiện ích; thay đổi cần Gymini duyệt."
      }
    >
      {draft ? (
        <Button variant="secondary" icon={Plus} disabled={busy || photos.length >= MAX_PHOTOS} onPress={() => void add()}>
          {uploading ? `Đang tải ảnh lên ${uploading}…` : `Thêm ảnh (${photos.length}/${MAX_PHOTOS})`}
        </Button>
      ) : hasReviewedListing(status) ? (
        <EditInListingButton gymId={gymId} />
      ) : (
        <Text className="font-body text-xs text-muted-foreground">Chi nhánh được duyệt xong mới thêm hoặc sửa ảnh ở Tin đăng.</Text>
      )}
      {query.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : photos.length === 0 ? (
        <Text className="font-body text-xs text-muted-foreground">Chưa có ảnh nào{draft ? " — thêm ít nhất một ảnh để khách hình dung được không gian tập." : "."}</Text>
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
              {draft ? (
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
                        Alert.alert("Xoá ảnh này?", "Ảnh sẽ biến khỏi thư viện của chi nhánh.", [
                          { text: "Không", style: "cancel" },
                          { text: "Xoá", style: "destructive", onPress: () => remove.mutate(p.id) },
                        ])
                      }
                    />
                  </View>
                </View>
              ) : null}
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
                  <Text className="font-body text-xs text-foreground">{impactQuery.data.activeCollaborations} thỏa thuận hợp tác PT đang áp dụng cho chi nhánh này</Text>
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
