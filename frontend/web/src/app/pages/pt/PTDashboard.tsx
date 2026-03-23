import { useNavigate } from "react-router";
import { Users, Calendar, FileText, ClipboardList, MessageSquare, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { chatService, workoutService, nutritionService } from "../../services/api";
import { useApp } from "../../context/AppContext";

function safeText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const maybeMessage = (value as any)?.message;
    if (typeof maybeMessage === "string") return maybeMessage;
  }
  return fallback;
}

export function PTDashboard() {
  const navigate = useNavigate();
  const { user } = useApp();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const { data: conversationsData, isLoading: loadingConversations } = useQuery({
    queryKey: ["pt-dashboard-conversations"],
    queryFn: chatService.listConversations,
  });

  const { data: workoutStats, isLoading: loadingWorkoutStats } = useQuery({
    queryKey: ["pt-dashboard-workout-stats"],
    queryFn: workoutService.getStats,
  });

  const { data: nutritionData, isLoading: loadingNutrition } = useQuery({
    queryKey: ["pt-dashboard-nutrition"],
    queryFn: () => nutritionService.getLogs(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      new Date().toISOString().split("T")[0]
    ),
  });

  const conversations = conversationsData?.conversations || [];
  const clients = conversations.map((c: any) => c.otherUser).filter((u: any) => !!u && u.role !== "PT");
  const uniqueClientCount = new Set(clients.map((u: any) => u.id)).size;
  const upcomingActivityCount = conversations.filter((c: any) => !!c.lastMessageAt).length;
  const totalWorkouts = workoutStats?.totalWorkouts || 0;
  const nutritionLogsCount = Array.isArray(nutritionData) ? nutritionData.length : 0;

  const kpis = [
    { label: "Active Clients", value: String(uniqueClientCount), hint: "From real conversations", icon: Users, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" },
    { label: "Recent Active Threads", value: String(upcomingActivityCount), hint: "Conversations with activity", icon: Calendar, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" },
    { label: "Workouts Logged", value: String(totalWorkouts), hint: "Your own DB stats", icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", iconBg: "bg-violet-500/15", border: "border-violet-500/20" },
    { label: "Nutrition Logs (7d)", value: String(nutritionLogsCount), hint: "Recent nutrition entries", icon: ClipboardList, color: "text-amber-400", bg: "bg-amber-500/10", iconBg: "bg-amber-500/15", border: "border-amber-500/20" },
  ];

  if (loadingConversations || loadingWorkoutStats || loadingNutrition) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Good morning, {user?.firstName || "Coach"}</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 border ${k.border}`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 ${k.iconBg} rounded-lg flex items-center justify-center`}>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
            </div>
            <div className="text-xl font-bold text-zinc-100">{k.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{k.label}</div>
            <div className="text-xs text-zinc-600 mt-1">{k.hint}</div>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-green-400" />
          <h4 className="text-sm font-bold text-zinc-200">Recent Client Conversations</h4>
        </div>
        {conversations.length > 0 ? (
          <div className="space-y-2">
            {conversations.slice(0, 6).map((conv: any) => (
              <div key={conv.id} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                <div>
                  <div className="text-sm font-semibold text-zinc-200">{`${safeText(conv.otherUser?.firstName, "")} ${safeText(conv.otherUser?.lastName, "")}`.trim() || "Unknown user"}</div>
                  <div className="text-xs text-zinc-500 truncate max-w-[420px]">{safeText(conv.lastMessage?.content, "No messages yet")}</div>
                </div>
                <button onClick={() => navigate("/pt/chat")} className="text-xs px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">Open</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No client conversation data found in database.</p>
        )}
      </div>
    </div>
  );
}
