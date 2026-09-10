import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { KpiCard } from "../../components/ui/KpiCard";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/PageSkeleton";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ImpactDialog } from "../../components/ui/ImpactDialog";
import { DataTable } from "../../components/ui/DataTable";
import { SearchBar } from "../../components/ui/SearchBar";
import { FilterSheet } from "../../components/ui/FilterSheet";
import { StickyActionBar } from "../../components/ui/StickyActionBar";
import { Timeline, ActivityItem } from "../../components/ui/Timeline";
import { DetailSection, DetailRow } from "../../components/ui/DetailSection";
import { FormSection } from "../../components/ui/FormSection";
import { EntityCard } from "../../components/ui/EntityCard";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Input } from "../../components/ui/input";
import { PartnerStatusBadge, VerificationStatusBadge } from "../../components/gym-management/PartnerStatusBadge";
import { OperationalStatusBadge } from "../../components/gym-management/OperationalStatusBadge";
import { ModerationStatusBadge } from "../../components/gym-management/ModerationStatusBadge";
import { RoleChip } from "../../components/gym-management/RoleChip";
import { AccountRow } from "../../components/gym-management/AccountRow";
import { BranchSelector } from "../../components/gym-management/BranchSelector";
import { RequestChangesPanel } from "../../components/gym-management/RequestChangesPanel";
import { InviteAccountSheet } from "../../components/gym-management/InviteAccountSheet";
import {
  BuildingsIcon,
  CurrencyDollarIcon,
  WarningIcon,
  CheckCircleIcon,
  PencilSimpleIcon,
  ProhibitIcon,
} from "@phosphor-icons/react";

/**
 * GYM_MANAGEMENT master spec, Phase 2 — internal component showcase, not part of the app's
 * real navigation (no Sidebar entry, reachable only by direct URL). Exists purely to visually
 * verify the design-system foundation before Phase 3/4 wire it into real screens.
 */
