import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlassIcon as Search, MapPinIcon as MapPin, PhoneIcon as Phone, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { GymCheckinPanel } from "../../components/gym/GymCheckinPanel";
import { EmptyState, ErrorState } from "../../components/dashboard/DashboardStates";
import { PARTNER_ROLE_LABEL } from "../../utils/gymStaffRole";
import { useStaffRole } from "../../hooks/useStaffRole";
import type { Gym, GymMembershipContractStatus } from "../../types";

/** Hàng hội viên lễ tân nhận được từ server (rút gọn: không giá, không mã giao dịch — gym-service/staff-views.ts). */
type FrontDeskMembership = {
  id: string;
  clientId: string;
  status: GymMembershipContractStatus;
  startDate?: string | null;
  endDate?: string | null;
  totalVisits?: number | null;
  usedVisits: number;
};

const OPERATIONAL_LABEL: Record<string, { text: string; cls: string }> = {
  OPEN: { text: "Đang mở cửa", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
  TEMPORARILY_CLOSED: { text: "Tạm đóng cửa", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  PERMANENTLY_CLOSED: { text: "Đã đóng cửa", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
};

function validity(m: FrontDeskMembership, now = Date.now()): { label: string; cls: string; ok: boolean } {
  if (m.status === "ACTIVE") {
    const end = m.endDate ? new Date(m.endDate).getTime() : null;
    if (end !== null && end < now) return { label: "Hết hạn", cls: "bg-zinc-700/50 text-zinc-400", ok: false };
    if (m.totalVisits != null && m.usedVisits >= m.totalVisits) return { label: "Hết lượt", cls: "bg-amber-500/10 text-amber-400", ok: false };
    return { label: "Còn hạn", cls: "bg-green-500/10 text-green-400", ok: true };
  }
  if (m.status === "EXPIRED") return { label: "Hết hạn", cls: "bg-zinc-700/50 text-zinc-400", ok: false };
  if (m.status === "CANCELLED") return { label: "Đã huỷ", cls: "bg-zinc-700/50 text-zinc-400", ok: false };
  return { label: "Chờ thanh toán", cls: "bg-amber-500/10 text-amber-400", ok: false };
}

const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "—");

/**
 * D15 — trang chủ của LỄ TÂN: chỉ việc quầy. Chi nhánh được gán (chỉ xem), mã QR check-in + lượt vào gần đây, và
 * "thẻ này còn dùng được không" (hạn/lượt). KHÔNG có doanh thu, ví, giá gói, cộng tác PT hay nhân sự — server
 * không trả những thứ đó cho vai trò này (staff-views.ts), trang chỉ không có chỗ để hiện.
 */
export function FrontDeskPage() {
  const { user } = useApp();
  const { role } = useStaffRole();
  const uid = user?.id ?? "guest";
  const [gymId, setGymId] = useState<string>("");
  const [search, setSearch] = useState("");

  const gymsQuery = useQuery<Gym[]>({ queryKey: ["frontdesk-gyms", uid], queryFn: () => gymService.listOwnedGyms() });
  const gyms = useMemo(() => (gymsQuery.data ?? []).filter((g) => g.status !== "DRAFT"), [gymsQuery.data]);
  useEffect(() => {
    if (!gymId && gyms.length > 0) setGymId(gyms[0].id);
  }, [gyms, gymId]);
  const gym = gyms.find((g) => g.id === gymId);

  const membershipsQuery = useQuery<FrontDeskMembership[]>({
    queryKey: ["frontdesk-memberships", uid, gymId],
    queryFn: () => gymService.listOwnedMemberships(gymId),
    enabled: !!gymId,
    refetchInterval: 30000,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (membershipsQuery.data ?? [])
      .filter((m) => m.status !== "PENDING_PAYMENT")
      .filter((m) => !q || m.clientId.toLowerCase().includes(q))
      .sort((a, b) => Number(validity(b).ok) - Number(validity(a).ok))
      .slice(0, 100);
  }, [membershipsQuery.data, search]);

  const op = OPERATIONAL_LABEL[(gym as any)?.operationalStatus ?? "OPEN"] ?? OPERATIONAL_LABEL.OPEN;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5" data-testid="front-desk-page">
      <div>
        <h1 className="text-zinc-100 text-xl font-bold">Quầy lễ tân</h1>
        <p className="text-zinc-500 text-sm mt-0.5">{role ? PARTNER_ROLE_LABEL[role] : ""} · QR check-in và hạn thẻ hội viên</p>
      </div>

      {gymsQuery.isLoading ? (
        <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
      ) : gymsQuery.isError ? (
        <ErrorState message="Không tải được danh sách chi nhánh." />
      ) : gyms.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
          <EmptyState icon={MapPin} title="Chưa có chi nhánh nào được gán" hint="Hãy nhờ chủ sở hữu gán chi nhánh cho tài khoản của bạn." />
        </div>
      ) : (
        <>
          {gyms.length > 1 && (
            <select
              aria-label="Chọn chi nhánh"
              value={gymId}
              onChange={(e) => setGymId(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-200"
            >
              {gyms.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}

          {gym && (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-2" data-testid="front-desk-branch">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-bold text-zinc-100 min-w-0 break-words">{gym.name}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${op.cls}`}>{op.text}</span>
              </div>
              <p className="text-xs text-zinc-500 flex items-start gap-1.5"><MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{gym.address}</p>
              {gym.phone && <p className="text-xs text-zinc-500 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{gym.phone}</p>}
            </div>
          )}

          {gymId && <GymCheckinPanel gymId={gymId} showPtCheckins={role === "OWNER" || role === "MANAGER"} />}

          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3" data-testid="front-desk-members">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-200">Hạn thẻ hội viên</h2>
              <span className="text-[11px] text-zinc-600">{membershipsQuery.data?.length ?? 0} thẻ</span>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo mã khách (vd: 1a2b3c4d)"
                className="w-full pl-9 pr-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600"
              />
            </div>
            {membershipsQuery.isLoading ? (
              <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
            ) : membershipsQuery.isError ? (
              <ErrorState message="Không tải được danh sách hội viên." />
            ) : rows.length === 0 ? (
              <EmptyState icon={Search} title="Không có thẻ phù hợp" hint="Thử bỏ bớt từ khoá tìm kiếm." />
            ) : (
              <ul className="space-y-1.5">
                {rows.map((m) => {
                  const v = validity(m);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 bg-zinc-800/40 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-200 truncate">Khách #{m.clientId.slice(0, 8)}</p>
                        <p className="text-[11px] text-zinc-500">
                          Hết hạn {fmtDate(m.endDate)} ·{" "}
                          {m.totalVisits != null ? `còn ${Math.max(0, m.totalVisits - m.usedVisits)}/${m.totalVisits} lượt` : "không giới hạn lượt"}
                        </p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${v.cls}`}>{v.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
