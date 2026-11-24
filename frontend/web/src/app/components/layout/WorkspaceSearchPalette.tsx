/*
 * NIGHT GLASS prototype — the search palette (lazy chunk).
 *
 * What it searches, and nothing else:
 * 1. "Chức năng": the SAME nav entries the user already has (Sidebar lists, filtered by role/view) — instant,
 *    client-side, accent/diacritic-insensitive, no API call. Extra keywords only help find an existing entry.
 * 2. "Thư viện": one action that opens the existing /client/search page (exercises, foods, muscles, articles —
 *    its own API calls, unchanged) with the query.
 *
 * ARIA combobox (1.2) inside a Radix dialog: focus trap, Esc, focus return and Android Back come from the dialog;
 * the input owns aria-activedescendant, ↑/↓/Home/End move, Enter opens, a polite live region says how many results.
 */
import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { MagnifyingGlassIcon, ArrowRightIcon, BooksIcon } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { useApp } from "../../context/AppContext";
import { AutoText } from "../i18n/AutoText";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import { rankEntries, type SearchEntry } from "../../utils/searchText";
import { clientNavFull, ptWorkspaceNav } from "./Sidebar";

/** Words people actually type for each destination (Vietnamese without accents is handled by searchKey). */
const KEYWORDS: Record<string, string[]> = {
  "/client/dashboard": ["trang chủ", "home", "tổng hợp"],
  "/client/inbody": ["cơ thể", "cân nặng", "mỡ", "cơ bắp", "đo", "body"],
  "/client/plans": ["ai coach", "lịch tập ai", "chương trình", "plan"],
  "/client/workout": ["lịch tập", "bài tập", "buổi tập", "nhật ký tập", "workout", "gym"],
  "/client/nutrition": ["ăn", "calo", "món ăn", "bữa", "macro", "protein"],
  "/client/library": ["thư viện", "bài viết", "kiến thức", "nhóm cơ"],
  "/client/services": ["pt", "huấn luyện viên", "phòng gym", "đặt lịch", "hợp đồng", "gói tập"],
  "/client/chat": ["tin nhắn", "nhắn tin", "chat"],
  "/client/wallet": ["tiền", "thanh toán", "nạp", "số dư"],
  "/disputes": ["khiếu nại", "tranh chấp", "buổi tập"],
  "/complaint-cases": ["báo cáo", "phòng gym"],
  "/client/profile": ["tài khoản", "thông tin cá nhân"],
  "/client/settings": ["ngôn ngữ", "giao diện", "thông báo", "mật khẩu"],
  "/pt/dashboard": ["trang chủ", "thống kê", "doanh thu"],
  "/pt/clients": ["học viên", "khách hàng"],
  "/pt/contracts": ["hợp đồng", "gói"],
  "/pt/plans": ["kế hoạch", "duyệt", "plan review"],
  "/pt/schedule": ["lịch", "buổi dạy", "lịch tập"],
  "/pt/chat": ["tin nhắn", "nhắn tin"],
  "/pt/wallet": ["tiền", "rút tiền", "thu nhập"],
  "/pt/profile": ["hồ sơ", "chứng chỉ"],
  "/pt/listing": ["tin đăng", "giới thiệu", "quảng bá"],
};

type Entry = SearchEntry & { icon: React.ElementType; group?: string; sourceLang?: "vi" | "en" };

