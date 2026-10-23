import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CaretLeftIcon, CaretRightIcon, ClockIcon, ImageSquareIcon, MagnifyingGlassIcon, PackageIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { adminService } from "../../../services/api";
import { adminListingService } from "../../../services/ptListingApi";
import type { AdminListingListItem } from "../../../types";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorState } from "../../../components/ui/ErrorState";
import { PageSkeleton } from "../../../components/ui/PageSkeleton";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { listingErrorMessage } from "../../../utils/listingErrors";
import { QUEUE_STATUS_OPTIONS, buildQueueParams, queueItemTitle, revisionSourceLabel, revisionStatusView } from "../../../utils/adminListing";
import { queueKey, type ListingKind } from "./adminListingShared";

interface BrandRow { id: string; name: string; approvedName?: string | null }
interface GymRow { id: string; name: string; approvedName?: string | null; brandId?: string | null }

const selectCls =
  "h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] px-2 text-sm text-[var(--input-text)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/**
 * The revision queue of one kind (PT or Gym). Default view is PENDING (oldest first, as the server orders it);
 * the admin can look back at closed revisions with the status filter. Gym adds brand + branch filters.
 */
export function RevisionQueue({ kind, onOpen }: { kind: ListingKind; onOpen: (rid: string) => void }) {
  const [status, setStatus] = useState("PENDING");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [brandId, setBrandId] = useState("");
  const [gymId, setGymId] = useState("");
  const [page, setPage] = useState(1);

  const brandsQuery = useQuery<BrandRow[]>({
    queryKey: ["admin-listing-brands"],
    queryFn: () => adminService.listBrandsForAdmin(),
    enabled: kind === "gyms",
    staleTime: 5 * 60_000,
  });
  const gymsQuery = useQuery<GymRow[]>({
    queryKey: ["admin-listing-gyms"],
    queryFn: () => adminService.listGymsForAdmin(),
    enabled: kind === "gyms",
    staleTime: 5 * 60_000,
  });
  const branchOptions = useMemo(
    () => (gymsQuery.data ?? []).filter((g) => !brandId || g.brandId === brandId).sort((a, b) => (a.approvedName ?? a.name).localeCompare(b.approvedName ?? b.name, "vi")),
    [gymsQuery.data, brandId],
  );

  const params = buildQueueParams({ status, q: submittedQ, brandId: kind === "gyms" ? brandId : undefined, gymId: kind === "gyms" ? gymId : undefined, page });
  const query = useQuery({
    queryKey: queueKey(kind, params),
    queryFn: () => (kind === "pts" ? adminListingService.listPt(params) : adminListingService.listGym(params)),
    // The queue is the admin's work list: always show the truth.
    staleTime: 0,
  });

  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const resetPage = () => setPage(1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800/60 pb-2" role="tablist" aria-label="Lọc theo trạng thái">
        {QUEUE_STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            role="tab"
            aria-selected={status === o.value}
            onClick={() => {
              setStatus(o.value);
              resetPage();
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${status === o.value ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQ(q);
          resetPage();
        }}
      >
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "pts" ? "Tìm theo tên hoặc email huấn luyện viên" : "Tìm theo tên chi nhánh, thương hiệu hoặc địa chỉ"} className="pl-8" aria-label="Tìm kiếm" />
        </div>
        <Button type="submit" variant="outline">Tìm</Button>
      </form>

      {kind === "gyms" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-zinc-500">
            Thương hiệu
            <select
              className={selectCls}
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                setGymId("");
                resetPage();
              }}
            >
              <option value="">Tất cả thương hiệu</option>
              {(brandsQuery.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.approvedName ?? b.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-500">
            Chi nhánh
            <select
              className={selectCls}
              value={gymId}
              onChange={(e) => {
                setGymId(e.target.value);
                resetPage();
              }}
            >
              <option value="">Tất cả chi nhánh</option>
              {branchOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.approvedName ?? g.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {query.isLoading ? (
        <PageSkeleton variant="list" rows={4} />
      ) : query.isError || !data ? (
        <ErrorState kind="server" message={listingErrorMessage(query.error, "Không tải được hàng đợi.")} onRetry={() => void query.refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          tone={status === "PENDING" ? "positive" : "neutral"}
          title={status === "PENDING" ? "Không có bản sửa nào đang chờ duyệt." : "Không có bản sửa nào khớp bộ lọc."}
          description={submittedQ ? "Thử bỏ từ khóa tìm kiếm." : undefined}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {data.items.map((item) => (
              <QueueRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />
            ))}
          </ul>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              {data.total} bản sửa · trang {data.page}/{pages}
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Trang trước">
                <CaretLeftIcon />
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Trang sau">
                <CaretRightIcon />
              </Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function QueueRow({ item, onOpen }: { item: AdminListingListItem; onOpen: () => void }) {
  const s = revisionStatusView(item.status);
  return (
    <li>
      <button onClick={onOpen} className="w-full rounded-xl border border-zinc-800/60 bg-zinc-900 p-4 text-left transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-zinc-100">{queueItemTitle(item)}</span>
              <StatusBadge label={s.label} tone={s.tone} />
              {item.stale && item.status === "PENDING" && <StatusBadge label="Tin đã đổi sau khi gửi" tone="warning" icon={WarningCircleIcon} />}
            </div>
            {item.brandName && <p className="mt-0.5 truncate text-xs text-zinc-500">{item.brandName}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1"><ClockIcon className="size-3" /> {when(item.submittedAt ?? item.createdAt)}</span>
              <span>{revisionSourceLabel(item.source)}</span>
              <span className="inline-flex items-center gap-1"><ImageSquareIcon className="size-3" /> {item.summary.photoCount} ảnh</span>
              {item.summary.packageCount !== undefined && <span className="inline-flex items-center gap-1"><PackageIcon className="size-3" /> {item.summary.packageCount} gói</span>}
              {item.summary.amenityCount !== undefined && <span>{item.summary.amenityCount} tiện ích{item.summary.proposalCount ? ` + ${item.summary.proposalCount} đề xuất` : ""}</span>}
            </p>
            {item.reviewNote && <p className="mt-1 line-clamp-1 text-xs text-zinc-400">Ghi chú: {item.reviewNote}</p>}
          </div>
          <CaretRightIcon className="mt-1 size-4 shrink-0 text-zinc-600" />
        </div>
      </button>
    </li>
  );
}
