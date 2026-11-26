/**
 * Hôm nay: "Lượt check-in" bars per Vietnam day, 7 / 30 / 90 days, total + change against the previous EQUAL period
 * (a second stats call with the earlier range). One branch = its own bars; all branches = the sum (only when every branch has loaded)
 * with a switch to compare the branches. Data: GET /owner/gyms/:id/stats?from&to (the endpoint Hôm nay already uses); a `checkins: null`
 * answer (role may not read it) draws nothing. Rules and shaping live in chartsModel.ts.
 */
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { gymService } from "../../../services/api";
import type { GymStats } from "../../../types";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { gymStatsRangeKey, type StatsState } from "../stats/gymStats";
import {
  CHECKIN_RANGES,
  branchCompareRows,
  buildCheckinTrend,
  chartAccess,
  checkinSummary,
  comparisonText,
  dayMonth,
  dayWithWeekday,
  periodRanges,
  rangeStateOf,
  vnDateOf,
  weekdayOf,
  type BranchRange,
  type CheckinRange,
  type DateRange,
} from "./chartsModel";
import { AXIS_LINE, AXIS_TICK, ChartSkeleton, ChartState, ChartTable, ChartTip, DeltaChip, GRID_STROKE, HBarList, RangeSwitch } from "./ChartParts";

const nf = new Intl.NumberFormat("vi-VN");
const WEEKDAY_FULL = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const RANGE_OPTIONS = CHECKIN_RANGES.map((d) => ({ value: d, text: `${d} ngày` }));
const MODE_OPTIONS = [
  { value: "sum" as const, text: "Tổng hợp" },
  { value: "compare" as const, text: "Từng chi nhánh" },
];

export interface ChartGym {
  id: string;
  name: string;
}

function stateOf(q: { data?: GymStats; isError: boolean }, gymId: string): StatsState {
  if (q.data) return q.data.gymId === gymId ? { state: "ok", stats: q.data } : { state: "error" };
  return q.isError ? { state: "error" } : { state: "loading" };
}

