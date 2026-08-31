import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Table2, Search, Video, VideoOff, Loader2 } from "lucide-react";
import { catalogQualityService } from "../../services/api";

/**
 * Roadmap P1.8 "Logging-mode catalog discoverability"
 * (docs/features/CATALOG_QUALITY_MATRIX_IMPACT_ANALYSIS.md).
 *
 * Read-only — this page NEVER changes an exercise's publicationStatus.
 * There is no such action anywhere in this codebase today, deliberately:
 * this pass's own audit found a real, already-established publish gate in
 * the data itself (within the curated cohort, having a real video is a
 * near-perfect predictor of being published — see the impact analysis's
 * "Real findings"), and the roadmap's own instruction is explicit: never
 * publish rows just to claim feature availability. This page exists so
 * that decision can be made later with real data, not to make it here.
 */

const LOGGING_MODES = ["", "REPS_LOAD", "BODYWEIGHT_REPS", "TIME", "TIME_LOAD", "DISTANCE_TIME"];
const STATUSES = ["", "STAGING", "PUBLISHED"];

const REVIEW_STATUS_LABEL: Record<string, string> = {
  NO_REVIEW_RECORD: "Chưa có quyết định review",
  NO_SOURCE_RECORD: "Không có nguồn dữ liệu",
  APPROVE_AS_NEW_STAGING: "Đã duyệt: bài mới (STAGING)",
  LINK_AS_ALIAS_OF_EXISTING: "Đã gắn làm alias",
  MARK_AS_DUPLICATE_SKIP: "Đã đánh dấu trùng, bỏ qua",
  NEEDS_MORE_INFO: "Cần xem thêm",
  REJECT_RECORD: "Đã từ chối",
};

export function AdminCatalogQuality() {
  const [loggingMode, setLoggingMode] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 25;

  const query = useQuery({
    queryKey: ["admin", "catalog-quality", loggingMode, status, search, page],
    // Keeps the current rows on screen while the new filter loads, instead of
    // dropping to undefined and flashing an empty list on every filter change.
    placeholderData: keepPreviousData,
    queryFn: () =>
      catalogQualityService.getMatrix({
        loggingMode: loggingMode || undefined,
        status: status || undefined,
        search: search || undefined,
        page,
        limit,
      }),
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;
  const pagination = query.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Table2 className="w-5 h-5 text-emerald-400" /> Ma trận chất lượng catalog
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Chế độ ghi log, trạng thái phát hành, thiết bị, nhóm cơ, giấy phép media và trạng thái review — chỉ xem, không tự publish.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-3">
            <p className="text-2xl text-zinc-100 font-semibold">{summary.total}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Tổng số khớp bộ lọc</p>
          </div>
          <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-3">
            <p className="text-2xl text-zinc-100 font-semibold">{summary.byPublicationStatus.STAGING ?? 0}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">STAGING</p>
          </div>
          <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-3">
            <p className="text-2xl text-zinc-100 font-semibold">{summary.byPublicationStatus.PUBLISHED ?? 0}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">PUBLISHED</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-2xl text-amber-300 font-semibold" data-testid="catalog-quality-missing-video-count">
              {summary.missingVideo}
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Thiếu video</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-2xl text-amber-300 font-semibold" data-testid="catalog-quality-no-review-count">
              {summary.noReviewRecord}
            </p>
            <p className="text-[11px] text-zinc-500 mt-0.5">Chưa qua review</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select
          data-testid="catalog-quality-logging-mode-filter"
          value={loggingMode}
          onChange={(e) => {
            setLoggingMode(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700/40 bg-zinc-900/60 text-zinc-300"
        >
          {LOGGING_MODES.map((m) => (
            <option key={m} value={m}>
              {m || "Mọi loggingMode"}
            </option>
          ))}
        </select>
        <select
          data-testid="catalog-quality-status-filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700/40 bg-zinc-900/60 text-zinc-300"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "Mọi trạng thái"}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm theo tên bài tập..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border border-zinc-700/40 bg-zinc-900/60 text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">Không có bài tập nào khớp bộ lọc hiện tại.</div>
      ) : (
        <div className="rounded-xl border border-zinc-800/40 overflow-x-auto" data-testid="catalog-quality-matrix-table">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800/40 text-zinc-500">
                <th className="text-left p-2.5">Bài tập</th>
                <th className="text-left p-2.5">Logging mode</th>
                <th className="text-left p-2.5">Trạng thái</th>
                <th className="text-left p-2.5">Thiết bị</th>
                <th className="text-left p-2.5">Nhóm cơ</th>
                <th className="text-left p-2.5">Media</th>
                <th className="text-left p-2.5">Giấy phép</th>
                <th className="text-left p-2.5">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-900/60" data-testid={`catalog-quality-row-${r.id}`}>
                  <td className="p-2.5 text-zinc-100">{r.exerciseName}</td>
                  <td className="p-2.5 text-zinc-400">{r.loggingMode}</td>
                  <td className="p-2.5">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        r.publicationStatus === "PUBLISHED"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-zinc-600/40 bg-zinc-700/20 text-zinc-400"
                      }`}
                    >
                      {r.publicationStatus}
                    </span>
                  </td>
                  <td className="p-2.5 text-zinc-400">{r.equipment}</td>
                  <td className="p-2.5 text-zinc-400">{r.muscles.join(", ") || "—"}</td>
                  <td className="p-2.5">
                    {r.hasVideo ? (
                      <Video className="w-3.5 h-3.5 text-emerald-400" data-testid={`catalog-quality-video-${r.id}`} />
                    ) : (
                      <VideoOff className="w-3.5 h-3.5 text-amber-400" data-testid={`catalog-quality-no-video-${r.id}`} />
                    )}
                  </td>
                  <td className="p-2.5 text-zinc-500">
                    {r.dataLicense || "—"}
                    {r.mediaLicense ? ` / ${r.mediaLicense}` : " / chưa có media license"}
                  </td>
                  <td className="p-2.5 text-zinc-500">{REVIEW_STATUS_LABEL[r.reviewStatus] ?? r.reviewStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > pagination.limit && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Trang {pagination.page}/{totalPages} — {pagination.total} bài tập
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg border border-zinc-700/40 text-zinc-300 disabled:opacity-40"
            >
              Trước
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-zinc-700/40 text-zinc-300 disabled:opacity-40"
            >
              Sau
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
