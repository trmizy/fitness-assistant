import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon as Loader2, CheckCircleIcon as CheckCircle2, KeyIcon as KeyRound } from "@phosphor-icons/react";
import { api } from "../../services/api";

/**
 * Phase 2 mục 2.3 — quản trị viên bấm "Đặt lại mật khẩu" phát hành LINK (không bao giờ
 * gửi mật khẩu qua email); người cầm link tự đặt mật khẩu mới ở đây. Đứng ngoài AppShell —
 * xác thực đăng nhập không áp dụng, bằng chứng danh tính là chính token trong URL.
 */
export function PartnerPasswordResetPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/auth/password-reset", { token, newPassword: password });
      return data;
    },
    onSuccess: () => {
      setDone(true);
      toast.success("Đã đặt lại mật khẩu");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Liên kết không hợp lệ hoặc đã hết hạn"),
  });

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = password.length >= 8 && passwordsMatch;

  if (done) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
          <h1 className="text-lg font-bold text-zinc-100">Đã đặt lại mật khẩu</h1>
          <p className="text-sm text-zinc-500">Đăng nhập lại bằng mật khẩu mới của bạn.</p>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="w-full bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
          >
            Đến trang đăng nhập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-5">
        <div className="text-center">
          <KeyRound className="w-9 h-9 text-green-400 mx-auto mb-2" />
          <h1 className="text-lg font-bold text-zinc-100">Đặt mật khẩu mới</h1>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Mật khẩu mới * (tối thiểu 8 ký tự)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Nhập lại mật khẩu *</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
            />
            {confirmPassword.length > 0 && !passwordsMatch && <p className="text-[11px] text-red-400 mt-1">Mật khẩu không khớp</p>}
          </div>
          <button
            onClick={() => resetMutation.mutate()}
            disabled={!canSubmit || resetMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
          >
            {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Đặt mật khẩu mới
          </button>
        </div>
      </div>
    </div>
  );
}
