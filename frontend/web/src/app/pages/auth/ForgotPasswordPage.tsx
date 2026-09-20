import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CircleNotchIcon as Loader2,
  EnvelopeSimpleIcon as Mail,
  EnvelopeOpenIcon as MailOpen,
  KeyIcon as KeyRound,
} from "@phosphor-icons/react";
import { authService } from "../../services/api";

/** Mirrors auth-service's per-account cooldown, so the button never invites a request the server
 *  would quietly ignore. */
const RESEND_AFTER_SECONDS = 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Self-service "Quên mật khẩu" (MOBILE_BACKEND_GAPS.md GAP-4). Before this, the login page's link
 * pointed back at /login because no endpoint let a user ask for a reset for their own email.
 *
 * The user asks for a reset LINK — never a password. The emailed link opens the existing
 * /dat-lai-mat-khau/:token page (PartnerPasswordResetPage), which already calls
 * POST /auth/password-reset, so the step that actually changes a password is the same one
 * admin-issued partner links use.
 *
 * The confirmation is deliberately conditional ("nếu email này có tài khoản"): the server answers
 * identically for every address so nobody can probe which emails are registered, and this page must
 * not undo that by claiming more than the server knows it did.
 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const requestMutation = useMutation({
    mutationFn: (target: string) => authService.requestPasswordReset(target),
    onSuccess: (_data, target) => {
      setSentTo(target);
      setCooldown(RESEND_AFTER_SECONDS);
    },
    onError: (e: any) =>
      toast.error(
        e?.response ? e.response.data?.error || "Không gửi được yêu cầu" : "Không kết nối được máy chủ",
      ),
  });

  const submit = (target: string) => {
    const trimmed = target.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      toast.error("Email không hợp lệ");
      return;
    }
    requestMutation.mutate(trimmed);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-5">
        {sentTo === null ? (
          <>
            <div className="text-center">
              <KeyRound className="w-9 h-9 text-green-400 mx-auto mb-2" />
              <h1 className="text-lg font-bold text-zinc-100">Quên mật khẩu</h1>
              <p className="text-sm text-zinc-500 mt-1">
                Nhập email bạn dùng để đăng nhập. Chúng tôi sẽ gửi một liên kết để bạn đặt mật khẩu mới.
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit(email);
              }}
            >
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Địa chỉ email"
                  className="w-full pl-10 pr-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                />
              </div>
              <button
                type="submit"
                disabled={requestMutation.isPending}
                className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
              >
                {requestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Gửi liên kết đặt lại
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="text-center space-y-2">
              <MailOpen className="w-10 h-10 text-green-400 mx-auto" />
              <h1 className="text-lg font-bold text-zinc-100">Kiểm tra hộp thư</h1>
              <p className="text-sm text-zinc-500">
                Nếu <span className="text-zinc-200 font-semibold">{sentTo}</span> có tài khoản, chúng tôi đã
                gửi một liên kết đặt lại mật khẩu. Liên kết có hiệu lực 60 phút và chỉ dùng được một lần.
              </p>
            </div>
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="w-full bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              Về trang đăng nhập
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() => submit(sentTo)}
                disabled={requestMutation.isPending || cooldown > 0}
                className="text-zinc-400 hover:text-green-400 disabled:text-zinc-600 transition-colors"
              >
                {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : "Gửi lại email"}
              </button>
              <button
                onClick={() => {
                  setSentTo(null);
                  setCooldown(0);
                }}
                className="text-zinc-400 hover:text-green-400 transition-colors"
              >
                Dùng email khác
              </button>
            </div>
          </>
        )}
        <p className="text-center text-xs text-zinc-600">
          Nhớ ra mật khẩu?{" "}
          <Link to="/login" className="text-green-500 font-semibold hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  );
}
