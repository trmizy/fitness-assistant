/**
 * Hôm nay / Quầy lễ tân: "Giờ cao điểm" - a weekday x hour heatmap of check-ins (Vietnam time) from /analytics `heatmap`. The grid draws
 * 5:00-23:00 (widened, never cropped, when check-ins fall outside), every non-empty cell prints its count, the busiest cell has a heavy
 * outline and the busiest time is also written out in words, so colour is never the only carrier of meaning. In a narrow panel the grid
 * turns (hours down, weekdays across) instead of scrolling the page. All branches = the sum, only when every branch has loaded; a
 * `heatmap: null` answer (role may not read it) draws nothing. Shaping rules live in analyticsModel.ts.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { HEAT_RANGES, aggregateHeatmaps, analyticsRange, compactHourWindow, heatLevel, heatmapSummary, hourLabel, hourRangeLabel, peakText, WEEKDAY_LONG, WEEKDAY_SHORT_MON, type HeatRange } from "./analyticsModel";
import { chartAccess, vnDateOf } from "./chartsModel";
import { ChartSkeleton, ChartState, ChartTable, RangeSwitch } from "./ChartParts";
import { useGymAnalytics } from "./useGymAnalytics";
import type { ChartGym } from "./CheckinTrendPanel";

const nf = new Intl.NumberFormat("vi-VN");
const RANGE_OPTIONS = HEAT_RANGES.map((d) => ({ value: d, text: `${d} ngày` }));
const LEGEND_LEVELS = [0.15, 0.4, 0.7, 1];

export function HeatmapPanel({ gyms }: { gyms: readonly ChartGym[] }) {
  const scope = useGymOwnerScope();
  const [days, setDays] = useState<HeatRange>(90);
  const todayVn = vnDateOf(Date.now());
  const range = useMemo(() => analyticsRange(todayVn, days), [todayVn, days]);
  const allowed = chartAccess(scope.can).heatmap && gyms.length > 0;
  const { states, retry } = useGymAnalytics(
    gyms.map((g) => g.id),
    range,
    allowed,
  );
  const agg = aggregateHeatmaps(states);
  if (!allowed || !agg.visible) return null;

  const several = gyms.length > 1;
  const nameOf = (id: string) => gyms.find((g) => g.id === id)?.name ?? "";
  const heat = agg.heat;
  const win = heat ? compactHourWindow(heat.byHour) : null;
  const hours = win ? Array.from({ length: win.to - win.from + 1 }, (_, i) => win.from + i) : [];
  const max = heat ? Math.max(0, ...heat.matrix.flat()) : 0;
  const summary = heat ? heatmapSummary(heat, days) : "";
  const scopeLine = several ? `Tất cả ${agg.total} chi nhánh cộng lại, ${days} ngày gần nhất, giờ Việt Nam` : `${gyms[0].name}, ${days} ngày gần nhất, giờ Việt Nam`;

  return (
    <section className="go-panel go-chart-panel" aria-labelledby="go-h-heatmap" data-testid="go-chart-heatmap">
      <div className="go-panel-head go-panel-head-row">
        <div>
          <h2 id="go-h-heatmap">Giờ cao điểm</h2>
          <p>{scopeLine}</p>
        </div>
        <div className="go-chart-controls">
          <RangeSwitch label="Khoảng thời gian" value={days} options={RANGE_OPTIONS} onChange={setDays} testId="go-heat-range" />
        </div>
      </div>

      <div className="go-chart-body">
        {agg.loading && <ChartSkeleton />}
        {agg.failedGymIds.length > 0 && (
          <ChartState
            tone="risk"
            testId="go-heatmap-error"
            title={several ? `Đã tải ${agg.loaded}/${agg.total} chi nhánh, ${agg.failedGymIds.map((id) => nameOf(id)).join(", ")} lỗi` : "Chưa tải được giờ cao điểm"}
            text={several ? "Chưa đủ nên không có biểu đồ tổng." : undefined}
            onRetry={retry}
          />
        )}

        {heat && win && heat.total === 0 && <ChartState title={`Chưa có lượt check-in nào trong ${days} ngày qua`} text="Khi hội viên check-in, giờ đông khách sẽ hiện ở đây." testId="go-heatmap-empty" />}

        {heat && win && heat.total > 0 && (
          <>
            <div className="go-chart-kpi">
              <span className="go-chart-kpi-num" data-testid="go-heatmap-total" data-value={String(heat.total)}>{nf.format(heat.total)}</span>
              <span className="go-chart-kpi-unit">lượt check-in trong {days} ngày</span>
            </div>
            <p className="go-heat-peak" data-testid="go-heatmap-peak" data-weekday={heat.peak?.weekday} data-hour={heat.peak?.hour} data-count={heat.peak?.count}>
              {peakText(heat.peak)}
            </p>

            <div className="go-heat" data-testid="go-heatmap-wrap">
              <div className="go-heat-grid" role="img" aria-label={`Bản đồ nhiệt check-in theo thứ và giờ. ${summary}`} style={{ "--n": hours.length } as CSSProperties} data-testid="go-heatmap-grid">
                <span className="go-heat-corner" aria-hidden="true" />
                {hours.map((h, i) => (
                  <span key={`h${h}`} className="go-heat-hl" style={{ "--c": i + 2 } as CSSProperties} aria-hidden="true">
                    <span className="go-heat-h-s">{h}</span>
                    <span className="go-heat-h-l">{hourLabel(h)}</span>
                  </span>
                ))}
                {WEEKDAY_SHORT_MON.map((w, r) => (
                  <span key={`w${w}`} className="go-heat-wl" style={{ "--r": r + 2 } as CSSProperties} aria-hidden="true">
                    {w}
                  </span>
                ))}
                {WEEKDAY_SHORT_MON.map((_, r) =>
                  hours.map((h, i) => {
                    const n = heat.matrix[r][h];
                    const lv = heatLevel(n, max);
                    const isPeak = heat.peak !== null && heat.peak.weekday === r + 1 && heat.peak.hour === h;
                    return (
                      <span
                        key={`${r}-${h}`}
                        className="go-heat-cell"
                        style={{ "--r": r + 2, "--c": i + 2, "--lv": lv } as CSSProperties}
                        data-peak={isPeak ? "true" : undefined}
                        data-count={n}
                        title={`${WEEKDAY_LONG[r]} ${hourRangeLabel(h)}: ${n} lượt`}
                        aria-hidden="true"
                      >
                        {n > 0 ? n : ""}
                      </span>
                    );
                  }),
                )}
              </div>
            </div>

            <div className="go-heat-legend" aria-hidden="true">
              <span>Ít</span>
              {LEGEND_LEVELS.map((lv) => (
                <span key={lv} className="go-heat-swatch" style={{ "--lv": lv } as CSSProperties} />
              ))}
              <span>Nhiều</span>
              <span className="go-heat-legend-note">Mỗi ô ghi số lượt; ô viền đậm là giờ đông nhất. Số ở đầu cột (hoặc hàng) là giờ bắt đầu, ví dụ 18 = 18:00-19:00.</span>
            </div>

            <p className="go-chart-sum" data-testid="go-heatmap-summary">
              {summary} Chỉ hiện {hourLabel(win.from)}-{hourLabel((win.to + 1) % 24)}{win.from < 5 || win.to > 22 ? " (mở rộng vì có check-in ngoài khung 5:00-23:00)" : ""}.
            </p>
            <ChartTable
              caption="Số lượt check-in theo giờ và thứ"
              head={["Giờ", ...WEEKDAY_SHORT_MON, "Tổng"]}
              rows={hours.map((h) => [hourRangeLabel(h), ...WEEKDAY_SHORT_MON.map((_, r) => nf.format(heat.matrix[r][h])), nf.format(heat.byHour[h])])}
            />
          </>
        )}
      </div>
    </section>
  );
}
