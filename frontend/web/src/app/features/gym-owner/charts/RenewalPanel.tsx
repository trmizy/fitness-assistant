/**
 * Hôm nay: "Gia hạn" card from /analytics `renewal`. Headline = the SETTLED rate (cards that ended at least 30 days ago, where "not
 * renewed" is final), explained in plain words; the provisional rate, the counts, and a stacked bar of new vs returning members per day
 * (per week for 90 days) sit under it. Renewal is counted per brand (a card bought at another branch of the brand counts). A `renewal:
 * null` answer (role may not read it) draws nothing; all branches = the sum, only when every branch has loaded. Rules: analyticsModel.ts.
 */
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import {
  HEAT_RANGES,
  RENEWAL_SCOPE_NOTE,
  aggregateRenewals,
  analyticsRange,
  newReturningSeries,
  provisionalRateText,
  renewalHeadline,
  renewalSummary,
  type Gran,
  type HeatRange,
} from "./analyticsModel";
import { chartAccess, dayMonth, vnDateOf } from "./chartsModel";
import { AXIS_LINE, AXIS_TICK, ChartSkeleton, ChartState, ChartTable, ChartTip, GRID_STROKE, RangeSwitch } from "./ChartParts";
import { useGymAnalytics } from "./useGymAnalytics";
import type { ChartGym } from "./CheckinTrendPanel";

const nf = new Intl.NumberFormat("vi-VN");
const RANGE_OPTIONS = HEAT_RANGES.map((d) => ({ value: d, text: `${d} ngày` }));
const NEW_COLOR = "var(--go-action)";
const RETURN_COLOR = "var(--go-info)";

