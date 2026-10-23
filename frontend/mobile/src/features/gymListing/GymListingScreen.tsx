import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, ChevronRight, Eye, Lock, ListChecks, RefreshCw } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, ScreenHeader, Tappable, useToast } from "../../components/ui";
import { useApp } from "../../context/AppContext";
import { pickImages, type PickedFile } from "../../lib/pickFile";
import { gymListingService, gymService, ownerAmenityService, uploadGymListingPhoto } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { designTokens } from "../../theme/colors";
import { branchAddress, branchName, branchStatus, ownedGyms, staffRoleOf, type OwnedGym } from "../gymOwner/gymOwner";
import { PhotosSection as PhotosEditor, SectionTitle } from "../ptListing/ListingSections";
import type { ListingPhoto } from "../ptListing/ptListing";
import { TextArea } from "../plans/PlanWidgets";
import { AmenityBadgeGroups, AmenityChips, AmenityHeader, DisabledAmenityBlock, ProposalsBlock, ProposeAmenitySheet, type ProposalValues } from "./AmenityWidgets";
import { GymListingPreviewPanel } from "./GymListingPreview";
import type { UploadEntry } from "../ptListing/ListingSections";
import {
  DEFAULT_GYM_LIMITS,
  DESCRIPTION_MAX,
  GYM_LISTING_ERROR_VI,
  MAX_PHOTO_BYTES,
  PREVIEW_STALE_MS,
  addPhoto,
  amenityPool,
  branchAvailability,
  buildGymDraftPayload,
  copyableRejected,
  decideDraftSync,
  disabledAmenityNotices,
  disabledAmenitiesOf,
  formFromGymPayload,
  gymFormSignature,
  gymListingErrorMessage,
  gymListingInvalidationKeys,
  gymListingKey,
  gymListingPreviewKey,
  gymListingStatusView,
  gymPayloadSignature,
  gymRevisionFromResponse,
  interpretProposeResponse,
  isAmenityDisabled,
  isAmenitiesRequired,
  isDraftStale,
  isListingStale,
  movePhoto,
  needsReload,
  normalizeCatalog,
  normalizeGymListing,
  normalizeGymPreview,
  ownerAmenitiesKey,
  photoLimitMessage,
  photoRoom,
  proposeOutcomeMessage,
  proposalsOfGym,
  removePhoto,
  selectableAmenities,
  setCover,
  staleGymRevisionOf,
  toggleId,
  validateGymForm,
  versionAfterPhotoDelete,
  type Amenity,
  type DisabledAmenityNotice,
  type GymForm,
  type GymListingView,
  type GymPhotoView,
  type GymRevision,
  type Proposal,
} from "./gymListing";

type StoredUpload = UploadEntry & { file: PickedFile };

const asListingPhoto = (p: GymPhotoView): ListingPhoto => ({ ...p, url: p.url ?? "" });

/**
 * Gym Owner "Tin đăng & tiện ích": pick a branch, then edit its public listing (description, amenities, photos) as ONE screen.
 *
 * Nothing the owner changes reaches clients directly: edits go into a DRAFT, the draft is sent for review, an admin
 * approves / rejects / asks for changes. While it waits, clients keep seeing the published listing. The state machine and
 * every limit live on the server; this screen only mirrors it. Only the OWNER reaches it (a manager gets 403 from the server,
 * and never sees the entry).
 */
