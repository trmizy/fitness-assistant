/*
 * Level 2 — contextual navigation inside one surface (Settings-style): grouped sections, ONE active item.
 * Items are real links (href with ?section=…), so middle-click / open-in-new-tab / copy-link work and the
 * browser history holds each step. aria-current="page" marks the active section (not tab semantics: these
 * change the URL). One sliding indicator (motion layoutId), instant under reduced motion.
 */
import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";

export type ContextNavItem = { id: string; label: string; icon: React.ElementType; href: string };
export type ContextNavGroup = { label: string; items: ContextNavItem[] };

export function ContextNav({ label, groups, active, onSelect, testId }: { label: string; groups: ContextNavGroup[]; active: string | null; onSelect: (id: string, e: React.MouseEvent) => void; testId?: string }) {
  const reduce = useReducedMotion();
  const pill = useId();
  return (
    <nav aria-label={label} className="gw-ctx-nav" data-testid={testId}>
      {groups.map((g) => (
        <div key={g.label}>
          <h2 className="gw-ctx-group-label">{g.label}</h2>
          <ul className="gw-ctx-list">
            {g.items.map((it) => {
              const on = it.id === active;
              const Icon = it.icon;
              return (
                <li key={it.id}>
                  <a href={it.href} aria-current={on ? "page" : undefined} className="gw-ctx-item" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; onSelect(it.id, e); }} data-section={it.id}>
                    {on && <motion.span layoutId={`gw-ctx-${pill}`} className="gw-ctx-pill" aria-hidden="true" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 46 }} />}
                    <Icon aria-hidden="true" weight={on ? "fill" : "regular"} />
                    <span className="min-w-0 truncate">{it.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
