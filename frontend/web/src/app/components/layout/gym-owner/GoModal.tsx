/**
 * 06 modal for the Gym Owner workspace: the shared accessible `Modal` (Radix dialog: focus trap, Escape, scroll lock, focus
 * back to the opener, Android Back) with workspace styling and the snippet's scale-from-centre open/close. Radix keeps the
 * node mounted while the closing animation of the layer runs, so the close is animated too.
 */
import type { ReactNode, RefObject } from "react";
import { Modal, ModalClose, ModalDescription, ModalTitle } from "../../ui/Modal";

export function GoModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocusRef,
  testId,
  tone = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  /** Turn off only while a request is in flight. */
  closeOnEscape?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  testId?: string;
  tone?: "default" | "risk";
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      initialFocusRef={initialFocusRef}
      className="go-modal-layer items-center justify-center p-4"
      backdropClassName="go-modal-backdrop"
      data-testid={testId}
    >
      <div className="go-modal" data-tone={tone} data-workspace="gym-owner">
        <div className="go-modal-head">
          <div className="go-modal-titles">
            <ModalTitle className="go-modal-title">{title}</ModalTitle>
            {description && <ModalDescription className="go-modal-desc">{description}</ModalDescription>}
          </div>
          <ModalClose className="go-modal-close" />
        </div>
        {children && <div className="go-modal-body">{children}</div>}
        {footer && <div className="go-modal-foot">{footer}</div>}
      </div>
    </Modal>
  );
}
