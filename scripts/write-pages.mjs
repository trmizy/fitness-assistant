import { writeFileSync } from 'fs';
import { join } from 'path';

const pagesDir = 'd:/project_personal/fitness-assistant/frontend/web/src/pages';

const files = {};

// ─── Login ───────────────────────────────────────────────────────────────────
files['Login.tsx'] = `import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Mail, Lock, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { mockUser } from '../data/mock';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error('Invalid email or password');
      const data = await res.json();
      login(data.accessToken, data.refreshToken, data.user);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = () => {
    login('demo-token', 'demo-refresh', mockUser);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">AI Gym Coach</span>
        </div>

        <div className="card">
          <h1 className="text-xl font-semibold text-white mb-1">Welcome back</h1>
          <p className="text-sm text-zinc-400 mb-6">Sign in to your account to continue</p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="input pl-9" placeholder="you@example.com" required />
              </div>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="input pl-9" placeholder="\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022" required />
              </div>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in\u2026' : 'Sign in'}
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-xs text-zinc-500">
              <span className="bg-zinc-900 px-2">or</span>
            </div>
          </div>

          <button onClick={handleDemo}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600/10 border border-emerald-600/20 text-emerald-400 text-sm font-medium hover:bg-emerald-600/20 transition-colors">
            <Zap className="w-4 h-4" />
            Try Demo Mode (no backend needed)
          </button>

          <p className="mt-5 text-center text-sm text-zinc-500">
            {/* eslint-disable-next-line react/no-unescaped-entities */}
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-emerald-400 hover:text-emerald-300 font-medium">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
`;

// ─── Register ────────────────────────────────────────────────────────────────
files['Register.tsx'] = `import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, User, Mail, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { mockUser } from '../data/mock';

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Registration failed. Please try again.');
      const data = await res.json();
      login(data.accessToken, data.refreshToken, data.user);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = () => {
    login('demo-token', 'demo-refresh', mockUser);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">AI Gym Coach</span>
        </div>

        <div className="card">
          <h1 className="text-xl font-semibold text-white mb-1">Create account</h1>
          <p className="text-sm text-zinc-400 mb-6">Start your fitness journey today</p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input type="text" value={form.firstName} onChange={set('firstName')}
                    className="input pl-9" placeholder="Alex" required />
                </div>
              </div>
              <div>
                <label className="label">Last Name</label>
                <input type="text" value={form.lastName} onChange={set('lastName')}
                  className="input" placeholder="Nguyen" required />
              </div>
            </div>

            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input type="email" value={form.email} onChange={set('email')}
                  className="input pl-9" placeholder="you@example.com" required />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input type="password" value={form.password} onChange={set('password')}
                  className="input pl-9" placeholder="Min. 8 characters" minLength={8} required />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating account\u2026' : 'Create account'}
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800" /></div>
            <div className="relative flex justify-center text-xs text-zinc-500"><span className="bg-zinc-900 px-2">or</span></div>
          </div>

          <button onClick={handleDemo}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600/10 border border-emerald-600/20 text-emerald-400 text-sm font-medium hover:bg-emerald-600/20 transition-colors">
            Try Demo Mode (no backend needed)
          </button>

          <p className="mt-5 text-center text-sm text-zinc-500">
            Already have an account?{' '}
            <Link to="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
`;

// ─── Dashboard ───────────────────────────────────────────────────────────────
files['Dashboard.tsx'] = `import React from 'react';
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
      <div className={\`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 \${colorMap[color]}\`}>
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

  const displayName = user ? \`\${user.firstName} \${user.lastName}\` : 'Athlete';

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-bold text-white">
          Good morning, {user?.firstName ?? 'Athlete'} \u{1F44B}
        </h2>
        <p className="text-zinc-400 text-sm mt-1">Here&apos;s your fitness summary</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Scale}       label="Current Weight"  value={\`\${latest.weight} kg\`}        sub={\`\${weightDiff} kg this month\`} color="emerald" />
        <StatCard icon={TrendingUp}  label="Body Fat"        value={\`\${latest.bodyFat}%\`}         sub="Target: 12%"                    color="orange"  />
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
              { to: '/workouts', icon: Dumbbell,    label: 'Log Workout',          sub: 'Record today\u2019s session'  },
              { to: '/inbody',   icon: Scale,       label: 'Update Measurements',  sub: 'Track body composition'        },
              { to: '/plans',    icon: CalendarDays, label: 'View Meal Plan',       sub: 'Today\u2019s nutrition'        },
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
`;

