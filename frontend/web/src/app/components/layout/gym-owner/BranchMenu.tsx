/**
 * BranchMenu - branch picker of the scope strip. ARIA listbox popover: Up/Down/Home/End move, Enter picks, Esc closes and
 * returns focus to the trigger, typing filters (search box when more than 6 branches, type-ahead otherwise).
 * Motion: 05 menu-dropdown (open from the trigger) + 34 text-swap-soft on the chip and name.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CaretDownIcon, CheckIcon, StackIcon } from "@phosphor-icons/react";
import { ALL_BRANCHES, branchCodes, branchStatusText, type ScopeGym, type TagTone } from "../../../features/gym-owner/scope/scopeModel";
import { GoTag } from "./GoTag";
import { TextSoft, useDismissable, useDropdownPhase } from "./motion";

interface Option {
  id: string;
  code: string | null;
  name: string;
  /** One line: address (or district). */
  sub: string;
  status: { text: string; tone: TagTone } | null;
}

const SEARCH_THRESHOLD = 6;
const ALL_LABEL = "Tất cả chi nhánh trong phạm vi";

export function BranchMenu({
  gyms,
  gymId,
  canOfferAll,
  disabled,
  onSelect,
}: {
  gyms: ScopeGym[];
  gymId: string;
  canOfferAll: boolean;
  disabled?: boolean;
  onSelect: (gymId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buf: "", t: 0 as unknown as ReturnType<typeof setTimeout> });
  const uid = useId();
  const listId = `${uid}-list`;
  const phase = useDropdownPhase(open);

  const codes = useMemo(() => branchCodes(gyms), [gyms]);
  const options: Option[] = useMemo(() => {
    const base: Option[] = gyms.map((g) => ({
      id: g.id,
      code: codes[g.id],
      name: g.name,
      sub: (g.address || g.city || "").trim(),
      status: branchStatusText(g),
    }));
    return canOfferAll ? [{ id: ALL_BRANCHES, code: null, name: ALL_LABEL, sub: `${gyms.length} chi nhánh, mỗi chi nhánh một dòng`, status: null }, ...base] : base;
  }, [gyms, codes, canOfferAll]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || (o.code ?? "").toLowerCase().includes(q) || o.sub.toLowerCase().includes(q) || (o.status?.text ?? "").toLowerCase().includes(q));
  }, [options, query]);
  const showSearch = gyms.length > SEARCH_THRESHOLD;

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, rootRef, triggerRef);

  const current = options.find((o) => o.id === gymId) ?? options[0];

  // Opening: start on the selected option and move focus into the popover.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = Math.max(0, options.findIndex((o) => o.id === gymId));
    setActive(idx);
    const t = setTimeout(() => (showSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (o.id !== gymId) onSelect(o.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = filtered.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (n ? (a + 1) % n : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (n ? (a - 1 + n) % n : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (!showSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead for short lists (no search box).
      clearTimeout(typeahead.current.t);
      typeahead.current.buf += e.key.toLowerCase();
      typeahead.current.t = setTimeout(() => (typeahead.current.buf = ""), 600);
      const i = filtered.findIndex((o) => o.name.toLowerCase().startsWith(typeahead.current.buf) || (o.code ?? "").toLowerCase().startsWith(typeahead.current.buf));
      if (i >= 0) setActive(i);
    }
  };

  const triggerCode = current?.code ?? null;
  const triggerName = current?.name ?? "";

  return (
    <div className="go-menu-anchor" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="go-branch-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Chi nhánh đang xem: ${triggerName}. Bấm để đổi.`}
        aria-disabled={disabled ? true : undefined}
        data-testid="go-branch-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open && !disabled) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerCode !== null && (
          <span className="go-code-chip" aria-hidden="true">
            <TextSoft value={triggerCode} />
          </span>
        )}
        <span className="go-branch-text">
          <TextSoft value={triggerName} />
        </span>
        <CaretDownIcon width={16} height={16} aria-hidden="true" />
      </button>

      <div
        className={`go-menu ${phase.className}`}
        data-origin="top-left"
        onKeyDown={onKeyDown}
        data-testid="go-branch-menu"
      >
        {showSearch && (
          <div className="go-menu-search">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm chi nhánh"
              aria-label="Tìm chi nhánh"
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? `${uid}-opt-${active}` : undefined}
            />
          </div>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Chi nhánh trong phạm vi"
          aria-activedescendant={filtered[active] ? `${uid}-opt-${active}` : undefined}
          className="go-menu-list"
        >
          {filtered.length === 0 && <li className="go-menu-empty">Không có chi nhánh phù hợp.</li>}
          {filtered.map((o, i) => (
            <li
              key={o.id}
              id={`${uid}-opt-${i}`}
              role="option"
              data-index={i}
              data-active={i === active ? "true" : "false"}
              aria-selected={o.id === gymId}
              className="go-menu-option"
              onPointerMove={() => i !== active && setActive(i)}
              onClick={() => choose(o)}
            >
              {o.code !== null ? (
                <span className="go-code-chip" aria-hidden="true">{o.code}</span>
              ) : (
                <span className="go-code-chip" data-kind="group" aria-hidden="true"><StackIcon width={14} height={14} /></span>
              )}
              <span className="go-menu-option-main">
                <span className="go-menu-option-name">{o.name}</span>
                <span className="go-menu-option-sub">{o.sub}</span>
              </span>
              {o.status && <GoTag tone={o.status.tone} text={o.status.text} />}
              {o.id === gymId && <CheckIcon width={16} height={16} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
