import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Gavel, Loader2, UserX, X } from "lucide-react";
import { adminService } from "../../services/api";
import type { Session } from "../../types";

/**
 * Money-flow redesign plan item 4.2 — "màn hình xử lý tranh chấp cho quản trị viên".
 *
 * Backend has had GET /admin/sessions/disputed and POST /admin/sessions/:id/resolve since the
 * client-confirmation feature (VĐ2) shipped — no admin UI ever called either one, so a
 * disputed session's money stayed frozen (quota untouched, nothing settled) with no way for
 * anyone to actually rule on it.
 */

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

export function AdminDisputes() {
  const queryClient = useQueryClient();
  const [rulingId, setRulingId] = useState<string | null>(null);
  const [rulingAction, setRulingAction] = useState<"COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED" | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "disputed-sessions"],
    queryFn: () => adminService.listDisputedSessions(),
  });
  const sessions: Session[] = data ?? [];

  const resolveMutation = useMutation({
    mutationFn: ({ id, resolution, note }: { id: string; resolution: "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED"; note: string }) =>
      adminService.resolveSessionDispute(id, resolution, note),
    onSuccess: () => {
      toast.success("Đã phân xử khiếu nại");
      setRulingId(null);
      setRulingAction(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["admin", "disputed-sessions"] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error || "Không thể phân xử"),
  });

  const openRuling = (sessionId: string, action: "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED") => {
    setRulingId(sessionId);
    setRulingAction(action);
    setNote("");
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Gavel className="w-5 h-5 text-amber-400" /> Xử lý khiếu nại buổi tập
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Khách đã khiếu nại báo cáo của PT — buổi tập không bị trừ và tiền chưa được quyết
          toán cho tới khi có kết luận.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-20 text-center">
          <Gavel className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-600 text-sm">Không có khiếu nại nào đang chờ xử lý.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((s: any) => (
            <div key={s.id} className="bg-zinc-900 rounded-xl border border-amber-500/30 p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">
                    Buổi tập lúc {formatDateTime(s.scheduledStartAt)}
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Hợp đồng: {s.contract?.packageName ?? s.contractId.slice(0, 8)} · Khách{" "}
                    {s.clientUserId.slice(0, 8)}... · PT {s.ptUserId.slice(0, 8)}...
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/10 border-red-500/20 text-red-400 whitespace-nowrap">
                  Đang khiếu nại
                </span>
              </div>

              {/* Evidence: what each side said */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-1">
                    PT báo cáo
                  </p>
                  <p className="text-xs text-zinc-400">{s.ptNotes || "(không có ghi chú)"}</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-red-400/80 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Khách khiếu nại
                  </p>
                  <p className="text-xs text-zinc-300">{s.disputeReason || "(không có lý do)"}</p>
                </div>
              </div>

              {rulingId === s.id ? (
                <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3">
                  <p className="text-xs text-zinc-400 mb-2">
                    Kết luận:{" "}
                    <span
                      className={
                        rulingAction === "COMPLETED"
                          ? "text-blue-400 font-bold"
                          : rulingAction === "PT_NO_SHOW_CONFIRMED"
                            ? "text-amber-400 font-bold"
                            : "text-red-400 font-bold"
                      }
                    >
                      {rulingAction === "COMPLETED"
                        ? "Buổi tập ĐÃ diễn ra — trừ quota, PT được trả tiền"
                        : rulingAction === "PT_NO_SHOW_CONFIRMED"
                          ? "Xác nhận PT vắng mặt — bồi thường khách bằng tiền, KHÔNG trừ buổi (giống PT tự nhận vắng)"
                          : "Buổi tập KHÔNG diễn ra — không trừ quota"}
                    </span>
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Ghi rõ căn cứ phân xử..."
                    className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-2 min-h-[70px]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setRulingId(null);
                        setRulingAction(null);
                      }}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Huỷ
                    </button>
                    <button
                      onClick={() => rulingAction && resolveMutation.mutate({ id: s.id, resolution: rulingAction, note })}
                      disabled={!note.trim() || resolveMutation.isPending}
                      className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-lg transition-all"
                    >
                      Xác nhận kết luận
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => openRuling(s.id, "COMPLETED")}
                    className="flex items-center gap-1 bg-blue-500 hover:bg-blue-400 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> Buổi tập đã diễn ra
                  </button>
                  <button
                    onClick={() => openRuling(s.id, "PT_NO_SHOW_CONFIRMED")}
                    className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    title="Xác nhận khiếu nại của khách là đúng — PT thực sự đã vắng mặt. Bồi thường khách bằng tiền, buổi tập KHÔNG bị trừ, giống hệt khi PT tự nhận vắng."
                  >
                    <UserX className="w-3.5 h-3.5" /> Xác nhận PT vắng mặt
                  </button>
                  <button
                    onClick={() => openRuling(s.id, "CANCELLED")}
                    className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Buổi tập không diễn ra
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