export function CheckinTrendPanel({ gyms, codes }: { gyms: readonly ChartGym[]; codes: Readonly<Record<string, string>> }) {
  const scope = useGymOwnerScope();
  const [days, setDays] = useState<CheckinRange>(30);
  const [mode, setMode] = useState<"sum" | "compare">("sum");
  const todayVn = vnDateOf(Date.now());
  const { current, previous } = useMemo(() => periodRanges(todayVn, days), [todayVn, days]);

  // Fail-closed: no `checkin.list` (or role still unknown) = no request and no panel.
  const allowed = chartAccess(scope.can).checkins && gyms.length > 0;
  const mk = (g: ChartGym, r: DateRange) => ({
    queryKey: gymStatsRangeKey(scope.userId, g.id, r.from, r.to),
    queryFn: () => gymService.getGymStats(g.id, r) as Promise<GymStats>,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const qs = useQueries({ queries: allowed ? gyms.flatMap((g) => [mk(g, current), mk(g, previous)]) : [] });

  const branches: BranchRange[] = allowed
    ? gyms.map((g, i) => ({ gymId: g.id, current: rangeStateOf(stateOf(qs[2 * i], g.id), current), previous: rangeStateOf(stateOf(qs[2 * i + 1], g.id), previous) }))
    : [];
  const trend = buildCheckinTrend(branches);
  if (!allowed || !trend.visible) return null;

  const several = gyms.length > 1;
  const compare = several && mode === "compare";
  const rows = branchCompareRows(branches);
  const retry = () => qs.forEach((q) => q.isError && void q.refetch());
  const nameOf = (id: string) => gyms.find((g) => g.id === id)?.name ?? "";
  const scopeLine = several ? `Tất cả ${trend.total} chi nhánh cộng lại, ${days} ngày gần nhất` : `${gyms[0].name}, ${days} ngày gần nhất`;
  const summary = trend.daily ? checkinSummary(trend.daily, days) : "";
  const tick = (date: string) => (days <= 7 ? dayWithWeekday(date) : dayMonth(date));

  return (
    <section className="go-panel go-chart-panel" aria-labelledby="go-h-checkin-trend" data-testid="go-chart-checkins">
      <div className="go-panel-head go-panel-head-row">
        <div>
          <h2 id="go-h-checkin-trend">Lượt check-in</h2>
          <p>{compare ? `So sánh từng chi nhánh, ${days} ngày gần nhất` : scopeLine}</p>
        </div>
        <div className="go-chart-controls">
          {several && <RangeSwitch label="Cách xem" value={mode} options={MODE_OPTIONS} onChange={setMode} testId="go-chart-mode" />}
          <RangeSwitch label="Khoảng thời gian" value={days} options={RANGE_OPTIONS} onChange={setDays} testId="go-chart-range" />
        </div>
      </div>

      <div className="go-chart-body">
        {trend.loading && <ChartSkeleton />}

        {trend.failedGymIds.length > 0 && (
          <ChartState
            tone="risk"
            testId="go-chart-checkins-error"
            title={several ? `Đã tải ${trend.loaded}/${trend.total} chi nhánh, ${trend.failedGymIds.map((id) => codes[id] ?? nameOf(id)).join(", ")} lỗi` : "Chưa tải được số liệu check-in"}
            text={several ? "Chưa đủ nên không có tổng." : undefined}
            onRetry={retry}
          />
        )}

        {/* Sum view: needs every branch. */}
        {trend.complete && trend.daily && !compare && (
          <>
            <div className="go-chart-kpi">
              <span className="go-chart-kpi-num" data-testid="go-chart-checkins-total" data-value={String(trend.sum)}>{nf.format(trend.sum ?? 0)}</span>
              <span className="go-chart-kpi-unit">lượt check-in</span>
              {trend.comparison.kind !== "both-zero" && <DeltaChip comparison={trend.comparison} text={comparisonText(trend.comparison, days)} />}
            </div>
            {trend.sum === 0 ? (
              <ChartState title={`Chưa có lượt check-in nào trong ${days} ngày qua`} text="Khi hội viên check-in, biểu đồ sẽ hiện ở đây." testId="go-chart-checkins-empty" />
            ) : (
              <div className="go-chart-plot" role="img" aria-label={`Biểu đồ cột lượt check-in theo ngày. ${summary}`} data-testid="go-chart-checkins-plot">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend.daily} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={days > 30 ? "10%" : "22%"}>
                    <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={tick} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={days <= 7 ? 0 : "preserveStartEnd"} minTickGap={days <= 7 ? 0 : 18} />
                    <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
                    <Tooltip
                      cursor={{ fill: "var(--go-surface-2)" }}
                      content={({ active, payload }) => {
                        const p = payload?.[0]?.payload as { date: string; count: number } | undefined;
                        if (!p) return null;
                        return <ChartTip active={active} title={`${WEEKDAY_FULL[weekdayOf(p.date)]} ${dayMonth(p.date)}`} lines={[`${nf.format(p.count)} lượt check-in`]} />;
                      }}
                    />
                    <Bar dataKey="count" fill="var(--go-action)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="go-chart-sum" data-testid="go-chart-checkins-summary">{summary} Hôm nay chưa hết ngày nên số của hôm nay còn tăng.</p>
            <ChartTable caption="Số lượt check-in theo ngày" head={["Ngày", "Lượt check-in"]} rows={trend.daily.map((d) => [`${WEEKDAY_FULL[weekdayOf(d.date)]} ${dayMonth(d.date)}`, nf.format(d.count)])} />
          </>
        )}

        {/* Compare view: one row per branch, each with its own total and change (a failed branch says so on its own row). */}
        {compare && !trend.loading && (
          <HBarList
            testId="go-chart-checkins-branches"
            ariaLabel={`Lượt check-in của từng chi nhánh trong ${days} ngày gần nhất`}
            rows={rows.map((r) => ({
              key: r.gymId,
              name: (
                <>
                  <span className="go-code-chip" aria-hidden="true">{codes[r.gymId] ?? "--"}</span> {nameOf(r.gymId)}
                </>
              ),
              value: r.current ?? 0,
              valueText: r.state === "ok" ? `${nf.format(r.current ?? 0)} lượt` : r.state === "error" ? "Chưa tải được" : "Đang tải",
              sub: r.state === "ok" ? <DeltaChip comparison={r.comparison} text={comparisonText(r.comparison, days)} /> : undefined,
            }))}
          />
        )}
      </div>
    </section>
  );
}
