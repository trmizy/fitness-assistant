import { useState } from "react";
import { disputeCaseApi } from "../admin/disputes/disputeCaseApi";
import type { PartyAgreementItem } from "../admin/disputes/disputeCaseTypes";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import { useIdempotentAction } from "../admin/disputes/useIdempotentAction";
import { CARD, FOCUS, MUTED, Notice, Pill, PRIMARY_BUTTON } from "./PartyParts";
import { PARTY_CONFIRM_AGREEMENT_NOTE } from "../admin/disputes/workspace/agreementModel";

interface PartyAgreementPanelProps {
  caseId: string;
  agreements?: PartyAgreementItem[];
  onChanged: () => void | Promise<unknown>;
}

export function PartyAgreementPanel({
  caseId,
  agreements,
  onChanged,
}: PartyAgreementPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingItem, setConfirmingItem] = useState<PartyAgreementItem | null>(null);

  const action = useIdempotentAction<{ contentHash: string }, unknown>();

  if (!agreements || agreements.length === 0) {
    return null;
  }

  const handleOpenConfirm = (item: PartyAgreementItem) => {
    action.reset();
    setError(null);
    setSuccess(null);
    setConfirmingItem(item);
  };

  const handleCloseConfirm = () => {
    if (action.pending) return;
    action.reset();
    setConfirmingItem(null);
  };

  const handleConfirm = async () => {
    if (!confirmingItem) return;
    if (action.pending) return;

    setError(null);
    setSuccess(null);

    const res = await action.run(
      { contentHash: confirmingItem.contentHash },
      (key, body) =>
        disputeCaseApi.confirmAgreement(caseId, confirmingItem.id, body, key),
    );

    if (res.status === "busy") return;
    if (res.status === "ok") {
      setSuccess("Đã xác nhận phương án thoả thuận. Đang chờ các bước tiếp theo.");
      setConfirmingItem(null);
      await onChanged();
    } else {
      const parsed = parseDisputeError(res.error, { action: "write" });
      setError(parsed.message);
    }
  };

  return (
    <section
      className={`${CARD} space-y-3 p-4`}
      data-testid="party-agreements-panel"
    >
      <h3 className="text-base font-semibold">Phương án thoả thuận chung</h3>
      <p className={`text-xs ${MUTED}`}>
        Điều tra viên có thể đề xuất phương án thoả thuận để bạn và bên còn lại
        cùng xác nhận. {PARTY_CONFIRM_AGREEMENT_NOTE}
      </p>

      {error && <Notice tone="danger">{error}</Notice>}
      {success && <Notice tone="info">{success}</Notice>}

      <ul className="space-y-3">
        {agreements.map((a) => (
          <li
            key={a.id}
            className="space-y-2 rounded-lg border border-[var(--border-color)] p-3 text-sm"
            data-testid={`party-agreement-${a.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] pb-2">
              <p className="font-semibold">{a.outcomeLabel}</p>
              <Pill
                tone={
                  a.status === "AGREED"
                    ? "success"
                    : a.status === "USED"
                      ? "info"
                      : a.status === "PROPOSED"
                        ? "pending"
                        : "neutral"
                }
              >
                {a.status === "PROPOSED"
                  ? "Đang chờ xác nhận"
                  : a.status === "AGREED"
                    ? "Hai bên đã xác nhận"
                    : a.status === "USED"
                      ? "Đã ghi nhận kết luận"
                      : "Đã huỷ"}
              </Pill>
            </div>

            {a.status === "PROPOSED" && (
              <div className="space-y-2">
                {a.myConfirmed ? (
                  <p className={`text-xs ${MUTED}`}>
                    Bạn đã xác nhận phương án này. Đang chờ bên còn lại xác nhận.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className={`text-xs ${MUTED}`}>
                      Phương án này đang chờ bạn xác nhận. {PARTY_CONFIRM_AGREEMENT_NOTE}
                    </p>
                    <button
                      type="button"
                      className={PRIMARY_BUTTON}
                      disabled={action.pending}
                      onClick={() => handleOpenConfirm(a)}
                    >
                      {action.pending ? "Đang gửi..." : "Xác nhận phương án thoả thuận"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {a.status === "AGREED" && (
              <p className={`text-xs ${MUTED}`}>
                Cả hai bên đã cùng đồng ý phương án này. Đang chờ điều tra viên
                ghi nhận vào kết luận hồ sơ.
              </p>
            )}

            {a.status === "USED" && (
              <p className={`text-xs ${MUTED}`}>
                Phương án này đã được ghi nhận vào kết luận chính thức của hồ sơ.
              </p>
            )}
          </li>
        ))}
      </ul>

      {/* Confirmation Modal */}
      {confirmingItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className={`w-full max-w-md space-y-4 ${CARD} p-6 shadow-xl`}>
            <h4 className="text-base font-semibold">
              Xác nhận phương án thoả thuận
            </h4>
            <p className="text-sm">
              Bạn có chắc chắn muốn xác nhận phương án: &ldquo;{confirmingItem.outcomeLabel}&rdquo;?
            </p>
            <p className={`text-xs ${MUTED}`}>
              {PARTY_CONFIRM_AGREEMENT_NOTE}
            </p>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className={`min-h-11 rounded-md border border-[var(--border-color)] px-4 text-sm font-medium hover:bg-[var(--border-color)]/20 sm:min-h-9 ${FOCUS}`}
                disabled={action.pending}
                onClick={handleCloseConfirm}
              >
                Đóng
              </button>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={action.pending}
                onClick={handleConfirm}
              >
                {action.pending ? "Đang gửi..." : "Đồng ý xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
