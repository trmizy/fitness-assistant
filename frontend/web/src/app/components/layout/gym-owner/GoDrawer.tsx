/**
 * 07 panel-reveal for entity drawers of the Gym Owner workspace (member, exception, plan form). The shared accessible `Modal`
 * (Radix dialog: focus trap, Escape, scroll lock, focus back to the row that opened it, Android Back) docked to the right,
 * 480px wide and full-screen at 768px and below (06 section 3). The panel slides in on X with opacity and a 2px cross-blur, all
 * on one duration/ease (snippet 07 travels on Y inside a card; a side drawer travels on X, same tokens).
 *
 * Header: title, status line (tags), optional branch chip. Body scrolls. Footer carries the role-dependent actions. While a
 * request is in flight pass `busy` so Escape and a stray click on the dim area cannot close it half way.
 */
import type { ReactNode, RefObject } from "react";
import { Modal, ModalClose, ModalDescription, ModalTitle } from "../../ui/Modal";

export function GoDrawer({
  open,
  onClose,
  title,
  meta,
  description,
  children,
  footer,
  busy = false,
  closeOnBackdrop = true,
  initialFocusRef,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Tags / branch chip under the title. */
  meta?: ReactNode;
  /** Screen-reader description of the drawer. */
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  closeOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  testId?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      placement="right"
      closeOnBackdrop={closeOnBackdrop && !busy}
      closeOnEscape={!busy}
      initialFocusRef={initialFocusRef}
      className="go-drawer-layer"
      backdropClassName="go-modal-backdrop"
      data-testid={testId}
    >
      <div className="go-drawer" data-workspace="gym-owner">
        <div className="go-drawer-head">
          <div className="go-drawer-titles">
            <ModalTitle className="go-drawer-title">{title}</ModalTitle>
            {meta && <div className="go-drawer-meta">{meta}</div>}
            {description && <ModalDescription className="sr-only">{description}</ModalDescription>}
          </div>
          <ModalClose className="go-modal-close" aria-label="Đóng bảng chi tiết" />
        </div>
        <div className="go-drawer-body">{children}</div>
        {footer && <div className="go-drawer-foot">{footer}</div>}
      </div>
    </Modal>
  );
}

/** A titled block inside a drawer body ("Gói và hiệu lực", "Luật áp dụng"). */
export function DrawerSection({ title, children, tone }: { title: string; children: ReactNode; tone?: "decision" }) {
  return (
    <section className="go-dsec" data-tone={tone}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
