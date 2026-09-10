import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "./utils";

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** GYM_MANAGEMENT master spec §55 — shared search input, touch target ≥44px (§59). */
export function SearchBar({ value, onChange, placeholder = "Tìm kiếm…", className }: SearchBarProps) {
  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-11 rounded-lg border border-zinc-800 bg-zinc-900/60 pl-9 pr-9 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Xoá tìm kiếm"
          className="absolute right-2 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
