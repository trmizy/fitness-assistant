import { WarningIcon } from "@phosphor-icons/react";
import { Modal, ModalTitle } from "../ui/Modal";
import {
  INDEPENDENT_VENUE_AGREE,
  INDEPENDENT_VENUE_DECLINE,
  INDEPENDENT_VENUE_INTRO,
  INDEPENDENT_VENUE_TITLE,
  INDEPENDENT_VENUE_WARNING,
} from "../../utils/independentVenue";

/**
 * N15M-14 - shown before a contract request whose training venue is outside the Gymini system.
 * Two explicit choices, no backdrop / Escape dismissal (a stray tap must not count as an answer; "Chọn gói/PT khác"
 * is the way back). Sits above the request modal (z-[70]) and the package-changed notice (z-[80]).
 */
export function IndependentVenueDialog({
  open,
  pending,
  onAgree,
  onDecline,
}: {
  open: boolean;
  /** The request is in flight: both buttons wait. */
  pending?: boolean;
  onAgree: () => void;
  onDecline: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onDecline}
      closeOnBackdrop={false}
      className="z-[85]"
      backdropClassName="bg-black/70 backdrop-blur-sm z-[85]"
      data-testid="independent-venue-dialog"
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800/60 bg-zinc-900 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
            <WarningIcon className="h-5 w-5" weight="fill" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <ModalTitle className="text-base font-bold leading-snug text-zinc-100">{INDEPENDENT_VENUE_TITLE}</ModalTitle>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{INDEPENDENT_VENUE_INTRO}</p>
          </div>
        </div>

        <p
          className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-relaxed text-zinc-200"
          data-testid="independent-venue-warning"
        >
          {INDEPENDENT_VENUE_WARNING}
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onAgree}
            disabled={pending}
            data-testid="independent-venue-agree"
            className="min-h-11 flex-1 rounded-lg bg-green-500 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-all hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none"
          >
            {INDEPENDENT_VENUE_AGREE}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={pending}
            data-testid="independent-venue-decline"
            className="min-h-11 flex-1 rounded-lg border border-zinc-700/60 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {INDEPENDENT_VENUE_DECLINE}
          </button>
        </div>
      </div>
    </Modal>
  );
}
