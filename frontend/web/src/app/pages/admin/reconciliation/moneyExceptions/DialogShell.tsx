/** D7 - the dialog frame every money-exception form uses: the confirm dialog + the mapped error box + the "reload first" rule. */
import type { ReactNode } from "react";
import { ConfirmDialog, ErrorBox } from "./MoneyExceptionParts";
import type { MoneyErrorView } from "./moneyExceptionErrors";

/** The slice of `useMoneyWrite` the frame reads. */
export interface WriteLike {
  pending: boolean;
  error: MoneyErrorView | null;
  mustReload: boolean;
  reloading: boolean;
  reload: () => Promise<void>;
}

export interface ShellProps {
  testId: string;
  title: string;
  description?: ReactNode;
  rows?: Array<{ label: string; value: ReactNode }>;
  notice: string;
  confirmLabel: string;
  pendingLabel: string;
  danger?: boolean;
  /** the form is not valid / not complete yet */
  confirmDisabled?: boolean;
  write: WriteLike;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

export function DialogShell({ testId, title, description, rows, notice, confirmLabel, pendingLabel, danger, confirmDisabled, write, onConfirm, onClose, children }: ShellProps) {
  return (
    <ConfirmDialog
      testId={testId}
      title={title}
      description={description}
      rows={rows}
      notice={notice}
      confirmLabel={confirmLabel}
      pendingLabel={pendingLabel}
      danger={danger}
      confirmDisabled={confirmDisabled || write.mustReload}
      pending={write.pending}
      onConfirm={onConfirm}
      onClose={onClose}
      error={write.error ? <ErrorBox view={write.error} onReload={write.reload} reloading={write.reloading} testId={`${testId}-error`} /> : null}
    >
      {children}
    </ConfirmDialog>
  );
}
