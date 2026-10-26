import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserIcon, CheckIcon as Check, KeyIcon as KeyRound, SignOutIcon as LogOut, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import { authService } from "../../../services/api";
import { SectionCard } from "./components/SectionCard";

const inputClass =
  "w-full px-3 py-2 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 transition-all";

/**
 * Settings -> Account supports display-name edits and authenticated password
 * changes. Email change and full account deletion still need backend support;
 * Privacy & Data only handles scoped profile data today.
 */
export function AccountSection() {
  const { user, updateUser, logout } = useApp();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  const dirty =
    firstName !== (user?.firstName ?? "") || lastName !== (user?.lastName ?? "");

  const profileMutation = useMutation({
    mutationFn: () => authService.updateMe({ firstName, lastName }),
    onSuccess: () => {
      updateUser({ firstName, lastName });
      toast.success("Đã cập nhật tên hiển thị");
    },
    onError: () => toast.error("Không thể cập nhật — thử lại sau"),
  });

  const passwordMutation = useMutation({
    mutationFn: () =>
      authService.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Đã cập nhật mật khẩu");
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || "Không thể đổi mật khẩu — thử lại sau";
      toast.error(message);
    },
  });

  const canChangePassword =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !passwordMutation.isPending;

  return (
    <SectionCard
      id="account"
      icon={UserIcon}
      title="Tài khoản"
      description="Tên hiển thị, email, mật khẩu và đăng xuất"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-base font-bold text-black flex-shrink-0">
          {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-zinc-200 font-semibold truncate">
            {`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
              "Chưa đặt tên"}
          </p>
          <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
          <button
            type="button"
            onClick={() => navigate("/client/profile")}
            className="text-xs text-emerald-400 hover:text-emerald-300 mt-0.5"
          >
            Đổi ảnh đại diện trong Hồ sơ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11px] text-zinc-500 mb-1">Họ</span>
          <input
            data-testid="settings-account-lastname"
            className={inputClass}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-zinc-500 mb-1">Tên</span>
          <input
            data-testid="settings-account-firstname"
            className={inputClass}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-[11px] text-zinc-500 mb-1">Email</span>
        <input
          className={`${inputClass} opacity-60 cursor-not-allowed`}
          value={user?.email ?? ""}
          disabled
        />
        <span className="block text-[11px] text-zinc-600 mt-1">
          Chưa hỗ trợ đổi email trong phiên bản này.
        </span>
      </label>

      <button
        type="button"
        data-testid="settings-account-save"
        disabled={!dirty || profileMutation.isPending}
        onClick={() => profileMutation.mutate()}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {profileMutation.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
        Lưu thay đổi
      </button>

      <div className="space-y-3 pt-3 border-t border-zinc-800/60">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <KeyRound className="w-4 h-4 text-emerald-400" />
          Đổi mật khẩu
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="block text-[11px] text-zinc-500 mb-1">
              Mật khẩu hiện tại
            </span>
            <input
              data-testid="settings-account-current-password"
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-zinc-500 mb-1">
              Mật khẩu mới
            </span>
            <input
              data-testid="settings-account-new-password"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-zinc-500 mb-1">
              Xác nhận
            </span>
            <input
              data-testid="settings-account-confirm-password"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
        </div>
        {newPassword.length > 0 && newPassword.length < 8 ? (
          <p className="text-[11px] text-amber-300">
            Mật khẩu mới cần ít nhất 8 ký tự.
          </p>
        ) : null}
        {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
          <p className="text-[11px] text-amber-300">
            Xác nhận mật khẩu chưa khớp.
          </p>
        ) : null}
        <button
          type="button"
          data-testid="settings-account-change-password"
          disabled={!canChangePassword}
          onClick={() => passwordMutation.mutate()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-zinc-100 text-zinc-950 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {passwordMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <KeyRound className="w-4 h-4" />
          )}
          Đổi mật khẩu
        </button>
      </div>

      <div className="pt-2 border-t border-zinc-800/60">
        <button
          type="button"
          data-testid="settings-account-logout"
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Đăng xuất
        </button>
      </div>
    </SectionCard>
  );
}
