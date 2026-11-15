"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "@phosphor-icons/react";

import { cn } from "./utils";
import { useBackDismissible } from "../../hooks/useBackDismissible";

/**
 * Shared accessible overlay layer (FIX2-MODAL, N14T-01..08).
 *
 * One component for every hand-rolled "fixed inset-0" modal / bottom sheet / side drawer so they all behave the
 * same for keyboard, screen-reader and touch users. Built on the Radix dialog primitive that `ui/dialog.tsx` and
 * `ui/sheet.tsx` already use, so the guarantees are Radix's own:
 *   - role="dialog" + aria-modal + aria-labelledby (from <ModalTitle>) / aria-label (from `ariaLabel`)
 *   - Escape closes (switch off with closeOnEscape={false} only while a request is in flight)
 *   - backdrop click closes (closeOnBackdrop={false} for destructive / long forms — a stray tap must not lose input)
 *   - focus moves into the dialog on open, is trapped inside, and returns to the element that opened it on close
 *   - background scroll is locked and the rest of the page is hidden from assistive tech
 *   - Android Back closes it (registered with useBackDismissible)
 *
 * The component only owns behaviour: the panel markup / colours / radius stay with the caller, so each area keeps its
 * own look. `placement` just supplies the full-screen layout wrapper the old hand-rolled overlays each wrote by hand.
 *
 * ```tsx
 * <Modal open={open} onClose={() => setOpen(false)} placement="sheet">
 *   <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-5">
 *     <div className="flex items-start justify-between">
 *       <ModalTitle className="text-lg font-bold">Tiêu đề</ModalTitle>
 *       <ModalClose />
 *     </div>
 *     ...
 *   </div>
 * </Modal>
 * ```
 */

export type ModalPlacement =
  /** centred card at every width */
  | "center"
  /** bottom sheet below 640px, centred card from 640px up */
  | "sheet"
  /** side drawer docked right */
  | "right"
  /** side drawer docked left */
  | "left";

const PLACEMENT_CLASS: Record<ModalPlacement, string> = {
  center: "items-center justify-center p-4",
  sheet: "items-end justify-center sm:items-center sm:p-4",
  right: "items-stretch justify-end",
  left: "items-stretch justify-start",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name when the visible heading is not a <ModalTitle>. Prefer <ModalTitle> (it also labels the dialog). */
  ariaLabel?: string;
  /** Layout of the panel inside the full-screen wrapper. Default "center". */
  placement?: ModalPlacement;
  /** Click on the dim area closes. Default true. Set false for destructive / long forms. */
  closeOnBackdrop?: boolean;
  /** Escape closes. Default true. */
  closeOnEscape?: boolean;
  /** Extra classes for the full-screen wrapper (z-index, padding, alignment overrides). */
  className?: string;
  /** Classes for the dim layer. Default "bg-black/60". */
  backdropClassName?: string;
  /** Element to focus on open instead of the dialog itself (e.g. the first field of a form). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  "data-testid"?: string;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  ariaLabel,
  placement = "center",
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
  backdropClassName,
  initialFocusRef,
  children,
  ...rest
}: ModalProps) {
  // Hardware Back (Android) closes the overlay instead of navigating the page behind it.
  useBackDismissible(open, onClose);

  // Radix hands focus back only to a <Dialog.Trigger>, and these overlays are opened by plain buttons, so remember the
  // element that had focus at the moment of opening (render time: the content has not mounted / taken focus yet).
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpenRef.current = open;

  // A press that starts inside the panel (text selection) and ends on the dim area is not a backdrop click.
  const pressStartedOnBackdrop = React.useRef(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="modal-backdrop"
          className={cn("fixed inset-0 z-50", backdropClassName ?? "bg-black/60")}
        />
        <DialogPrimitive.Content
          data-slot="modal"
          data-testid={rest["data-testid"]}
          aria-modal="true"
          aria-label={ariaLabel}
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            // Move focus into the dialog without popping the on-screen keyboard: the dialog itself by default,
            // or the element the caller asked for.
            const target = initialFocusRef?.current;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (opener && opener.isConnected) opener.focus();
          }}
          onEscapeKeyDown={(event) => { if (!closeOnEscape) event.preventDefault(); }}
          onPointerDown={(event) => { pressStartedOnBackdrop.current = event.target === event.currentTarget; }}
          onClick={(event) => {
            if (!closeOnBackdrop) return;
            if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
          }}
          className={cn("fixed inset-0 z-50 flex outline-none", PLACEMENT_CLASS[placement], className)}
        >
          {ariaLabel ? <DialogPrimitive.Title className="sr-only">{ariaLabel}</DialogPrimitive.Title> : null}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Side drawer: a Modal docked to one edge. */
export function Drawer({
  side = "right",
  ...props
}: Omit<ModalProps, "placement"> & { side?: "left" | "right" }) {
  return <Modal placement={side} {...props} />;
}

/** The dialog heading. Renders an <h2> and becomes the dialog's accessible name (aria-labelledby). */
export function ModalTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="modal-title" className={className} {...props} />;
}

export function ModalDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="modal-description" className={className} {...props} />;
}

/**
 * Close button: Vietnamese accessible name and a 40px hit area (the glyph itself stays small).
 * Pass `className` for the colours of the area it sits in; pass children to replace the default X icon.
 */
export function ModalClose({
  className,
  children,
  "aria-label": ariaLabel = "Đóng",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      data-slot="modal-close"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon className="size-5" aria-hidden="true" />}
    </DialogPrimitive.Close>
  );
}
