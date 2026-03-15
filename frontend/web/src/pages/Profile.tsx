import React, { useState } from 'react';
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
    level:     user?.fitnessLevel ?? 'intermediate',
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const initials = `${form.firstName[0] ?? '?'}${form.lastName[0] ?? ''}`.toUpperCase();

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
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${editing ? 'bg-zinc-800 text-zinc-300' : 'btn-primary'}`}>
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
          { label: 'Height', value: `${form.height} cm` },
          { label: 'Weight', value: `${form.weight} kg` },
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
