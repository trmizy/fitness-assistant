import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale, Dumbbell, Flame, TrendingUp, ChevronRight, CalendarDays, Bot } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService, workoutService } from '../services/api';

type ProfileResponse = {
  profile?: {
    currentWeight?: number;
    targetWeight?: number;
  } | null;
};

type WorkoutStats = {
  totalWorkouts: number;
  totalDuration: number;
  totalExercises: number;
  averageDuration: number;
  workoutsPerWeek: string;
};

type WorkoutItem = {
  id: string;
  name: string;
  date: string;
  duration?: number | null;
  exercises: unknown[];
};

function StatCard({ icon: Icon, label, value, sub, color = 'emerald' }: {
  icon: React.ElementType; label: string; value: string; sub: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-600/10 text-emerald-400',
    orange:  'bg-orange-500/10 text-orange-400',
    blue:    'bg-blue-500/10 text-blue-400',
    purple:  'bg-purple-500/10 text-purple-400',
  };
  return (
    <div className="card-sm flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-white leading-none">{value}</p>
        <p className="text-xs text-zinc-500 mt-1">{sub}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileResponse['profile']>(null);
  const [stats, setStats] = useState<WorkoutStats | null>(null);
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutItem[]>([]);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const [profileRes, statsRes, workoutsRes] = await Promise.all([
          profileService.getProfile(),
          workoutService.getStats(),
          workoutService.getHistory(1, 3),
        ]);

        setProfile((profileRes as ProfileResponse).profile ?? null);
        setStats(statsRes as WorkoutStats);
        setRecentWorkouts(Array.isArray(workoutsRes) ? (workoutsRes as WorkoutItem[]) : []);
      } catch {
        setProfile(null);
        setStats(null);
        setRecentWorkouts([]);
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  const streakDays = useMemo(() => {
    if (recentWorkouts.length === 0) return 0;

    const workoutDays = new Set(
      recentWorkouts.map((w) => new Date(w.date).toISOString().slice(0, 10)),
    );

    let streak = 0;
    const current = new Date();
    while (true) {
      const dayKey = current.toISOString().slice(0, 10);
      if (!workoutDays.has(dayKey)) break;
      streak += 1;
      current.setDate(current.getDate() - 1);
    }

    return streak;
  }, [recentWorkouts]);

  const currentWeight = profile?.currentWeight;
  const targetWeight = profile?.targetWeight;
  const weightGap =
    typeof currentWeight === 'number' && typeof targetWeight === 'number'
      ? (currentWeight - targetWeight).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-bold text-white">
          Good morning, {user?.firstName ?? 'Athlete'} 👋
        </h2>
        <p className="text-zinc-400 text-sm mt-1">Here&apos;s your fitness summary</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Scale}
          label="Current Weight"
          value={typeof currentWeight === 'number' ? `${currentWeight} kg` : '--'}
          sub={weightGap !== null ? `${weightGap} kg vs target` : 'Update profile to see weight'}
          color="emerald"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Duration"
          value={stats ? `${Math.round(stats.totalDuration / 60)} h` : '--'}
          sub={stats ? `${stats.totalDuration} min in last 30 days` : 'No workout stats yet'}
          color="orange"
        />
        <StatCard
          icon={Dumbbell}
          label="Workouts / Week"
          value={stats ? `${stats.workoutsPerWeek}` : '--'}
          sub={stats ? `${stats.totalWorkouts} sessions in 30 days` : 'No workout stats yet'}
          color="blue"
        />
        <StatCard
          icon={Flame}
          label="Active Streak"
          value={`${streakDays} day${streakDays === 1 ? '' : 's'}`}
          sub={streakDays > 0 ? 'Based on recent logs' : 'Log workouts to build streak'}
          color="purple"
        />
      </div>

      {/* Two-column lower section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent workouts */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Recent Workouts</h3>
            <Link to="/workouts" className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {!loading && recentWorkouts.length === 0 && (
              <p className="text-sm text-zinc-500 py-6">No workouts yet. Start by logging your first session.</p>
            )}
            {recentWorkouts.map(w => (
              <div key={w.id} className="flex items-center justify-between py-3 border-b border-zinc-800 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center">
                    <Dumbbell className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{w.name}</p>
                    <p className="text-xs text-zinc-500">{new Date(w.date).toLocaleDateString()} &middot; {w.duration ?? 0} min</p>
                  </div>
                </div>
                <span className="badge badge-green">{w.exercises.length} exercises</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="card">
          <h3 className="font-semibold text-white mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              { to: '/workouts', icon: Dumbbell,    label: 'Log Workout',          sub: 'Record today’s session'  },
              { to: '/inbody',   icon: Scale,       label: 'Update Measurements',  sub: 'Track body composition'        },
              { to: '/plans',    icon: CalendarDays, label: 'View Meal Plan',       sub: 'Today’s nutrition'        },
              { to: '/coach',    icon: Bot,          label: 'Ask AI Coach',         sub: 'Get personalized advice'       },
            ].map(({ to, icon: Icon, label, sub }) => (
              <Link key={to} to={to}
                className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors group">
                <Icon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-zinc-500 truncate">{sub}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 ml-auto flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Workout summary */}
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Your Data Summary</h3>
        <p className="text-sm text-zinc-400">
          Dashboard now shows your real account data from backend services. If a section is empty,
          it means you have not logged that data yet.
        </p>
      </div>
    </div>
  );
}
