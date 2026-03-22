import { useState } from "react";
import { Utensils, Plus, Search, TrendingUp, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { nutritionService } from "../../services/api";

// Mock data removed, now using nutritionService
const COLORS = ["#22c55e", "#60a5fa", "#f59e0b", "#ef4444"];

export function NutritionPage() {
  const [expandedMeal, setExpandedMeal] = useState<string | null>("Breakfast");

  const { data: todayData, isLoading: loadingToday } = useQuery({
    queryKey: ["today-nutrition"],
    queryFn: () => nutritionService.getLogs(new Date().toISOString().split('T')[0])
  });

  const { data: weeklyDataRaw, isLoading: loadingWeekly } = useQuery({
    queryKey: ["weekly-nutrition"],
    queryFn: () => nutritionService.getLogs(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      new Date().toISOString().split('T')[0]
    )
  });

  if (loadingToday || loadingWeekly) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  // Expecting { summary: { calories: { consumed, target }, ... }, logs: [] } or similar
  // Adjusting to a safe structure based on backend controller returning 'logs'
  const nutrition = todayData?.summary || {
    calories: { consumed: 0, target: 2000 },
    protein: { consumed: 0, target: 160 },
    carbs: { consumed: 0, target: 180 },
    fat: { consumed: 0, target: 65 }
  };

  const meals = todayData?.meals || [];
  const weeklyHistory = weeklyDataRaw?.history || [];
  
  const pieData = [
    { name: "Protein", value: (nutrition.protein?.consumed || 0) * 4 },
    { name: "Carbs", value: (nutrition.carbs?.consumed || 0) * 4 },
    { name: "Fat", value: (nutrition.fat?.consumed || 0) * 9 },
  ];

  const pct = (consumed: number, target: number) => {
    if (!target) return 0;
    return Math.min(100, Math.round((consumed / target) * 100));
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2"><Utensils className="w-5 h-5 text-orange-400" /> Nutrition Log</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Track your daily calories and macros</p>
        </div>
        <button className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all self-start sm:self-auto shadow-lg shadow-green-500/20">
          <Plus className="w-4 h-4" /> Add Food
        </button>
      </div>

      {/* Macro summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Calories", consumed: nutrition.calories.consumed, target: nutrition.calories.target, unit: "kcal", color: "#f97316", textColor: "text-orange-400" },
          { label: "Protein", consumed: nutrition.protein.consumed, target: nutrition.protein.target, unit: "g", color: "#22c55e", textColor: "text-green-400" },
          { label: "Carbs", consumed: nutrition.carbs.consumed, target: nutrition.carbs.target, unit: "g", color: "#60a5fa", textColor: "text-blue-400" },
          { label: "Fat", consumed: nutrition.fat.consumed, target: nutrition.fat.target, unit: "g", color: "#f59e0b", textColor: "text-amber-400" },
        ].map((m) => (
          <div key={m.label} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{m.label}</span>
              <span className="text-xs text-zinc-600">{pct(m.consumed, m.target)}%</span>
            </div>
            <div className={`text-lg font-bold ${m.textColor}`}>{m.consumed}<span className="text-xs text-zinc-500 font-normal ml-1">{m.unit}</span></div>
            <div className="text-xs text-zinc-600 mb-2">of {m.target}{m.unit}</div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct(m.consumed, m.target)}%`, backgroundColor: m.color }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Meals */}
        <div className="lg:col-span-2 space-y-3">
          {nutrition.meals?.length > 0 ? (
            nutrition.meals.map((meal: any) => (
              <div key={meal.name} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                <button
                  onClick={() => setExpandedMeal(expandedMeal === meal.name ? null : meal.name)}
                  className="flex items-center justify-between w-full px-4 py-3 hover:bg-zinc-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-600 w-14">{meal.time}</span>
                    <span className="text-sm font-bold text-zinc-200">{meal.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-orange-400">{meal.totalKcal} kcal</span>
                    <Plus className="w-4 h-4 text-zinc-600" />
                  </div>
                </button>
                {expandedMeal === meal.name && (
                  <div className="border-t border-zinc-800/60">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[400px] text-xs">
                        <thead>
                          <tr className="text-zinc-600 bg-zinc-800/30 text-left uppercase tracking-wider">
                            <th className="px-4 py-2">Food</th>
                            <th className="px-4 py-2">Amount</th>
                            <th className="px-4 py-2">Kcal</th>
                            <th className="px-4 py-2">P</th>
                            <th className="px-4 py-2">C</th>
                            <th className="px-4 py-2">F</th>
                          </tr>
                        </thead>
                        <tbody>
                          {meal.foods?.map((item: any, idx: number) => (
                            <tr key={idx} className="border-t border-zinc-800/40 hover:bg-zinc-800/30 transition-colors">
                              <td className="px-4 py-2 font-semibold text-zinc-200">{item.name}</td>
                              <td className="px-4 py-2 text-zinc-500">{item.amount || '-'}</td>
                              <td className="px-4 py-2 text-orange-400 font-semibold">{item.kcal}</td>
                              <td className="px-4 py-2 text-green-400">{item.p}g</td>
                              <td className="px-4 py-2 text-blue-400">{item.c}g</td>
                              <td className="px-4 py-2 text-amber-400">{item.f}g</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-20 text-center">
              <Utensils className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500">No meals logged today. Start adding your food!</p>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Macro pie */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200 mb-1">Macro Split</h4>
            <p className="text-xs text-zinc-500 mb-2">Today's distribution</p>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value" paddingAngle={2}>
                  {pieData.map((entry, i) => <Cell key={`cell-${entry.name}`} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} formatter={(v: number) => [`${v} kcal`]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5">
              {pieData.map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                    <span className="text-zinc-500">{d.name}</span>
                  </div>
                  <span className="font-semibold text-zinc-300">{Math.round(d.value)} kcal</span>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly chart */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <h4 className="text-sm font-bold text-zinc-200">Weekly Calories</h4>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={weeklyHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} formatter={(v: number) => [`${v} kcal`]} />
                <Bar dataKey="calories" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-center text-zinc-600 mt-1">Target: {nutrition.calories.target} kcal/day</div>
          </div>
        </div>
      </div>
    </div>
  );
}