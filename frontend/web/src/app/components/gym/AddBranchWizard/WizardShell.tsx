import type { ReactNode } from "react";
import { CheckIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Button } from "../../ui/button";
import { cn } from "../../ui/utils";

export const WIZARD_STEP_LABELS = [
  "Thông tin cơ bản",
  "Địa điểm",
  "Giờ hoạt động",
  "Tiện ích & Dịch vụ",
  "Hình ảnh",
  "Xác minh",
  "Xem lại & Gửi",
] as const;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface WizardShellProps {
  brandName: string;
  currentStep: number;
  /** Steps below this are considered done enough to jump back to directly. */
  furthestStep: number;
  onStepSelect: (step: number) => void;
  saveStatus: SaveStatus;
  savedAt: Date | null;
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  children: ReactNode;
}

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 1 — the wizard's shell: left rail on desktop (§63), top
 * progress bar on mobile (§61), sticky bottom actions (§62), and the auto-save indicator
 * (§8 — "Saving… / Saved / Unable to save", never a toast per save). Step CONTENT is
 * supplied by the caller as `children` — this component only owns navigation/layout.
 */
export function WizardShell({
  brandName,
  currentStep,
  furthestStep,
  onStepSelect,
  saveStatus,
  savedAt,
  onBack,
  onContinue,
  continueLabel = "Tiếp tục",
  continueDisabled,
  children,
}: WizardShellProps) {
  const total = WIZARD_STEP_LABELS.length;
  const progressPct = Math.round((currentStep / total) * 100);

  return (
    <div className="min-h-screen bg-[var(--bg-color)]">
      {/* Mobile top progress — hidden on desktop */}
      <div className="lg:hidden sticky top-0 z-10 bg-[var(--bg-color)]/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{brandName}</p>
        <div className="flex items-center justify-between mt-1">
          <h2 className="text-sm font-bold text-zinc-100">{WIZARD_STEP_LABELS[currentStep - 1]}</h2>
          <span className="text-xs text-zinc-500">
            Bước {currentStep} / {total}
          </span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
          <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl lg:flex lg:gap-8 lg:px-6 lg:py-8">
        {/* Desktop left rail */}
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-8 space-y-4">
            <div>
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Thương hiệu</p>
              <p className="text-sm font-bold text-zinc-100">{brandName}</p>
            </div>
            <nav className="space-y-1">
              {WIZARD_STEP_LABELS.map((label, i) => {
                const step = i + 1;
                const done = step < furthestStep;
                const active = step === currentStep;
                const reachable = step <= furthestStep;
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={!reachable}
                    onClick={() => reachable && onStepSelect(step)}
                    className={cn(
                      "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-left transition-colors",
                      active ? "bg-primary/10 text-primary font-semibold" : reachable ? "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200" : "text-zinc-700 cursor-not-allowed",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        done ? "bg-primary text-black" : active ? "border-2 border-primary text-primary" : "border border-zinc-700 text-zinc-600",
                      )}
                    >
                      {done ? <CheckIcon className="size-3" weight="bold" /> : step}
                    </span>
                    {label}
                  </button>
                );
              })}
            </nav>
            <div className="pt-3 border-t border-zinc-800">
              <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
                <span>Tiến độ</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <SaveIndicator status={saveStatus} savedAt={savedAt} />
          </div>
        </aside>

        {/* Step content */}
        <main className="flex-1 min-w-0 p-4 lg:p-0 pb-28 lg:pb-8">
          <div className="lg:hidden mb-3">
            <SaveIndicator status={saveStatus} savedAt={savedAt} />
          </div>
          {children}
        </main>
      </div>

      {/* Sticky bottom actions — respects Capacitor safe area */}
      <div
        className="fixed bottom-0 left-0 right-0 z-10 bg-[var(--bg-color)]/95 backdrop-blur border-t border-zinc-800 px-4 py-3 flex gap-2 lg:hidden"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {onBack && (
          <Button variant="outline" className="flex-1 h-12" onClick={onBack}>
            Quay lại
          </Button>
        )}
        {onContinue && (
          <Button className="flex-1 h-12" onClick={onContinue} disabled={continueDisabled}>
            {continueLabel}
          </Button>
        )}
      </div>

      {/* Desktop actions live inline at the bottom of the content column */}
      <div className="hidden lg:flex mx-auto max-w-6xl px-6 pb-8 -mt-4 justify-end gap-2 lg:pl-[19rem]">
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            Quay lại
          </Button>
        )}
        {onContinue && (
          <Button onClick={onContinue} disabled={continueDisabled}>
            {continueLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ status, savedAt }: { status: SaveStatus; savedAt: Date | null }) {
  if (status === "saving") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <CircleNotchIcon className="size-3.5 animate-spin" /> Đang lưu...
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-red-400">
        <WarningCircleIcon className="size-3.5" /> Không thể lưu — thử lại
      </p>
    );
  }
  if (status === "saved" && savedAt) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <CheckIcon className="size-3.5 text-green-500" />
        Đã lưu lúc {savedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
      </p>
    );
  }
  return null;
}
