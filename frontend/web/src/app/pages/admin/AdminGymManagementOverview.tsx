import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  BuildingsIcon,
  StorefrontIcon,
  ProhibitIcon,
  WarningCircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  ArchiveIcon,
} from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { PageHeader } from "../../components/ui/PageHeader";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { EntityCard } from "../../components/ui/EntityCard";

/**
 * GYM_MANAGEMENT master spec §61/§66 — "Admin opens Gym Management overview, sees the work
 * queue first." The Needs Attention action center renders ABOVE the KPI row on purpose
 * (§61) — an admin should see what needs doing before a wall of numbers, not after.
 */
export function AdminGymManagementOverview() {
  const navigate = useNavigate();
  const overviewQuery = useQuery({
    queryKey: ["admin-gym-management-overview"],
    queryFn: () => adminService.getGymManagementOverview(),
  });

  if (overviewQuery.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
        <PageSkeleton variant="detail" />
      </div>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <ErrorState kind="server" message="Không thể tải tổng quan quản lý gym." onRetry={() => overviewQuery.refetch()} />
      </div>
    );
  }

  const stats = overviewQuery.data;
  const q = stats.needsAttention;

  const attentionItems = [
    {
      key: "pendingProspects",
      count: q.pendingProspects,
      title: "Hồ sơ tiềm năng chưa xem",
      icon: MagnifyingGlassIcon,
      to: "/admin/partners",
    },
    {
      key: "pendingVerification",
      count: q.pendingVerification,
      title: "Đang thẩm định / chờ bổ sung hồ sơ",
      icon: WarningCircleIcon,
      to: "/admin/partners",
    },
    {
      key: "pendingGyms",
      count: q.pendingGyms,
      title: "Chi nhánh chờ duyệt lần đầu",
      icon: BuildingsIcon,
      to: "/admin/gyms",
    },
    {
      key: "pendingBranchChanges",
      count: q.pendingBranchChanges,
      title: "Chi nhánh đang chờ chủ gym sửa lại theo yêu cầu",
      icon: NotePencilIcon,
      to: "/admin/gyms",
    },
    {
      key: "pendingBrandRenames",
      count: q.pendingBrandRenames,
      title: "Thương hiệu chờ duyệt đổi tên",
      icon: StorefrontIcon,
      to: "/admin/gyms",
    },
    {
      key: "invitedTooLong",
      count: q.invitedTooLong,
      title: "Thư mời OWNER quá 7 ngày chưa được nhận",
      icon: ClockIcon,
      to: "/admin/partners",
    },
    {
      key: "expiringDocs",
      count: q.expiringDocs,
      title: "Giấy tờ sắp hết hạn (trong 30 ngày)",
      icon: WarningCircleIcon,
      to: "/admin/partners",
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Tổng quan quản lý Gym" description="Đối tác phòng tập, chi nhánh, và những việc cần admin xử lý." />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Cần chú ý</h2>
        {attentionItems.length === 0 ? (
          <EmptyState title="Không có việc nào đang chờ xử lý." tone="positive" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {attentionItems.map((item) => (
              <EntityCard
                key={item.key}
                title={item.title}
                subtitle={`${item.count} mục`}
                badge={<item.icon className="size-4 text-amber-400" />}
                onClick={() => navigate(item.to)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Chỉ số chung</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Tổng đối tác" value={stats.totalPartners} icon={StorefrontIcon} tone="info" />
          <KpiCard label="Đối tác hoạt động" value={stats.activePartners} icon={BuildingsIcon} tone="success" />
          <KpiCard label="Đối tác đang tạm khoá" value={stats.suspendedPartners} icon={ProhibitIcon} tone="danger" />
          <KpiCard label="Đã chấm dứt hợp tác" value={stats.terminatedPartners} icon={ArchiveIcon} tone="neutral" />
          <KpiCard label="Chi nhánh đã duyệt" value={stats.totalBranches} icon={BuildingsIcon} tone="success" />
          <KpiCard label="Chi nhánh chờ duyệt" value={stats.pendingBranches} icon={ClockIcon} tone="warning" />
          <KpiCard label="Chi nhánh tạm đóng cửa" value={stats.temporarilyClosedBranches} icon={ProhibitIcon} tone="warning" />
        </div>
      </section>
    </div>
  );
}

export default AdminGymManagementOverview;