export function GymManagementKitchenSink() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState<string | null>(null);

  // Dev-only page (same pattern as IconGalleryPage) — after the hooks, per Rules of Hooks.
  if (!import.meta.env.DEV) {
    return null;
  }

  const rows = [
    { id: "1", name: "Chi nhánh Quận 1", members: 240, revenue: "45.000.000đ", status: "APPROVED" },
    { id: "2", name: "Chi nhánh Quận 7", members: 95, revenue: "18.500.000đ", status: "PENDING_REVIEW" },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-color)] p-4 space-y-8 max-w-5xl mx-auto pb-24">
      <PageHeader
        title="Gym Management — Kitchen Sink"
        description="Phase 2: bộ component dùng chung, chưa nối vào màn hình thật nào."
        actions={<Button onClick={() => setInviteOpen(true)}>Mời quản lý</Button>}
      />

      <DetailSection title="Status badges — 4 trục độc lập">
        <div className="flex flex-wrap gap-2">
          <PartnerStatusBadge status="PROSPECT" />
          <PartnerStatusBadge status="INVITED" />
          <PartnerStatusBadge status="ACTIVE" />
          <PartnerStatusBadge status="SUSPENDED" />
          <PartnerStatusBadge status="TERMINATED" />
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <VerificationStatusBadge status="NOT_VERIFIED" />
          <VerificationStatusBadge status="IN_REVIEW" />
          <VerificationStatusBadge status="NEEDS_INFO" />
          <VerificationStatusBadge status="VERIFIED" />
          <VerificationStatusBadge status="REJECTED" />
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <ModerationStatusBadge status="PENDING_REVIEW" />
          <ModerationStatusBadge status="APPROVED" />
          <ModerationStatusBadge status="REJECTED" />
          <ModerationStatusBadge status="SUSPENDED" />
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <OperationalStatusBadge status="OPEN" />
          <OperationalStatusBadge status="TEMPORARILY_CLOSED" />
          <OperationalStatusBadge status="PERMANENTLY_CLOSED" />
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <RoleChip role="OWNER" />
          <RoleChip role="MANAGER" />
        </div>
      </DetailSection>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Tổng đối tác" value={128} icon={BuildingsIcon} tone="info" />
        <KpiCard label="Doanh thu tháng" value="4.2 tỷ" icon={CurrencyDollarIcon} tone="success" change="+12%" />
        <KpiCard label="Cần xem xét" value={7} icon={WarningIcon} tone="warning" />
        <KpiCard label="Đang tạm khoá" value={2} icon={ProhibitIcon} tone="danger" />
      </div>

      <DetailSection title="EntityCard">
        <div className="grid gap-3 sm:grid-cols-2">
          <EntityCard
            title="Chuỗi Fit Zone"
            subtitle="4 chi nhánh"
            badge={<PartnerStatusBadge status="ACTIVE" />}
            meta={[{ label: "Hội viên", value: 512 }, { label: "Doanh thu", value: "120.000.000đ" }]}
            onClick={() => {}}
          />
          <EntityCard
            title="Phòng gym Sức Sống"
            subtitle="1 chi nhánh"
            badge={<PartnerStatusBadge status="SUSPENDED" />}
            meta={[{ label: "Hội viên", value: 88 }]}
            onClick={() => {}}
          />
        </div>
      </DetailSection>

      <DetailSection title="DataTable (thu gọn thành card ở mobile)">
        <DataTable
          columns={[
            { key: "name", header: "Chi nhánh", render: (r) => r.name },
            { key: "members", header: "Hội viên", render: (r) => r.members, numeric: true },
            { key: "revenue", header: "Doanh thu", render: (r) => r.revenue, numeric: true },
            { key: "status", header: "Trạng thái", render: (r) => <ModerationStatusBadge status={r.status} /> },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </DetailSection>

      <DetailSection title="AccountRow">
        <div className="space-y-2">
          <AccountRow
            name="Nguyễn Minh"
            email="nguyen.minh@example.com"
            role="OWNER"
            status="ACTIVE"
            actions={<Button size="icon" variant="ghost"><PencilSimpleIcon className="size-4" /></Button>}
          />
          <AccountRow
            name="Trần Hoa"
            email="tran.hoa@example.com"
            role="MANAGER"
            status="ACTIVE"
            scopedBranchNames={["Chi nhánh Quận 1"]}
            actions={<Button size="icon" variant="ghost"><ProhibitIcon className="size-4" /></Button>}
          />
        </div>
      </DetailSection>

      <DetailSection title="Search + BranchSelector">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBar value={search} onChange={setSearch} className="sm:max-w-xs" />
          <BranchSelector
            branches={[
              { id: "b1", name: "Chi nhánh Quận 1", operationalStatus: "OPEN" },
              { id: "b2", name: "Chi nhánh Quận 7", operationalStatus: "TEMPORARILY_CLOSED" },
            ]}
            value={branch}
            onChange={setBranch}
            className="sm:max-w-xs"
          />
          <Button variant="outline" onClick={() => setFilterOpen(true)}>Bộ lọc</Button>
        </div>
      </DetailSection>

      <DetailSection title="RequestChangesPanel (view)">
        <RequestChangesPanel mode="view" nameNote="Trùng tên với thương hiệu khác" addressNote="Thiếu số nhà" />
      </DetailSection>

      <FormSection title="FormSection ví dụ">
        <div className="space-y-1.5">
          <Label htmlFor="ks-name">Tên pháp lý</Label>
          <Input id="ks-name" placeholder="Công ty TNHH..." />
        </div>
      </FormSection>

      <DetailSection title="Timeline">
        <Timeline>
          <ActivityItem icon={CheckCircleIcon} title="Admin duyệt chi nhánh Quận 1" timestamp="08:12, 08/09/2026" actor="admin@example.com" />
          <ActivityItem icon={PencilSimpleIcon} title="Chủ sở hữu cập nhật thông tin ngân hàng" timestamp="Hôm qua" isLast />
        </Timeline>
      </DetailSection>

      <DetailSection title="EmptyState / ErrorState / PageSkeleton">
        <div className="space-y-4">
          <EmptyState title="Không có hồ sơ nào đang chờ duyệt." tone="positive" />
          <EmptyState title="Bạn chưa có chi nhánh nào." description="Hãy tạo chi nhánh đầu tiên để bắt đầu vận hành." />
          <ErrorState kind="network" message="Không thể tải dữ liệu, vui lòng thử lại." onRetry={() => {}} />
          <PageSkeleton variant="list" rows={2} />
        </div>
      </DetailSection>

      <div className="flex gap-2">
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>Mở ConfirmDialog</Button>
        <Button variant="destructive" onClick={() => setImpactOpen(true)}>Mở ImpactDialog</Button>
      </div>

      <StickyActionBar>
        <Button variant="outline" className="flex-1">Huỷ</Button>
        <Button className="flex-1">Lưu thay đổi</Button>
      </StickyActionBar>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Thu hồi tài khoản?"
        description="Người này sẽ không thể đăng nhập nữa."
        confirmLabel="Thu hồi"
        onConfirm={() => setConfirmOpen(false)}
      />
      <ImpactDialog
        open={impactOpen}
        onOpenChange={setImpactOpen}
        title="Tạm khoá đối tác?"
        impact={[
          { label: "Tài khoản OWNER", value: "Không đăng nhập được", tone: "danger" },
          { label: "Tài khoản MANAGER", value: "Vẫn hoạt động", tone: "positive" },
          { label: "Số dư khả dụng bị đóng băng", value: "4.500.000đ", isNumeric: true },
        ]}
        confirmLabel="Tạm khoá"
        onConfirm={() => setImpactOpen(false)}
      />
      <FilterSheet open={filterOpen} onOpenChange={setFilterOpen} title="Lọc chi nhánh">
        <p className="text-sm text-zinc-400 py-4">Nội dung bộ lọc tuỳ trang.</p>
      </FilterSheet>
      <InviteAccountSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        branches={[{ id: "b1", name: "Chi nhánh Quận 1" }, { id: "b2", name: "Chi nhánh Quận 7" }]}
        onInvite={async () => {}}
      />
    </div>
  );
}

export default GymManagementKitchenSink;
