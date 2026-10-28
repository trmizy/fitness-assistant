import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import {
  axisLabel,
  centsToDong,
  formatDong,
  formatShare,
  niceScale,
  type ChartPoint,
  type MoneyMap,
  type MoneySegment,
  type MoneyToken,
} from "./adminFinanceOverview.utils";

/** Which `--money-*` pocket colour a token uses. Colour is never the only carrier: every segment has a text row. */
const TOKEN_VAR: Record<MoneyToken, string> = {
  held: "var(--money-held)",
  pending: "var(--money-pending)",
  available: "var(--money-available)",
  locked: "var(--money-locked)",
  out: "var(--money-out)",
  revenue: "var(--money-revenue)",
};

const CARD = "rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card sm:p-5";

// ──────────────────────────────────────────────────────────── bản đồ tiền ──
/**
 * "Bản đồ tiền đang giữ hộ" — a stacked bar (100% = total claims, which equals ESCROW when the books balance) plus
 * an exact table. Replaces a Sankey: same information, readable at 390px, keyboard reachable. Hovering/focusing a
 * segment highlights its table row and vice-versa.
 */
export function MoneyMapCard({ map, dimmed }: { map: MoneyMap; dimmed?: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const hasMoney = map.claimsCents > 0n;
  const drawn = map.segments.filter((s) => s.cents !== null && s.cents > 0n);
  const parties = (() => {
    const order: string[] = [];
    const byParty = new Map<string, { sum: bigint; segs: MoneySegment[] }>();
    for (const s of drawn) {
      if (!byParty.has(s.party)) {
        byParty.set(s.party, { sum: 0n, segs: [] });
        order.push(s.party);
      }
      const g = byParty.get(s.party)!;
      g.sum += s.cents ?? 0n;
      g.segs.push(s);
    }
    return order.map((p) => ({ party: p, ...byParty.get(p)! }));
  })();

  return (
    <div
      data-testid="finance-money-map"
      className={`${CARD} transition-opacity motion-reduce:transition-none ${dimmed ? "opacity-85" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-bold text-adm-text">Bản đồ tiền đang giữ hộ</h2>
        <p className="text-xs text-adm-text-2">
          Mỗi đoạn là quyền đòi của một bên ở một ngăn · 100% = tổng quyền đòi {formatDong(centsToDong(map.claimsCents))}
        </p>
      </div>

      {hasMoney ? (
        <div className="mt-4">
          <div role="group" aria-label="Bản đồ tiền đang giữ hộ — các đoạn theo bên và ngăn" className="flex h-8 gap-1.5 sm:h-9">
            {parties.map((g) => (
              <div key={g.party} className="flex min-w-0 gap-0.5" style={{ flexGrow: Number(g.sum), flexBasis: 0 }}>
                {g.segs.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    data-testid={`mm-seg-${s.key}`}
                    aria-label={`${s.label}: ${formatDong(s.dong)}, ${formatShare(s.shareBp)}`}
                    onMouseEnter={() => setActive(s.key)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(s.key)}
                    onBlur={() => setActive(null)}
                    className={`min-w-[3px] rounded-[3px] transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] motion-reduce:transition-none ${
                      active && active !== s.key ? "opacity-40" : ""
                    }`}
                    style={{ flexGrow: Number(s.cents), flexBasis: 0, background: TOKEN_VAR[s.token] }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div aria-hidden className="mt-1.5 flex gap-1.5">
            {parties.map((g) => (
              <div
                key={g.party}
                className="min-w-0 truncate text-[11px] text-adm-text-2"
                style={{ flexGrow: Number(g.sum), flexBasis: 0 }}
                title={g.party}
              >
                {Number((g.sum * 100n) / map.claimsCents) >= 8 ? g.party : ""}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-adm-text-2" data-testid="mm-empty">
          Hiện chưa có quyền đòi nào trong sổ ví — chưa có tiền đang giữ hộ.
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-adm-border">
        <table className="w-full min-w-[320px] text-[13px]">
          <caption className="sr-only">Quyền đòi của từng bên theo từng ngăn</caption>
          <thead className="bg-adm-surface-2 text-xs text-adm-text-2">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                Bên và ngăn
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Số tiền
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Tỷ lệ
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-adm-border-soft">
            {map.segments.map((s) => (
              <tr
                key={s.key}
                data-testid={`mm-row-${s.key}`}
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
                className={active === s.key ? "bg-adm-surface-2" : ""}
              >
                <th scope="row" className="px-3 py-2.5 text-left font-normal text-adm-text">
                  <span aria-hidden className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: TOKEN_VAR[s.token] }} />
                  {s.label}
                </th>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatDong(s.dong)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text-2">{formatShare(s.shareBp)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-adm-border bg-adm-surface-2 font-bold">
              <th scope="row" className="px-3 py-2.5 text-left text-adm-text">
                Tổng quyền đòi của các bên
              </th>
              <td data-testid="mm-total" className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">
                {formatDong(centsToDong(map.claimsCents))}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text-2">{hasMoney ? "100%" : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {(map.unexplainedCents !== 0n || map.missingKeys.length > 0) && (
        <p
          role="note"
          data-testid="mm-unexplained"
          className="mt-3 flex items-start gap-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2 text-xs text-st-warning"
        >
          <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Các ngăn ở trên cộng lại chưa khớp tổng quyền đòi
            {map.unexplainedCents !== 0n ? ` (chênh ${formatDong(centsToDong(map.unexplainedCents))})` : ""}
            {map.missingKeys.length > 0 ? `; máy chủ không trả ${map.missingKeys.length} ngăn` : ""}. Hãy xem tab Đối soát trước khi dựa vào bản đồ này.
          </span>
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────── biểu đồ vào/ra ──
const MOBILE_BREAK = 500;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(el.clientWidth, 260));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, 260)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/**
 * Double-bar chart (income vs expense per bucket), hand-drawn SVG: has axes, a legend, a tooltip, and is operated
 * from the keyboard as ONE tab stop (←/→/Home/End move between buckets; the position is announced). The exact
 * numbers are in the collapsible table under it.
 */
export function FlowChart({ points, noun }: { points: ChartPoint[]; noun: string }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => setActive(null), [points]);

  const small = w < MOBILE_BREAK;
  const H = small ? 220 : 270;
  const ml = small ? 46 : 56;
  const mr = 6;
  const mt = 10;
  const mb = 28;
  const iw = w - ml - mr;
  const ih = H - mt - mb;
  const maxDong = points.reduce((m, p) => Math.max(m, Number(p.income), Number(p.expense)), 0);
  const { step, top } = niceScale(maxDong);
  const gw = iw / Math.max(points.length, 1);
  const bw = Math.max(2, Math.min(18, gw * 0.36));
  const y = (v: number) => mt + ih - (v / top) * ih;
  const every = Math.ceil(points.length / Math.max(2, Math.floor(iw / 62)));
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === null ? 0 : Math.min(last, active + 1);
    else if (e.key === "ArrowLeft") next = active === null ? last : Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };

  const cur = active === null ? null : points[active];
  const tipLeft = active === null ? 0 : Math.min(Math.max(ml + gw * active + gw / 2, 90), w - 90);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-adm-text-2" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: TOKEN_VAR.held }} /> Tiền vào
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: TOKEN_VAR.out }} /> Tiền ra
        </span>
      </div>
      <div
        ref={ref}
        data-testid="finance-flow-chart"
        role="group"
        tabIndex={0}
        aria-label={`Biểu đồ cột đôi tiền vào và tiền ra theo ${noun}, ${points.length} cột. Dùng phím mũi tên trái phải để xem từng cột.`}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => (a === null ? 0 : a))}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="relative rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]"
      >
        <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} aria-hidden className="block max-w-full">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={ml} x2={w - mr} y1={y(v)} y2={y(v)} stroke="var(--adm-border)" strokeOpacity={v ? 0.7 : 1} />
              <text x={ml - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--adm-text-2)">
                {axisLabel(v)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = ml + gw * i + gw / 2;
            const inc = Number(p.income);
            const exp = Number(p.expense);
            return (
              <g key={i} opacity={active !== null && active !== i ? 0.45 : 1} onMouseEnter={() => setActive(i)}>
                <rect x={ml + gw * i} y={mt} width={gw} height={ih} fill="transparent" />
                <rect x={cx - bw - 1} y={y(inc)} width={bw} height={mt + ih - y(inc)} rx={2} fill={TOKEN_VAR.held} />
                <rect x={cx + 1} y={y(exp)} width={bw} height={mt + ih - y(exp)} rx={2} fill={TOKEN_VAR.out} />
                {i % every === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--adm-text-2)">
                    {p.label.replace("Tuần ", "Tu ")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {cur && (
          <div
            data-testid="finance-chart-tip"
            aria-hidden
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-adm-border bg-adm-surface px-2.5 py-1.5 text-xs shadow-adm-pop"
            style={{ left: tipLeft }}
          >
            <div className="font-semibold text-adm-text">{cur.label}</div>
            <div className="text-adm-text-2">
              Vào <span className="tabular-nums text-adm-text">{formatDong(cur.income)}</span>
            </div>
            <div className="text-adm-text-2">
              Ra <span className="tabular-nums text-adm-text">{formatDong(cur.expense)}</span>
            </div>
          </div>
        )}
        <div role="status" className="sr-only">
          {cur ? `${cur.label}: vào ${formatDong(cur.income)}, ra ${formatDong(cur.expense)}` : ""}
        </div>
      </div>
    </div>
  );
}
