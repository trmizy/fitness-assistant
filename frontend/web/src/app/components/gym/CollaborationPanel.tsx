import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Loader2, Check, X, Repeat, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { collaborationService } from "../../services/api";
import { useBackDismissible } from "../../hooks/useBackDismissible";

type Party = "PT" | "GYM";

interface Collaboration {
  id: string;
  gymId: string;
  ptUserId: string;
  proposedPtRate: string;
  proposedGymRate: string;
  platformRate: string;
  status: "PENDING" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "TERMINATED";
  proposedBy: Party;
  round: number;
  expiresAt: string;
  note?: string | null;
  gym?: { id: string; name: string; city?: string | null } | null;
}

const STATUS: Record<Collaboration["status"], { label: string; cls: string }> = {
  PENDING: { label: "Chờ phản hồi", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  COUNTERED: { label: "Đã đề xuất lại", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  ACCEPTED: { label: "Đang hợp tác", cls: "bg-green-500/10 text-green-400 border-green-500/20" },
  REJECTED: { label: "Đã từ chối", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  EXPIRED: { label: "Hết hạn", cls: "bg-zinc-700/50 text-zinc-400 border-zinc-700" },
  TERMINATED: { label: "Đã chấm dứt", cls: "bg-zinc-700/50 text-zinc-400 border-zinc-700" },
};

const pct = (r: string) => `${(Number(r) * 100).toFixed(0)}%`;

/**
 * Negotiating the revenue split between a trainer and a gym.
 *
 * Both sides use this panel; `as` decides which endpoints are called and, more importantly,
 * whose turn it is. The turn is shown explicitly rather than left implicit — a side that has
 * just made an offer cannot accept it themselves (the server refuses with 409), and without
 * saying so the disabled buttons would look like a bug.
 */
export function CollaborationPanel({ as, gymId }: { as: Party; gymId?: string }) {
  const queryClient = useQueryClient();
  const [counterFor, setCounterFor] = useState<Collaboration | null>(null);
  const [ptRate, setPtRate] = useState("55");
  const [gymRate, setGymRate] = useState("35");
  const [proposing, setProposing] = useState(false);
  // One dialog serves both flows; Back closes whichever opened it.
  useBackDismissible(proposing || !!counterFor, () => { setProposing(false); setCounterFor(null); });
  const [inviteePtId, setInviteePtId] = useState("");

  const queryKey = ["collaborations", as];
  const { data: rows = [], isLoading } = useQuery<Collaboration[]>({
    queryKey,
    queryFn: () => (as === "GYM" ? collaborationService.listForOwner() : collaborationService.listMine()),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });
  const onError = (e: any) =>
    toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || "Thao tác thất bại");

  // The platform's cut is fixed; the two partners only divide what is left, so the form asks
  // for two numbers and derives nothing the server would reject.
  const platformPct = 10;
  const sum = Number(ptRate) + Number(gymRate) + platformPct;
  const sumOk = Math.abs(sum - 100) < 1e-9;

  const respond = useMutation({
    mutationFn: (v: { id: string; action: "ACCEPT" | "REJECT" | "COUNTER" }) =>
      collaborationService.respond(v.id, as, {
        action: v.action,
        ...(v.action === "COUNTER"
          ? {
              ptRate: (Number(ptRate) / 100).toFixed(4),
              gymRate: (Number(gymRate) / 100).toFixed(4),
              platformRate: (platformPct / 100).toFixed(4),
            }
          : {}),
      }),
    onSuccess: (_d, v) => {
      toast.success(
        v.action === "ACCEPT" ? "Đã chấp nhận hợp tác" : v.action === "REJECT" ? "Đã từ chối" : "Đã gửi đề xuất mới",
      );
      setCounterFor(null);
      invalidate();
    },
    onError,
  });

  const propose = useMutation({
    mutationFn: () => {
      const body = {
        ptRate: (Number(ptRate) / 100).toFixed(4),
        gymRate: (Number(gymRate) / 100).toFixed(4),
        platformRate: (platformPct / 100).toFixed(4),
      };
      return as === "GYM"
        ? collaborationService.proposeAsGym(gymId!, { ...body, ptUserId: inviteePtId.trim() })
        : collaborationService.proposeAsPt(gymId!, body);
    },
    onSuccess: () => {
      toast.success("Đã gửi đề xuất hợp tác");
      setProposing(false);
      setInviteePtId("");
      invalidate();
    },
    onError,
  });

  const terminate = useMutation({
    mutationFn: (id: string) => collaborationService.terminate(id, as),
    onSuccess: () => {
      toast.success("Đã chấm dứt hợp tác. Hợp đồng đang chạy giữ nguyên tỷ lệ cũ.");
      invalidate();
    },
    onError,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-bold flex items-center gap-2">
          <Handshake className="w-4 h-4 text-green-400" /> Cộng tác chia doanh thu
        </h3>
        {gymId && (
          <button
            type="button"
            onClick={() => setProposing(true)}
            className="bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
          >
            {as === "GYM" ? "Mời PT" : "Gửi đề xuất"}
          </button>
        )}
      </div>

      <p className="text-[11px] text-zinc-600 leading-snug">
        Tỷ lệ được <span className="text-zinc-400">khoá tại thời điểm ký hợp đồng</span>. Thương lượng lại
        hay chấm dứt hợp tác đều không ảnh hưởng các hợp đồng đang chạy.
      </p>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-8 text-center text-sm text-zinc-500">
          Chưa có đề xuất hợp tác nào.
        </div>
      )}

      {rows.map((c) => {
        const cfg = STATUS[c.status];
        const open = c.status === "PENDING" || c.status === "COUNTERED";
        const myTurn = open && c.proposedBy !== as;
        return (
          <div key={c.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-zinc-200 truncate">
                {as === "PT" ? (c.gym?.name ?? c.gymId.slice(0, 8)) : `PT ${c.ptUserId.slice(0, 8)}`}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.cls}`}>{cfg.label}</span>
            </div>

            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-zinc-800/60 text-zinc-300">PT {pct(c.proposedPtRate)}</span>
              <span className="px-2 py-1 rounded bg-zinc-800/60 text-zinc-300">Gym {pct(c.proposedGymRate)}</span>
              <span className="px-2 py-1 rounded bg-zinc-800/60 text-zinc-500">Nền tảng {pct(c.platformRate)}</span>
            </div>

            {open && (
              <div className="text-[11px] text-zinc-600">
                Vòng {c.round} · {myTurn ? "Đang chờ bạn phản hồi" : "Đang chờ phía bên kia phản hồi"} · hạn{" "}
                {new Date(c.expiresAt).toLocaleDateString("vi-VN")}
              </div>
            )}
            {c.note && <p className="text-xs text-zinc-500 italic">“{c.note}”</p>}

            {myTurn && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => respond.mutate({ id: c.id, action: "ACCEPT" })}
                  disabled={respond.isPending}
                  className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-1.5 rounded-lg text-xs font-bold"
                >
                  <Check className="w-3.5 h-3.5" /> Chấp nhận
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCounterFor(c);
                    setPtRate(String(Math.round(Number(c.proposedPtRate) * 100)));
                    setGymRate(String(Math.round(Number(c.proposedGymRate) * 100)));
                  }}
                  className="flex items-center gap-1 border border-zinc-700/60 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium"
                >
                  <Repeat className="w-3.5 h-3.5" /> Đề xuất lại
                </button>
                <button
                  type="button"
                  onClick={() => respond.mutate({ id: c.id, action: "REJECT" })}
                  className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium"
                >
                  <X className="w-3.5 h-3.5" /> Từ chối
                </button>
              </div>
            )}

            {c.status === "ACCEPTED" && (
              <button
                type="button"
                onClick={() => terminate.mutate(c.id)}
                disabled={terminate.isPending}
                className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium mt-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Chấm dứt hợp tác
              </button>
            )}
          </div>
        );
      })}

      {(proposing || counterFor) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">
                {counterFor ? `Đề xuất lại (vòng ${counterFor.round + 1})` : "Đề xuất hợp tác"}
              </h3>
            </div>
            <div className="p-5 space-y-3">
              {proposing && as === "GYM" && (
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1 block">ID huấn luyện viên</label>
                  <input
                    value={inviteePtId}
                    onChange={(e) => setInviteePtId(e.target.value)}
                    placeholder="userId của PT"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1 block">PT (%)</label>
                  <input
                    type="number"
                    value={ptRate}
                    onChange={(e) => setPtRate(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-400 mb-1 block">Phòng gym (%)</label>
                  <input
                    type="number"
                    value={gymRate}
                    onChange={(e) => setGymRate(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                </div>
              </div>
              <div className="text-xs text-zinc-500">
                Nền tảng giữ cố định <span className="text-zinc-300">{platformPct}%</span>. Tổng hiện tại:{" "}
                <span className={sumOk ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{sum}%</span>
              </div>
              {!sumOk && (
                <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  Tổng ba tỷ lệ phải bằng đúng 100%. Máy chủ sẽ từ chối nếu lệch, kể cả lệch rất nhỏ.
                </div>
              )}
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setProposing(false);
                  setCounterFor(null);
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={!sumOk || propose.isPending || respond.isPending || (proposing && as === "GYM" && !inviteePtId.trim())}
                onClick={() =>
                  counterFor ? respond.mutate({ id: counterFor.id, action: "COUNTER" }) : propose.mutate()
                }
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg flex items-center justify-center gap-2"
              >
                {(propose.isPending || respond.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                Gửi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
