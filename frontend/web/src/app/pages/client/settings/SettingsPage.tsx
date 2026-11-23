import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useReducedMotion } from "motion/react";
import {
  GearSixIcon as SettingsIcon, UserIcon, PaletteIcon, RulerIcon, BarbellIcon, ForkKnifeIcon, BellIcon, BrainIcon,
  ShieldWarningIcon, LinkSimpleIcon, QuestionIcon, InfoIcon, CaretRightIcon, CaretLeftIcon,
} from "@phosphor-icons/react";
import { AccountSection } from "./AccountSection";
import { AppearanceSection } from "./AppearanceSection";
import { UnitsSection } from "./UnitsSection";
import { WorkoutSection } from "./WorkoutSection";
import { NutritionSection } from "./NutritionSection";
import { NotificationsSection } from "./NotificationsSection";
import { AICoachSection } from "./AICoachSection";
import { PrivacyDataSection } from "./PrivacyDataSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { HelpAboutSection } from "./HelpAboutSection";
import { isWebPresentation } from "../../../utils/webPresentation";
import { ContextNav, type ContextNavGroup } from "../../../components/ui/nav/ContextNav";

const JUMP_LINKS = [
  { id: "account", label: "Tài khoản" },
  { id: "appearance", label: "Giao diện" },
  { id: "units", label: "Đơn vị đo" },
  { id: "workout", label: "Tập luyện" },
  { id: "nutrition", label: "Dinh dưỡng" },
  { id: "notifications", label: "Thông báo" },
  { id: "ai-coach", label: "AI Coach" },
  { id: "privacy-data", label: "Dữ liệu" },
  { id: "connections", label: "Kết nối" },
  { id: "help", label: "Trợ giúp" },
  { id: "about", label: "Giới thiệu" },
];

/**
 * Settings Center hub (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md
 * §5/§32) — composes the 11 modular section components rather than one
 * giant page.
 *
 * WEB UI prototype (frontend2/web-ui-navigation-prototype): on the WEB presentation the 11 jump-link pills are
 * replaced by contextual navigation (SettingsWorkspace). The packaged Capacitor app keeps the stacked cards + jump
 * bar (SettingsStack), unchanged (see utils/webPresentation.ts).
 */
export function SettingsPage() {
  const [web] = useState(isWebPresentation);
  return web ? <SettingsWorkspace /> : <SettingsStack />;
}

/** The previous presentation — unchanged; still what the packaged app renders. */
function SettingsStack() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <SettingsIcon className="w-5 h-5 text-zinc-300" /> Cài đặt
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tuỳ chọn ứng dụng, tài khoản và dữ liệu của bạn
        </p>
      </div>

      <div
        className="flex gap-1.5 overflow-x-auto g-scroll-x md:flex-wrap md:overflow-visible pb-1 -mx-4 px-4 md:mx-0 md:px-0 sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-sm py-2"
        data-testid="settings-jump-bar"
      >
        {JUMP_LINKS.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
          >
            {link.label}
          </a>
        ))}
      </div>

      <AllSections />
    </div>
  );
}

// memo: switching the active section re-renders only the workspace chrome, not the 10 sections (measured: every
// switch re-rendered all of them). The sections have no props; their own state/queries still update them.
const AllSections = memo(function AllSections() {
  return (
    <>
      <AccountSection />
      <AppearanceSection />
      <UnitsSection />
      <WorkoutSection />
      <NutritionSection />
      <NotificationsSection />
      <AICoachSection />
      <PrivacyDataSection />
      <ConnectionsSection />
      <HelpAboutSection />
    </>
  );
});

/* ── Web presentation ───────────────────────────────────────────────────────────────────────────── */

