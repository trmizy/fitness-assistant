import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { WarningCircleIcon as AlertCircle } from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import { AutoText } from "../i18n/AutoText";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { complaintDestinationsFor, isComplaintPath, isOnDestination } from "./complaintEntry";

/**
 * Topbar "Khiếu nại" button for client and PT accounts (member mode and coach mode). It replaces the sidebar rows that
 * used to list these pages. One destination -> a plain link; two -> a small menu. Active while any of the offered
 * pages is open. Hidden for every other role (gym owner / admin keep their own complaint surfaces).
 */
const BASE = "relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg transition-colors";
const IDLE = "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100";
const ACTIVE = "bg-[var(--ob-accent-soft)] text-[var(--ob-accent-ink)]";

export function ComplaintEntryButton() {
  const { role, activeView } = useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  useBackDismissible(open, () => setOpen(false));
  const { text: label } = useAutoTranslate("Khiếu nại", "vi");

  const destinations = complaintDestinationsFor(role, activeView);
  if (destinations.length === 0) return null;
  const active = isComplaintPath(pathname, destinations);
  const className = `${BASE} ${active ? ACTIVE : IDLE}`;
  const icon = <AlertCircle className="h-5 w-5" weight={active ? "fill" : "regular"} aria-hidden="true" />;

  if (destinations.length === 1) {
    return (
      <Link
        to={destinations[0].to}
        aria-label={label}
        title={label}
        aria-current={active ? "page" : undefined}
        data-testid="topbar-complaints"
        className={className}
      >
        {icon}
      </Link>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} title={label} data-active={active || undefined} data-testid="topbar-complaints" className={className}>
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        aria-label={label}
        className="w-56 max-w-[calc(100vw-1rem)] glass-panel rounded-xl p-0 z-50 overflow-hidden border-zinc-700/50 bg-zinc-950/60 text-zinc-100"
      >
        {destinations.map((d) => {
          const here = isOnDestination(pathname, d.to);
          return (
            <DropdownMenuItem
              key={d.to}
              data-testid={`topbar-complaints-${d.key}`}
              aria-current={here ? "page" : undefined}
              onSelect={() => navigate(d.to)}
              className={`gap-2 rounded-none min-h-10 px-4 py-2.5 text-sm transition-colors ${here ? "text-[var(--ob-accent-ink)] font-medium" : "text-zinc-300"} focus:bg-zinc-800 focus:text-zinc-100`}
            >
              <AutoText>{d.label}</AutoText>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
