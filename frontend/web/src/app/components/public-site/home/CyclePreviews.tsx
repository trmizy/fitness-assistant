import { CheckIcon } from "@phosphor-icons/react";

/** Các màn minh hoạ cho bốn bước của một chu kỳ. Số liệu là VÍ DỤ. */

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ps-line py-3.5 last:border-0">
      <span className="text-ps-ink-2">{k}</span>
      <span className="ps-tnum text-right">
        <span className="font-ps-display text-[1.35rem] font-semibold tracking-[-0.01em] text-ps-ink">{v}</span>
        {sub && <span className="ml-1.5 text-[0.85rem] text-ps-ink-3">{sub}</span>}
      </span>
    </div>
  );
}

export function PreviewBaseline() {
  const macros = [
    { k: "Đạm", g: 140, kcal: 560, c: "bg-ps-accent" },
    { k: "Tinh bột", g: 240, kcal: 960, c: "bg-[color:var(--ps-accent-bright)]/60" },
    { k: "Béo", g: 70, kcal: 630, c: "bg-ps-ink-3/50" },
  ];
  return (
    <div>
      <p className="text-[0.9rem] text-ps-ink-3">Mốc đầu chu kỳ 3</p>
      <div className="mt-2">
        <Row k="Cân nặng" v="68,4" sub="kg" />
        <Row k="Khối lượng cơ xương" v="29,1" sub="kg" />
        <Row k="Mỡ cơ thể" v="21,6" sub="%" />
      </div>
      <div className="mt-6 rounded-2xl bg-ps-sunk p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[0.9rem] text-ps-ink-2">Mục tiêu năng lượng</p>
          <p className="ps-tnum font-ps-display text-[1.35rem] font-semibold">2.150 <span className="text-[0.85rem] font-normal text-ps-ink-3">kcal/ngày</span></p>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
          {macros.map((m) => <span key={m.k} className={m.c} style={{ width: `${(m.kcal / 2150) * 100}%` }} />)}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[0.85rem]">
          {macros.map((m) => <p key={m.k} className="text-ps-ink-2"><span className="ps-tnum font-semibold text-ps-ink">{m.g} g</span> {m.k.toLowerCase()}</p>)}
        </div>
      </div>
    </div>
  );
}

export function PreviewSession() {
  const sets = [
    { kg: 70, r: 5, done: true }, { kg: 70, r: 5, done: true }, { kg: 70, r: 5, done: true }, { kg: 70, r: 5, done: false }, { kg: 70, r: 5, done: false },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-ps-display text-[1.5rem] font-semibold tracking-[-0.015em]">Squat với tạ đòn</p>
        <p className="text-[0.9rem] text-ps-ink-3">Hiệp 4 / 5</p>
      </div>
      <div className="mt-4 grid gap-2">
        {sets.map((s, i) => (
          <div key={i} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${i === 3 ? "border-ps-accent bg-ps-accent-soft" : "border-ps-line bg-ps-elev"}`}>
            <span className="text-ps-ink-2">Hiệp {i + 1}</span>
            <span className="ps-tnum font-semibold">{s.kg} kg × {s.r}</span>
            <span className={`grid h-7 w-7 place-items-center rounded-full ${s.done ? "bg-ps-accent text-ps-accent-ink" : "border border-ps-line-strong"}`}>
              {s.done && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-ps-sunk px-4 py-3">
        <span className="text-ps-ink-2">Cảm nhận độ nặng (RPE)</span>
        <span className="ps-tnum font-ps-display text-[1.25rem] font-semibold">8 / 10</span>
      </div>
    </div>
  );
}

export function PreviewNutrition() {
  const meals = [
    { k: "Bữa sáng", v: "Phở bò", kcal: 520, done: true },
    { k: "Bữa trưa", v: "Cơm gà, rau luộc", kcal: 640, done: true },
    { k: "Bữa phụ", v: "Sữa chua Hy Lạp", kcal: 180, done: true },
    { k: "Bữa tối", v: "Cá hồi, khoai lang", kcal: 610, done: false },
  ];
  const eaten = meals.filter((m) => m.done).reduce((s, m) => s + m.kcal, 0);
  const r = 52, c = 2 * Math.PI * r, pct = eaten / 2150;
  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="relative mx-auto h-[136px] w-[136px]">
        <svg viewBox="0 0 136 136" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="68" cy="68" r={r} fill="none" stroke="var(--ps-line)" strokeWidth="12" />
          <circle cx="68" cy="68" r={r} fill="none" stroke="var(--ps-accent)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <p className="ps-tnum font-ps-display text-[1.6rem] font-semibold leading-none">{eaten.toLocaleString("vi-VN")}</p>
          <p className="mt-1 text-[0.8rem] text-ps-ink-3">/ 2.150 kcal</p>
        </div>
      </div>
      <div className="grid gap-2">
        {meals.map((m) => (
          <div key={m.k} className="flex items-center gap-3 rounded-xl border border-ps-line bg-ps-elev px-4 py-2.5">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${m.done ? "bg-ps-accent text-ps-accent-ink" : "border border-ps-line-strong"}`}>
              {m.done && <CheckIcon size={13} weight="bold" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8rem] text-ps-ink-3">{m.k}</p>
              <p className="truncate font-medium">{m.v}</p>
            </div>
            <span className="ps-tnum text-[0.9rem] text-ps-ink-2">{m.kcal} kcal</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PreviewAssessment() {
  const metrics = [
    { k: "Tập đều", v: "11/12 buổi", w: 92 },
    { k: "Sức mạnh", v: "Squat 66 → 70 kg", w: 78 },
    { k: "Mệt mỏi và đau", v: "Thấp", w: 24 },
    { k: "Số đo cơ thể", v: "−0,9 kg mỡ", w: 64 },
    { k: "Độ đầy đủ dữ liệu", v: "Đủ để kết luận", w: 100 },
  ];
  return (
    <div className="relative">
      <div className="grid gap-3.5">
        {metrics.map((m) => (
          <div key={m.k}>
            <div className="flex items-baseline justify-between gap-3 text-[0.95rem]">
              <span className="text-ps-ink-2">{m.k}</span>
              <span className="ps-tnum font-semibold">{m.v}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ps-sunk">
              <div className="h-full rounded-full bg-ps-accent" style={{ width: `${m.w}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-ps-band p-4 text-ps-band-ink">
        <div>
          <p className="text-[0.85rem] text-ps-band-muted">Quyết định chu kỳ 3</p>
          <p className="mt-0.5 text-[0.95rem]">Chu kỳ 4 nặng hơn một bậc.</p>
        </div>
        <span className="ps-stamp ps-is-pressing text-[1.35rem]">Tăng tải</span>
      </div>
    </div>
  );
}
