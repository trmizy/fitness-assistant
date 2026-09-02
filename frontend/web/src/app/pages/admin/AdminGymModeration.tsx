import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Check, X, Loader2, MapPin, AlertTriangle, Store } from "lucide-react";
import { adminService } from "../../services/api";
import type { Gym, GymBrand } from "../../types";

/**
 * Vòng 4 / Phase C — there was no admin-facing gym/brand moderation screen at all before this
 * phase (confirmed by grep before building this: no page referenced PATCH /admin/gyms/:id/status
 * anywhere in the frontend). Four sections, each its own tab: first-time gym approval (C1's
 * "approving the brand's first branch" and C2's "gym's first name/address approval" both
 * piggyback on the same setGymStatus('APPROVED') call here — no separate action needed for
 * those); the dedicated gym rename/address approval (C2); the dedicated brand rename approval
 * (C1); and the PERMANENTLY_CLOSED actionable item (C3) — refunding still-ACTIVE memberships
 * there is NOT done here, it reuses the existing exceptional-refund action on AdminDashboard
 * (reason GYM_CLOSED) — this tab only surfaces which gyms need that.
 */

type Tab = "pending" | "gym-renames" | "brand-renames" | "closed";

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING_REVIEW: { text: "Chờ duyệt", cls: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
  APPROVED: { text: "Đã duyệt", cls: "bg-green-500/10 border-green-500/20 text-green-400" },
  REJECTED: { text: "Bị từ chối", cls: "bg-red-500/10 border-red-500/20 text-red-400" },
  SUSPENDED: { text: "Đã khoá", cls: "bg-zinc-700/50 border-zinc-700 text-zinc-400" },
};

