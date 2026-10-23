import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftIcon, CheckCircleIcon, NotePencilIcon, PencilSimpleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { adminListingService, type GymListingPreviewDto } from "../../../services/ptListingApi";
import type { AdminGymRevisionDetail, AdminPtRevisionDetail, ListingPhoto, PtListingPreview } from "../../../types";
import { PageSkeleton } from "../../../components/ui/PageSkeleton";
import { ErrorState } from "../../../components/ui/ErrorState";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Button } from "../../../components/ui/button";
import { ListingDiffView } from "../../../components/listing/ListingDiffView";
import { GymPreviewCard, PtPreviewCard, PreviewNotice } from "../../../components/listing/ListingPreviewCards";
import { ReasonDialog } from "../../../components/listing/ReasonDialog";
import { buildGymDiffRows, buildPtDiffRows } from "../../../utils/listingDiff";
import { buildGymApproveBody, noteRequiredError, revisionSourceLabel, revisionStatusView } from "../../../utils/adminListing";
import { gymPhotoPublicPath, ptPhysiquePublicPath } from "../../../utils/listingMedia";
import { listingErrorMessage, readApproveBlock, type ApproveBlock } from "../../../utils/listingErrors";
import { handleAdminError, previewKey, refreshAdminListings, revisionKey, type ListingKind } from "./adminListingShared";
import { RevisionHistory } from "./RevisionHistory";
import { DirectEditDialog, gymSourceFromRevision, ptSourceFromRevision } from "./DirectEditDialog";

type View = "changes" | "preview" | "history";
const VIEWS: { key: View; label: string }[] = [
  { key: "changes", label: "Thay đổi" },
  { key: "preview", label: "Xem trước" },
  { key: "history", label: "Lịch sử" },
];

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Drill-down of one revision: the field-by-field diff against what is public right now, the preview, the history
 * of the listing, and the actions — approve / reject (note required) / request changes (note required) / direct edit.
 * Only a PENDING revision can be decided; every 409 (already decided, listing moved…) toasts a Vietnamese sentence and re-fetches.
 */
