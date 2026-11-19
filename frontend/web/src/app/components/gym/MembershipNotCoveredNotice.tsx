import { useState } from "react";
import { GymDetailModal } from "./GymDetailModal";
import type { MembershipNotCovered } from "../../utils/membershipRenewal";

/**
 * Đặt / dời buổi tập bị từ chối vì gói hội viên không có hiệu lực vào ngày đó (422 SESSION_NOT_COVERED_BY_MEMBERSHIP):
 * hiện lý do của máy chủ + nút "Gia hạn gói hội viên" mở danh sách gói của đúng chi nhánh ở chế độ gia hạn
 * (gói mới nối tiếp ngay khi gói cũ hết). Không có gymId thì chỉ hiện lý do.
 */
export function MembershipNotCoveredNotice({
  refusal,
  coverUntil,
}: {
  refusal: MembershipNotCovered;
  /** Ngày muốn được phủ (ISO) — dùng để xếp/gắn nhãn gói "Đủ cho hợp đồng PT". */
  coverUntil?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      role="alert"
      data-testid="membership-not-covered-notice"
      className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
    >
      <p className="text-xs leading-snug text-amber-400">{refusal.message}</p>
      {refusal.gymId && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-10 rounded-lg border border-green-500/40 px-3 py-2 text-xs font-semibold text-green-400 transition-colors hover:bg-green-500/10"
        >
          Gia hạn gói hội viên
        </button>
      )}
      {open && refusal.gymId && (
        <GymDetailModal
          gymId={refusal.gymId}
          initialTab="pricing"
          coverUntil={coverUntil ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