// ─── Profile ─────────────────────────────────────────────────────────────────
files['Profile.tsx'] = `import React, { useState } from 'react';
import { User, Target, Edit3, Save, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const goalLabels: Record<string, string> = {
  muscle_gain:   'Muscle Gain',
  fat_loss:      'Fat Loss',
  maintain:      'Maintain',
  endurance:     'Endurance',
};

const levelLabels: Record<string, string> = {
  beginner:     'Beginner',
  intermediate: 'Intermediate',
  advanced:     'Advanced',
};

export default function Profile() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName:  user?.lastName  ?? '',
    height:    user?.height    ?? 175,
    weight:    user?.weight    ?? 75,
    age:       user?.age       ?? 28,
    goal:      user?.goal      ?? 'muscle_gain',
    level:     user?.level     ?? 'intermediate',
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const initials = \`\${form.firstName[0] ?? '?'}\${form.lastName[0] ?? ''}\`.toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      {/* Avatar + name */}
      <div className="card flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-white">{form.firstName} {form.lastName}</h2>
          <p className="text-sm text-zinc-400">{goalLabels[form.goal]} &middot; {levelLabels[form.level]}</p>
        </div>
        <button onClick={() => setEditing(!editing)}
          className={\`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors \${editing ? 'bg-zinc-800 text-zinc-300' : 'btn-primary'}\`}>
          {editing ? <><X className="w-4 h-4" />Cancel</> : <><Edit3 className="w-4 h-4" />Edit</>}
        </button>
      </div>

      {/* Personal Info */}
      <div className="card">
        <div className="flex items-center gap-2 mb-5">
          <User className="w-4 h-4 text-emerald-400" />
          <h3 className="font-semibold text-white">Personal Information</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {([
            { label: 'First Name', key: 'firstName', type: 'text'   },
            { label: 'Last Name',  key: 'lastName',  type: 'text'   },
            { label: 'Age',        key: 'age',        type: 'number' },
            { label: 'Height (cm)',key: 'height',     type: 'number' },
            { label: 'Weight (kg)',key: 'weight',     type: 'number' },
          ] as { label: string; key: keyof typeof form; type: string }[]).map(({ label, key, type }) => (
            <div key={key}>
              <label className="label">{label}</label>
              {editing ? (
                <input type={type} value={String(form[key])} onChange={set(key)} className="input" />
              ) : (
                <p className="text-white font-medium py-2">{String(form[key])}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Fitness Goals */}
      <div className="card">
        <div className="flex items-center gap-2 mb-5">
          <Target className="w-4 h-4 text-emerald-400" />
          <h3 className="font-semibold text-white">Fitness Goals</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Primary Goal</label>
            {editing ? (
              <select value={form.goal} onChange={set('goal')} className="input">
                {Object.entries(goalLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <p className="text-white font-medium py-2">{goalLabels[form.goal]}</p>
            )}
          </div>
          <div>
            <label className="label">Experience Level</label>
            {editing ? (
              <select value={form.level} onChange={set('level')} className="input">
                {Object.entries(levelLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <p className="text-white font-medium py-2">{levelLabels[form.level]}</p>
            )}
          </div>
        </div>

        {editing && (
          <div className="mt-5 flex justify-end">
            <button
              onClick={() => setEditing(false)}
              className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              Save Changes
            </button>
          </div>
        )}
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'BMI',    value: (form.weight / ((form.height / 100) ** 2)).toFixed(1) },
          { label: 'Height', value: \`\${form.height} cm\` },
          { label: 'Weight', value: \`\${form.weight} kg\` },
        ].map(({ label, value }) => (
          <div key={label} className="card-sm text-center">
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-zinc-500 mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

// ─── InBody ───────────────────────────────────────────────────────────────────
files['InBody.tsx'] = `import React, { useState } from 'react';
import { Scale, TrendingDown, Activity, Plus, X } from 'lucide-react';
import { mockInBodyHistory } from '../data/mock';
import type { InBodyEntry } from '../types';

