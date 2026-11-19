import { useState } from "react";
import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react";
import { FOCUS } from "./ExceptionParts";
import { runDriftText, runReconciliationErrorText, runStatusLabel, runStatusTone, runTimeText, runTriggerLabel, type RunTone } from "./reconciliationView";
import { RUNS_PAGE_SIZE, errorView, useReconciliationRuns, useRunReconciliation } from "./useReconciliationData";

/**
 * "Lịch sử đối soát" (G-06) — the newest recorded balance checks: those an admin saved with the button below, and the ones the
 * system's 5-minute job saved when something changed. The button is the ONLY write of this screen; it never touches money. Amounts are the exact stored drift (formatMoneyExact); a run that failed shows "—", never "0 ₫".
 * A failed load says the history is unknown — it is never drawn as an empty history.
 */
const CARD = "rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card sm:p-5";
const BTN = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 disabled:opacity-60 motion-reduce:transition-none lg:min-h-9 ${FOCUS}`;
const PILL: Record<RunTone, string> = {
  success: "border-st-success-border bg-st-success-bg text-st-success",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger",
  warning: "border-adm-border bg-st-warning-bg text-st-warning",
};

export function ReconciliationRunsHistory() {
  const [offset, setOffset] = useState(0);
  const runs = useReconciliationRuns(offset);
  const run = useRunReconciliation();
  const page = runs.data;
  const err = runs.isError && !page ? errorView(runs.error, "lịch sử đối soát") : null;

  return (
    <section data-testid="recon-runs" aria-labelledby="recon-runs-h" className={CARD}>
      <h3 id="recon-runs-h" className="text-sm font-bold text-adm-text">
        Lịch sử đối soát
      </h3>
      <p className="mt-1 text-xs text-adm-text-2">Gồm các lần quản trị viên bấm lưu và các lần hệ thống tự chạy (5 phút một lần) khi có thay đổi so với lần trước.</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="recon-run-button"
          disabled={run.isPending}
          onClick={() => {
            setOffset(0);
            run.mutate();
          }}
          className={BTN}
        >
          <ArrowClockwiseIcon className={`size-3.5 ${run.isPending ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
          {run.isPending ? "Đang chạy đối soát..." : "Chạy đối soát và lưu"}
        </button>
        {run.isError && (
          <p data-testid="recon-run-error" role="alert" className="flex items-start gap-2 text-sm font-semibold text-st-danger">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {runReconciliationErrorText(run.error)}
          </p>
        )}
        {run.isSuccess && (
          <p data-testid="recon-run-ok" role="status" className="text-sm text-adm-text-2">
            Đã chạy và lưu một lần đối soát.
          </p>
        )}
      </div>

      {runs.isLoading && (
        <div role="status" aria-busy="true" data-testid="recon-runs-loading" className="mt-3 space-y-2">
          <span className="sr-only">Đang tải lịch sử đối soát</span>
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden className="h-9 animate-pulse rounded-lg bg-adm-pill motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {err && (
        <div data-testid="recon-runs-error" role="alert" className="mt-3 space-y-2">
          <p className="flex items-start gap-2 text-sm font-semibold text-st-danger">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {err.message}
          </p>
          <button type="button" onClick={() => void runs.refetch()} className={BTN}>
            <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Thử lại
          </button>
        </div>
      )}

      {page && page.items.length === 0 && (
        <p data-testid="recon-runs-empty" className="mt-3 text-sm text-adm-text-2">
          Chưa có lần đối soát nào được ghi lại.
        </p>
      )}

      {page && page.items.length > 0 && (
        <>
          <ul className="mt-3 divide-y divide-adm-border-soft">
            {page.items.map((r) => (
              <li key={r.id} data-testid="recon-run-row" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[13px]">
                <span className="min-w-0">
                  <span data-testid="recon-run-time" className="font-medium tabular-nums text-adm-text">
                    {runTimeText(r)}
                  </span>
                  <span data-testid="recon-run-trigger" className="ml-2 text-xs text-adm-text-2">
                    {runTriggerLabel(r.trigger)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span data-testid="recon-run-status" className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${PILL[runStatusTone(r.status)]}`}>
                    {runStatusLabel(r.status)}
                  </span>
                  <span data-testid="recon-run-drift" className="whitespace-nowrap text-right tabular-nums text-adm-text" title="Chênh lệch = tiền giữ hộ − tổng quyền đòi">
                    {runDriftText(r)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-adm-text-2">
            <span data-testid="recon-runs-range">
              {page.offset + 1}–{page.offset + page.items.length} / {page.total}
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={offset === 0 || runs.isFetching} onClick={() => setOffset(Math.max(0, offset - RUNS_PAGE_SIZE))} className={BTN} data-testid="recon-runs-prev">
                Mới hơn
              </button>
              <button type="button" disabled={!page.hasMore || runs.isFetching} onClick={() => setOffset(offset + RUNS_PAGE_SIZE)} className={BTN} data-testid="recon-runs-next">
                Cũ hơn
              </button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
