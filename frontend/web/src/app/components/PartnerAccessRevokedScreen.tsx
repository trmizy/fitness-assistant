import { ProhibitIcon as Prohibit, SignOutIcon as SignOut, ArrowClockwiseIcon as Retry } from "@phosphor-icons/react";
import { useApp } from "../context/AppContext";

/** Lỗi 403 mà gym-service trả cho tài khoản nhân viên đã bị chủ phòng gym thu hồi quyền. */
export function isPartnerAccessRevoked(error: unknown): boolean {
  return (error as { response?: { data?: { error?: { code?: string } } } } | null)?.response?.data?.error?.code === "PARTNER_ACCESS_REVOKED";
}

export function revokedGymName(error: unknown): string | null {
  const name = (error as { response?: { data?: { error?: { gymName?: unknown } } } } | null)?.response?.data?.error?.gymName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * N14G-07 / Q9: nhân viên (lễ tân, kế toán, quản lý) bị thu hồi quyền vẫn đăng nhập được vì tài khoản còn
 * tồn tại — thay vì màn lỗi chung "không xác định được vai trò", nói rõ chuyện gì đã xảy ra và làm gì tiếp.
 * Đứng riêng (không có thanh điều hướng): mọi trang bên trong đều sẽ nhận 403 như nhau.
 */
export function PartnerAccessRevokedScreen({ gymName, onRetry }: { gymName?: string | null; onRetry?: () => void }) {
  const { logout } = useApp();
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-zinc-950" data-testid="partner-access-revoked">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-zinc-800/60 bg-zinc-900 p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <Prohibit className="h-6 w-6 text-amber-400" />
        </div>
        <h1 className="text-lg font-bold text-zinc-100">
          Quyền truy cập của bạn tại {gymName ? <span className="text-green-400">{gymName}</span> : "phòng gym này"} đã bị thu hồi
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Chủ phòng gym đã gỡ quyền của tài khoản này nên bạn không thể xem hay thao tác dữ liệu của phòng gym nữa.
          Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ trực tiếp chủ phòng gym để được cấp lại quyền.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => void logout()}
            data-testid="partner-access-revoked-logout"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-green-500 px-5 py-2.5 text-sm font-bold text-black transition-all hover:bg-green-400"
          >
            <SignOut className="h-4 w-4" /> Đăng xuất
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              <Retry className="h-4 w-4" /> Kiểm tra lại
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
