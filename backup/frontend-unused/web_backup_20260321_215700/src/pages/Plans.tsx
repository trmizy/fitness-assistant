import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Utensils, Dumbbell, Flame } from 'lucide-react';
import api, { workoutService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type WorkoutItem = {
  id: string;
  name: string;
  date: string;
  duration?: number | null;
  exercises: unknown[];
};

type NutritionItem = {
  id: string;
  date: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  foodName: string;
  calories: number;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function Plans() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'workout' | 'meal'>('workout');
  const [activeDay, setActiveDay] = useState(0);
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedDate = useMemo(() => {
    const now = new Date();
    const monday = new Date(now);
    const day = now.getDay() || 7;
    monday.setDate(now.getDate() - (day - 1));
    monday.setHours(0, 0, 0, 0);

    const target = new Date(monday);
    target.setDate(monday.getDate() + activeDay);
    return target;
  }, [activeDay]);

  useEffect(() => {
    if (!user?.id) {
      setWorkouts([]);
      setNutritionLogs([]);
      setLoading(false);
      setError('');
      return;
    }

    const loadData = async () => {
      setLoading(true);
      try {
        setError('');
        const [workoutRes, nutritionRes] = await Promise.all([
          workoutService.getHistory(1, 100),
          api.get('/nutrition'),
        ]);

        setWorkouts(Array.isArray(workoutRes) ? (workoutRes as WorkoutItem[]) : []);
        setNutritionLogs(Array.isArray(nutritionRes.data) ? (nutritionRes.data as NutritionItem[]) : []);
      } catch {
        setError('Failed to load plan data');
        setWorkouts([]);
        setNutritionLogs([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user?.id]);

  const workoutsOfDay = useMemo(
    () => workouts.filter((w) => sameDay(new Date(w.date), selectedDate)),
    [workouts, selectedDate],
  );

  const mealsOfDay = useMemo(
    () => nutritionLogs.filter((m) => sameDay(new Date(m.date), selectedDate)),
    [nutritionLogs, selectedDate],
  );

  const totals = useMemo(() => {
    return mealsOfDay.reduce(
      (acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        acc.carbs += item.carbs || 0;
        acc.fats += item.fats || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fats: 0 },
    );
  }, [mealsOfDay]);

  const mealGroups = useMemo(() => {
    return (['breakfast', 'lunch', 'snack', 'dinner'] as const)
      .map((type) => ({ type, items: mealsOfDay.filter((m) => m.mealType === type) }))
      .filter((g) => g.items.length > 0);
  }, [mealsOfDay]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {([
          ['workout', Dumbbell, 'Workout Plan'],
          ['meal', Utensils, 'Meal Plan'],
        ] as const).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${
                tab === key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((d, i) => (
          <button
            key={d}
            onClick={() => setActiveDay(i)}
            className={`p-2 rounded-lg text-center transition-colors
              ${
                activeDay === i
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
          >
            <p className="text-xs font-medium">{d}</p>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {tab === 'workout' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-white">
                {DAYS[activeDay]} - Workout Schedule
              </h3>
              <span className="badge badge-green">{workoutsOfDay.length} session(s)</span>
            </div>

            {loading ? (
              <p className="text-sm text-zinc-400 mt-2">Loading workouts...</p>
            ) : workoutsOfDay.length === 0 ? (
              <p className="text-sm text-zinc-400 mt-2">No workout logged for this day.</p>
            ) : (
              <div className="space-y-4 mt-4">
                {workoutsOfDay.map((w, i) => (
                  <div key={w.id} className="flex items-start justify-between py-3 border-b border-zinc-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{w.name}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {new Date(w.date).toLocaleDateString()} · {w.duration ?? 0} min · {w.exercises.length} exercises
                        </p>
                      </div>
                    </div>
                    <CalendarDays className="w-4 h-4 text-zinc-500 mt-1" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'meal' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Calories', value: `${totals.calories}`, color: 'text-orange-400' },
              { label: 'Protein', value: `${Math.round(totals.protein)}g`, color: 'text-blue-400' },
              { label: 'Carbs', value: `${Math.round(totals.carbs)}g`, color: 'text-yellow-400' },
              { label: 'Fat', value: `${Math.round(totals.fats)}g`, color: 'text-purple-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card-sm text-center">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-zinc-500 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="card text-sm text-zinc-400">Loading nutrition logs...</div>
          ) : mealGroups.length === 0 ? (
            <div className="card text-sm text-zinc-400">No meal data for this day.</div>
          ) : (
            mealGroups.map(({ type, items }) => {
              const groupCals = items.reduce((a, i) => a + i.calories, 0);
              const groupProt = items.reduce((a, i) => a + (i.protein || 0), 0);
              const groupCarb = items.reduce((a, i) => a + (i.carbs || 0), 0);
              const groupFat = items.reduce((a, i) => a + (i.fats || 0), 0);

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
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-300">{item.foodName}</span>
                        <span className="text-xs text-zinc-500">
                          P:{Math.round(item.protein || 0)}g C:{Math.round(item.carbs || 0)}g F:{Math.round(item.fats || 0)}g
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4 mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-500">
                    <span>
                      P: <span className="text-blue-400 font-medium">{Math.round(groupProt)}g</span>
                    </span>
                    <span>
                      C: <span className="text-yellow-400 font-medium">{Math.round(groupCarb)}g</span>
                    </span>
                    <span>
                      F: <span className="text-purple-400 font-medium">{Math.round(groupFat)}g</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
