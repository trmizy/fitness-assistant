import type { ReactNode } from "react";
import { Link } from "react-router";
import { AppLogo } from "../../components/brand/AppLogo";

/** Khung chung cho các trang công khai của luồng đăng ký đối tác (chưa có tài khoản, đứng ngoài AppShell). */
export function PartnerApplyShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <AppLogo imgClassName="h-14 w-28" />
        </div>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-5">{children}</div>
        <div className="mt-4 text-center text-xs text-zinc-500">
          {footer ?? (
            <>
              Đã có tài khoản?{" "}
              <Link to="/login" className="text-green-400 hover:text-green-300">
                Đăng nhập
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
