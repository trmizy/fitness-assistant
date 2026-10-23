import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowsClockwiseIcon, EyeIcon, ListChecksIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { ptListingService } from "../../services/ptListingApi";
import type { ListingPhoto, PtListingRevision, PtListingView } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import { ErrorState } from "../../components/ui/ErrorState";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Button } from "../../components/ui/button";
import { StickyActionBar } from "../../components/ui/StickyActionBar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { PtPreviewCard, PreviewNotice } from "../../components/listing/ListingPreviewCards";
import { formatVND } from "../../utils/currency";
import { LISTING_ERROR_VI, isDraftStale, isListingStale, listingErrorMessage, needsReload, staleRevisionOf } from "../../utils/listingErrors";
import {
  DEFAULT_LIMITS,
  PREVIEW_STALE_MS,
  TARGET_GROUP_OPTIONS,
  TRAINING_GOAL_OPTIONS,
  addPhoto,
  buildDraftPayload,
  copyableRejected,
  decideDraftSync,
  formFromPayload,
  formSignature,
  listingStatusView,
  movePhoto,
  payloadSignature,
  photoFileError,
  photoLimitMessage,
  photoRoom,
  ptListingInvalidationKeys,
  ptListingKey,
  ptListingPreviewKey,
  removePhoto,
  setCover,
  validateListingForm,
  versionAfterPhotoDelete,
  type ListingForm,
  type PackageItem,
  type ProfileForm,
} from "../../utils/ptListing";
import { PackagesSection, PhotosSection, ProfileSection, SectionCard, type UploadEntry } from "./listing/ListingSections";

type Prompt = null | { kind: "submit" } | { kind: "withdraw" } | { kind: "discard" } | { kind: "draftStale"; serverRev: PtListingRevision | null } | { kind: "listingStale" };

const labelOf = (options: { value: string; label: string }[], v: string) => options.find((o) => o.value === v)?.label ?? v;

/**
 * PT "Tin đăng" — the trainer's public listing (profile text, packages, physique photos) as ONE page.
 *
 * Nothing the trainer changes reaches clients directly: edits go into a DRAFT, the draft is sent for review, an
 * admin approves / rejects / asks for changes. While it waits (PENDING) the page is read-only until the trainer
 * withdraws it. The state machine and every limit live on the server; this page only mirrors it.
 *
 * Concurrency (plan B7): every save / submit carries `expectedDraftVersion`. When the server says the draft moved
 * (DRAFT_STALE) or the public listing moved (LISTING_STALE) the trainer chooses — nothing is overwritten silently.
 * Same behaviour as the mobile screen (frontend/mobile/src/features/ptListing/PtListingScreen.tsx).
 */