// Same 11 sections, same labels as the jump bar, grouped by what people come to change. Descriptions are each
// section card's own description (units/nutrition cut to their first clause), not new copy.
const META: Record<string, { icon: React.ElementType; desc: string }> = {
  account: { icon: UserIcon, desc: "Tên hiển thị, email, mật khẩu và đăng xuất" },
  "privacy-data": { icon: ShieldWarningIcon, desc: "Xuất, nhập và quản lý dữ liệu của bạn" },
  connections: { icon: LinkSimpleIcon, desc: "Đồng bộ với ứng dụng sức khoẻ khác — sắp có" },
  appearance: { icon: PaletteIcon, desc: "Chủ đề sáng/tối và ngôn ngữ hiển thị" },
  units: { icon: RulerIcon, desc: "Chiều cao, cân nặng và năng lượng" },
  notifications: { icon: BellIcon, desc: "Bật/tắt từng loại thông báo về buổi tập của bạn" },
  workout: { icon: BarbellIcon, desc: "Hành vi khi đang tập và thiết bị tập luyện của bạn" },
  nutrition: { icon: ForkKnifeIcon, desc: "Hiển thị dinh dưỡng" },
  "ai-coach": { icon: BrainIcon, desc: "Không có tuỳ chọn nào ảnh hưởng đến quyết định huấn luyện" },
  help: { icon: QuestionIcon, desc: "Câu hỏi thường gặp" },
  about: { icon: InfoIcon, desc: "Về Fitness Assistant" },
};
const GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Tài khoản & dữ liệu", ids: ["account", "privacy-data", "connections"] },
  { label: "Ứng dụng", ids: ["appearance", "units", "notifications"] },
  { label: "Tập luyện & dinh dưỡng", ids: ["workout", "nutrition", "ai-coach"] },
  { label: "Hỗ trợ", ids: ["help", "about"] },
];
const LABEL: Record<string, string> = Object.fromEntries(JUMP_LINKS.map((l) => [l.id, l.label]));
const IDS = new Set(JUMP_LINKS.map((l) => l.id));
const LIST_SCROLL_KEY = "gymini.settings.listScroll";

