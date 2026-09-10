import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UsersIcon as Users,
  PlusIcon as Plus,
  XIcon as X,
  CircleNotchIcon as Loader2,
  CopyIcon as Copy,
  InfoIcon as Info,
  DotsThreeVerticalIcon as MoreVertical,
} from "@phosphor-icons/react";
import { gymService } from "../../services/api";

/**
 * Phase 3 mục 3.2 — chủ sở hữu tự mời/thu hồi quản lý chi nhánh, không cần admin.
 */
export function ManageManagersPage() {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ email: string; inviteLink: string; emailSent: boolean } | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const gymsQuery = useQuery({ queryKey: ["owner-gyms"], queryFn: () => gymService.listOwnedGyms() });
  const accountsQuery = useQuery({ queryKey: ["owner-partner-accounts"], queryFn: () => gymService.listPartnerAccounts() });
  const invitationsQuery = useQuery({ queryKey: ["owner-partner-invitations"], queryFn: () => gymService.listPartnerInvitations() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["owner-partner-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["owner-partner-invitations"] });
  };

  const revokeMutation = useMutation({
    mutationFn: (accountId: string) => gymService.revokePartnerAccount(accountId, "Thu hồi bởi chủ sở hữu"),
    onSuccess: () => { toast.success("Đã thu hồi quản lý"); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể thu hồi"),
  });
  const resendMutation = useMutation({
    mutationFn: (id: string) => gymService.resendManagerInvitation(id),
    onSuccess: (data: any) => {
      navigator.clipboard.writeText(data.inviteLink).catch(() => {});
      toast.success("Đã gửi lại thư mời (đã sao chép liên kết)");
      invalidate();
    },
  });
  const revokeInviteMutation = useMutation({
    mutationFn: (id: string) => gymService.revokeManagerInvitation(id),
    onSuccess: () => { toast.success("Đã thu hồi thư mời"); invalidate(); },
  });

  const managers = (accountsQuery.data ?? []).filter((a: any) => a.role === "MANAGER" && a.status === "ACTIVE");
  const pendingInvitations = (invitationsQuery.data ?? []).filter((i: any) => i.status === "PENDING" && i.role === "MANAGER");
  const gymsById = new Map((gymsQuery.data ?? []).map((g: any) => [g.id, g]));

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Users className="w-5 h-5 text-green-400" /> Người quản lý
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Mời người vận hành chi nhánh giúp bạn — mỗi người một tài khoản đăng nhập riêng.</p>
        </div>
        <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap">
          <Plus className="w-4 h-4" /> Mời
        </button>
      </div>

      {accountsQuery.isLoading ? (
        <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
      ) : managers.length === 0 && pendingInvitations.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-16 text-center">
          <Users className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-600 text-sm">Chưa có người quản lý nào.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {managers.map((a: any) => (
            <div key={a.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">
                    {a.identity?.firstName ?? ""} {a.identity?.lastName ?? ""}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-500/10 border-blue-500/20 text-blue-400">Quản lý</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{a.identity?.email}</p>
                  <p className="text-[11px] text-zinc-600 mt-1">
                    {(a.scopedGymIds ?? []).map((gid: string) => (gymsById.get(gid) as any)?.name ?? gid).join(", ") || "Chưa gán chi nhánh"}
                  </p>
                </div>
                <div className="relative flex-shrink-0">
                  <button onClick={() => setMenuOpenId(menuOpenId === a.id ? null : a.id)} className="p-1.5 text-zinc-500 hover:text-zinc-300">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {menuOpenId === a.id && (
                    <div className="absolute right-0 mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-10 overflow-hidden" onMouseLeave={() => setMenuOpenId(null)}>
                      <button
                        onClick={() => { revokeMutation.mutate(a.id); setMenuOpenId(null); }}
                        className="w-full text-left px-3 py-2.5 text-xs text-red-400 hover:bg-zinc-800"
                      >
                        Thu hồi
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {pendingInvitations.map((inv: any) => {
            const isOld = Date.now() - new Date(inv.createdAt).getTime() > 7 * 86_400_000;
            return (
              <div key={inv.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-zinc-300">{inv.email} <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-500/10 border-blue-500/20 text-blue-400">Quản lý</span></p>
                    <p className={`text-[11px] mt-1 ${isOld ? "text-amber-400" : "text-zinc-600"}`}>
                      Đã mời {Math.floor((Date.now() - new Date(inv.createdAt).getTime()) / 86_400_000)} ngày trước
                    </p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 border-amber-500/20 text-amber-400 whitespace-nowrap">Chờ nhận</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => resendMutation.mutate(inv.id)} className="text-[11px] border border-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded-lg">Gửi lại</button>
                  <button onClick={() => revokeInviteMutation.mutate(inv.id)} className="text-[11px] border border-red-500/30 text-red-400 px-2.5 py-1.5 rounded-lg">Thu hồi</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showInvite && (
        <InviteManagerModal
          gyms={gymsQuery.data ?? []}
          onClose={() => setShowInvite(false)}
          onCreated={(data) => { setCreatedInvite(data); invalidate(); }}
        />
      )}
      {createdInvite && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setCreatedInvite(null)}>
          <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-green-500/20 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-green-400">Đã gửi lời mời tới {createdInvite.email}</p>
            <p className="text-xs text-zinc-500">{createdInvite.emailSent ? "Email đã được gửi." : "Không gửi được email tự động — hãy sao chép liên kết dưới đây."}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-amber-400 font-mono truncate">{createdInvite.inviteLink}</code>
              <button onClick={() => { navigator.clipboard.writeText(createdInvite.inviteLink).catch(() => {}); toast.success("Đã sao chép"); }} className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 flex-shrink-0">
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <button onClick={() => setCreatedInvite(null)} className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300">Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteManagerModal({ gyms, onClose, onCreated }: { gyms: any[]; onClose: () => void; onCreated: (data: any) => void }) {
  const [email, setEmail] = useState("");
  const [scopedGymIds, setScopedGymIds] = useState<string[]>([]);

  const inviteMutation = useMutation({
    mutationFn: () => gymService.inviteManager({ email: email.trim(), scopedGymIds }),
    onSuccess: (data: any) => {
      onCreated({ email: email.trim(), inviteLink: data.inviteLink, emailSent: data.emailSent });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể mời"),
  });

  const toggleGym = (id: string) => setScopedGymIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-200">Mời người quản lý</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">Email *</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="quanly@example.com" className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600" />
        </div>
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">Quản lý chi nhánh nào? *</label>
          <div className="space-y-1.5">
            {gyms.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={scopedGymIds.includes(g.id)} onChange={() => toggleGym(g.id)} className="accent-green-500" />
                {g.name}
              </label>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Người quản lý xem và vận hành được chi nhánh được gán, nhưng KHÔNG xem được ví,
          KHÔNG mời thêm người, và KHÔNG sửa được thương hiệu.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-zinc-400 border border-zinc-700 rounded-lg">Huỷ</button>
          <button
            onClick={() => inviteMutation.mutate()}
            disabled={!email.trim() || scopedGymIds.length === 0 || inviteMutation.isPending}
            className="flex-1 py-2 text-xs font-bold bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black rounded-lg"
          >
            {inviteMutation.isPending ? "Đang gửi..." : "Gửi lời mời"}
          </button>
        </div>
      </div>
    </div>
  );
}
