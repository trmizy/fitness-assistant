import { useEffect, useRef, type ReactNode } from "react";
import { Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleNotchIcon as Loader2, SignOutIcon as SignOut } from "@phosphor-icons/react";
import { AppLogo } from "../../components/brand/AppLogo";
import { useApp } from "../../context/AppContext";
import { useGymOwnerAccessState } from "../../hooks/useGymOwnerAccessState";
import { friendlyError, partnerApplication } from "../../services/partnerApplication";
import { ApplicationWizard } from "./ApplicationWizard";
import { RejectedView, SubmittedView } from "./StatusViews";
import { Card, PrimaryButton } from "./ui";

/**
 * Điểm vào duy nhất của ứng viên (/partner/application). Trạng thái hồ sơ từ server quyết định
 * hiển thị gì: đang soạn / cần sửa → wizard; đã gửi → theo dõi; bị từ chối → trang kết quả. Đứng
 * ngoài AppShell vận hành (ứng viên chưa có dashboard).
 */
export function PartnerApplicationPage() {
  const { user, logout } = useApp();
  const queryClient = useQueryClient();
  const userId = (user as { id?: string } | null)?.id ?? "anonymous";
  const access = useGymOwnerAccessState();
  const state = access.data?.accessState;

  // Tài khoản vừa tạo nhưng chưa có hồ sơ (vd tab bị đóng giữa chừng): hoàn tất bằng bootstrap idempotent.
  const bootstrap = useMutation({
    mutationFn: () => partnerApplication.bootstrap(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gym-owner-access-state", userId] }),
  });
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (state === "SETUP_INCOMPLETE" && !bootstrapped.current) {
      bootstrapped.current = true;
      bootstrap.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const viewQuery = useQuery({
    queryKey: ["partner-application", userId],
    queryFn: partnerApplication.get,
    enabled: state !== undefined && state !== "SETUP_INCOMPLETE",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["partner-application", userId] }),
      queryClient.invalidateQueries({ queryKey: ["gym-owner-access-state", userId] }),
      queryClient.invalidateQueries({ queryKey: ["partner-application-timeline"] }),
    ]);
  };

  let body: ReactNode;
  if (access.isLoading || (state === "SETUP_INCOMPLETE" && !bootstrap.isError)) {
    body = <Centered />;
  } else if (state === "SETUP_INCOMPLETE" && bootstrap.isError) {
    body = <ErrorCard message={friendlyError(bootstrap.error, "Không hoàn tất được việc tạo hồ sơ.").message} onRetry={() => bootstrap.mutate()} />;
  } else if (access.isError || !state) {
    body = <ErrorCard message="Không tải được trạng thái hồ sơ." onRetry={() => access.refetch()} />;
  } else if (state === "ACTIVE" || state === "LEGACY" || state === "APPROVED_PAYOUT_PENDING") {
    return <Navigate to="/gym-owner/dashboard" replace />;
  } else if (viewQuery.isLoading) {
    body = <Centered />;
  } else if (viewQuery.isError || !viewQuery.data) {
    body = <ErrorCard message={friendlyError(viewQuery.error, "Không tải được hồ sơ.").message} onRetry={() => viewQuery.refetch()} />;
  } else if (viewQuery.data.accessState === "UNDER_REVIEW") {
    body = <SubmittedView view={viewQuery.data} />;
  } else if (viewQuery.data.accessState === "REJECTED") {
    body = <RejectedView view={viewQuery.data} />;
  } else {
    // Wizard khởi tạo từ dữ liệu server; key theo trạng thái để CHANGES_REQUESTED ↔ ONBOARDING dựng lại sạch.
    body = <ApplicationWizard key={viewQuery.data.accessState} view={viewQuery.data} onChanged={refresh} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <AppLogo imgClassName="h-10 w-24 object-left" />
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-zinc-500 max-w-[200px] truncate">{(user as { email?: string } | null)?.email}</span>
            <button onClick={() => logout()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600">
              <SignOut className="w-3.5 h-3.5" /> Đăng xuất
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{body}</main>
    </div>
  );
}

function Centered() {
  return (
    <div className="py-24 flex justify-center">
      <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto max-w-md text-center space-y-3">
      <p className="text-sm text-zinc-300">{message}</p>
      <PrimaryButton onClick={onRetry}>Thử lại</PrimaryButton>
    </Card>
  );
}
