/**
 * 16 tabs-sliding: a tab bar whose active pill slides between tabs (JS writes the active tab's offsetLeft/offsetWidth, CSS owns
 * the tween). Keyboard: Left/Right move and activate, Home/End jump to the ends (roving tabindex). The bar scrolls sideways on
 * narrow screens and keeps the active tab in view. First paint and resize place the pill without a transition.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { SubtleNumber } from "./motion";

export interface GoTab {
  id: string;
  label: string;
  /** Read-only / locked tabs get a lock glyph and "(chỉ xem)" in their accessible name. */
  readOnly?: boolean;
  /** Small dot, for example "unsaved changes" on a tab. */
  dirty?: boolean;
  /** A real count of things waiting (G3: exceptions). Shown only when > 0; its digits change with 36 number-subtle-change. */
  count?: number;
  /** Spoken after the count, for example "chờ duyệt". */
  countLabel?: string;
}

export function GoTabs({ tabs, value, onChange, idPrefix, ariaLabel }: { tabs: GoTab[]; value: string; onChange: (id: string) => void; idPrefix: string; ariaLabel: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const placed = useRef(false);

  const move = useCallback(
    (animate: boolean) => {
      const tab = refs.current[value];
      const p = pill.current;
      if (!tab || !p) return;
      if (!animate) {
        const prev = p.style.transition;
        p.style.transition = "none";
        p.style.transform = `translateX(${tab.offsetLeft}px)`;
        p.style.width = `${tab.offsetWidth}px`;
        void p.offsetWidth;
        p.style.transition = prev;
      } else {
        p.style.transform = `translateX(${tab.offsetLeft}px)`;
        p.style.width = `${tab.offsetWidth}px`;
      }
    },
    [value],
  );

  useLayoutEffect(() => {
    move(placed.current);
    placed.current = true;
    refs.current[value]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value, tabs.length, move]);

  useEffect(() => {
    const onResize = () => move(false);
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver !== "undefined" && bar.current ? new ResizeObserver(onResize) : null;
    if (ro && bar.current) ro.observe(bar.current);
    // Web fonts change label widths after first paint.
    void document.fonts?.ready?.then(onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [move]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next].id;
    onChange(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="go-tabs-scroll">
      <div ref={bar} className="t-tabs go-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} data-testid="go-tabs">
        <span ref={pill} className="t-tabs-pill" aria-hidden="true" />
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            aria-label={t.readOnly || (t.count ?? 0) > 0 ? `${t.label}${(t.count ?? 0) > 0 ? `, ${t.count} ${t.countLabel ?? ""}`.trimEnd() : ""}${t.readOnly ? " (chỉ xem)" : ""}` : undefined}
            tabIndex={t.id === value ? 0 : -1}
            className="t-tab"
            data-tab={t.id}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {(t.count ?? 0) > 0 && (
              <span className="go-tab-count" aria-hidden="true" data-testid={`go-tab-count-${t.id}`}>
                <SubtleNumber value={t.count ?? 0} />
              </span>
            )}
            {t.readOnly && <LockSimpleIcon aria-hidden="true" className="go-tab-lock" />}
            {t.dirty && <span className="go-tab-dot" role="img" aria-label="có thay đổi chưa lưu" />}
          </button>
        ))}
      </div>
    </div>
  );
}
