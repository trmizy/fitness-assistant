import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwiseIcon, CheckCircleIcon, XIcon } from "@phosphor-icons/react";
import { disputeCaseApi } from "../../disputes/disputeCaseApi";
import { parseDisputeError } from "../../disputes/disputeCaseErrors";
import { useDisputeQueryKeys } from "../../disputes/disputeQueryKeys";
import type { HeldMoneyReviewItem } from "../../disputes/disputeCaseTypes";
import { formatVnDateTime } from "../../adminFinanceOverview.utils";
import { shortId } from "../../adminReconciliation.utils";
import { Btn, FOCUS, MutedLine, Notice, Pill, Section } from "./MoneyExceptionParts";
import type { D65bSummary } from "./moneyExceptionTypes";
import { D65B_STATUS_LABEL } from "./moneyExceptionLabels";
import { exitRefCandidates, HELD_MONEY_DECISION_LABEL } from "./heldMoneyModel";
import { ErrorBox, useWrite } from "../../disputes/actions/actionKit";

interface HeldMoneyReviewSectionProps {
  d65bProposals: D65bSummary[];
  /** true only when the proposal list loaded and was not cut at its 50-row limit */
  proposalsComplete?: boolean;
}

export function HeldMoneyReviewSection({ d65bProposals, proposalsComplete = false }: HeldMoneyReviewSectionProps) {
  // only a COMPLETE list may claim "this session has no proposal"; a list still loading or cut at 50 must not (07/11)
  const noCandidateText = proposalsComplete
    ? "Buổi này chưa có đề xuất xử lý nào, nên chỉ có thể chọn Giữ tiếp."
    : "Không thấy đề xuất của buổi này trong danh sách đã tải (tối đa 50 đề xuất mới nhất), nên lúc này chỉ có thể chọn Giữ tiếp.";
  const queryClient = useQueryClient();
  const { keys } = useDisputeQueryKeys();
  const [overdueOnly, setOverdueOnly] = useState<boolean>(false);
  const [activeReview, setActiveReview] = useState<HeldMoneyReviewItem | null>(null);
  const [decision, setDecision] = useState<"KEEP_HOLDING" | "EXIT_STARTED">("KEEP_HOLDING");
  const [reason, setReason] = useState<string>("");
  const [exitRefId, setExitRefId] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const queryKey = keys
    ? keys.heldMoney({ overdue: overdueOnly ? true : undefined, limit: 50, offset: 0 })
    : (["dispute-case", "anon", "held-money", { overdue: overdueOnly ? true : undefined, limit: 50, offset: 0 }] as const);

  const query = useQuery({
    queryKey,
    queryFn: () => disputeCaseApi.listHeldMoney({ overdue: overdueOnly ? true : undefined, limit: 50, offset: 0 }),
  });

  const write = useWrite<{
    reviewId: string;
    decision: "KEEP_HOLDING" | "EXIT_STARTED";
    reason: string;
    exitRefId?: string;
  }, unknown>(() => {
    if (keys) {
      void queryClient.invalidateQueries({ queryKey: keys.heldMoney().slice(0, 3) });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["dispute-case"] });
    }
  });

  const openDecide = (r: HeldMoneyReviewItem) => {
    setActiveReview(r);
    setDecision("KEEP_HOLDING");
    setReason("");
    setExitRefId("");
    setFormError(null);
    setSubmitSuccess(null);
  };

  const closeDecide = () => {
    if (write.pending) return;
    setActiveReview(null);
    setFormError(null);
  };

  const candidates = activeReview
    ? exitRefCandidates(d65bProposals, activeReview.sessionId)
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReview || write.pending) return;

    if (!reason.trim()) {
      setFormError("Vui lòng nhập lý do rà soát.");
      return;
    }
    if (decision === "EXIT_STARTED" && !exitRefId) {
      setFormError("Vui lòng chọn đề xuất căn cứ giải toả.");
      return;
    }

    setFormError(null);

    const res = await write.submit(
      { reviewId: activeReview.reviewId, decision, reason: reason.trim(), exitRefId },
      (key, body) =>
        disputeCaseApi.decideHeldMoney(
          body.reviewId,
          {
            decision: body.decision,
            reason: body.reason,
            exitRef: body.decision === "EXIT_STARTED" && body.exitRefId
              ? { kind: "D65B_RESOLUTION", id: body.exitRefId }
              : undefined,
          },
          key,
        ),
    );

    if (res.ok) {
      setSubmitSuccess("Đã ghi nhận quyết định rà soát thành công.");
      setActiveReview(null);
    }
  };

  const items = query.data?.items ?? [];

  return (
    <Section
      title="Rà soát định kỳ khoản đang giữ"
      testId="held-money-review-section"
      aside={
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="held-review-filter-overdue"
            aria-pressed={overdueOnly}
            onClick={() => setOverdueOnly(!overdueOnly)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${FOCUS} ${
              overdueOnly
                ? "border-adm-text bg-adm-text text-adm-bg"
                : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
            }`}
          >
            Chỉ hiện quá hạn rà soát
          </button>
          <Btn
            variant="outline"
            onClick={() => void query.refetch()}
            pending={query.isFetching}
            testId="held-review-reload"
          >
            <ArrowClockwiseIcon className="size-4" aria-hidden />
            Tải lại
          </Btn>
        </div>
      }
    >
      <p className="text-xs text-adm-text-2">
        Các khoản giữ có chu kỳ rà soát định kỳ 7 ngày. Quyết định rà soát không bao giờ tự chi trả hay xoá tiền.
      </p>

      {submitSuccess && (
        <Notice tone="info" testId="held-review-success">
          {submitSuccess}
        </Notice>
      )}

      {query.isLoading ? (
        <p className="text-xs text-adm-text-2" data-testid="held-review-loading">
          Đang tải danh sách rà soát...
        </p>
      ) : query.isError ? (
        <Notice tone="danger" testId="held-review-error">
          Không tải được danh sách rà soát: {parseDisputeError(query.error).message}
        </Notice>
      ) : items.length === 0 ? (
        <MutedLine testId="held-review-empty">
          {overdueOnly
            ? "Không có khoản giữ nào bị quá hạn rà soát."
            : "Hiện không có khoản giữ nào cần rà soát định kỳ."}
        </MutedLine>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="held-review-table">
            <thead>
              <tr className="border-b border-adm-border-soft text-adm-text-2">
                <th className="pb-2 font-medium">Buổi / Hợp đồng</th>
                <th className="pb-2 font-medium">Thời gian giữ</th>
                <th className="pb-2 font-medium">Hạn rà soát</th>
                <th className="pb-2 font-medium">Quyết định trước</th>
                <th className="pb-2 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-adm-border-soft">
              {items.map((r) => (
                <tr key={r.reviewId} data-testid={`held-review-row-${r.reviewId}`}>
                  <td className="py-2.5">
                    <p className="font-semibold text-adm-text">Buổi #{shortId(r.sessionId)}</p>
                    <p className="text-adm-text-2">HĐ #{shortId(r.contractId)}</p>
                  </td>
                  <td className="py-2.5">
                    <p className="font-medium tabular-nums text-adm-text">{r.daysHeld} ngày</p>
                    <p className="text-adm-text-2">{formatVnDateTime(r.firstSeenAt)}</p>
                  </td>
                  <td className="py-2.5">
                    <p className="text-adm-text">{formatVnDateTime(r.nextReviewDueAt)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.overdue && <Pill tone="danger">Quá hạn rà soát</Pill>}
                      {r.ownerEscalatedAt && <Pill tone="warning">Đã báo quản trị</Pill>}
                    </div>
                  </td>
                  <td className="py-2.5">
                    {r.lastDecision ? (
                      <p className="font-medium text-adm-text">
                        {HELD_MONEY_DECISION_LABEL[r.lastDecision.decision] ?? "Đã rà soát"}
                      </p>
                    ) : (
                      <span className="text-adm-text-2">Chưa có</span>
                    )}
                    {r.note && <p className="mt-0.5 line-clamp-1 text-adm-text-2">{r.note}</p>}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      data-testid={`held-review-decide-btn-${r.reviewId}`}
                      onClick={() => openDecide(r)}
                      className={`inline-flex min-h-8 items-center rounded-md border border-adm-border bg-adm-surface px-2.5 py-1 text-xs font-medium text-adm-text hover:bg-adm-surface-2 ${FOCUS}`}
                    >
                      Quyết định
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Decide Modal */}
      {activeReview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="held-decide-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          data-testid="held-review-decide-modal"
        >
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-adm-border bg-adm-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="held-decide-title" className="text-base font-bold text-adm-text">
                  Quyết định rà soát khoản giữ (Buổi #{shortId(activeReview.sessionId)})
                </h3>
                <p className="text-xs text-adm-text-2">
                  Đã giữ {activeReview.daysHeld} ngày · Hợp đồng #{shortId(activeReview.contractId)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDecide}
                disabled={write.pending}
                className={`rounded-md p-1 text-adm-text-2 hover:bg-adm-surface-2 ${FOCUS}`}
                aria-label="Đóng"
              >
                <XIcon className="size-5" />
              </button>
            </div>

            <Notice tone="info" testId="held-decide-notice">
              Quyết định này không chuyển tiền.
            </Notice>

            {formError && (
              <Notice tone="danger" testId="held-decide-form-error">
                {formError}
              </Notice>
            )}

            {write.error && (
              <ErrorBox
                error={write.error}
                mustReload={write.mustReload}
                reloading={write.reloading}
                onReload={write.reload}
                onRetry={write.retry}
                pending={write.pending}
              />
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold text-adm-text">Hướng xử lý</legend>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-adm-text">
                    <input
                      type="radio"
                      name="review-decision"
                      value="KEEP_HOLDING"
                      checked={decision === "KEEP_HOLDING"}
                      onChange={() => setDecision("KEEP_HOLDING")}
                      data-testid="held-decide-radio-keep"
                    />
                    <span>Giữ tiếp (chưa có hướng xử lý)</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-adm-text">
                    <input
                      type="radio"
                      name="review-decision"
                      value="EXIT_STARTED"
                      checked={decision === "EXIT_STARTED"}
                      disabled={candidates.length === 0}
                      onChange={() => setDecision("EXIT_STARTED")}
                      data-testid="held-decide-radio-exit"
                    />
                    <span>Đã mở hướng xử lý (cần chọn căn cứ đề xuất)</span>
                  </label>
                </div>
                {candidates.length === 0 && (
                  <p className="text-[11px] text-adm-text-2">
                    {noCandidateText}
                  </p>
                )}
              </fieldset>

              {decision === "EXIT_STARTED" && (
                <div className="space-y-1">
                  <label htmlFor="held-exit-ref" className="text-xs font-medium text-adm-text">
                    Đề xuất xử lý của buổi này
                  </label>
                  {candidates.length === 0 ? (
                    <p className="text-xs text-adm-danger" data-testid="held-no-candidates">
                      {noCandidateText}
                    </p>
                  ) : (
                    <select
                      id="held-exit-ref"
                      data-testid="held-decide-exit-ref"
                      value={exitRefId}
                      onChange={(e) => setExitRefId(e.target.value)}
                      className={`w-full rounded-md border border-adm-border bg-adm-surface px-3 py-2 text-xs text-adm-text ${FOCUS}`}
                    >
                      <option value="">-- Chọn đề xuất của buổi này --</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          Đề xuất #{shortId(p.id)} · {D65B_STATUS_LABEL[p.status]} · tạo {formatVnDateTime(p.createdAt)}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-[11px] text-adm-text-2">
                    Căn cứ giải toả phải trỏ tới một đề xuất hợp lệ đã có của buổi này.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="held-decide-reason" className="text-xs font-medium text-adm-text">
                  Lý do rà soát (bắt buộc, tối đa 2000 ký tự)
                </label>
                <textarea
                  id="held-decide-reason"
                  data-testid="held-decide-reason"
                  rows={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Nêu rõ lý do tiếp tục giữ hoặc cơ sở mở hướng xử lý..."
                  className={`w-full rounded-md border border-adm-border bg-adm-surface px-3 py-2 text-xs text-adm-text ${FOCUS}`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Btn variant="outline" type="button" onClick={closeDecide} disabled={write.pending}>
                  Huỷ
                </Btn>
                <Btn
                  variant="primary"
                  type="submit"
                  pending={write.pending}
                  disabled={write.pending || (decision === "EXIT_STARTED" && !exitRefId)}
                  testId="held-decide-submit"
                >
                  <CheckCircleIcon className="size-4" aria-hidden />
                  Xác nhận quyết định
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </Section>
  );
}
