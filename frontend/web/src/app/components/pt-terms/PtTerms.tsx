import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon as Loader2, FileTextIcon as FileText, WarningIcon as Warning } from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { Modal, ModalTitle, ModalClose } from "../ui/Modal";
import { ptApplicationService } from "../../services/ptApplicationService";
import { isPtTermsVersionStale, ptTermsBannerState } from "../../utils/ptTerms";
import { QueryErrorNotice } from "../ui/QueryErrorNotice";
import { hasBlockingError, QUERY_ERROR_TEXT } from "../../utils/queryErrorState";

/** The current PT terms + this user's standing, from the single server source. Identity-scoped key (cleared on account switch). */
export function usePtTerms(enabled = true) {
  const { user } = useApp();
  return useQuery({
    queryKey: ["pt-terms", user?.id ?? null],
    queryFn: ptApplicationService.getTerms,
    enabled: enabled && !!user,
    staleTime: 60_000,
  });
}

/** Confirm the version the user just read; refreshes the terms query so every banner/gate updates. */
export function useConfirmPtTerms(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => ptApplicationService.acceptTerms(version),
    onSuccess: () => {
      toast.success("Đã xác nhận điều khoản. Bạn có thể chấp nhận hợp đồng mới.");
      queryClient.invalidateQueries({ queryKey: ["pt-terms"] });
      onDone?.();
    },
    onError: (err: any) => {
      if (isPtTermsVersionStale(err)) {
        toast.error("Điều khoản vừa được cập nhật. Vui lòng đọc lại phiên bản mới nhất.");
        queryClient.invalidateQueries({ queryKey: ["pt-terms"] });
      } else {
        toast.error(err?.response?.data?.error || "Không thể xác nhận lúc này. Vui lòng thử lại.");
      }
    },
  });
}

/**
 * The terms in a modal - the text is fetched from the server, never hard-coded here.
 * `onConfirm` (optional) adds an "agree" button: used by the application's last step (it ticks the box)
 * and by the re-confirmation banner (it records the confirmation).
 */
export function PtTermsModal({
  open,
  onClose,
  onConfirm,
  confirming = false,
  confirmLabel = "Tôi đồng ý",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm?: (version: string) => void;
  confirming?: boolean;
  confirmLabel?: string;
}) {
  const { data: terms, isLoading, isError, refetch } = usePtTerms(open);
  // <Modal> portals to <body> (rendered inside the page's scroll container the modal sat under the always-visible AI
  // Coach button, which covered the right end of the confirm button on a phone) and gives Esc / focus trap / scroll lock.
  return (
    <Modal open={open} onClose={onClose} placement="sheet" className="sm:p-4" data-testid="pt-terms-modal">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl sm:max-h-[85dvh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800/60 p-4 sm:p-5">
          <div className="min-w-0">
            <ModalTitle className="flex items-center gap-2 font-bold text-zinc-100">
              <FileText className="h-4 w-4 shrink-0 text-green-400" />
              <span data-testid="pt-terms-title">{terms?.title ?? "Điều khoản dành cho Huấn luyện viên"}</span>
            </ModalTitle>
            {terms?.isDraft && (
              <span
                data-testid="pt-terms-draft-tag"
                className="mt-1.5 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400"
              >
                Bản nháp, đang chờ duyệt chính thức
              </span>
            )}
          </div>
          <ModalClose className="-mr-2 -mt-1 text-zinc-500 hover:text-zinc-200" />
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" data-testid="pt-terms-body">
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {isError && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-zinc-400">Không tải được điều khoản. Vui lòng thử lại.</p>
              <button type="button" onClick={() => refetch()} className="min-h-10 rounded-lg border border-zinc-700/60 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
                Tải lại
              </button>
            </div>
          )}
          {terms && (
            <>
              <p className="text-sm leading-relaxed text-zinc-400">{terms.intro}</p>
              {terms.sections.map((s) => (
                <section key={s.id} data-testid={`pt-terms-section-${s.id}`} className="space-y-1.5">
                  <h4 className="text-sm font-bold text-zinc-200">{s.title}</h4>
                  {s.body.map((p, i) => (
                    <p key={i} className="text-sm leading-relaxed text-zinc-400">
                      {p}
                    </p>
                  ))}
                </section>
              ))}
            </>
          )}
        </div>

        <div className="flex gap-3 border-t border-zinc-800/60 p-4 sm:p-5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 flex-1 rounded-lg border border-zinc-700/60 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Đóng
          </button>
          {onConfirm && (
            <button
              type="button"
              data-testid="pt-terms-confirm"
              onClick={() => terms && onConfirm(terms.version)}
              disabled={!terms || confirming}
              className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-2.5 text-sm font-bold text-black transition-all hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Banner for an approved PT who has not confirmed the CURRENT terms (server: `mustReconfirm`). Renders no banner for a
 * new applicant, for a PT who confirmed, and while loading. Confirming in the modal records the acceptance server-side.
 * A page that just had a contract accept refused for the terms can open the modal itself via `open` / `onOpenChange`.
 */
export function PtTermsBanner({ open: controlledOpen, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const termsQuery = usePtTerms();
  const terms = termsQuery.data;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setLocalOpen(v));
  const confirm = useConfirmPtTerms(() => setOpen(false));
  const state = ptTermsBannerState(terms);
  return (
    <>
      {/* A failed terms request must not read as "nothing to confirm": the PT would only find out when accepting a contract is refused. */}
      {hasBlockingError(termsQuery) && (
        <QueryErrorNotice testId="pt-terms-error" text={QUERY_ERROR_TEXT.ptTerms} onRetry={() => termsQuery.refetch()} busy={termsQuery.isFetching} />
      )}
      {state.show && (
        <div
          data-testid="pt-terms-banner"
          className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <Warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-bold text-zinc-100">{state.title}</p>
              <p className="mt-0.5 text-sm text-zinc-400">{state.message}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="pt-terms-banner-action"
            onClick={() => setOpen(true)}
            className="shrink-0 min-h-10 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-green-400"
          >
            {state.action}
          </button>
        </div>
      )}
      <PtTermsModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={(version) => confirm.mutate(version)}
        confirming={confirm.isPending}
      />
    </>
  );
}