export default function InBody() {
  const [entries, setEntries] = useState<InBodyEntry[]>(mockInBodyHistory);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: '', weight: '', bodyFat: '', muscleMass: '', bmi: '' });

  const latest = entries[entries.length - 1];
  const prev   = entries[entries.length - 2];

  const diff = (cur: number, pre: number) => {
    const d = (cur - pre).toFixed(1);
    return { text: \`\${Number(d) > 0 ? '+' : ''}\${d}\`, positive: Number(d) > 0 };
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const entry: InBodyEntry = {
      id:         Date.now().toString(),
      date:       form.date,
      weight:     parseFloat(form.weight),
      bodyFat:    parseFloat(form.bodyFat),
      muscleMass: parseFloat(form.muscleMass),
      bmi:        parseFloat(form.bmi),
    };
    setEntries(es => [...es, entry]);
    setShowForm(false);
    setForm({ date: '', weight: '', bodyFat: '', muscleMass: '', bmi: '' });
  };

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* Latest snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Scale,        label: 'Weight',      value: \`\${latest.weight} kg\`,     diffObj: diff(latest.weight, prev.weight),     color: 'emerald', invert: true  },
          { icon: TrendingDown, label: 'Body Fat',    value: \`\${latest.bodyFat}%\`,      diffObj: diff(latest.bodyFat, prev.bodyFat),   color: 'orange',  invert: true  },
          { icon: Activity,     label: 'Muscle Mass', value: \`\${latest.muscleMass} kg\`, diffObj: diff(latest.muscleMass, prev.muscleMass), color: 'blue', invert: false },
          { icon: Scale,        label: 'BMI',         value: String(latest.bmi),          diffObj: diff(latest.bmi, prev.bmi),           color: 'purple',  invert: true  },
        ].map(({ icon: Icon, label, value, diffObj, color, invert }) => {
          const isGood = invert ? !diffObj.positive : diffObj.positive;
          return (
            <div key={label} className="card-sm">
              <div className={\`w-8 h-8 rounded-lg mb-3 flex items-center justify-center bg-\${color}-500/10\`}>
                <Icon className={\`w-4 h-4 text-\${color}-400\`} />
              </div>
              <p className="text-xs text-zinc-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className={\`text-xs mt-1 \${isGood ? 'text-emerald-400' : 'text-red-400'}\`}>
                {diffObj.text} this month
              </p>
            </div>
          );
        })}
      </div>

      {/* History table + add button */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Measurement History</h3>
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3">
            <Plus className="w-4 h-4" />
            Add Entry
          </button>
        </div>

        {/* Add form inline */}
        {showForm && (
          <form onSubmit={handleAdd} className="mb-5 p-4 rounded-lg bg-zinc-800/50 border border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-white">New Measurement</p>
              <button type="button" onClick={() => setShowForm(false)}><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([
                { label: 'Date',        key: 'date',       type: 'date',   placeholder: '' },
                { label: 'Weight (kg)', key: 'weight',     type: 'number', placeholder: '75.0' },
                { label: 'Body Fat (%)',key: 'bodyFat',    type: 'number', placeholder: '16.0' },
                { label: 'Muscle (kg)', key: 'muscleMass', type: 'number', placeholder: '35.0' },
                { label: 'BMI',         key: 'bmi',        type: 'number', placeholder: '24.0' },
              ] as { label: string; key: keyof typeof form; type: string; placeholder: string }[]).map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input type={f.type} step="0.1" value={form[f.key]} onChange={set(f.key)}
                    className="input" placeholder={f.placeholder} required />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <button type="submit" className="btn-primary text-sm py-1.5 px-4">Save</button>
            </div>
          </form>
        )}

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
              {[...entries].reverse().map((e, i) => (
                <tr key={e.id} className={\`border-b border-zinc-800/50 last:border-0 \${i === 0 ? 'bg-emerald-600/5' : ''}\`}>
                  <td className="py-3 px-3 first:pl-0 text-zinc-300">
                    {e.date}
                    {i === 0 && <span className="ml-2 badge badge-green">latest</span>}
                  </td>
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
`;

// ─── Workouts ─────────────────────────────────────────────────────────────────
files['Workouts.tsx'] = `import React, { useState } from 'react';
import { Dumbbell, Plus, X, ChevronDown, ChevronUp, Clock, Flame } from 'lucide-react';
import { mockWorkouts } from '../data/mock';
import type { WorkoutLog } from '../types';

export default function Workouts() {
  const [workouts, setWorkouts] = useState<WorkoutLog[]>(mockWorkouts);
  const [expanded, setExpanded] = useState<string | null>(mockWorkouts[0]?.id ?? null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', duration: '', notes: '' });

  const toggle = (id: string) => setExpanded(e => e === id ? null : id);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const w: WorkoutLog = {
      id:        Date.now().toString(),
      name:      form.name,
      date:      form.date,
      duration:  parseInt(form.duration),
      exercises: [],
      notes:     form.notes,
    };
    setWorkouts(ws => [w, ...ws]);
    setShowForm(false);
    setForm({ name: '', date: '', duration: '', notes: '' });
  };

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Workout Log</h2>
          <p className="text-sm text-zinc-400">{workouts.length} sessions recorded</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Log Workout
        </button>
      </div>

      {/* Add Workout Form */}
      {showForm && (
        <div className="card border border-zinc-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">New Workout</h3>
            <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-zinc-400" /></button>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className="label">Workout Name</label>
                <input type="text" value={form.name} onChange={set('name')}
                  className="input" placeholder="Upper Body Power" required />
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" value={form.date} onChange={set('date')} className="input" required />
              </div>
              <div>
                <label className="label">Duration (min)</label>
                <input type="number" value={form.duration} onChange={set('duration')}
                  className="input" placeholder="60" required />
              </div>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea value={form.notes} onChange={set('notes')}
                className="input resize-none h-16" placeholder="How did it feel?" />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">Cancel</button>
              <button type="submit" className="btn-primary">Save Workout</button>
            </div>
          </form>
        </div>
      )}

      {/* Workout cards */}
      {workouts.map(w => (
        <div key={w.id} className="card">
          <button
            className="w-full flex items-center justify-between"
            onClick={() => toggle(w.id)}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <Dumbbell className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-white">{w.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-zinc-500">{w.date}</span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <Clock className="w-3 h-3" />{w.duration} min
                  </span>
                  <span className="badge badge-blue">{w.exercises.length} exercises</span>
                </div>
              </div>
            </div>
            {expanded === w.id
              ? <ChevronUp className="w-4 h-4 text-zinc-500 flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />}
          </button>

          {expanded === w.id && w.exercises.length > 0 && (
            <div className="mt-4 space-y-4 border-t border-zinc-800 pt-4">
              {w.exercises.map(ex => (
                <div key={ex.exerciseId}>
                  <p className="text-sm font-medium text-white mb-2">{ex.exerciseName}
                    {ex.muscleGroups.map(mg => (
                      <span key={mg} className="ml-2 badge badge-zinc">{mg}</span>
                    ))}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left py-1.5 px-2 text-zinc-500 first:pl-0">Set</th>
                          <th className="text-left py-1.5 px-2 text-zinc-500">Reps</th>
                          <th className="text-left py-1.5 px-2 text-zinc-500">Weight</th>
                          <th className="text-left py-1.5 px-2 text-zinc-500">RPE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ex.sets.map((s, i) => (
                          <tr key={i} className="border-b border-zinc-800/50 last:border-0">
                            <td className="py-2 px-2 first:pl-0 text-zinc-400">{i + 1}</td>
                            <td className="py-2 px-2 text-white">{s.reps}</td>
                            <td className="py-2 px-2 text-emerald-400">{s.weight > 0 ? \`\${s.weight} kg\` : 'BW'}</td>
                            <td className="py-2 px-2 text-zinc-400">{s.rpe ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {w.notes && (
                <p className="text-xs text-zinc-500 italic border-t border-zinc-800 pt-3">{w.notes}</p>
              )}
            </div>
          )}

          {expanded === w.id && w.exercises.length === 0 && (
            <p className="mt-4 text-sm text-zinc-500 border-t border-zinc-800 pt-4">No exercises recorded yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
`;

// ─── Plans ────────────────────────────────────────────────────────────────────
files['Plans.tsx'] = `import React, { useState } from 'react';
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
  const totalFat  = mealDay?.meals.reduce((acc, m) => acc + m.fat, 0) ?? 0;

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-2">
        {([['workout', Dumbbell, 'Workout Plan'], ['meal', Utensils, 'Meal Plan']] as const).map(([key, Icon, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={\`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              \${tab === key
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'}\`}>
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
              className={\`p-2 rounded-lg text-center transition-colors
                \${activeDay === i
                  ? 'bg-emerald-600 text-white'
                  : isRest
                    ? 'bg-zinc-800/30 text-zinc-600 hover:bg-zinc-800'
                    : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'}\`}>
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
                    <div className="flex gap-1 flex-wrap justify-end">
                      {ex.muscleGroups.map(mg => <span key={mg} className="badge badge-zinc">{mg}</span>)}
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
              { label: 'Calories', value: \`\${totalCals}\`, unit: 'kcal', color: 'text-orange-400' },
              { label: 'Protein',  value: \`\${totalProt}g\`, unit: '',    color: 'text-blue-400'   },
              { label: 'Carbs',    value: \`\${totalCarb}g\`, unit: '',    color: 'text-yellow-400' },
              { label: 'Fat',      value: \`\${totalFat}g\`,  unit: '',    color: 'text-purple-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card-sm text-center">
                <p className={\`text-xl font-bold \${color}\`}>{value}</p>
                <p className="text-xs text-zinc-500 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Meals */}
          {mealDay.meals.map((meal, i) => (
            <div key={i} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-emerald-400" />
                  <h4 className="font-medium text-white capitalize">{meal.type}</h4>
                </div>
                <div className="flex items-center gap-1 text-xs text-orange-400">
                  <Flame className="w-3 h-3" />
                  {meal.calories} kcal
                </div>
              </div>
              <div className="space-y-2">
                {meal.items.map((item, j) => (
                  <div key={j} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-300">{item.name}</span>
                    <span className="text-zinc-500">{item.amount}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-500">
                <span>P: <span className="text-blue-400 font-medium">{meal.protein}g</span></span>
                <span>C: <span className="text-yellow-400 font-medium">{meal.carbs}g</span></span>
                <span>F: <span className="text-purple-400 font-medium">{meal.fat}g</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
`;

// ─── Coach ────────────────────────────────────────────────────────────────────
files['Coach.tsx'] = `import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { mockMessages, suggestionChips } from '../data/mock';
import type { Message } from '../types';

export default function Coach() {
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(ms => [...ms, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${localStorage.getItem('accessToken') ?? 'demo-token'}\`,
        },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) throw new Error('AI service unavailable');
      const data = await res.json();
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: data.response, timestamp: new Date().toISOString() };
      setMessages(ms => [...ms, aiMsg]);
    } catch {
      const fallback: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I\u2019m currently running in demo mode \u2014 connect the AI service to get personalized responses. In the meantime, feel free to explore the app!',
        timestamp: new Date().toISOString(),
      };
      setMessages(ms => [...ms, fallback]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 pb-4 border-b border-zinc-800">
        <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-600/30 flex items-center justify-center">
          <Bot className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white">AI Fitness Coach</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-500">Online</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.map(m => (
          <div key={m.id} className={\`flex items-start gap-3 \${m.role === 'user' ? 'flex-row-reverse' : ''}\`}>
            <div className={\`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
              \${m.role === 'assistant' ? 'bg-emerald-600/20 border border-emerald-600/30' : 'bg-zinc-700'}\`}>
              {m.role === 'assistant'
                ? <Bot className="w-4 h-4 text-emerald-400" />
                : <User className="w-4 h-4 text-zinc-300" />}
            </div>
            <div className={\`max-w-[80%] \${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1\`}>
              <div className={\`px-4 py-3 rounded-2xl text-sm leading-relaxed
                \${m.role === 'assistant'
                  ? 'bg-zinc-800 text-zinc-100 rounded-tl-sm'
                  : 'bg-emerald-600 text-white rounded-tr-sm'}\`}>
                {m.content}
              </div>
              <span className="text-xs text-zinc-600 px-1">{formatTime(m.timestamp)}</span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-600/30 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-zinc-800 flex items-center gap-1.5">
              {[0, 150, 300].map(d => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: \`\${d}ms\` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-3 pt-1 scrollbar-none">
        {suggestionChips.map(chip => (
          <button key={chip} onClick={() => send(chip)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs
                       bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-emerald-600/50
                       hover:text-emerald-400 transition-colors whitespace-nowrap">
            <Sparkles className="w-3 h-3" />
            {chip}
          </button>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 flex gap-3 pt-3 border-t border-zinc-800">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          className="input flex-1"
          placeholder="Ask your AI coach anything\u2026"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}
          className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center
                     hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
          <Send className="w-4 h-4 text-white" />
        </button>
      </form>
    </div>
  );
}
`;

// Write all files
let written = 0;
for (const [filename, content] of Object.entries(files)) {
  const path = join(pagesDir, filename).replace(/\//g, '/');
  writeFileSync(path, content, 'utf-8');
  console.log(`✅ ${filename}`);
  written++;
}
console.log(`\nDone — ${written} files written.`);