export default function WorkspaceSearchPalette({ open, onOpenChange, returnFocus }: { open: boolean; onOpenChange: (o: boolean) => void; returnFocus?: () => void }) {
  const { isPT, activeView } = useApp();
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const { text: placeholder } = useAutoTranslate("Tìm chức năng, bài tập, món ăn…", "vi");

  const entries = useMemo<Entry[]>(() => {
    const own = isPT && activeView === "pt" ? ptWorkspaceNav.map((i) => ({ ...i, group: "Huấn luyện" })) : [];
    const seen = new Set(own.map((i) => i.to));
    const mine = clientNavFull.filter((i) => !seen.has(i.to)).map((i) => ({ ...i, group: isPT && activeView === "pt" ? "Cá nhân" : undefined }));
    return [...own, ...mine].map((i) => ({ label: i.label, to: i.to, icon: i.icon, group: i.group, sourceLang: (i as { sourceLang?: "vi" | "en" }).sourceLang, keywords: KEYWORDS[i.to] }));
  }, [isPT, activeView]);

  const matches = useMemo(() => rankEntries(entries, q).slice(0, q.trim() ? 8 : entries.length), [entries, q]);
  const libraryQuery = q.trim().length >= 2 ? q.trim() : null;
  const options: Array<{ key: string; to: string; kind: "nav" | "library"; entry?: Entry }> = [
    ...matches.map((e) => ({ key: e.to, to: e.to, kind: "nav" as const, entry: e })),
    ...(libraryQuery ? [{ key: "library", to: `/client/search?q=${encodeURIComponent(libraryQuery)}`, kind: "library" as const }] : []),
  ];
  const activeIdx = Math.min(active, Math.max(options.length - 1, 0));
  const optId = (i: number) => `${listId}-opt-${i}`;

  const go = (i: number) => {
    const o = options[i];
    if (!o) return;
    onOpenChange(false);
    navigate(o.to);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!options.length) return;
    const last = options.length - 1;
    const move = (i: number) => { e.preventDefault(); setActive(i); document.getElementById(optId(i))?.scrollIntoView({ block: "nearest" }); };
    if (e.key === "ArrowDown") move(activeIdx >= last ? 0 : activeIdx + 1);
    else if (e.key === "ArrowUp") move(activeIdx <= 0 ? last : activeIdx - 1);
    else if (e.key === "Home" && e.ctrlKey) move(0);
    else if (e.key === "End" && e.ctrlKey) move(last);
    else if (e.key === "Enter") { e.preventDefault(); go(activeIdx); }
  };

  const status = q.trim()
    ? matches.length
      ? `${matches.length} chức năng phù hợp${libraryQuery ? ", và tìm trong thư viện" : ""}`
      : libraryQuery ? "Không có chức năng phù hợp. Có thể tìm trong thư viện." : "Không có chức năng phù hợp"
    : `${matches.length} chức năng`;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setQ(""); setActive(0); } }}>
      <DialogContent
        className="ng-palette top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
        // The trigger is not a Radix DialogTrigger (it also opens from Ctrl+K / "/"), so return focus to it explicitly.
        onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus?.(); }}
        data-testid="workspace-search-dialog"
      >
        <DialogTitle className="sr-only"><AutoText>Tìm kiếm</AutoText></DialogTitle>
        <DialogDescription className="sr-only"><AutoText>Gõ để tìm chức năng. Dùng mũi tên lên xuống để chọn, Enter để mở.</AutoText></DialogDescription>
        <div className="ng-field flex items-center gap-3 border-b border-[var(--ob-nav-line-soft)] px-4 pr-12">
          <MagnifyingGlassIcon aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-[var(--ob-nav-icon)]" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options.length ? optId(activeIdx) : undefined}
            aria-label={placeholder}
            placeholder={placeholder}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-[var(--ob-text)] outline-none placeholder:text-[var(--ob-text-2)]"
            data-testid="workspace-search-input"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <p className="sr-only" aria-live="polite">{status}</p>
        <ul id={listId} role="listbox" aria-label="Kết quả" className="ng-scroll max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {options.map((o, i) => {
            const selected = i === activeIdx;
            const showGroup = o.kind === "nav" && o.entry?.group && (i === 0 || options[i - 1].entry?.group !== o.entry.group);
            const Icon = o.kind === "library" ? BooksIcon : o.entry!.icon;
            return (
              <li key={o.key} role="presentation">
                {showGroup && <div role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold text-[var(--ob-text-2)]"><AutoText>{o.entry!.group!}</AutoText></div>}
                {o.kind === "library" && <div role="presentation" className="mx-3 my-1.5 h-px bg-[var(--ob-nav-line-soft)]" />}
                <div
                  id={optId(i)}
                  role="option"
                  aria-selected={selected}
                  onPointerMove={() => active !== i && setActive(i)}
                  onClick={() => go(i)}
                  className={`ng-option ${selected ? "is-active" : ""}`}
                  data-testid={o.kind === "library" ? "workspace-search-library" : "workspace-search-option"}
                >
                  <Icon aria-hidden="true" weight={selected ? "fill" : "regular"} className="h-5 w-5 flex-shrink-0" />
                  {o.kind === "library" ? (
                    <span className="min-w-0 flex-1 truncate"><AutoText>Tìm trong bài tập, món ăn, nhóm cơ và bài viết:</AutoText> <strong className="font-semibold">“{libraryQuery}”</strong></span>
                  ) : (
                    <AutoText className="min-w-0 flex-1 truncate" sourceLang={o.entry!.sourceLang || "vi"}>{o.entry!.label}</AutoText>
                  )}
                  {selected && <ArrowRightIcon aria-hidden="true" className="h-4 w-4 flex-shrink-0 opacity-70" />}
                </div>
              </li>
            );
          })}
          {!options.length && (
            <li role="presentation" className="px-3 py-6 text-center text-sm text-[var(--ob-text-2)]">
              <AutoText>Không có chức năng phù hợp. Gõ thêm để tìm trong thư viện.</AutoText>
            </li>
          )}
        </ul>
        <div aria-hidden="true" className="hidden items-center gap-4 border-t border-[var(--ob-nav-line-soft)] px-4 py-2.5 text-xs text-[var(--ob-text-2)] sm:flex">
          <span><kbd className="ng-kbd">↑</kbd> <kbd className="ng-kbd">↓</kbd> chọn</span>
          <span><kbd className="ng-kbd">Enter</kbd> mở</span>
          <span><kbd className="ng-kbd">Esc</kbd> đóng</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
