import { useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Star, Trash2 } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, Input, Segmented, Tappable, useToast } from "../../components/ui";
import { absolutePhotoUrl } from "../../services/api";
import { designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { SPECIALTIES } from "../../constants/specialties";
import { GOAL_OPTIONS, TARGET_OPTIONS } from "../ptApplication/ptApplication";
import { Chip, TextArea } from "../plans/PlanWidgets";
import { perSessionPrice } from "../pt/pt";
import {
  EMPTY_PACKAGE,
  FIELD_LIMITS,
  LANGUAGE_OPTIONS,
  addCustomLanguage,
  applyPackageForm,
  archivePackageItem,
  listingPackageError,
  livePackages,
  packageFormFromItem,
  restorePackageItem,
  togglePackageActive,
  type ListingPhoto,
  type PackageItem,
  type ProfileForm,
} from "./ptListing";
import type { PackageForm } from "../pt/pt";

const MODES = ["Tại phòng gym", "Online"];

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View className="mb-1.5 flex-row items-end justify-between gap-2">
      <Text className="flex-1 font-body-medium text-xs text-muted-foreground">{children}</Text>
      {hint ? <Text className="font-body text-[11px] text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text className="font-display text-base text-foreground">{children}</Text>;
}

const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** The option list plus anything already selected that is not in it (old data stays visible, never silently dropped). */
function withExtras(options: { value: string; label: string }[], selected: string[]) {
  const known = new Set(options.map((o) => o.value));
  return [...options, ...selected.filter((s) => !known.has(s)).map((s) => ({ value: s, label: s }))];
}

/** Fixed language chips + "Khác": a free-text entry that adds a custom chip. Saved values outside the list stay visible and selected. */
function LanguagesField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const toast = useToast();
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const options: string[] = [...LANGUAGE_OPTIONS, ...value.filter((v) => !(LANGUAGE_OPTIONS as readonly string[]).includes(v))];

  const toggle = (name: string) => {
    if (value.includes(name)) return onChange(value.filter((x) => x !== name));
    if (value.length >= FIELD_LIMITS.LIST_MAX_ITEMS) return void toast.show(`Chọn tối đa ${FIELD_LIMITS.LIST_MAX_ITEMS} ngôn ngữ.`, "danger");
    onChange([...value, name]);
  };
  const addOther = () => {
    const r = addCustomLanguage(value, text);
    if (r.outcome === "added") {
      onChange(r.languages);
      setText("");
      setOther(false);
    } else if (r.outcome === "too_long") toast.show(`Tên ngôn ngữ tối đa ${FIELD_LIMITS.LANGUAGE_ITEM_MAX} ký tự.`, "danger");
    else if (r.outcome === "limit") toast.show(`Chọn tối đa ${FIELD_LIMITS.LIST_MAX_ITEMS} ngôn ngữ.`, "danger");
    else if (r.outcome === "duplicate") toast.show("Ngôn ngữ này đã được chọn.", "danger");
  };

  return (
    <View>
      <FieldLabel hint={`${value.length}/${FIELD_LIMITS.LIST_MAX_ITEMS}`}>Ngôn ngữ</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o} label={o} active={value.includes(o)} onPress={() => toggle(o)} />
        ))}
        <Chip label="Khác" active={other} onPress={() => setOther((v) => !v)} />
      </View>
      {other ? (
        <View className="mt-2 flex-row items-end gap-2">
          <View className="flex-1">
            <Input value={text} onChangeText={setText} placeholder="Ví dụ: Français" autoCapitalize="words" maxLength={FIELD_LIMITS.LANGUAGE_ITEM_MAX} onSubmitEditing={addOther} />
          </View>
          <Button size="md" variant="secondary" disabled={!text.trim()} onPress={addOther}>
            Thêm ngôn ngữ
          </Button>
        </View>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Profile — the 8 text fields
// ─────────────────────────────────────────────────────────────────────────────────────────────
export function ProfileSection({
  value,
  onChange,
}: {
  value: ProfileForm;
  onChange: (patch: Partial<ProfileForm>) => void;
}) {
  const toast = useToast();
  const { LIST_MAX_ITEMS, BIO_MAX, METHODS_MAX } = FIELD_LIMITS;

  const toggle = (field: "mainSpecialties" | "targetClientGroups" | "primaryTrainingGoals", v: string) => {
    const current = value[field];
    if (!current.includes(v) && current.length >= LIST_MAX_ITEMS) {
      toast.show(`Chọn tối đa ${LIST_MAX_ITEMS} mục.`, "danger");
      return;
    }
    onChange({ [field]: toggleIn(current, v) } as Partial<ProfileForm>);
  };

  const specialtyOptions = withExtras(
    SPECIALTIES.map((s) => ({ value: s, label: s })),
    value.mainSpecialties,
  );
  const targetOptions = withExtras(TARGET_OPTIONS, value.targetClientGroups);
  const goalOptions = withExtras(GOAL_OPTIONS, value.primaryTrainingGoals);

  return (
    <View className="gap-4">
      <View>
        <FieldLabel hint={`${value.professionalBio.length}/${BIO_MAX}`}>Giới thiệu bản thân</FieldLabel>
        <TextArea
          value={value.professionalBio}
          onChangeText={(t) => onChange({ professionalBio: t })}
          placeholder="Kinh nghiệm, phong cách huấn luyện, điều khiến học viên chọn bạn…"
          rows={5}
        />
      </View>

      <View>
        <FieldLabel hint={`${value.mainSpecialties.length}/${LIST_MAX_ITEMS}`}>Chuyên môn chính</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {specialtyOptions.map((o) => (
            <Chip key={o.value} label={o.label} active={value.mainSpecialties.includes(o.value)} onPress={() => toggle("mainSpecialties", o.value)} />
          ))}
        </View>
      </View>

      <View>
        <FieldLabel hint={`${value.trainingMethodsApproach.length}/${METHODS_MAX}`}>Phương pháp & cách tiếp cận</FieldLabel>
        <TextArea
          value={value.trainingMethodsApproach}
          onChangeText={(t) => onChange({ trainingMethodsApproach: t })}
          placeholder="Cách bạn lên giáo án, theo dõi tiến độ, điều chỉnh theo từng người…"
          rows={4}
        />
      </View>

      <View>
        <FieldLabel hint={`${value.targetClientGroups.length}/${LIST_MAX_ITEMS}`}>Nhóm học viên phù hợp</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {targetOptions.map((o) => (
            <Chip key={o.value} label={o.label} active={value.targetClientGroups.includes(o.value)} onPress={() => toggle("targetClientGroups", o.value)} />
          ))}
        </View>
      </View>

      <View>
        <FieldLabel hint={`${value.primaryTrainingGoals.length}/${LIST_MAX_ITEMS}`}>Mục tiêu huấn luyện chính</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {goalOptions.map((o) => (
            <Chip key={o.value} label={o.label} active={value.primaryTrainingGoals.includes(o.value)} onPress={() => toggle("primaryTrainingGoals", o.value)} />
          ))}
        </View>
      </View>

      <LanguagesField value={value.languages} onChange={(languages) => onChange({ languages })} />
      <Input
        label="Website (tuỳ chọn)"
        value={value.websiteUrl}
        onChangeText={(t) => onChange({ websiteUrl: t })}
        placeholder="https://"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Input
        label="LinkedIn (tuỳ chọn)"
        value={value.linkedinUrl}
        onChangeText={(t) => onChange({ linkedinUrl: t })}
        placeholder="https://www.linkedin.com/in/…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Packages — create / edit / archive / toggle inside the draft
// ─────────────────────────────────────────────────────────────────────────────────────────────
export function PackagesSection({
  items,
  maxPackages,
  onChange,
}: {
  items: PackageItem[];
  maxPackages: number;
  onChange: (next: PackageItem[]) => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<PackageItem | null>(null);
  const [form, setForm] = useState<PackageForm>(EMPTY_PACKAGE);
  const live = livePackages(items).length;
  const error = listingPackageError(form);

  const openAdd = () => {
    if (live >= maxPackages) {
      toast.show(`Mỗi huấn luyện viên có tối đa ${maxPackages} gói đang bán. Hãy ngừng bán một gói trước khi thêm.`, "danger");
      return;
    }
    setEditing(null);
    setForm(EMPTY_PACKAGE);
    setSheet(true);
  };
  const openEdit = (p: PackageItem) => {
    setEditing(p);
    setForm(packageFormFromItem(p));
    setSheet(true);
  };
  const save = () => {
    if (error) return;
    const next = applyPackageForm(form, editing ?? undefined, `new-${items.length}-${Math.random().toString(36).slice(2, 8)}`);
    onChange(editing ? items.map((p) => (p.key === editing.key ? next : p)) : [...items, next]);
    setSheet(false);
  };

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 font-body text-xs text-muted-foreground">
          {`Khách chọn một gói khi gửi yêu cầu hợp đồng. Đang bán ${live}/${maxPackages} gói.`}
        </Text>
        <Tappable accessibilityLabel="Thêm gói dịch vụ" onPress={openAdd} className="shrink-0 flex-row items-center gap-1 py-2 pl-2">
          <Plus size={14} color={accent.primary} />
          <Text className="font-body-semibold text-xs text-primary">Thêm</Text>
        </Tappable>
      </View>

      {items.length === 0 ? (
        <Text className="font-body text-sm text-muted-foreground">Chưa có gói nào. Thêm ít nhất một gói để khách có thể gửi yêu cầu hợp đồng cho bạn.</Text>
      ) : (
        items.map((p) => (
          <Card key={p.key} className={`gap-3 p-4 ${p.archive ? "opacity-60" : ""}`}>
            <View className="flex-row items-start gap-2">
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
                  {p.name}
                </Text>
                <Text className="font-body text-xs text-muted-foreground">
                  {`${p.sessionCount} buổi · ${p.sessionMode === "ONLINE" ? "Online" : "Tại phòng gym"} · ${p.sessionDurationMinutes} phút/buổi`}
                </Text>
                {p.description ? (
                  <Text className="mt-0.5 font-body text-xs text-muted-foreground" numberOfLines={2}>
                    {p.description}
                  </Text>
                ) : null}
              </View>
              <View className="items-end">
                <Text className="font-display text-sm text-primary">{formatVND(p.price)}</Text>
                <Text className="font-body text-xs text-muted-foreground">{`${formatVND(perSessionPrice(p))}/buổi`}</Text>
              </View>
            </View>

            <View className="flex-row flex-wrap items-center gap-2">
              {p.archive ? (
                <Badge tone="warning">Sẽ ngừng bán khi được duyệt</Badge>
              ) : p.isActive ? (
                <Badge tone="success">Đang bán</Badge>
              ) : (
                <Badge tone="warning">Tạm ẩn</Badge>
              )}
              {p.id ? null : <Badge tone="info">Gói mới</Badge>}
              {p.validityDays ? <Text className="font-body text-xs text-muted-foreground">{`Hạn ${p.validityDays} ngày`}</Text> : null}
            </View>

            <View className="flex-row flex-wrap gap-2">
              {p.archive ? (
                <Button size="sm" variant="secondary" onPress={() => onChange(restorePackageItem(items, p.key))}>
                  Hoàn tác
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="secondary" icon={Pencil} onPress={() => openEdit(p)}>
                    Sửa
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => onChange(togglePackageActive(items, p.key))}>
                    {p.isActive ? "Tạm ẩn" : "Bán lại"}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} onPress={() => onChange(archivePackageItem(items, p.key))}>
                    {p.id ? "Ngừng bán" : "Bỏ gói"}
                  </Button>
                </>
              )}
            </View>
          </Card>
        ))
      )}

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={editing ? "Sửa gói dịch vụ" : "Thêm gói dịch vụ"}>
        <ScrollView className="max-h-[440px]" keyboardShouldPersistTaps="handled">
          <View className="gap-3 pb-2">
            <Input label="Tên gói *" value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} placeholder="Gói 10 buổi tăng cơ" />
            <Input
              label="Mô tả"
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              placeholder="Kèm 1-1 tại phòng tập, giáo án riêng"
            />
            <Segmented
              options={MODES}
              value={form.sessionMode === "ONLINE" ? MODES[1] : MODES[0]}
              onChange={(v) => setForm((f) => ({ ...f, sessionMode: v === MODES[1] ? "ONLINE" : "OFFLINE" }))}
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Input
                  label="Số buổi *"
                  value={form.sessionCount}
                  onChangeText={(t) => setForm((f) => ({ ...f, sessionCount: t.replace(/[^\d]/g, "") }))}
                  keyboardType="number-pad"
                />
              </View>
              <View className="flex-1">
                <Input
                  label="Phút/buổi *"
                  value={form.sessionDurationMinutes}
                  onChangeText={(t) => setForm((f) => ({ ...f, sessionDurationMinutes: t.replace(/[^\d]/g, "") }))}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <Input
              label="Giá cả gói (₫) *"
              value={form.price ? Number(form.price).toLocaleString("vi-VN") : ""}
              onChangeText={(t) => setForm((f) => ({ ...f, price: t.replace(/[^\d]/g, "") }))}
              keyboardType="number-pad"
              placeholder="3.000.000"
            />
            {Number(form.price) > 0 && Number(form.sessionCount) > 0 ? (
              <Text className="font-body text-xs text-muted-foreground">
                {`Tương đương ${formatVND(perSessionPrice({ price: form.price, sessionCount: form.sessionCount }))}/buổi`}
              </Text>
            ) : null}
            <Input
              label="Hạn dùng (ngày, để trống nếu không giới hạn)"
              value={form.validityDays}
              onChangeText={(t) => setForm((f) => ({ ...f, validityDays: t.replace(/[^\d]/g, "") }))}
              keyboardType="number-pad"
              placeholder="90"
            />
            {error && (form.name || form.price) ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
            <Button full disabled={!!error} onPress={save}>
              {editing ? "Xong" : "Thêm vào bản nháp"}
            </Button>
            <Text className="text-center font-body text-[11px] text-muted-foreground">
              Thay đổi chỉ có hiệu lực với khách sau khi bản sửa được gửi và duyệt.
            </Text>
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Physique photos
// ─────────────────────────────────────────────────────────────────────────────────────────────
export type UploadEntry = {
  key: string;
  name: string;
  status: "uploading" | "failed";
  message?: string;
};

function Thumb({ photo, onError, noun }: { photo: ListingPhoto | undefined; onError: () => void; noun: string }) {
  const uri = photo ? absolutePhotoUrl(photo.url) : null;
  return (
    <View className="h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl border border-border bg-panel">
      {uri ? (
        <Image source={{ uri }} contentFit="cover" style={{ width: "100%", height: "100%" }} onError={onError} accessibilityLabel={noun} />
      ) : (
        <ImagePlus size={20} color={designTokens.mutedForeground} />
      )}
    </View>
  );
}

export function PhotosSection({
  ids,
  cover,
  photos,
  unused,
  max,
  uploads,
  busy,
  onAdd,
  onMove,
  onSetCover,
  onRemove,
  onDeleteStaged,
  onAddExisting,
  onRetryUpload,
  onDropUpload,
  onImageError,
  noun = "Ảnh hình thể",
  coverHint = "Ảnh đầu tiên (hoặc ảnh bìa) hiện trên thẻ của bạn.",
  emptyHint = "Chưa có ảnh nào. Ảnh giúp khách hình dung phong cách và kết quả của bạn.",
}: {
  ids: string[];
  cover: string | null;
  photos: Map<string, ListingPhoto>;
  /** Uploaded (STAGED) photos that are not in the draft. */
  unused: ListingPhoto[];
  max: number;
  uploads: UploadEntry[];
  busy: boolean;
  onAdd: () => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSetCover: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteStaged: (id: string) => void;
  onAddExisting: (id: string) => void;
  onRetryUpload: (key: string) => void;
  onDropUpload: (key: string) => void;
  onImageError: () => void;
  /** Wording for the listing this section belongs to (default: the trainer's physique photos). */
  noun?: string;
  coverHint?: string;
  emptyHint?: string;
}) {
  const accent = useWorkspaceAccent();
  const full = ids.length >= max;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="font-body-semibold text-sm text-foreground">{`${noun} ${ids.length}/${max}`}</Text>
          <Text className="font-body text-xs text-muted-foreground">
            {full ? `Đã đủ ${max}/${max} ảnh — gỡ bớt một ảnh để thêm ảnh khác.` : coverHint}
          </Text>
        </View>
        <Button size="sm" variant="secondary" icon={ImagePlus} disabled={busy} onPress={onAdd}>
          Thêm ảnh
        </Button>
      </View>

      {uploads.map((u) => (
        <Card key={u.key} className="flex-row items-center gap-3 p-3">
          {u.status === "uploading" ? (
            <>
              <ActivityIndicator color={accent.primary} />
              <Text className="flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>{`Đang tải ${u.name}…`}</Text>
            </>
          ) : (
            <>
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-xs text-destructive" numberOfLines={1}>{`Chưa tải được ${u.name}`}</Text>
                <Text className="font-body text-xs text-muted-foreground">{u.message}</Text>
              </View>
              <Button size="sm" variant="secondary" onPress={() => onRetryUpload(u.key)}>
                Thử lại
              </Button>
              <Button size="sm" variant="ghost" onPress={() => onDropUpload(u.key)}>
                Bỏ
              </Button>
            </>
          )}
        </Card>
      ))}

      {ids.length === 0 && uploads.length === 0 ? (
        <Text className="font-body text-sm text-muted-foreground">{emptyHint}</Text>
      ) : null}

      {ids.map((id, index) => {
        const photo = photos.get(id);
        const isCover = id === cover;
        const staged = photo?.status === "STAGED";
        return (
          <Card key={id} className="gap-3 p-3">
            <View className="flex-row items-center gap-3">
              <Thumb photo={photo} onError={onImageError} noun={noun} />
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="font-body-semibold text-sm text-foreground">{`Ảnh ${index + 1}`}</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {isCover ? <Badge tone="success">Ảnh bìa</Badge> : null}
                  {staged ? <Badge tone="info">Chưa công khai</Badge> : null}
                </View>
              </View>
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              <Tappable
                accessibilityLabel={`Đưa ảnh ${index + 1} lên`}
                disabled={index === 0}
                onPress={() => onMove(id, -1)}
                className={`h-10 w-10 items-center justify-center rounded-xl bg-panel ${index === 0 ? "opacity-40" : ""}`}
              >
                <ArrowUp size={18} color={designTokens.mutedForeground} />
              </Tappable>
              <Tappable
                accessibilityLabel={`Đưa ảnh ${index + 1} xuống`}
                disabled={index === ids.length - 1}
                onPress={() => onMove(id, 1)}
                className={`h-10 w-10 items-center justify-center rounded-xl bg-panel ${index === ids.length - 1 ? "opacity-40" : ""}`}
              >
                <ArrowDown size={18} color={designTokens.mutedForeground} />
              </Tappable>
              {isCover ? null : (
                <Button size="sm" variant="secondary" icon={Star} onPress={() => onSetCover(id)}>
                  Đặt làm bìa
                </Button>
              )}
              {staged ? (
                <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onPress={() => onDeleteStaged(id)}>
                  Xóa ảnh
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onPress={() => onRemove(id)}>
                  Gỡ khỏi tin đăng
                </Button>
              )}
            </View>
          </Card>
        );
      })}

      {unused.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          <Text className="font-body-semibold text-xs text-muted-foreground">Ảnh đã tải lên nhưng chưa dùng</Text>
          {unused.map((photo) => (
            <Card key={photo.id} className="gap-2 p-3">
              <View className="flex-row items-center gap-3">
                <Thumb photo={photo} onError={onImageError} noun={noun} />
                <View className="flex-1 flex-row flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={full} onPress={() => onAddExisting(photo.id)}>
                    Thêm vào tin đăng
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onPress={() => onDeleteStaged(photo.id)}>
                    Xóa ảnh
                  </Button>
                </View>
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
}
