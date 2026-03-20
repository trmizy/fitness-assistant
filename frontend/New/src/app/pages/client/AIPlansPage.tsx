import { useState } from "react";
import { Brain, ChevronDown, ChevronRight, CheckCircle, Clock, Archive, Edit3, MessageSquare, Zap } from "lucide-react";

type PlanStatus = "active" | "pending_review" | "draft" | "archived";

const statusConfig: Record<PlanStatus, { label: string; color: string; dot: string }> = {
  active: { label: "Active", color: "bg-green-500/10 text-green-400 border-green-500/20", dot: "bg-green-500" },
  pending_review: { label: "Pending PT Review", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-500" },
  draft: { label: "Draft", color: "bg-zinc-700/50 text-zinc-400 border-zinc-700", dot: "bg-zinc-500" },
  archived: { label: "Archived", color: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-400" },
};

const workoutPlan = {
  id: 1, title: "AI Fat Loss Program", type: "workout", status: "active" as PlanStatus,
  createdAt: "Jun 1, 2025", approvedBy: "Coach Sarah Mitchell", approvedAt: "Jun 3, 2025",
  ptNote: "Modified Day 4 cardio to LISS instead of HIIT — better for recovery given your current sleep schedule.",
  rationale: "Based on your InBody data showing 18.2% body fat and goal to lose fat, this program combines resistance training to preserve muscle while creating a caloric deficit through strategic cardio.",
  weeks: [
    {
      week: 1, days: [
        { day: "Mon", name: "Upper Push", exercises: ["Bench Press 4×8", "Incline DB Press 3×10", "Shoulder Press 3×12", "Tricep Pushdown 3×15"] },
        { day: "Tue", name: "Lower Body", exercises: ["Squat 4×8", "Romanian DL 3×10", "Leg Press 3×12", "Calf Raise 4×15"] },
        { day: "Wed", name: "LISS Cardio", exercises: ["30 min treadmill walk @ 60% HR", "10 min stretching"] },
        { day: "Thu", name: "Upper Pull", exercises: ["Pull-ups 4×6", "Barbell Row 4×8", "Cable Row 3×12", "Face Pulls 3×15"] },
        { day: "Fri", name: "Full Body Power", exercises: ["Deadlift 4×5", "Power Clean 3×5", "Push Press 3×8", "Core Circuit"] },
        { day: "Sat", name: "Active Rest", exercises: ["Light walk 20 min", "Mobility routine"] },
        { day: "Sun", name: "Rest Day", exercises: ["Rest & Recovery"] },
      ]
    },
  ],
};

const mealPlan = {
  id: 2, title: "AI High-Protein Meal Plan", type: "meal", status: "active" as PlanStatus,
  createdAt: "Jun 1, 2025", approvedBy: "Coach Sarah Mitchell", approvedAt: "Jun 3, 2025",
  ptNote: "Added a pre-workout meal option since you mentioned training at 6am.",
  rationale: "Targeting 2,000 kcal with 160g protein to support fat loss while preserving lean muscle. Meals are spaced to optimize protein synthesis.",
  macros: { calories: 2000, protein: 160, carbs: 180, fat: 65 },
  days: [
    {
      day: "Monday", meals: [
        { time: "7:00 AM", name: "Breakfast", items: ["Oats 80g", "Whey protein 30g", "Banana", "Almond milk 200ml"], kcal: 480, protein: 38 },
        { time: "10:30 AM", name: "Snack", items: ["Greek yogurt 200g", "Blueberries 100g"], kcal: 180, protein: 18 },
        { time: "1:00 PM", name: "Lunch", items: ["Grilled chicken 200g", "Brown rice 120g", "Broccoli 150g", "Olive oil drizzle"], kcal: 520, protein: 48 },
        { time: "4:00 PM", name: "Pre-workout", items: ["Rice cake 2x", "Peanut butter 20g", "Apple"], kcal: 220, protein: 6 },
        { time: "7:00 PM", name: "Dinner", items: ["Salmon fillet 180g", "Sweet potato 150g", "Asparagus 100g"], kcal: 480, protein: 42 },
        { time: "9:00 PM", name: "Evening snack", items: ["Cottage cheese 150g"], kcal: 120, protein: 18 },
      ]
    }
  ],
};

type PlanTab = "workout" | "nutrition";

export function AIPlansPage() {
  const [planTab, setPlanTab] = useState<PlanTab>("workout");
  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const currentPlan = planTab === "workout" ? workoutPlan : mealPlan;
  const cfg = statusConfig[currentPlan.status];

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
            <p className="text-sm text-zinc-500">Created {currentPlan.createdAt} · Approved by {currentPlan.approvedBy} on {currentPlan.approvedAt}</p>
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
            { label: "Calories", value: `${(currentPlan as typeof mealPlan).macros.calories}`, unit: "kcal", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
            { label: "Protein", value: `${(currentPlan as typeof mealPlan).macros.protein}g`, unit: "", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20" },
            { label: "Carbs", value: `${(currentPlan as typeof mealPlan).macros.carbs}g`, unit: "", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
            { label: "Fat", value: `${(currentPlan as typeof mealPlan).macros.fat}g`, unit: "", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
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
          {workoutPlan.weeks.map((week) => (
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
                  {week.days.map((day) => (
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
                            {day.exercises.map((ex, i) => (
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
          {mealPlan.days.map((day) => (
            <div key={day.day} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/60">
                <h4 className="text-sm font-bold text-zinc-200">{day.day}</h4>
              </div>
              <div className="divide-y divide-zinc-800/40">
                {day.meals.map((meal) => (
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
                      {meal.items.map((item) => (
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
