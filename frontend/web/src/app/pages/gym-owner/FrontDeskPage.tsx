import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlassIcon as Search, MapPinIcon as MapPin, PhoneIcon as Phone, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { GymCheckinPanel } from "../../components/gym/GymCheckinPanel";
import { AssistedCheckinPanel, CheckinExceptionsPanel } from "../../components/gym/AssistedCheckinPanel";
import { EmptyState, ErrorState } from "../../components/dashboard/DashboardStates";
import { PARTNER_ROLE_LABEL } from "../../utils/gymStaffRole";
import { useStaffRole } from "../../hooks/useStaffRole";
import { filterByName, normalizeFrontDeskToday, presenceOf, type FrontDeskToday } from "../../utils/frontDeskToday";
import type { Gym } from "../../types";

const OPERATIONAL_LABEL: Record<string, { text: string; cls: string }> = {
  OPEN: { text: "Đang mở cửa", cls: "text-green-400 bg-green-500/10 border-green-500/20" },
  TEMPORARILY_CLOSED: { text: "Tạm đóng cửa", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  PERMANENTLY_CLOSED: { text: "Đã đóng cửa", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
};

const PRESENCE_CLS = {
  CHECKED_IN: "bg-green-500/10 text-green-400",
  BOOKED: "bg-amber-500/10 text-amber-400",
} as const;

/**
 * D15 / D15b — trang chủ của LỄ TÂN: chỉ việc quầy. Chi nhánh được gán (chỉ xem), mã QR check-in, PT đã check-in hôm nay
 * và "khách hôm nay" (đã vào hoặc có lịch tập tại chi nhánh — CHỈ tên hiển thị). KHÔNG có danh sách hội viên, SĐT,
 * e-mail, InBody, doanh thu, ví, giá gói, cộng tác PT hay nhân sự — server không trả những thứ đó cho vai trò này
 * (staff-views.ts), trang chỉ không có chỗ để hiện. D15c: lễ tân được check-in hộ HỘI VIÊN không quét được QR, sau khi xác minh
 * danh tính (AssistedCheckinPanel); PT vẫn chỉ tự quét QR. Quản lý/chủ thấy thêm danh sách ngoại lệ chờ duyệt.
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

  const todayQuery = useQuery<FrontDeskToday>({
    queryKey: ["frontdesk-today", uid, gymId],
    queryFn: async () => normalizeFrontDeskToday(await gymService.getFrontDeskToday(gymId)),
    enabled: !!gymId,
    refetchInterval: 15000,
  });

  const rows = useMemo(() => filterByName(todayQuery.data?.clients ?? [], search), [todayQuery.data, search]);

  const op = OPERATIONAL_LABEL[(gym as any)?.operationalStatus ?? "OPEN"] ?? OPERATIONAL_LABEL.OPEN;

  return (
    <div className="p-4 md:p-6 max-w-3xl w-full min-w-0 mx-auto space-y-5" data-testid="front-desk-page">
      <div>
        <h1 className="text-zinc-100 text-xl font-bold">Quầy lễ tân</h1>
        <p className="text-zinc-500 text-sm mt-0.5">{role ? PARTNER_ROLE_LABEL[role] : ""} · QR check-in, check-in hộ và khách hôm nay</p>
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

          {gymId && <GymCheckinPanel gymId={gymId} ptCheckinsMode="today" />}

          {gymId && <CheckinExceptionsPanel gymId={gymId} />}
          {gymId && <AssistedCheckinPanel gymId={gymId} />}

          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4 space-y-3" data-testid="front-desk-members">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-200">Khách hôm nay</h2>
              <span className="text-[11px] text-zinc-600">{todayQuery.data?.clients.length ?? 0} người</span>
            </div>
            <p className="text-[11px] text-zinc-600">Người đã check-in hoặc có lịch tập tại chi nhánh này hôm nay.</p>
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên"
                aria-label="Tìm khách theo tên"
                className="w-full pl-9 pr-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600"
              />
            </div>
            {todayQuery.isLoading ? (
              <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
            ) : todayQuery.isError ? (
              <ErrorState message="Không tải được danh sách khách hôm nay." />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Search}
                title={search.trim() ? "Không có khách phù hợp" : "Hôm nay chưa có khách"}
                hint={search.trim() ? "Thử bỏ bớt từ khoá tìm kiếm." : "Khách sẽ hiện ở đây khi họ check-in hoặc có lịch tập tại chi nhánh."}
              />
            ) : (
              <ul className="space-y-1.5">
                {rows.map((c, i) => {
                  const p = presenceOf(c);
                  return (
                    <li key={`${i}-${c.displayName}`} className="flex items-center justify-between gap-3 bg-zinc-800/40 rounded-lg px-3 py-2">
                      <p className="text-sm text-zinc-200 truncate min-w-0">{c.displayName}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${PRESENCE_CLS[p.kind]}`}>{p.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {todayQuery.data && !todayQuery.data.bookingsAvailable && (
              <p className="text-[11px] text-amber-400/80" data-testid="bookings-unavailable">
                Chưa tải được lịch tập hôm nay — danh sách chỉ gồm người đã check-in.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
