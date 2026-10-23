import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowsClockwiseIcon, BarbellIcon, EyeIcon, ListChecksIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { gymService } from "../../services/api";
import { gymListingService, ownerAmenityService } from "../../services/gymListingApi";
import type { Gym, ListingPhoto } from "../../types";
import { PageHeader } from "../../components/ui/PageHeader";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { StickyActionBar } from "../../components/ui/StickyActionBar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { GymPreviewCard, PreviewNotice } from "../../components/listing/ListingPreviewCards";
import { AmenityEditor, AmenityChipGroups } from "../../components/listing/AmenityEditor";
import { useProposalFlow } from "../../components/listing/useProposalFlow";
import { ListingImage } from "../../components/listing/ListingImage";
import { PhotosSection, SectionCard, type UploadEntry } from "../pt/listing/ListingSections";
import { LISTING_ERROR_VI, isDraftStale, isListingStale, needsReload } from "../../utils/listingErrors";
import {
  DESCRIPTION_MAX,
  DEFAULT_GYM_LIMITS,
  PREVIEW_STALE_MS,
  addPhoto,
  amenityPool,
  applyProposeOutcome,
  branchAvailability,
  buildGymDraftPayload,
  copyableRejected,
  decideDraftSync,
  disabledAmenitiesOf,
  disabledAmenityNotices,
  errorCodeOf,
  formFromGymPayload,
  gymFormSignature,
  gymListingErrorMessage,
  gymListingInvalidationKeys,
  gymListingKey,
  gymListingPreviewKey,
  gymListingStatusView,
  gymPayloadSignature,
  gymPhotoLimitMessage,
  isGymGone,
  mergeProposals,
  movePhoto,
  ownerAmenitiesKey,
  ownerGymsKey,
  photoFileError,
  photoRoom,
  pickInitialGymId,
  proposalsOfGym,
  removePhoto,
  selectableAmenities,
  setCover,
  staleGymRevisionOf,
  toggleId,
  validateGymForm,
  versionAfterPhotoDelete,
  type GymForm,
  type GymListingView,
  type GymRevision,
} from "../../utils/gymListing";

type Prompt =
  | null
  | { kind: "submit" }
  | { kind: "withdraw" }
  | { kind: "discard" }
  | { kind: "draftStale"; serverRev: GymRevision | null }
  | { kind: "listingStale" }
  | { kind: "amenityDisabled"; items: { id: string; name: string }[]; then: "save" | "submit" };

const historyLabel = (status: string): string =>
  ({ CHANGES_REQUESTED: "Đã yêu cầu chỉnh sửa", WITHDRAWN: "Đã rút lại", STALE: "Cần cập nhật theo tin mới", APPROVED: "Đã duyệt", REJECTED: "Bị từ chối" } as Record<string, string>)[status] ?? "Bản sửa";

const shortDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN");
};

/**
 * /gym-owner/listings — "Tin đăng & tiện ích": the revision workflow of ONE branch's public listing (description, amenities,
 * photos). Pick a branch (only APPROVED / SUSPENDED ones have a listing to revise — the others say why), edit a DRAFT,
 * preview it, send it for review. Same behaviour as the PT page and the mobile screen.
 *
 * Concurrency (plan B7): every save / submit carries `expectedDraftVersion`; DRAFT_STALE / LISTING_STALE make the owner
 * choose — nothing is overwritten silently.
 */
