import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, CheckCircle, Clock, Archive, Edit3, MessageSquare, Zap, Loader2, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { planService } from "../../services/api";

type PlanStatus = "active" | "pending_review" | "draft" | "archived";

const statusConfig: Record<PlanStatus, { label: string; color: string; dot: string }> = {
  active: { label: "Active", color: "bg-green-500/10 text-green-400 border-green-500/20", dot: "bg-green-500" },
  pending_review: { label: "Pending PT Review", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-500" },
  draft: { label: "Draft", color: "bg-zinc-700/50 text-zinc-400 border-zinc-700", dot: "bg-zinc-500" },
  archived: { label: "Archived", color: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-400" },
};

// Mock data removed, now using planService.getCurrentPlans()

type PlanTab = "workout" | "nutrition";

export function AIPlansPage() {
  const [planTab, setPlanTab] = useState<PlanTab>("workout");
  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["current-plans"],
    queryFn: planService.getCurrentPlans
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950 min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const workoutPlan = plansData?.workoutPlan;
  const mealPlan = plansData?.mealPlan;
  const currentPlan = planTab === "workout" ? workoutPlan : mealPlan;

  if (!currentPlan) {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto text-center space-y-6">
        <div className="flex flex-col items-center gap-4 py-20 bg-zinc-900/50 rounded-2xl border border-zinc-800/60">
          <div className="w-16 h-16 bg-green-500/10 rounded-2xl flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-100">No {planTab} plan yet</h2>
            <p className="text-zinc-500 mt-1 max-w-xs mx-auto">Upload your InBody data or talk to our AI Coach to generate a personalized {planTab} plan.</p>
          </div>
          <div className="flex gap-3">
             <button onClick={() => setPlanTab(planTab === "workout" ? "nutrition" : "workout")} className="px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-sm font-bold border border-zinc-700 hover:bg-zinc-700 transition-all">
                Check {planTab === "workout" ? "Meal Plan" : "Workout Plan"}
             </button>
          </div>
        </div>
      </div>
    );
  }

  const cfg = statusConfig[currentPlan.status as PlanStatus] || statusConfig.active;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <Brain className="w-5 h-5 text-green-400" /> AI Plans
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">AI-generated plans reviewed and approved by your coach</p>
        </div>
      </div>

      {/* Plan type tabs */}
      <div className="flex gap-2">
        {[
          { key: "workout" as PlanTab, label: "Workout Plan", icon: Zap },
          { key: "nutrition" as PlanTab, label: "Meal Plan", icon: CheckCircle },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setPlanTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${planTab === t.key ? "bg-green-500 text-black shadow-lg shadow-green-500/20" : "bg-zinc-800/60 border border-zinc-700/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"}`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Plan header card */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h2 className="text-zinc-100">{currentPlan.title}</h2>
              <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold border ${cfg.color}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            </div>
            <p className="text-sm text-zinc-500">Created {new Date(currentPlan.createdAt).toLocaleDateString()} · Approved by {currentPlan.approvedBy || "AI Engine"}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700/60 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
              <Archive className="w-3.5 h-3.5" /> Archive
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400 hover:bg-green-500/15 transition-colors">
              <MessageSquare className="w-3.5 h-3.5" /> Ask PT
            </button>
          </div>
        </div>

        {/* PT Note */}
        <div className="mt-3 p-3 bg-blue-500/8 rounded-lg border border-blue-500/20">
          <div className="flex items-center gap-1.5 mb-1">
            <Edit3 className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-semibold text-blue-300">Coach Note</span>
          </div>
          <p className="text-xs text-blue-400/80">{currentPlan.ptNote}</p>
        </div>

        {/* Rationale */}
        <div className="mt-3 p-3 bg-green-500/5 rounded-lg border border-green-500/15">
          <div className="flex items-center gap-1.5 mb-1">
            <Brain className="w-3.5 h-3.5 text-green-400" />
            <span className="text-xs font-semibold text-green-400">AI Rationale</span>
          </div>
          <p className="text-xs text-zinc-400">{currentPlan.rationale}</p>
        </div>
      </div>

      {/* Macros summary (nutrition only) */}
      {planTab === "nutrition" && "macros" in currentPlan && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Calories", value: `${currentPlan.macros?.calories || 0}`, unit: "kcal", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
            { label: "Protein", value: `${currentPlan.macros?.protein || 0}g`, unit: "", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
            { label: "Carbs", value: `${currentPlan.macros?.carbs || 0}g`, unit: "", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
            { label: "Fat", value: `${currentPlan.macros?.fat || 0}g`, unit: "", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
          ].map((m) => (
            <div key={m.label} className={`${m.bg} rounded-xl p-3 text-center border ${m.border}`}>
              <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Workout weekly plan */}
      {planTab === "workout" && (
        <div className="space-y-3">
          {workoutPlan.weeks?.map((week: any) => (
            <div key={week.week} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <button
                onClick={() => setExpandedWeek(expandedWeek === week.week ? null : week.week)}
                className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
              >
                <span className="text-sm font-bold text-zinc-200">Week {week.week}</span>
                {expandedWeek === week.week ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
              </button>
              {expandedWeek === week.week && (
                <div className="border-t border-zinc-800/60">
                  {week.days?.map((day: any) => (
                    <div key={day.day} className="border-b border-zinc-800/40 last:border-0">
                      <button
                        onClick={() => setExpandedDay(expandedDay === `${week.week}-${day.day}` ? null : `${week.week}-${day.day}`)}
                        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${day.name === "Rest Day" ? "bg-zinc-800 text-zinc-500" : day.name.includes("Cardio") || day.name.includes("Rest") ? "bg-green-500/15 text-green-400 border border-green-500/20" : "bg-zinc-800/80 text-zinc-300 border border-zinc-700"}`}>
                            {day.day}
                          </span>
                          <div>
                            <div className="text-sm font-semibold text-zinc-200">{day.name}</div>
                            <div className="text-xs text-zinc-600">{day.exercises.length} {day.exercises.length === 1 ? "exercise" : "exercises"}</div>
                          </div>
                        </div>
                        {expandedDay === `${week.week}-${day.day}` ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                      </button>
                      {expandedDay === `${week.week}-${day.day}` && (
                        <div className="px-4 pb-3 pt-0">
                          <div className="ml-[52px] pl-3 border-l-2 border-green-500/30 space-y-1.5">
                            {day.exercises?.map((ex: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-sm text-zinc-400">
                                <div className="w-5 h-5 bg-green-500/10 text-green-400 border border-green-500/20 rounded text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</div>
                                {ex}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Meal plan */}
      {planTab === "nutrition" && (
        <div className="space-y-3">
          {mealPlan.days?.map((day: any) => (
            <div key={day.day} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/60">
                <h4 className="text-sm font-bold text-zinc-200">{day.day}</h4>
              </div>
              <div className="divide-y divide-zinc-800/40">
                {day.meals?.map((meal: any) => (
                  <div key={meal.time} className="px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-600">{meal.time}</span>
                          <span className="text-sm font-semibold text-zinc-200">{meal.name}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-semibold text-zinc-300">{meal.kcal} kcal</div>
                        <div className="text-xs text-green-400">{meal.protein}g protein</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {meal.items?.map((item: any) => (
                        <span key={item} className="px-2 py-0.5 bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 text-xs rounded-full">{item}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
