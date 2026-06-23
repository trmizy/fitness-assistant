import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { useApp, UserRole } from "../../context/AppContext";
import { Eye, EyeOff, Dumbbell, User, Zap, Shield, ArrowRight, Activity, Brain } from "lucide-react";

const features = [
  { icon: Activity, text: "Phân tích thành phần cơ thể InBody" },
  { icon: Brain,    text: "Kế hoạch tập luyện & dinh dưỡng từ AI" },
  { icon: Zap,      text: "Huấn luyện PT chuyên nghiệp với theo dõi tiến độ" },
];

export function LoginPage() {
  const { login } = useApp();
  const navigate = useNavigate();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const success = await login(email, password);
      if (success) {
        const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
        const role = storedUser.role === "ADMIN" ? "admin" : (storedUser.isPT ? "pt" : "client");

        navigate(role === "pt" ? "/pt/dashboard" : role === "admin" ? "/admin/dashboard" : "/client/dashboard");
      } else {
        setError("Email hoặc mật khẩu không đúng");
      }
    } catch (err) {
      setError("Đã xảy ra lỗi. Vui lòng thử lại.");
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
                <div className="text-green-400 text-sm">Nền tảng AI Gym Coach</div>
              </div>
            </div>

            <h1 className="text-4xl font-bold leading-tight mb-4 text-white">
              Trợ lý tập luyện<br />
              <span className="text-green-400">thông minh của bạn</span>
            </h1>
            <p className="text-zinc-400 leading-relaxed">
              Kế hoạch tập luyện từ AI, phân tích InBody thời gian thực, và huấn luyện chuyên gia — tất cả trong một nền tảng.
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

            <div className="mt-6 p-4 bg-zinc-800/60 rounded-xl border border-zinc-700/40">
              <p className="text-xs text-zinc-500 leading-relaxed">
                <span className="text-zinc-300 font-semibold">Một tài khoản, nhiều vai trò.</span>{" "}
                Huấn luyện viên PT vẫn giữ toàn quyền theo dõi tập luyện cá nhân, đồng thời có không gian làm việc chuyên nghiệp — tất cả trong một nền tảng.
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

          <h2 className="text-2xl font-bold text-zinc-100 mb-1">Chào mừng trở lại</h2>
          <p className="text-zinc-500 text-sm mb-6">Đăng nhập vào tài khoản của bạn để tiếp tục</p>

          {error && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 mb-6">
            <div>
              <label htmlFor="login-email" className="text-xs font-semibold text-zinc-400 mb-1.5 block uppercase tracking-wider">Địa chỉ email</label>
              <input
                id="login-email"
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
                <label htmlFor="login-password" className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Mật khẩu</label>
                <Link to="/login" className="text-xs text-green-400 hover:text-green-300 transition-colors">Quên mật khẩu?</Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
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
              {loading ? "Đang đăng nhập..." : "Đăng nhập"} <ArrowRight className="w-4 h-4" />
            </button>
          </form>


          <p className="text-center text-sm text-zinc-500 mt-5">
            Chưa có tài khoản?{" "}
            <Link to="/register" className="text-green-400 font-semibold hover:text-green-300 transition-colors">
              Tạo tài khoản
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
