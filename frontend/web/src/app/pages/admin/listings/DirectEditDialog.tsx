import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CameraIcon, CircleNotchIcon, InfoIcon } from "@phosphor-icons/react";
import { adminAmenityService, adminListingService } from "../../../services/ptListingApi";
import type { AdminGymPublishedListing, AdminGymRevisionDetail, AdminPtPublishedListing, AdminPtRevisionDetail, Amenity, GymDirectEditSource, ListingPhoto, PtDirectEditSource } from "../../../types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { ListingPhotoGrid, type PhotoTile } from "../../../components/listing/ListingPhotoGrid";
import { ReasonDialog } from "../../../components/listing/ReasonDialog";
import { AmenityIcon } from "../../../components/listing/AmenityIcon";
import { ProfileSection, PackagesSection, SectionCard } from "../../pt/listing/ListingSections";
import { cn } from "../../../components/ui/utils";
import {
  MAX_GYM_DESCRIPTION,
  MAX_GYM_PHOTOS,
  MAX_PT_PHOTOS,
  adminReasonError,
  buildGymDirectEditBody,
  buildPtDirectEditBody,
  buildRetireBody,
  groupAmenitiesByCategory,
  gymDirectEditError,
} from "../../../utils/adminListing";
import { AMENITY_CATEGORIES, amenityCategoryLabel } from "../../../utils/amenityIcons";
import { gymPhotoPublicPath, ptPhysiquePublicPath } from "../../../utils/listingMedia";
import { listingErrorMessage, errorCodeOf } from "../../../utils/listingErrors";
import { DEFAULT_LIMITS, buildDraftPayload, formFromPayload, movePhoto, photoFileError, removePhoto, setCover, validateListingForm, type ListingForm, type PackageItem, type ProfileForm } from "../../../utils/ptListing";
import { catalogueKey, handleAdminError, refreshAdminListings, type ListingKind } from "./adminListingShared";

interface Props {
  kind: ListingKind;
  source: PtDirectEditSource | GymDirectEditSource;
  onClose: () => void;
}

/** The dialog's starting point from a revision's detail (the queue drill-down). Null = the trainer has no public listing. */
export function ptSourceFromRevision(d: AdminPtRevisionDetail): PtDirectEditSource | null {
  return d.published && d.pt ? { ptUserId: d.revision.ptUserId, listingVersion: d.pt.listingVersion, published: d.published, photos: d.photos } : null;
}
export function gymSourceFromRevision(d: AdminGymRevisionDetail): GymDirectEditSource {
  return { gymId: d.gym.id, gymName: d.gym.name, listingVersion: d.gym.listingVersion, published: d.published, amenities: d.amenities, photos: d.photos };
}
/** ... or from the published-listing reads (the picker: works for a target with no revision at all). */
export function ptSourceFromPublished(d: AdminPtPublishedListing): PtDirectEditSource {
  return { ptUserId: d.pt.userId, listingVersion: d.pt.listingVersion, published: d.published, photos: d.photos };
}
export function gymSourceFromPublished(d: AdminGymPublishedListing): GymDirectEditSource {
  return {
    gymId: d.gym.id,
    gymName: d.gym.name,
    listingVersion: d.gym.listingVersion,
    published: { ...d.published, proposalIds: [] },
    amenities: d.amenities,
    photos: d.photos,
  };
}

const label = "block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5";

/**
 * Direct edit of the PUBLIC listing (plan B9/B10): a reason of at least 10 characters is mandatory and the request
 * carries the listing version the admin saw (`expectedListingVersion`) — if the listing moved meanwhile the server
 * answers 409 LISTING_STALE and nothing is overwritten.
 *
 *  - PT:  the 8 profile fields, packages, photo order + cover, retire. NO upload — an admin never supplies a
 *         trainer's body photos.
 *  - Gym: description, amenities, photo order + cover, retire, and an admin photo upload (staged → put into the
 *         public set by this same edit).
 */
export function DirectEditDialog({ kind, source, onClose }: Props) {
  return kind === "pts" ? <PtEdit detail={source as PtDirectEditSource} onClose={onClose} /> : <GymEdit detail={source as GymDirectEditSource} onClose={onClose} />;
}

