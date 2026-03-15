import React, { useState } from 'react';
import { CalendarDays, Utensils, Dumbbell, Flame } from 'lucide-react';
import { mockWorkoutPlan, mockMealPlan } from '../data/mock';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Plans() {
  const [tab, setTab]         = useState<'workout' | 'meal'>('workout');
  const [activeDay, setActiveDay] = useState(0);

  const mealDay = mockMealPlan[activeDay];
  const workoutDay = mockWorkoutPlan[activeDay];

  const totalCals = mealDay?.meals.reduce((acc, m) => acc + m.calories, 0) ?? 0;
  const totalProt = mealDay?.meals.reduce((acc, m) => acc + m.protein, 0) ?? 0;
  const totalCarb = mealDay?.meals.reduce((acc, m) => acc + m.carbs, 0) ?? 0;
  const totalFat  = mealDay?.meals.reduce((acc, m) => acc + m.fats, 0) ?? 0;

  // Group MealItems by mealType
  const mealGroups = mealDay
    ? (['breakfast', 'lunch', 'snack', 'dinner'] as const).map(type => ({
        type,
        items: mealDay.meals.filter(m => m.mealType === type),
      })).filter(g => g.items.length > 0)
    : [];

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-2">
        {([['workout', Dumbbell, 'Workout Plan'], ['meal', Utensils, 'Meal Plan']] as const).map(([key, Icon, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* Day selector */}
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((d, i) => {
          const wDay = mockWorkoutPlan[i];
          const isRest = tab === 'workout' ? wDay?.isRest : false;
          return (
            <button key={d} onClick={() => setActiveDay(i)}
              className={`p-2 rounded-lg text-center transition-colors
                ${activeDay === i
                  ? 'bg-emerald-600 text-white'
                  : isRest
                    ? 'bg-zinc-800/30 text-zinc-600 hover:bg-zinc-800'
                    : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}>
              <p className="text-xs font-medium">{d}</p>
              {tab === 'workout' && (
                <p className="text-xs mt-0.5 opacity-70">{isRest ? 'Rest' : 'Train'}</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Workout Plan content */}
      {tab === 'workout' && workoutDay && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-white">{DAYS[activeDay]} — {workoutDay.focus ?? 'Rest Day'}</h3>
              {workoutDay.isRest
                ? <span className="badge badge-zinc">Rest</span>
                : <span className="badge badge-green">Training</span>}
            </div>
            {workoutDay.isRest ? (
              <p className="text-sm text-zinc-400 mt-2">Active recovery day. Focus on mobility, stretching, or light cardio.</p>
            ) : (
              <div className="space-y-4 mt-4">
                {workoutDay.exercises.map((ex, i) => (
                  <div key={i} className="flex items-start justify-between py-3 border-b border-zinc-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{ex.name}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {ex.sets} sets &times; {ex.reps} &middot; Rest: {ex.rest}s
                        </p>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Meal Plan content */}
      {tab === 'meal' && mealDay && (
        <div className="space-y-4">
          {/* Macro summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Calories', value: `${totalCals}`, unit: 'kcal', color: 'text-orange-400' },
              { label: 'Protein',  value: `${totalProt}g`, unit: '',    color: 'text-blue-400'   },
              { label: 'Carbs',    value: `${totalCarb}g`, unit: '',    color: 'text-yellow-400' },
              { label: 'Fat',      value: `${totalFat}g`,  unit: '',    color: 'text-purple-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card-sm text-center">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-zinc-500 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Meals grouped by type */}
          {mealGroups.map(({ type, items }) => {
            const groupCals = items.reduce((a, i) => a + i.calories, 0);
            const groupProt = items.reduce((a, i) => a + i.protein, 0);
            const groupCarb = items.reduce((a, i) => a + i.carbs, 0);
            const groupFat  = items.reduce((a, i) => a + i.fats, 0);
            return (
              <div key={type} className="card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Utensils className="w-4 h-4 text-emerald-400" />
                    <h4 className="font-medium text-white capitalize">{type}</h4>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-orange-400">
                    <Flame className="w-3 h-3" />
                    {groupCals} kcal
                  </div>
                </div>
                <div className="space-y-2">
                  {items.map((item, j) => (
                    <div key={j} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">{item.name}</span>
                      <span className="text-xs text-zinc-500">
                        P:{item.protein}g C:{item.carbs}g F:{item.fats}g
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-500">
                  <span>P: <span className="text-blue-400 font-medium">{groupProt}g</span></span>
                  <span>C: <span className="text-yellow-400 font-medium">{groupCarb}g</span></span>
                  <span>F: <span className="text-purple-400 font-medium">{groupFat}g</span></span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
