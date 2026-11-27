/**
 * Hôm nay: "Thẻ hội viên theo trạng thái" donut + legend. Reads the `memberships.byStatus` of the stats answer Hôm nay ALREADY fetched per
 * branch (no extra request). Counts cards (contracts), not people. A `memberships: null` answer (role may not read it) draws nothing;
 * all branches = the sum, only when every branch has loaded. Every slice is named with its count and share in the legend list, so the
 * colours are never the only carrier of meaning.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import type { StatsState } from "../stats/gymStats";
import { aggregateMemberships, chartAccess, membershipSlices, membershipSummary, shareText, sliceTotal, type SliceKey } from "./chartsModel";
import { ChartSkeleton, ChartState, ChartTable, ChartTip } from "./ChartParts";

const nf = new Intl.NumberFormat("vi-VN");

/** Workspace tokens only. */
const SLICE_COLOR: Record<SliceKey, string> = {
  running: "var(--go-ok)",
  expiring: "var(--go-warn)",
  queued: "var(--go-info)",
  expired: "var(--go-neutral)",
  cancelled: "var(--go-risk)",
  pending: "var(--go-chart-5)",
  issue: "var(--go-chart-6)",
  other: "var(--go-ink-3)",
};

export function MembershipStatusPanel({ gymIds, statsById, scopeLabel, onRetry }: { gymIds: readonly string[]; statsById: Readonly<Record<string, StatsState>>; scopeLabel: string; onRetry: () => void }) {
  const scope = useGymOwnerScope();
  const allowed = chartAccess(scope.can).members && gymIds.length > 0;
  const agg = aggregateMemberships(statsById, gymIds);
  if (!allowed || !agg.visible) return null;

  const slices = agg.block ? membershipSlices(agg.block) : [];
  const total = sliceTotal(slices);
  const drawn = slices.filter((s) => s.value > 0);
  const summary = membershipSummary(slices);
  const several = agg.total > 1;

  return (
    <section className="go-panel go-chart-panel" aria-labelledby="go-h-member-status" data-testid="go-chart-members">
      <div className="go-panel-head">
        <h2 id="go-h-member-status">Thẻ hội viên theo trạng thái</h2>
        <p>{scopeLabel}. Đếm theo thẻ, không phải số người.</p>
      </div>
      <div className="go-chart-body">
        {agg.loading && <ChartSkeleton height={200} />}
        {agg.failedGymIds.length > 0 && (
          <ChartState tone="risk" testId="go-chart-members-error" title={several ? `Đã tải ${agg.loaded}/${agg.total} chi nhánh` : "Chưa tải được số thẻ hội viên"} text={several ? "Chưa đủ nên không có tổng." : undefined} onRetry={onRetry} />
        )}
        {agg.block && total === 0 && <ChartState title="Chưa có thẻ hội viên nào" text="Khi có người mua gói, số thẻ theo trạng thái sẽ hiện ở đây." testId="go-chart-members-empty" />}
        {agg.block && total > 0 && (
          <>
            <div className="go-donut">
              <div className="go-donut-plot" role="img" aria-label={`Biểu đồ tròn thẻ hội viên theo trạng thái. ${summary}`} data-testid="go-chart-members-plot">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      content={({ active, payload }) => {
                        const p = payload?.[0]?.payload as { label: string; value: number } | undefined;
                        return p ? <ChartTip active={active} title={p.label} lines={[`${nf.format(p.value)} thẻ, ${shareText(p.value, total)}`]} /> : null;
                      }}
                    />
                    <Pie data={drawn} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="96%" paddingAngle={drawn.length > 1 ? 2 : 0} stroke="var(--go-surface)" strokeWidth={2} isAnimationActive={false}>
                      {drawn.map((s) => (
                        <Cell key={s.key} fill={SLICE_COLOR[s.key]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="go-donut-center" aria-hidden="true">
                  <strong data-testid="go-chart-members-total" data-value={String(total)}>{nf.format(total)}</strong>
                  <span>thẻ</span>
                </div>
              </div>
              <ul className="go-legend" aria-label="Chú giải trạng thái thẻ" data-testid="go-chart-members-legend">
                {slices.map((s) => (
                  <li key={s.key} data-zero={s.value === 0 ? "true" : undefined} data-key={s.key}>
                    <span className="go-legend-dot" style={{ background: SLICE_COLOR[s.key] }} aria-hidden="true" />
                    <span className="go-legend-name">{s.label}</span>
                    <span className="go-legend-val">{nf.format(s.value)}</span>
                    <span className="go-legend-pct">{shareText(s.value, total)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <ChartTable caption="Số thẻ theo trạng thái" head={["Trạng thái", "Số thẻ", "Tỷ lệ", "Ý nghĩa"]} rows={slices.map((s) => [s.label, nf.format(s.value), shareText(s.value, total), s.hint])} textCols={[3]} />
          </>
        )}
      </div>
    </section>
  );
}
