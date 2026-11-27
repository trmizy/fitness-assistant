/**
 * Tài chính / Doanh số: "Doanh số theo thời gian" (per day, or per week for the longer ranges) and "Doanh số theo gói". Both are derived
 * from the membership rows the Sales tab already loaded (no extra request); they are GROSS selling prices of paid cards (ACTIVE + EXPIRED),
 * not the gym's income, and every panel says so in words. Nothing is drawn while a branch failed or is loading (no partial totals);
 * rows carry no member identity (the accountant's view has none).
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatVND } from "../../../utils/currency";
import type { SalesView } from "../finance/financeModel";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import {
  SALES_CHART_NOTE,
  SALES_RANGES,
  chartAccess,
  compactVnd,
  dayMonth,
  granularityOptions,
  resolveGranularity,
  revenueSeries,
  revenueSummary,
  salesByPlan,
  shareText,
  vnDateOf,
  weekdayOf,
  type Granularity,
  type SalesRange,
} from "./chartsModel";
import { AXIS_LINE, AXIS_TICK, ChartSkeleton, ChartState, ChartTable, ChartTip, GRID_STROKE, HBarList, RangeSwitch } from "./ChartParts";

const nf = new Intl.NumberFormat("vi-VN");
const WEEKDAY_FULL = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const RANGE_OPTIONS = SALES_RANGES.map((d) => ({ value: d, text: `${d} ngày` }));
const GRAN_TEXT: Record<Granularity, string> = { day: "Theo ngày", week: "Theo tuần" };

export function SalesChartsPanel({
  rows,
  loading,
  partial,
  planName,
  plansLoading,
}: {
  /** Every sale row of the branches in view (all statuses; the model keeps the paid ones). */
  rows: readonly SalesView[];
  loading: boolean;
  /** At least one branch failed: no chart (it would be a partial total). */
  partial: boolean;
  planName: (planId: string) => string;
  /** The plan names are still loading: the by-plan chart waits instead of printing a wrong name. */
  plansLoading: boolean;
}) {
  const scope = useGymOwnerScope();
  const [days, setDays] = useState<SalesRange>(90);
  const [chosen, setChosen] = useState<Granularity | null>(null);
  const todayVn = vnDateOf(Date.now());
  if (!chartAccess(scope.can).sales) return null;
  // No rows at all and nothing wrong: the tab's own empty state ("Chưa có thẻ nào được bán") speaks.
  if (!loading && !partial && rows.length === 0) return null;

  const gran = resolveGranularity(days, chosen);
  const series = revenueSeries(rows, todayVn, days, gran);
  const plans = salesByPlan(rows, { from: series.from, to: series.to }, planName);
  const planTotal = plans.reduce((a, p) => a + p.total, 0);
  const summary = revenueSummary(series, formatVND);
  const ready = !loading && !partial;
  const grans = granularityOptions(days);
  const windowText = `${dayMonth(series.from)} đến ${dayMonth(series.to)}`;
  const unitWord = gran === "week" ? "tuần" : "ngày";

  return (
    <div className="go-chart-pair" data-testid="go-fin-sales-charts">
      <section className="go-panel go-chart-panel" aria-labelledby="go-h-rev-time" data-testid="go-chart-revenue">
        <div className="go-panel-head go-panel-head-row">
          <div>
            <h2 id="go-h-rev-time">Doanh số gộp theo thời gian</h2>
            <p data-testid="go-chart-revenue-note">{SALES_CHART_NOTE}</p>
          </div>
          <div className="go-chart-controls">
            <RangeSwitch label="Khoảng thời gian" value={days} options={RANGE_OPTIONS} onChange={setDays} testId="go-chart-sales-range" />
            {grans.length > 1 && (
              <RangeSwitch label="Gộp theo" value={gran} options={grans.map((g) => ({ value: g, text: GRAN_TEXT[g] }))} onChange={setChosen} testId="go-chart-sales-gran" />
            )}
          </div>
        </div>
        <div className="go-chart-body">
          {loading && <ChartSkeleton />}
          {!loading && partial && <ChartState tone="risk" testId="go-chart-sales-partial" title="Chưa vẽ biểu đồ doanh số" text="Có chi nhánh chưa tải được, vẽ lúc này sẽ thiếu số. Bấm Thử lại ở trên." />}
          {ready && (
            <>
              <div className="go-chart-kpi">
                <span className="go-chart-kpi-num" data-testid="go-chart-revenue-total" data-value={String(series.total)}>{formatVND(series.total)}</span>
                <span className="go-chart-kpi-unit">doanh số gộp, {series.count} thẻ, {windowText}</span>
              </div>
              {series.count === 0 ? (
                <ChartState title={`Chưa bán thẻ nào trong khoảng ${windowText}`} text="Chọn khoảng dài hơn để xem các thẻ bán trước đó." testId="go-chart-revenue-empty" />
              ) : (
                <div className="go-chart-plot" role="img" aria-label={`Biểu đồ cột doanh số gộp theo ${unitWord}. ${summary}`} data-testid="go-chart-revenue-plot">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series.points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={gran === "day" && days > 30 ? "10%" : "22%"}>
                      <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
                      <XAxis dataKey="key" tickFormatter={(k: string) => dayMonth(k)} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis tickFormatter={compactVnd} tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "var(--go-surface-2)" }}
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as { key: string; from: string; to: string; total: number; count: number; partial: boolean } | undefined;
                          if (!p) return null;
                          const title = gran === "week" ? `Tuần ${dayMonth(p.from)} - ${dayMonth(p.to)}${p.partial ? " (chưa hết tuần)" : ""}` : `${WEEKDAY_FULL[weekdayOf(p.key)]} ${dayMonth(p.key)}`;
                          return <ChartTip active={active} title={title} lines={[`Doanh số gộp ${formatVND(p.total)}`, `${p.count} thẻ`]} />;
                        }}
                      />
                      <Bar dataKey="total" fill="var(--go-action)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="go-chart-sum" data-testid="go-chart-revenue-summary">
                {summary}
                {gran === "week" && " Mỗi cột là một tuần từ thứ Hai; tuần hiện tại chưa hết."}
                {series.undated > 0 && ` ${series.undated} thẻ không có ngày bán nên không nằm trên biểu đồ.`}
              </p>
              {series.count > 0 && (
                <ChartTable
                  caption={`Doanh số gộp theo ${unitWord}`}
                  head={[gran === "week" ? "Tuần bắt đầu" : "Ngày", "Số thẻ", "Doanh số gộp"]}
                  rows={series.points.filter((p) => p.count > 0).map((p) => [gran === "week" ? `${dayMonth(p.from)} - ${dayMonth(p.to)}${p.partial ? " (chưa hết)" : ""}` : `${WEEKDAY_FULL[weekdayOf(p.key)]} ${dayMonth(p.key)}`, nf.format(p.count), formatVND(p.total)])}
                  summary="Xem bảng số liệu (chỉ các mốc có bán)"
                />
              )}
            </>
          )}
        </div>
      </section>

      <section className="go-panel go-chart-panel" aria-labelledby="go-h-rev-plan" data-testid="go-chart-plans">
        <div className="go-panel-head">
          <h2 id="go-h-rev-plan">Doanh số gộp theo gói</h2>
          <p>Cùng khoảng {windowText}. Giá bán của thẻ đã thanh toán, không phải thu nhập.</p>
        </div>
        <div className="go-chart-body">
          {(loading || (ready && plansLoading)) && <ChartSkeleton height={180} />}
          {!loading && partial && <ChartState tone="risk" title="Chưa vẽ biểu đồ theo gói" text="Có chi nhánh chưa tải được." testId="go-chart-plans-partial" />}
          {ready && !plansLoading && plans.length === 0 && <ChartState title="Chưa bán thẻ nào trong khoảng này" testId="go-chart-plans-empty" />}
          {ready && !plansLoading && plans.length > 0 && (
            <>
              <HBarList
                testId="go-chart-plans-list"
                ariaLabel={`Doanh số gộp theo gói, ${windowText}`}
                rows={plans.map((p) => ({
                  key: p.planId ?? "other",
                  name: p.name,
                  value: p.total,
                  valueText: formatVND(p.total),
                  sub: `${nf.format(p.count)} thẻ, ${shareText(p.total, planTotal)} doanh số`,
                }))}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
