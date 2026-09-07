import { useState } from "react";
import { EyeIcon as Eye, EyeSlashIcon as EyeOff, KeyIcon as KeyRound, ArrowRightIcon as ArrowRight } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { authService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { AppLogo } from "../brand/AppLogo";

/**
 * Blocks the entire app behind this screen for an account still on its admin-issued random
 * temporary password (currently gym owners only — see auth.service.ts's
 * createGymOwnerAccount). Mounted in AppShell, in place of the normal shell, whenever
 * user.mustChangePassword is true — there is no way to dismiss or navigate around it, only
 * through it.
 *
 * Reuses the same PATCH /auth/me/password a voluntary settings-page password change already
 * uses; "current password" here is simply the temporary one the admin relayed. The server
 * clears mustChangePassword the moment ANY password change succeeds — updateUser mirrors that
 * locally right after, so the app unblocks immediately without needing a fresh login.
 */
export function ForceChangePasswordScreen() {
  const { updateUser, logout } = useApp();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => authService.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      updateUser({ mustChangePassword: false });
    },
    onError: (err: any) => {
      setError(
        err?.response?.data?.error || "Không thể đổi mật khẩu — kiểm tra lại mật khẩu tạm thời.",
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError("Mật khẩu mới phải có ít nhất 6 ký tự.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Xác nhận mật khẩu mới không khớp.");
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800/60 rounded-2xl shadow-2xl p-8">
        <AppLogo className="mb-6" imgClassName="h-14 w-28 object-left" />
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <KeyRound className="w-4 h-4 text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-zinc-100">Đổi mật khẩu để tiếp tục</h2>
        </div>
        <p className="text-zinc-500 text-sm mb-6">
          Tài khoản này đang dùng mật khẩu tạm thời do quản trị viên cấp. Hãy đặt mật khẩu mới
          trước khi sử dụng hệ thống.
        </p>

        {error && (
          <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block uppercase tracking-wider">
              Mật khẩu tạm thời
            </label>
            <input
              type={showPw ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
              placeholder="Mật khẩu quản trị viên đã cấp"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block uppercase tracking-wider">
              Mật khẩu mới
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 border border-zinc-700/60 rounded-xl text-sm bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
                placeholder="Ít nhất 6 ký tự"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block uppercase tracking-wider">
              Xác nhận mật khẩu mới
            </label>
            <input
              type={showPw ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-zinc-700/60 rounded-xl text-sm bg-zinc-800/60 text-zinc-200 placeholder-zinc-600 outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
              placeholder="Nhập lại mật khẩu mới"
              required
            />
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/25"
          >
            {mutation.isPending ? "Đang lưu..." : "Đổi mật khẩu"} <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 mt-5 transition-colors"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}
