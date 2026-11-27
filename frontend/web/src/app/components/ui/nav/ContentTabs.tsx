/*
 * Level 3 — content tabs: 2–5 sibling panels of ONE object (e.g. a client's Tổng quan / Tập luyện / …).
 * Not for route navigation (links) and not for view modes (SegmentedControl).
 * ARIA (APG tabs, manual activation is not needed for cheap panels → automatic): tablist/tab with aria-controls,
 * tabpanel with aria-labelledby + tabIndex 0; roving tabindex; arrows/Home/End.
 * The caller renders the active panel inside <TabPanel>, so lazy per-tab fetching stays exactly as it was.
 */
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

const Ids = createContext<{ tab: (k: string) => string; panel: (k: string) => string } | null>(null);

export function ContentTabs<T extends string>({
  label, value, tabs, onChange, children, testId, idBase,
}: { idBase?: string; label: string; value: T; tabs: ReadonlyArray<{ key: T; label: string; icon?: React.ElementType; badge?: number }>; onChange: (k: T) => void; children: ReactNode; testId?: string }) {
  const reduce = useReducedMotion();
  const auto = useId();
  const base = idBase ?? auto;
  const ids = { tab: (k: string) => `${base}-tab-${k}`, panel: (k: string) => `${base}-panel-${k}` };
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, tabs.findIndex((t) => t.key === value));
  // On a narrow screen the bar scrolls: keep the selected tab in view (keyboard Home/End, or a programmatic change).
  // Horizontal only, inside the bar (scrollIntoView could also scroll the page vertically), and not on first render.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const tab = refs.current[idx]; const bar = tab?.parentElement;
    if (!tab || !bar) return;
    const left = tab.offsetLeft - bar.offsetLeft, right = left + tab.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollTo({ left: Math.max(0, left - 8), behavior: reduce ? "auto" : "smooth" });
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: right - bar.clientWidth + 8, behavior: reduce ? "auto" : "smooth" });
  }, [idx, reduce]);
  const move = (n: number) => { const i = (n + tabs.length) % tabs.length; onChange(tabs[i].key); refs.current[i]?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); move(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
  };
  return (
    <Ids.Provider value={ids}>
      <div role="tablist" aria-label={label} className="gw-tabs" onKeyDown={onKeyDown} data-testid={testId}>
        {tabs.map((t, i) => {
          const on = t.key === value;
          return (
            <button key={t.key} ref={(el) => { refs.current[i] = el; }} id={ids.tab(t.key)} type="button" role="tab" aria-selected={on} aria-controls={on ? ids.panel(t.key) : undefined} tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)} className="gw-tab">
              {t.icon && <t.icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
              {t.label}
              {t.badge ? <span className="gw-count" aria-label={`${t.badge} mục cần xử lý`}>{t.badge}</span> : null}
              {on && <motion.span layoutId={`gw-tab-${base}`} className="gw-tab-bar" aria-hidden="true" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 560, damping: 46 }} />}
            </button>
          );
        })}
      </div>
      {children}
    </Ids.Provider>
  );
}

/** The active panel. Render only the active one (keeps the caller's lazy loading). Pass idBase when the panel is not
 *  inside <ContentTabs> (e.g. the bar and the panels live in different parts of the tree). */
export function TabPanel({ tabKey, children, className = "", idBase }: { tabKey: string; children: ReactNode; className?: string; idBase?: string }) {
  const ctx = useContext(Ids);
  const ids = idBase ? { tab: (k: string) => `${idBase}-tab-${k}`, panel: (k: string) => `${idBase}-panel-${k}` } : ctx;
  if (!ids) return <>{children}</>;
  return (
    <div role="tabpanel" id={ids.panel(tabKey)} aria-labelledby={ids.tab(tabKey)} tabIndex={0} className={`gw-tabpanel ${className}`}>
      {children}
    </div>
  );
}

/** Web: the panel; packaged app: the children unwrapped (identical DOM to before). */
export function PanelIf({ web, children, ...rest }: { web: boolean; tabKey: string; idBase: string; className?: string; children: ReactNode }) {
  return web ? <TabPanel {...rest}>{children}</TabPanel> : <>{children}</>;
}
