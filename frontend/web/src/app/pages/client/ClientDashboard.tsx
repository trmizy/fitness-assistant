import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  Tooltip,
} from "recharts";
import { useApp } from "../../context/AppContext";
import { profileService, inbodyService, workoutService, type WorkoutScheduleRecord } from "../../services/api";
import {
  Award,
  Bell,
  Brain,
  Calendar,
  ChevronRight,
  Dumbbell,
  Flame,
  Loader2,
  MessageSquare,
  Target,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";

const tooltipStyle = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#111111",
    color: "#f4f4f5",
  },
};

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseApiDateOnly(value: string | Date) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  const parsed = new Date(value);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatScheduleDate(value: string) {
  return parseApiDateOnly(value).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

const goalLabels: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì",
  ATHLETIC_PERFORMANCE: "Cải thiện sức khỏe",
};

export function ClientDashboard() {
  const { user } = useApp();
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("vi-VN", { weekday: "long", month: "long", day: "numeric" });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const upcomingEnd = new Date(todayStart);
  upcomingEnd.setDate(upcomingEnd.getDate() + 30);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.profile;
    },
  });

  const { data: inbodyHistory = [], isLoading: inbodyLoading } = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory,
  });

  const { data: workoutHistory = [], isLoading: workoutLoading } = useQuery({
    queryKey: ["workout-history"],
    queryFn: () => workoutService.getHistory(1, 4),
  });

  const { data: currentProgram = null, isLoading: programLoading } = useQuery({
    queryKey: ["current-workout-program"],
    queryFn: () => workoutService.getCurrentProgram(),
  });

  const { data: upcomingSchedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ["workout-schedules", "dashboard-upcoming"],
    queryFn: () => workoutService.getSchedules(10, {
      startDate: toDateInputValue(todayStart),
      endDate: toDateInputValue(upcomingEnd),
    }),
  });

  const firstName = user?.firstName || "Bạn";
  const isLoading = profileLoading || inbodyLoading || workoutLoading || programLoading || schedulesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const latest = inbodyHistory[0];
  const prev = inbodyHistory[1];

  const calcChange = (curr: number, old?: number) => {
    if (!old) return "---";
    const diff = curr - old;
    return (diff > 0 ? "+" : "") + diff.toFixed(1);
  };

  const programDays = Array.isArray(currentProgram?.days) ? currentProgram.days : [];
  const programExerciseCount = programDays.reduce((sum: number, day: any) => {
    return sum + (Array.isArray(day?.exercises) ? day.exercises.length : 0);
  }, 0);

  const nextSchedule = (Array.isArray(upcomingSchedules) ? upcomingSchedules : [])
    .filter((schedule: WorkoutScheduleRecord) => !schedule.workoutId && !schedule.workout?.id)
    .sort((a: WorkoutScheduleRecord, b: WorkoutScheduleRecord) => parseApiDateOnly(a.date).getTime() - parseApiDateOnly(b.date).getTime())[0];
  const nextProgramDay = nextSchedule?.programDay;
  const nextExerciseCount = nextProgramDay?.exercises?.length ?? 0;

  const kpis = [
    {
      label: "Cân nặng",
      value: latest?.weight ? `${latest.weight} kg` : "---",
      change: calcChange(latest?.weight, prev?.weight) + (prev ? " kg" : ""),
      icon: TrendingDown,
      color: "text-green-400",
      bg: "bg-green-500/10",
      iconBg: "bg-green-500/15",
      border: "border-green-500/20",
    },
    {
      label: "Cơ bắp",
      value: latest?.muscleMass ? `${latest.muscleMass} kg` : "---",
      change: calcChange(latest?.muscleMass, prev?.muscleMass) + (prev ? " kg" : ""),
      icon: TrendingUp,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      iconBg: "bg-blue-500/15",
      border: "border-blue-500/20",
    },
    {
      label: "Mỡ cơ thể",
      value: latest?.bodyFatPct ? `${latest.bodyFatPct}%` : "---",
      change: calcChange(latest?.bodyFatPct, prev?.bodyFatPct) + (prev ? "%" : ""),
      icon: Flame,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      iconBg: "bg-orange-500/15",
      border: "border-orange-500/20",
    },
    {
      label: "Buổi tập",
      value: workoutHistory.length.toString(),
      change: "30 ngày qua",
      icon: Dumbbell,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      iconBg: "bg-emerald-500/15",
      border: "border-emerald-500/20",
    },
  ];

  const weightData = [...inbodyHistory].reverse().map((h: any) => ({
    date: new Date(h.date).toLocaleDateString("vi-VN", { month: "short" }),
    value: h.weight,
  }));

  const muscleData = [...inbodyHistory].reverse().map((h: any) => ({
    date: new Date(h.date).toLocaleDateString("vi-VN", { month: "short" }),
    value: h.muscleMass,
  }));

  const quickActions = [
    { label: "Tải InBody", icon: Upload, to: "/client/inbody", color: "bg-green-500 hover:bg-green-400 text-black shadow-green-500/25" },
    { label: "Nhật ký tập", icon: Dumbbell, to: "/client/workout", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
    { label: "Xem kế hoạch", icon: Brain, to: "/client/plans", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
    { label: "Nhắn tin PT", icon: MessageSquare, to: "/client/chat", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
    { label: "Đặt lịch", icon: Calendar, to: "/client/booking", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Xin chào, {firstName}</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today} · Phiên hoạt động</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full flex items-center gap-1.5 border border-green-500/20">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            Thành viên
          </span>
          <span className="px-3 py-1 bg-zinc-800 text-zinc-400 text-xs font-semibold rounded-full flex items-center gap-1.5 border border-zinc-700/50">
            <Target className="w-3 h-3" />
            Mục tiêu: {profile?.goal ? goalLabels[profile.goal] : "Thể dục"}
          </span>
        </div>
      </div>

      {inbodyHistory.length === 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm border bg-amber-500/8 border-amber-500/20 text-amber-300">
          <Bell className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Bạn chưa tải lên dữ liệu InBody nào. Tải lên ngay để nhận phân tích từ AI!</span>
        </div>
      )}

      <div>
        <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2.5">Thao tác nhanh</h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.to)}
              className={`${a.color} rounded-xl p-3 flex flex-col items-center gap-2 transition-all shadow-lg`}
            >
              <a.icon className="w-5 h-5" />
              <span className="text-xs font-semibold leading-tight text-center">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 border ${k.border}`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 ${k.iconBg} rounded-lg flex items-center justify-center`}>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
              <span className={`text-xs font-bold ${k.color} bg-black/20 px-2 py-0.5 rounded-full`}>
                {k.change}
              </span>
            </div>
            <div className="text-xl font-bold text-zinc-100">{k.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Xu hướng cân nặng</h4>
            {weightData.length > 1 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${parseFloat(calcChange(latest?.weight, prev?.weight)) <= 0 ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>
                {calcChange(latest?.weight, prev?.weight)} kg
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={weightData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Cân nặng"]} />
              <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="#22c55e" fillOpacity={0.12} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Cơ bắp</h4>
            {muscleData.length > 1 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${parseFloat(calcChange(latest?.muscleMass, prev?.muscleMass)) >= 0 ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"}`}>
                {calcChange(latest?.muscleMass, prev?.muscleMass)} kg
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={muscleData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Cơ bắp"]} />
              <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", strokeWidth: 0, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 md:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Calories tuần này</h4>
            <span className="text-xs text-zinc-500">Không có dữ liệu</span>
          </div>
          <div className="h-[120px] flex items-center justify-center border border-dashed border-zinc-800 rounded-lg">
            <p className="text-[10px] text-zinc-600 italic">Đồng bộ thiết bị tập luyện để xem dữ liệu calo</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Kế hoạch đang dùng</h4>
          </div>
          {currentProgram ? (
            <button
              onClick={() => navigate("/client/workout")}
              className="w-full min-h-[100px] text-left rounded-lg border border-green-500/20 bg-green-500/8 p-4 hover:bg-green-500/12 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-green-500/15 border border-green-500/20 flex items-center justify-center">
                  <Dumbbell className="w-4 h-4 text-green-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-100 truncate">{currentProgram.name || "Chương trình tập hiện tại"}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {programDays.length || currentProgram.daysPerWeek || "--"} ngày · {programExerciseCount || "--"} bài tập
                  </p>
                  <p className="mt-2 text-xs font-semibold text-green-400">Mở nhật ký tập</p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 mt-1" />
              </div>
            </button>
          ) : (
            <div className="flex flex-col items-center justify-center h-[100px] border border-dashed border-zinc-800 rounded-lg text-center p-4">
              <Brain className="w-6 h-6 text-zinc-700 mb-2" />
              <p className="text-[10px] text-zinc-500 italic">Chưa có chương trình trong nhật ký tập. Tạo AI Plan hoặc tạo thủ công để bắt đầu.</p>
              <button onClick={() => navigate("/client/workout")} className="mt-2 text-[10px] text-green-500 font-bold hover:underline">Tạo trong nhật ký tập</button>
            </div>
          )}
        </div>

        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          {nextSchedule ? (
            <button
              onClick={() => navigate("/client/workout")}
              className="w-full h-full min-h-[132px] text-left flex flex-col justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 hover:border-green-500/30 hover:bg-green-500/8 transition-colors"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-green-400">
                <Calendar className="w-4 h-4" />
                Lịch tập sắp tới
              </div>
              <p className="mt-3 text-sm font-bold text-zinc-100">{nextProgramDay?.title || "Buổi tập"}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatScheduleDate(nextSchedule.date)} · {nextExerciseCount || "--"} bài tập
              </p>
              {nextProgramDay?.program?.name && (
                <p className="mt-1 text-xs text-zinc-600 truncate">{nextProgramDay.program.name}</p>
              )}
              <p className="mt-3 text-xs font-semibold text-green-400">Mở buổi tập</p>
            </button>
          ) : (
            <div className="h-full min-h-[132px] flex flex-col items-center justify-center text-center">
              <Calendar className="w-8 h-8 text-zinc-700 mb-2" />
              <p className="text-sm text-zinc-500 font-medium">Không có lịch tập sắp tới</p>
              <button onClick={() => navigate("/client/workout")} className="mt-3 text-xs text-green-400 hover:underline">Lên lịch trong nhật ký tập</button>
            </div>
          )}
        </div>

        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex items-center gap-2 mb-3 relative z-10">
            <div className="w-7 h-7 bg-green-500/15 rounded-lg flex items-center justify-center border border-green-500/20">
              <Brain className="w-4 h-4 text-green-400" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-200">AI Insights</h4>
            <span className="ml-auto text-xs text-green-400 font-semibold">Trực tiếp</span>
          </div>
          <div className="space-y-2.5 relative z-10">
            {latest ? (
              <>
                <div className="flex items-start gap-2.5 bg-zinc-800/60 rounded-lg p-2.5 border border-zinc-700/40">
                  <Award className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-xs text-zinc-400 leading-relaxed">Cân nặng hiện tại của bạn là {latest.weight}kg. Hãy tiếp tục theo dõi tiến độ!</p>
                </div>
                <div className="flex items-start gap-2.5 bg-zinc-800/60 rounded-lg p-2.5 border border-zinc-700/40">
                  <TrendingUp className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-xs text-zinc-400 leading-relaxed">Cơ bắp của bạn là {latest.muscleMass}kg. Hãy bổ sung đủ protein.</p>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-zinc-500 italic">Chưa có dữ liệu AI Insights. Tải lên kết quả InBody để bắt đầu.</p>
              </div>
            )}
          </div>
          <p className="text-xs text-zinc-600 mt-3 relative z-10">*AI Insights chỉ mang tính tham khảo, không phải lời khuyên y tế.</p>
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <h4 className="text-sm font-semibold text-zinc-200">Tập luyện gần đây</h4>
          <button onClick={() => navigate("/client/workout")} className="text-xs text-green-400 hover:text-green-300 transition-colors">Xem tất cả</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="text-left text-xs text-zinc-600 border-b border-zinc-800/60 bg-zinc-800/30">
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Buổi tập</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Ngày</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Thời gian</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {workoutHistory.length > 0 ? workoutHistory.map((w: any, i: number) => (
                <tr key={i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-semibold text-zinc-200">{w.title || "Buổi tập"}</td>
                  <td className="px-4 py-2.5 text-sm text-zinc-500">{new Date(w.date).toLocaleDateString("vi-VN")}</td>
                  <td className="px-4 py-2.5 text-sm text-zinc-500">{w.durationMinutes || "--"} phút</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
                      Hoàn thành
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-zinc-600 italic">Chưa có buổi tập nào được ghi lại.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