export function RevisionDetail({ kind, rid, onBack, onOpenProposals }: { kind: ListingKind; rid: string; onBack: () => void; onOpenProposals: () => void }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("changes");
  const [dialog, setDialog] = useState<null | "approve" | "reject" | "changes" | "edit">(null);
  const [dropDisabled, setDropDisabled] = useState(false);
  const [dropRejected, setDropRejected] = useState(false);
  const [block, setBlock] = useState<ApproveBlock | null>(null);

  const detailQuery = useQuery<AdminPtRevisionDetail | AdminGymRevisionDetail>({
    queryKey: revisionKey(kind, rid),
    queryFn: () => (kind === "pts" ? adminListingService.getPtRevision(rid) : adminListingService.getGymRevision(rid)),
    staleTime: 0,
  });
  const detail = detailQuery.data;
  const status = detail?.revision.status;
  const isPending = status === "PENDING";

  const previewQuery = useQuery<PtListingPreview | GymListingPreviewDto | null>({
    queryKey: previewKey(kind, rid),
    queryFn: () => (kind === "pts" ? adminListingService.previewPtRevision(rid) : adminListingService.previewGymRevision(rid)),
    enabled: view === "preview",
    staleTime: 60_000,
  });

  const model = useMemo(() => {
    if (!detail) return null;
    const closedApproved = detail.revision.status === "APPROVED" && detail.changesAtDecision;
    const changes = closedApproved ? detail.changesAtDecision! : detail.changes;
    const photos = new Map<string, ListingPhoto>(detail.photos.map((p) => [p.id, p]));
    const fallback = kind === "pts" ? ptPhysiquePublicPath : gymPhotoPublicPath;
    const photoUrlOf = (id: string) => photos.get(id)?.url ?? fallback(id);
    if (kind === "pts") {
      const d = detail as AdminPtRevisionDetail;
      const pkgName = new Map((d.published?.packages ?? []).map((p) => [p.id ?? "", p.name]));
      return {
        title: [d.pt?.firstName, d.pt?.lastName].filter(Boolean).join(" ") || "Huấn luyện viên",
        subtitle: "Tin đăng huấn luyện viên",
        listingId: d.revision.ptUserId,
        listingVersion: d.pt?.listingVersion ?? null,
        rows: buildPtDiffRows(changes, { packageNameOf: (id) => pkgName.get(id) ?? null }),
        photoUrlOf,
        flags: undefined,
      };
    }
    const d = detail as AdminGymRevisionDetail;
    const amenityName = new Map(d.amenities.map((a) => [a.id, a.name]));
    const proposalName = new Map(d.proposals.map((p) => [p.id, p.name]));
    return {
      title: d.gym.name,
      subtitle: "Tin đăng chi nhánh",
      listingId: d.gym.id,
      listingVersion: d.gym.listingVersion,
      rows: buildGymDiffRows(changes, { amenityName: (id) => amenityName.get(id) ?? null, proposalName: (id) => proposalName.get(id) ?? null }),
      photoUrlOf,
      flags: d.flags,
    };
  }, [detail, kind]);

  const gymDetail = kind === "gyms" ? (detail as AdminGymRevisionDetail | undefined) : undefined;
  const hasDeadProposal = !!gymDetail?.proposals.some((p) => p.status === "REJECTED" || p.status === "CANCELLED");

  const afterDecision = () => {
    setDialog(null);
    setBlock(null);
    refreshAdminListings(queryClient);
  };

  const approve = useMutation({
    mutationFn: (note: string) =>
      kind === "pts"
        ? adminListingService.approvePt(rid, note)
        : adminListingService.approveGym(rid, buildGymApproveBody({ note, dropDisabledAmenities: dropDisabled, dropRejectedAmenities: dropRejected })),
    onSuccess: () => {
      toast.success("Đã duyệt bản sửa — tin đăng đã được cập nhật.");
      afterDecision();
    },
    onError: (e) => {
      const b = readApproveBlock(e);
      if (b) {
        // Not a failure of the click: the revision needs a choice first. Keep the dialog, explain, show the option.
        setBlock(b);
        toast.error(listingErrorMessage(e));
        if (b === "AMENITY_DISABLED") setDropDisabled(true);
        if (b === "AMENITY_PROPOSAL_DEAD") setDropRejected(true);
        refreshAdminListings(queryClient);
        if (b === "CUSTOM_AMENITY_PENDING") setDialog(null);
        return;
      }
      setDialog(null);
      handleAdminError(e, queryClient, "Không duyệt được bản sửa");
    },
  });
  const reject = useMutation({
    mutationFn: (note: string) => (kind === "pts" ? adminListingService.rejectPt(rid, note) : adminListingService.rejectGym(rid, note)),
    onSuccess: () => {
      toast.success("Đã từ chối bản sửa");
      afterDecision();
    },
    onError: (e) => {
      setDialog(null);
      handleAdminError(e, queryClient, "Không từ chối được bản sửa");
    },
  });
  const requestChanges = useMutation({
    mutationFn: (note: string) => (kind === "pts" ? adminListingService.requestChangesPt(rid, note) : adminListingService.requestChangesGym(rid, note)),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu chỉnh sửa cho chủ tin");
      afterDecision();
    },
    onError: (e) => {
      setDialog(null);
      handleAdminError(e, queryClient, "Không gửi được yêu cầu chỉnh sửa");
    },
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeftIcon /> Quay lại hàng đợi</Button>
        <PageSkeleton variant="list" rows={4} />
      </div>
    );
  }
  if (detailQuery.isError || !detail || !model) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeftIcon /> Quay lại hàng đợi</Button>
        <ErrorState kind="not-found" message={listingErrorMessage(detailQuery.error, "Không tải được bản sửa này.")} onRetry={() => void detailQuery.refetch()} />
      </div>
    );
  }

  const s = revisionStatusView(detail.revision.status);
  const proposalBlocked = kind === "gyms" && (model.flags?.hasPendingProposal ?? false);
  const editSource = kind === "pts" ? ptSourceFromRevision(detail as AdminPtRevisionDetail) : gymSourceFromRevision(detail as AdminGymRevisionDetail);
  const canEdit = !!editSource;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeftIcon /> Quay lại hàng đợi</Button>

      <header className="space-y-2 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-zinc-100">{model.title}</h2>
          <StatusBadge label={s.label} tone={s.tone} size="md" />
        </div>
        <p className="text-xs text-zinc-500">
          {model.subtitle} · {revisionSourceLabel(detail.revision.source)}
          {detail.revision.submittedAt ? ` · gửi lúc ${when(detail.revision.submittedAt)}` : ""}
        </p>
        {detail.stale && isPending && (
          <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200" role="status">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
            Tin đăng công khai đã thay đổi sau khi bản sửa này được gửi. Nếu duyệt, hệ thống sẽ không áp bản này mà chuyển nó thành bản nháp mới cho chủ tin.
          </div>
        )}
        {detail.revision.ownerNote && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3 text-sm text-zinc-300"><span className="text-xs font-semibold text-zinc-500">Ghi chú của chủ tin: </span>{detail.revision.ownerNote}</p>
        )}
        {detail.revision.reviewNote && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3 text-sm text-zinc-300"><span className="text-xs font-semibold text-zinc-500">Ghi chú của quản trị viên: </span>{detail.revision.reviewNote}</p>
        )}
        {detail.revision.adminReason && (
          <p className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3 text-sm text-zinc-300"><span className="text-xs font-semibold text-zinc-500">Lý do sửa trực tiếp: </span>{detail.revision.adminReason}</p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {isPending && (
            <>
              <Button disabled={proposalBlocked || approve.isPending} onClick={() => setDialog("approve")}>
                <CheckCircleIcon /> Duyệt
              </Button>
              <Button variant="outline" onClick={() => setDialog("changes")}>
                <NotePencilIcon /> Yêu cầu chỉnh sửa
              </Button>
              <Button variant="outline" className="text-red-400" onClick={() => setDialog("reject")}>
                <XCircleIcon /> Từ chối
              </Button>
            </>
          )}
          <Button variant="outline" disabled={!canEdit} onClick={() => setDialog("edit")}>
            <PencilSimpleIcon /> Sửa trực tiếp tin đăng
          </Button>
        </div>
        {isPending && proposalBlocked && (
          <p className="text-xs text-blue-300">
            Chưa duyệt được: bản sửa còn tiện ích tùy chỉnh chờ duyệt.{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={onOpenProposals}>Mở tab "Đề xuất tiện ích"</button>
          </p>
        )}
        {block === "CUSTOM_AMENITY_PENDING" && (
          <p className="text-xs text-blue-300">
            Máy chủ báo bản sửa còn tiện ích tùy chỉnh chờ duyệt.{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={onOpenProposals}>Xử lý đề xuất tiện ích</button>
          </p>
        )}
      </header>

      <div className="flex gap-1.5 border-b border-zinc-800/60 pb-2" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            onClick={() => setView(v.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${view === v.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "changes" && (
        <>
          {!isPending && detail.revision.status !== "APPROVED" && (
            <p className="text-xs text-zinc-500">Bản sửa đã đóng — so sánh với tin đăng đang hiển thị hiện nay.</p>
          )}
          <ListingDiffView rows={model.rows} photoUrlOf={model.photoUrlOf} flags={model.flags} onOpenProposals={onOpenProposals} />
        </>
      )}
      {view === "preview" &&
        (previewQuery.isLoading ? (
          <PageSkeleton variant="list" rows={2} />
        ) : previewQuery.isError || !previewQuery.data ? (
          <ErrorState kind="generic" message={listingErrorMessage(previewQuery.error, "Không tải được bản xem trước.")} onRetry={() => void previewQuery.refetch()} />
        ) : (
          <div className="space-y-2">
            {kind === "pts" ? <PtPreviewCard preview={previewQuery.data as never} /> : <GymPreviewCard preview={previewQuery.data as never} />}
            <PreviewNotice expiresAt={(previewQuery.data as { photoUrlsExpireAt?: string | null }).photoUrlsExpireAt ?? null} />
          </div>
        ))}
      {view === "history" && <RevisionHistory kind={kind} listingId={model.listingId} />}

      {/* approve: optional note (+ the gym choices the server may demand) */}
      <ReasonDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Duyệt bản sửa?"
        description="Nội dung sẽ hiển thị với khách hàng ngay sau khi duyệt."
        label="Ghi chú cho chủ tin (không bắt buộc)"
        confirmLabel="Duyệt"
        validate={() => null}
        onConfirm={async (note) => {
          await approve.mutateAsync(note).catch(() => undefined);
        }}
      >
        {kind === "gyms" && (model.flags?.hasDisabledAmenity || block === "AMENITY_DISABLED") && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm text-amber-200">
            <input type="checkbox" className="mt-1" checked={dropDisabled} onChange={(e) => setDropDisabled(e.target.checked)} />
            <span>Duyệt và bỏ tiện ích đã tắt{model.flags?.disabledAmenities.length ? `: ${model.flags.disabledAmenities.map((a) => a.name).join(", ")}` : ""}</span>
          </label>
        )}
        {kind === "gyms" && (hasDeadProposal || block === "AMENITY_PROPOSAL_DEAD") && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm text-amber-200">
            <input type="checkbox" className="mt-1" checked={dropRejected} onChange={(e) => setDropRejected(e.target.checked)} />
            <span>Duyệt và bỏ tiện ích đề xuất đã bị từ chối hoặc huỷ</span>
          </label>
        )}
      </ReasonDialog>

      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Từ chối bản sửa?"
        description="Tin đăng hiện tại giữ nguyên. Chủ tin sẽ thấy ghi chú của bạn và có thể soạn lại."
        label="Ghi chú (bắt buộc)"
        placeholder="Ví dụ: ảnh bìa không phù hợp, mô tả chứa thông tin sai…"
        confirmLabel="Từ chối"
        danger
        validate={noteRequiredError}
        onConfirm={async (note) => {
          await reject.mutateAsync(note).catch(() => undefined);
        }}
      />
      <ReasonDialog
        open={dialog === "changes"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Yêu cầu chỉnh sửa"
        description="Hệ thống tạo sẵn một bản nháp mới có nội dung của chủ tin kèm ghi chú của bạn để họ sửa và gửi lại."
        label="Cần chỉnh sửa gì? (bắt buộc)"
        confirmLabel="Gửi yêu cầu"
        validate={noteRequiredError}
        onConfirm={async (note) => {
          await requestChanges.mutateAsync(note).catch(() => undefined);
        }}
      />

      {dialog === "edit" && editSource && <DirectEditDialog kind={kind} source={editSource} onClose={() => setDialog(null)} />}
    </div>
  );
}
