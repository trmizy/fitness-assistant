import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { TempoField } from "../../components/landing/TempoField";
// Motion tokens (mirror of styles/gymini-motion.css, seconds for Motion).
const dur = { quick: 0.15, fast: 0.25, slow: 0.4, emphasis: 0.5 } as const;
const ease = { smoothOut: [0.22, 1, 0.36, 1] as const };
// Illustration content for the product frames (marked as illustration in the footer).
const todaySession = {
  name: "Thân trên — Đẩy",
  exercises: [
    { name: "Đẩy ngực tạ đòn", sets: "4 × 6–8", load: "60 kg" },
    { name: "Đẩy vai tạ đơn", sets: "3 × 8–10", load: "16 kg" },
    { name: "Dips song song", sets: "3 × 10", load: "Thân trọng" },
    { name: "Duỗi tay cáp", sets: "3 × 12", load: "20 kg" },
  ],
};
/* Headline lines rise once out of a clip; real text from first paint (opacity .001, not hidden). */
function RevealLines({ lines, className = "", delay = 0.05 }: { lines: ReactNode[]; className?: string; delay?: number }) {
  return (
    <span className={className}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span className="block" initial={{ y: "0.6em", opacity: 0.001 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: dur.emphasis, ease: ease.smoothOut, delay: delay + i * 0.08 }}>
            {l}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/*
 * Public landing /gioi-thieu (Frontend 2.0, owner D2/D3: separate route, "/" untouched for Capacitor).
 * Ported from the Gate A prototype. Today "/" redirects to /login — there is no
 * marketing page. This is a PROPOSAL surface (product decision needed before build).
 * Copy is taken from the live LoginPage; no metric, quote or logo is invented.
 */
const chapters = [
  { id: "measure", step: "01", title: "Đo đúng cơ thể bạn", body: "Tải phiếu InBody, Gymini đọc thành phần cơ thể theo từng vùng và cho bạn biết điều gì đang thay đổi." },
  { id: "plan", step: "02", title: "Kế hoạch tập và dinh dưỡng từ AI", body: "Lịch tập dựng trên dụng cụ bạn có và mục tiêu bạn chọn, kèm lượng calo và macro mỗi ngày." },
  { id: "coach", step: "03", title: "Huấn luyện viên đi cùng bạn", body: "Đặt lịch với PT, nhắn tin và để PT điều chỉnh kế hoạch theo tiến độ thật." },
] as const;

/*
 * ANIMATION PILOT (owner TASK 4, prototype branch only). Gymini's own take on a floating navbar:
 * transparent over the hero, then — past 24px of scroll — a compact floating bar on the card token
 * (no brand photo, no copied layout). One indicator slides between the link under the pointer/focus
 * and the section in view (aria-current="location"). Fixed + out of flow and only transform / opacity /
 * colour animate, so it cannot cause layout shift. Reduced motion: same states, no movement.
 */
const navLinks = [
  { href: "#how", id: "how", label: "Cách hoạt động" },
  { href: "#roles", id: "roles", label: "Vai trò" },
] as const;

function LandingNav({ reduced }: { reduced: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [inView, setInView] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const els = navLinks.map((l) => document.getElementById(l.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setInView(visible.target.id);
        else if (window.scrollY < 200) setInView(null);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5] },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  const marked = hover ?? inView;
  return (
    <header className="fixed inset-x-0 top-0 z-30 px-3 pt-3 sm:px-4" data-scrolled={scrolled || undefined}>
      <motion.div
        className="mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-2xl border px-3 sm:px-4"
        initial={false}
        animate={{
          // height is fixed on purpose: animating it would move the bar's children = a layout shift.
          backgroundColor: scrolled ? "color-mix(in srgb, var(--card-bg) 82%, transparent)" : "color-mix(in srgb, var(--card-bg) 0%, transparent)",
          borderColor: scrolled ? "var(--border-color)" : "rgba(0,0,0,0)",
          boxShadow: scrolled ? "0 10px 30px -12px rgba(0,0,0,0.45)" : "0 0 0 0 rgba(0,0,0,0)",
        }}
        transition={reduced ? { duration: 0 } : { duration: dur.fast, ease: ease.smoothOut }}
        style={{ backdropFilter: scrolled ? "blur(12px) saturate(140%)" : "none", WebkitBackdropFilter: scrolled ? "blur(12px) saturate(140%)" : "none" }}
      >
        <a href="#hero-h" className="flex items-center gap-2 rounded-lg" aria-label="Gymini, lên đầu trang">
          <img src="/pwa-icon.svg" alt="" className="h-8 w-8" />
          <span className="font-['Barlow'] text-xl font-bold">Gymini</span>
        </a>
        <nav aria-label="Trang" className="ml-auto flex items-center gap-1" onMouseLeave={() => setHover(null)}>
          {navLinks.map((l) => (
            <a
              key={l.id}
              href={l.href}
              aria-current={inView === l.id ? "location" : undefined}
              onMouseEnter={() => setHover(l.id)}
              onFocus={() => setHover(l.id)}
              onBlur={() => setHover(null)}
              className={`relative hidden rounded-lg px-3 py-2 text-sm transition-colors sm:block ${marked === l.id || inView === l.id ? "text-[var(--text-color)]" : "text-[var(--muted-text-color)]"}`}
            >
              {marked === l.id && (
                <motion.span
                  layoutId="landing-nav-indicator"
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-lg bg-[color-mix(in_srgb,var(--primary-color)_14%,transparent)]"
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }}
                />
              )}
              {l.label}
            </a>
          ))}
          <Link to="/login" className="inline-flex h-10 items-center rounded-xl border border-[var(--border-color)] px-4 text-sm font-semibold transition-colors hover:border-[var(--primary-color)]">Đăng nhập</Link>
        </nav>
      </motion.div>
    </header>
  );
}

export function LandingPage() {
  const reduced = !!useReducedMotion();
  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({ target: hero, offset: ["start start", "end start"] });
  // Restrained parallax: only the decorative field moves, 30% of scroll, transform only.
  const fieldY = useTransform(heroP, [0, 1], ["0%", reduced ? "0%" : "30%"]);
  const fieldO = useTransform(heroP, [0, 0.9], [1, reduced ? 1 : 0.15]);

  return (
    <div className="bg-[var(--bg-color)] text-[var(--text-color)]">
      <LandingNav reduced={reduced} />

      {/* ── Hero ── */}
      <section ref={hero} className="relative isolate flex min-h-[100svh] items-center overflow-hidden" aria-labelledby="hero-h">
        {reduced
          ? <div className="absolute inset-0 -z-10"><TempoField /></div>
          : <motion.div className="absolute inset-0 -z-10" style={{ y: fieldY, opacity: fieldO }}><TempoField /></motion.div>}
        <div className="mx-auto w-full max-w-6xl px-4 pt-20 pb-16 text-center md:px-6">
          <h1 id="hero-h" className="mx-auto max-w-[16ch] font-['Barlow'] text-[clamp(2.5rem,7.2vw,5.25rem)] leading-[1.02] font-bold tracking-[-0.025em] [overflow-wrap:break-word]">
            <RevealLines lines={["Trợ lý tập luyện", <span key="g" className="text-[var(--primary-color)]">thông minh của bạn</span>]} />
          </h1>
          <motion.p
            className="mx-auto mt-6 max-w-[46ch] text-[clamp(1rem,1.6vw,1.15rem)] leading-relaxed text-[var(--muted-text-color)]"
            initial={{ opacity: 0.001, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.slow, ease: ease.smoothOut, delay: 0.28 }}
          >
            Kế hoạch tập luyện từ AI, phân tích InBody và huấn luyện viên chuyên nghiệp trong một nền tảng.
          </motion.p>
          <motion.div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            initial={{ opacity: 0.001, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.slow, ease: ease.smoothOut, delay: 0.38 }}>
            <Link to="/register" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[var(--st-success)] px-6 font-semibold text-[var(--primary-foreground)] dark:bg-[var(--button-bg)] dark:text-[var(--button-text)] sm:w-auto">Tạo tài khoản</Link>
            <a href="#how" className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[var(--border-color)] px-6 font-semibold sm:w-auto">Xem cách hoạt động</a>
          </motion.div>
        </div>
      </section>

      {/* ── Pinned storytelling (desktop) / stacked chapters (mobile) ── */}
      <Story reduced={reduced} />

      {/* ── Roles ── */}
      <section id="roles" className="border-t border-[var(--border-color)]" aria-labelledby="roles-h">
        <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
          <h2 id="roles-h" className="max-w-[20ch] font-['Barlow'] text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">Một tài khoản, nhiều vai trò</h2>
          <p className="mt-3 max-w-[52ch] text-[var(--muted-text-color)]">Huấn luyện viên PT vẫn giữ toàn quyền theo dõi tập luyện cá nhân, đồng thời có không gian làm việc chuyên nghiệp.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { to: "/register", t: "Học viên", d: "Lịch tập hôm nay, tiến độ cơ thể và AI Coach luôn sẵn sàng." },
              { to: "/register", t: "Huấn luyện viên PT", d: "Một không gian theo dõi từng học viên: tập luyện, dinh dưỡng, tiến độ." },
              { to: "/partner/apply", t: "Chủ phòng gym", d: "Hội viên, check-in, gói bán và đối tác PT ở cùng một nơi." },
            ].map((r) => (
              <Link key={r.t} to={r.to} className="g-card-link block rounded-2xl border border-[var(--border-color)] bg-[var(--card)] p-6">
                <h3 className="text-lg">{r.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-text-color)]">{r.d}</p>
                <span className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-[var(--st-success)]">Bắt đầu <Arrow /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Close ── */}
      <section className="border-t border-[var(--border-color)]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 md:flex-row md:items-center md:justify-between md:px-6">
          <h2 className="max-w-[18ch] font-['Barlow'] text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">Bắt đầu buổi tập đầu tiên hôm nay</h2>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link to="/register" className="inline-flex h-12 items-center justify-center rounded-xl bg-[var(--st-success)] px-6 font-semibold text-[var(--primary-foreground)] dark:bg-[var(--button-bg)] dark:text-[var(--button-text)]">Tạo tài khoản</Link>
            <Link to="/partner/apply" className="inline-flex h-12 items-center justify-center rounded-xl border border-[var(--border-color)] px-6 font-semibold">Đăng ký làm đối tác phòng tập</Link>
          </div>
        </div>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-[var(--muted-text-color)] md:px-6">© Gymini · Hình giao diện trên trang là minh hoạ</footer>
      </section>
    </div>
  );
}

function Story({ reduced }: { reduced: boolean }) {
  const wrap = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: wrap, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(2, Math.max(0, Math.floor(v * 3 - 0.0001)))));

  return (
    <section id="how" ref={wrap} className="relative border-t border-[var(--border-color)] md:h-[300vh]" aria-labelledby="how-h">
      <h2 id="how-h" className="sr-only">Cách Gymini hoạt động</h2>
      {/* Desktop: one pinned stage; the product frame swaps as chapters advance. */}
      <div className="sticky top-0 hidden h-screen md:block">
        <div className="mx-auto grid h-full max-w-6xl grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-12 px-6">
          <ol className="space-y-8">
            {chapters.map((c, i) => (
              <li key={c.id} className="relative pl-6" aria-current={i === active ? "step" : undefined}>
                <span className="absolute top-1 bottom-1 left-0 w-[3px] overflow-hidden rounded-full bg-[var(--border-color)]">
                  <motion.span className="block h-full w-full origin-top bg-[var(--primary-color)]" animate={{ scaleY: i === active ? 1 : i < active ? 1 : 0, opacity: i === active ? 1 : 0.35 }} transition={{ duration: reduced ? 0 : dur.slow, ease: ease.smoothOut }} />
                </span>
                {/* Dim by colour, never by opacity: opacity on muted text drops it under 4.5:1. */}
                <div>
                  <span className="tabular text-sm text-[var(--muted-text-color)]">{c.step}</span>
                  <h3 className="mt-1 font-['Barlow'] text-2xl transition-colors duration-[250ms]" style={{ color: i === active ? "var(--text-color)" : "var(--muted-text-color)" }}>{c.title}</h3>
                  <p className="mt-2 max-w-[40ch] text-[var(--muted-text-color)]">{c.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <ProductFrame>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={active} initial={{ opacity: 0, y: reduced ? 0 : 10, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: dur.quick } }} transition={{ duration: dur.slow, ease: ease.smoothOut }}>
                {active === 0 ? <InBodyMock /> : active === 1 ? <PlanMock /> : <CoachMock />}
              </motion.div>
            </AnimatePresence>
          </ProductFrame>
        </div>
      </div>
      {/* Mobile: no pinning, no scroll-linked motion — each chapter with its own frame. */}
      <div className="space-y-14 px-4 py-16 md:hidden">
        {chapters.map((c, i) => (
          <div key={c.id}>
            <span className="tabular text-sm text-[var(--muted-text-color)]">{c.step}</span>
            <h3 className="mt-1 font-['Barlow'] text-2xl">{c.title}</h3>
            <p className="mt-2 text-[var(--muted-text-color)]">{c.body}</p>
            <div className="mt-5"><ProductFrame>{i === 0 ? <InBodyMock /> : i === 1 ? <PlanMock /> : <CoachMock />}</ProductFrame></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card)] p-2 shadow-[var(--adm-shadow-pop)]">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-2" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-[var(--border-color)]" /><span className="h-2 w-2 rounded-full bg-[var(--border-color)]" /><span className="h-2 w-2 rounded-full bg-[var(--border-color)]" />
      </div>
      <div className="min-h-[340px] rounded-xl bg-[var(--bg-color)] p-5">{children}</div>
    </div>
  );
}

function InBodyMock() {
  const seg = [{ k: "Tay trái", v: 3.1 }, { k: "Tay phải", v: 3.2 }, { k: "Thân", v: 25.4 }, { k: "Chân trái", v: 9.0 }, { k: "Chân phải", v: 9.1 }];
  return (
    <div>
      <div className="flex items-baseline justify-between"><h4 className="text-base">Phân tích InBody</h4><span className="text-xs text-[var(--muted-text-color)]">Đo ngày 14/11</span></div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {[["Cân nặng", "71,4 kg"], ["Cơ xương", "33,1 kg"], ["Mỡ cơ thể", "17,8%"]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-[var(--border-color)] p-3"><div className="text-xs text-[var(--muted-text-color)]">{k}</div><div className="tabular mt-1 text-lg font-semibold">{v}</div></div>
        ))}
      </div>
      <div className="mt-5 space-y-2.5">
        {seg.map((s) => (
          <div key={s.k} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
            <span className="text-[var(--muted-text-color)]">{s.k}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]"><span className="block h-full rounded-full bg-[var(--primary-color)]" style={{ width: `${Math.min(100, (s.v / 26) * 100)}%` }} /></span>
            <span className="tabular text-right">{s.v.toFixed(1).replace(".", ",")} kg</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanMock() {
  return (
    <div>
      <div className="flex items-baseline justify-between"><h4 className="text-base">Hôm nay · {todaySession.name}</h4><span className="text-xs text-[var(--muted-text-color)]">Tuần 3 / 8</span></div>
      <ul className="mt-4 divide-y divide-[var(--border-color)]">
        {todaySession.exercises.map((e) => (
          <li key={e.name} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{e.name}</span><span className="tabular shrink-0 text-[var(--muted-text-color)]">{e.sets} · {e.load}</span></li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
        {[["Calo", "2.450"], ["Đạm", "150 g"], ["Tinh bột", "280 g"], ["Béo", "75 g"]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-[var(--panel-bg)] p-2"><div className="text-[var(--muted-text-color)]">{k}</div><div className="tabular mt-0.5 font-semibold">{v}</div></div>
        ))}
      </div>
    </div>
  );
}

function CoachMock() {
  return (
    <div className="flex h-full flex-col gap-3 text-sm">
      <h4 className="text-base">PT Lý Văn Đức</h4>
      <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-[var(--panel-bg)] px-4 py-2.5">Buổi đẩy ngực hôm qua em đạt 4 × 8 ở 60 kg rồi. Tuần này mình lên 62,5 kg nhé.</div>
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-[color-mix(in_srgb,var(--primary-color)_16%,transparent)] px-4 py-2.5">Dạ, em sẽ thử ở buổi thứ Năm.</div>
      <div className="mt-auto rounded-xl border border-[var(--border-color)] p-3">
        <div className="text-xs text-[var(--muted-text-color)]">PT đã điều chỉnh kế hoạch</div>
        <div className="mt-1 flex justify-between"><span>Đẩy ngực tạ đòn</span><span className="tabular"><s className="text-[var(--muted-text-color)]">60 kg</s> → 62,5 kg</span></div>
      </div>
    </div>
  );
}

const Arrow = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 7h8M8 4l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