function Shell({ title, description, reason, onReason, reasonTouched, busy, canSave, onSave, onClose, children }: {
  title: string;
  description: string;
  reason: string;
  onReason: (v: string) => void;
  reasonTouched: boolean;
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const reasonError = adminReasonError(reason);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">{children}</div>
        <div>
          <label className={label} htmlFor="direct-edit-reason">Lý do sửa (bắt buộc, ít nhất 10 ký tự)</label>
          <Textarea id="direct-edit-reason" rows={3} value={reason} onChange={(e) => onReason(e.target.value)} aria-invalid={reasonTouched && !!reasonError} placeholder="Ví dụ: Gỡ ảnh vi phạm quy định theo báo cáo của khách hàng." />
          {reasonTouched && reasonError && <p className="mt-1 text-xs text-red-400" role="alert">{reasonError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Hủy</Button>
          <Button disabled={busy || !canSave} onClick={onSave}>
            {busy && <CircleNotchIcon className="size-4 animate-spin" />}
            Lưu thay đổi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══ PT ═════════════════════════════════════════════════════════════════════════════════════════
function PtEdit({ detail, onClose }: { detail: PtDirectEditSource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const published = detail.published;
  const ptUserId = detail.ptUserId;
  const version = detail.listingVersion;

  const [form, setForm] = useState<ListingForm>(() => formFromPayload(published));
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [retireId, setRetireId] = useState<string | null>(null);
  const [purge, setPurge] = useState(false);

  const photoMap = useMemo(() => new Map<string, ListingPhoto>(detail.photos.map((p) => [p.id, p])), [detail.photos]);
  const tiles: PhotoTile[] = form.photoIds.map((id) => ({ id, url: photoMap.get(id)?.url ?? ptPhysiquePublicPath(id), isCover: id === form.coverPhotoId }));

  const draft = buildDraftPayload(form);
  const bodyFor = (r: string) => buildPtDirectEditBody({ published, profile: draft.profile, packages: draft.packages, photoIds: draft.photoIds, coverPhotoId: draft.coverPhotoId, reason: r, expectedListingVersion: version });
  const dirty = bodyFor("placeholder-reason") !== null;
  const formError = validateListingForm(form, DEFAULT_LIMITS);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminListingService.directEditPt(ptUserId, body),
    onSuccess: (res) => {
      toast.success(res.invalidatedRevisionId ? "Đã cập nhật tin đăng. Bản sửa đang chờ của huấn luyện viên đã được chuyển thành bản nháp mới để họ xem lại." : "Đã cập nhật tin đăng.");
      refreshAdminListings(queryClient);
      onClose();
    },
    onError: (e) => {
      handleAdminError(e, queryClient, "Không lưu được thay đổi");
      if (errorCodeOf(e) === "LISTING_STALE") onClose();
    },
  });

  const retire = useMutation({
    mutationFn: ({ photoId, reason: r }: { photoId: string; reason: string }) => adminListingService.retirePtPhoto(ptUserId, photoId, buildRetireBody(r, purge)),
    onSuccess: (res) => {
      toast.success(res?.purged ? "Đã gỡ ảnh và xóa hẳn tệp." : "Đã gỡ ảnh khỏi tin đăng.");
      refreshAdminListings(queryClient);
      onClose();
    },
    onError: (e) => {
      setRetireId(null);
      handleAdminError(e, queryClient, "Không gỡ được ảnh");
    },
  });

  function submit() {
    setTouched(true);
    const err = adminReasonError(reason);
    if (err) return;
    if (formError) return void toast.error(formError);
    const body = bodyFor(reason);
    if (!body) return void toast.info("Chưa có thay đổi nào so với tin đăng hiện tại.");
    save.mutate(body);
  }

  const patchProfile = (p: Partial<ProfileForm>) => setForm((f) => ({ ...f, profile: { ...f.profile, ...p } }));

  return (
    <>
      <Shell
        title="Sửa trực tiếp tin đăng PT"
        description="Thay đổi áp dụng ngay cho khách hàng và được ghi nhật ký cùng lý do. Huấn luyện viên được báo."
        reason={reason}
        onReason={setReason}
        reasonTouched={touched}
        busy={save.isPending}
        canSave={dirty}
        onSave={submit}
        onClose={onClose}
      >
        <SectionCard title="Hồ sơ chuyên môn">
          <ProfileSection value={form.profile} onChange={patchProfile} />
        </SectionCard>
        <SectionCard title="Gói dịch vụ" hint="Đổi giá hoặc ngừng bán chỉ áp dụng cho hợp đồng mới; hợp đồng đã ký giữ nguyên.">
          <PackagesSection items={form.packages} maxPackages={DEFAULT_LIMITS.maxPackages} onChange={(items: PackageItem[]) => setForm((f) => ({ ...f, packages: items }))} />
        </SectionCard>
        <SectionCard title="Ảnh hình thể" hint="Quản trị viên chỉ sắp xếp, đặt ảnh bìa hoặc gỡ ảnh đang công khai — không tải ảnh mới thay huấn luyện viên.">
          {tiles.length === 0 ? (
            <p className="text-sm text-zinc-500">Tin đăng chưa có ảnh nào.</p>
          ) : (
            <ListingPhotoGrid
              photos={tiles}
              disabled={save.isPending}
              onMove={(id, dir) => setForm((f) => ({ ...f, photoIds: movePhoto(f.photoIds, id, dir) }))}
              onSetCover={(id) => setForm((f) => ({ ...f, coverPhotoId: setCover(f.photoIds, f.coverPhotoId, id) }))}
              onRemove={(id) => {
                if (dirty) return void toast.info("Hãy lưu hoặc hoàn tác các chỉnh sửa trước khi gỡ ảnh.");
                setPurge(false);
                setRetireId(id);
              }}
              removeLabel="Gỡ ảnh khỏi tin đăng"
            />
          )}
          {tiles.length > MAX_PT_PHOTOS && <p className="text-xs text-red-400">Tối đa {MAX_PT_PHOTOS} ảnh.</p>}
        </SectionCard>
      </Shell>
      <RetireDialog open={retireId !== null} purge={purge} onPurge={setPurge} onClose={() => setRetireId(null)} onConfirm={async (r) => { if (retireId) await retire.mutateAsync({ photoId: retireId, reason: r }).catch(() => undefined); }} />
    </>
  );
}

function RetireDialog({ open, purge, onPurge, onClose, onConfirm }: { open: boolean; purge: boolean; onPurge: (v: boolean) => void; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  return (
    <ReasonDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Gỡ ảnh khỏi tin đăng?"
      description="Ảnh biến mất khỏi tin đăng ngay lập tức và việc này được ghi nhật ký."
      label="Lý do gỡ ảnh (bắt buộc, ít nhất 10 ký tự)"
      confirmLabel="Gỡ ảnh"
      danger
      validate={adminReasonError}
      onConfirm={onConfirm}
    >
      <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-800/40 p-2.5 text-sm text-zinc-300">
        <input type="checkbox" className="mt-1" checked={purge} onChange={(e) => onPurge(e.target.checked)} />
        <span>
          Xóa hẳn tệp ảnh khỏi kho lưu trữ
          <span className="block text-xs text-zinc-500">Không chọn: ảnh chỉ bị gỡ khỏi tin đăng và tệp được dọn tự động sau 90 ngày. Chọn: liên kết ảnh đã phát ra cũng hết hiệu lực ngay.</span>
        </span>
      </label>
    </ReasonDialog>
  );
}

// ═══ Gym ════════════════════════════════════════════════════════════════════════════════════════
function GymEdit({ detail, onClose }: { detail: GymDirectEditSource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const published = detail.published;
  const gymId = detail.gymId;
  const version = detail.listingVersion;

  const [description, setDescription] = useState(published.description ?? "");
  const [amenityIds, setAmenityIds] = useState<string[]>(published.amenityIds);
  const [photoIds, setPhotoIds] = useState<string[]>(published.photoIds);
  const [cover, setCoverId] = useState<string | null>(published.coverPhotoId);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [uploaded, setUploaded] = useState<Record<string, ListingPhoto>>({});
  const [uploading, setUploading] = useState(0);
  const [retireId, setRetireId] = useState<string | null>(null);
  const [purge, setPurge] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const catalogueQuery = useQuery({ queryKey: catalogueKey("active"), queryFn: () => adminAmenityService.list({ status: "ACTIVE" }), staleTime: 60_000 });
  const catalogue: Amenity[] = catalogueQuery.data?.amenities ?? [];
  const known = new Map<string, { name: string; iconKey: string; disabled: boolean }>();
  for (const a of detail.amenities) known.set(a.id, { name: a.name, iconKey: a.iconKey, disabled: a.status !== "ACTIVE" });
  for (const a of catalogue) known.set(a.id, { name: a.name, iconKey: a.iconKey, disabled: false });
  // amenities the branch has that are no longer in the active catalogue stay visible (and removable)
  const keptDisabled = amenityIds.filter((id) => known.get(id)?.disabled);

  const photoMap = useMemo(() => {
    const m = new Map<string, ListingPhoto>(detail.photos.map((p) => [p.id, p]));
    for (const p of Object.values(uploaded)) m.set(p.id, p);
    return m;
  }, [detail.photos, uploaded]);
  const tiles: PhotoTile[] = photoIds.map((id) => {
    const p = photoMap.get(id);
    return { id, url: p?.url ?? gymPhotoPublicPath(id), status: p?.status === "STAGED" ? "STAGED" : undefined, isCover: id === cover };
  });

  const bodyFor = (r: string) => buildGymDirectEditBody({ published, description, amenityIds, photoIds, coverPhotoId: cover, reason: r, expectedListingVersion: version });
  const dirty = bodyFor("placeholder-reason") !== null;
  const formError = gymDirectEditError({ description, photoIds });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminListingService.directEditGym(gymId, body),
    onSuccess: (res) => {
      toast.success(res.invalidatedRevisionId ? "Đã cập nhật tin đăng. Bản sửa đang chờ của chủ chi nhánh đã được chuyển thành bản nháp mới để họ xem lại." : "Đã cập nhật tin đăng.");
      refreshAdminListings(queryClient);
      onClose();
    },
    onError: (e) => {
      handleAdminError(e, queryClient, "Không lưu được thay đổi");
      if (errorCodeOf(e) === "LISTING_STALE") onClose();
    },
  });

  const retire = useMutation({
    mutationFn: ({ photoId, reason: r }: { photoId: string; reason: string }) => adminListingService.retireGymPhoto(gymId, photoId, buildRetireBody(r, purge)),
    onSuccess: (res) => {
      toast.success(res?.purged ? "Đã gỡ ảnh và xóa hẳn tệp." : "Đã gỡ ảnh khỏi tin đăng.");
      refreshAdminListings(queryClient);
      onClose();
    },
    onError: (e) => {
      setRetireId(null);
      handleAdminError(e, queryClient, "Không gỡ được ảnh");
    },
  });

  async function onFiles(files: File[]) {
    const room = Math.max(0, MAX_GYM_PHOTOS - photoIds.length - uploading);
    if (room === 0) return void toast.error(`Chi nhánh chỉ có tối đa ${MAX_GYM_PHOTOS} ảnh.`);
    for (const file of files.slice(0, room)) {
      const problem = photoFileError(file);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const res = await adminListingService.uploadGymPhoto(gymId, file);
        if (res.photo) {
          const photo = res.photo;
          setUploaded((u) => ({ ...u, [photo.id]: photo }));
          setPhotoIds((ids) => (ids.includes(photo.id) ? ids : [...ids, photo.id]));
          setCoverId((c) => c ?? photo.id);
        }
      } catch (e) {
        toast.error(listingErrorMessage(e, "Không tải được ảnh. Hãy thử lại."));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function submit() {
    setTouched(true);
    if (adminReasonError(reason)) return;
    if (formError) return void toast.error(formError);
    const body = bodyFor(reason);
    if (!body) return void toast.info("Chưa có thay đổi nào so với tin đăng hiện tại.");
    save.mutate(body);
  }

  const groups = groupAmenitiesByCategory(catalogue, AMENITY_CATEGORIES);
  const toggle = (id: string) => setAmenityIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <>
      <Shell
        title="Sửa trực tiếp tin đăng chi nhánh"
        description={`${detail.gymName} — thay đổi áp dụng ngay cho khách hàng và được ghi nhật ký cùng lý do. Chủ chi nhánh được báo.`}
        reason={reason}
        onReason={setReason}
        reasonTouched={touched}
        busy={save.isPending}
        canSave={dirty && uploading === 0}
        onSave={submit}
        onClose={onClose}
      >
        <SectionCard title="Giới thiệu">
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Giới thiệu chi nhánh" />
          <p className={cn("text-right text-[11px]", description.trim().length > MAX_GYM_DESCRIPTION ? "text-red-400" : "text-zinc-500")}>{description.trim().length}/{MAX_GYM_DESCRIPTION}</p>
        </SectionCard>

        <SectionCard title="Tiện ích" hint="Chỉ chọn trong danh mục. Đề xuất tiện ích của chủ gym được xử lý ở tab Đề xuất tiện ích.">
          {catalogueQuery.isLoading ? (
            <p className="text-sm text-zinc-500">Đang tải danh mục…</p>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.category}>
                  <p className={label}>{amenityCategoryLabel(g.category)}</p>
                  <div className="flex flex-wrap gap-2">
                    {g.items.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={amenityIds.includes(a.id)}
                        onClick={() => toggle(a.id)}
                        className={cn(
                          "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          amenityIds.includes(a.id) ? "border-green-500/50 bg-green-500/15 text-green-300" : "border-zinc-700/60 bg-zinc-800/50 text-zinc-300 hover:border-zinc-600",
                        )}
                      >
                        <AmenityIcon iconKey={a.iconKey} className="size-3.5" />
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {keptDisabled.length > 0 && (
                <div>
                  <p className={label}>Đã ngừng trong danh mục</p>
                  <div className="flex flex-wrap gap-2">
                    {keptDisabled.map((id) => (
                      <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                        <AmenityIcon iconKey={known.get(id)?.iconKey} className="size-3.5" />
                        {known.get(id)?.name ?? "Tiện ích"} · bỏ
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Ảnh">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-start gap-1.5 text-xs text-zinc-500">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              {photoIds.length}/{MAX_GYM_PHOTOS} ảnh. Ảnh admin tải lên được đưa vào tin đăng khi bạn bấm Lưu thay đổi.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void onFiles(files);
              }}
            />
            <Button size="sm" variant="outline" disabled={uploading > 0 || photoIds.length >= MAX_GYM_PHOTOS} onClick={() => fileRef.current?.click()}>
              {uploading > 0 ? <CircleNotchIcon className="animate-spin" /> : <CameraIcon />} Tải ảnh lên
            </Button>
          </div>
          {tiles.length === 0 ? (
            <p className="text-sm text-zinc-500">Chi nhánh chưa có ảnh nào.</p>
          ) : (
            <ListingPhotoGrid
              photos={tiles}
              disabled={save.isPending}
              onMove={(id, dir) => setPhotoIds((ids) => movePhoto(ids, id, dir))}
              onSetCover={(id) => setCoverId((c) => setCover(photoIds, c, id))}
              onRemove={(id) => {
                const p = photoMap.get(id);
                const isPublic = (published.photoIds.includes(id) && p?.status !== "STAGED") || p?.status === "PUBLISHED";
                if (!isPublic) {
                  // an admin-uploaded photo that was never public: just take it out of this edit
                  const r = removePhoto(photoIds, cover, id);
                  setPhotoIds(r.ids);
                  setCoverId(r.cover);
                  return;
                }
                if (dirty) return void toast.info("Hãy lưu hoặc hoàn tác các chỉnh sửa trước khi gỡ ảnh.");
                setPurge(false);
                setRetireId(id);
              }}
              removeLabel="Gỡ ảnh"
            />
          )}
        </SectionCard>
      </Shell>
      <RetireDialog open={retireId !== null} purge={purge} onPurge={setPurge} onClose={() => setRetireId(null)} onConfirm={async (r) => { if (retireId) await retire.mutateAsync({ photoId: retireId, reason: r }).catch(() => undefined); }} />
    </>
  );
}
