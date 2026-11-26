/**
 * Tài chính / Doanh số: "Thực nhận" from /analytics `netIncome` (the gym wallet's ledger as payment-service reports it), drawn right under the
 * GROSS sales chart so the owner can compare: gross = the selling price of the cards, net = what the gym really receives after the platform
 * fee and the PT referral commission. It is broken down into the gym share, the referral commission and the adjustments (refunds etc.).
 * States: `unavailable` (payment-service failed) = an error with retry, never 0; `walletFound: false` = "Chưa có ví"; `netIncome: null`
 * (role may not read it) = nothing. All branches = the sum, only when every branch has answered. Rules live in analyticsModel.ts.
 */
import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatVND } from "../../../utils/currency";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import {
  NET_CHART_NOTE,
  NET_DATE_NOTE,
  NET_RANGES,
  aggregateNetIncome,
  analyticsRange,
  netBreakdown,
  netIncomeSeries,
  netSummary,
  type NetRange,
} from "./analyticsModel";
import { chartAccess, compactVnd, dayMonth, granularityOptions, resolveGranularity, vnDateOf, weekdayOf, type Granularity } from "./chartsModel";
import { AXIS_LINE, AXIS_TICK, ChartSkeleton, ChartState, ChartTable, ChartTip, GRID_STROKE, RangeSwitch } from "./ChartParts";
import { useGymAnalytics } from "./useGymAnalytics";
import type { ChartGym } from "./CheckinTrendPanel";

const WEEKDAY_FULL = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const RANGE_OPTIONS = NET_RANGES.map((d) => ({ value: d, text: `${d} ngày` }));
const GRAN_TEXT: Record<Granularity, string> = { day: "Theo ngày", week: "Theo tuần" };

/** A signed amount: "+1.200.000 ₫" / "-300.000 ₫" (the sign is text, so a deduction never depends on colour). */
const signed = (n: number): string => (n > 0 ? `+${formatVND(n)}` : formatVND(n));
/** A deduction written with its minus sign; 0 stays "0 ₫" (never "-0 ₫"). */
const minus = (n: number): string => (n > 0 ? `-${formatVND(n)}` : formatVND(n));

