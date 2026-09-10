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
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Huỷ</AlertDialogCancel>
          <Button variant={danger ? "destructive" : "default"} disabled={confirmDisabled || pending} onClick={handleConfirm}>
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
