import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, X, MessageSquare, Clock, User } from "lucide-react";
import { ptPlanReviewService } from "../../services/api";

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function PlanReviewPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [ptNote, setPtNote] = useState("");

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["pt-pending-plans"],
    queryFn: () => ptPlanReviewService.getPendingReviews(),
  });

  useEffect(() => {
    if (plans.length > 0 && !selected) {
      setSelected(plans[0]);
      setPtNote("");
    }
  }, [plans]);

  const reviewMutation = useMutation({
    mutationFn: ({ action }: { action: "APPROVE" | "REJECT" }) =>
      ptPlanReviewService.submitReview(selected.id, { action, note: ptNote.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pt-pending-plans"] });
      queryClient.invalidateQueries({ queryKey: ["pt-pending-plans-count"] });
      setSelected(null);
      setPtNote("");
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || "Lỗi khi gửi review. Vui lòng thử lại.");
    },
  });

  const handleSelect = (plan: any) => {
    setSelected(plan);
    setPtNote("");
  };

  const weeklySchedule: any[] = selected?.plan?.weeklySchedule ?? [];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-400" /> Duyệt kế hoạch
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Xem kế hoạch AI tạo ra cho client và phê duyệt hoặc từ chối
        </p>
      </div>

      {isLoading ? (
        <div className="text-zinc-500 text-sm py-8 text-center">Đang tải...</div>
      ) : plans.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 space-y-3">
          <Brain className="w-10 h-10 mx-auto text-zinc-700" />
          <p>Không có kế hoạch nào đang chờ duyệt</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Plan list */}
          <div className="lg:w-64 space-y-2 flex-shrink-0">
            <h4 className="text-xs text-zinc-600 uppercase tracking-wider px-1 font-bold">
              Chờ duyệt ({plans.length})
            </h4>
            {plans.map((p: any) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                  selected?.id === p.id
                    ? "border-violet-500 bg-violet-500/8"
                    : "border-zinc-800/60 bg-zinc-900 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">
                    {getInitials(p.clientName)}
                  </div>
                  <span className="text-sm font-bold text-zinc-200 truncate">
                    {p.clientName || "Client"}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 truncate">{p.name || p.goal}</div>
                <div className="text-xs text-zinc-600 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {formatDate(p.createdAt)}
                </div>
              </button>
            ))}
          </div>

          {/* Review area */}
          {selected && (
            <div className="flex-1 space-y-4">
              {/* Plan header */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <h3 className="text-zinc-100 flex items-center gap-2">
                      <User className="w-4 h-4 text-zinc-400" />
                      {selected.clientName || "Client"} — {selected.name || selected.goal}
                    </h3>
                    <p className="text-sm text-zinc-500 mt-0.5">
                      Tạo ngày {formatDate(selected.createdAt)} &middot; {selected.duration} tuần &middot; {selected.daysPerWeek} buổi/tuần
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => reviewMutation.mutate({ action: "APPROVE" })}
                      disabled={reviewMutation.isPending}
                      className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
                    >
                      <Check className="w-4 h-4" /> Duyệt
                    </button>
                    <button
                      onClick={() => reviewMutation.mutate({ action: "REJECT" })}
                      disabled={reviewMutation.isPending}
                      className="flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-2 rounded-xl text-sm font-semibold hover:bg-red-500/15 disabled:opacity-50 transition-colors"
                    >
                      <X className="w-4 h-4" /> Từ chối
                    </button>
                  </div>
                </div>

                {/* PT Note */}
                <div className="mt-3">
                  <label className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1.5 uppercase tracking-wider font-semibold">
                    <MessageSquare className="w-3.5 h-3.5" /> Ghi chú cho client (tùy chọn)
                  </label>
                  <textarea
                    value={ptNote}
                    onChange={(e) => setPtNote(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder="Nhập nhận xét hoặc lý do từ chối..."
                    className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 resize-none placeholder-zinc-600"
                  />
                  {ptNote.length > 900 && (
                    <p className="text-xs text-amber-400 mt-1">{ptNote.length}/1000 ký tự</p>
                  )}
                </div>
              </div>

              {/* Weekly schedule */}
              {weeklySchedule.length > 0 ? (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                  <div className="px-4 py-2.5 bg-blue-500/8 border-b border-zinc-800/60">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                      <Brain className="w-3.5 h-3.5" /> Lịch tập AI tạo ra
                    </div>
                  </div>
                  <div className="divide-y divide-zinc-800/40">
                    {weeklySchedule.map((day: any, i: number) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="text-xs font-bold text-zinc-300 mb-0.5">{day.day}</div>
                            <div className="text-xs font-semibold text-zinc-400 mb-1">{day.goal}</div>
                            {Array.isArray(day.exercises) && day.exercises.length > 0 && (
                              <div className="space-y-0.5">
                                {day.exercises.map((ex: any, j: number) => (
                                  <div key={j} className="text-xs text-zinc-600">
                                    {ex.name} {ex.sets}×{ex.reps}
                                    {ex.weight ? ` @${ex.weight}kg` : ""}
                                    {ex.restSeconds ? ` (nghỉ ${ex.restSeconds}s)` : ""}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-zinc-500 text-sm">
                  Không có dữ liệu lịch tập
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
