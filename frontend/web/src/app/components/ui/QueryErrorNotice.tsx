import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { QUERY_ERROR_TEXT } from "../../utils/queryErrorState";

/**
 * FE2-FIX group B: the one inline "this block failed to load" notice (same look as the Obsidian dashboard's section
 * error: warning token surface + a retry button). Used where a failed request used to render as an empty list / 0.
 */
export function QueryErrorNotice({
  text,
  onRetry,
  busy = false,
  testId,
  className = "",
}: {
  text: string;
  onRetry: () => void;
  busy?: boolean;
  testId: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={`flex flex-col items-start gap-3 rounded-2xl border border-st-warning-border bg-st-warning-bg p-4 text-sm text-st-warning ${className}`}
    >
      <p>{text}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-current px-4 font-semibold disabled:opacity-60"
      >
        <ArrowClockwiseIcon className="h-4 w-4" aria-hidden="true" />
        {busy ? QUERY_ERROR_TEXT.retrying : QUERY_ERROR_TEXT.retry}
      </button>
    </div>
  );
}
