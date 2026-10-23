import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, ListChecks, RefreshCw } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, ScreenHeader, useToast } from "../../components/ui";
import { useApp } from "../../context/AppContext";
import { pickImages, type PickedFile } from "../../lib/pickFile";
import { ptListingService, uploadPtPhysiquePhoto } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { GOAL_OPTIONS, TARGET_OPTIONS } from "../ptApplication/ptApplication";
import { ListingPreviewPanel } from "./ListingPreview";
import { PackagesSection, PhotosSection, ProfileSection, SectionTitle, type UploadEntry } from "./ListingSections";
import {
  DEFAULT_LIMITS,
  LISTING_ERROR_VI,
  MAX_PHOTO_BYTES,
  PREVIEW_STALE_MS,
  addPhoto,
  buildDraftPayload,
  copyableRejected,
  formFromPayload,
  formSignature,
  isDraftStale,
  isListingStale,
  listingErrorMessage,
  listingStatusView,
  movePhoto,
  needsReload,
  normalizeListing,
  normalizePhoto,
  normalizePreview,
  payloadSignature,
  photoLimitMessage,
  photoRoom,
  ptListingInvalidationKeys,
  ptListingKey,
  ptListingPreviewKey,
  removePhoto,
  revisionFromResponse,
  setCover,
  staleRevisionOf,
  decideDraftSync,
  validateListingForm,
  versionAfterPhotoDelete,
  type ListingForm,
  type ListingPhoto,
  type ListingView,
  type OwnerRevision,
  type PackageItem,
  type ProfileForm,
} from "./ptListing";

type StoredUpload = UploadEntry & { file: PickedFile };

const labelOf = (options: { value: string; label: string }[], v: string) => options.find((o) => o.value === v)?.label ?? v;

/**
 * PT "Tin đăng" — the trainer's public listing (profile text, packages, physique photos) as ONE screen.
 *
 * Nothing the trainer changes reaches clients directly: edits go into a DRAFT, the draft is sent for
 * review, an admin approves / rejects / asks for changes. While it waits, clients keep seeing the
 * published listing. The state machine and every limit live on the server; this screen only mirrors it.
 *
 * Concurrency (plan B7): every save/submit carries `expectedDraftVersion`. When the server says the
 * draft moved (DRAFT_STALE) or the public listing moved (LISTING_STALE) the trainer chooses —
 * this screen never overwrites someone else's draft silently.
 */
