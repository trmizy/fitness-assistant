import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "./sheet";
import { Button } from "./button";
import { useIsMobile } from "./use-mobile";

export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  onApply?: () => void;
  onClear?: () => void;
  applyLabel?: string;
}

/**
 * GYM_MANAGEMENT master spec §48 — "Prefer bottom sheets on mobile for: Filter · Sort …".
 * One component, responsive `side` (bottom on mobile, a right-hand slide-over on desktop) —
 * not two separate implementations to keep in sync.
 */
export function FilterSheet({ open, onOpenChange, title = "Bộ lọc", children, onApply, onClear, applyLabel = "Áp dụng" }: FilterSheetProps) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={isMobile ? "max-h-[85vh] rounded-t-2xl" : ""}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">{children}</div>
        <SheetFooter className="flex-row gap-2">
          {onClear && (
            <Button variant="outline" className="flex-1" onClick={onClear}>
              Xoá lọc
            </Button>
          )}
          <Button className="flex-1" onClick={onApply ?? (() => onOpenChange(false))}>
            {applyLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
