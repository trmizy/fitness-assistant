import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Animated, { FadeInRight } from "react-native-reanimated";
import {
  ArrowRight,
  Award,
  Briefcase,
  CalendarClock,
  Camera,
  Check,
  ClipboardCheck,
  Compass,
  FileText,
  IdCard,
  Images,
  Plus,
  Send,
  Trash2,
  User,
  X,
  type LucideIcon,
} from "lucide-react-native";

import { Button, Card, Input, inputPlaceholderColor, inputTextColor, useToast } from "../../components/ui";
import { SelectField } from "../../components/SelectSheet";
import { locationService, ptApplicationService, type PTApplication, type PTApplicationCertificate } from "../../services/api";
import { SPECIALTIES } from "../../constants/specialties";
import { darkColors, designTokens } from "../../theme/colors";
import { formatVND } from "../../utils/currency";
import { Chip, FieldLabel, OptionCard, TextArea } from "../plans/PlanWidgets";
import { pickApplicationFile } from "./pickFile";
import {
  DAYS,
  DURATIONS,
  EMPTY_CERT,
  EMPTY_LOC,
  EXPERIENCE_OPTIONS,
  GOAL_OPTIONS,
  SERVICE_MODES,
  STEPS,
  TARGET_OPTIONS,
  addBlock,
  stepError,
  validLocations,
  type LocForm,
} from "./ptApplication";

const STEP_ICONS: LucideIcon[] = [User, IdCard, Briefcase, Award, Compass, CalendarClock, Images, ClipboardCheck];

const CONSENTS = [
  { key: "accurate", label: "Tôi cam kết mọi thông tin cung cấp là chính xác." },
  { key: "reviewConsent", label: "Tôi đồng ý để Gymini xác minh giấy tờ và hồ sơ của tôi." },
  { key: "falseInfoWarning", label: "Tôi hiểu thông tin sai lệch có thể khiến đơn bị từ chối hoặc tài khoản PT bị thu hồi." },
  { key: "termsAgreed", label: "Tôi đồng ý với điều khoản dành cho Huấn luyện viên của Gymini." },
] as const;

type Props = {
  form: PTApplication;
  setForm: (updater: (f: PTApplication) => PTApplication) => void;
  locations: LocForm[];
  setLocations: (updater: (l: LocForm[]) => LocForm[]) => void;
  saving: boolean;
  submitting: boolean;
  /** Save the draft; resolves true on success. */
  save: () => Promise<boolean>;
  submit: () => void;
  initialStep?: number;
};

/**
 * CL-22 — the eight-step application. Visual: the design's PTApplication (step bar, icon header,
 * one step per screen, sticky footer with Back / Continue, commitment checkbox on the last step).
 * Fields and rules: web's PTApplicationPage + the server's submit() — every step is checked
 * before moving on, and the draft is saved on each "Tiếp tục" like web (so leaving mid-way loses
 * nothing).
 */