export function NetIncomePanel({ gyms }: { gyms: readonly ChartGym[] }) {
  const scope = useGymOwnerScope();
  const [days, setDays] = useState<NetRange>(90);
  const [chosen, setChosen] = useState<Granularity | null>(null);
  const todayVn = vnDateOf(Date.now());
  const range = useMemo(() => analyticsRange(todayVn, days), [todayVn, days]);
  const allowed = chartAccess(scope.can).netIncome && gyms.length > 0;
  const { states, retry } = useGymAnalytics(
    gyms.map((g) => g.id),
    range,
    allowed,
  );
  const agg = aggregateNetIncome(states, range);
  if (!allowed || !agg.visible) return null;

  const several = gyms.length > 1;
  const nameOf = (id: string) => gyms.find((g) => g.id === id)?.name ?? "";
  const gran = resolveGranularity(days, chosen);
  const grans = granularityOptions(days);
  const inc = agg.income;
  const noWallet = inc !== null && !inc.walletFound;
  const series = inc && !noWallet ? netIncomeSeries(inc.daily, range, gran) : [];
  const summary = inc && !noWallet ? netSummary(inc.totals, range, formatVND, series, gran) : "";
  const hasNegative = series.some((p) => p.net < 0);
  const unitWord = gran === "week" ? "tuần" : "ngày";
  const windowText = `${dayMonth(range.from)} đến ${dayMonth(range.to)}`;
  const failedNames = agg.failedGymIds.map((id) => nameOf(id)).join(", ");
  const unavailable = agg.unavailableGymIds.length > 0;
  const noWalletNames = agg.noWalletGymIds.map((id) => nameOf(id)).join(", ");

  return (
    <section className="go-panel go-chart-panel" aria-labelledby="go-h-net" data-testid="go-chart-net">
      <div className="go-panel-head go-panel-head-row">
        <div>
          <h2 id="go-h-net">Thực nhận theo thời gian</h2>
          <p data-testid="go-chart-net-note">{NET_CHART_NOTE}</p>
        </div>
        <div className="go-chart-controls">
          <RangeSwitch label="Khoảng thời gian" value={days} options={RANGE_OPTIONS} onChange={setDays} testId="go-net-range" />
          {grans.length > 1 && <RangeSwitch label="Gộp theo" value={gran} options={grans.map((g) => ({ value: g, text: GRAN_TEXT[g] }))} onChange={setChosen} testId="go-net-gran" />}
        </div>
      </div>

      <div className="go-chart-body">
        {agg.loading && <ChartSkeleton />}

        {unavailable && (
          <ChartState
            tone="risk"
            testId="go-net-unavailable"
            title={several ? `Chưa đọc được sổ ví của ${agg.unavailableGymIds.map((id) => nameOf(id)).join(", ")}` : "Chưa đọc được sổ ví lúc này"}
            text="Hệ thống thanh toán chưa trả lời nên chưa có số thực nhận (không phải 0 đồng). Thử lại sau ít phút."
            onRetry={retry}
          />
        )}
        {agg.failedGymIds.length > agg.unavailableGymIds.length && (
          <ChartState
            tone="risk"
            testId="go-net-error"
            title={several ? `Đã tải ${agg.loaded}/${agg.total} chi nhánh, ${failedNames} lỗi` : "Chưa tải được số liệu thực nhận"}
            text={several ? "Chưa đủ nên không có tổng." : undefined}
            onRetry={retry}
          />
        )}

        {noWallet && (
          <ChartState
            testId="go-net-no-wallet"
            title={several ? "Chưa có ví cho các chi nhánh này" : "Chưa có ví cho chi nhánh này"}
            text="Ví được tạo khi chi nhánh bán thẻ trả phí đầu tiên, nên chưa có khoản thực nhận nào."
          />
        )}

        {inc && !noWallet && (
          <>
            <div className="go-chart-kpi">
              <span className="go-chart-kpi-num" data-testid="go-chart-net-total" data-value={String(inc.totals.net)}>{formatVND(inc.totals.net)}</span>
              <span className="go-chart-kpi-unit">thực nhận, {inc.totals.sales} thẻ, {windowText}</span>
            </div>
            {several && noWalletNames && <p className="go-chart-sum" data-testid="go-net-partial-wallet">{noWalletNames} chưa có ví nên chưa có khoản nào trong tổng này.</p>}

            {inc.totals.sales === 0 && inc.totals.net === 0 && inc.totals.adjustments === 0 ? (
              <ChartState title={`Chưa có khoản thực nhận nào trong khoảng ${windowText}`} text="Chọn khoảng dài hơn để xem các khoản trước đó." testId="go-net-empty" />
            ) : (
              <>
                <div className="go-chart-plot" role="img" aria-label={`Biểu đồ cột thực nhận theo ${unitWord}. ${summary}`} data-testid="go-chart-net-plot">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={gran === "day" && days > 30 ? "10%" : "22%"}>
                      <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeDasharray="3 3" />
                      <XAxis dataKey="key" tickFormatter={(k: string) => dayMonth(k)} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis tickFormatter={compactVnd} tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} allowDecimals={false} />
                      <ReferenceLine y={0} stroke="var(--go-line-strong)" />
                      <Tooltip
                        cursor={{ fill: "var(--go-surface-2)" }}
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as { key: string; from: string; to: string; partial: boolean; net: number; gymShare: number; referralCommission: number; adjustments: number } | undefined;
                          if (!p) return null;
                          const title = gran === "week" ? `Tuần ${dayMonth(p.from)} - ${dayMonth(p.to)}${p.partial ? " (chưa đủ tuần)" : ""}` : `${WEEKDAY_FULL[weekdayOf(p.key)]} ${dayMonth(p.key)}`;
                          return (
                            <ChartTip
                              active={active}
                              title={title}
                              lines={[`Thực nhận ${signed(p.net)}`, `Phần của phòng tập ${formatVND(p.gymShare)}`, `Hoa hồng PT ${minus(p.referralCommission)}`, `Điều chỉnh ${signed(p.adjustments)}`]}
                            />
                          );
                        }}
                      />
                      <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                        {series.map((p) => (
                          <Cell key={p.key} fill={p.net < 0 ? "var(--go-risk)" : "var(--go-action)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="go-chart-sum" data-testid="go-chart-net-summary">
                  {summary}
                  {gran === "week" && " Mỗi cột là một tuần từ thứ Hai; tuần đầu và tuần hiện tại có thể chưa đủ 7 ngày."} {hasNegative && "Cột đỏ, dưới đường 0, là kỳ hoàn tiền hoặc thu hồi lớn hơn tiền thu về. "}{NET_DATE_NOTE}
                </p>

                <h3 className="go-ren-sub">Từ giá khách trả đến thực nhận</h3>
                <ul className="go-net-break" aria-label={`Thực nhận phân tích, ${windowText}`} data-testid="go-net-breakdown">
                  {netBreakdown(inc.totals).map((row) => (
                    <li key={row.key} data-key={row.key} data-strong={row.key === "net" || row.key === "gymShare" || row.key === "grossPrice" ? "true" : undefined}>
                      <span className="go-net-label">
                        {row.label}
                        <span className="go-net-hint">{row.hint}</span>
                      </span>
                      <span className="go-net-val" data-value={String(row.value)}>{row.key === "grossPrice" || row.key === "gymShare" || row.key === "net" ? formatVND(row.value) : signed(row.value)}</span>
                    </li>
                  ))}
                </ul>

                <ChartTable
                  caption={`Thực nhận theo ${unitWord}`}
                  head={[gran === "week" ? "Tuần bắt đầu" : "Ngày", "Phần của phòng tập", "Hoa hồng PT", "Điều chỉnh", "Thực nhận"]}
                  rows={series
                    .filter((p) => p.sales > 0 || p.net !== 0 || p.adjustments !== 0)
                    .map((p) => [
                      gran === "week" ? `${dayMonth(p.from)} - ${dayMonth(p.to)}${p.partial ? " (chưa đủ)" : ""}` : `${WEEKDAY_FULL[weekdayOf(p.key)]} ${dayMonth(p.key)}`,
                      formatVND(p.gymShare),
                      minus(p.referralCommission),
                      signed(p.adjustments),
                      signed(p.net),
                    ])}
                  summary="Xem bảng số liệu (chỉ các mốc có khoản)"
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
