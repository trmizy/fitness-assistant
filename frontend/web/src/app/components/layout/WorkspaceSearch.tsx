/*
 * NIGHT GLASS prototype — workspace search (Client/PT topbar).
 * The trigger is tiny and lives in the entry chunk; the palette itself is lazy-loaded on first open (and preloaded
 * on hover/focus of the trigger), so the first paint does not pay for it.
 * Shortcuts: Ctrl/⌘+K anywhere, "/" when the user is not typing in a field.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";

const loadPalette = () => import("./WorkspaceSearchPalette");
const WorkspaceSearchPalette = lazy(loadPalette);

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function WorkspaceSearch() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { text: placeholder } = useAutoTranslate("Tìm chức năng, bài tập, món ăn…", "vi");
  const { text: name } = useAutoTranslate("Tìm kiếm", "vi");
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const openPalette = () => { setMounted(true); setOpen(true); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); }
      else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) { e.preventDefault(); openPalette(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={name}
        aria-haspopup="dialog"
        aria-keyshortcuts={isMac ? "Meta+K /" : "Control+K /"}
        onClick={openPalette}
        onPointerEnter={() => void loadPalette()}
        onFocus={() => void loadPalette()}
        data-testid="workspace-search-trigger"
        className="ng-search-trigger group"
      >
        <MagnifyingGlassIcon aria-hidden="true" className="h-[18px] w-[18px] flex-shrink-0" />
        <span className="ng-search-placeholder hidden truncate md:inline">{placeholder}</span>
        <kbd aria-hidden="true" className="ng-kbd ml-auto hidden lg:inline-flex">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      {mounted && (
        <Suspense fallback={null}>
          <WorkspaceSearchPalette open={open} onOpenChange={setOpen} returnFocus={() => triggerRef.current?.focus()} />
        </Suspense>
      )}
    </>
  );
}