export function GymListingsPage() {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const [params, setParams] = useSearchParams();
  const requested = params.get("gymId");

  const gymsQuery = useQuery<Gym[]>({ queryKey: ownerGymsKey(uid), queryFn: () => gymService.listOwnedGyms(), enabled: !!user, staleTime: 0 });
  const gyms = useMemo(() => gymsQuery.data ?? [], [gymsQuery.data]);
  const gymId = pickInitialGymId(gyms, requested);
  const [dirty, setDirty] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);

  useEffect(() => {
    // Keep ?gymId= in step with the branch that is really open (a notification link may name one that is not editable).
    if (gymId && requested !== gymId) setParams({ gymId }, { replace: true });
  }, [gymId, requested, setParams]);

  if (!user || gymsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <PageSkeleton variant="list" rows={3} />
      </div>
    );
  }
  if (gymsQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <ErrorState kind="server" message={gymListingErrorMessage(gymsQuery.error, "Không tải được danh sách chi nhánh.")} onRetry={() => void gymsQuery.refetch()} />
      </div>
    );
  }
  if (gyms.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader title="Tin đăng & tiện ích" description="Giới thiệu, tiện ích và ảnh của từng chi nhánh." />
        <EmptyState title="Chưa có chi nhánh nào" description="Tạo chi nhánh trước, sau khi được duyệt bạn sẽ quản lý tin đăng tại đây." />
      </div>
    );
  }

  const select = (id: string) => {
    if (id === gymId) return;
    if (dirty) setSwitchTo(id);
    else setParams({ gymId: id });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-6 md:p-6">
      <PageHeader title="Tin đăng & tiện ích" description="Nội dung khách thấy khi xem chi nhánh của bạn: giới thiệu, tiện ích và ảnh. Thay đổi cần gửi duyệt." />

      <BranchPicker gyms={gyms} activeId={gymId} onSelect={select} />

      {gymId ? (
        <GymListingEditor key={`${uid}:${gymId}`} gymId={gymId} uid={uid} onDirtyChange={setDirty} />
      ) : (
        <EmptyState
          title="Chưa có chi nhánh nào để sửa tin đăng"
          description="Tin đăng chỉ sửa được khi chi nhánh đã được Gymini duyệt. Xem lý do ở danh sách phía trên."
        />
      )}

      <ConfirmDialog
        open={switchTo !== null}
        onOpenChange={(o) => !o && setSwitchTo(null)}
        title="Chuyển chi nhánh mà chưa lưu?"
        description="Các chỉnh sửa chưa lưu trong bản nháp của chi nhánh này sẽ mất."
        confirmLabel="Chuyển chi nhánh"
        onConfirm={() => {
          const id = switchTo;
          setSwitchTo(null);
          if (id) {
            setDirty(false);
            setParams({ gymId: id });
          }
        }}
      />
    </div>
  );
}