export function PTApplicationWizard(p: Props) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [step, setStep] = useState(p.initialStep ?? 0);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const last = step === STEPS.length - 1;
  const s = STEPS[step];
  const Icon = STEP_ICONS[step];
  const allConsented = CONSENTS.every((c) => consent[c.key]);

  const next = async () => {
    const err = stepError(step, p.form, p.locations);
    if (err) {
      toast.show(err, "danger");
      return;
    }
    if (await p.save()) setStep((x) => Math.min(x + 1, STEPS.length - 1));
  };

  return (
    <View className="flex-1">
      <View className="px-5 pt-4">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="font-body-semibold text-xs text-primary">
            Bước {step + 1} / {STEPS.length}
          </Text>
          <Text className="font-body text-xs text-muted-foreground">{s.title}</Text>
        </View>
        <View className="flex-row gap-1.5">
          {STEPS.map((_, i) => (
            <Pressable key={i} accessibilityLabel={`Bước ${i + 1}`} disabled={i >= step} onPress={() => setStep(i)} className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
              <View className={`h-full rounded-full ${i <= step ? "bg-primary" : ""}`} />
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Animated.View key={step} entering={FadeInRight.duration(220)}>
          <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
            <Icon size={26} color={darkColors.primary} />
          </View>
          <Text className="font-display text-2xl text-foreground">{s.title}</Text>
          <Text className="mt-1.5 font-body text-sm text-muted-foreground">{s.desc}</Text>
          <View className="mt-6 gap-4">
            {step === 0 ? <PersonalStep {...p} /> : null}
            {step === 1 ? <IdentityStep {...p} /> : null}
            {step === 2 ? <ExperienceStep {...p} /> : null}
            {step === 3 ? <CertificatesStep {...p} /> : null}
            {step === 4 ? <FocusStep {...p} /> : null}
            {step === 5 ? <AvailabilityStep {...p} /> : null}
            {step === 6 ? <PortfolioStep {...p} /> : null}
            {step === 7 ? <ReviewStep {...p} goTo={setStep} /> : null}
            {last
              ? CONSENTS.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => setConsent((x) => ({ ...x, [c.key]: !x[c.key] }))}
                    className="flex-row items-start gap-3 rounded-xl border border-border bg-panel p-3.5"
                  >
                    <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border-2 ${consent[c.key] ? "border-primary bg-primary" : "border-border"}`}>
                      {consent[c.key] ? <Check size={13} strokeWidth={3} color={designTokens.onPrimary} /> : null}
                    </View>
                    <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">{c.label}</Text>
                  </Pressable>
                ))
              : null}
          </View>
        </Animated.View>
      </ScrollView>

      <View className="border-t border-border bg-glass p-5" style={{ paddingBottom: insets.bottom + 20 }}>
        {last && !allConsented ? <Text className="mb-2 text-center font-body text-xs text-warning">Vui lòng xác nhận các cam kết để nộp đơn</Text> : null}
        <View className="flex-row gap-2">
          {step > 0 ? (
            <Button variant="secondary" size="lg" onPress={() => setStep(step - 1)}>
              Quay lại
            </Button>
          ) : null}
          <Button
            full
            size="lg"
            className="flex-1"
            icon={last ? Send : ArrowRight}
            disabled={p.saving || p.submitting || (last && !allConsented)}
            onPress={() => (last ? p.submit() : void next())}
          >
            {p.submitting ? "Đang nộp…" : p.saving ? "Đang lưu…" : last ? "Nộp đơn" : "Tiếp tục"}
          </Button>
        </View>
      </View>
    </View>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────────────────

const set = (p: Props) => <K extends keyof PTApplication>(k: K, v: PTApplication[K]) => p.setForm((f) => ({ ...f, [k]: v }));
const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const numOrNull = (t: string) => {
  const d = t.replace(/[^\d]/g, "");
  return d ? Number(d) : null;
};

function MoneyInput({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (n: number | null) => void }) {
  return <Input label={label} value={value != null ? value.toLocaleString("vi-VN") : ""} onChangeText={(t) => onChange(numOrNull(t))} keyboardType="number-pad" placeholder="0" />;
}

/** One upload slot: shows a preview once uploaded, "Xoá tệp" to clear. */
function UploadSlot({ label, value, onUploaded, allowPdf, aspect = 3 / 4 }: { label: string; value?: string; onUploaded: (url: string | undefined) => void; allowPdf?: boolean; aspect?: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ uri: string; isImage: boolean } | null>(null);
  const pick = async () => {
    try {
      const f = await pickApplicationFile(!!allowPdf);
      if (!f) return;
      setBusy(true);
      const r = await ptApplicationService.uploadDocument(f);
      setPreview({ uri: f.uri, isImage: f.isImage });
      onUploaded(r.url);
    } catch (e: any) {
      toast.show(e?.message && !/status code/.test(e.message) ? e.message : "Tải lên thất bại. Vui lòng thử lại.", "danger");
    } finally {
      setBusy(false);
    }
  };
  const isImageUrl = value ? /\.(jpe?g|png|webp)$/i.test(value.split("?")[0]) : false;
  return (
    <View className="flex-1">
      <Pressable
        accessibilityLabel={label}
        onPress={() => void pick()}
        disabled={busy}
        style={{ aspectRatio: aspect }}
        className={`items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed ${value ? "border-primary/50" : "border-border"} bg-panel`}
      >
        {busy ? (
          <ActivityIndicator color={darkColors.primary} />
        ) : value && preview?.isImage ? (
          <Image source={{ uri: preview.uri }} className="h-full w-full" resizeMode="cover" />
        ) : value ? (
          <>
            {isImageUrl ? <Images size={22} color={darkColors.primary} /> : <FileText size={22} color={darkColors.primary} />}
            <Text className="px-2 text-center font-body-semibold text-xs text-primary">Đã tải lên</Text>
          </>
        ) : (
          <>
            <Camera size={22} color={designTokens.mutedForeground} />
            <Text className="px-2 text-center font-body text-xs text-muted-foreground">{label}</Text>
          </>
        )}
      </Pressable>
      {value ? (
        <Pressable
          onPress={() => {
            setPreview(null);
            onUploaded(undefined);
          }}
          className="mt-1.5 flex-row items-center justify-center gap-1"
        >
          <X size={12} color={designTokens.mutedForeground} />
          <Text className="font-body text-[11px] text-muted-foreground">Xoá tệp</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────────────────

function PersonalStep(p: Props) {
  const f = p.form;
  const u = set(p);
  const provinces = useQuery({ queryKey: ["locations", "provinces"], queryFn: () => locationService.getProvinces(), staleTime: Infinity });
  const wards = useQuery({
    queryKey: ["locations", "wards", f.residenceProvinceCode],
    queryFn: () => locationService.getWards(f.residenceProvinceCode!),
    enabled: !!f.residenceProvinceCode,
    staleTime: Infinity,
  });
  return (
    <>
      <Input label="Số điện thoại *" value={f.phoneNumber ?? ""} onChangeText={(t) => u("phoneNumber", t)} keyboardType="phone-pad" placeholder="09xx xxx xxx" />
      <Input label="Số CCCD / Hộ chiếu *" value={f.nationalIdNumber ?? ""} onChangeText={(t) => u("nationalIdNumber", t)} placeholder="0xx xxx xxx xxx" />
      <Input label="Địa chỉ hiện tại *" value={f.currentAddress ?? ""} onChangeText={(t) => u("currentAddress", t)} placeholder="Số nhà, đường, phường, tỉnh" />
      <SelectField
        label="Tỉnh / thành nơi ở"
        value={f.residenceProvinceCode ? String(f.residenceProvinceCode) : ""}
        options={(provinces.data ?? []).map((x) => ({ value: String(x.code), label: x.name }))}
        loading={provinces.isLoading}
        allowClear
        onChange={(v) => p.setForm((x) => ({ ...x, residenceProvinceCode: v ? Number(v) : null, residenceWardCode: null }))}
      />
      {f.residenceProvinceCode ? (
        <SelectField
          label="Phường / xã"
          value={f.residenceWardCode ? String(f.residenceWardCode) : ""}
          options={(wards.data ?? []).map((x) => ({ value: String(x.code), label: x.name }))}
          loading={wards.isLoading}
          allowClear
          onChange={(v) => u("residenceWardCode", v ? Number(v) : null)}
        />
      ) : null}
    </>
  );
}

function IdentityStep(p: Props) {
  const u = set(p);
  return (
    <>
      <View className="flex-row gap-3">
        <UploadSlot label="CCCD mặt trước" value={p.form.idCardFrontUrl} onUploaded={(v) => u("idCardFrontUrl", v)} />
        <UploadSlot label="CCCD mặt sau" value={p.form.idCardBackUrl} onUploaded={(v) => u("idCardBackUrl", v)} />
        <UploadSlot label="Ảnh chân dung" value={p.form.portraitPhotoUrl} onUploaded={(v) => u("portraitPhotoUrl", v)} />
      </View>
      <Text className="font-body text-xs text-muted-foreground">Ảnh rõ nét, đủ 4 góc. Chỉ Gymini dùng để xác minh, không công khai.</Text>
    </>
  );
}

function ExperienceStep(p: Props) {
  const f = p.form;
  const u = set(p);
  return (
    <>
      <View>
        <FieldLabel>Số năm kinh nghiệm *</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {EXPERIENCE_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} active={f.yearsOfExperience === o.value} onPress={() => u("yearsOfExperience", o.value)} />
          ))}
        </View>
      </View>
      <Labeled label="Học vấn / đào tạo">
        <TextArea value={f.educationBackground ?? ""} onChangeText={(t) => u("educationBackground", t)} placeholder="Chuyên ngành, khoá học thể thao…" rows={3} />
      </Labeled>
      <Labeled label="Kinh nghiệm làm việc">
        <TextArea value={f.previousWorkExperience ?? ""} onChangeText={(t) => u("previousWorkExperience", t)} placeholder="Nơi bạn từng huấn luyện…" rows={3} />
      </Labeled>
      <Labeled label="Giới thiệu bản thân">
        <TextArea value={f.professionalBio ?? ""} onChangeText={(t) => u("professionalBio", t)} placeholder="Chia sẻ hành trình huấn luyện của bạn…" rows={4} />
      </Labeled>
    </>
  );
}

function CertificatesStep(p: Props) {
  const certs = p.form.certificates ?? [];
  const setCert = (i: number, patch: Partial<PTApplicationCertificate>) => p.setForm((f) => ({ ...f, certificates: f.certificates.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  return (
    <>
      {certs.map((c, i) => (
        <Card key={i} className="gap-3 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-body-semibold text-sm text-foreground">Chứng chỉ {i + 1}</Text>
            {certs.length > 1 ? (
              <Pressable accessibilityLabel={`Xoá chứng chỉ ${i + 1}`} hitSlop={8} onPress={() => p.setForm((f) => ({ ...f, certificates: f.certificates.filter((_, j) => j !== i) }))}>
                <Trash2 size={16} color={darkColors.destructive} />
              </Pressable>
            ) : null}
          </View>
          <Input label="Tên chứng chỉ" value={c.certificateName} onChangeText={(t) => setCert(i, { certificateName: t })} placeholder="VD: NASM-CPT" />
          <Input label="Đơn vị cấp" value={c.issuingOrganization} onChangeText={(t) => setCert(i, { issuingOrganization: t })} />
          <View className="flex-row flex-wrap gap-2">
            {[
              { v: "Valid", l: "Còn hiệu lực", ok: true },
              { v: "Lifetime", l: "Vĩnh viễn", ok: true },
              { v: "Expired", l: "Hết hạn", ok: false },
            ].map((o) => (
              <Chip key={o.v} label={o.l} active={(c.certificationStatus ?? "Valid") === o.v} onPress={() => setCert(i, { certificationStatus: o.v, isCurrentlyValid: o.ok })} />
            ))}
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Input label="Ngày cấp" value={c.issueDate?.slice(0, 10) ?? ""} onChangeText={(t) => setCert(i, { issueDate: t || undefined })} placeholder="YYYY-MM-DD" />
            </View>
            {c.certificationStatus !== "Lifetime" ? (
              <View className="flex-1">
                <Input label="Ngày hết hạn" value={c.expirationDate?.slice(0, 10) ?? ""} onChangeText={(t) => setCert(i, { expirationDate: t || undefined })} placeholder="YYYY-MM-DD" />
              </View>
            ) : null}
          </View>
          <View className="flex-row">
            <UploadSlot label="Ảnh / PDF chứng chỉ" value={c.certificateFileUrl} allowPdf aspect={16 / 9} onUploaded={(v) => setCert(i, { certificateFileUrl: v })} />
          </View>
        </Card>
      ))}
      <Button variant="secondary" icon={Plus} onPress={() => p.setForm((f) => ({ ...f, certificates: [...f.certificates, { ...EMPTY_CERT }] }))}>
        Thêm chứng chỉ
      </Button>
    </>
  );
}

function FocusStep(p: Props) {
  const f = p.form;
  const u = set(p);
  return (
    <>
      <View>
        <FieldLabel>Chuyên môn chính *</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {SPECIALTIES.map((x) => (
            <Chip key={x} label={x} active={f.mainSpecialties.includes(x)} onPress={() => u("mainSpecialties", toggleIn(f.mainSpecialties, x))} />
          ))}
        </View>
      </View>
      <View>
        <FieldLabel>Nhóm học viên mục tiêu</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {TARGET_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} active={f.targetClientGroups.includes(o.value)} onPress={() => u("targetClientGroups", toggleIn(f.targetClientGroups, o.value))} />
          ))}
        </View>
      </View>
      <View>
        <FieldLabel>Mục tiêu huấn luyện chính</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {GOAL_OPTIONS.map((o) => (
            <Chip key={o.value} label={o.label} active={f.primaryTrainingGoals.includes(o.value)} onPress={() => u("primaryTrainingGoals", toggleIn(f.primaryTrainingGoals, o.value))} />
          ))}
        </View>
      </View>
      <Labeled label="Phương pháp & cách tiếp cận">
        <TextArea value={f.trainingMethodsApproach ?? ""} onChangeText={(t) => u("trainingMethodsApproach", t)} placeholder="Cách bạn cấu trúc buổi tập, phong cách huấn luyện…" rows={4} />
      </Labeled>
    </>
  );
}

function AvailabilityStep(p: Props) {
  const f = p.form;
  const u = set(p);
  const blocks = f.availabilityBlocks ?? [];
  const setBlock = (idx: number, patch: { startTime?: string; endTime?: string }) =>
    u(
      "availabilityBlocks",
      blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
  const offline = f.serviceMode === "OFFLINE" || f.serviceMode === "HYBRID";
  const online = f.serviceMode === "ONLINE" || f.serviceMode === "HYBRID";
  return (
    <>
      <View>
        <FieldLabel>Hình thức dịch vụ *</FieldLabel>
        <View className="gap-2">
          {SERVICE_MODES.map((m) => (
            <OptionCard key={m.value} label={m.label} desc={m.desc} active={f.serviceMode === m.value} onPress={() => u("serviceMode", m.value)} />
          ))}
        </View>
      </View>

      <View>
        <FieldLabel>Thời lượng buổi tập *</FieldLabel>
        <View className="flex-row gap-2">
          {DURATIONS.map((d) => (
            <Chip key={d} label={`${d} phút`} active={f.sessionDurationMinutes === d} onPress={() => u("sessionDurationMinutes", d)} />
          ))}
        </View>
      </View>

      {f.serviceMode ? (
        <Card className="gap-3 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Giá dịch vụ</Text>
          {online ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <MoneyInput label="Online / buổi *" value={f.onlinePricePerSession} onChange={(n) => u("onlinePricePerSession", n)} />
              </View>
              <View className="flex-1">
                <MoneyInput label="Online / gói" value={f.onlinePackagePrice} onChange={(n) => u("onlinePackagePrice", n)} />
              </View>
            </View>
          ) : null}
          {offline ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <MoneyInput label="Trực tiếp / buổi *" value={f.offlinePricePerSession} onChange={(n) => u("offlinePricePerSession", n)} />
              </View>
              <View className="flex-1">
                <MoneyInput label="Trực tiếp / gói" value={f.offlinePackagePrice} onChange={(n) => u("offlinePackagePrice", n)} />
              </View>
            </View>
          ) : null}
          <Input label="Số buổi trong gói" value={f.sessionsPerPackage != null ? String(f.sessionsPerPackage) : ""} onChangeText={(t) => u("sessionsPerPackage", numOrNull(t))} keyboardType="number-pad" placeholder="VD: 10" />
          <Input label="Ghi chú về giá" value={f.additionalPricingNotes ?? ""} onChangeText={(t) => u("additionalPricingNotes", t)} />
        </Card>
      ) : null}

      <View>
        <FieldLabel>Lịch rảnh hàng tuần *</FieldLabel>
        <Text className="mb-2 font-body text-xs text-muted-foreground">Mỗi ngày có thể có nhiều khung — thêm khung thứ hai để khai giờ nghỉ giữa ca. Giờ theo dạng HH:MM.</Text>
        <View className="gap-2">
          {DAYS.map((d) => {
            const entries = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.dayOfWeek === d.value);
            return (
              <Card key={d.value} className="gap-2 p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-body-semibold text-sm text-foreground">{d.label}</Text>
                  <Pressable hitSlop={6} onPress={() => u("availabilityBlocks", addBlock(blocks, d.value, f.sessionDurationMinutes ?? 60))} className="flex-row items-center gap-1">
                    <Plus size={14} color={darkColors.primary} />
                    <Text className="font-body-semibold text-xs text-primary">{entries.length ? "Thêm khung khác" : "Thêm khung giờ"}</Text>
                  </Pressable>
                </View>
                {entries.map(({ b, i }) => (
                  <View key={i} className="flex-row items-center gap-2">
                    <TimeBox value={b.startTime} onChange={(t) => setBlock(i, { startTime: t })} />
                    <Text className="font-body text-sm text-muted-foreground">–</Text>
                    <TimeBox value={b.endTime} onChange={(t) => setBlock(i, { endTime: t })} />
                    <Pressable accessibilityLabel="Xoá khung giờ" hitSlop={8} className="ml-auto" onPress={() => u("availabilityBlocks", blocks.filter((_, j) => j !== i))}>
                      <Trash2 size={16} color={darkColors.destructive} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            );
          })}
        </View>
      </View>

      {offline ? <LocationsEditor {...p} /> : null}
      <Input label="Phòng gym đang cộng tác (nếu có)" value={f.gymAffiliation ?? ""} onChangeText={(t) => u("gymAffiliation", t)} />
    </>
  );
}

function TimeBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={(t) => {
        const d = t.replace(/[^\d]/g, "").slice(0, 4);
        onChange(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d);
      }}
      keyboardType="number-pad"
      placeholder="HH:MM"
      placeholderTextColor={inputPlaceholderColor}
      style={{ color: inputTextColor }}
      className="h-10 w-20 rounded-lg border border-border bg-panel px-2 text-center font-body text-sm"
    />
  );
}

function LocationsEditor(p: Props) {
  const provinces = useQuery({ queryKey: ["locations", "provinces"], queryFn: () => locationService.getProvinces(), staleTime: Infinity });
  const upd = (i: number, patch: Partial<LocForm>) => p.setLocations((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <View className="gap-2">
      <FieldLabel>Nơi luyện tập trực tiếp *</FieldLabel>
      {p.locations.map((l, i) => (
        <Card key={i} className="gap-3 p-3">
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => p.setLocations((ls) => ls.map((x, j) => ({ ...x, isPrimary: j === i })))} className="flex-row items-center gap-2">
              <View className={`h-4 w-4 rounded-full border-2 ${l.isPrimary ? "border-primary bg-primary" : "border-border"}`} />
              <Text className="font-body text-xs text-muted-foreground">Nơi chính</Text>
            </Pressable>
            {p.locations.length > 1 ? (
              <Pressable accessibilityLabel="Xoá nơi tập" hitSlop={8} onPress={() => p.setLocations((ls) => ls.filter((_, j) => j !== i))}>
                <Trash2 size={16} color={darkColors.destructive} />
              </Pressable>
            ) : null}
          </View>
          <SelectField
            label="Tỉnh / thành"
            value={l.provinceCode}
            options={(provinces.data ?? []).map((x) => ({ value: String(x.code), label: x.name }))}
            loading={provinces.isLoading}
            onChange={(v) => upd(i, { provinceCode: v, wardCode: "" })}
          />
          {l.provinceCode ? <WardSelect provinceCode={Number(l.provinceCode)} value={l.wardCode} onChange={(v) => upd(i, { wardCode: v })} /> : null}
          <Input label="Tên phòng gym" value={l.gymName} onChangeText={(t) => upd(i, { gymName: t })} />
          <Input label="Địa chỉ" value={l.addressLine} onChangeText={(t) => upd(i, { addressLine: t })} />
        </Card>
      ))}
      <Button variant="secondary" size="sm" icon={Plus} onPress={() => p.setLocations((ls) => [...ls, { ...EMPTY_LOC }])}>
        Thêm nơi tập
      </Button>
    </View>
  );
}

function WardSelect({ provinceCode, value, onChange }: { provinceCode: number; value: string; onChange: (v: string) => void }) {
  const wards = useQuery({ queryKey: ["locations", "wards", provinceCode], queryFn: () => locationService.getWards(provinceCode), staleTime: Infinity });
  return (
    <SelectField
      label="Phường / xã"
      value={value}
      options={(wards.data ?? []).map((x) => ({ value: String(x.code), label: x.name }))}
      loading={wards.isLoading}
      allowClear
      onChange={onChange}
    />
  );
}

function PortfolioStep(p: Props) {
  const f = p.form;
  const u = set(p);
  const social = f.socialLinks ?? {};
  const setSocial = (k: "instagram" | "facebook" | "youtube" | "tiktok", v: string) => u("socialLinks", { ...social, [k]: v || undefined });
  const media = f.media ?? [];
  const portfolio = media.filter((m) => m.groupType === "PORTFOLIO");
  return (
    <>
      <Input label="Instagram" value={social.instagram ?? ""} onChangeText={(t) => setSocial("instagram", t)} autoCapitalize="none" placeholder="https://instagram.com/…" />
      <Input label="Facebook" value={social.facebook ?? ""} onChangeText={(t) => setSocial("facebook", t)} autoCapitalize="none" />
      <Input label="YouTube" value={social.youtube ?? ""} onChangeText={(t) => setSocial("youtube", t)} autoCapitalize="none" />
      <Input label="TikTok" value={social.tiktok ?? ""} onChangeText={(t) => setSocial("tiktok", t)} autoCapitalize="none" />
      <Input label="Website" value={f.websiteUrl ?? ""} onChangeText={(t) => u("websiteUrl", t)} autoCapitalize="none" />
      <View>
        <FieldLabel>{`Ảnh portfolio (${portfolio.length}/5)`}</FieldLabel>
        <View className="flex-row flex-wrap gap-3">
          {portfolio.map((m, i) => (
            <View key={`${m.fileUrl}-${i}`} className="w-[30%]">
              <View className="aspect-square items-center justify-center rounded-xl border border-primary/40 bg-panel">
                <Images size={20} color={darkColors.primary} />
                <Text className="mt-1 px-1 text-center font-body text-[10px] text-muted-foreground" numberOfLines={1}>
                  {m.label ?? "Ảnh"}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  let seen = -1;
                  u(
                    "media",
                    media.filter((x) => (x.groupType === "PORTFOLIO" ? ++seen !== i : true)),
                  );
                }}
                className="mt-1 items-center"
              >
                <Text className="font-body text-[11px] text-muted-foreground">Xoá</Text>
              </Pressable>
            </View>
          ))}
          {portfolio.length < 5 ? (
            <View className="w-[30%]">
              <UploadSlot label="Thêm ảnh" aspect={1} onUploaded={(url) => url && u("media", [...media, { groupType: "PORTFOLIO", fileUrl: url, label: `Ảnh ${portfolio.length + 1}` }])} />
            </View>
          ) : null}
        </View>
      </View>
      <Labeled label="Người tham chiếu khác">
        <TextArea value={f.otherReferences ?? ""} onChangeText={(t) => u("otherReferences", t)} placeholder="Tên, liên hệ của người có thể xác nhận kinh nghiệm của bạn" rows={3} />
      </Labeled>
    </>
  );
}

function ReviewStep(p: Props & { goTo: (i: number) => void }) {
  const f = p.form;
  const locs = validLocations(p.locations);
  const exp = EXPERIENCE_OPTIONS.find((o) => o.value === f.yearsOfExperience)?.label;
  const mode = SERVICE_MODES.find((m) => m.value === f.serviceMode)?.label;
  const rows: { step: number; title: string; items: [string, string | null | undefined][] }[] = [
    { step: 0, title: "Thông tin cá nhân", items: [["Điện thoại", f.phoneNumber], ["CCCD", f.nationalIdNumber], ["Địa chỉ", f.currentAddress]] },
    {
      step: 1,
      title: "Xác thực danh tính",
      items: [
        ["CCCD mặt trước", f.idCardFrontUrl ? "✓ Đã tải lên" : null],
        ["CCCD mặt sau", f.idCardBackUrl ? "✓ Đã tải lên" : null],
        ["Ảnh chân dung", f.portraitPhotoUrl ? "✓ Đã tải lên" : null],
      ],
    },
    { step: 2, title: "Kinh nghiệm", items: [["Số năm", exp]] },
    { step: 3, title: "Chứng chỉ", items: [["Số chứng chỉ", String(f.certificates.filter((c) => c.certificateName.trim()).length)]] },
    { step: 4, title: "Hướng huấn luyện", items: [["Chuyên môn", f.mainSpecialties.join(", ") || null]] },
    {
      step: 5,
      title: "Dịch vụ & Lịch",
      items: [
        ["Hình thức", mode],
        ["Online / buổi", f.onlinePricePerSession ? formatVND(f.onlinePricePerSession) : null],
        ["Trực tiếp / buổi", f.offlinePricePerSession ? formatVND(f.offlinePricePerSession) : null],
        ["Khung giờ rảnh", String((f.availabilityBlocks ?? []).length)],
        ["Nơi tập", locs.length ? String(locs.length) : null],
      ],
    },
  ];
  return (
    <>
      {rows.map((r) => (
        <Card key={r.title} className="gap-2 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-body-semibold text-sm text-foreground">{r.title}</Text>
            <Pressable hitSlop={8} onPress={() => p.goTo(r.step)}>
              <Text className="font-body-semibold text-xs text-primary">Sửa</Text>
            </Pressable>
          </View>
          {r.items.map(([k, v]) => (
              <View key={k} className="flex-row justify-between gap-3">
                <Text className="font-body text-sm text-muted-foreground">{k}</Text>
                <Text className={`flex-shrink text-right font-body text-sm ${v ? "text-foreground" : "text-muted-foreground"}`}>{v || "Chưa nhập"}</Text>
              </View>
            ))}
          {stepError(r.step, f, p.locations) ? <Text className="font-body text-xs text-destructive">{stepError(r.step, f, p.locations)}</Text> : null}
        </Card>
      ))}
    </>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