function useWide() {
  const q = "(min-width: 768px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
// AppShell's <main> is the scroll container (not the window).
const scroller = () => (document.querySelector("main") as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null);

/**
 * Contextual navigation (Level 2). >=768px: grouped list left, the section right. <768px: two levels — the grouped
 * list, then one section with a Back control. The section is in the URL (?section=…), so every step is a browser
 * history entry, links can be shared, and old #id links still land on the right section.
 * All 10 section components stay MOUNTED (inactive ones are display:none), so a half-typed name or password is not
 * lost when the user looks at another section. No setting, value, request or API changes.
 */
function SettingsWorkspace() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const wide = useWide();
  const panelRef = useRef<HTMLDivElement>(null);
  const detailHeadRef = useRef<HTMLHeadingElement>(null);

  const fromUrl = params.get("section");
  const urlSection = fromUrl && IDS.has(fromUrl) ? fromUrl : null;
  const active = urlSection ?? (wide ? "account" : null);

  // Old deep links (/client/settings#notifications) -> the same section, without an extra history entry.
  useEffect(() => {
    const h = location.hash.replace(/^#/, "");
    if (!urlSection && IDS.has(h)) navigate({ search: `?section=${h}`, hash: "" }, { replace: true });
  }, [location.hash, urlSection, navigate]);

  // Panel reveal + scroll/focus management when the section changes (not on first render).
  const prev = useRef<string | null>(active);
  useLayoutEffect(() => {
    if (prev.current === active) return;
    const was = prev.current;
    prev.current = active;
    const sc = scroller();
    if (!wide && active === null) {
      // back to the list: restore where the list was and focus the row we came from
      let y = 0;
      try { y = Number(sessionStorage.getItem(LIST_SCROLL_KEY) || 0); } catch { /* storage may be blocked */ }
      sc?.scrollTo({ top: y });
      (document.querySelector(`[data-settings-row="${was}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
      return;
    }
    sc?.scrollTo({ top: 0 });
    if (!wide) detailHeadRef.current?.focus({ preventScroll: true });
    if (!reduce && panelRef.current?.animate) {
      panelRef.current.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
  }, [active, wide, reduce]);

  const open = (id: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    if (id === active) return;
    if (!wide) { try { sessionStorage.setItem(LIST_SCROLL_KEY, String(scroller()?.scrollTop ?? 0)); } catch { /* storage may be blocked */ } }
    navigate({ search: `?section=${id}` }, { state: { settingsFromList: !wide } });
  };
  const back = () => {
    if ((location.state as { settingsFromList?: boolean } | null)?.settingsFromList) navigate(-1);
    else navigate({ search: "" }, { replace: true });
  };

  const groups: ContextNavGroup[] = GROUPS.map((g) => ({ label: g.label, items: g.ids.map((id) => ({ id, label: LABEL[id], icon: META[id].icon, href: `?section=${id}` })) }));
  const showList = !wide && active === null;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6" data-testid="settings-workspace">
      {/* Only the active section is shown; the rest stay mounted (drafts kept). */}
      <style>{`[data-gw-settings-panel] > section${active ? `:not(#${active})` : ""} { display: none; }`}</style>

      <header className={showList || wide ? "mb-5" : "sr-only"}>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--gw-text)]">
          <SettingsIcon className="h-5 w-5 text-[var(--gw-text-2)]" aria-hidden="true" /> Cài đặt
        </h1>
        <p className="mt-0.5 text-sm text-[var(--gw-text-2)]">Tuỳ chọn ứng dụng, tài khoản và dữ liệu của bạn</p>
      </header>

      <div className="md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        {wide && (
          <aside className="self-start md:sticky md:top-4">
            <ContextNav label="Mục cài đặt" groups={groups} active={active} onSelect={(id, e) => open(id, e)} testId="settings-context-nav" />
          </aside>
        )}

        {showList && (
          <nav aria-label="Mục cài đặt" className="space-y-5" data-testid="settings-list">
            {GROUPS.map((g) => (
              <section key={g.label} aria-labelledby={`gw-sg-${g.ids[0]}`}>
                <h2 id={`gw-sg-${g.ids[0]}`} className="mb-2 px-1 text-xs font-medium text-[var(--gw-text-3)]">{g.label}</h2>
                <div className="gw-list-group">
                  {g.ids.map((id) => {
                    const Icon = META[id].icon;
                    return (
                      <a key={id} href={`?section=${id}`} onClick={(e) => open(id, e)} className="gw-list-row" data-settings-row={id}>
                        <span className="gw-list-icon" aria-hidden="true"><Icon className="h-[18px] w-[18px]" /></span>
                        <span className="min-w-0">
                          <span className="block text-[15px] text-[var(--gw-text)]">{LABEL[id]}</span>
                          <span className="gw-list-desc block">{META[id].desc}</span>
                        </span>
                        <CaretRightIcon className="h-4 w-4 text-[var(--gw-text-3)]" aria-hidden="true" />
                      </a>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
        )}

        <div className={showList ? "hidden" : "min-w-0"}>
          {!wide && active && (
            <div className="mb-4 flex items-center gap-2">
              <button type="button" onClick={back} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-[var(--gw-r-md)] px-2 text-sm font-medium text-[var(--gw-accent-ink)] hover:bg-[var(--gw-hover)]" data-testid="settings-back">
                <CaretLeftIcon className="h-4 w-4" aria-hidden="true" /> Cài đặt
              </button>
              <h2 ref={detailHeadRef} tabIndex={-1} className="ml-auto truncate text-sm font-medium text-[var(--gw-text-2)] outline-none">{LABEL[active]}</h2>
            </div>
          )}
          <div ref={panelRef} data-gw-settings-panel className="space-y-4" data-testid="settings-panel" data-active={active ?? ""}>
            <AllSections />
          </div>
        </div>
      </div>
    </div>
  );
}
