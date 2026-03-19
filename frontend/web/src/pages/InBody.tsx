import React, { useEffect, useState } from 'react';
import { Scale, TrendingDown, Activity, Plus, X } from 'lucide-react';
import { profileService } from '../services/api';

type Profile = {
  age?: number;
  heightCm?: number;
  currentWeight?: number;
  targetWeight?: number;
  goal?: string;
  activityLevel?: string;
};

export default function InBody() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    age: '',
    heightCm: '',
    currentWeight: '',
    targetWeight: '',
    goal: 'MAINTENANCE',
    activityLevel: 'MODERATELY_ACTIVE',
  });

  const loadProfile = async () => {
    try {
      setError('');
      const data = await profileService.getProfile();
      const p = (data?.profile || null) as Profile | null;
      setProfile(p);
      setForm({
        age: p?.age?.toString() || '',
        heightCm: p?.heightCm?.toString() || '',
        currentWeight: p?.currentWeight?.toString() || '',
        targetWeight: p?.targetWeight?.toString() || '',
        goal: p?.goal || 'MAINTENANCE',
        activityLevel: p?.activityLevel || 'MODERATELY_ACTIVE',
      });
    } catch {
      setError('Failed to load profile metrics');
      setProfile(null);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError('');
      await profileService.updateProfile({
        age: form.age ? Number(form.age) : undefined,
        heightCm: form.heightCm ? Number(form.heightCm) : undefined,
        currentWeight: form.currentWeight ? Number(form.currentWeight) : undefined,
        targetWeight: form.targetWeight ? Number(form.targetWeight) : undefined,
        goal: form.goal || undefined,
        activityLevel: form.activityLevel || undefined,
      });
      setShowForm(false);
      await loadProfile();
    } catch {
      setError('Failed to update profile metrics');
    } finally {
      setSaving(false);
    }
  };

  const currentWeight = profile?.currentWeight;
  const targetWeight = profile?.targetWeight;
  const weightGap =
    typeof currentWeight === 'number' && typeof targetWeight === 'number'
      ? Number((currentWeight - targetWeight).toFixed(1))
      : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-sm">
          <div className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center bg-emerald-500/10">
            <Scale className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xs text-zinc-500 mb-1">Current Weight</p>
          <p className="text-2xl font-bold text-white">{typeof currentWeight === 'number' ? `${currentWeight} kg` : '--'}</p>
          <p className="text-xs mt-1 text-zinc-500">From your profile</p>
        </div>

        <div className="card-sm">
          <div className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center bg-orange-500/10">
            <TrendingDown className="w-4 h-4 text-orange-400" />
          </div>
          <p className="text-xs text-zinc-500 mb-1">Target Weight</p>
          <p className="text-2xl font-bold text-white">{typeof targetWeight === 'number' ? `${targetWeight} kg` : '--'}</p>
          <p className="text-xs mt-1 text-zinc-500">Goal reference</p>
        </div>

        <div className="card-sm">
          <div className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center bg-blue-500/10">
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xs text-zinc-500 mb-1">Height</p>
          <p className="text-2xl font-bold text-white">{typeof profile?.heightCm === 'number' ? `${profile.heightCm} cm` : '--'}</p>
          <p className="text-xs mt-1 text-zinc-500">From your profile</p>
        </div>

        <div className="card-sm">
          <div className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center bg-purple-500/10">
            <Scale className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xs text-zinc-500 mb-1">Weight Gap</p>
          <p className="text-2xl font-bold text-white">{weightGap === null ? '--' : `${weightGap > 0 ? '+' : ''}${weightGap} kg`}</p>
          <p className="text-xs mt-1 text-zinc-500">Current - Target</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white">Body Metrics (Database)</h3>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3"
          >
            <Plus className="w-4 h-4" />
            Update Metrics
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSave} className="mb-5 p-4 rounded-lg bg-zinc-800/50 border border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-white">Edit Profile Metrics</p>
              <button type="button" onClick={() => setShowForm(false)}>
                <X className="w-4 h-4 text-zinc-400" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Age</label>
                <input type="number" value={form.age} onChange={set('age')} className="input" placeholder="28" />
              </div>
              <div>
                <label className="label">Height (cm)</label>
                <input type="number" value={form.heightCm} onChange={set('heightCm')} className="input" placeholder="175" />
              </div>
              <div>
                <label className="label">Current Weight (kg)</label>
                <input type="number" value={form.currentWeight} onChange={set('currentWeight')} className="input" placeholder="78" />
              </div>
              <div>
                <label className="label">Target Weight (kg)</label>
                <input type="number" value={form.targetWeight} onChange={set('targetWeight')} className="input" placeholder="72" />
              </div>
              <div>
                <label className="label">Goal</label>
                <select value={form.goal} onChange={set('goal')} className="input">
                  <option value="WEIGHT_LOSS">Weight Loss</option>
                  <option value="MUSCLE_GAIN">Muscle Gain</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="ATHLETIC_PERFORMANCE">Athletic Performance</option>
                </select>
              </div>
              <div>
                <label className="label">Activity Level</label>
                <select value={form.activityLevel} onChange={set('activityLevel')} className="input">
                  <option value="SEDENTARY">Sedentary</option>
                  <option value="LIGHTLY_ACTIVE">Lightly Active</option>
                  <option value="MODERATELY_ACTIVE">Moderately Active</option>
                  <option value="VERY_ACTIVE">Very Active</option>
                  <option value="EXTREMELY_ACTIVE">Extremely Active</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end mt-3">
              <button type="submit" className="btn-primary text-sm py-1.5 px-4" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}

        <div className="text-sm text-zinc-400">
          This screen now uses only your real profile data in database. Body-fat and muscle history are not persisted by
          current backend models yet.
        </div>
      </div>
    </div>
  );
}
