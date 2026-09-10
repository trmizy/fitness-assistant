import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon as Loader2, CheckCircleIcon as CheckCircle2, WarningIcon as AlertTriangle, HandshakeIcon as Handshake } from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";

const ROLE_LABEL: Record<string, string> = { OWNER: "Chủ sở hữu", MANAGER: "Quản lý chi nhánh" };

/**
 * Phase 3 — người nhận thư mời (chủ sở hữu lần đầu HOẶC quản lý chi nhánh mới) mở link,
 * tự đặt mật khẩu. Đứng ngoài AppShell — người này chưa có tài khoản nào để đăng nhập.
 */
export function PartnerInviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { login } = useApp();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const previewQuery = useQuery({
    queryKey: ["partner-invite-preview", token],
    queryFn: () => gymService.previewPartnerInvitation(token!),
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => gymService.acceptPartnerInvitation(token!, { password, firstName: firstName.trim(), lastName: lastName.trim() || undefined }),
    onSuccess: async () => {
      toast.success("Đã tạo tài khoản — đang đăng nhập...");
      try {
        const ok = await login(previewQuery.data.email, password);
        navigate(ok ? "/" : "/login", { replace: true });
      } catch {
        navigate("/login", { replace: true });
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể chấp nhận thư mời"),
  });

  if (previewQuery.isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (previewQuery.isError || !previewQuery.data) {
    const message = (previewQuery.error as any)?.response?.data?.error?.message || "Thư mời không hợp lệ hoặc đã hết hạn.";
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-bold text-zinc-100">Không thể mở thư mời</h1>
          <p className="text-sm text-zinc-500">{message}</p>
          <p className="text-xs text-zinc-600">Hãy liên hệ người đã gửi thư mời để được gửi lại.</p>
        </div>
      </div>
    );
  }

  const invite = previewQuery.data;
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit = firstName.trim().length > 0 && password.length >= 8 && passwordsMatch;

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-5">
        <div className="text-center">
          <Handshake className="w-9 h-9 text-green-400 mx-auto mb-2" />
          <h1 className="text-lg font-bold text-zinc-100">Lời mời đối tác phòng tập</h1>
          <p className="text-sm text-zinc-400 mt-1">
            <span className="text-zinc-200 font-semibold">{invite.partnerName}</span> mời bạn tham gia với vai trò{" "}
            <span className="text-green-400 font-semibold">{ROLE_LABEL[invite.role] ?? invite.role}</span>.
          </p>
          <p className="text-xs text-zinc-600 mt-1">Email: {invite.email}</p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Họ *</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Tên</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Đặt mật khẩu * (tối thiểu 8 ký tự)</label>
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
            onClick={() => acceptMutation.mutate()}
            disabled={!canSubmit || acceptMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
          >
            {acceptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Tạo tài khoản & tiếp tục
          </button>
        </div>
      </div>
    </div>
  );
}
