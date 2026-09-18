import { RulerIcon as Ruler, TrendDownIcon as TrendingDown, TrendUpIcon as TrendingUp } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { ptCoachService } from "../../services/api";

function formatDate(d: string | null | undefined) {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** PT Coaching Workspace phase §23 — a client's InBody/measurement trend.
 * Lazy-loaded only when this card actually mounts (the Progress tab is
 * opened), per §32 — never fetched up front with the Overview summary.
 * Read-only, deliberately minimal fields (date/weight/bodyFat/muscle) —
 * never the client's full raw history or unrelated profile data. */
export function ClientProgressCard({ clientUserId }: { clientUserId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pt-client-progress", clientUserId],
    queryFn: () => ptCoachService.getClientProgress(clientUserId),
  });

  const latest = data?.latest ?? null;
  const recent = data?.recent ?? [];
  const trendDelta =
    recent.length >= 2 ? recent[0].weight - recent[recent.length - 1].weight : null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Ruler className="w-4 h-4 text-blue-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Đo lường cơ thể (InBody)</h4>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {isError && <p className="text-xs text-zinc-500 py-4 text-center">Không thể tải dữ liệu đo lường.</p>}

      {!isLoading && !isError && !latest && (
        <p className="text-xs text-zinc-500 py-4 text-center">Học viên chưa có dữ liệu InBody nào.</p>
      )}

      {latest && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Ngày đo gần nhất</span>
            <span className="text-zinc-300">{formatDate(latest.date)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-800/60 p-2">
              <p className="text-[10px] text-zinc-500">Cân nặng</p>
              <p className="text-sm font-semibold text-zinc-200">{latest.weight ?? "–"} kg</p>
            </div>
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-800/60 p-2">
              <p className="text-[10px] text-zinc-500">Mỡ cơ thể</p>
              <p className="text-sm font-semibold text-zinc-200">{latest.bodyFatPct != null ? `${latest.bodyFatPct}%` : "–"}</p>
            </div>
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-800/60 p-2">
              <p className="text-[10px] text-zinc-500">Cơ</p>
              <p className="text-sm font-semibold text-zinc-200">{latest.muscleMass != null ? `${latest.muscleMass} kg` : "–"}</p>
            </div>
          </div>
          {trendDelta != null && recent.length >= 2 && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 pt-1 border-t border-zinc-800/60">
              {trendDelta < 0 ? (
                <TrendingDown className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>
                {trendDelta < 0 ? "Giảm" : "Tăng"} {Math.abs(trendDelta).toFixed(1)} kg qua {recent.length} lần đo gần nhất
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
