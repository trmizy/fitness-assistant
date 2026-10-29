import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { describeAdminError, type AdminErrorView, type DescribeOptions } from "./useAdminError";
import { moneyText } from "./moneyGuards";

/**
 * B1-MONEY — the one confirmation every admin action that moves real money goes through (plan §5).
 *
 * It shows WHO is affected, HOW MUCH, and WHAT HAPPENS to which wallet bucket, before the admin can confirm.
 * Behaviour guarantees (the call sites do not have to remember them):
 *  - one request per confirmation: a ref lock blocks a second click before React re-renders;
 *  - busy: Esc / outside click / Huỷ are inert while the request is in flight;
 *  - it closes only after `onConfirm` RESOLVES — i.e. after the server confirmed. Put the success toast in the
 *    mutation's onSuccess (same moment), never before;
 *  - a failure stays inside the dialog (role="alert") with the Vietnamese message; when the outcome is unknown
 *    (network / 5xx) or the data is stale (409), confirming again is disabled — the admin reloads the state first
 *    (plan E-07), the POST is never retried automatically;
 *  - built on the Radix AlertDialog already used by ConfirmDialog: focus trap, Esc, focus returns to the opener.
 */

/**
 * Dialog-scoped contrast fixes (B6a) — axe color-contrast measured these inside the dialog, which is portalled to
 * <body> (so it sees the GLOBAL tokens, not the admin page's): muted labels 4.09:1 dark / 4.34:1 light, the amber
 * notice 4.46:1, the default (non-danger) confirm button 3.76:1 light and (found while re-checking) the error box
 * `text-destructive` on `bg-destructive/10` in light (`--button-bg` #059669 + white). Fixed with
 * the existing admin tokens only (`adm-text-2`, `st-warning*`, `st-danger*`, `st-success` + `adm-bg` text) — no global token
 * changes, so client / PT / gym-owner dialogs are untouched. The same confirm look is used by the B5 "Đã chi trả" button.
 */
const CONFIRM_SAFE = "bg-st-success text-adm-bg hover:bg-st-success hover:opacity-90";

export interface MoneyActionRow {
  label: string;
  value: ReactNode;
}

export interface MoneyActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Who is affected ("Người rút", "Khách nhận hoàn", "Gói hội viên"…). */
  parties?: MoneyActionRow[];
  /** The amount, shown large. Omit when the amount is computed by the backend (then say so in `effects`). */
  amount?: number | string | null;
  amountLabel?: string;
  /** Extra figures that frame the amount (paid / already refunded / ceiling). */
  facts?: MoneyActionRow[];
  /** What happens to which wallet bucket. Each item is one plain sentence. */
  effects: ReactNode[];
  /** Highlighted caution ("Tiền chưa được chuyển", "Không thể hoàn tác"). */
  notice?: ReactNode;
  /** Inputs that belong to the action (bank reference, reason…). */
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  /** Red confirm button (default). */
  danger?: boolean;
  confirmDisabled?: boolean;
  /** Must perform the request and RESOLVE only once the server confirmed (use `mutateAsync`). */
  onConfirm: () => Promise<unknown>;
  /** Re-reads the real state after an unknown outcome / stale data; the dialog then closes. */
  onReload?: () => unknown | Promise<unknown>;
  /** Passed to the error mapper (`fallback`, `serverHint`). */
  errorOptions?: Omit<DescribeOptions, "action">;
  testId?: string;
}

export function MoneyActionDialog({
  open,
  onOpenChange,
  title,
  description,
  parties,
  amount,
  amountLabel = "Số tiền",
  facts,
  effects,
  notice,
  children,
  confirmLabel,
  pendingLabel = "Đang xử lý…",
  danger = true,
  confirmDisabled,
  onConfirm,
  onReload,
  errorOptions,
  testId = "money-action-dialog",
}: MoneyActionDialogProps) {
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<AdminErrorView | null>(null);
  const lock = useRef(false);

  // A dialog that is opened again starts clean.
  useEffect(() => {
    if (open) {
      setError(null);
      lock.current = false;
    }
  }, [open]);

  const blocked = !!error && (error.ambiguous || error.stale);
  const busy = pending || reloading;

  async function handleConfirm() {
    if (lock.current || blocked) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      lock.current = false;
      setPending(false);
      onOpenChange(false);
    } catch (e) {
      setError(describeAdminError(e, { ...errorOptions, action: "write" }));
      lock.current = false;
      setPending(false);
    }
  }

  async function handleReload() {
    if (reloading) return;
    setReloading(true);
    try {
      await onReload?.();
    } finally {
      setReloading(false);
      onOpenChange(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent
        data-testid={testId}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        className="max-h-[100dvh] overflow-y-auto content-start gap-4 [&_.text-muted-foreground]:text-adm-text-2 max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-h-[calc(100dvh-2rem)]"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>

        {parties && parties.length > 0 && <Rows rows={parties} />}

        {amount !== undefined && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
            <p className="text-xs text-adm-text-2">{amountLabel}</p>
            <p data-testid={`${testId}-amount`} className="mt-0.5 text-2xl font-bold tabular-nums text-[var(--text-color)]">
              {moneyText(amount)}
            </p>
          </div>
        )}

        {facts && facts.length > 0 && <Rows rows={facts} />}

        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-adm-text-2">Điều gì sẽ xảy ra</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-color)]" data-testid={`${testId}-effects`}>
            {effects.map((effect, i) => (
              <li key={i}>{effect}</li>
            ))}
          </ul>
        </div>

        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 text-sm text-st-warning">
            <WarningIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
            <div>{notice}</div>
          </div>
        )}

        {children}

        {error && (
          <div role="alert" data-testid={`${testId}-error`} className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2.5 text-sm text-st-danger">
            <p>{error.message}</p>
            {blocked && onReload && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={handleReload} disabled={reloading} data-testid={`${testId}-reload`}>
                {reloading && <CircleNotchIcon className="size-4 animate-spin" />}
                Tải lại trạng thái
              </Button>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{blocked ? "Đóng" : "Huỷ"}</AlertDialogCancel>
          <Button
            type="button"
            variant={danger ? "destructive" : "default"}
            className={danger ? undefined : CONFIRM_SAFE}
            disabled={confirmDisabled || busy || blocked}
            aria-busy={pending}
            onClick={handleConfirm}
            data-testid={`${testId}-confirm`}
          >
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Rows({ rows }: { rows: MoneyActionRow[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-[var(--border-color)] px-4 py-3 text-sm">
      {rows.map((row, i) => (
        <div key={i} className="contents">
          <dt className="text-adm-text-2">{row.label}</dt>
          <dd className="min-w-0 break-words text-right font-medium tabular-nums text-[var(--text-color)]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
