import React, { useState } from 'react';
import axios from 'axios';
import { User, Target, Edit3, Save, X, Award } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/api';

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
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptError, setPtError] = useState<string | null>(null);
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

  const handleBecomePT = async () => {
    setPtLoading(true);
    setPtError(null);
    try {
      await profileService.becomePT();
      updateUser({ isPT: true });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setPtError(error.response?.data?.error || 'Failed to become PT. Please try again.');
      } else {
        setPtError('Failed to become PT. Please try again.');
      }
    } finally {
      setPtLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Avatar + name */}
      <div className="card flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{form.firstName} {form.lastName}</h2>
            {user?.isPT && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 text-xs font-medium border border-emerald-600/30">
                <Award className="w-3 h-3" /> PT
              </span>
            )}
          </div>
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

      {/* Become PT */}
      {!user?.isPT && (
        <div className="card border border-emerald-600/20 bg-emerald-600/5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-600/20 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Become a Personal Trainer</h3>
              <p className="text-sm text-zinc-400 mb-4">
                Activate your PT status to offer coaching services and chat with clients.
              </p>
              {ptError && <p className="text-sm text-red-400 mb-3">{ptError}</p>}
              <button
                onClick={handleBecomePT}
                disabled={ptLoading}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Award className="w-4 h-4" />
                {ptLoading ? 'Activating...' : 'Become a PT'}
              </button>
            </div>
          </div>
        </div>
      )}

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
