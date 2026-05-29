import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, Clock, Archive, MessageSquare, Zap, Loader2, Sparkles, CheckCircle, XCircle, Plus, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { planService, contractService } from "../../services/api";

type DisplayStatus = "active" | "pending_review" | "rejected" | "archived";

const statusConfig: Record<string, { label: string; color: string; dot: string; icon: React.ElementType }> = {
  active:         { label: "Đang dùng",    color: "bg-green-500/10 text-green-400 border-green-500/20",  dot: "bg-green-500",  icon: CheckCircle },
  pending_review: { label: "Chờ PT duyệt", color: "bg-amber-500/10 text-amber-400 border-amber-500/20",  dot: "bg-amber-500",  icon: Clock },
  rejected:       { label: "PT từ chối",   color: "bg-red-500/10 text-red-400 border-red-500/20",         dot: "bg-red-400",    icon: XCircle },
  archived:       { label: "Đã lưu trữ",  color: "bg-zinc-700/50 text-zinc-400 border-zinc-700",         dot: "bg-zinc-500",   icon: Archive },
};

function getPTDisplayName(contract: any): string {
  const profile = contract?.ptProfile;
  if (profile) {
    const name = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
    return name || "PT";
  }
  return contract?.ptName || `PT #${contract?.id?.slice(0, 8) ?? ""}`;
}

