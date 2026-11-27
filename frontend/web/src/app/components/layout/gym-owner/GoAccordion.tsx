/**
 * 21 accordion + the 01 card-resize adaptation. Height animates through `grid-template-rows: 0fr <-> 1fr` (no height tween,
 * no JS measuring); the chevron flips with scaleY. A closed panel is `inert`, so hidden controls can neither be focused nor read.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Expand/collapse area without a header (wallet withdrawal form, open requests). */
export function GoReveal({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    inner.current?.toggleAttribute("inert", !open);
  }, [open]);
  return (
    <div className={`t-acc go-reveal ${className}`} data-open={open ? "true" : "false"}>
      <div className="t-acc-panel">
        <div ref={inner} className="t-acc-panel-inner" aria-hidden={open ? undefined : true}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function GoAccordion({
  title,
  meta,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  /** Short right-hand text (a count, "Chỉ xem"). */
  meta?: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const panelId = `${uid}-panel`;
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    inner.current?.toggleAttribute("inert", !open);
  }, [open]);
  return (
    <div className="t-acc go-acc" data-open={open ? "true" : "false"} data-testid={testId}>
      <button type="button" className="t-acc-head go-acc-head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className="go-acc-title">{title}</span>
        {meta != null && <span className="go-acc-meta">{meta}</span>}
        <span className="t-acc-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6.5L8 10.5L12 6.5" vectorEffect="non-scaling-stroke" />
          </svg>
        </span>
      </button>
      <div className="t-acc-panel" id={panelId} role="region" aria-label={title}>
        <div ref={inner} className="t-acc-panel-inner go-acc-inner" aria-hidden={open ? undefined : true}>
          {children}
        </div>
      </div>
    </div>
  );
}