export function GymListingScreen({ initialGymId }: { initialGymId?: string | null }) {
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const [gymId, setGymId] = useState<string | null>(initialGymId ?? null);

  const statusQuery = useQuery({ queryKey: ["partner-onboarding-status", uid], queryFn: () => gymService.getOnboardingStatus() });
  const gymsQuery = useQuery({ queryKey: ["owned-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const role = staffRoleOf(statusQuery.data);
  const gyms = ownedGyms(gymsQuery.data);
  const selected = gymId ? gyms.find((g) => g.id === gymId) ?? null : null;

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/gym-owner/gyms"));

  if (statusQuery.isLoading || gymsQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Tin đăng & tiện ích" onBack={leave} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      </View>
    );
  }

  // The server answers 403 to anyone but the OWNER; say so up front instead of showing a screen that only refuses.
  if (role !== "OWNER") {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Tin đăng & tiện ích" onBack={leave} />
        <EmptyState
          icon={Lock}
          title="Chỉ chủ sở hữu quản lý tin đăng"
          description="Tin đăng và tiện ích của chi nhánh do chủ thương hiệu chỉnh sửa. Tài khoản của bạn không có quyền này."
        />
      </View>
    );
  }

  if (selected && branchAvailability(selected).editable) {
    return <GymListingEditor key={selected.id} gym={selected} onBack={leave} onChangeBranch={() => setGymId(null)} />;
  }

  return <BranchPicker gyms={gyms} error={gymsQuery.isError} requested={gymId} onPick={setGymId} onBack={leave} onRetry={() => void gymsQuery.refetch()} />;
}

// ── branch picker ───────────────────────────────────────────────────────────────────────────────
function BranchPicker({
  gyms,
  error,
  requested,
  onPick,
  onBack,
  onRetry,
}: {
  gyms: OwnedGym[];
  error: boolean;
  requested: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const requestedGym = requested ? gyms.find((g) => g.id === requested) : null;
  const requestedBlocked = requestedGym ? branchAvailability(requestedGym) : null;
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Tin đăng & tiện ích" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 12 }}>
        <Text className="font-body text-sm leading-5 text-muted-foreground">
          Chọn chi nhánh để sửa giới thiệu, tiện ích và ảnh. Thay đổi chỉ hiển thị với khách sau khi Gymini duyệt.
        </Text>
        {requestedGym && requestedBlocked && !requestedBlocked.editable ? (
          <Card className="flex-row items-start gap-2 border-warning/30 bg-warning/5 p-3">
            <AlertTriangle size={14} color={designTokens.warning} />
            <Text className="min-w-0 flex-1 font-body text-xs leading-5 text-muted-foreground">{`${branchName(requestedGym)}: ${requestedBlocked.reason}`}</Text>
          </Card>
        ) : null}
        {error ? (
          <EmptyState icon={AlertTriangle} title="Không tải được danh sách chi nhánh" description="Kiểm tra kết nối rồi thử lại." actionLabel="Thử lại" onAction={onRetry} />
        ) : gyms.length === 0 ? (
          <EmptyState icon={Building2} title="Chưa có chi nhánh nào" description="Thêm chi nhánh ở mục Phòng gym trước." />
        ) : (
          gyms.map((g) => {
            const av = branchAvailability(g);
            const st = branchStatus(g.status);
            return (
              <Tappable
                key={g.id}
                disabled={!av.editable}
                accessibilityLabel={`${branchName(g)}${av.editable ? "" : " (chưa sửa được)"}`}
                onPress={() => onPick(g.id)}
                className={av.editable ? "" : "opacity-60"}
              >
                <Card className="gap-1.5 p-4">
                  <View className="flex-row items-center gap-2">
                    <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                      {branchName(g)}
                    </Text>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {av.editable ? <ChevronRight size={16} color={accent.primary} /> : null}
                  </View>
                  <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                    {branchAddress(g)}
                  </Text>
                  {av.reason ? <Text className="font-body text-xs leading-5 text-warning">{av.reason}</Text> : null}
                </Card>
              </Tappable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ── editor for one branch ───────────────────────────────────────────────────────────────────────
function GymListingEditor({ gym, onBack, onChangeBranch }: { gym: OwnedGym; onBack: () => void; onChangeBranch: () => void }) {
  const gymId = gym.id;
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const listingQuery = useQuery({
    queryKey: gymListingKey(uid, gymId),
    queryFn: async () => normalizeGymListing(await gymListingService.get(gymId)),
    staleTime: 0,
    retry: false,
  });
  const catalogQuery = useQuery({
    queryKey: ownerAmenitiesKey(uid),
    queryFn: async () => normalizeCatalog(await ownerAmenityService.catalog()),
  });
  const listing = listingQuery.data;
  const open = listing?.openRevision ?? null;
  const draft = open && open.status === "DRAFT" ? open : null;
  const limits = listing?.limits ?? DEFAULT_GYM_LIMITS;
  const status = listing ? gymListingStatusView(listing) : null;

  // ── editor state. Refs are authoritative (an `await` between two taps must see the latest), the state copies exist only to re-render.
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

  // Keep the form in step with what the server holds, without ever replacing unsaved edits silently.
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
      askDraftStale(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.draftVersion]);

  const dirty = !!form && gymFormSignature(form) !== baseline;

  // ── small plumbing ─────────────────────────────────────────────────────────────────────────
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
    for (const key of gymListingInvalidationKeys(uid, gymId)) void queryClient.invalidateQueries({ queryKey: key as unknown[] });
  };
  const setOpenRevision = (rev: GymRevision | null) =>
    queryClient.setQueryData<GymListingView>(gymListingKey(uid, gymId), (old) => (old ? { ...old, openRevision: rev } : old));

  /** STAGED photo links live ~15 min; an <Image> that fails asks for fresh ones, at most every 20 s. */
  const lastImageRefresh = useRef(0);
  const onImageError = useCallback(() => {
    const now = Date.now();
    if (now - lastImageRefresh.current < 20_000) return;
    lastImageRefresh.current = now;
    void queryClient.invalidateQueries({ queryKey: gymListingKey(uid, gymId) });
    void queryClient.invalidateQueries({ queryKey: gymListingPreviewKey(uid, gymId) });
  }, [queryClient, uid, gymId]);

  // ── conflicts (409) ────────────────────────────────────────────────────────────────────────
  /** DRAFT_STALE: the draft on the server is newer than the one this phone edited. The owner decides. */
  function askDraftStale(serverRev: GymRevision | null) {
    Alert.alert("Bản nháp đã thay đổi", `${GYM_LISTING_ERROR_VI.DRAFT_STALE} Bạn muốn tải bản mới nhất hay ghi đè bằng bản đang sửa?`, [
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
          void overwriteWith(serverRev);
        },
      },
    ]);
  }

  async function overwriteWith(serverRev: GymRevision | null) {
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
    Alert.alert("Tin đăng đã thay đổi", `${GYM_LISTING_ERROR_VI.LISTING_STALE} Hãy cập nhật bản nháp theo tin đăng mới (nội dung bạn soạn được giữ lại) rồi gửi duyệt.`, [
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
      askDraftStale(staleGymRevisionOf(e));
      return;
    }
    if (isListingStale(e)) {
      askListingStale();
      return;
    }
    toast.show(gymListingErrorMessage(e, fallback), "danger");
    if (needsReload(e)) {
      const rev = staleGymRevisionOf(e);
      if (rev) setOpenRevision(rev.status === "DRAFT" || rev.status === "PENDING" ? rev : null);
      void listingQuery.refetch();
    }
  }

  // ── actions ────────────────────────────────────────────────────────────────────────────────
  /** Saves the form. Returns the new draftVersion, or null when nothing was saved. */
  async function saveNow(versionOverride?: number): Promise<number | null> {
    const current = formRef.current;
    if (!current) return null;
    const problem = validateGymForm(current, limits);
    if (problem) {
      toast.show(problem, "danger");
      return null;
    }
    try {
      const res = await gymListingService.saveDraft(gymId, {
        expectedDraftVersion: versionOverride ?? versionRef.current,
        payload: buildGymDraftPayload(current) as unknown as Record<string, unknown>,
      });
      const rev = gymRevisionFromResponse(res);
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
      if (isAmenityDisabled(e)) {
        askDropDisabled(e, false);
        return null;
      }
      handleWriteError(e, "Không lưu được bản nháp");
      return null;
    }
  }

  /** AMENITY_DISABLED (422 on save, 409 on submit): an amenity was switched off in the catalogue — offer "Bỏ và gửi lại". */
  function askDropDisabled(e: unknown, thenSubmit: boolean) {
    const items = disabledAmenitiesOf(e);
    const names = items.map((i) => i.name).filter(Boolean).join(", ");
    Alert.alert("Có tiện ích đã ngừng", `${names ? `${names} ` : "Một số tiện ích "}đã bị tắt trong danh mục. Bỏ chúng khỏi bản sửa${thenSubmit ? " rồi gửi duyệt lại" : ""}?`, [
      { text: "Để tôi xem lại", style: "cancel" },
      {
        text: thenSubmit ? "Bỏ và gửi lại" : "Bỏ tiện ích đã ngừng",
        onPress: () => {
          const drop = new Set(items.map((i) => i.id));
          updateForm((f) => ({ ...f, amenityIds: f.amenityIds.filter((id) => !drop.has(id)) }));
          void run(thenSubmit ? "submit" : "save", async () => {
            const saved = await saveNow();
            if (saved == null) return;
            if (thenSubmit) await doSubmit(saved);
          });
        },
      },
    ]);
  }

  const onSave = () =>
    run("save", async () => {
      const v = await saveNow();
      if (v != null) toast.show("Đã lưu bản nháp", "success");
    });

  async function doRebase() {
    let v = versionRef.current;
    if (formRef.current && gymFormSignature(formRef.current) !== baselineRef.current) {
      const saved = await saveNow();
      if (saved == null) return;
      v = saved;
    }
    try {
      const res = await gymListingService.rebase(gymId, { expectedDraftVersion: v });
      const rev = gymRevisionFromResponse(res);
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
        const res = await gymListingService.createDraft(gymId, copyFromRevisionId ? { copyFromRevisionId } : {});
        const rev = gymRevisionFromResponse(res);
        if (rev) {
          hydrate(rev);
          setOpenRevision(rev);
        }
        invalidateAll();
      } catch (e) {
        handleWriteError(e, "Không tạo được bản nháp");
      }
    });

  async function doSubmit(version: number) {
    try {
      await gymListingService.submit(gymId, { expectedDraftVersion: version });
      invalidateAll();
      toast.show("Đã gửi duyệt — chúng tôi sẽ báo khi có kết quả.", "success");
    } catch (e) {
      if (isAmenityDisabled(e)) {
        askDropDisabled(e, true);
        return;
      }
      if (isAmenitiesRequired(e)) {
        toast.show(GYM_LISTING_ERROR_VI.AMENITIES_REQUIRED, "danger");
        return;
      }
      handleWriteError(e, "Không gửi duyệt được");
    }
  }

  const askSubmit = () => {
    const current = formRef.current;
    if (!current) return;
    const problem = validateGymForm(current, limits, true);
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
              if (formRef.current && gymFormSignature(formRef.current) !== baselineRef.current) {
                const saved = await saveNow();
                if (saved == null) return;
                v = saved;
              }
              await doSubmit(v);
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
              const res = await gymListingService.withdraw(gymId);
              const rev = gymRevisionFromResponse(res);
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
              await gymListingService.discard(gymId);
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

  // ── preview ────────────────────────────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewQuery = useQuery({
    queryKey: gymListingPreviewKey(uid, gymId),
    queryFn: async () => {
      const view = normalizeGymPreview(await gymListingService.preview(gymId));
      if (!view) throw new Error("preview");
      return view;
    },
    enabled: previewOpen && !!open,
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

  // ── amenities & proposals ──────────────────────────────────────────────────────────────────
  const pool = useMemo(() => amenityPool(catalogQuery.data?.amenities ?? [], listing?.amenities ?? []), [catalogQuery.data?.amenities, listing?.amenities]);
  const chips: Amenity[] = useMemo(() => selectableAmenities(pool, form?.amenityIds ?? []), [pool, form?.amenityIds]);
  const myProposals: Proposal[] = useMemo(() => {
    // The catalogue answer knows every status; the listing answer only the PENDING ones. Prefer the catalogue's copy.
    const byId = new Map<string, Proposal>();
    for (const p of [...(listing?.proposals ?? []), ...(catalogQuery.data?.proposals ?? [])]) byId.set(p.id, p);
    return proposalsOfGym([...byId.values()], gymId);
  }, [listing?.proposals, catalogQuery.data?.proposals, gymId]);
  const disabledNotices = listing ? disabledAmenityNotices(listing) : [];

  const [proposalSheet, setProposalSheet] = useState<{ mode: "create" } | { mode: "edit"; proposal: Proposal } | null>(null);
  const [proposalPending, setProposalPending] = useState(false);

  const refreshAmenities = () => {
    void queryClient.invalidateQueries({ queryKey: ownerAmenitiesKey(uid) });
    void queryClient.invalidateQueries({ queryKey: gymListingKey(uid, gymId) });
  };

  /** Sends a proposal and applies the answer (plan §12.3): matched → select it; a proposal → put it in the draft. */
  const sendProposal = async (v: { name: string; suggestedCategory: ProposalValues["suggestedCategory"]; note?: string }) => {
    setProposalPending(true);
    try {
      const res = await ownerAmenityService.propose({ gymId, name: v.name, suggestedCategory: v.suggestedCategory, ...(v.note ? { note: v.note } : {}) });
      const outcome = interpretProposeResponse(res);
      if (!outcome) throw new Error("Phản hồi không hợp lệ");
      if (outcome.kind === "matched") {
        updateForm((f) => (f.amenityIds.includes(outcome.amenity.id) ? f : { ...f, amenityIds: [...f.amenityIds, outcome.amenity.id] }));
      } else {
        updateForm((f) => (f.proposalIds.includes(outcome.proposal.id) ? f : { ...f, proposalIds: [...f.proposalIds, outcome.proposal.id] }));
      }
      toast.show(proposeOutcomeMessage(outcome), "success");
      refreshAmenities();
      setProposalSheet(null);
    } catch (e) {
      toast.show(gymListingErrorMessage(e, "Không gửi được đề xuất"), "danger");
    } finally {
      setProposalPending(false);
    }
  };

  const submitProposalSheet = async (v: ProposalValues) => {
    if (proposalSheet?.mode === "edit") {
      const p = proposalSheet.proposal;
      setProposalPending(true);
      try {
        await ownerAmenityService.updateProposal(p.id, { name: v.name, suggestedCategory: v.suggestedCategory, note: v.note || null });
        toast.show("Đã cập nhật đề xuất", "success");
        refreshAmenities();
        setProposalSheet(null);
      } catch (e) {
        toast.show(gymListingErrorMessage(e, "Không sửa được đề xuất"), "danger");
        refreshAmenities();
      } finally {
        setProposalPending(false);
      }
      return;
    }
    await sendProposal(v);
  };

  const reenable = (item: DisabledAmenityNotice) =>
    run("reenable", async () => {
      await sendProposal({ name: item.name, suggestedCategory: item.category });
    });

  const askCancelProposal = (p: Proposal) =>
    Alert.alert("Huỷ đề xuất?", `Đề xuất "${p.name}" sẽ bị huỷ và bỏ khỏi bản nháp.`, [
      { text: "Giữ lại", style: "cancel" },
      {
        text: "Huỷ đề xuất",
        style: "destructive",
        onPress: () => {
          void run("cancel-proposal", async () => {
            try {
              await ownerAmenityService.cancelProposal(p.id);
              // The server takes it out of the SAVED draft and bumps draftVersion by one, like deleting a saved photo.
              if (draft?.payload.proposalIds.includes(p.id)) versionRef.current += 1;
              updateForm((f) => ({ ...f, proposalIds: f.proposalIds.filter((x) => x !== p.id) }));
              refreshAmenities();
              toast.show("Đã huỷ đề xuất", "success");
            } catch (e) {
              toast.show(gymListingErrorMessage(e, "Không huỷ được đề xuất"), "danger");
              refreshAmenities();
            }
          });
        },
      },
    ]);

  // ── photos ─────────────────────────────────────────────────────────────────────────────────
  const [uploads, setUploads] = useState<StoredUpload[]>([]);
  const [extraPhotos, setExtraPhotos] = useState<Record<string, ListingPhoto>>({});
  const uploadSeq = useRef(0);

  const photoMap = useMemo(() => {
    const map = new Map<string, ListingPhoto>();
    for (const p of listing?.photos ?? []) map.set(p.id, asListingPhoto(p));
    for (const p of Object.values(extraPhotos)) if (!map.has(p.id)) map.set(p.id, p);
    return map;
  }, [listing?.photos, extraPhotos]);

  const unused = useMemo(
    () => (listing?.photos ?? []).filter((p) => p.status === "STAGED" && !(form?.photoIds ?? []).includes(p.id)).map(asListingPhoto),
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
      const res = await uploadGymListingPhoto(gymId, file);
      const photo = { id: res.photo.id, status: res.photo.status, url: res.photo.url ?? "", expiresAt: res.photo.expiresAt, isCover: res.photo.isCover, sortOrder: res.photo.sortOrder };
      setUploads((prev) => prev.filter((u) => u.key !== key));
      setExtraPhotos((prev) => ({ ...prev, [photo.id]: photo }));
      attachPhoto(photo.id);
      void queryClient.invalidateQueries({ queryKey: gymListingKey(uid, gymId) });
    } catch (e) {
      const message = gymListingErrorMessage(e, "Không tải được ảnh. Hãy thử lại.");
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
    Alert.alert("Xóa ảnh này?", "Ảnh chưa công khai sẽ bị xóa hẳn khỏi chi nhánh.", [
      { text: "Không", style: "cancel" },
      {
        text: "Xóa ảnh",
        style: "destructive",
        onPress: () => {
          void run("delete-photo", async () => {
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
              toast.show("Đã xóa ảnh", "success");
            } catch (e) {
              toast.show(gymListingErrorMessage(e, "Không xóa được ảnh"), "danger");
              void listingQuery.refetch();
            }
          });
        },
      },
    ]);

  // ── render ─────────────────────────────────────────────────────────────────────────────────
  const back = () => {
    if (!dirty) return onBack();
    Alert.alert("Rời khỏi mà chưa lưu?", "Các chỉnh sửa chưa lưu trong bản nháp sẽ mất.", [
      { text: "Ở lại", style: "cancel" },
      { text: "Rời đi", style: "destructive", onPress: onBack },
    ]);
  };
  const changeBranch = () => {
    if (!dirty) return onChangeBranch();
    Alert.alert("Đổi chi nhánh mà chưa lưu?", "Các chỉnh sửa chưa lưu trong bản nháp sẽ mất.", [
      { text: "Ở lại", style: "cancel" },
      { text: "Đổi chi nhánh", style: "destructive", onPress: onChangeBranch },
    ]);
  };
  const rejectedCopy = listing ? copyableRejected(listing.history) : null;
  const editing = !!draft && !!form;
  const pendingReview = open?.status === "PENDING";
  const title = branchName(gym);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={title} onBack={back} />

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
            description={gymListingErrorMessage(listingQuery.error, "Kiểm tra kết nối rồi kéo xuống để thử lại.")}
            actionLabel="Thử lại"
            onAction={() => void listingQuery.refetch()}
          />
          <Button full variant="ghost" onPress={onChangeBranch}>
            Chọn chi nhánh khác
          </Button>
        </ScrollView>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: editing ? 24 : insets.bottom + 32 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={listingQuery.isRefetching && !busy} onRefresh={() => void listingQuery.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
            }
          >
            <View className="gap-4">
              <Tappable accessibilityLabel="Đổi chi nhánh" onPress={changeBranch} className="self-start">
                <Text className="font-body-semibold text-xs text-primary">Đổi chi nhánh</Text>
              </Tappable>

              {/* ── status ───────────────────────────────────────────────────────────── */}
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
                <DisabledAmenityBlock items={disabledNotices} proposals={myProposals} busy={!!busy || proposalPending} onReenable={(it) => void reenable(it)} />
                {status.stale && !pendingReview ? (
                  <View className="gap-2 rounded-xl border border-border bg-panel p-3">
                    <Text className="font-body text-xs leading-5 text-muted-foreground">{`${GYM_LISTING_ERROR_VI.LISTING_STALE} Cập nhật để bản nháp dựa trên tin đăng mới nhất.`}</Text>
                    <Button size="sm" variant="secondary" icon={RefreshCw} disabled={!!busy} onPress={() => void run("rebase", doRebase)}>
                      Cập nhật theo bản mới
                    </Button>
                  </View>
                ) : null}

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
                {pendingReview ? (
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

              {/* ── published ────────────────────────────────────────────────────────── */}
              <PublishedSummary listing={listing} />

              {/* ── draft editor ─────────────────────────────────────────────────────── */}
              {editing && form ? (
                <>
                  <Card className="gap-3 p-4">
                    <SectionTitle>Giới thiệu chi nhánh</SectionTitle>
                    <TextArea
                      value={form.description}
                      onChangeText={(v) => updateForm((f) => ({ ...f, description: v }))}
                      placeholder="Không gian, thiết bị, lớp tập, đội ngũ huấn luyện viên…"
                      rows={4}
                    />
                    <Text className={`font-body text-[11px] ${form.description.trim().length > DESCRIPTION_MAX ? "text-destructive" : "text-muted-foreground"}`}>
                      {`${form.description.trim().length}/${DESCRIPTION_MAX} ký tự`}
                    </Text>
                  </Card>

                  <Card className="gap-3 p-4">
                    <SectionTitle>Tiện ích & dịch vụ</SectionTitle>
                    <AmenityHeader form={form} disabled={!!busy || proposalPending} onPropose={() => setProposalSheet({ mode: "create" })} />
                    <AmenityChips
                      amenities={chips}
                      selectedIds={form.amenityIds}
                      onToggle={(id) => updateForm((f) => ({ ...f, amenityIds: toggleId(f.amenityIds, id) }))}
                      disabled={!!busy}
                    />
                    <ProposalsBlock
                      proposals={myProposals}
                      attachedIds={form.proposalIds}
                      editable
                      busy={!!busy || proposalPending}
                      onToggleAttach={(id) => updateForm((f) => ({ ...f, proposalIds: toggleId(f.proposalIds, id) }))}
                      onEdit={(p) => setProposalSheet({ mode: "edit", proposal: p })}
                      onCancel={askCancelProposal}
                    />
                  </Card>

                  <Card className="gap-3 p-4">
                    <SectionTitle>Ảnh chi nhánh</SectionTitle>
                    <PhotosEditor
                      ids={form.photoIds}
                      cover={form.coverPhotoId}
                      photos={photoMap}
                      unused={unused}
                      max={limits.maxPhotos}
                      uploads={uploads}
                      busy={!!busy}
                      noun="Ảnh chi nhánh"
                      coverHint="Ảnh bìa hiện trên thẻ chi nhánh khi khách tìm phòng gym."
                      emptyHint="Chưa có ảnh nào. Ảnh thật của không gian tập giúp khách tin tưởng hơn."
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

              {pendingReview && open ? (
                <Card className="gap-3 p-4">
                  <SectionTitle>Bản sửa đang chờ duyệt</SectionTitle>
                  <Text className="font-body text-xs leading-5 text-muted-foreground">
                    {`${open.payload.amenityIds.length + open.payload.proposalIds.length} tiện ích · ${open.payload.photoIds.length} ảnh. Rút lại bản sửa nếu muốn chỉnh tiếp.`}
                  </Text>
                  <ProposalsBlock
                    proposals={myProposals}
                    attachedIds={open.payload.proposalIds}
                    editable={false}
                    busy
                    onToggleAttach={() => undefined}
                    onEdit={() => undefined}
                    onCancel={() => undefined}
                  />
                </Card>
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
        <GymListingPreviewPanel
          loading={previewQuery.isLoading}
          error={previewQuery.isError ? gymListingErrorMessage(previewQuery.error, "Không tải được bản xem trước.") : null}
          preview={previewQuery.data ?? null}
          onRetry={() => void previewQuery.refetch()}
          onImageError={onImageError}
        />
      </BottomSheet>

      <ProposeAmenitySheet
        open={proposalSheet !== null}
        onClose={() => setProposalSheet(null)}
        title={proposalSheet?.mode === "edit" ? "Sửa đề xuất" : "Đề xuất tiện ích mới"}
        submitLabel={proposalSheet?.mode === "edit" ? "Lưu đề xuất" : "Gửi đề xuất"}
        initial={
          proposalSheet?.mode === "edit"
            ? { name: proposalSheet.proposal.name, suggestedCategory: proposalSheet.proposal.suggestedCategory, note: proposalSheet.proposal.note ?? "" }
            : undefined
        }
        pending={proposalPending}
        onSubmit={(v) => void submitProposalSheet(v)}
      />
    </View>
  );
}

/** "Đang hiển thị với khách" — the published listing in a few lines (the full thing is one Xem trước away). */
function PublishedSummary({ listing }: { listing: GymListingView }) {
  const accent = useWorkspaceAccent();
  const p = listing.published.payload;
  const byId = new Map(listing.amenities.map((a) => [a.id, a]));
  const shown = p.amenityIds.map((id) => byId.get(id)).filter((a): a is Amenity => !!a && a.status === "ACTIVE");
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
      {p.description ? (
        <Text className="font-body text-sm leading-5 text-foreground" numberOfLines={3}>
          {p.description}
        </Text>
      ) : (
        <Text className="font-body text-sm text-muted-foreground">Chưa có phần giới thiệu.</Text>
      )}
      {shown.length > 0 ? <AmenityBadgeGroups amenities={shown} grouped={false} /> : <Text className="font-body text-xs text-muted-foreground">Chưa có tiện ích nào.</Text>}
      <Text className="font-body text-xs text-muted-foreground">{`${listing.published.photos.length} ảnh`}</Text>
    </Card>
  );
}