export function AdminGymModeration() {
  const [tab, setTab] = useState<Tab>("pending");
  const queryClient = useQueryClient();

  const { data: gyms = [], isLoading: gymsLoading } = useQuery<Gym[]>({
    queryKey: ["admin-gyms"],
    queryFn: () => adminService.listGymsForAdmin(),
  });
  const { data: brands = [], isLoading: brandsLoading } = useQuery<GymBrand[]>({
    queryKey: ["admin-brands"],
    queryFn: () => adminService.listBrandsForAdmin(),
  });
  const { data: permanentlyClosed = [], isLoading: closedLoading } = useQuery<(Gym & { activeMembershipCount: number })[]>({
    queryKey: ["admin-gyms-permanently-closed"],
    queryFn: () => adminService.listPermanentlyClosedGyms(),
  });

  const invalidateGyms = () => queryClient.invalidateQueries({ queryKey: ["admin-gyms"] });
  const invalidateBrands = () => queryClient.invalidateQueries({ queryKey: ["admin-brands"] });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" | "SUSPENDED" }) => adminService.setGymStatus(id, status),
    onSuccess: () => {
      toast.success("Đã cập nhật trạng thái phòng gym");
      invalidateGyms();
      queryClient.invalidateQueries({ queryKey: ["admin-gyms-permanently-closed"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const approveGymRenameMutation = useMutation({
    mutationFn: (id: string) => adminService.approveGymRename(id),
    onSuccess: () => {
      toast.success("Đã duyệt tên/địa chỉ mới");
      invalidateGyms();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể duyệt"),
  });

  const approveBrandRenameMutation = useMutation({
    mutationFn: (id: string) => adminService.approveBrandRename(id),
    onSuccess: () => {
      toast.success("Đã duyệt tên thương hiệu mới");
      invalidateBrands();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể duyệt"),
  });

  const pendingGyms = gyms.filter((g) => g.status === "PENDING_REVIEW");
  const gymsWithPendingRename = gyms.filter((g) => g.status !== "PENDING_REVIEW" && (g.pendingName || g.pendingAddress));
  const brandsWithPendingRename = brands.filter((b) => b.pendingName);

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Chờ duyệt lần đầu", count: pendingGyms.length },
    { key: "gym-renames", label: "Đổi tên/địa chỉ gym", count: gymsWithPendingRename.length },
    { key: "brand-renames", label: "Đổi tên thương hiệu", count: brandsWithPendingRename.length },
    { key: "closed", label: "Đã đóng cửa vĩnh viễn", count: permanentlyClosed.filter((g) => g.activeMembershipCount > 0).length },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Building2 className="w-5 h-5 text-green-400" /> Phòng gym & thương hiệu
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Duyệt phòng gym mới, duyệt đổi tên/địa chỉ (tên công khai chỉ đổi khi được duyệt ở
          đây), duyệt đổi tên thương hiệu, và theo dõi các phòng gym đã đóng cửa vĩnh viễn còn
          hội viên đang hoạt động cần hoàn tiền.
        </p>
      </div>

      <div data-testid="admin-gym-moderation-tabs" className="flex gap-1.5 flex-wrap border-b border-zinc-800/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`admin-gym-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              tab === t.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-black/20" : "bg-amber-500/20 text-amber-400"}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "pending" && (
        <div className="space-y-3">
          {gymsLoading ? (
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : pendingGyms.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đang chờ duyệt lần đầu." icon={Building2} />
          ) : (
            pendingGyms.map((g) => (
              <div key={g.id} data-testid="admin-gym-pending-card" data-gym-id={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{g.name}</p>
                    <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {g.address}{g.city ? `, ${g.city}` : ""}</p>
                    {g.brand && <p className="text-[11px] text-zinc-600 mt-1">Thương hiệu: {g.brand.name}</p>}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_LABEL[g.status]?.cls}`}>{STATUS_LABEL[g.status]?.text ?? g.status}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    data-testid="admin-gym-approve-button"
                    onClick={() => setStatusMutation.mutate({ id: g.id, status: "APPROVED" })}
                    disabled={setStatusMutation.isPending}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> Duyệt
                  </button>
                  <button
                    data-testid="admin-gym-reject-button"
                    onClick={() => setStatusMutation.mutate({ id: g.id, status: "REJECTED" })}
                    disabled={setStatusMutation.isPending}
                    className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Từ chối
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "gym-renames" && (
        <div className="space-y-3">
          {gymsLoading ? (
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : gymsWithPendingRename.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đang chờ duyệt đổi tên/địa chỉ." icon={Building2} />
          ) : (
            gymsWithPendingRename.map((g) => (
              <div key={g.id} data-testid="admin-gym-rename-card" data-gym-id={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                {g.pendingName && (
                  <div className="text-xs">
                    <span className="text-zinc-600">Tên hiện đang hiển thị: </span><span className="text-zinc-400">{g.approvedName ?? g.name}</span>
                    <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-amber-400 font-semibold">{g.pendingName}</span>
                  </div>
                )}
                {g.pendingAddress && (
                  <div className="text-xs">
                    <span className="text-zinc-600">Địa chỉ hiện đang hiển thị: </span><span className="text-zinc-400">{g.approvedAddress ?? g.address}</span>
                    <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-amber-400 font-semibold">{g.pendingAddress}</span>
                  </div>
                )}
                <button
                  data-testid="admin-gym-approve-rename-button"
                  onClick={() => approveGymRenameMutation.mutate(g.id)}
                  disabled={approveGymRenameMutation.isPending}
                  className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all mt-1"
                >
                  <Check className="w-3.5 h-3.5" /> Duyệt tên/địa chỉ mới
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "brand-renames" && (
        <div className="space-y-3">
          {brandsLoading ? (
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : brandsWithPendingRename.length === 0 ? (
            <EmptyState text="Không có thương hiệu nào đang chờ duyệt đổi tên." icon={Store} />
          ) : (
            brandsWithPendingRename.map((b) => (
              <div key={b.id} data-testid="admin-brand-rename-card" data-brand-id={b.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                <div className="text-xs">
                  <span className="text-zinc-600">Tên hiện đang hiển thị: </span>
                  <span className="text-zinc-400">{b.approvedName ?? "(chưa từng được duyệt)"}</span>
                  <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-amber-400 font-semibold">{b.pendingName}</span>
                </div>
                <button
                  data-testid="admin-brand-approve-rename-button"
                  onClick={() => approveBrandRenameMutation.mutate(b.id)}
                  disabled={approveBrandRenameMutation.isPending}
                  className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                >
                  <Check className="w-3.5 h-3.5" /> Duyệt tên thương hiệu mới
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "closed" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-600">
            Hoàn tiền cho hội viên còn hoạt động ở đây KHÔNG làm trực tiếp tại trang này — dùng
            hành động "Hoàn tiền" sẵn có (lý do "GYM_CLOSED") ở trang Dashboard cho từng hội
            viên. Trang này chỉ để biết phòng gym nào cần xử lý.
          </p>
          {closedLoading ? (
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : permanentlyClosed.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đã đóng cửa vĩnh viễn." icon={AlertTriangle} />
          ) : (
            permanentlyClosed.map((g) => (
              <div key={g.id} data-testid="admin-gym-permanently-closed-card" data-gym-id={g.id} data-active-count={g.activeMembershipCount} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{g.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Đóng cửa lúc {formatDateTime(g.closedAt)}{g.closureReason ? ` — ${g.closureReason}` : ""}</p>
                  </div>
                  {g.activeMembershipCount > 0 ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/10 border-red-500/20 text-red-400 whitespace-nowrap flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {g.activeMembershipCount} hội viên cần hoàn tiền
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-zinc-700/50 border-zinc-700 text-zinc-400 whitespace-nowrap">Không còn hội viên hoạt động</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ text, icon: Icon }: { text: string; icon: typeof Building2 }) {
  return (
    <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-16 text-center">
      <Icon className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
      <p className="text-zinc-600 text-sm">{text}</p>
    </div>
  );
}
