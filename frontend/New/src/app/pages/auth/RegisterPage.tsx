import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApp, UserRole } from "../../context/AppContext";
import { Dumbbell, User, Zap, ArrowRight, ArrowLeft, Check } from "lucide-react";

const steps = ["Account", "Profile", "Goals", "Done"];

export function RegisterPage() {
  const { login } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<UserRole>("client");
  const [goal, setGoal] = useState("lose_fat");

  const goals = [
    { key: "lose_fat",        label: "Lose Fat",        emoji: "🔥" },
    { key: "gain_muscle",     label: "Gain Muscle",     emoji: "💪" },
    { key: "gain_weight",     label: "Gain Weight",     emoji: "📈" },
    { key: "maintain",        label: "Maintain Body",   emoji: "⚖️" },
    { key: "improve_health",  label: "Improve Health",  emoji: "❤️" },
  ];

  const handleFinish = () => {
    login(role);
    navigate(role === "pt" ? "/pt/dashboard" : "/client/dashboard");
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-green-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-green-500/3 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `linear-gradient(rgba(34,197,94,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.5) 1px, transparent 1px)`,
          backgroundSize: "40px 40px"
        }} />
      </div>

      <div className="relative w-full max-w-md bg-zinc-900 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden border border-zinc-800/60">
        {/* Header */}
        <div className="relative px-6 py-5 border-b border-zinc-800/60">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-green-500 via-emerald-400 to-green-600" />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-green-500 rounded-lg flex items-center justify-center shadow-lg shadow-green-500/30">
              <Dumbbell className="w-4 h-4 text-black" />
            </div>
            <span className="text-white font-bold tracking-tight">FITNESS AI</span>
          </div>
          {/* Stepper */}
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
                  i < step   ? "bg-green-500 text-black"
                  : i === step ? "bg-zinc-100 text-zinc-900"
                               : "bg-zinc-700 text-zinc-500"
                }`}>
                  {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${i === step ? "text-zinc-100 font-semibold" : "text-zinc-600"}`}>{s}</span>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all ${i < step ? "bg-green-500" : "bg-zinc-700"}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 0: Account type + credentials */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-100">Create your account</h2>

              <div>
                <label className="text-xs font-semibold text-zinc-400 mb-2 block uppercase tracking-wider">Account type</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    {
                      key: "client" as UserRole,
                      label: "Client",
                      icon: User,
                      desc: "Track my fitness",
                      note: null,
                    },
                    {
                      key: "pt" as UserRole,
                      label: "Personal Trainer",
                      icon: Zap,
                      desc: "Coach clients",
                      note: "Includes client features",
                    },
                  ]).map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setRole(r.key)}
                      className={`flex flex-col items-start gap-2 p-4 border-2 rounded-xl transition-all text-left ${
                        role === r.key
                          ? "border-green-500 bg-green-500/10"
                          : "border-zinc-700/60 hover:border-zinc-600"
                      }`}
                    >
                      <r.icon className={`w-5 h-5 ${role === r.key ? "text-green-400" : "text-zinc-500"}`} />
                      <div>
                        <div className={`text-sm font-semibold ${role === r.key ? "text-green-400" : "text-zinc-300"}`}>
                          {r.label}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">{r.desc}</div>
                        {r.note && (
                          <div className="text-xs text-green-500/70 mt-1 flex items-center gap-1">
                            <Check className="w-3 h-3" /> {r.note}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {/* PT note */}
                {role === "pt" && (
                  <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-green-500/8 border border-green-500/15 rounded-lg">
                    <Zap className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      As a PT, you still have full access to your own fitness tracking. You gain an additional professional coaching workspace.
                    </p>
                  </div>
                )}
              </div>

              <input className="w-full px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 transition-all" placeholder="Full name" />
              <input className="w-full px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 transition-all" placeholder="Email address" />
              <input type="password" className="w-full px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 transition-all" placeholder="Password" />
            </div>
          )}

          {/* Step 1: Profile */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-100">Your profile</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Age</label>
                  <input className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600" placeholder="28" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Gender</label>
                  <select className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200">
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Height (cm)</label>
                  <input className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600" placeholder="175" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block uppercase tracking-wider">Weight (kg)</label>
                  <input className="w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600" placeholder="72" />
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-2 block uppercase tracking-wider">Activity level</label>
                <div className="space-y-2">
                  {["Sedentary", "Lightly active", "Moderately active", "Very active"].map((a) => (
                    <label key={a} className="flex items-center gap-3 cursor-pointer group">
                      <input type="radio" name="activity" className="accent-green-500" defaultChecked={a === "Moderately active"} />
                      <span className="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors">{a}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Goals */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-100">Your fitness goal</h2>
                <p className="text-sm text-zinc-500 mt-1">This helps us personalize your AI plan</p>
              </div>
              <div className="space-y-2">
                {goals.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => setGoal(g.key)}
                    className={`flex items-center gap-3 w-full px-4 py-3 border-2 rounded-xl transition-all text-left ${
                      goal === g.key
                        ? "border-green-500 bg-green-500/10"
                        : "border-zinc-700/60 hover:border-zinc-600"
                    }`}
                  >
                    <span className="text-xl">{g.emoji}</span>
                    <span className={`text-sm font-semibold ${goal === g.key ? "text-green-400" : "text-zinc-300"}`}>{g.label}</span>
                    {goal === g.key && <Check className="w-4 h-4 text-green-400 ml-auto" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && (
            <div className="text-center py-4 space-y-3">
              <div className="w-16 h-16 bg-green-500/15 border border-green-500/30 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-500/20">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100">You're all set!</h2>
              <p className="text-sm text-zinc-500">Your account is ready. Let's begin your fitness journey.</p>
              {role === "pt" && (
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <Zap className="w-4 h-4 text-green-400" />
                  <p className="text-sm text-green-400 font-semibold">PT account · Client + Coaching workspaces unlocked</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center gap-3 mt-6">
            {step > 0 && step < 3 && (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 px-4 py-2.5 border border-zinc-700/60 rounded-xl hover:border-zinc-600 transition-all"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-500/25 hover:shadow-green-500/40"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-green-500/25"
              >
                Go to Dashboard <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {step === 0 && (
            <p className="text-center text-sm text-zinc-500 mt-4">
              Already have an account?{" "}
              <Link to="/login" className="text-green-400 font-semibold hover:text-green-300 transition-colors">Sign in</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
