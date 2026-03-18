import React, { useState } from 'react';
import { Dumbbell, Plus, X, ChevronDown, ChevronUp, Clock, Flame } from 'lucide-react';

import type { WorkoutLog } from '../types';

export default function Workouts() {
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
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
                  <div key={ex.id}>
                    <p className="text-sm font-medium text-white mb-2">{ex.exerciseName}</p>
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
                            <td className="py-2 px-2 text-emerald-400">{s.weight > 0 ? `${s.weight} kg` : 'BW'}</td>
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
