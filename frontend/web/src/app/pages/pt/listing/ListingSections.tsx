import { useRef, useState } from "react";
import { ArrowCounterClockwiseIcon, CameraIcon, CircleNotchIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Switch } from "../../../components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { ListingPhotoGrid, type PhotoTile } from "../../../components/listing/ListingPhotoGrid";
import { ListingImage } from "../../../components/listing/ListingImage";
import { SPECIALTIES } from "../../../constants/specialties";
import { formatVND } from "../../../utils/currency";
import { cn } from "../../../components/ui/utils";
import type { ListingPhoto } from "../../../types";
import {
  EMPTY_PACKAGE,
  FIELD_LIMITS,
  LANGUAGE_OPTIONS,
  TARGET_GROUP_OPTIONS,
  TRAINING_GOAL_OPTIONS,
  addCustomLanguage,
  applyPackageForm,
  archivePackageItem,
  customLanguages,
  listingPackageError,
  livePackages,
  optionsWithSaved,
  packageFormFrom,
  restorePackageItem,
  toggleListValue,
  togglePackageActive,
  type ListingOption,
  type PackageForm,
  type PackageItem,
  type ProfileForm,
} from "../../../utils/ptListing";

export const sectionTitle = "text-sm font-bold text-zinc-100";
const fieldLabel = "block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5";

export function SectionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
      <div>
        <h2 className={sectionTitle}>{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Chip({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
        active ? "border-green-500/50 bg-green-500/15 text-green-300" : "border-zinc-700/60 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600",
      )}
    >
      {label}
    </button>
  );
}

function ChipField({ label, options, selected, disabled, onChange }: { label: string; options: ListingOption[]; selected: string[]; disabled?: boolean; onChange: (next: string[]) => void }) {
  const all = optionsWithSaved(options, selected);
  return (
    <div>
      <span className={fieldLabel}>
        {label} <span className="font-normal normal-case text-zinc-600">({selected.length}/{FIELD_LIMITS.LIST_MAX_ITEMS})</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {all.map((o) => (
          <Chip key={o.value} label={o.label} active={selected.includes(o.value)} disabled={disabled} onClick={() => onChange(toggleListValue(selected, o.value))} />
        ))}
      </div>
    </div>
  );
}

