import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useApp, UserRole } from "../../context/AppContext";
import { EyeIcon as Eye, EyeSlashIcon as EyeOff, UserIcon as User, LightningIcon as Zap, ShieldIcon as Shield, ArrowRightIcon as ArrowRight, PulseIcon as Activity, BrainIcon as Brain, DatabaseIcon as ServerCog } from "@phosphor-icons/react";

import { getServerOverride, setServerOverride } from "../../config/serverUrl";
import { ROLE_HOME, landingPathFor } from "../../config/landing";
import { Preferences } from "@capacitor/preferences";
import { AppLogo } from "../../components/brand/AppLogo";

const features = [
  { icon: Activity, text: "Phân tích thành phần cơ thể InBody" },
  { icon: Brain, text: "Kế hoạch tập luyện & dinh dưỡng từ AI" },
  { icon: Zap, text: "Huấn luyện PT chuyên nghiệp với theo dõi tiến độ" },
];

export function LoginPage() {
  const { login, isAuthenticated, role } = useApp();
  const navigate = useNavigate();

  // Anyone who reaches the login screen with a live session belongs inside the app.
  // Without this, a restored session that landed here for any reason (a deep link, an
  // old history entry, "/" before RootRedirect existed) left the user staring at a login
  // form and retyping a password they never needed to enter — the reported bug.
  useEffect(() => {
    if (isAuthenticated) navigate(ROLE_HOME[role], { replace: true });
  }, [isAuthenticated, role, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Cấu hình máy chủ": the APK reaches the backend through a tunnel whose URL changes on
  // every restart, so the address is pasted here at runtime instead of baked into the build
  // (see config/serverUrl.ts + CAPACITOR-NOTES.md). Saving reloads so every module re-reads it.
  const [showServer, setShowServer] = useState(false);
  const [serverInput, setServerInput] = useState(getServerOverride());

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const success = await login(email, password);
      if (success) {
        const { value: userStr } = await Preferences.get({ key: "user" });
        const storedUser = JSON.parse(userStr || "{}");
        // Same role->home table the root redirect and session restore use, so the three
        // can never disagree about where a role's home screen is.
        navigate(landingPathFor(storedUser), { replace: true });
      } else {
        setError("Email hoặc mật khẩu không đúng");
      }
    } catch (err: any) {
      // AppContext's login() rethrows anything that isn't a real 401, so this branch means
      // rate-limit / network / server error — never mistake it for a wrong password.
      const status = err?.response?.status;
      if (status === 429) {
        // Server messages differ by which layer rate-limited (gateway sends plain text,
        // auth-service's own login limiter sends `{ error }` JSON with a retry countdown) —
        // surface it when it's a readable string, otherwise fall back to a generic message.
        const serverMessage =
          typeof err.response?.data === "string"
            ? err.response.data
            : err.response?.data?.error;
        setError(
          typeof serverMessage === "string" && serverMessage.length > 0
            ? serverMessage
            : "Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
        );
      } else {
        setError("Đã xảy ra lỗi. Vui lòng thử lại.");
      }
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
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(rgba(34,197,94,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.5) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="relative w-full max-w-4xl grid lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-zinc-800/60">
        {/* ── Left panel ── */}
        <div className="hidden lg:flex flex-col justify-between bg-zinc-900 p-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 via-emerald-400 to-green-600" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-green-500/8 rounded-full blur-3xl" />

          <div className="relative z-10">
            <AppLogo className="mb-8" imgClassName="h-28 w-44 object-left" />

            <h1 className="text-4xl font-bold leading-tight mb-4 text-white">
              Trợ lý tập luyện
              <br />
              <span className="text-green-400">thông minh của bạn</span>
            </h1>
            <p className="text-zinc-400 leading-relaxed">
              Kế hoạch tập luyện từ AI, phân tích InBody thời gian thực, và huấn
              luyện chuyên gia — tất cả trong một nền tảng.
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
                <span className="text-zinc-300 font-semibold">
                  Một tài khoản, nhiều vai trò.
                </span>{" "}
                Huấn luyện viên PT vẫn giữ toàn quyền theo dõi tập luyện cá
                nhân, đồng thời có không gian làm việc chuyên nghiệp — tất cả
                trong một nền tảng.
              </p>
            </div>
          </div>
        </div>

        {/* ── Right panel: form ── */}
        <div className="bg-zinc-900 p-8 sm:p-10 flex flex-col justify-center border-l border-zinc-800/60">
          {/* Mobile brand */}
          <AppLogo className="lg:hidden mb-6" imgClassName="h-16 w-32 object-left" />

          <h2 className="text-2xl font-bold text-zinc-100 mb-1">
            Chào mừng trở lại
          </h2>
          <p className="text-zinc-500 text-sm mb-6">
            Đăng nhập vào tài khoản của bạn để tiếp tục
          </p>

          {error && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 mb-6">
            <div>
              <label className="text-xs font-semibold text-zinc-400 mb-1.5 block uppercase tracking-wider">
                Địa chỉ email
              </label>
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
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Mật khẩu
                </label>
                <Link
                  to="/login"
                  className="text-xs text-green-400 hover:text-green-300 transition-colors"
                >
                  Quên mật khẩu?
                </Link>
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
                  {showPw ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/25 hover:shadow-green-500/40 hover:scale-[1.01] active:scale-[0.99]"
            >
              {loading ? "Đang đăng nhập..." : "Đăng nhập"}{" "}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="text-center text-sm text-zinc-500 mt-5">
            Chưa có tài khoản?{" "}
            <Link
              to="/register"
              className="text-green-400 font-semibold hover:text-green-300 transition-colors"
            >
              Tạo tài khoản
            </Link>
          </p>

          <div className="mt-5 pt-4 border-t border-zinc-800/60">
            <button
              type="button"
              onClick={() => setShowServer((v) => !v)}
              className="mx-auto flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <ServerCog className="w-3.5 h-3.5" /> Cấu hình máy chủ
            </button>

            {showServer && (
              <div className="mt-3 rounded-xl border border-zinc-800/60 bg-zinc-900/60 p-3">
                <label
                  htmlFor="server-url"
                  className="block text-[11px] font-semibold text-zinc-400 mb-1.5"
                >
                  Địa chỉ máy chủ
                </label>
                <input
                  id="server-url"
                  value={serverInput}
                  onChange={(e) => setServerInput(e.target.value)}
                  placeholder="https://vi-du.trycloudflare.com"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700/60 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
                />
                <p className="text-[11px] text-zinc-600 mt-2 leading-relaxed">
                  Dán địa chỉ đường hầm (Cloudflare) rồi bấm Lưu. Để trống rồi Lưu để quay về
                  địa chỉ mặc định của bản build.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setServerOverride(serverInput);
                    window.location.reload();
                  }}
                  className="mt-2 w-full py-2 rounded-lg bg-green-500 hover:bg-green-400 text-black text-sm font-bold transition-colors"
                >
                  Lưu và tải lại
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
