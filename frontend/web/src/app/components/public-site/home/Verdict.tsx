import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Kicker, Wrap } from "../ui";

/** Năm quyết định cuối chu kỳ (KEEP / PROGRESS / ADJUST / DELOAD / REBUILD) — diễn giải cho người dùng. */
const VERDICTS = [
  { key: "giu", label: "Giữ", text: "Bạn đang đi đúng hướng. Giáo án hiện tại vẫn còn tác dụng, chưa cần thay đổi." },
  { key: "tang", label: "Tăng tải", text: "Bạn tập đều, sức mạnh tăng và hồi phục tốt. Chu kỳ sau nặng hơn một bậc." },
  { key: "dieu-chinh", label: "Điều chỉnh", text: "Có tín hiệu lệch, ví dụ tiến bộ chậm hoặc lịch tập khó theo. Sửa một phần giáo án thay vì làm lại." },
  { key: "giam-tai", label: "Giảm tải", text: "Mệt mỏi hoặc đau tăng lên. Chu kỳ sau nhẹ hơn để cơ thể hồi phục rồi mới đi tiếp." },
  { key: "xay-lai", label: "Xây lại", text: "Kế hoạch hiện tại không còn hợp với bạn. Gymini lập lại từ mục tiêu và số đo mới nhất." },
];

export function Verdict() {
  const [active, setActive] = useState(1);
  const [press, setPress] = useState(0);
  const pill = useRef<HTMLSpanElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const seen = useRef(false);

  const place = (animate: boolean) => {
    const p = pill.current, t = tabs.current[active];
    if (!p || !t) return;
    if (!animate) p.style.transition = "none";
    p.style.transform = `translateX(${t.offsetLeft}px)`;
    p.style.width = `${t.offsetWidth}px`;
    if (!animate) { void p.offsetWidth; p.style.transition = ""; }
    if (animate) scroller.current?.scrollTo({ left: Math.max(0, t.offsetLeft - 24), behavior: "smooth" });
  };
  useLayoutEffect(() => place(seen.current), [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onResize = () => place(false);
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(() => place(false));
    return () => window.removeEventListener("resize", onResize);
  });
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !seen.current) { seen.current = true; setPress((k) => k + 1); io.disconnect(); }
    }, { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const choose = (i: number) => { seen.current = true; setActive(i); setPress((k) => k + 1); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (active + (e.key === "ArrowRight" ? 1 : VERDICTS.length - 1)) % VERDICTS.length;
    choose(n); tabs.current[n]?.focus();
  };
  const v = VERDICTS[active];

  return (
    <section className="mt-24 bg-ps-band py-24 text-ps-band-ink sm:mt-32 sm:py-32">
      <Wrap>
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div>
            <Kicker onDark>Cuối mỗi chu kỳ</Kicker>
            <h2 className="ps-t-h2 ps-sr mt-4 max-w-[13ch]">Số liệu ra quyết định. AI giải thích.</h2>
          </div>
          <p className="ps-sr max-w-[44ch] text-[1.15rem] leading-relaxed text-ps-band-muted lg:justify-self-end">
            Quyết định do luật tính toán trên năm nhóm số liệu: mức độ tập đều, tiến bộ sức mạnh, mệt mỏi và đau,
            số đo cơ thể, và độ đầy đủ của dữ liệu. Thiếu dữ liệu thì Gymini nói rõ là chưa đủ để kết luận.
          </p>
        </div>

        <div ref={board} className="mt-14 rounded-[32px] border border-ps-band-line bg-ps-band-elev p-5 sm:p-10">
          <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            <div className="ps-seg ps-on-dark" role="tablist" aria-label="Năm quyết định cuối chu kỳ" onKeyDown={onKey}>
              <span ref={pill} className="ps-seg-pill" aria-hidden="true" />
              {VERDICTS.map((x, i) => (
                <button key={x.key} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`v-${x.key}`}
                  aria-selected={i === active} aria-controls="v-panel" tabIndex={i === active ? 0 : -1} className="ps-seg-tab" onClick={() => choose(i)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <div id="v-panel" role="tabpanel" aria-labelledby={`v-${v.key}`} className="mt-10 grid items-center gap-10 md:grid-cols-[minmax(260px,0.9fr)_1.1fr]">
            <div className="grid min-h-[150px] place-items-center">
              <span key={`${v.key}-${press}`} className={`ps-stamp text-[clamp(2.4rem,1.6rem+3vw,4.2rem)] ${press ? "ps-is-pressing" : ""}`}>{v.label}</span>
            </div>
            <p key={v.key} className="ps-swap-in max-w-[30ch] font-ps-display text-[clamp(1.4rem,1.05rem+1.2vw,2.1rem)] font-medium leading-[1.3] tracking-[-0.015em]">
              {v.text}
            </p>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