export function PtListingScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const listingQuery = useQuery({
    queryKey: ptListingKey(uid),
    queryFn: async () => normalizeListing(await ptListingService.get()),
    staleTime: 0,
  });
  const listing = listingQuery.data;
  const open = listing?.openRevision ?? null;
  const draft = open && open.status === "DRAFT" ? open : null;
  const limits = listing?.limits ?? DEFAULT_LIMITS;
  const status = listing ? listingStatusView(listing) : null;

  // ── editor state. Refs are authoritative (an `await` between two taps must see the latest), the
  // state copies exist only to re-render. ───────────────────────────────────────────────────────
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

  const hydrate = useCallback((rev: OwnerRevision) => {
    const next = formFromPayload(rev.payload);
    formRef.current = next;
    setFormState(next);
    baselineRef.current = payloadSignature(rev.payload);
    setBaselineState(baselineRef.current);
    versionRef.current = rev.draftVersion;
    revIdRef.current = rev.id;
    seenRef.current = rev.draftVersion;
  }, []);

  // Keep the form in step with what the server holds, without ever replacing unsaved edits silently.
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
      askDraftStale(draft, "retry");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.draftVersion]);

  const dirty = !!form && formSignature(form) !== baseline;

  // ── small plumbing ──────────────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState<string | null>(null);
  // A ref, not the state: dialog buttons run closures from an older render, and a stale "busy" must not swallow a tap.
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
  const setOpenRevision = (rev: OwnerRevision | null) =>
    queryClient.setQueryData<ListingView>(ptListingKey(uid), (old) => (old ? { ...old, openRevision: rev } : old));

  /** STAGED photo links live ~15 min; an <Image> that fails asks for fresh ones, at most every 20 s. */
  const lastImageRefresh = useRef(0);
  const onImageError = useCallback(() => {
    const now = Date.now();
    if (now - lastImageRefresh.current < 20_000) return;
    lastImageRefresh.current = now;
    void queryClient.invalidateQueries({ queryKey: ptListingKey(uid) });
    void queryClient.invalidateQueries({ queryKey: ptListingPreviewKey(uid) });
  }, [queryClient, uid]);

  // ── conflicts (409) ─────────────────────────────────────────────────────────────────────────
  /** DRAFT_STALE: the draft on the server is newer than the one this phone edited. The trainer decides. */
  function askDraftStale(serverRev: OwnerRevision | null, then: "retry" | "none" = "none") {
    Alert.alert("Bản nháp đã thay đổi", `${LISTING_ERROR_VI.DRAFT_STALE} Bạn muốn tải bản mới nhất hay ghi đè bằng bản đang sửa?`, [
      {
        text: "Tải bản mới nhất",
        onPress: () => {
          if (serverRev) {
            hydrate(serverRev);
            setOpenRevision(serverRev);
          } else {
            void listingQuery.refetch().then((r) => {
              const fresh = r.data?.openRevision;
              if (fresh && fresh.status === "DRAFT") hydrate(fresh);
            });
          }
        },
      },
      {
        text: "Ghi đè bằng bản của tôi",
        style: "destructive",
        onPress: () => {
          void overwriteWith(serverRev, then);
        },
      },
    ]);
  }

  async function overwriteWith(serverRev: OwnerRevision | null, _then: "retry" | "none") {
    let rev = serverRev;
    if (!rev) {
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

  /** LISTING_STALE: the public listing changed after this draft was started. */
  function askListingStale() {
    Alert.alert("Tin đăng đã thay đổi", `${LISTING_ERROR_VI.LISTING_STALE} Hãy cập nhật bản nháp theo tin đăng mới (nội dung bạn soạn được giữ lại) rồi gửi duyệt.`, [
      { text: "Tiếp tục sửa", style: "cancel" },
      {
        text: "Cập nhật theo bản mới",
        onPress: () => {
          void run("rebase", doRebase);
        },
      },
    ]);
  }

  function handleWriteError(e: unknown, fallback: string) {
    if (isDraftStale(e)) {
      askDraftStale(staleRevisionOf(e));
      return;
    }
    if (isListingStale(e)) {
      askListingStale();
      return;
    }
    toast.show(listingErrorMessage(e, fallback), "danger");
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
      toast.show(problem, "danger");
      return null;
    }
    try {
      const res = await ptListingService.saveDraft({
        expectedDraftVersion: versionOverride ?? versionRef.current,
        payload: buildDraftPayload(current) as unknown as Record<string, unknown>,
      });
      const rev = revisionFromResponse(res);
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
      if (v != null) toast.show("Đã lưu bản nháp", "success");
    });

  async function doRebase() {
    let v = versionRef.current;
    if (formRef.current && formSignature(formRef.current) !== baselineRef.current) {
      const saved = await saveNow();
      if (saved == null) return;
      v = saved;
    }
    try {
      const res = await ptListingService.rebase({ expectedDraftVersion: v });
      const rev = revisionFromResponse(res);
      if (rev) {
        hydrate(rev);
        setOpenRevision(rev);
      }
      invalidateAll();
      toast.show("Đã cập nhật bản nháp theo tin đăng mới", "success");
    } catch (e) {
      handleWriteError(e, "Không cập nhật được bản nháp");
    }
  }

  const startDraft = (copyFromRevisionId?: string) =>
    run("create", async () => {
      try {
        const res = await ptListingService.createDraft(copyFromRevisionId ? { copyFromRevisionId } : {});
        const rev = revisionFromResponse(res);
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
      toast.show(problem, "danger");
      return;
    }
    Alert.alert(
      "Gửi duyệt bản sửa?",
      "Quản trị viên sẽ xem xét. Trong lúc chờ, khách vẫn thấy tin đăng hiện tại — và bạn chưa sửa tiếp được cho tới khi bản sửa được xử lý hoặc bạn rút lại.",
      [
        { text: "Chưa gửi", style: "cancel" },
        {
          text: "Gửi duyệt",
          onPress: () => {
            void run("submit", async () => {
              let v = versionRef.current;
              if (formRef.current && formSignature(formRef.current) !== baselineRef.current) {
                const saved = await saveNow();
                if (saved == null) return;
                v = saved;
              }
              try {
                await ptListingService.submit({ expectedDraftVersion: v });
                invalidateAll();
                toast.show("Đã gửi duyệt — chúng tôi sẽ báo khi có kết quả.", "success");
              } catch (e) {
                handleWriteError(e, "Không gửi duyệt được");
              }
            });
          },
        },
      ],
    );
  };

  const askWithdraw = () =>
    Alert.alert("Rút lại bản sửa?", "Bản sửa sẽ không còn chờ duyệt. Nội dung được giữ lại thành bản nháp để bạn sửa tiếp.", [
      { text: "Giữ nguyên", style: "cancel" },
      {
        text: "Rút lại",
        onPress: () => {
          void run("withdraw", async () => {
            try {
              const res = await ptListingService.withdraw();
              const rev = revisionFromResponse(res);
              if (rev) {
                hydrate(rev);
                setOpenRevision(rev);
              }
              invalidateAll();
              toast.show("Đã rút lại — bạn có thể sửa tiếp bản nháp", "success");
            } catch (e) {
              handleWriteError(e, "Không rút lại được");
            }
          });
        },
      },
    ]);

  const askDiscard = () =>
    Alert.alert("Bỏ bản nháp?", "Các chỉnh sửa chưa gửi sẽ mất. Tin đăng đang hiển thị với khách không bị ảnh hưởng.", [
      { text: "Giữ lại", style: "cancel" },
      {
        text: "Bỏ nháp",
        style: "destructive",
        onPress: () => {
          void run("discard", async () => {
            try {
              await ptListingService.discard();
              setOpenRevision(null);
              invalidateAll();
              toast.show("Đã bỏ bản nháp", "success");
            } catch (e) {
              handleWriteError(e, "Không bỏ được bản nháp");
            }
          });
        },
      },
    ]);

  // ── preview ─────────────────────────────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewQuery = useQuery({
    queryKey: ptListingPreviewKey(uid),
    queryFn: async () => {
      const view = normalizePreview(await ptListingService.preview());
      if (!view) throw new Error("preview");
      return view;
    },
    enabled: previewOpen && !!open,
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
  const [uploads, setUploads] = useState<StoredUpload[]>([]);
  const [extraPhotos, setExtraPhotos] = useState<Record<string, ListingPhoto>>({});
  const uploadSeq = useRef(0);

  const photoMap = useMemo(() => {
    const map = new Map<string, ListingPhoto>();
    for (const p of listing?.photos ?? []) map.set(p.id, p);
    for (const p of Object.values(extraPhotos)) if (!map.has(p.id)) map.set(p.id, p);
    return map;
  }, [listing?.photos, extraPhotos]);

  const unused = useMemo(
    () => (listing?.photos ?? []).filter((p) => p.status === "STAGED" && !(form?.photoIds ?? []).includes(p.id)),
    [listing?.photos, form?.photoIds],
  );

  const attachPhoto = (id: string) => {
    const cur = formRef.current;
    if (!cur) return;
    const r = addPhoto(cur.photoIds, cur.coverPhotoId, id, limits.maxPhotos);
    if (r.outcome === "limit") {
      toast.show(photoLimitMessage(limits.maxPhotos), "danger");
      return;
    }
    if (r.outcome === "duplicate") {
      toast.show("Ảnh này đã có trong tin đăng.", "danger");
      return;
    }
    updateForm((f) => ({ ...f, photoIds: r.ids, coverPhotoId: r.cover }));
  };

  const uploadOne = async (file: PickedFile, key: string) => {
    setUploads((prev) => [...prev.filter((u) => u.key !== key), { key, name: file.name, status: "uploading", file }]);
    try {
      const res = await uploadPtPhysiquePhoto(file);
      const photo = normalizePhoto(res.photo);
      setUploads((prev) => prev.filter((u) => u.key !== key));
      if (photo) {
        setExtraPhotos((prev) => ({ ...prev, [photo.id]: photo }));
        attachPhoto(photo.id);
      }
      void queryClient.invalidateQueries({ queryKey: ptListingKey(uid) });
    } catch (e) {
      const message = listingErrorMessage(e, "Không tải được ảnh. Hãy thử lại.");
      setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, status: "failed", message } : u)));
    }
  };

  const onAddPhotos = async () => {
    const cur = formRef.current;
    if (!cur) return;
    const pending = uploads.filter((u) => u.status === "uploading").length;
    const room = photoRoom(cur.photoIds.length + pending, limits.maxPhotos);
    if (room <= 0) {
      toast.show(photoLimitMessage(limits.maxPhotos), "danger");
      return;
    }
    let files: PickedFile[];
    try {
      files = await pickImages(room, MAX_PHOTO_BYTES);
    } catch (e) {
      toast.show((e as Error)?.message || "Không chọn được ảnh", "danger");
      return;
    }
    for (const file of files) {
      uploadSeq.current += 1;
      await uploadOne(file, `upload-${uploadSeq.current}`);
    }
  };

  const askDeleteStaged = (id: string) =>
    Alert.alert("Xóa ảnh này?", "Ảnh chưa công khai sẽ bị xóa hẳn khỏi tài khoản của bạn.", [
      { text: "Không", style: "cancel" },
      {
        text: "Xóa ảnh",
        style: "destructive",
        onPress: () => {
          void run("delete-photo", async () => {
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
              toast.show("Đã xóa ảnh", "success");
            } catch (e) {
              toast.show(listingErrorMessage(e, "Không xóa được ảnh"), "danger");
              void listingQuery.refetch();
            }
          });
        },
      },
    ]);

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/pt/profile"));
  const back = () => {
    if (!dirty) return leave();
    Alert.alert("Rời khỏi mà chưa lưu?", "Các chỉnh sửa chưa lưu trong bản nháp sẽ mất.", [
      { text: "Ở lại", style: "cancel" },
      { text: "Rời đi", style: "destructive", onPress: leave },
    ]);
  };
  const patchProfile = (patch: Partial<ProfileForm>) => updateForm((f) => ({ ...f, profile: { ...f.profile, ...patch } }));
  const setPackages = (items: PackageItem[]) => updateForm((f) => ({ ...f, packages: items }));
  const rejectedCopy = listing ? copyableRejected(listing.history) : null;
  const editing = !!draft && !!form;
  const pending = open?.status === "PENDING";

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Tin đăng" onBack={back} />

      {listingQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : listingQuery.isError || !listing || !status ? (
        <ScrollView
          contentContainerStyle={{ padding: 20 }}
          refreshControl={<RefreshControl refreshing={listingQuery.isRefetching} onRefresh={() => void listingQuery.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
        >
          <EmptyState
            icon={AlertTriangle}
            title="Không tải được tin đăng"
            description={listingErrorMessage(listingQuery.error, "Kiểm tra kết nối rồi kéo xuống để thử lại.")}
            actionLabel="Thử lại"
            onAction={() => void listingQuery.refetch()}
          />
        </ScrollView>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: editing ? 24 : insets.bottom + 32 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={listingQuery.isRefetching && !busy}
                onRefresh={() => void listingQuery.refetch()}
                tintColor={accent.primary}
                colors={[accent.primary]}
              />
            }
          >
            <View className="gap-4">
              {/* ── status ─────────────────────────────────────────────────────────────── */}
              <Card className="gap-3 p-4">
                <View className="flex-row items-center gap-2">
                  <ListChecks size={16} color={accent.primary} />
                  <Text className="flex-1 font-body-semibold text-sm text-foreground">Trạng thái tin đăng</Text>
                  {status.label ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                </View>
                <Text className="font-body text-sm leading-5 text-muted-foreground">{status.description}</Text>

                {status.adminNote ? (
                  <View className="gap-1 rounded-xl border border-border bg-panel p-3">
                    <Text className="font-body-semibold text-xs text-muted-foreground">Ghi chú của quản trị viên</Text>
                    <Text className="font-body text-sm leading-5 text-foreground">{status.adminNote}</Text>
                  </View>
                ) : null}
                {status.notices.map((n) => (
                  <View key={n} className="flex-row items-start gap-2 rounded-xl border border-border bg-panel p-3">
                    <AlertTriangle size={14} color={accent.primary} />
                    <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">{n}</Text>
                  </View>
                ))}
                {status.stale && !pending ? (
                  <View className="gap-2 rounded-xl border border-border bg-panel p-3">
                    <Text className="font-body text-xs leading-5 text-muted-foreground">{`${LISTING_ERROR_VI.LISTING_STALE} Cập nhật để bản nháp dựa trên tin đăng mới nhất.`}</Text>
                    <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!!busy} onPress={() => void run("rebase", doRebase)}>
                      Cập nhật theo bản mới
                    </Button>
                  </View>
                ) : null}

                {/* actions that depend on the state */}
                {!open ? (
                  <View className="gap-2">
                    <Button full disabled={!!busy} onPress={() => void startDraft()}>
                      {busy === "create" ? "Đang tạo…" : "Soạn bản sửa mới"}
                    </Button>
                    {rejectedCopy ? (
                      <Button full variant="secondary" disabled={!!busy} onPress={() => void startDraft(rejectedCopy.id)}>
                        Soạn lại từ bản bị từ chối
                      </Button>
                    ) : null}
                  </View>
                ) : null}
                {pending ? (
                  <View className="flex-row flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={Eye} disabled={!!busy} onPress={() => void openPreview()}>
                      Xem bản đã gửi
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!!busy} onPress={askWithdraw}>
                      Rút lại để sửa tiếp
                    </Button>
                  </View>
                ) : null}
              </Card>

              {/* ── published ──────────────────────────────────────────────────────────── */}
              <PublishedSummary listing={listing} />

              {/* ── draft editor ───────────────────────────────────────────────────────── */}
              {editing && form ? (
                <>
                  <Card className="gap-4 p-4">
                    <SectionTitle>Giới thiệu & chuyên môn</SectionTitle>
                    <ProfileSection value={form.profile} onChange={patchProfile} />
                  </Card>

                  <Card className="gap-3 p-4">
                    <SectionTitle>Gói dịch vụ</SectionTitle>
                    <PackagesSection items={form.packages} maxPackages={limits.maxPackages} onChange={setPackages} />
                  </Card>

                  <Card className="gap-3 p-4">
                    <SectionTitle>Ảnh hình thể</SectionTitle>
                    <PhotosSection
                      ids={form.photoIds}
                      cover={form.coverPhotoId}
                      photos={photoMap}
                      unused={unused}
                      max={limits.maxPhotos}
                      uploads={uploads}
                      busy={!!busy}
                      onAdd={() => void onAddPhotos()}
                      onMove={(id, dir) => updateForm((f) => ({ ...f, photoIds: movePhoto(f.photoIds, id, dir) }))}
                      onSetCover={(id) => updateForm((f) => ({ ...f, coverPhotoId: setCover(f.photoIds, f.coverPhotoId, id) }))}
                      onRemove={(id) =>
                        updateForm((f) => {
                          const r = removePhoto(f.photoIds, f.coverPhotoId, id);
                          return { ...f, photoIds: r.ids, coverPhotoId: r.cover };
                        })
                      }
                      onDeleteStaged={askDeleteStaged}
                      onAddExisting={attachPhoto}
                      onRetryUpload={(key) => {
                        const entry = uploads.find((u) => u.key === key);
                        if (entry) void uploadOne(entry.file, key);
                      }}
                      onDropUpload={(key) => setUploads((prev) => prev.filter((u) => u.key !== key))}
                      onImageError={onImageError}
                    />
                  </Card>

                  <View className="flex-row flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={Eye} disabled={!!busy} onPress={() => void openPreview()}>
                      Xem trước
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!!busy} onPress={askDiscard}>
                      Bỏ nháp
                    </Button>
                  </View>
                </>
              ) : null}
            </View>
          </ScrollView>

          {editing ? (
            <View className="flex-row gap-3 border-t border-border bg-card px-5 pb-3 pt-3">
              <Button className="flex-1" variant="secondary" disabled={!dirty || !!busy} onPress={() => void onSave()}>
                {busy === "save" ? "Đang lưu…" : dirty ? "Lưu nháp" : "Đã lưu"}
              </Button>
              <Button className="flex-1" disabled={!!busy} onPress={askSubmit}>
                {busy === "submit" ? "Đang gửi…" : "Gửi duyệt"}
              </Button>
            </View>
          ) : null}
        </>
      )}

      <BottomSheet open={previewOpen} onClose={() => setPreviewOpen(false)} title="Xem trước">
        <ListingPreviewPanel
          loading={previewQuery.isLoading}
          error={previewQuery.isError ? listingErrorMessage(previewQuery.error, "Không tải được bản xem trước.") : null}
          preview={previewQuery.data ?? null}
          onRetry={() => void previewQuery.refetch()}
          onImageError={onImageError}
        />
      </BottomSheet>
    </View>
  );
}

