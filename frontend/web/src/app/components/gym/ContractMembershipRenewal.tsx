import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { GymDetailModal } from "./GymDetailModal";
import { latestMembershipEnd, renewalDate } from "../../utils/membershipRenewal";
import { coverageWarningCopy } from "../../utils/contractGymOptions";

/**
 * Hợp đồng PT gắn với một chi nhánh gym: hiện ngày hết hạn gói hội viên của khách ở thương hiệu đó và nút
 * "Gia hạn gói hội viên" (mở danh sách gói của chi nhánh ở chế độ gia hạn — gói mới nối tiếp ngay khi gói cũ hết).
 * Chỉ hiển thị thông tin: máy chủ mới là nơi quyết định ngày bắt đầu/kết thúc thật khi thanh toán xong.
 */
export function ContractMembershipRenewal({
  gymId,
  contractEndIso,
  validityDays,
}: {
  gymId: string;
  /** Ngày kết thúc hợp đồng PT (ISO) nếu đã có; chưa có thì dùng hôm nay + số ngày hiệu lực của gói. */
  contractEndIso?: string | null;
  validityDays?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const { data: gym } = useQuery<any>({
    queryKey: ["gym", gymId],
    queryFn: () => gymService.getGym(gymId),
    retry: 1,
  });
  const { data: memberships = [] } = useQuery<any[]>({
    queryKey: ["client-gym-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });
  const branchIds: string[] = [gymId, ...((gym?.brandBranches ?? []) as { id: string }[]).map((b) => b.id)];
  const latestEnd = latestMembershipEnd(memberships, branchIds);
  const contractEnd = contractEndIso && !Number.isNaN(new Date(contractEndIso).getTime())
    ? new Date(contractEndIso)
    : validityDays ? new Date(Date.now() + validityDays * 86_400_000) : null;
  const notEnough = !!latestEnd && !!contractEnd && latestEnd.getTime() < contractEnd.getTime();

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4 space-y-2" data-testid="contract-membership-renewal">
      <h4 className="text-sm font-semibold text-zinc-400">Gói hội viên phòng gym</h4>
      <p className="text-xs text-zinc-300">
        {latestEnd
          ? `Gói hội viên của bạn hết hạn ${renewalDate(latestEnd)}.`
          : "Bạn chưa có gói hội viên còn hiệu lực tại phòng gym này."}
      </p>
      {notEnough && (
        <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 leading-snug">
          {coverageWarningCopy(latestEnd!.toISOString())}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 border border-green-500/40 text-green-400 text-xs font-semibold rounded-lg hover:bg-green-500/10 transition-colors"
      >
        Gia hạn gói hội viên
      </button>
      {open && (
        <GymDetailModal
          gymId={gymId}
          initialTab="pricing"
          coverUntil={contractEnd ? contractEnd.toISOString() : null}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
