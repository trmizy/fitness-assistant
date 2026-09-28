import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, FileText, ImagePlus, Trash2, TriangleAlert } from "lucide-react-native";

import { Badge, Button, Card, Input, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { SelectField } from "../../components/SelectSheet";
import {
  locationService,
  partnerApplicationService,
  uploadApplicationFile,
  type PartnerDocType,
  type PartnerPhotoCategory,
  type PartnerRepresentativeRole,
} from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import { designTokens } from "../../theme/colors";
import { pickApplicationFile } from "../../lib/pickFile";
import { useServerSeededState } from "../../hooks/useServerSeededState";
import { MapPinPicker } from "../gymOwner/MapPinPicker";
import { geocodeAddress, PRECISION_TEXT } from "../gymOwner/geocode";
import { ABOUT_MAX, socialUrlError, SOCIAL_FIELDS } from "../gymOwner/gymOwner";
import {
  BUSINESS_SCALES,
  DOC_TYPES,
  MAX_FILES_PER_DOCUMENT,
  PHOTO_CATEGORIES,
  REPRESENTATIVE_ROLES,
  STEPS,
  canAddDocumentFile,
  canResubmit,
  documentsToReplace,
  isChangesRequested,
  docStatus,
  documentFiles,
  findDocument,
  firstIncompleteStep,
  friendlyError,
  issueStatus,
  ISSUE_CATEGORY,
  issuesOf,
  missingForStep,
  missingItems,
  progressPercent,
  stepDone,
  type ApplicationView,
} from "./partnerApplication";

/**
 * WB-16 + GY-09 — hồ sơ đối tác 9 bước.
 *
 * **Máy chủ quyết định còn thiếu gì.** `view.missing` là nguồn duy nhất cho: mở ra đứng ở bước nào,
 * tiến độ bao nhiêu, bước nào đã xong, và còn gì chặn nộp. Không có bộ kiểm hợp lệ thứ hai ở máy —
 * hai bộ luật song song là hai bộ luật sẽ lệch nhau.
 *
 * **Mỗi bước tự lưu lên máy chủ khi bấm "Tiếp tục".** Không có thao tác nào chỉ tồn tại ở máy; đóng
 * app giữa chừng mở lại là tiếp đúng chỗ, vì chỗ đó tính từ dữ liệu đã lưu.
 *
 * Là component chứ không phải route, cùng lý do với `PartnerOnboardingWizard`: route sẽ nằm trong
 * đúng vùng mà `RequirePartnerAccess` đang chặn, và đây phải là màn chặn toàn màn hình.
 */
export function ApplicationWizard() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, logout } = useApp();
  const uid = user?.id ?? "guest";

  const key = ["partner-application", uid];
  const query = useQuery({
    queryKey: key,
    queryFn: () => partnerApplicationService.get(),
    /**
     * Chính sách chung không thử lại lỗi 4xx — đúng ở mọi nơi khác, nhưng sai ở đúng chỗ này: ngay
     * sau `bootstrap`, hồ sơ vừa được tạo và lần đọc đầu tiên có thể đến sớm hơn một nhịp, trả về
     * "chưa có" rồi kẹt lại ở màn lỗi cho tới khi người dùng tự bấm "Thử lại" (đã gặp thật khi chạy
     * luồng đăng ký mới). "Chưa có" ở đây là tạm thời, nên thử lại vài nhịp ngắn.
     */
    retry: (failureCount, error: any) => {
      const status = error?.response?.status;
      if (status === 404 || status === 409) return failureCount < 3;
      if (typeof status === "number" && status < 500) return false;
      return failureCount < 1;
    },
    retryDelay: (attempt) => Math.min(1500, 400 * (attempt + 1)),
  });
  const view = (query.data ?? null) as ApplicationView | null;

  // Bước đang xem: mồi bằng bước đầu tiên còn thiếu, rồi do người dùng lái. Không tự nhảy khi lưu —
  // lưu xong mà bị kéo đi chỗ khác thì không ai biết mình vừa ở đâu.
  const [idx, setIdx] = useServerSeededState(firstIncompleteStep(view), view ? "loaded" : "loading");
  const step = STEPS[idx];

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ["partner-access-status", uid] });
  };
  const fail = (e: unknown, fallback: string) => toast.show(friendlyError(e, fallback), "danger");

  if (query.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  // Chỉ chặn toàn màn khi CHƯA từng có dữ liệu. Một lần làm mới hỏng sau khi lưu (đã gặp thật ở bước
  // Quy mô) không được xoá cả hồ sơ khỏi màn hình — dữ liệu cũ vẫn đúng tới lần tải kế tiếp.
  if (!view) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background p-8">
        <Text className="text-center font-body text-sm text-destructive">Không tải được hồ sơ của bạn.</Text>
        <Button variant="secondary" onPress={() => void query.refetch()}>
          Thử lại
        </Button>
      </View>
    );
  }

  const percent = progressPercent(view);
  // Bước cuối tự kể mục còn thiếu (và ô đồng ý trả lời mục điều khoản) — không nhắc lại lần hai ở trên.
  const missingHere = step.id === "review" ? [] : missingForStep(view, step);
  const editable = view.editable !== false;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 }}
      >
        <Text className="font-display text-xl text-foreground">Hồ sơ đối tác</Text>
        <Text className="mt-1 font-body text-xs text-muted-foreground">
          Bước {idx + 1}/{STEPS.length}: {step.title} · hoàn thành {percent}%
        </Text>

        <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
          <View className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </View>

        {/* Nhảy nhanh giữa các bước — dấu tích cho biết máy chủ đã nhận đủ phần đó chưa. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 6 }}>
          {STEPS.map((s, i) => {
            const done = stepDone(view, s);
            const on = i === idx;
            return (
              <Tappable
                key={s.id}
                accessibilityLabel={s.title}
                onPress={() => setIdx(i)}
                className={`flex-row items-center gap-1 rounded-full border px-2.5 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                {done ? <Check size={11} color={accent.primary} /> : null}
                <Text className={`font-body text-[11px] ${on ? "text-primary" : "text-muted-foreground"}`}>{s.title}</Text>
              </Tappable>
            );
          })}
        </ScrollView>

        {missingHere.length > 0 ? (
          <Card className="mt-4 gap-1.5 border-warning/30 bg-warning/5 p-4">
            {missingHere.map((m, i) => (
              <View key={i} className="flex-row items-start gap-2">
                <TriangleAlert size={13} color={designTokens.warning} />
                <Text className="flex-1 font-body text-xs text-muted-foreground">{m.message}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {!editable ? (
          <Card className="mt-4 p-4">
            <Text className="font-body text-xs leading-5 text-muted-foreground">
              Hồ sơ đang ở trạng thái không sửa được. Bạn vẫn xem lại được mọi thông tin đã khai.
            </Text>
          </Card>
        ) : null}

        <View className="mt-4">
          {step.id === "representative" ? <RepresentativeStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "brand" ? <BrandStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "social" ? <SocialStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "scale" ? <ScaleStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "branch" ? <BranchStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "location" ? <LocationStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "photos" ? <PhotosStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "legal" ? <LegalStep view={view} onSaved={refresh} fail={fail} editable={editable} /> : null}
          {step.id === "review" ? <ReviewStep view={view} onSaved={refresh} fail={fail} onGoTo={setIdx} /> : null}
        </View>

        <View className="mt-5 flex-row gap-2">
          <Button
            className="flex-1"
            variant="secondary"
            icon={ChevronLeft}
            disabled={idx === 0}
            onPress={() => setIdx(Math.max(0, idx - 1))}
          >
            Trước
          </Button>
          <Button
            className="flex-1"
            icon={ChevronRight}
            disabled={idx >= STEPS.length - 1}
            onPress={() => setIdx(Math.min(STEPS.length - 1, idx + 1))}
          >
            Sau
          </Button>
        </View>

        <Tappable accessibilityLabel="Đăng xuất" onPress={() => void logout()} className="mt-6 self-center p-2">
          <Text className="font-body text-xs text-muted-foreground">Đăng xuất</Text>
        </Tappable>
      </ScrollView>
    </View>
  );
}

type StepProps = {
  view: ApplicationView;
  onSaved: () => Promise<void>;
  fail: (e: unknown, fallback: string) => void;
  editable: boolean;
};

function SaveButton({ pending, disabled, onPress }: { pending: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Button disabled={pending || disabled} onPress={onPress}>
      {pending ? "Đang lưu…" : "Lưu bước này"}
    </Button>
  );
}

function RepresentativeStep({ view, onSaved, fail, editable }: StepProps) {
  const p = view.partner ?? {};
  const [name, setName] = useServerSeededState(String(p.representativeName ?? ""), String(p.representativeName ?? ""));
  const [phone, setPhone] = useServerSeededState(String(view.representativePhone ?? ""), String(view.representativePhone ?? ""));
  const [role, setRole] = useServerSeededState(String(p.representativeRole ?? ""), String(p.representativeRole ?? ""));

  const save = useMutation({
    mutationFn: () =>
      partnerApplicationService.saveRepresentative({
        name: name.trim(),
        phone: phone.trim(),
        role: role as PartnerRepresentativeRole,
      }),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được người đại diện"),
  });

  return (
    <Card className="gap-3 p-5">
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Người Gymini liên hệ về hồ sơ này. Tên phải khớp giấy tờ tuỳ thân bạn nộp ở bước xác minh.
      </Text>
      <Input label="Họ và tên" value={name} onChangeText={setName} editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input
        label="Số điện thoại"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        editable={editable}
        placeholderTextColor={inputPlaceholderColor}
      />
      <SelectField
        label="Vai trò"
        value={role}
        options={REPRESENTATIVE_ROLES.map((r) => ({ value: r.value, label: r.label }))}
        onChange={setRole}
        disabled={!editable}
      />
      <SaveButton pending={save.isPending} disabled={!editable || !name.trim() || !phone.trim() || !role} onPress={() => save.mutate()} />
    </Card>
  );
}

function BrandStep({ view, onSaved, fail, editable }: StepProps) {
  const b = view.brand ?? {};
  const [name, setName] = useServerSeededState(String(b.name ?? ""), String(b.name ?? ""));
  const [description, setDescription] = useServerSeededState(String(b.description ?? ""), String(b.description ?? ""));

  const save = useMutation({
    mutationFn: () => partnerApplicationService.saveBrand({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được thương hiệu"),
  });

  return (
    <Card className="gap-3 p-5">
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Tên khách thấy khi tìm kiếm. Bạn có đúng một thương hiệu; mọi chi nhánh sau này đều thuộc nó.
      </Text>
      <Input label="Tên thương hiệu" value={name} onChangeText={setName} editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input
        label={`Giới thiệu (tuỳ chọn) · ${description.length}/${ABOUT_MAX}`}
        value={description}
        onChangeText={(v) => setDescription(v.slice(0, ABOUT_MAX))}
        multiline
        numberOfLines={3}
        editable={editable}
        placeholderTextColor={inputPlaceholderColor}
      />
      <SaveButton pending={save.isPending} disabled={!editable || !name.trim()} onPress={() => save.mutate()} />
    </Card>
  );
}

function SocialStep({ view, onSaved, fail, editable }: StepProps) {
  const b: any = view.brand ?? {};
  const seed = {
    facebookUrl: String(b.facebookUrl ?? ""),
    instagramUrl: String(b.instagramUrl ?? ""),
    tiktokUrl: String(b.tiktokUrl ?? ""),
    youtubeUrl: String(b.youtubeUrl ?? ""),
  };
  const [form, setForm] = useServerSeededState(seed, JSON.stringify(seed));
  const firstError = SOCIAL_FIELDS.map((s) => socialUrlError(s.key, (form as any)[s.key])).find(Boolean) ?? null;

  const save = useMutation({
    mutationFn: () =>
      partnerApplicationService.saveSocial({
        facebookUrl: form.facebookUrl.trim(),
        instagramUrl: form.instagramUrl.trim(),
        tiktokUrl: form.tiktokUrl.trim(),
        youtubeUrl: form.youtubeUrl.trim(),
      }),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được liên kết mạng xã hội"),
  });

  return (
    <Card className="gap-3 p-5">
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Không bắt buộc — bỏ trống vẫn nộp được hồ sơ.
      </Text>
      {SOCIAL_FIELDS.map((s) => (
        <Input
          key={s.key}
          label={s.label}
          value={(form as any)[s.key]}
          onChangeText={(v) => setForm({ ...form, [s.key]: v })}
          autoCapitalize="none"
          keyboardType="url"
          editable={editable}
          placeholder={s.placeholder}
          placeholderTextColor={inputPlaceholderColor}
          error={socialUrlError(s.key, (form as any)[s.key])}
        />
      ))}
      <SaveButton pending={save.isPending} disabled={!editable || !!firstError} onPress={() => save.mutate()} />
    </Card>
  );
}

function ScaleStep({ view, onSaved, fail, editable }: StepProps) {
  const current = String(view.partner?.businessScale ?? "");
  const [scale, setScale] = useServerSeededState(current, current);
  const accent = useWorkspaceAccent();

  const save = useMutation({
    mutationFn: () => partnerApplicationService.saveBusinessScale(scale as "ONE_BRANCH" | "MULTIPLE_BRANCHES"),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được quy mô"),
  });

  return (
    <Card className="gap-3 p-5">
      {BUSINESS_SCALES.map((s) => {
        const on = scale === s.value;
        return (
          <Tappable
            key={s.value}
            accessibilityLabel={s.label}
            disabled={!editable}
            onPress={() => setScale(s.value)}
            className={`gap-1 rounded-xl border p-4 ${on ? "border-primary bg-primary/10" : "border-border bg-panel"}`}
          >
            <View className="flex-row items-center gap-2">
              <View className={`h-4 w-4 rounded-full border ${on ? "border-primary bg-primary" : "border-border"}`}>
                {on ? <Check size={11} color={accent.onPrimary} /> : null}
              </View>
              <Text className="font-body-semibold text-sm text-foreground">{s.label}</Text>
            </View>
            <Text className="font-body text-xs text-muted-foreground">{s.hint}</Text>
          </Tappable>
        );
      })}
      <SaveButton pending={save.isPending} disabled={!editable || !scale} onPress={() => save.mutate()} />
    </Card>
  );
}

function BranchStep({ view, onSaved, fail, editable }: StepProps) {
  const br: any = view.branch ?? {};
  const seed = {
    name: String(br.name ?? ""),
    phone: String(br.phone ?? ""),
    email: String(br.email ?? ""),
    description: String(br.description ?? ""),
    address: String(br.address ?? ""),
    city: String(br.city ?? ""),
  };
  const [form, setForm] = useServerSeededState(seed, JSON.stringify(seed));

  const save = useMutation({
    mutationFn: () =>
      partnerApplicationService.saveBranch({
        name: form.name.trim(),
        address: form.address.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim().slice(0, ABOUT_MAX) } : {}),
      }),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được chi nhánh"),
  });

  return (
    <Card className="gap-3 p-5">
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Hồ sơ này khai đúng một chi nhánh. Các chi nhánh khác thêm sau khi được duyệt.
      </Text>
      <Input label="Tên chi nhánh" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input label="Số nhà, tên đường" value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input label="Thành phố hiển thị (tuỳ chọn)" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input label="Điện thoại chi nhánh (tuỳ chọn)" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input label="Email chi nhánh (tuỳ chọn)" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" editable={editable} placeholderTextColor={inputPlaceholderColor} />
      <Input
        label={`Giới thiệu (tuỳ chọn) · ${form.description.length}/${ABOUT_MAX}`}
        value={form.description}
        onChangeText={(v) => setForm({ ...form, description: v.slice(0, ABOUT_MAX) })}
        multiline
        numberOfLines={3}
        editable={editable}
        placeholderTextColor={inputPlaceholderColor}
      />
      <SaveButton pending={save.isPending} disabled={!editable || !form.name.trim() || !form.address.trim()} onPress={() => save.mutate()} />
    </Card>
  );
}

function LocationStep({ view, onSaved, fail, editable }: StepProps) {
  const br: any = view.branch ?? {};
  const seed = {
    provinceCode: br.provinceCode != null ? String(br.provinceCode) : "",
    wardCode: br.wardCode != null ? String(br.wardCode) : "",
    latitude: typeof br.latitude === "number" ? br.latitude : null,
    longitude: typeof br.longitude === "number" ? br.longitude : null,
    locationNote: String(br.locationNote ?? ""),
  };
  const [form, setForm] = useServerSeededState(seed, JSON.stringify(seed));

  const provincesQuery = useQuery({
    queryKey: ["locations", "provinces"],
    queryFn: () => locationService.getProvinces(),
    staleTime: Infinity,
  });
  const wardsQuery = useQuery({
    queryKey: ["locations", "wards", form.provinceCode],
    queryFn: () => locationService.getWards(Number(form.provinceCode)),
    staleTime: Infinity,
    enabled: !!form.provinceCode,
  });
  const provinces = (provincesQuery.data ?? []) as { code: number; name: string }[];
  const wards = (wardsQuery.data ?? []) as { code: number; name: string }[];
  const provinceName = provinces.find((p) => String(p.code) === form.provinceCode)?.name ?? null;
  const wardName = wards.find((w) => String(w.code) === form.wardCode)?.name ?? null;

  /**
   * Tự ghim theo địa chỉ — cùng hợp đồng với hộp thêm chi nhánh (GY-02) và `useAutoPin` của web: chỉ
   * khi đủ số nhà/đường (lấy từ bước Chi nhánh đã lưu) + phường + tỉnh, chỉ sau khi ngừng chọn, mỗi
   * địa chỉ một lần, và KHÔNG BAO GIỜ đè lên ghim người dùng tự đặt. Ghim đã lưu trên máy chủ cũng
   * tính là ghim tay: mở lại bước này không được làm dịch chỗ đã xác nhận.
   */
  const [pinHint, setPinHint] = useState<string | null>(null);
  const lastGeocodeKey = useRef<string | null>(null);
  const pinnedByHand = useRef(seed.latitude != null && seed.longitude != null);
  const street = String(br.address ?? "").trim();
  const geoKey = editable && street.length >= 5 && wardName && provinceName ? `${street}|${wardName}|${provinceName}` : null;

  useEffect(() => {
    if (!geoKey || pinnedByHand.current || geoKey === lastGeocodeKey.current) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      lastGeocodeKey.current = geoKey;
      setPinHint("Đang tìm vị trí theo địa chỉ…");
      geocodeAddress({ street, ward: wardName!, province: provinceName! }, ctrl.signal)
        .then((hit) => {
          if (!hit) return setPinHint("Không tìm thấy địa chỉ trên bản đồ — hãy ghim tay.");
          if (pinnedByHand.current) return;
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
    // street/ward/province đều nằm trong geoKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoKey]);

  const save = useMutation({
    mutationFn: () =>
      partnerApplicationService.saveBranch({
        ...(form.provinceCode ? { provinceCode: Number(form.provinceCode) } : {}),
        ...(form.wardCode ? { wardCode: Number(form.wardCode) } : {}),
        ...(form.latitude != null && form.longitude != null
          ? { latitude: form.latitude, longitude: form.longitude }
          : {}),
        ...(form.locationNote.trim() ? { locationNote: form.locationNote.trim() } : {}),
      }),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được vị trí"),
  });

  return (
    <Card className="gap-3 p-5">
      <SelectField
        label="Tỉnh/Thành phố"
        value={form.provinceCode}
        options={provinces.map((p) => ({ value: String(p.code), label: p.name }))}
        loading={provincesQuery.isLoading}
        onChange={(v) => setForm({ ...form, provinceCode: v, wardCode: "" })}
        disabled={!editable}
        allowClear
      />
      {form.provinceCode ? (
        <SelectField
          label="Phường/Xã"
          value={form.wardCode}
          options={wards.map((w) => ({ value: String(w.code), label: w.name }))}
          loading={wardsQuery.isLoading}
          onChange={(v) => setForm({ ...form, wardCode: v })}
          disabled={!editable}
          allowClear
        />
      ) : null}
      <MapPinPicker
        latitude={form.latitude}
        longitude={form.longitude}
        hint={pinHint}
        onChange={(p) => {
          pinnedByHand.current = true;
          setPinHint(null);
          setForm((f) => ({ ...f, ...p }));
        }}
      />
      <Input
        label="Ghi chú đường đi (tuỳ chọn)"
        value={form.locationNote}
        onChangeText={(v) => setForm({ ...form, locationNote: v })}
        multiline
        numberOfLines={2}
        editable={editable}
        placeholder="Ví dụ: trong hẻm, cạnh siêu thị"
        placeholderTextColor={inputPlaceholderColor}
      />
      <SaveButton pending={save.isPending} disabled={!editable} onPress={() => save.mutate()} />
    </Card>
  );
}

function PhotosStep({ view, onSaved, fail, editable }: StepProps) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const photos: any[] = Array.isArray(view.photos) ? view.photos : [];
  const minPhotos = Number(view.minPhotos ?? 0);
  const [category, setCategory] = useState<string>(PHOTO_CATEGORIES[0].value);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    try {
      const file = await pickApplicationFile(false);
      if (!file) return;
      setBusy(true);
      await uploadApplicationFile(file, { kind: "PHOTO", photoCategory: category as PartnerPhotoCategory });
      toast.show("Đã tải ảnh lên", "success");
      await onSaved();
    } catch (e) {
      fail(e, "Không tải được ảnh lên");
    } finally {
      setBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => partnerApplicationService.deletePhoto(id),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không xoá được ảnh"),
  });
  const cover = useMutation({
    mutationFn: (id: string) => partnerApplicationService.setCoverPhoto(id),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không đặt được ảnh bìa"),
  });

  return (
    <Card className="gap-3 p-5">
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Ảnh thật của cơ sở. Cần tối thiểu {minPhotos || "một vài"} ảnh; đã có {photos.length}.
      </Text>
      <SelectField
        label="Ảnh này chụp khu nào?"
        value={category}
        options={PHOTO_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        onChange={setCategory}
        disabled={!editable}
      />
      <Button icon={ImagePlus} disabled={!editable || busy} onPress={() => void add()}>
        {busy ? "Đang tải lên…" : "Thêm ảnh"}
      </Button>

      <View className="flex-row flex-wrap gap-2">
        {photos.map((p) => (
          <View key={p.id} className="w-[31%] gap-1">
            {p.url ? (
              <Image source={{ uri: p.url }} className="h-20 w-full rounded-xl" resizeMode="cover" />
            ) : (
              <View className="h-20 w-full items-center justify-center rounded-xl bg-panel">
                <Text className="font-body text-[10px] text-muted-foreground">Đang xử lý</Text>
              </View>
            )}
            {p.isCover ? <Badge tone="success">Ảnh bìa</Badge> : null}
            {editable ? (
              <View className="flex-row justify-between">
                {/* Ảnh đang là bìa thì không có gì để "đặt làm bìa" — giữ chỗ để nút xoá không nhảy vị trí. */}
                {p.isCover ? (
                  <View />
                ) : (
                  <Tappable accessibilityLabel="Đặt làm ảnh bìa" hitSlop={8} onPress={() => cover.mutate(p.id)}>
                    <Text className="font-body text-[10px] text-primary">Đặt làm bìa</Text>
                  </Tappable>
                )}
                <Tappable accessibilityLabel="Xoá ảnh" hitSlop={8} onPress={() => remove.mutate(p.id)}>
                  <Trash2 size={13} color={accent.primary} />
                </Tappable>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

function LegalStep({ view, onSaved, fail, editable }: StepProps) {
  const p: any = view.partner ?? {};
  const seed = {
    legalName: String(p.legalName ?? ""),
    taxCode: String(p.taxCode ?? ""),
    businessLicenseNo: String(p.businessLicenseNo ?? ""),
  };
  const [form, setForm] = useServerSeededState(seed, JSON.stringify(seed));

  const save = useMutation({
    mutationFn: () =>
      partnerApplicationService.saveLegal({
        legalName: form.legalName.trim(),
        taxCode: form.taxCode.trim() || null,
        businessLicenseNo: form.businessLicenseNo.trim() || null,
      }),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không lưu được thông tin pháp lý"),
  });

  return (
    <View className="gap-4">
      <Card className="gap-3 p-5">
        <Input label="Tên pháp lý" value={form.legalName} onChangeText={(v) => setForm({ ...form, legalName: v })} editable={editable} placeholderTextColor={inputPlaceholderColor} />
        <Input label="Mã số thuế (tuỳ chọn)" value={form.taxCode} onChangeText={(v) => setForm({ ...form, taxCode: v })} editable={editable} placeholderTextColor={inputPlaceholderColor} />
        <Input label="Số giấy phép kinh doanh (tuỳ chọn)" value={form.businessLicenseNo} onChangeText={(v) => setForm({ ...form, businessLicenseNo: v })} editable={editable} placeholderTextColor={inputPlaceholderColor} />
        <SaveButton pending={save.isPending} disabled={!editable || !form.legalName.trim()} onPress={() => save.mutate()} />
      </Card>

      {/* GY-09 — giấy tờ. Chỉ Gymini xem để xác minh; không bao giờ hiện công khai. */}
      <Card className="gap-2 border-border/70 p-4">
        <Text className="font-body text-[11px] leading-4 text-muted-foreground">
          Giấy tờ dưới đây chỉ Gymini dùng để xác minh và không bao giờ hiển thị công khai.
        </Text>
      </Card>

      {DOC_TYPES.map((d) => (
        <DocumentCard key={d.value} view={view} docType={d.value} label={d.label} hint={d.hint} onSaved={onSaved} fail={fail} editable={editable} />
      ))}
    </View>
  );
}

function DocumentCard({
  view,
  docType,
  label,
  hint,
  onSaved,
  fail,
  editable,
}: {
  view: ApplicationView;
  docType: PartnerDocType;
  label: string;
  hint: string;
  onSaved: () => Promise<void>;
  fail: (e: unknown, fallback: string) => void;
  editable: boolean;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const doc = findDocument(view, docType);
  const files = documentFiles(doc);
  const st = docStatus(doc?.status);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    try {
      const file = await pickApplicationFile(true);
      if (!file) return;
      setBusy(true);
      await uploadApplicationFile(file, { kind: "DOCUMENT", docType });
      toast.show("Đã tải giấy tờ lên", "success");
      await onSaved();
    } catch (e) {
      fail(e, "Không tải được giấy tờ lên");
    } finally {
      setBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: (fileId: string) => partnerApplicationService.removeDocumentFile(docType, fileId),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không xoá được tệp"),
  });

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-start gap-3">
        <FileText size={17} color={designTokens.mutedForeground} />
        <View className="min-w-0 flex-1">
          <Text className="font-body-semibold text-sm text-foreground">
            {label}
            {doc?.required ? " *" : ""}
          </Text>
          <Text className="font-body text-xs text-muted-foreground">{hint}</Text>
        </View>
        <Badge tone={st.tone}>{st.label}</Badge>
      </View>

      {doc?.reviewNote ? (
        <Text className="font-body text-xs text-warning">Gymini ghi chú: {doc.reviewNote}</Text>
      ) : null}

      {files.map((f) => (
        <View key={f.id} className="flex-row items-center gap-2 rounded-xl bg-panel px-3 py-2">
          {f.previewUrl ? (
            <Image source={{ uri: f.previewUrl }} className="h-9 w-9 rounded-md" resizeMode="cover" />
          ) : (
            <FileText size={15} color={designTokens.mutedForeground} />
          )}
          <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
            {f.mimeType ?? "Tệp"}
          </Text>
          {editable ? (
            <Tappable accessibilityLabel="Xoá tệp" hitSlop={8} onPress={() => remove.mutate(f.id)}>
              <Trash2 size={14} color={accent.primary} />
            </Tappable>
          ) : null}
        </View>
      ))}

      {editable ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !canAddDocumentFile(doc)}
          onPress={() => void add()}
        >
          {busy ? "Đang tải lên…" : files.length > 0 ? "Thêm tệp" : "Tải tệp lên"}
        </Button>
      ) : null}
      {!canAddDocumentFile(doc) ? (
        <Text className="font-body text-[11px] text-muted-foreground">Tối đa {MAX_FILES_PER_DOCUMENT} tệp cho mỗi loại.</Text>
      ) : null}
    </Card>
  );
}

function ReviewStep({
  view,
  onSaved,
  fail,
  onGoTo,
}: {
  view: ApplicationView;
  onSaved: () => Promise<void>;
  fail: (e: unknown, fallback: string) => void;
  onGoTo: (i: number) => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const [agreed, setAgreed] = useState(false);
  /**
   * Điều khoản được chấp nhận BẰNG chính lệnh gửi (`submit(true)`), nên trước khi gửi máy chủ luôn còn
   * kể mục TERMS. Ô đồng ý bên dưới là câu trả lời cho mục đó — tính nó là "còn thiếu" thì nút gửi
   * không bao giờ mở được (đã gặp thật 27/9). Mọi mục khác vẫn chặn như máy chủ nói.
   */
  const missing = missingItems(view).filter((m) => m.section !== "TERMS");
  const issues = issuesOf(view);
  const toReplace = documentsToReplace(view);
  const changesRound = isChangesRequested(view);
  const hasIssues = issues.length > 0 || toReplace.length > 0;
  const legalStep = STEPS.findIndex((st) => st.id === "legal");
  const docLabel = (t: string) => DOC_TYPES.find((x) => x.value === t)?.label ?? t;

  const submit = useMutation({
    mutationFn: () => partnerApplicationService.submit(true),
    onSuccess: async () => {
      toast.show("Đã gửi hồ sơ cho Gymini", "success");
      await onSaved();
    },
    onError: (e) => fail(e, "Không gửi được hồ sơ"),
  });

  const resubmit = useMutation({
    mutationFn: () => partnerApplicationService.resubmit(),
    onSuccess: async () => {
      toast.show("Đã gửi lại hồ sơ", "success");
      await onSaved();
    },
    onError: (e) => fail(e, "Không gửi lại được hồ sơ"),
  });

  const markUpdated = useMutation({
    mutationFn: (issueId: string) => partnerApplicationService.markIssueUpdated(issueId),
    onSuccess: onSaved,
    onError: (e) => fail(e, "Không đánh dấu được"),
  });

  return (
    <View className="gap-4">
      {hasIssues ? (
        <Card className="gap-3 p-5">
          <Text className="font-display text-base text-foreground">Gymini yêu cầu chỉnh sửa</Text>
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            Sửa xong từng mục thì bấm “Đã cập nhật”. Gửi lại hồ sơ chỉ mở khi mọi mục đã được đánh dấu — và việc
            đóng mục là quyền của Gymini, không phải của việc gửi lại.
          </Text>
          {issues.map((i) => {
            const st = issueStatus(i.status);
            return (
              <View key={i.id} className="gap-1.5 rounded-xl border border-border bg-panel p-3.5">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="font-body-semibold text-xs text-foreground">
                    {ISSUE_CATEGORY[i.category ?? ""] ?? "Khác"}
                  </Text>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </View>
                <Text className="font-body text-xs text-muted-foreground">{i.message}</Text>
                {i.adminFollowUp ? (
                  <Text className="font-body text-[11px] text-warning">Gymini nhắc thêm: {i.adminFollowUp}</Text>
                ) : null}
                {i.status === "OPEN" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    disabled={markUpdated.isPending}
                    onPress={() => markUpdated.mutate(i.id)}
                  >
                    Đã cập nhật
                  </Button>
                ) : null}
              </View>
            );
          })}
          {/* Giấy tờ bị yêu cầu nộp lại: không có nút "đã cập nhật" — thay tệp mới là cập nhật, và máy chủ
              tự đưa giấy tờ về "Chờ duyệt" khi nhận tệp mới. */}
          {toReplace.map((doc) => (
            <Tappable
              key={doc.docType}
              accessibilityLabel={`Thay tệp ${docLabel(doc.docType)}`}
              onPress={() => legalStep >= 0 && onGoTo(legalStep)}
              className="gap-1.5 rounded-xl border border-border bg-panel p-3.5"
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="min-w-0 flex-1 font-body-semibold text-xs text-foreground">{docLabel(doc.docType)}</Text>
                <Badge tone="danger">Cần nộp lại</Badge>
              </View>
              {doc.reviewNote ? <Text className="font-body text-xs text-muted-foreground">{doc.reviewNote}</Text> : null}
              <View className="flex-row items-center gap-1">
                <Text className="font-body-semibold text-xs text-primary">Thay tệp</Text>
                <ChevronRight size={12} color={accent.primary} />
              </View>
            </Tappable>
          ))}
          <Button disabled={!canResubmit(view) || resubmit.isPending} onPress={() => resubmit.mutate()}>
            {resubmit.isPending ? "Đang gửi…" : "Gửi lại hồ sơ"}
          </Button>
        </Card>
      ) : null}

      {/* Vòng "yêu cầu chỉnh sửa" gửi bằng nút "Gửi lại hồ sơ" ở trên; gửi lần đầu thì máy chủ từ chối. */}
      {changesRound ? null : (
        <Card className="gap-3 p-5">
          <Text className="font-display text-base text-foreground">Xem lại &amp; gửi</Text>
          {missing.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Mọi mục bắt buộc đã đủ.</Text>
          ) : (
            <>
              <Text className="font-body text-xs text-muted-foreground">Còn {missing.length} mục cần hoàn thiện:</Text>
              {missing.map((m, i) => {
                const target = STEPS.findIndex((s) => s.sections.includes(m.section));
                return (
                  <Tappable
                    key={i}
                    accessibilityLabel={m.message}
                    onPress={() => target >= 0 && onGoTo(target)}
                    className="flex-row items-center gap-2 rounded-xl border border-border bg-panel p-3"
                  >
                    <TriangleAlert size={13} color={designTokens.warning} />
                    <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">{m.message}</Text>
                    <ChevronRight size={14} color={designTokens.mutedForeground} />
                  </Tappable>
                );
              })}
            </>
          )}

          <Tappable
            accessibilityLabel="Đồng ý điều khoản đối tác"
            onPress={() => setAgreed((v) => !v)}
            hitSlop={8}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-panel p-3.5"
          >
            <View className={`h-5 w-5 items-center justify-center rounded-md border ${agreed ? "border-primary bg-primary" : "border-border"}`}>
              {agreed ? <Check size={13} color={accent.onPrimary} /> : null}
            </View>
            <Text className="flex-1 font-body text-sm text-foreground">Tôi đồng ý với điều khoản đối tác</Text>
          </Tappable>

          <Button disabled={!agreed || missing.length > 0 || submit.isPending} onPress={() => submit.mutate()}>
            {submit.isPending ? "Đang gửi…" : "Gửi hồ sơ"}
          </Button>
        </Card>
      )}
    </View>
  );
}