export function PTListingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const listingQuery = useQuery({
    queryKey: ptListingKey(uid),
    queryFn: () => ptListingService.get(),
    enabled: !!user,
    staleTime: 0,
    // STAGED photo links last ~15 min: refresh them while the page stays open.
    refetchInterval: 12 * 60 * 1000,
  });
  const listing = listingQuery.data;
  const open = listing?.openRevision ?? null;
  const draft = open && open.status === "DRAFT" ? open : null;
  const pending = open?.status === "PENDING";
  const limits = listing?.limits ?? DEFAULT_LIMITS;
  const status = listing ? listingStatusView(listing) : null;

  // ── editor state. Refs are authoritative (an `await` between two clicks must see the latest), the state copies
  // exist only to re-render. ─────────────────────────────────────────────────────────────────────
  const [form, setFormState] = useState<ListingForm | null>(null);
  const [baseline, setBaselineState] = useState("");
  const formRef = useRef<ListingForm | null>(null);
  const versionRef = useRef(0);
  const baselineRef = useRef("");
  const revIdRef = useRef<string | null>(null);
  const seenRef = useRef<number | null>(null);

  const setForm = (next: ListingForm | null) => {
    formRef.current = next;
    setFormState(next);
  };
  const updateForm = (fn: (f: ListingForm) => ListingForm) => {
    if (!formRef.current) return;
    setForm(fn(formRef.current));
  };

  const hydrate = useCallback((rev: PtListingRevision) => {
    const next = formFromPayload(rev.payload);
    formRef.current = next;
    setFormState(next);
    baselineRef.current = payloadSignature(rev.payload);
    setBaselineState(baselineRef.current);
    versionRef.current = rev.draftVersion;
    revIdRef.current = rev.id;
    seenRef.current = rev.draftVersion;
  }, []);

  const [prompt, setPrompt] = useState<Prompt>(null);

  useEffect(() => {
    const action = decideDraftSync(
      {
        formRevisionId: revIdRef.current,
        lastSeenVersion: seenRef.current,
        version: versionRef.current,
        dirty: formRef.current ? formSignature(formRef.current) !== baselineRef.current : false,
      },
      draft ? { id: draft.id, draftVersion: draft.draftVersion } : null,
    );
    if (action === "clear") {
      if (formRef.current) {
        formRef.current = null;
        setFormState(null);
      }
      revIdRef.current = null;
      seenRef.current = null;
    } else if (action === "reset" && draft) {
      hydrate(draft);
    } else if (action === "own" && draft) {
      baselineRef.current = payloadSignature(draft.payload);
      setBaselineState(baselineRef.current);
      seenRef.current = draft.draftVersion;
    } else if (action === "conflict" && draft) {
      seenRef.current = draft.draftVersion;
      setPrompt({ kind: "draftStale", serverRev: draft });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.draftVersion]);

  const dirty = !!form && formSignature(form) !== baseline;

  // Unsaved edits: block leaving the tab and in-app navigation.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const blocker = useBlocker(dirty);

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const run = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = label;
    setBusy(label);
    try {
      await fn();
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  };

  const invalidateAll = () => {
    for (const key of ptListingInvalidationKeys(uid)) void queryClient.invalidateQueries({ queryKey: key as unknown[] });
  };
  const setOpenRevision = (rev: PtListingRevision | null) =>
    queryClient.setQueryData<PtListingView>(ptListingKey(uid), (old) => (old ? { ...old, openRevision: rev } : old));

  // ── conflicts (409) ─────────────────────────────────────────────────────────────────────────
  async function overwriteWith(serverRev: PtListingRevision | null) {
    let rev = serverRev;
    if (!rev || rev.status !== "DRAFT") {
      const r = await listingQuery.refetch();
      rev = r.data?.openRevision && r.data.openRevision.status === "DRAFT" ? r.data.openRevision : null;
    }
    if (!rev) return;
    versionRef.current = rev.draftVersion;
    seenRef.current = rev.draftVersion;
    await run("save", async () => {
      await saveNow(rev!.draftVersion);
    });
  }

  function handleWriteError(e: unknown, fallback: string) {
    if (isDraftStale(e)) {
      setPrompt({ kind: "draftStale", serverRev: staleRevisionOf(e) });
      return;
    }
    if (isListingStale(e)) {
      setPrompt({ kind: "listingStale" });
      return;
    }
    toast.error(listingErrorMessage(e, fallback));
    if (needsReload(e)) {
      const rev = staleRevisionOf(e);
      if (rev) setOpenRevision(rev.status === "DRAFT" || rev.status === "PENDING" ? rev : null);
      void listingQuery.refetch();
    }
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────
  /** Saves the form. Returns the new draftVersion, or null when nothing was saved. */
  async function saveNow(versionOverride?: number): Promise<number | null> {
    const current = formRef.current;
    if (!current) return null;
    const problem = validateListingForm(current, limits);
    if (problem) {
      toast.error(problem);
      return null;
    }
    try {
      const rev = await ptListingService.saveDraft({ expectedDraftVersion: versionOverride ?? versionRef.current, payload: buildDraftPayload(current) });
      if (!rev) throw new Error("Phản hồi không hợp lệ");
      versionRef.current = rev.draftVersion;
      seenRef.current = rev.draftVersion;
      revIdRef.current = rev.id;
      baselineRef.current = payloadSignature(rev.payload);
      setBaselineState(baselineRef.current);
      setOpenRevision(rev);
      void queryClient.invalidateQueries({ queryKey: ptListingPreviewKey(uid) });
      return rev.draftVersion;
    } catch (e) {
      handleWriteError(e, "Không lưu được bản nháp");
      return null;
    }
  }

  const onSave = () =>
    run("save", async () => {
      const v = await saveNow();
      if (v != null) toast.success("Đã lưu bản nháp");
    });

  async function doRebase() {
    let v = versionRef.current;
    if (formRef.current && formSignature(formRef.current) !== baselineRef.current) {
      const saved = await saveNow();
      if (saved == null) return;
      v = saved;
    }
    try {
      const rev = await ptListingService.rebase(v);
      if (rev) {
        hydrate(rev);
        setOpenRevision(rev);
      }
      invalidateAll();
      toast.success("Đã cập nhật bản nháp theo tin đăng mới");
    } catch (e) {
      handleWriteError(e, "Không cập nhật được bản nháp");
    }
  }

  const startDraft = (copyFromRevisionId?: string) =>
    run("create", async () => {
      try {
        const rev = await ptListingService.createDraft(copyFromRevisionId);
        if (rev) {
          hydrate(rev);
          setOpenRevision(rev);
        }
        invalidateAll();
      } catch (e) {
        handleWriteError(e, "Không tạo được bản nháp");
      }
    });

  const askSubmit = () => {
    const current = formRef.current;
    if (!current) return;
    const problem = validateListingForm(current, limits);
    if (problem) {
      toast.error(problem);
      return;
    }
    setPrompt({ kind: "submit" });
  };

  const doSubmit = () =>
    run("submit", async () => {
      let v = versionRef.current;
      if (formRef.current && formSignature(formRef.current) !== baselineRef.current) {
        const saved = await saveNow();
        if (saved == null) return;
        v = saved;
      }
      try {
        await ptListingService.submit({ expectedDraftVersion: v });
        invalidateAll();
        toast.success("Đã gửi duyệt — bạn sẽ nhận thông báo khi có kết quả.");
      } catch (e) {
        handleWriteError(e, "Không gửi duyệt được");
      }
    });

  const doWithdraw = () =>
    run("withdraw", async () => {
      try {
        const rev = await ptListingService.withdraw();
        if (rev) {
          hydrate(rev);
          setOpenRevision(rev);
        }
        invalidateAll();
        toast.success("Đã rút lại — bạn có thể sửa tiếp bản nháp");
      } catch (e) {
        handleWriteError(e, "Không rút lại được");
      }
    });

  const doDiscard = () =>
    run("discard", async () => {
      try {
        await ptListingService.discard();
        setOpenRevision(null);
        invalidateAll();
        toast.success("Đã bỏ bản nháp");
      } catch (e) {
        handleWriteError(e, "Không bỏ được bản nháp");
      }
    });

  // ── preview ─────────────────────────────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewQuery = useQuery({
    queryKey: ptListingPreviewKey(uid),
    queryFn: async () => {
      const view = await ptListingService.preview();
      if (!view) throw new Error("preview");
      return view;
    },
    enabled: !!open && (previewOpen || pending),
    staleTime: PREVIEW_STALE_MS,
  });

  const openPreview = () =>
    run("preview", async () => {
      // The preview shows what is SAVED; save first so it matches what the trainer sees on screen.
      if (formRef.current && formSignature(formRef.current) !== baselineRef.current) {
        const saved = await saveNow();
        if (saved == null) return;
      }
      setPreviewOpen(true);
    });

  // ── photos ──────────────────────────────────────────────────────────────────────────────────
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [extraPhotos, setExtraPhotos] = useState<Record<string, ListingPhoto>>({});
  const uploadSeq = useRef(0);

  const photoMap = useMemo(() => {
    const map = new Map<string, ListingPhoto>();
    for (const p of listing?.photos ?? []) map.set(p.id, p);
    for (const p of Object.values(extraPhotos)) if (!map.has(p.id)) map.set(p.id, p);
    return map;
  }, [listing?.photos, extraPhotos]);

  const spare = useMemo(() => [...photoMap.values()].filter((p) => !(form?.photoIds ?? []).includes(p.id)), [photoMap, form?.photoIds]);

  const attachPhoto = (id: string) => {
    const cur = formRef.current;
    if (!cur) return;
    const r = addPhoto(cur.photoIds, cur.coverPhotoId, id, limits.maxPhotos);
    if (r.outcome === "limit") {
      toast.error(photoLimitMessage(limits.maxPhotos));
      return;
    }
    if (r.outcome === "duplicate") {
      toast.error("Ảnh này đã có trong tin đăng.");
      return;
    }
    updateForm((f) => ({ ...f, photoIds: r.ids, coverPhotoId: r.cover }));
  };

  const uploadOne = async (file: File, key: string) => {
    setUploads((prev) => [...prev.filter((u) => u.key !== key), { key, name: file.name, status: "uploading", file }]);
    try {
      const res = await ptListingService.uploadPhoto(file);
      setUploads((prev) => prev.filter((u) => u.key !== key));
      if (res.photo) {
        const photo = res.photo;
        setExtraPhotos((prev) => ({ ...prev, [photo.id]: photo }));
        attachPhoto(photo.id);
      }
      void queryClient.invalidateQueries({ queryKey: ptListingKey(uid) });
    } catch (e) {
      const message = listingErrorMessage(e, "Không tải được ảnh. Hãy thử lại.");
      setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, status: "failed", message } : u)));
    }
  };

  const onAddPhotos = async (files: File[]) => {
    const cur = formRef.current;
    if (!cur) return;
    const inFlight = uploads.filter((u) => u.status === "uploading").length;
    const room = photoRoom(cur.photoIds.length + inFlight, limits.maxPhotos);
    if (room <= 0) {
      toast.error(photoLimitMessage(limits.maxPhotos));
      return;
    }
    const accepted: File[] = [];
    for (const f of files) {
      const problem = photoFileError(f);
      if (problem) toast.error(`${f.name}: ${problem}`);
      else accepted.push(f);
    }
    if (accepted.length > room) toast.error(`Chỉ còn chỗ cho ${room} ảnh nữa — các ảnh thừa đã được bỏ qua.`);
    for (const file of accepted.slice(0, room)) {
      uploadSeq.current += 1;
      await uploadOne(file, `upload-${uploadSeq.current}`);
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const doDeleteStaged = (id: string) =>
    run("delete-photo", async () => {
      try {
        await ptListingService.deletePhoto(id);
        // Deleting a photo that is in the SAVED draft makes the server bump draftVersion by one.
        versionRef.current = versionAfterPhotoDelete(versionRef.current, draft?.payload.photoIds ?? [], id);
        updateForm((f) => {
          const r = removePhoto(f.photoIds, f.coverPhotoId, id);
          return { ...f, photoIds: r.ids, coverPhotoId: r.cover };
        });
        setExtraPhotos((prev) => {
          const { [id]: _gone, ...rest } = prev;
          return rest;
        });
        await queryClient.invalidateQueries({ queryKey: ptListingKey(uid) });
        toast.success("Đã xóa ảnh");
      } catch (e) {
        toast.error(listingErrorMessage(e, "Không xóa được ảnh"));
        void listingQuery.refetch();
      }
    });

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  const patchProfile = (patch: Partial<ProfileForm>) => updateForm((f) => ({ ...f, profile: { ...f.profile, ...patch } }));
  const setPackages = (items: PackageItem[]) => updateForm((f) => ({ ...f, packages: items }));
  const rejectedCopy = listing ? copyableRejected(listing.history) : null;
  const editing = !!draft && !!form;

  if (!user || listingQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <PageSkeleton variant="list" rows={4} />
      </div>
    );
  }
  if (listingQuery.isError || !listing || !status) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <ErrorState kind="server" message={listingErrorMessage(listingQuery.error, "Không tải được tin đăng.")} onRetry={() => void listingQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-6 md:p-6">
      <PageHeader title="Tin đăng" description="Nội dung khách thấy khi xem hồ sơ của bạn: giới thiệu, gói dịch vụ và ảnh hình thể." actions={
        <Button variant="outline" size="sm" onClick={() => navigate("/pt/profile")}>Hồ sơ PT</Button>
      } />

      {/* ── status ─────────────────────────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
        <div className="flex items-center gap-2">
          <ListChecksIcon className="size-4 text-green-400" />
          <h2 className="flex-1 text-sm font-bold text-zinc-100">Trạng thái tin đăng</h2>
          {status.label && <StatusBadge label={status.label} tone={status.tone} size="md" />}
        </div>
        <p className="text-sm leading-5 text-zinc-400">{status.description}</p>

        {status.adminNote && (
          <div className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-800/40 p-3">
            <p className="text-xs font-semibold text-zinc-500">Ghi chú của quản trị viên</p>
            <p className="whitespace-pre-wrap text-sm text-zinc-200">{status.adminNote}</p>
          </div>
        )}
        {status.notices.map((n) => (
          <div key={n} className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-800/40 p-3">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p className="text-xs leading-5 text-zinc-400">{n}</p>
          </div>
        ))}
        {status.stale && !pending && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs leading-5 text-amber-200">{LISTING_ERROR_VI.LISTING_STALE} Cập nhật để bản nháp dựa trên tin đăng mới nhất.</p>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("rebase", doRebase)}>
              <ArrowsClockwiseIcon /> Cập nhật theo bản mới
            </Button>
          </div>
        )}

        {!open && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!busy} onClick={() => void startDraft()}>
              {busy === "create" ? "Đang tạo…" : "Soạn bản sửa mới"}
            </Button>
            {rejectedCopy && (
              <Button variant="outline" disabled={!!busy} onClick={() => void startDraft(rejectedCopy.id)}>
                Soạn lại từ bản bị từ chối
              </Button>
            )}
          </div>
        )}
        {pending && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setPrompt({ kind: "withdraw" })}>
              Rút lại để sửa tiếp
            </Button>
          </div>
        )}
      </section>

      {/* ── pending: the submitted version, read-only ──────────────────────────────────────── */}
      {pending && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-zinc-100">Bản đã gửi duyệt</h2>
          {previewQuery.isLoading ? (
            <PageSkeleton variant="list" rows={2} />
          ) : previewQuery.isError || !previewQuery.data ? (
            <ErrorState kind="generic" message={listingErrorMessage(previewQuery.error, "Không tải được bản đã gửi.")} onRetry={() => void previewQuery.refetch()} />
          ) : (
            <>
              <PtPreviewCard preview={previewQuery.data} />
              <PreviewNotice expiresAt={previewQuery.data.photoUrlsExpireAt} />
            </>
          )}
        </section>
      )}

      {/* ── published ──────────────────────────────────────────────────────────────────────── */}
      <PublishedSummary listing={listing} />

      {/* ── draft editor ───────────────────────────────────────────────────────────────────── */}
      {editing && form && (
        <>
          <SectionCard title="Giới thiệu & chuyên môn">
            <ProfileSection value={form.profile} onChange={patchProfile} disabled={!!busy} />
          </SectionCard>

          <SectionCard title="Gói dịch vụ" hint="Gói được sửa tại đây và gửi duyệt cùng tin đăng. Hợp đồng đã ký không đổi giá.">
            <PackagesSection items={form.packages} maxPackages={limits.maxPackages} disabled={!!busy} onChange={setPackages} />
          </SectionCard>

          <SectionCard title="Ảnh hình thể">
            <PhotosSection
              ids={form.photoIds}
              cover={form.coverPhotoId}
              photos={photoMap}
              spare={spare}
              max={limits.maxPhotos}
              uploads={uploads}
              busy={!!busy}
              onAdd={(files) => void onAddPhotos(files)}
              onMove={(id, dir) => updateForm((f) => ({ ...f, photoIds: movePhoto(f.photoIds, id, dir) }))}
              onSetCover={(id) => updateForm((f) => ({ ...f, coverPhotoId: setCover(f.photoIds, f.coverPhotoId, id) }))}
              onRemove={(id) =>
                updateForm((f) => {
                  const r = removePhoto(f.photoIds, f.coverPhotoId, id);
                  return { ...f, photoIds: r.ids, coverPhotoId: r.cover };
                })
              }
              onDeleteStaged={(id) => setDeleteId(id)}
              onAddExisting={attachPhoto}
              onRetryUpload={(key) => {
                const entry = uploads.find((u) => u.key === key);
                if (entry) void uploadOne(entry.file, key);
              }}
              onDropUpload={(key) => setUploads((prev) => prev.filter((u) => u.key !== key))}
            />
          </SectionCard>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void openPreview()}>
              <EyeIcon /> Xem trước
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setPrompt({ kind: "discard" })}>
              Bỏ nháp
            </Button>
          </div>

          <StickyActionBar>
            <Button className="flex-1" variant="outline" disabled={!dirty || !!busy} onClick={() => void onSave()}>
              {busy === "save" ? "Đang lưu…" : dirty ? "Lưu nháp" : "Đã lưu"}
            </Button>
            <Button className="flex-1" disabled={!!busy} onClick={askSubmit}>
              {busy === "submit" ? "Đang gửi…" : "Gửi duyệt"}
            </Button>
          </StickyActionBar>
        </>
      )}

      {/* ── history ────────────────────────────────────────────────────────────────────────── */}
      {listing.history.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
          <h2 className="text-sm font-bold text-zinc-100">Lịch sử bản sửa gần đây</h2>
          <ul className="divide-y divide-zinc-800/70">
            {listing.history.slice(0, 5).map((h) => {
              const view = listingStatusView({ openRevision: null, history: [h] });
              return (
                <li key={h.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200">{view.label ?? historyLabel(h.status)}</p>
                    {h.reviewNote && <p className="truncate text-xs text-zinc-500">{h.reviewNote}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">{shortDate(h.closedAt ?? h.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── preview dialog (draft) ─────────────────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Xem trước</DialogTitle>
            <DialogDescription>Khách sẽ thấy như thế này sau khi bản sửa được duyệt.</DialogDescription>
          </DialogHeader>
          {previewQuery.isLoading ? (
            <PageSkeleton variant="list" rows={2} />
          ) : previewQuery.isError || !previewQuery.data ? (
            <ErrorState kind="generic" message={listingErrorMessage(previewQuery.error, "Không tải được bản xem trước.")} onRetry={() => void previewQuery.refetch()} />
          ) : (
            <>
              <PtPreviewCard preview={previewQuery.data} />
              <PreviewNotice expiresAt={previewQuery.data.photoUrlsExpireAt} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── confirmations and conflicts ────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={prompt?.kind === "submit"}
        onOpenChange={(o) => !o && setPrompt(null)}
        title="Gửi duyệt bản sửa?"
        description="Quản trị viên sẽ xem xét. Trong lúc chờ, khách vẫn thấy tin đăng hiện tại — và bạn chưa sửa tiếp được cho tới khi bản sửa được xử lý hoặc bạn rút lại."
        confirmLabel="Gửi duyệt"
        danger={false}
        onConfirm={async () => {
          setPrompt(null);
          await doSubmit();
        }}
      />
      <ConfirmDialog
        open={prompt?.kind === "withdraw"}
        onOpenChange={(o) => !o && setPrompt(null)}
        title="Rút lại bản sửa?"
        description="Bản sửa sẽ không còn chờ duyệt. Nội dung được giữ lại thành bản nháp để bạn sửa tiếp."
        confirmLabel="Rút lại"
        danger={false}
        onConfirm={async () => {
          setPrompt(null);
          await doWithdraw();
        }}
      />
      <ConfirmDialog
        open={prompt?.kind === "discard"}
        onOpenChange={(o) => !o && setPrompt(null)}
        title="Bỏ bản nháp?"
        description="Các chỉnh sửa chưa gửi sẽ mất. Tin đăng đang hiển thị với khách không bị ảnh hưởng."
        confirmLabel="Bỏ nháp"
        onConfirm={async () => {
          setPrompt(null);
          await doDiscard();
        }}
      />
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Xóa ảnh này?"
        description="Ảnh chưa công khai sẽ bị xóa hẳn khỏi tài khoản của bạn."
        confirmLabel="Xóa ảnh"
        onConfirm={async () => {
          const id = deleteId;
          setDeleteId(null);
          if (id) await doDeleteStaged(id);
        }}
      />

      <Dialog open={prompt?.kind === "draftStale"} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bản nháp đã thay đổi</DialogTitle>
            <DialogDescription>{LISTING_ERROR_VI.DRAFT_STALE} Bạn muốn tải bản mới nhất hay ghi đè bằng bản đang sửa?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                const serverRev = prompt?.kind === "draftStale" ? prompt.serverRev : null;
                setPrompt(null);
                if (serverRev && serverRev.status === "DRAFT") {
                  hydrate(serverRev);
                  setOpenRevision(serverRev);
                } else {
                  void listingQuery.refetch().then((r) => {
                    const fresh = r.data?.openRevision;
                    if (fresh && fresh.status === "DRAFT") hydrate(fresh);
                  });
                }
              }}
            >
              Tải bản mới nhất
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const serverRev = prompt?.kind === "draftStale" ? prompt.serverRev : null;
                setPrompt(null);
                void overwriteWith(serverRev);
              }}
            >
              Ghi đè bằng bản của tôi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={prompt?.kind === "listingStale"} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tin đăng đã thay đổi</DialogTitle>
            <DialogDescription>
              {LISTING_ERROR_VI.LISTING_STALE} Hãy cập nhật bản nháp theo tin đăng mới (nội dung bạn soạn được giữ lại) rồi gửi duyệt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>Tiếp tục sửa</Button>
            <Button
              onClick={() => {
                setPrompt(null);
                void run("rebase", doRebase);
              }}
            >
              Cập nhật theo bản mới
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(o) => !o && blocker.state === "blocked" && blocker.reset()}
        title="Rời khỏi mà chưa lưu?"
        description="Các chỉnh sửa chưa lưu trong bản nháp sẽ mất."
        confirmLabel="Rời đi"
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </div>
  );
}

function historyLabel(status: string): string {
  switch (status) {
    case "CHANGES_REQUESTED":
      return "Đã yêu cầu chỉnh sửa";
    case "WITHDRAWN":
      return "Đã rút lại";
    case "STALE":
      return "Cần cập nhật theo tin mới";
    case "APPROVED":
      return "Đã duyệt";
    case "REJECTED":
      return "Bị từ chối";
    default:
      return "Bản sửa";
  }
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN");
}

/** "Đang hiển thị với khách" — the published listing in a few lines (the full thing is one "Xem trước" away). */
function PublishedSummary({ listing }: { listing: PtListingView }) {
  const p = listing.published.profile;
  const live = listing.published.packages.filter((x) => x.isActive);
  const prices = live.map((x) => x.price / Math.max(1, x.sessionCount));
  const fromPerSession = prices.length ? Math.floor(Math.min(...prices) / 1000) * 1000 : null;
  const published = listing.listingPublishedAt ? new Date(listing.listingPublishedAt) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
      <div className="flex items-center gap-2">
        <EyeIcon className="size-4 text-green-400" />
        <h2 className="flex-1 text-sm font-bold text-zinc-100">Đang hiển thị với khách</h2>
        {published && !Number.isNaN(published.getTime()) && <span className="text-[11px] text-zinc-500">Từ {published.toLocaleDateString("vi-VN")}</span>}
      </div>
      {p.professionalBio ? <p className="line-clamp-3 whitespace-pre-wrap text-sm text-zinc-200">{p.professionalBio}</p> : <p className="text-sm text-zinc-500">Chưa có phần giới thiệu.</p>}
      {p.mainSpecialties.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {p.mainSpecialties.map((s) => (
            <span key={s} className="rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-300">{s}</span>
          ))}
        </div>
      )}
      {p.targetClientGroups.length + p.primaryTrainingGoals.length > 0 && (
        <p className="line-clamp-2 text-xs text-zinc-500">
          {[...p.targetClientGroups.map((g) => labelOf(TARGET_GROUP_OPTIONS, g)), ...p.primaryTrainingGoals.map((g) => labelOf(TRAINING_GOAL_OPTIONS, g))].join(" · ")}
        </p>
      )}
      <div className="space-y-0.5 text-xs text-zinc-500">
        <p>
          {live.length} gói đang bán{fromPerSession != null ? ` · từ ${formatVND(fromPerSession)}/buổi` : ""}
        </p>
        <p>{listing.published.photos.length} ảnh hình thể</p>
      </div>
    </section>
  );
}