export function RenewalPanel({ gyms }: { gyms: readonly ChartGym[] }) {
  const scope = useGymOwnerScope();
  const [days, setDays] = useState<HeatRange>(90);
  const todayVn = vnDateOf(Date.now());
  const range = useMemo(() => analyticsRange(todayVn, days), [todayVn, days]);
  const allowed = chartAccess(scope.can).renewal && gyms.length > 0;
  const { states, retry } = useGymAnalytics(
    gyms.map((g) => g.id),
    range,
    allowed,
  );
  const agg = aggregateRenewals(states, range);
  if (!allowed || !agg.visible) return null;

  const several = gyms.length > 1;
  const nameOf = (id: string) => gyms.find((g) => g.id === id)?.name ?? "";
  const r = agg.renewal;
  const gran: Gran = days > 30 ? "week" : "day";
  const series = r ? newReturningSeries(r.daily, range, gran) : [];
  const head = r ? renewalHeadline(r) : null;
  const sold = r ? r.newMembers + r.returningMembers : 0;
  const summary = r ? renewalSummary(r, range) : "";
  const prov = r ? provisionalRateText(r) : "";
  const unitWord = gran === "week" ? "tuần" : "ngày";

  return (
    <section className="go-panel go-chart-panel" aria-labelledby="go-h-renewal" data-testid="go-chart-renewal">
      <div className="go-panel-head go-panel-head-row">
        <div>
          <h2 id="go-h-renewal">Gia hạn</h2>
          <p>{several ? `Tất cả ${agg.total} chi nhánh cộng lại` : gyms[0].name}, thẻ hết hạn trong {days} ngày gần nhất</p>
        </div>
        <div className="go-chart-controls">
          <RangeSwitch label="Khoảng thời gian" value={days} options={RANGE_OPTIONS} onChange={setDays} testId="go-renewal-range" />
        </div>
      </div>

      <div className="go-chart-body">
        {agg.loading && <ChartSkeleton />}
        {agg.failedGymIds.length > 0 && (
          <ChartState
            tone="risk"
            testId="go-renewal-error"
            title={several ? `Đã tải ${agg.loaded}/${agg.total} chi nhánh, ${agg.failedGymIds.map((id) => nameOf(id)).join(", ")} lỗi` : "Chưa tải được số liệu gia hạn"}
            text={several ? "Chưa đủ nên không có tổng." : undefined}
            onRetry={retry}
          />
        )}

        {r && head && (
          <>
            <div className="go-chart-kpi">
              <span className="go-chart-kpi-num" data-testid="go-renewal-rate" data-value={r.settledRate === null ? "" : String(r.settledRate)}>{head.value}</span>
              <span className="go-chart-kpi-unit">khách đã gia hạn (tỷ lệ đã chốt)</span>
            </div>
            <p className="go-ren-text" data-testid="go-renewal-text">{head.text}</p>
            {prov && <p className="go-chart-sum" data-testid="go-renewal-provisional">{prov}</p>}

            <dl className="go-ren-stats" data-testid="go-renewal-stats">
              <div><dt>Thẻ hết hạn</dt><dd data-testid="go-renewal-ended" data-value={String(r.ended)}>{nf.format(r.ended)}</dd></div>
              <div><dt>Đã gia hạn</dt><dd data-testid="go-renewal-renewed" data-value={String(r.renewed)}>{nf.format(r.renewed)}</dd></div>
              <div><dt>Chưa gia hạn, còn trong {r.windowDays} ngày</dt><dd data-testid="go-renewal-open" data-value={String(r.open)}>{nf.format(r.open)}</dd></div>
              <div><dt>Hết hạn đủ {r.windowDays} ngày</dt><dd data-testid="go-renewal-settled" data-value={String(r.settled)}>{nf.format(r.settled)}</dd></div>
            </dl>
            {r.renewed > 0 && <p className="go-chart-sum">Trong số đã gia hạn, {nf.format(r.renewedSameBranch)} thẻ gia hạn tại cùng chi nhánh.</p>}

            <h3 className="go-ren-sub">Thẻ bán ra theo {unitWord}: khách mới và khách quay lại</h3>
            {sold === 0 ? (
              <ChartState title={`Chưa bán thẻ nào trong ${days} ngày qua`} text="Khi có người mua gói, khách mới và khách quay lại sẽ hiện ở đây." testId="go-renewal-empty" />
            ) : (
              <>
                <ul className="go-ren-legend" aria-label="Chú giải" data-testid="go-renewal-legend">
                  <li><span className="go-legend-dot" style={{ background: NEW_COLOR }} aria-hidden="true" /> Khách mới <strong data-testid="go-renewal-new" data-value={String(r.newMembers)}>{nf.format(r.newMembers)}</strong></li>
                  <li><span className="go-legend-dot" style={{ background: RETURN_COLOR }} aria-hidden="true" /> Khách quay lại <strong data-testid="go-renewal-returning" data-value={String(r.returningMembers)}>{nf.format(r.returningMembers)}</strong></li>
                </ul>
                <div className="go-chart-plot" role="img" aria-label={`Biểu đồ cột chồng khách mới và khách quay lại theo ${unitWord}. ${summary}`} data-testid="go-renewal-plot">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={gran === "day" && days > 7 ? "10%" : "22%"}>
                      <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
                      <XAxis dataKey="key" tickFormatter={(k: string) => dayMonth(k)} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} />
                      <Tooltip
                        cursor={{ fill: "var(--go-surface-2)" }}
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as { from: string; to: string; new: number; returning: number; partial: boolean } | undefined;
                          if (!p) return null;
                          const title = gran === "week" ? `Tuần ${dayMonth(p.from)} - ${dayMonth(p.to)}${p.partial ? " (chưa đủ tuần)" : ""}` : dayMonth(p.from);
                          return <ChartTip active={active} title={title} lines={[`Khách mới ${p.new}`, `Khách quay lại ${p.returning}`]} />;
                        }}
                      />
                      <Bar dataKey="new" stackId="nvr" fill={NEW_COLOR} stroke="var(--go-surface)" strokeWidth={1} maxBarSize={28} isAnimationActive={false} />
                      <Bar dataKey="returning" stackId="nvr" fill={RETURN_COLOR} stroke="var(--go-surface)" strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="go-chart-sum" data-testid="go-renewal-summary">
                  {summary}
                  {gran === "week" && " Mỗi cột là một tuần từ thứ Hai; tuần đầu và tuần hiện tại có thể chưa đủ 7 ngày."}
                </p>
                <ChartTable
                  caption={`Khách mới và khách quay lại theo ${unitWord}`}
                  head={[gran === "week" ? "Tuần" : "Ngày", "Khách mới", "Khách quay lại"]}
                  rows={series.filter((p) => p.new + p.returning > 0).map((p) => [gran === "week" ? `${dayMonth(p.from)} - ${dayMonth(p.to)}${p.partial ? " (chưa đủ)" : ""}` : dayMonth(p.from), nf.format(p.new), nf.format(p.returning)])}
                  summary="Xem bảng số liệu (chỉ các mốc có bán)"
                />
              </>
            )}
            <p className="go-chart-sum" data-testid="go-renewal-scope-note">{RENEWAL_SCOPE_NOTE}</p>
          </>
        )}
      </div>
    </section>
  );
}