/** "Đang hiển thị với khách" — the published listing in a few lines (the full thing is one Xem trước away). */
function PublishedSummary({ listing }: { listing: ListingView }) {
  const accent = useWorkspaceAccent();
  const p = listing.published.profile;
  const live = listing.published.packages.filter((x) => x.isActive);
  const prices = live.map((x) => x.price / Math.max(1, x.sessionCount));
  const fromPerSession = prices.length ? Math.floor(Math.min(...prices) / 1000) * 1000 : null;
  const published = listing.listingPublishedAt ? new Date(listing.listingPublishedAt) : null;

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Eye size={16} color={accent.primary} />
        <Text className="flex-1 font-body-semibold text-sm text-foreground">Đang hiển thị với khách</Text>
        {published && !Number.isNaN(published.getTime()) ? (
          <Text className="font-body text-[11px] text-muted-foreground">
            {`Từ ${String(published.getDate()).padStart(2, "0")}/${String(published.getMonth() + 1).padStart(2, "0")}/${published.getFullYear()}`}
          </Text>
        ) : null}
      </View>
      {p.professionalBio ? (
        <Text className="font-body text-sm leading-5 text-foreground" numberOfLines={3}>
          {p.professionalBio}
        </Text>
      ) : (
        <Text className="font-body text-sm text-muted-foreground">Chưa có phần giới thiệu.</Text>
      )}
      {p.mainSpecialties.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {p.mainSpecialties.map((s) => (
            <Badge key={s} tone="neutral">
              {s}
            </Badge>
          ))}
        </View>
      ) : null}
      {p.targetClientGroups.length + p.primaryTrainingGoals.length > 0 ? (
        <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
          {[...p.targetClientGroups.map((g) => labelOf(TARGET_OPTIONS, g)), ...p.primaryTrainingGoals.map((g) => labelOf(GOAL_OPTIONS, g))].join(" · ")}
        </Text>
      ) : null}
      <View className="gap-0.5">
        <Text className="font-body text-xs text-muted-foreground">
          {`${live.length} gói đang bán${fromPerSession != null ? ` · từ ${formatVND(fromPerSession)}/buổi` : ""}`}
        </Text>
        <Text className="font-body text-xs text-muted-foreground">{`${listing.published.photos.length} ảnh hình thể`}</Text>
      </View>
    </Card>
  );
}