// ── profile ───────────────────────────────────────────────────────────────────────────────────
export function ProfileSection({ value, onChange, disabled }: { value: ProfileForm; onChange: (patch: Partial<ProfileForm>) => void; disabled?: boolean }) {
  const [otherLanguage, setOtherLanguage] = useState("");
  const [languageNote, setLanguageNote] = useState<string | null>(null);
  const specialtyOptions: ListingOption[] = SPECIALTIES.map((s) => ({ value: s, label: s }));
  const fixed = LANGUAGE_OPTIONS as readonly string[];

  function addOther() {
    const r = addCustomLanguage(value.languages, otherLanguage);
    if (r.outcome === "added") {
      onChange({ languages: r.languages });
      setOtherLanguage("");
      setLanguageNote(null);
    } else {
      setLanguageNote(
        r.outcome === "duplicate" ? "Ngôn ngữ này đã có." : r.outcome === "too_long" ? "Tên ngôn ngữ tối đa 30 ký tự." : r.outcome === "limit" ? "Tối đa 10 ngôn ngữ." : "Hãy nhập tên ngôn ngữ.",
      );
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className={fieldLabel} htmlFor="listing-bio">Giới thiệu bản thân</label>
        <Textarea id="listing-bio" rows={5} value={value.professionalBio} disabled={disabled} maxLength={FIELD_LIMITS.BIO_MAX + 200} onChange={(e) => onChange({ professionalBio: e.target.value })} />
        <p className="mt-1 text-right text-[11px] text-zinc-500">{value.professionalBio.trim().length}/{FIELD_LIMITS.BIO_MAX}</p>
      </div>

      <ChipField label="Chuyên môn" options={specialtyOptions} selected={value.mainSpecialties} disabled={disabled} onChange={(v) => onChange({ mainSpecialties: v })} />

      <div>
        <label className={fieldLabel} htmlFor="listing-methods">Phương pháp huấn luyện</label>
        <Textarea id="listing-methods" rows={4} value={value.trainingMethodsApproach} disabled={disabled} onChange={(e) => onChange({ trainingMethodsApproach: e.target.value })} />
        <p className="mt-1 text-right text-[11px] text-zinc-500">{value.trainingMethodsApproach.trim().length}/{FIELD_LIMITS.METHODS_MAX}</p>
      </div>

      <ChipField label="Nhóm học viên" options={TARGET_GROUP_OPTIONS} selected={value.targetClientGroups} disabled={disabled} onChange={(v) => onChange({ targetClientGroups: v })} />
      <ChipField label="Mục tiêu huấn luyện" options={TRAINING_GOAL_OPTIONS} selected={value.primaryTrainingGoals} disabled={disabled} onChange={(v) => onChange({ primaryTrainingGoals: v })} />

      <div>
        <span className={fieldLabel}>
          Ngôn ngữ <span className="font-normal normal-case text-zinc-600">({value.languages.length}/{FIELD_LIMITS.LIST_MAX_ITEMS})</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {fixed.map((l) => (
            <Chip key={l} label={l} active={value.languages.includes(l)} disabled={disabled} onClick={() => onChange({ languages: toggleListValue(value.languages, l) })} />
          ))}
          {customLanguages(value.languages).map((l) => (
            <button
              key={l}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ languages: value.languages.filter((x) => x !== l) })}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-green-500/50 bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-300"
              aria-label={`Bỏ ngôn ngữ ${l}`}
            >
              {l} <XIcon className="size-3" weight="bold" />
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={otherLanguage}
            disabled={disabled}
            placeholder="Khác: nhập tên ngôn ngữ"
            maxLength={FIELD_LIMITS.LANGUAGE_ITEM_MAX + 10}
            aria-label="Ngôn ngữ khác"
            onChange={(e) => setOtherLanguage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOther();
              }
            }}
          />
          <Button type="button" variant="outline" disabled={disabled || !otherLanguage.trim()} onClick={addOther}>
            <PlusIcon /> Thêm
          </Button>
        </div>
        {languageNote && <p className="mt-1 text-xs text-red-400" role="alert">{languageNote}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={fieldLabel} htmlFor="listing-website">Website</label>
          <Input id="listing-website" inputMode="url" placeholder="https://" value={value.websiteUrl} disabled={disabled} onChange={(e) => onChange({ websiteUrl: e.target.value })} />
        </div>
        <div>
          <label className={fieldLabel} htmlFor="listing-linkedin">LinkedIn</label>
          <Input id="listing-linkedin" inputMode="url" placeholder="https://" value={value.linkedinUrl} disabled={disabled} onChange={(e) => onChange({ linkedinUrl: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

// ── packages ──────────────────────────────────────────────────────────────────────────────────
const modeLabel = (m: string) => (m === "ONLINE" ? "Online" : "Trực tiếp");

function PackageDialog({ open, base, onClose, onSave }: { open: boolean; base: PackageItem | null; onClose: () => void; onSave: (form: PackageForm) => void }) {
  const [form, setForm] = useState<PackageForm>(EMPTY_PACKAGE);
  const [touched, setTouched] = useState(false);
  const [seenKey, setSeenKey] = useState<string | null | undefined>(undefined);
  // Re-seed the form each time the dialog opens for a (different) package.
  const key = open ? (base?.key ?? "__new__") : null;
  if (key !== seenKey) {
    setSeenKey(key);
    if (open) {
      setForm(base ? packageFormFrom(base) : EMPTY_PACKAGE);
      setTouched(false);
    }
  }
  const error = listingPackageError(form);
  const set = (patch: Partial<PackageForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{base ? "Sửa gói dịch vụ" : "Thêm gói dịch vụ"}</DialogTitle>
          <DialogDescription>Thay đổi chỉ áp dụng cho khách mua sau khi bản sửa được duyệt. Hợp đồng đã ký giữ nguyên giá cũ.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={fieldLabel} htmlFor="pkg-name">Tên gói</label>
            <Input id="pkg-name" value={form.name} maxLength={90} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor="pkg-desc">Mô tả (không bắt buộc)</label>
            <Textarea id="pkg-desc" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="pkg-sessions">Số buổi</label>
              <Input id="pkg-sessions" inputMode="numeric" value={form.sessionCount} onChange={(e) => set({ sessionCount: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="pkg-price">Giá gói (₫)</label>
              <Input id="pkg-price" inputMode="numeric" value={form.price} onChange={(e) => set({ price: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="pkg-duration">Phút / buổi</label>
              <Input id="pkg-duration" inputMode="numeric" value={form.sessionDurationMinutes} onChange={(e) => set({ sessionDurationMinutes: e.target.value.replace(/\D/g, "") })} />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="pkg-validity">Hạn dùng (ngày)</label>
              <Input id="pkg-validity" inputMode="numeric" placeholder="Không giới hạn" value={form.validityDays} onChange={(e) => set({ validityDays: e.target.value.replace(/\D/g, "") })} />
            </div>
          </div>
          <div>
            <span className={fieldLabel}>Hình thức</span>
            <div className="flex gap-2">
              {(["ONLINE", "OFFLINE"] as const).map((m) => (
                <Chip key={m} label={modeLabel(m)} active={form.sessionMode === m} onClick={() => set({ sessionMode: m })} />
              ))}
            </div>
          </div>
          {touched && error && <p className="text-xs text-red-400" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button
            onClick={() => {
              setTouched(true);
              if (!error) onSave(form);
            }}
          >
            Xong
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PackagesSection({ items, maxPackages, disabled, onChange }: { items: PackageItem[]; maxPackages: number; disabled?: boolean; onChange: (items: PackageItem[]) => void }) {
  const [editing, setEditing] = useState<PackageItem | null>(null);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);
  const liveCount = livePackages(items).length;

  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-zinc-500">Chưa có gói nào. Thêm gói để khách có thể đặt mua.</p>}
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.key} className={cn("rounded-xl border p-3", p.archive ? "border-red-500/30 bg-red-500/5 opacity-80" : "border-zinc-800/70 bg-zinc-800/30")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold text-zinc-100", p.archive && "line-through")}>{p.name || "Gói chưa đặt tên"}</p>
                <p className="text-xs text-zinc-500">
                  {p.sessionCount} buổi · {p.sessionDurationMinutes} phút/buổi · {modeLabel(p.sessionMode)}
                  {p.validityDays ? ` · ${p.validityDays} ngày` : ""}
                </p>
                {!p.id && <span className="mt-1 inline-block rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-300">Gói mới</span>}
                {p.archive && <span className="mt-1 inline-block rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300">Sẽ ngừng bán sau khi duyệt</span>}
              </div>
              <span className="shrink-0 text-sm font-bold text-green-400">{formatVND(p.price)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!p.archive && (
                <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
                  <Switch checked={p.isActive} disabled={disabled} onCheckedChange={() => onChange(togglePackageActive(items, p.key))} aria-label={`Bật bán gói ${p.name}`} />
                  {p.isActive ? "Đang bán" : "Tạm ngưng"}
                </label>
              )}
              <span className="ml-auto flex gap-1.5">
                {!p.archive && (
                  <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(p)}>
                    <PencilSimpleIcon /> Sửa
                  </Button>
                )}
                {p.archive ? (
                  <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(restorePackageItem(items, p.key))}>
                    <ArrowCounterClockwiseIcon /> Hoàn tác
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="text-red-400" disabled={disabled} onClick={() => onChange(archivePackageItem(items, p.key))}>
                    <TrashIcon /> {p.id ? "Ngừng bán" : "Xóa"}
                  </Button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="outline" disabled={disabled || liveCount >= maxPackages} onClick={() => setAdding(true)}>
        <PlusIcon /> Thêm gói {liveCount >= maxPackages ? `(tối đa ${maxPackages})` : ""}
      </Button>

      <PackageDialog
        open={adding || !!editing}
        base={editing}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSave={(form) => {
          if (editing) {
            onChange(items.map((p) => (p.key === editing.key ? applyPackageForm(form, p) : p)));
          } else {
            seq.current += 1;
            onChange([...items, applyPackageForm(form, undefined, `new-${Date.now()}-${seq.current}`)]);
          }
          setAdding(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

// ── photos ────────────────────────────────────────────────────────────────────────────────────
export interface UploadEntry {
  key: string;
  name: string;
  status: "uploading" | "failed";
  message?: string;
  file: File;
}

/** Wording of the photo block; the PT page uses the defaults, the gym listing page and the add-branch wizard override it. */
export interface PhotosCopy {
  intro?: (count: number, max: number) => string;
  empty?: string;
  removeLabel?: string;
  footer?: string;
}

export function PhotosSection(props: {
  copy?: PhotosCopy;
  ids: string[];
  cover: string | null;
  photos: Map<string, ListingPhoto>;
  /** Uploaded or public photos that are not in the draft (can be added back; STAGED ones can be deleted). */
  spare: ListingPhoto[];
  max: number;
  uploads: UploadEntry[];
  busy: boolean;
  onAdd: (files: File[]) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSetCover: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteStaged: (id: string) => void;
  onAddExisting: (id: string) => void;
  onRetryUpload: (key: string) => void;
  onDropUpload: (key: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tiles: PhotoTile[] = props.ids.map((id) => {
    const p = props.photos.get(id);
    return { id, url: p?.url ?? null, status: p?.status, isCover: id === props.cover };
  });
  const uploading = props.uploads.filter((u) => u.status === "uploading").length;
  const full = props.ids.length + uploading >= props.max;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          {props.copy?.intro ? props.copy.intro(props.ids.length, props.max) : `${props.ids.length}/${props.max} ảnh. Ảnh đầu tiên hoặc ảnh được đặt làm bìa sẽ hiện trên thẻ huấn luyện viên.`}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) props.onAdd(files);
          }}
        />
        <Button variant="outline" size="sm" disabled={props.busy || full} onClick={() => inputRef.current?.click()}>
          <CameraIcon /> Thêm ảnh
        </Button>
      </div>

      {tiles.length > 0 ? (
        <ListingPhotoGrid photos={tiles} onMove={props.onMove} onSetCover={props.onSetCover} onRemove={props.onRemove} removeLabel={props.copy?.removeLabel ?? "Gỡ ảnh khỏi tin"} disabled={props.busy} />
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">{props.copy?.empty ?? "Chưa có ảnh hình thể nào."}</p>
      )}

      {props.uploads.length > 0 && (
        <ul className="space-y-2">
          {props.uploads.map((u) => (
            <li key={u.key} className={cn("flex items-center gap-2 rounded-xl border p-2.5 text-sm", u.status === "failed" ? "border-red-500/30 bg-red-500/5" : "border-zinc-800/70")}>
              {u.status === "uploading" ? <CircleNotchIcon className="size-4 animate-spin text-green-400" /> : <WarningCircleIcon className="size-4 text-red-400" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-zinc-200">{u.name}</p>
                <p className="text-xs text-zinc-500">{u.status === "uploading" ? "Đang tải lên…" : u.message}</p>
              </div>
              {u.status === "failed" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => props.onRetryUpload(u.key)}>Thử lại</Button>
                  <Button size="sm" variant="ghost" onClick={() => props.onDropUpload(u.key)} aria-label="Bỏ ảnh lỗi">
                    <XIcon />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.spare.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Ảnh có thể thêm vào tin</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {props.spare.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900">
                <ListingImage url={p.url} alt="Ảnh chưa dùng" className="aspect-square w-full" />
                <div className="flex gap-1.5 p-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={props.busy || full} onClick={() => props.onAddExisting(p.id)}>
                    <PlusIcon /> Thêm
                  </Button>
                  {p.status === "STAGED" && (
                    <Button size="sm" variant="outline" className="text-red-400" disabled={props.busy} aria-label="Xóa ảnh" onClick={() => props.onDeleteStaged(p.id)}>
                      <TrashIcon />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-zinc-600">{props.copy?.footer ?? "JPEG, PNG hoặc WebP, tối đa 8 MB mỗi ảnh. Ảnh chỉ hiển thị với khách sau khi bản sửa được duyệt."}</p>
    </div>
  );
}