export function AIPlansPage() {
  const queryClient = useQueryClient();
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(0);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [showContractPicker, setShowContractPicker] = useState(false);
  const [goal, setGoal] = useState("Tăng cơ giảm mỡ");
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [showGenerateForm, setShowGenerateForm] = useState(false);

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["current-plans"],
    queryFn: planService.getCurrentPlans,
  });

  const { data: contractsData = [] } = useQuery({
    queryKey: ["my-contracts-active"],
    queryFn: () => contractService.getByClient("ACTIVE"),
  });

  const activeContracts: any[] = Array.isArray(contractsData)
    ? contractsData.filter((c: any) => c.status === "ACTIVE")
    : [];

  const generateMutation = useMutation({
    mutationFn: (contractId?: string) =>
      planService.generateWorkoutPlan({ goal, durationWeeks, daysPerWeek, contractId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-plans"] });
      setShowGenerateForm(false);
      setShowContractPicker(false);
      setSelectedContractId(null);
      alert("Đang tạo kế hoạch... Quay lại sau vài phút để xem kết quả.");
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || "Lỗi khi tạo kế hoạch. Vui lòng thử lại.");
    },
  });

  const handleGenerate = () => {
    if (activeContracts.length === 0) {
      generateMutation.mutate(undefined);
    } else if (activeContracts.length === 1) {
      generateMutation.mutate(activeContracts[0].id);
    } else {
      if (!selectedContractId) {
        setShowContractPicker(true);
        return;
      }
      generateMutation.mutate(selectedContractId);
    }
  };

  const plans: any[] = plansData?.data?.plans ?? [];
  const plan = plans[selectedPlanIdx] ?? null;
  const weeklySchedule: any[] = plan?.plan?.weeklySchedule ?? [];
  const displayStatus: string = plan?.displayStatus ?? "active";
  const cfg = statusConfig[displayStatus] || statusConfig.active;
  const StatusIcon = cfg.icon;

  if (plansLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <Brain className="w-5 h-5 text-green-400" /> Kế hoạch AI
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Kế hoạch tập luyện AI tạo ra — có thể được PT xem xét trước khi kích hoạt</p>
        </div>
        <button
          onClick={() => setShowGenerateForm(!showGenerateForm)}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
        >
          <Plus className="w-4 h-4" /> Tạo kế hoạch mới
        </button>
      </div>

      {/* Generate form */}
      {showGenerateForm && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
          <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-green-400" /> Tạo kế hoạch tập luyện mới
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Mục tiêu</label>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Số tuần</label>
              <select
                value={durationWeeks}
                onChange={(e) => setDurationWeeks(Number(e.target.value))}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/50"
              >
                {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} tuần</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Buổi/tuần</label>
              <select
                value={daysPerWeek}
                onChange={(e) => setDaysPerWeek(Number(e.target.value))}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/50"
              >
                {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} buổi</option>)}
              </select>
            </div>
          </div>

          {/* Contract picker (2+ active contracts) */}
          {activeContracts.length > 1 && (
            <div>
              <label className="text-xs text-zinc-500 mb-1 block flex items-center gap-1">
                <Users className="w-3 h-3" /> Chọn PT xem kế hoạch (tùy chọn)
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedContractId(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    !selectedContractId
                      ? "bg-green-500/15 border-green-500/30 text-green-400"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  Không cần PT duyệt
                </button>
                {activeContracts.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedContractId(c.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selectedContractId === c.id
                        ? "bg-green-500/15 border-green-500/30 text-green-400"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {getPTDisplayName(c)}
                    <span className="ml-1 text-zinc-600">(ACTIVE)</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeContracts.length === 1 && (
            <p className="text-xs text-zinc-500 flex items-center gap-1">
              <Users className="w-3 h-3" />
              Kế hoạch sẽ được gửi cho <span className="text-zinc-300 font-medium">{getPTDisplayName(activeContracts[0])}</span> duyệt trước khi kích hoạt
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="flex items-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-5 py-2 rounded-xl text-sm font-bold transition-all"
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Tạo kế hoạch
            </button>
            <button
              onClick={() => setShowGenerateForm(false)}
              className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {/* Plan list selector (multiple plans) */}
      {plans.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {plans.map((p: any, idx: number) => {
            const s = statusConfig[p.displayStatus] || statusConfig.active;
            return (
              <button
                key={p.id}
                onClick={() => { setSelectedPlanIdx(idx); setExpandedDay(null); }}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  idx === selectedPlanIdx
                    ? "border-green-500/40 bg-green-500/10 text-green-400"
                    : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                  v{p.version} — {p.goal.slice(0, 20)}
                </div>
                <div className="text-zinc-600 mt-0.5">{new Date(p.createdAt).toLocaleDateString("vi-VN")}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* No plans state */}
      {plans.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-20 bg-zinc-900/50 rounded-2xl border border-zinc-800/60 text-center">
          <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-100">Chưa có kế hoạch tập luyện</h2>
            <p className="text-zinc-500 mt-1 max-w-xs mx-auto">
              Nhấn "Tạo kế hoạch mới" để AI tạo chương trình tập phù hợp với bạn.
            </p>
          </div>
        </div>
      )}

      {/* Plan detail */}
      {plan && (
        <>
          {/* Plan header card */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h2 className="text-zinc-100">{plan.name || plan.goal}</h2>
                  <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold border ${cfg.color}`}>
                    <StatusIcon className="w-3 h-3" />
                    {cfg.label}
                  </span>
                </div>
                <p className="text-sm text-zinc-500">
                  Tạo ngày {new Date(plan.createdAt).toLocaleDateString("vi-VN")}
                  {plan.approvedBy ? ` · Phê duyệt bởi ${plan.approvedBy}` : ""}
                  {displayStatus === "pending_review" ? " · Đang chờ PT duyệt" : ""}
                  {" "}· {plan.duration} tuần · {plan.daysPerWeek} buổi/tuần
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700/60 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
                  <MessageSquare className="w-3.5 h-3.5" /> Hỏi PT
                </button>
              </div>
            </div>

            {/* PT Note */}
            {plan.ptNote && (
              <div className="mt-3 p-3 bg-blue-500/8 rounded-lg border border-blue-500/20">
                <div className="flex items-center gap-1.5 mb-1">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-semibold text-blue-300">
                    Ghi chú PT {plan.ptName ? `(${plan.ptName})` : ""}
                  </span>
                </div>
                <p className="text-xs text-blue-400/80">{plan.ptNote}</p>
              </div>
            )}

            {/* Rejected notice */}
            {displayStatus === "rejected" && (
              <div className="mt-3 p-3 bg-red-500/8 rounded-lg border border-red-500/20">
                <p className="text-xs text-red-400">
                  PT đã từ chối kế hoạch này{plan.ptNote ? "" : " mà không để lại ghi chú"}. Bạn có thể tạo kế hoạch mới.
                </p>
              </div>
            )}

            {/* Pending review notice */}
            {displayStatus === "pending_review" && (
              <div className="mt-3 p-3 bg-amber-500/8 rounded-lg border border-amber-500/20">
                <p className="text-xs text-amber-400">
                  Kế hoạch này đang chờ PT xem xét. Bạn có thể xem trước lịch tập bên dưới.
                </p>
              </div>
            )}
          </div>

          {/* Workout weekly schedule */}
          {weeklySchedule.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs text-zinc-600 uppercase tracking-wider font-bold px-1">
                Lịch tập tuần ({weeklySchedule.length} buổi)
              </h4>
              {weeklySchedule.map((day: any, i: number) => {
                const key = `day-${i}`;
                const isExpanded = expandedDay === key;
                return (
                  <div key={key} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                    <button
                      onClick={() => setExpandedDay(isExpanded ? null : key)}
                      className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 text-xs font-bold flex items-center justify-center border border-zinc-700">
                          {day.day?.slice(0, 2) || String(i + 1)}
                        </span>
                        <div>
                          <div className="text-sm font-semibold text-zinc-200">{day.day}</div>
                          <div className="text-xs text-zinc-500">{day.goal}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-600">{Array.isArray(day.exercises) ? day.exercises.length : 0} bài</span>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                      </div>
                    </button>
                    {isExpanded && Array.isArray(day.exercises) && day.exercises.length > 0 && (
                      <div className="border-t border-zinc-800/60 px-4 pb-3 pt-2">
                        <div className="ml-11 pl-3 border-l-2 border-green-500/30 space-y-1.5">
                          {day.exercises.map((ex: any, j: number) => (
                            <div key={j} className="flex items-start gap-2 text-sm text-zinc-400">
                              <div className="w-5 h-5 bg-green-500/10 text-green-400 border border-green-500/20 rounded text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{j + 1}</div>
                              <span>
                                {ex.name}
                                {ex.sets && ex.reps ? ` — ${ex.sets}×${ex.reps}` : ""}
                                {ex.weight ? ` @${ex.weight}kg` : ""}
                                {ex.restSeconds ? <span className="text-zinc-600"> (nghỉ {ex.restSeconds}s)</span> : null}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            plan.status === "COMPLETED" && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-zinc-500 text-sm">
                Không có dữ liệu lịch tập
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
