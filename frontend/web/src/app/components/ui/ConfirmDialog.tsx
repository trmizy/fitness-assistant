import type { ReactNode } from "react";
import { useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./alert-dialog";
import { Button } from "./button";

/**
 * Non-danger confirm button. The `default` Button variant is `--button-bg` emerald-600 (#059669) with white text in the
 * light theme = 3.76:1 (fails WCAG AA for 14px text). Light uses `--st-success` (#047857) on `--primary-foreground`
 * (white) = 5.48:1; dark keeps the original `--button-bg` / `--button-text` pair (6.5:1), so only light changes.
 * (`text-white` is avoided on purpose: theme.css remaps `.text-white` to the body text colour in the light theme.)
 */
const CONFIRM_CLASS =
  "bg-[var(--st-success)] text-[var(--primary-foreground)] hover:brightness-95 dark:bg-[var(--button-bg)] dark:text-[var(--button-text)] dark:hover:brightness-110";

/**
 * Destructive confirm button. The shared `destructive` variant is white on #ef4444 (3.76:1 in light) and on a 60% red
 * in dark - below 4.5:1 for 14px text (N14T-05 measured 3.62 on "Từ chối"). `--st-danger` / `--primary-foreground`
 * are the admin status tokens already used for danger text: #b91c1c on white (6.5:1) in light, #f87171 with
 * near-black text (7.4:1) in dark.
 */
const DANGER_CLASS = "bg-[var(--st-danger)] text-[var(--primary-foreground)] hover:brightness-95 focus-visible:ring-[var(--st-danger)]/30";
/** Touch target: 40px at every width (the base button is 36px). */
const TOUCH_CLASS = "min-h-10 px-4";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Free-form content between the description and the buttons (a reason textarea, etc). */
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  /** Disable confirm — e.g. a required reason field is still empty. */
  confirmDisabled?: boolean;
  danger?: boolean;
}

/**
 * GYM_MANAGEMENT master spec §48/§49 — dialogs (not bottom sheets) for destructive/legally
 * important actions, and the primary button is ALWAYS the safe one. This is enforced
 * structurally, not left to each call site to remember: `AlertDialogCancel` (the safe
 * choice) renders first/default-styled, the actual action is a plain `Button` the caller
 * must explicitly mark `danger` to get red styling — there is no prop that makes the
 * destructive action the visually dominant one.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  confirmDisabled,
  danger = true,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription className="text-adm-text-2">{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className={TOUCH_CLASS}>Huỷ</AlertDialogCancel>
          <Button
            variant="default"
            className={`${TOUCH_CLASS} ${danger ? DANGER_CLASS : CONFIRM_CLASS}`}
            disabled={confirmDisabled || pending}
            onClick={handleConfirm}
          >
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
