import React, { useState } from 'react';
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
    return { text: `${Number(d) > 0 ? '+' : ''}${d}`, positive: Number(d) > 0 };
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
      bmr:        Math.round(10 * parseFloat(form.weight) + 6.25 * 175 - 5 * 28 + 5),
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
          { icon: Scale,        label: 'Weight',      value: `${latest.weight} kg`,     diffObj: diff(latest.weight, prev.weight),     color: 'emerald', invert: true  },
          { icon: TrendingDown, label: 'Body Fat',    value: `${latest.bodyFat}%`,      diffObj: diff(latest.bodyFat, prev.bodyFat),   color: 'orange',  invert: true  },
          { icon: Activity,     label: 'Muscle Mass', value: `${latest.muscleMass} kg`, diffObj: diff(latest.muscleMass, prev.muscleMass), color: 'blue', invert: false },
          { icon: Scale,        label: 'BMI',         value: String(latest.bmi),          diffObj: diff(latest.bmi, prev.bmi),           color: 'purple',  invert: true  },
        ].map(({ icon: Icon, label, value, diffObj, color, invert }) => {
          const isGood = invert ? !diffObj.positive : diffObj.positive;
          return (
            <div key={label} className="card-sm">
              <div className={`w-8 h-8 rounded-lg mb-3 flex items-center justify-center bg-${color}-500/10`}>
                <Icon className={`w-4 h-4 text-${color}-400`} />
              </div>
              <p className="text-xs text-zinc-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className={`text-xs mt-1 ${isGood ? 'text-emerald-400' : 'text-red-400'}`}>
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
                <tr key={e.id} className={`border-b border-zinc-800/50 last:border-0 ${i === 0 ? 'bg-emerald-600/5' : ''}`}>
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