function BranchPicker({ gyms, activeId, onSelect }: { gyms: Gym[]; activeId: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-label="Chọn chi nhánh" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Chi nhánh</h2>
      <ul className="space-y-2">
        {gyms.map((g) => {
          const a = branchAvailability(g);
          const active = g.id === activeId;
          return (
            <li key={g.id}>
              <button
                type="button"
                disabled={!a.editable}
                aria-pressed={active}
                onClick={() => onSelect(g.id)}
                className={`flex min-h-12 w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? "border-green-500/50 bg-green-500/10" : "border-zinc-800/70 bg-zinc-900 enabled:hover:border-zinc-600"
                }`}
              >
                <BarbellIcon className={`mt-0.5 size-4 shrink-0 ${active ? "text-green-400" : "text-zinc-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-100">{g.approvedName ?? g.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{g.address}</span>
                  {!a.editable && <span className="mt-1 block text-xs leading-5 text-amber-300">{a.reason}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GymListingEditor({ gymId, uid, onDirtyChange }: { gymId: string; uid: string; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();

  const listingQuery = useQuery<GymListingView>({
    queryKey: gymListingKey(uid, gymId),
    queryFn: () => gymListingService.get(gymId),
    staleTime: 0,
    // STAGED photo links last ~15 min: refresh them while the page stays open.
    refetchInterval: 12 * 60 * 1000,
    retry: (count, error) => !isGymGone(error) && errorCodeOf(error) !== "LISTING_NOT_AVAILABLE" && count < 2,
  });
  const catalogQuery = useQuery({ queryKey: ownerAmenitiesKey(uid), queryFn: () => ownerAmenityService.catalog(), staleTime: 60_000 });

  const listing = listingQuery.data;
  const open = listing?.openRevision ?? null;
  const draft = open && open.status === "DRAFT" ? open : null;
  const pending = open?.status === "PENDING";
  const limits = listing?.limits ?? DEFAULT_GYM_LIMITS;
  const status = listing ? gymListingStatusView(listing) : null;

  // ── editor state. Refs are authoritative (an `await` between two clicks must see the latest), the state copies exist
  // only to re-render. ─────────────────────────────────────────────────────────────────────────
  const [form, setFormState] = useState<GymForm | null>(null);
  const [baseline, setBaselineState] = useState("");
  const formRef = useRef<GymForm | null>(null);
  const versionRef = useRef(0);
  const baselineRef = useRef("");
  const revIdRef = useRef<string | null>(null);
  const seenRef = useRef<number | null>(null);

  const setForm = (next: GymForm | null) => {
    formRef.current = next;
    setFormState(next);
  };
  const updateForm = (fn: (f: GymForm) => GymForm) => {
    if (!formRef.current) return;
    setForm(fn(formRef.current));
  };

  const hydrate = useCallback((rev: GymRevision) => {
    const next = formFromGymPayload(rev.payload);
    formRef.current = next;
    setFormState(next);
    baselineRef.current = gymPayloadSignature(rev.payload);
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
        dirty: formRef.current ? gymFormSignature(formRef.current) !== baselineRef.current : false,
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
      baselineRef.current = gymPayloadSignature(draft.payload);
      setBaselineState(baselineRef.current);
      seenRef.current = draft.draftVersion;
    } else if (action === "conflict" && draft) {
      seenRef.current = draft.draftVersion;
      setPrompt({ kind: "draftStale", serverRev: draft });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.draftVersion]);

  const dirty = !!form && gymFormSignature(form) !== baseline;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

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
    for (const key of gymListingInvalidationKeys(uid, gymId)) void queryClient.invalidateQueries({ queryKey: key as unknown[] });
  };
  const setOpenRevision = (rev: GymRevision | null) =>
    queryClient.setQueryData<GymListingView>(gymListingKey(uid, gymId), (old) => (old ? { ...old, openRevision: rev } : old));

  // ── conflicts (409) ─────────────────────────────────────────────────────────────────────────
  async function overwriteWith(serverRev: GymRevision | null) {
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

  function handleWriteError(e: unknown, fallback: string, after: "save" | "submit" = "save") {
    if (isDraftStale(e)) {
      setPrompt({ kind: "draftStale", serverRev: staleGymRevisionOf(e) });
      return;
    }
    if (isListingStale(e)) {
      setPrompt({ kind: "listingStale" });
      return;
    }
    if (errorCodeOf(e) === "AMENITY_DISABLED") {
      const items = disabledAmenitiesOf(e);
      if (items.length > 0) {
        setPrompt({ kind: "amenityDisabled", items, then: after });
        return;
      }
    }
    toast.error(gymListingErrorMessage(e, fallback));
    if (needsReload(e) || errorCodeOf(e) === "GYM_NOT_FOUND") {
      const rev = staleGymRevisionOf(e);
      if (rev) setOpenRevision(rev.status === "DRAFT" || rev.status === "PENDING" ? rev : null);
      void listingQuery.refetch();
    }
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────
  /** Saves the form. Returns the new draftVersion, or null when nothing was saved. */
  async function saveNow(versionOverride?: number, then: "save" | "submit" = "save"): Promise<number | null> {
    const current = formRef.current;
    if (!current) return null;
    const problem = validateGymForm(current, limits);
    if (problem) {
      toast.error(problem);
      return null;
    }
    try {
      const rev = await gymListingService.saveDraft(gymId, { expectedDraftVersion: versionOverride ?? versionRef.current, payload: buildGymDraftPayload(current) });
      if (!rev) throw new Error("Phản hồi không hợp lệ");
      versionRef.current = rev.draftVersion;
      seenRef.current = rev.draftVersion;
      revIdRef.current = rev.id;
      baselineRef.current = gymPayloadSignature(rev.payload);
      setBaselineState(baselineRef.current);
      setOpenRevision(rev);
      void queryClient.invalidateQueries({ queryKey: gymListingPreviewKey(uid, gymId) });
      return rev.draftVersion;
    } catch (e) {
      handleWriteError(e, "Không lưu được bản nháp", then);
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
    if (formRef.current && gymFormSignature(formRef.current) !== baselineRef.current) {
      const saved = await saveNow();
      if (saved == null) return;
      v = saved;
    }
    try {
      const rev = await gymListingService.rebase(gymId, v);
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
        const rev = await gymListingService.createDraft(gymId, copyFromRevisionId);
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
    const problem = validateGymForm(current, limits, true);
    if (problem) {
      toast.error(problem);
      return;
    }
    setPrompt({ kind: "submit" });
  };

  async function submitNow() {
    let v = versionRef.current;
    if (formRef.current && gymFormSignature(formRef.current) !== baselineRef.current) {
      const saved = await saveNow(undefined, "submit");
      if (saved == null) return;
      v = saved;
    }
    try {
      await gymListingService.submit(gymId, { expectedDraftVersion: v });
      invalidateAll();
      toast.success("Đã gửi duyệt — bạn sẽ nhận thông báo khi có kết quả.");
    } catch (e) {
      handleWriteError(e, "Không gửi duyệt được", "submit");
    }
  }
  const doSubmit = () => run("submit", submitNow);

  const doWithdraw = () =>
    run("withdraw", async () => {
      try {
        const rev = await gymListingService.withdraw(gymId);
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
        await gymListingService.discard(gymId);
        setOpenRevision(null);
        invalidateAll();
        toast.success("Đã bỏ bản nháp");
      } catch (e) {
        handleWriteError(e, "Không bỏ được bản nháp");
      }
    });

  /** "Bỏ và tiếp tục": takes the amenities the server says are switched off out of the form, then saves or submits again. */
  const dropDisabledAndContinue = (ids: string[], then: "save" | "submit") =>
    run(then, async () => {
      updateForm((f) => ({ ...f, amenityIds: f.amenityIds.filter((id) => !ids.includes(id)) }));
      if (then === "submit") {
        const problem = formRef.current ? validateGymForm(formRef.current, limits, true) : null;
        if (problem) {
          toast.error(problem);
          return;
        }
        await submitNow();
      } else {
        const v = await saveNow();
        if (v != null) toast.success("Đã lưu bản nháp");
      }
    });

  // ── preview ─────────────────────────────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewQuery = useQuery({
    queryKey: gymListingPreviewKey(uid, gymId),
    queryFn: async () => {
      const view = await gymListingService.preview(gymId);
      if (!view) throw new Error("preview");
      return view;
    },
    enabled: !!open && (previewOpen || pending),
    staleTime: PREVIEW_STALE_MS,
  });

  const openPreview = () =>
    run("preview", async () => {
      // The preview shows what is SAVED; save first so it matches what the owner sees on screen.
      if (formRef.current && gymFormSignature(formRef.current) !== baselineRef.current) {
        const saved = await saveNow();
        if (saved == null) return;
      }
      setPreviewOpen(true);
    });

  // ── amenities & proposals ───────────────────────────────────────────────────────────────────
  const pool = useMemo(() => amenityPool(catalogQuery.data?.amenities ?? [], listing?.amenities ?? []), [catalogQuery.data?.amenities, listing?.amenities]);
  const chips = useMemo(() => selectableAmenities(pool, form?.amenityIds ?? []), [pool, form?.amenityIds]);
  // The catalogue answer knows every status; the listing answer only the PENDING ones — the catalogue's copy wins.
  const myProposals = useMemo(
    () => proposalsOfGym(mergeProposals(listing?.proposals ?? [], catalogQuery.data?.proposals ?? []), gymId),
    [listing?.proposals, catalogQuery.data?.proposals, gymId],
  );
  const disabledNotices = listing ? disabledAmenityNotices(listing) : [];

  const refreshAmenities = () => {
    void queryClient.invalidateQueries({ queryKey: ownerAmenitiesKey(uid) });
    void queryClient.invalidateQueries({ queryKey: gymListingKey(uid, gymId) });
  };

  const proposalFlow = useProposalFlow({
    gymId,
    onOutcome: (o) => updateForm((f) => applyProposeOutcome(f, o)),
    onCancelled: (p) => {
      // The server takes the proposal out of the SAVED draft and bumps draftVersion by one, like deleting a saved photo.
      if (draft?.payload.proposalIds.includes(p.id)) versionRef.current += 1;
      updateForm((f) => ({ ...f, proposalIds: f.proposalIds.filter((x) => x !== p.id) }));
    },
    onRefresh: refreshAmenities,
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
      toast.error(gymPhotoLimitMessage(limits.maxPhotos));
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
      const res = await gymListingService.uploadPhoto(gymId, file);
      setUploads((prev) => prev.filter((u) => u.key !== key));
      if (res.photo) {
        const photo = res.photo;
        setExtraPhotos((prev) => ({ ...prev, [photo.id]: photo }));
        attachPhoto(photo.id);
      }
      void queryClient.invalidateQueries({ queryKey: gymListingKey(uid, gymId) });
    } catch (e) {
      const message = gymListingErrorMessage(e, "Không tải được ảnh. Hãy thử lại.");
      setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, status: "failed", message } : u)));
    }
  };

  const onAddPhotos = async (files: File[]) => {
    const cur = formRef.current;
    if (!cur) return;
    const inFlight = uploads.filter((u) => u.status === "uploading").length;
    const room = photoRoom(cur.photoIds.length + inFlight, limits.maxPhotos);
    if (room <= 0) {
      toast.error(gymPhotoLimitMessage(limits.maxPhotos));
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
        await gymListingService.deletePhoto(gymId, id);
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
        await queryClient.invalidateQueries({ queryKey: gymListingKey(uid, gymId) });
        toast.success("Đã xóa ảnh");
      } catch (e) {
        toast.error(gymListingErrorMessage(e, "Không xóa được ảnh"));
        void listingQuery.refetch();
      }
    });

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  const rejectedCopy = listing ? copyableRejected(listing.history) : null;
  const editing = !!draft && !!form;

  if (listingQuery.isLoading) return <PageSkeleton variant="list" rows={4} />;
  if (listingQuery.isError || !listing || !status) {
    return (
      <ErrorState
        kind={isGymGone(listingQuery.error) ? "not-found" : "server"}
        message={gymListingErrorMessage(listingQuery.error, "Không tải được tin đăng của chi nhánh.")}
        onRetry={() => void listingQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
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
            <ErrorState kind="generic" message={gymListingErrorMessage(previewQuery.error, "Không tải được bản đã gửi.")} onRetry={() => void previewQuery.refetch()} />
          ) : (
            <>
              <GymPreviewCard preview={previewQuery.data} />
              <PreviewNotice expiresAt={previewQuery.data.photoUrlsExpireAt ?? null} />
            </>
          )}
        </section>
      )}

      {/* ── published ──────────────────────────────────────────────────────────────────────── */}
      <PublishedSummary listing={listing} pool={pool} />

      {/* amenities switched off in the catalogue, with no draft open: the owner can still ask for them back */}
      {!editing && disabledNotices.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-200">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
            Một số tiện ích đã ngừng trong danh mục và không còn hiển thị với khách.
          </p>
          <ul className="space-y-1.5">
            {disabledNotices.map((n) => {
              const waiting = myProposals.some((p) => p.kind === "REENABLE" && p.status === "PENDING" && p.targetAmenityId === n.amenityId);
              return (
                <li key={n.amenityId} className="flex items-center justify-between gap-2 text-sm text-zinc-200">
                  <span className="min-w-0 truncate">{n.name}</span>
                  {waiting ? (
                    <span className="shrink-0 text-xs text-blue-300">Đã gửi yêu cầu bật lại</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={proposalFlow.busy} onClick={() => void proposalFlow.reenable(n)}>
                      Đề xuất bật lại
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── draft editor ───────────────────────────────────────────────────────────────────── */}
      {editing && form && (
        <>
          <SectionCard title="Giới thiệu" hint={`Tối đa ${DESCRIPTION_MAX} ký tự. Hiện ở mục “Chi tiết” khi khách xem chi nhánh.`}>
            <Textarea
              aria-label="Giới thiệu chi nhánh"
              rows={5}
              value={form.description}
              disabled={!!busy}
              maxLength={DESCRIPTION_MAX + 100}
              placeholder="Không gian, thiết bị, lớp tập, đội ngũ huấn luyện viên…"
              onChange={(e) => updateForm((f) => ({ ...f, description: e.target.value }))}
            />
            <p className="text-right text-[11px] text-zinc-500">{form.description.trim().length}/{DESCRIPTION_MAX}</p>
          </SectionCard>

          <SectionCard title="Tiện ích" hint="Chọn những tiện ích chi nhánh thực sự có. Không thấy tiện ích cần thiết? Hãy đề xuất để Gymini thêm vào danh mục.">
            <AmenityEditor
              amenities={chips}
              selectedIds={form.amenityIds}
              onToggle={(id) => updateForm((f) => ({ ...f, amenityIds: toggleId(f.amenityIds, id) }))}
              proposals={myProposals}
              attachedProposalIds={form.proposalIds}
              onToggleProposal={(id) => updateForm((f) => ({ ...f, proposalIds: toggleId(f.proposalIds, id) }))}
              onProposeClick={proposalFlow.openCreate}
              onEditProposal={proposalFlow.openEdit}
              onCancelProposal={proposalFlow.askCancel}
              disabledNotices={disabledNotices}
              onReenable={(n) => void proposalFlow.reenable(n)}
              busy={!!busy || proposalFlow.busy}
              loading={catalogQuery.isLoading}
              error={catalogQuery.isError ? gymListingErrorMessage(catalogQuery.error, "Không tải được danh mục tiện ích.") : null}
              onRetry={() => void catalogQuery.refetch()}
            />
          </SectionCard>

          <SectionCard title="Ảnh chi nhánh">
            <PhotosSection
              copy={{
                intro: (n, max) => `${n}/${max} ảnh. Ảnh bìa hiện trên thẻ chi nhánh khi khách tìm phòng gym.`,
                empty: "Chưa có ảnh nào.",
                removeLabel: "Gỡ ảnh khỏi tin",
                footer: "JPEG, PNG hoặc WebP, tối đa 8 MB mỗi ảnh. Ảnh chỉ hiển thị với khách sau khi bản sửa được duyệt.",
              }}
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
              const view = gymListingStatusView({ openRevision: null, history: [h] });
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
            <ErrorState kind="generic" message={gymListingErrorMessage(previewQuery.error, "Không tải được bản xem trước.")} onRetry={() => void previewQuery.refetch()} />
          ) : (
            <>
              <GymPreviewCard preview={previewQuery.data} />
              <PreviewNotice expiresAt={previewQuery.data.photoUrlsExpireAt ?? null} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {proposalFlow.dialogs}

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
        description="Ảnh chưa công khai sẽ bị xóa hẳn khỏi chi nhánh."
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
            <DialogDescription>{LISTING_ERROR_VI.LISTING_STALE} Hãy cập nhật bản nháp theo tin đăng mới (nội dung bạn soạn được giữ lại) rồi gửi duyệt.</DialogDescription>
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

      <Dialog open={prompt?.kind === "amenityDisabled"} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Có tiện ích đã ngừng</DialogTitle>
            <DialogDescription>
              {prompt?.kind === "amenityDisabled" && (
                <>
                  Gymini vừa ngừng {prompt.items.map((i) => i.name).filter(Boolean).join(", ") || "một số tiện ích"} trong danh mục. Bỏ khỏi bản sửa rồi tiếp tục? Bạn có thể đề xuất bật lại sau.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>Quay lại sửa</Button>
            <Button
              onClick={() => {
                if (prompt?.kind !== "amenityDisabled") return;
                const { items, then } = prompt;
                setPrompt(null);
                void dropDisabledAndContinue(items.map((i) => i.id), then);
              }}
            >
              {prompt?.kind === "amenityDisabled" && prompt.then === "submit" ? "Bỏ và gửi lại" : "Bỏ và lưu"}
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

/** "Đang hiển thị với khách" — the published listing in a few lines (the full thing is one "Xem trước" away). */
function PublishedSummary({ listing, pool }: { listing: GymListingView; pool: ReturnType<typeof amenityPool> }) {
  const p = listing.published.payload;
  const amenities = pool.filter((a) => p.amenityIds.includes(a.id) && a.status === "ACTIVE");
  const cover = listing.published.photos.find((x) => x.isCover) ?? listing.published.photos[0] ?? null;
  const published = listing.listingPublishedAt ? new Date(listing.listingPublishedAt) : null;
  return (
    <section className="space-y-3 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
      <div className="flex items-center gap-2">
        <EyeIcon className="size-4 text-green-400" />
        <h2 className="flex-1 text-sm font-bold text-zinc-100">Đang hiển thị với khách</h2>
        {published && !Number.isNaN(published.getTime()) && <span className="text-[11px] text-zinc-500">Từ {published.toLocaleDateString("vi-VN")}</span>}
      </div>
      <div className="flex items-start gap-3">
        {cover ? <ListingImage url={cover.url} alt="Ảnh bìa" className="size-20 shrink-0 rounded-xl" /> : <div className="size-20 shrink-0 rounded-xl bg-zinc-800" />}
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-semibold text-zinc-100">{listing.gym.name}</p>
          {p.description ? <p className="line-clamp-3 whitespace-pre-wrap text-sm text-zinc-300">{p.description}</p> : <p className="text-sm text-zinc-500">Chưa có phần giới thiệu.</p>}
        </div>
      </div>
      {amenities.length > 0 ? (
        <AmenityChipGroups amenities={amenities} selectedIds={amenities.map((a) => a.id)} onToggle={() => {}} disabled />
      ) : (
        <p className="text-sm text-zinc-500">Chưa có tiện ích nào được hiển thị.</p>
      )}
      <p className="text-xs text-zinc-500">{listing.published.photos.length} ảnh đang hiển thị</p>
    </section>
  );
}
