import React from 'react';
import { Link } from 'react-router-dom';
import { Scale, Dumbbell, Flame, TrendingUp, ChevronRight, CalendarDays, Bot } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { mockInBodyHistory, mockWorkouts } from '../data/mock';

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
  const latest = mockInBodyHistory[mockInBodyHistory.length - 1];
  const prev   = mockInBodyHistory[mockInBodyHistory.length - 2];
  const weightDiff = (latest.weight - prev.weight).toFixed(1);
  const recentWorkouts = mockWorkouts.slice(0, 3);

  const displayName = user ? `${user.firstName} ${user.lastName}` : 'Athlete';

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
        <StatCard icon={Scale}       label="Current Weight"  value={`${latest.weight} kg`}        sub={`${weightDiff} kg this month`} color="emerald" />
        <StatCard icon={TrendingUp}  label="Body Fat"        value={`${latest.bodyFat}%`}         sub="Target: 12%"                    color="orange"  />
        <StatCard icon={Dumbbell}    label="Workouts / Week" value="4"                              sub="Goal: 5 sessions"               color="blue"    />
        <StatCard icon={Flame}       label="Active Streak"   value="12 days"                        sub="Personal best: 21 days"         color="purple"  />
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
            {recentWorkouts.map(w => (
              <div key={w.id} className="flex items-center justify-between py-3 border-b border-zinc-800 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center">
                    <Dumbbell className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{w.name}</p>
                    <p className="text-xs text-zinc-500">{w.date} &middot; {w.duration} min</p>
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

      {/* Body composition progress */}
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Body Composition Progress</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                {['Date', 'Weight', 'Body Fat', 'Muscle Mass', 'BMI'].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium text-zinc-500 first:pl-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...mockInBodyHistory].reverse().slice(0, 4).map(e => (
                <tr key={e.date} className="border-b border-zinc-800/50 last:border-0">
                  <td className="py-3 px-3 text-zinc-300 first:pl-0">{e.date}</td>
                  <td className="py-3 px-3 text-white font-medium">{e.weight} kg</td>
                  <td className="py-3 px-3 text-orange-400">{e.bodyFat}%</td>
                  <td className="py-3 px-3 text-blue-400">{e.muscleMass} kg</td>
                  <td className="py-3 px-3 text-zinc-300">{e.bmi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
