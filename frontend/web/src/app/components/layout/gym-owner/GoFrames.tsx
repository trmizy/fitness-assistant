/**
 * Motion frames of the Gym Owner shell:
 *  - BannerStack  (32 banner-stacking): suspended / stale-data / out-of-scope banners rise in and push back when dismissed.
 *  - ContentFrame (14 skeleton-reveal): the page area shows a pulsing skeleton while the scope is loading/switching, then
 *    cross-fades + un-blurs to the content. Content is `inert` while hidden so stale data can neither be seen nor used.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { InfoIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
import { readCssMs } from "./motion";

export interface BannerItem {
  id: string;
  tone: "warn" | "risk" | "info";
  text: ReactNode;
  action?: { label: string; onClick: () => void };
}

type Entry = BannerItem & { leaving?: boolean };

function Banner({ item }: { item: Entry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    // Flush the pre-open rest state, then release it in the same task (snippet 32).
    void ref.current?.offsetWidth;
    setEntered(true);
  }, []);
  const Glyph = item.tone === "risk" ? ProhibitIcon : item.tone === "warn" ? WarningIcon : InfoIcon;
  return (
    <div
      ref={ref}
      className={`t-stack-banner go-banner${entered ? "" : " is-enter"}${item.leaving ? " is-leaving" : ""}`}
      data-tone={item.tone}
      data-testid={`go-banner-${item.id}`}
      role={item.tone === "risk" ? "alert" : "status"}
    >
      <Glyph aria-hidden="true" />
      <div className="go-banner-text">{item.text}</div>
      {item.action && (
        <button type="button" className="go-btn go-banner-action" onClick={item.action.onClick}>
          {item.action.label}
        </button>
      )}
    </div>
  );
}

export function BannerStack({ items }: { items: BannerItem[] }) {
  const [list, setList] = useState<Entry[]>(items);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setList((prev) => {
      const ids = new Set(items.map((i) => i.id));
      const going = prev.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, leaving: true }));
      return [...items, ...going];
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setList((cur) => cur.filter((c) => !c.leaving)), readCssMs("--stack-close", 250) + readCssMs("--duration-stagger", 40));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [items]);
  if (list.length === 0) return null;
  return (
    <div className="go-banners t-stack" data-testid="go-banners">
      {list.map((b) => (
        <Banner key={b.id} item={b} />
      ))}
    </div>
  );
}

function SkeletonLayer({ pulsing }: { pulsing: boolean }) {
  return (
    <div className={`t-skel-skeleton${pulsing ? " is-pulsing" : ""}`} aria-hidden="true">
      <div className="go-skel-wrap">
        <div className="go-skel-bar" data-size="lg" />
        <div className="go-skel-bar" style={{ width: "70%" }} />
        <div className="go-skel-bar" data-size="block" />
        <div className="go-skel-bar" data-size="block" />
      </div>
    </div>
  );
}

export function ContentFrame({ loading, children }: { loading: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // `inert` through the DOM: React 18 types have no inert attribute.
    contentRef.current?.toggleAttribute("inert", loading);
  }, [loading]);
  return (
    <div className={`t-skel${loading ? "" : " is-revealed"}`} data-state={loading ? "loading" : "ready"} data-testid="go-content-frame">
      <SkeletonLayer pulsing={loading} />
      <div ref={contentRef} className="t-skel-content" aria-hidden={loading ? true : undefined}>
        {children}
      </div>
    </div>
  );
}
