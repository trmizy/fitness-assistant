import { useState } from "react";
import { useNavigate } from "react-router";
import { User, Edit3, Check, Zap, ChevronRight, Award } from "lucide-react";
import { useApp } from "../../context/AppContext";

const goals = [
  { key: "lose_fat",       label: "Lose Fat",       emoji: "🔥" },
  { key: "gain_muscle",    label: "Gain Muscle",     emoji: "💪" },
  { key: "gain_weight",    label: "Gain Weight",     emoji: "📈" },
  { key: "maintain",       label: "Maintain Body",   emoji: "⚖️" },
  { key: "improve_health", label: "Improve Health",  emoji: "❤️" },
];

const activityLevels = ["Sedentary", "Lightly active", "Moderately active", "Very active", "Extremely active"];
const dietPrefs      = ["No preference", "High protein", "Vegetarian", "Vegan", "Keto", "Low carb"];

const inputClass  = "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 transition-all";
const selectClass = "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 bg-zinc-800/60 text-zinc-200";

export function ProfilePage() {
  const { isPT, setActiveView } = useApp();
  const navigate = useNavigate();

  const [editing,  setEditing]  = useState(false);
  const [goal,     setGoal]     = useState("lose_fat");
  const [activity, setActivity] = useState("Moderately active");
  const [diet,     setDiet]     = useState("High protein");

  // For a pure client, ptStatus shows PT upgrade banner
  const [ptStatus] = useState<"not_pt" | "pending" | "approved">("not_pt");

  const ptStatusConfig = {
    not_pt:   { label: "Not enrolled",    bg: "bg-zinc-700/50",  text: "text-zinc-400",  border: "border-zinc-700",     desc: "Apply to become a certified personal trainer on this platform" },
    pending:  { label: "Pending Review",  bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", desc: "Your PT application is under review (2–5 business days)" },
    approved: { label: "Approved PT",     bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/20", desc: "You are a verified personal trainer" },
  };

  const handleSwitchToPT = () => {
    setActiveView("pt");
    navigate("/pt/dashboard");
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <User className="w-5 h-5 text-green-400" /> Profile & Goals
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Your personal information and fitness preferences</p>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg ${
            editing
              ? "bg-green-500 text-black shadow-green-500/25 hover:bg-green-400"
              : "bg-zinc-800 text-zinc-300 border border-zinc-700/60 hover:bg-zinc-700 hover:text-zinc-100 shadow-none"
          }`}
        >
          {editing ? <><Check className="w-4 h-4" /> Save</> : <><Edit3 className="w-4 h-4" /> Edit</>}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Avatar card */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center text-black text-2xl font-bold mb-3 shadow-xl shadow-green-500/20">
            AJ
          </div>
          <h2 className="text-zinc-100 font-bold">Alex Johnson</h2>
          <p className="text-zinc-500 text-sm mt-0.5">
            {isPT ? "Personal Trainer" : "Client"} · Member since Jan 2025
          </p>
          <div className="flex gap-2 mt-3 flex-wrap justify-center">
            <span className="px-2.5 py-1 bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-xs font-semibold rounded-full">Week 12</span>
            <span className="px-2.5 py-1 bg-green-500/10 text-green-400 border border-green-500/20 text-xs font-semibold rounded-full">Active</span>
            {isPT && (
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-full flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> PT Account
              </span>
            )}
          </div>
          {editing && (
            <button className="mt-4 w-full py-2 border border-zinc-700/60 text-sm text-zinc-500 rounded-xl hover:bg-zinc-800 hover:text-zinc-300 transition-colors">
              Change Photo
            </button>
          )}
        </div>

        {/* Info fields */}
        <div className="lg:col-span-2 space-y-4">
          {/* Personal info */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">Personal Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Full Name",    value: "Alex Johnson"     },
                { label: "Email",        value: "alex@example.com" },
                { label: "Age",          value: "28"               },
                { label: "Gender",       value: "Male"             },
                { label: "Height (cm)",  value: "178"              },
                { label: "Weight (kg)",  value: "75.1"             },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs text-zinc-600 mb-1 block uppercase tracking-wider">{f.label}</label>
                  {editing ? (
                    <input defaultValue={f.value} className={inputClass} />
                  ) : (
                    <div className="text-sm font-medium text-zinc-300 py-2">{f.value}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Fitness goal */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">Fitness Goal</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {goals.map(g => (
                <button
                  key={g.key}
                  onClick={() => editing && setGoal(g.key)}
                  disabled={!editing}
                  className={`flex items-center gap-2 px-3 py-2.5 border-2 rounded-xl text-sm transition-all ${
                    goal === g.key
                      ? "border-green-500 bg-green-500/10 text-green-400 font-semibold"
                      : "border-zinc-700/60 text-zinc-500"
                  } ${editing ? "cursor-pointer hover:border-green-500/50" : "cursor-default"}`}
                >
                  <span>{g.emoji}</span>
                  <span className="text-xs">{g.label}</span>
                  {goal === g.key && <Check className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Preferences */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">Preferences</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">Activity Level</label>
                {editing ? (
                  <select value={activity} onChange={e => setActivity(e.target.value)} className={selectClass}>
                    {activityLevels.map(a => <option key={a}>{a}</option>)}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">{activity}</div>
                )}
              </div>
              <div>
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">Dietary Preference</label>
                {editing ? (
                  <select value={diet} onChange={e => setDiet(e.target.value)} className={selectClass}>
                    {dietPrefs.map(d => <option key={d}>{d}</option>)}
                  </select>
                ) : (
                  <div className="text-sm font-medium text-zinc-300 py-2">{diet}</div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-zinc-600 mb-1.5 block uppercase tracking-wider">Health Notes</label>
                {editing ? (
                  <textarea rows={2} defaultValue="No known injuries. Mild lower back sensitivity when squatting heavy." className={`${inputClass} resize-none`} />
                ) : (
                  <div className="text-sm text-zinc-400 py-2">No known injuries. Mild lower back sensitivity when squatting heavy.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PT upgrade / switch banner */}
      {isPT ? (
        // PT user: show workspace switcher promo
        <div className="bg-zinc-900 border border-green-500/20 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold">PT Account Active</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/10 text-green-400 border border-green-500/20">Verified</span>
                </div>
                <p className="text-zinc-500 text-sm mt-0.5">You have access to the Trainer workspace with all coaching tools.</p>
              </div>
            </div>
            <button
              onClick={handleSwitchToPT}
              className="flex items-center gap-2 bg-green-500 text-black px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0 self-start sm:self-auto"
            >
              <Award className="w-4 h-4" /> Go to Trainer View
            </button>
          </div>
        </div>
      ) : (
        // Regular client: show "Become a PT" banner
        <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 border border-zinc-700/60 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/15 border border-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-zinc-100 font-bold">Become a Personal Trainer</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${ptStatusConfig[ptStatus].bg} ${ptStatusConfig[ptStatus].text} ${ptStatusConfig[ptStatus].border}`}>
                    {ptStatusConfig[ptStatus].label}
                  </span>
                </div>
                <p className="text-zinc-500 text-sm mt-0.5">{ptStatusConfig[ptStatus].desc}</p>
              </div>
            </div>
            {ptStatus === "not_pt" && (
              <button
                onClick={() => navigate("/client/pt-application")}
                className="flex items-center gap-2 bg-green-500 text-black px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-lg shadow-green-500/20 flex-shrink-0 self-start sm:self-auto"
              >
                Apply Now <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}