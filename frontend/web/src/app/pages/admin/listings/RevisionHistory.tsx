import { useQuery } from "@tanstack/react-query";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { adminListingService, type ListingHistoryResult } from "../../../services/ptListingApi";
import { ActivityItem, Timeline } from "../../../components/ui/Timeline";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorState } from "../../../components/ui/ErrorState";
import { PageSkeleton } from "../../../components/ui/PageSkeleton";
import { listingErrorMessage } from "../../../utils/listingErrors";
import { revisionSourceLabel, revisionStatusView } from "../../../utils/adminListing";
import { historyKey, type ListingKind } from "./adminListingShared";

const AUDIT_LABEL: Record<string, string> = {
  PT_LISTING_APPROVED: "Duyệt bản sửa",
  PT_LISTING_REJECTED: "Từ chối bản sửa",
  PT_LISTING_CHANGES_REQUESTED: "Yêu cầu chỉnh sửa",
  PT_LISTING_ADMIN_EDITED: "Admin sửa trực tiếp",
  LISTING_SUBMITTED: "Gửi duyệt",
  LISTING_APPROVED: "Duyệt bản sửa",
  LISTING_REJECTED: "Từ chối bản sửa",
  LISTING_CHANGES_REQUESTED: "Yêu cầu chỉnh sửa",
  LISTING_ADMIN_EDITED: "Admin sửa trực tiếp",
};

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Timeline of one listing: every revision (who sent it, how it ended, the admin's reason / note), then the audit
 * lines that have a Vietnamese label. Only text is shown — the audit rows the PT endpoint returns also carry IP and
 * browser (personal data), which this view deliberately never reads.
 */
export function RevisionHistory({ kind, listingId }: { kind: ListingKind; listingId: string }) {
  const query = useQuery<ListingHistoryResult>({
    queryKey: historyKey(kind, listingId),
    queryFn: () => (kind === "pts" ? adminListingService.ptHistory(listingId) : adminListingService.gymHistory(listingId)),
    staleTime: 0,
  });

  if (query.isLoading) return <PageSkeleton variant="list" rows={3} />;
  if (query.isError || !query.data) return <ErrorState kind="server" message={listingErrorMessage(query.error, "Không tải được lịch sử.")} onRetry={() => void query.refetch()} />;

  const { revisions, audit } = query.data;
  if (revisions.length === 0 && audit.length === 0) return <EmptyState icon={ClockCounterClockwiseIcon} title="Chưa có lịch sử nào." />;

  const auditRows = audit.filter((a) => typeof a.action === "string" && AUDIT_LABEL[a.action]);
  return (
    <div className="space-y-5">
      <Timeline>
        {revisions.map((r, i) => {
          const s = revisionStatusView(r.status);
          const detail = [r.adminReason && `Lý do: ${r.adminReason}`, r.reviewNote && `Ghi chú: ${r.reviewNote}`].filter(Boolean).join(" · ");
          return (
            <ActivityItem
              key={r.id}
              icon={ClockCounterClockwiseIcon}
              title={`${s.label} — ${revisionSourceLabel(r.source)}`}
              timestamp={when(r.closedAt ?? r.submittedAt ?? r.createdAt)}
              detail={detail || undefined}
              isLast={i === revisions.length - 1}
            />
          );
        })}
      </Timeline>
      {auditRows.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Nhật ký thao tác</h4>
          <ul className="divide-y divide-zinc-800/70 rounded-xl border border-zinc-800/70">
            {auditRows.map((a, i) => (
              <li key={String(a.id ?? i)} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-zinc-200">{AUDIT_LABEL[a.action]}</p>
                  {typeof a.reason === "string" && a.reason && <p className="truncate text-xs text-zinc-500">{a.reason}</p>}
                  {typeof a.metadata?.note === "string" && <p className="truncate text-xs text-zinc-500">{a.metadata.note}</p>}
                </div>
                <span className="shrink-0 text-xs text-zinc-500">{when(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
