import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { useGymOwnerAccessState } from "../hooks/useGymOwnerAccessState";
import { APPLICANT_STATES } from "../services/partnerApplication";
import { PartnerAccessRevokedScreen, isPartnerAccessRevoked, revokedGymName } from "./PartnerAccessRevokedScreen";

function Splash() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
    </div>
  );
}

/** Chỉ cho ứng viên (chưa được duyệt) vào vùng /partner/application. Chủ gym đã duyệt được đưa về workspace của họ. */
export function RequirePartnerApplicant({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useGymOwnerAccessState();
  if (isLoading) return <Splash />;
  if (isError || !data) return <Navigate to="/login" replace />;
  if (!APPLICANT_STATES.includes(data.accessState)) return <Navigate to="/gym-owner/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Chặn ứng viên khỏi workspace vận hành /gym-owner/*. Lỗi tải trạng thái thì cho qua: chỉ là lớp
 * UX, backend vẫn từ chối mọi route vận hành với người chưa được duyệt.
 */
export function RequireApprovedPartner({ children }: { children: ReactNode }) {
  const { data, isLoading, error, refetch } = useGymOwnerAccessState();
  if (isLoading) return <Splash />;
  // Nhân viên đã bị thu hồi quyền: màn riêng thay vì cho vào để mọi trang con báo lỗi chung (N14G-07).
  if (isPartnerAccessRevoked(error)) return <PartnerAccessRevokedScreen gymName={revokedGymName(error)} onRetry={() => void refetch()} />;
  if (data && APPLICANT_STATES.includes(data.accessState)) return <Navigate to="/partner/application" replace />;
  return <>{children}</>;
}
