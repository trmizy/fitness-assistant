import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useApp, UserRole } from "../../context/AppContext";
import { Eye, EyeOff, Dumbbell, User, Zap, Shield, ArrowRight, Activity, Brain } from "lucide-react";

// Demo account tiles — clicking one fills the form
const demoAccounts: {
  role: UserRole;
  name: string;
  email: string;
  subtitle: string;
  avatar: string;
  icon: React.ElementType;
  accent: string;
  accentBg: string;
  accentBorder: string;
}[] = [
  {
    role: "client",
    name: "Alex Johnson",
    email: "alex@example.com",
    subtitle: "Client Account",
    avatar: "AJ",
    icon: User,
    accent: "text-green-400",
    accentBg: "bg-green-500/10",
    accentBorder: "border-green-500/30",
  },
  {
    role: "pt",
    name: "Sarah Mitchell",
    email: "sarah@trainer.com",
    subtitle: "Personal Trainer",
    avatar: "SM",
    icon: Zap,
    accent: "text-emerald-400",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-emerald-500/30",
  },
  {
    role: "admin",
    name: "Admin User",
    email: "admin@fitnessai.com",
    subtitle: "Platform Admin",
    avatar: "AU",
    icon: Shield,
    accent: "text-violet-400",
    accentBg: "bg-violet-500/10",
    accentBorder: "border-violet-500/30",
  },
];

const features = [
  { icon: Activity, text: "InBody body composition analysis" },
  { icon: Brain,    text: "AI-generated workout & nutrition plans" },
  { icon: Zap,      text: "PT-managed coaching with live progress" },
];

export function LoginPage() {
  const { login } = useApp();
  const navigate = useNavigate();

  const [email,    setEmail]    = useState("alex@example.com");
  const [password, setPassword] = useState("password123");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Fill form from demo tile
  const fillDemo = (acc: typeof demoAccounts[0]) => {
    setEmail(acc.email);
    setPassword("password123");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const success = await login(email, password);
      if (success) {
        // AppContext handles user state; we just need to navigate
        // Get user from localStorage or state (state might not be updated yet, so we can re-derive role or use state if it is)
        const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
        const role = storedUser.role === "ADMIN" ? "admin" : (storedUser.isPT ? "pt" : "client");
        
        navigate(role === "pt" ? "/pt/dashboard" : role === "admin" ? "/admin/dashboard" : "/client/dashboard");
      } else {
        setError("Invalid email or password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-60 -right-60 w-[500px] h-[500px] bg-green-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-60 -left-60 w-[500px] h-[500px] bg-green-500/3 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `linear-gradient(rgba(34,197,94,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.5) 1px, transparent 1px)`,
          backgroundSize: "40px 40px"
        }} />
      </div>

      <div className="relative w-full max-w-4xl grid lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-zinc-800/60">

        {/* ── Left panel ── */}
        <div className="hidden lg:flex flex-col justify-between bg-zinc-900 p-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 via-emerald-400 to-green-600" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-green-500/8 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/30">
                <Dumbbell className="w-5 h-5 text-black" />
              </div>
              <div>
                <div className="font-bold text-lg text-white leading-tight tracking-tight">FITNESS AI</div>
                <div className="text-green-400 text-sm">AI Gym Coach Platform</div>
              </div>
            </div>

            <h1 className="text-4xl font-bold leading-tight mb-4 text-white">
              Your intelligent<br />
              <span className="text-green-400">fitness companion</span>
            </h1>
            <p className="text-zinc-400 leading-relaxed">
              AI-powered workout plans, real-time InBody analysis, and expert coaching — all in one performance platform.
            </p>
          </div>

          <div className="relative z-10 space-y-3">
            {features.map((item) => (
              <div key={item.text} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-500/15 border border-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-4 h-4 text-green-400" />
                </div>
                <span className="text-sm text-zinc-400">{item.text}</span>
              </div>
            ))}

            {/* Role model explainer */}
            <div className="mt-6 p-4 bg-zinc-800/60 rounded-xl border border-zinc-700/40">
              <p className="text-xs text-zinc-500 leading-relaxed">
                <span className="text-zinc-300 font-semibold">One account, multiple roles.</span>{" "}
                Personal Trainers retain full access to their own fitness tracking while
                gaining a professional coaching workspace — all in one unified platform.
              </p>
            </div>
          </div>
        </div>

        {/* ── Right panel: form ── */}
        <div className="bg-zinc-900 p-8 sm:p-10 flex flex-col justify-center border-l border-zinc-800/60">
          {/* Mobile brand */}
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center shadow-lg shadow-green-500/30">
              <Dumbbell className="w-4 h-4 text-black" />
            </div>
            <span className="font-bold text-zinc-100 tracking-tight">FITNESS AI</span>
          </div>

          <h2 className="text-2xl font-bold text-zinc-100 mb-1">Welcome back</h2>
          <p className="text-zinc-500 text-sm mb-6">Sign in to your account to continue</p>

          {error && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4 mb-6">
            <div>
              <label className="text-xs font-semibold text-zinc-400 mb-1.5 block uppercase tracking-wider">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 transition-all"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Password</label>
                <Link to="/login" className="text-xs text-green-400 hover:text-green-300 transition-colors">Forgot password?</Link>
              </div>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 border border-zinc-700/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/25 hover:shadow-green-500/40 hover:scale-[1.01] active:scale-[0.99]"
            >
              {loading ? "Signing in..." : "Sign In"} <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* ── Demo accounts ── */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-xs text-zinc-600 font-semibold uppercase tracking-wider">Demo Accounts</span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>
            <p className="text-xs text-zinc-600 text-center mb-3">Click any account to load credentials</p>
            <div className="grid grid-cols-3 gap-2">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.role}
                  type="button"
                  onClick={() => fillDemo(acc)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center border-zinc-800 hover:border-zinc-700 bg-zinc-800/30`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black ${
                    acc.role === "admin" ? "bg-violet-500" : "bg-green-500"
                  }`}>
                    {acc.avatar}
                  </div>
                  <div>
                    <div className={`text-xs font-semibold leading-tight text-zinc-400`}>
                      {acc.name.split(" ")[0]}
                    </div>
                    <div className="text-xs text-zinc-600 leading-tight mt-0.5">{acc.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <p className="text-center text-sm text-zinc-500 mt-5">
            Don't have an account?{" "}
            <Link to="/register" className="text-green-400 font-semibold hover:text-green-300 transition-colors">
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
