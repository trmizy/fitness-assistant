import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BuildingsIcon as Building2, CheckIcon as Check, XIcon as X, CircleNotchIcon as Loader2, MapPinIcon as MapPin, WarningIcon as AlertTriangle, StorefrontIcon as Store, PencilSimpleIcon as Pencil, MagnifyingGlassIcon as Search, NotePencilIcon as NotePencil, EyeIcon as Eye } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import type { Gym, GymBrand } from "../../types";
import { GymStatusPill } from "./shared/b9aStatusPill";
import { useRestoreFocus } from "./shared/b9aReturnFocus";
import { RequestChangesPanel } from "../../components/gym-management/RequestChangesPanel";
import { BranchReviewIssuesPanel } from "../../components/gym-management/BranchReviewIssuesPanel";
import { BranchReviewDetail } from "../../components/gym-management/BranchReviewDetail";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DEFAULT_GYM_TAB, GYM_TABS, parseGymTab, parseIdParam, shortRef, type GymTab } from "./shared/b9aUrlState";

/**
 * Vòng 4 / Phase C — there was no admin-facing gym/brand moderation screen at all before this
 * phase (confirmed by grep before building this: no page referenced PATCH /admin/gyms/:id/status
 * anywhere in the frontend). Four sections, each its own tab: first-time gym approval (C1's
 * "approving the brand's first branch" and C2's "gym's first name/address approval" both
 * piggyback on the same setGymStatus('APPROVED') call here — no separate action needed for
 * those); the dedicated gym rename/address approval (C2); the dedicated brand rename approval
 * (C1); and the PERMANENTLY_CLOSED actionable item (C3) — refunding still-ACTIVE memberships
 * there is NOT done here, it reuses the existing exceptional-refund action on AdminDashboard
 * (reason GYM_CLOSED) — this tab only surfaces which gyms need that.
 *
 * Follow-up: "Tất cả chi nhánh" lets admin edit any branch's own details directly. Creating a
 * NEW branch is deliberately still owner-only — a branch's owner already has a working
 * creation flow (MyGymsPage); admin creating one on their behalf was the one option NOT chosen
 * when this scope was confirmed.
 *
 * This page used to carry an "Owners" tab too (create a gym-owner account, list every
 * GYM_OWNER, suspend/reactivate, fix a name). It is gone: an account is a fact about a
 * PARTNER, and every one of those actions now lives on that partner's own profile in
 * AdminPartnersPage — provision, reset password, force logout, revoke, transfer ownership,
 * rename, plus suspend/terminate at the partner level. Splitting them across two pages meant
 * two different "đình chỉ" buttons with different meanings (auth-level disable vs the
 * partner's own suspendedAt), which is exactly the confusion this removal ends. Checked
 * against live data before removing: every ACTIVE GYM_OWNER has a gym_partner_accounts row,
 * so nothing became unmanageable — the only accounts the old tab could still reach were
 * already-disabled zzz-test-* leftovers.
 */

type Tab = GymTab;

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function AdminGymModeration() {
  // B9a: tab và chi nhánh đang xem chi tiết nằm trên URL (?tab=&id=).
  const [params, setParams] = useSearchParams();
  const tab: Tab = parseGymTab(params.get("tab"));
  const detailTargetId = parseIdParam(params.get("id"));
  const setTab = (next: Tab) => setParams(next === DEFAULT_GYM_TAB ? {} : { tab: next });
  const setDetailTargetId = (id: string | null) =>
    setParams(id ? { ...(tab === DEFAULT_GYM_TAB ? {} : { tab }), id } : tab === DEFAULT_GYM_TAB ? {} : { tab });
  const queryClient = useQueryClient();

  const { data: gyms = [], isLoading: gymsLoading, isError: gymsError, error: gymsErr, refetch: refetchGyms, dataUpdatedAt: gymsUpdatedAt } = useQuery<Gym[]>({
    queryKey: ["admin-gyms"],
    queryFn: () => adminService.listGymsForAdmin(),
  });
  const { data: brands = [], isLoading: brandsLoading, isError: brandsError, refetch: refetchBrands } = useQuery<GymBrand[]>({
    queryKey: ["admin-brands"],
    queryFn: () => adminService.listBrandsForAdmin(),
  });
  const { data: permanentlyClosed = [], isLoading: closedLoading, isError: closedError, refetch: refetchClosed } = useQuery<(Gym & { activeMembershipCount: number })[]>({
    queryKey: ["admin-gyms-permanently-closed"],
    queryFn: () => adminService.listPermanentlyClosedGyms(),
  });

  // Duyệt / từ chối chi nhánh đều phải xác nhận trước khi gửi. Backend (PATCH /admin/gyms/:id/status)
  // chỉ nhận { status } — chưa có trường lý do, nên chỉ xác nhận, không bắt nhập lý do.
  const [statusConfirm, setStatusConfirm] = useState<{ gym: Gym; status: "APPROVED" | "REJECTED" } | null>(null);

  useRestoreFocus(!!statusConfirm);
  const invalidateGyms = () => queryClient.invalidateQueries({ queryKey: ["admin-gyms"] });
  const invalidateBrands = () => queryClient.invalidateQueries({ queryKey: ["admin-brands"] });

  const setStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" | "SUSPENDED" }) => adminService.setGymStatus(id, status),
    onSuccess: () => {
      toast.success("Đã cập nhật trạng thái phòng gym");
      invalidateGyms();
      queryClient.invalidateQueries({ queryKey: ["admin-gyms-permanently-closed"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const approveGymRenameMutation = useMutation({
    mutationFn: (id: string) => adminService.approveGymRename(id),
    onSuccess: () => {
      toast.success("Đã duyệt tên/địa chỉ mới");
      invalidateGyms();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể duyệt"),
  });

  // GYM_MANAGEMENT master spec §60/§62 — "Yêu cầu chỉnh sửa" theo từng trường (Tên/Địa chỉ),
  // dùng cho một chi nhánh ĐÃ ĐƯỢC DUYỆT xin đổi tên/địa chỉ sau này — tab "gym-renames" dưới
  // đây, KHÔNG dùng trong tab "pending" nữa (xem BranchReviewIssuesPanel thay thế cho lần
  // duyệt đầu tiên qua wizard).
  const [requestChangesTargetId, setRequestChangesTargetId] = useState<string | null>(null);
  const requestChangesMutation = useMutation({
    mutationFn: (payload: { id: string; nameNote?: string; addressNote?: string }) =>
      adminService.requestGymChanges(payload.id, { nameNote: payload.nameNote, addressNote: payload.addressNote }),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu chỉnh sửa");
      setRequestChangesTargetId(null);
      invalidateGyms();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể gửi yêu cầu"),
  });

  // GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category on a branch's
  // first-time PENDING_REVIEW wizard submission (7 categories, sends it back to DRAFT). The
  // SEPARATE mechanism used in the "pending" tab below, replacing the old name/address-only
  // panel there — see gymBranchReviewService's own doc comment for why these are two
  // distinct mechanisms rather than one.
  const [branchReviewTargetId, setBranchReviewTargetId] = useState<string | null>(null);
  // GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace: everything the wizard
  // collected, shown before "Duyệt" is a blind click off a bare name/address card.
  const requestBranchChangesMutation = useMutation({
    mutationFn: (payload: { id: string; issues: { category: any; message: string }[] }) =>
      adminService.requestBranchChanges(payload.id, payload.issues),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu chỉnh sửa — chi nhánh chuyển về trạng thái Nháp cho chủ gym sửa lại");
      setBranchReviewTargetId(null);
      invalidateGyms();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể gửi yêu cầu"),
  });

  const approveBrandRenameMutation = useMutation({
    mutationFn: (id: string) => adminService.approveBrandRename(id),
    onSuccess: () => {
      toast.success("Đã duyệt tên thương hiệu mới");
      invalidateBrands();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể duyệt"),
  });

  const [editingGymId, setEditingGymId] = useState<string | null>(null);
  const [gymEditForm, setGymEditForm] = useState({ name: "", address: "", city: "", phone: "", email: "", description: "" });
  const [gymSearch, setGymSearch] = useState("");
  const updateGymMutation = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & typeof gymEditForm) => adminService.updateGymDetails(id, patch),
    onSuccess: () => {
      toast.success("Đã cập nhật thông tin chi nhánh");
      setEditingGymId(null);
      invalidateGyms();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const pendingGyms = gyms.filter((g) => g.status === "PENDING_REVIEW");
  const gymsWithPendingRename = gyms.filter((g) => g.status !== "PENDING_REVIEW" && (g.pendingName || g.pendingAddress));
  const brandsWithPendingRename = brands.filter((b) => b.pendingName);
  const filteredGyms = gyms.filter((g) => {
    const q = gymSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (g.approvedName ?? g.name).toLowerCase();
    const address = (g.approvedAddress ?? g.address).toLowerCase();
    return name.includes(q) || address.includes(q) || (g.city ?? "").toLowerCase().includes(q);
  });

  const unknownDetailId = tab === "pending" && !!detailTargetId && !gymsLoading && !gymsError && !pendingGyms.some((g) => g.id === detailTargetId);
  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "pending", label: "Chờ duyệt lần đầu", count: pendingGyms.length },
    { key: "gym-renames", label: "Đổi tên/địa chỉ gym", count: gymsWithPendingRename.length },
    { key: "brand-renames", label: "Đổi tên thương hiệu", count: brandsWithPendingRename.length },
    { key: "closed", label: "Đã đóng cửa vĩnh viễn", count: permanentlyClosed.filter((g) => g.activeMembershipCount > 0).length },
    { key: "all-gyms", label: "Tất cả chi nhánh", count: 0 },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Building2 className="w-5 h-5 text-st-success" /> Quản lý Gym
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Duyệt phòng gym mới, duyệt đổi tên/địa chỉ, duyệt đổi tên thương hiệu, sửa trực tiếp
          thông tin bất kỳ chi nhánh nào, và theo dõi các phòng gym đã đóng cửa vĩnh viễn còn
          hội viên đang hoạt động cần hoàn tiền. Mọi việc liên quan tới tài khoản chủ gym —
          tạo, đặt lại mật khẩu, thu hồi, chuyển quyền sở hữu — nằm ở trang Đối tác.
        </p>
      </div>

      {gymsUpdatedAt > 0 && (
        <p data-testid="admin-gym-updated" className="-mt-4 text-xs tabular-nums text-zinc-500">
          Cập nhật lúc {new Date(gymsUpdatedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      )}

      {unknownDetailId && (
        <div role="status" data-testid="admin-gym-unknown-id" className="rounded-xl border border-st-warning-border bg-st-warning-bg px-4 py-3 text-xs text-st-warning flex items-center justify-between gap-3">
          <span>Không tìm thấy chi nhánh <span className="font-mono">{shortRef(detailTargetId)}</span> trong danh sách chờ duyệt lần đầu — có thể đã được xử lý. Đang hiện danh sách.</span>
          <button onClick={() => setDetailTargetId(null)} className="font-bold underline shrink-0">Đóng</button>
        </div>
      )}

      <div data-testid="admin-gym-moderation-tabs" role="tablist" aria-label="Các mục kiểm duyệt chi nhánh" className="flex gap-1.5 flex-wrap border-b border-zinc-800/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`admin-gym-tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              tab === t.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-black/20" : "bg-amber-500/20 text-st-warning"}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={!!statusConfirm}
        onOpenChange={(o) => !o && setStatusConfirm(null)}
        title={statusConfirm?.status === "APPROVED" ? "Duyệt chi nhánh này?" : "Từ chối chi nhánh này?"}
        description={
          statusConfirm?.status === "APPROVED"
            ? `Chi nhánh "${statusConfirm?.gym.name}" sẽ được hiển thị công khai và nhận hội viên. Nếu là chi nhánh đầu tiên của thương hiệu thì tên thương hiệu cũng được duyệt theo.`
            : `Chi nhánh "${statusConfirm?.gym.name}" sẽ bị từ chối và không được hiển thị công khai. Chủ gym sẽ thấy trạng thái bị từ chối.`
        }
        confirmLabel={statusConfirm?.status === "APPROVED" ? "Duyệt" : "Từ chối"}
        danger={statusConfirm?.status === "REJECTED"}
        onConfirm={async () => {
          if (!statusConfirm) return;
          const { gym, status } = statusConfirm;
          try {
            await setStatusMutation.mutateAsync({ id: gym.id, status });
          } catch {
            /* onError của mutation đã hiện thông báo */
          }
          setStatusConfirm(null);
        }}
      />

      {tab === "pending" && (
        <div className="space-y-3">
          {gymsLoading ? (
            <ListSkeleton />
          ) : gymsError ? (
            <ErrorState error={gymsErr} onRetry={() => void refetchGyms()} />
          ) : pendingGyms.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đang chờ duyệt lần đầu." icon={Building2} />
          ) : (
            pendingGyms.map((g) => (
              <div key={g.id} data-testid="admin-gym-pending-card" data-gym-id={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{g.name}</p>
                    <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" /> {g.address}{g.city ? `, ${g.city}` : ""}</p>
                    {g.brand && (
                      <p className="text-[11px] text-zinc-600 mt-1">
                        Thương hiệu: {g.brand.name}
                        {g.brand.approvedName == null && <span className="text-st-warning font-semibold"> · chi nhánh đầu tiên, tên thương hiệu cũng đang chờ duyệt</span>}
                      </p>
                    )}
                  </div>
                  <GymStatusPill status={g.status} />
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    data-testid="admin-gym-view-detail-button"
                    onClick={() => setDetailTargetId(detailTargetId === g.id ? null : g.id)}
                    className="flex items-center gap-1 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" /> {detailTargetId === g.id ? "Ẩn chi tiết" : "Xem chi tiết"}
                  </button>
                  <button
                    data-testid="admin-gym-approve-button"
                    onClick={() => setStatusConfirm({ gym: g, status: "APPROVED" })}
                    disabled={setStatusMutation.isPending}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> Duyệt
                  </button>
                  <button
                    data-testid="admin-gym-request-changes-button"
                    onClick={() => setBranchReviewTargetId(branchReviewTargetId === g.id ? null : g.id)}
                    className="flex items-center gap-1 border border-amber-500/30 text-st-warning hover:bg-amber-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <NotePencil className="w-3.5 h-3.5" /> Yêu cầu chỉnh sửa
                  </button>
                  <button
                    data-testid="admin-gym-reject-button"
                    onClick={() => setStatusConfirm({ gym: g, status: "REJECTED" })}
                    disabled={setStatusMutation.isPending}
                    className="flex items-center gap-1 border border-red-500/30 text-st-danger hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Từ chối
                  </button>
                </div>

                {detailTargetId === g.id && (
                  <div data-testid="admin-gym-detail-panel" className="mt-3 border-t border-zinc-800/60 pt-3">
                    <BranchReviewDetail gym={g} />
                  </div>
                )}

                {branchReviewTargetId === g.id && (
                  <div className="mt-3 border-t border-zinc-800/60 pt-3">
                    <p className="text-[11px] text-zinc-500 mb-2">
                      Chi nhánh sẽ chuyển về trạng thái Nháp — chủ gym sửa lại đúng các mục dưới đây trong wizard rồi gửi lại.
                    </p>
                    <BranchReviewIssuesPanel
                      mode="compose"
                      onSubmit={(issues) => requestBranchChangesMutation.mutate({ id: g.id, issues })}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "gym-renames" && (
        <div className="space-y-3">
          {gymsLoading ? (
            <ListSkeleton />
          ) : gymsError ? (
            <ErrorState error={gymsErr} onRetry={() => void refetchGyms()} />
          ) : gymsWithPendingRename.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đang chờ duyệt đổi tên/địa chỉ." icon={Building2} />
          ) : (
            gymsWithPendingRename.map((g) => (
              <div key={g.id} data-testid="admin-gym-rename-card" data-gym-id={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                {g.pendingName && (
                  <div className="text-xs">
                    <span className="text-zinc-600">Tên hiện đang hiển thị: </span><span className="text-zinc-400">{g.approvedName ?? g.name}</span>
                    <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-st-warning font-semibold">{g.pendingName}</span>
                  </div>
                )}
                {g.pendingAddress && (
                  <div className="text-xs">
                    <span className="text-zinc-600">Địa chỉ hiện đang hiển thị: </span><span className="text-zinc-400">{g.approvedAddress ?? g.address}</span>
                    <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-st-warning font-semibold">{g.pendingAddress}</span>
                  </div>
                )}

                {g.changesRequestedAt && (
                  <RequestChangesPanel mode="view" nameNote={g.pendingNameNote} addressNote={g.pendingAddressNote} />
                )}

                <div className="flex gap-2 mt-1">
                  <button
                    data-testid="admin-gym-approve-rename-button"
                    onClick={() => approveGymRenameMutation.mutate(g.id)}
                    disabled={approveGymRenameMutation.isPending}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> Duyệt tên/địa chỉ mới
                  </button>
                  <button
                    onClick={() => setRequestChangesTargetId(requestChangesTargetId === g.id ? null : g.id)}
                    className="flex items-center gap-1 border border-amber-500/30 text-st-warning hover:bg-amber-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <NotePencil className="w-3.5 h-3.5" /> Yêu cầu chỉnh sửa
                  </button>
                </div>

                {requestChangesTargetId === g.id && (
                  <div className="mt-1 border-t border-zinc-800/60 pt-3">
                    <RequestChangesPanel mode="compose" onSubmit={(notes) => requestChangesMutation.mutate({ id: g.id, ...notes })} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "brand-renames" && (
        <div className="space-y-3">
          {brandsLoading ? (
            <ListSkeleton />
          ) : brandsError ? (
            <ErrorState error={undefined} onRetry={() => void refetchBrands()} />
          ) : brandsWithPendingRename.length === 0 ? (
            <EmptyState text="Không có thương hiệu nào đang chờ duyệt đổi tên." icon={Store} />
          ) : (
            brandsWithPendingRename.map((b) => (
              <div key={b.id} data-testid="admin-brand-rename-card" data-brand-id={b.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                <div className="text-xs">
                  <span className="text-zinc-600">Tên hiện đang hiển thị: </span>
                  <span className="text-zinc-400">{b.approvedName ?? "(chưa từng được duyệt)"}</span>
                  <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-st-warning font-semibold">{b.pendingName}</span>
                </div>
                <button
                  data-testid="admin-brand-approve-rename-button"
                  onClick={() => approveBrandRenameMutation.mutate(b.id)}
                  disabled={approveBrandRenameMutation.isPending}
                  className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                >
                  <Check className="w-3.5 h-3.5" /> Duyệt tên thương hiệu mới
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "closed" && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-600">
            Hoàn tiền cho hội viên còn hoạt động ở đây KHÔNG làm trực tiếp tại trang này — dùng
            hành động "Hoàn tiền" sẵn có (lý do "GYM_CLOSED") ở trang Dashboard cho từng hội
            viên. Trang này chỉ để biết phòng gym nào cần xử lý.
          </p>
          {closedLoading ? (
            <ListSkeleton />
          ) : closedError ? (
            <ErrorState error={undefined} onRetry={() => void refetchClosed()} />
          ) : permanentlyClosed.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đã đóng cửa vĩnh viễn." icon={AlertTriangle} />
          ) : (
            permanentlyClosed.map((g) => (
              <div key={g.id} data-testid="admin-gym-permanently-closed-card" data-gym-id={g.id} data-active-count={g.activeMembershipCount} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{g.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Đóng cửa lúc {formatDateTime(g.closedAt)}{g.closureReason ? ` — ${g.closureReason}` : ""}</p>
                  </div>
                  {g.activeMembershipCount > 0 ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/10 border-red-500/20 text-st-danger whitespace-nowrap flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {g.activeMembershipCount} hội viên cần hoàn tiền
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-zinc-700/50 border-zinc-700 text-zinc-400 whitespace-nowrap">Không còn hội viên hoạt động</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "all-gyms" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <input
              value={gymSearch}
              onChange={(e) => setGymSearch(e.target.value)}
              placeholder="Tìm theo tên, địa chỉ, thành phố..."
              className="flex-1 text-sm bg-transparent outline-none text-zinc-300 placeholder-zinc-600"
            />
          </div>
          {gymsLoading ? (
            <ListSkeleton />
          ) : gymsError ? (
            <ErrorState error={gymsErr} onRetry={() => void refetchGyms()} />
          ) : filteredGyms.length === 0 ? (
            <EmptyState text="Không tìm thấy chi nhánh nào." icon={Building2} />
          ) : (
            filteredGyms.map((g) => {
              const isEditingGym = editingGymId === g.id;
              return (
                <div key={g.id} data-testid="admin-all-gym-card" data-gym-id={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                  {isEditingGym ? (
                    <div className="space-y-2">
                      <input
                        value={gymEditForm.name}
                        onChange={(e) => setGymEditForm({ ...gymEditForm, name: e.target.value })}
                        placeholder="Tên chi nhánh"
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                      />
                      <input
                        value={gymEditForm.address}
                        onChange={(e) => setGymEditForm({ ...gymEditForm, address: e.target.value })}
                        placeholder="Địa chỉ"
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={gymEditForm.city}
                          onChange={(e) => setGymEditForm({ ...gymEditForm, city: e.target.value })}
                          placeholder="Thành phố"
                          className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                        />
                        <input
                          value={gymEditForm.phone}
                          onChange={(e) => setGymEditForm({ ...gymEditForm, phone: e.target.value })}
                          placeholder="SĐT"
                          className="px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                        />
                      </div>
                      <input
                        value={gymEditForm.email}
                        onChange={(e) => setGymEditForm({ ...gymEditForm, email: e.target.value })}
                        placeholder="Email"
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                      />
                      <textarea
                        value={gymEditForm.description}
                        onChange={(e) => setGymEditForm({ ...gymEditForm, description: e.target.value })}
                        placeholder="Mô tả"
                        rows={2}
                        className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none"
                      />
                      <div className="flex gap-2 pt-1">
                        <button
                          data-testid="admin-gym-save-edit-button"
                          onClick={() => updateGymMutation.mutate({ id: g.id, ...gymEditForm })}
                          disabled={!gymEditForm.name.trim() || !gymEditForm.address.trim() || updateGymMutation.isPending}
                          className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                        >
                          {updateGymMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Lưu
                        </button>
                        <button onClick={() => setEditingGymId(null)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                          Huỷ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-200">{g.approvedName ?? g.name}</p>
                          <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" /> {g.approvedAddress ?? g.address}
                            {g.city ? `, ${g.city}` : ""}
                          </p>
                          {(g.phone || g.email) && (
                            <p className="text-[11px] text-zinc-600 mt-1">
                              {g.phone}
                              {g.phone && g.email ? " · " : ""}
                              {g.email}
                            </p>
                          )}
                          {g.brand && <p className="text-[11px] text-zinc-600 mt-1">Thương hiệu: {g.brand.name}</p>}
                        </div>
                        <GymStatusPill status={g.status} />
                      </div>
                      <button
                        data-testid="admin-gym-edit-button"
                        onClick={() => {
                          setEditingGymId(g.id);
                          setGymEditForm({
                            name: g.approvedName ?? g.name,
                            address: g.approvedAddress ?? g.address,
                            city: g.city ?? "",
                            phone: g.phone ?? "",
                            email: g.email ?? "",
                            description: g.description ?? "",
                          });
                        }}
                        className="flex items-center gap-1 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Sửa thông tin
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div data-testid="admin-gym-skeleton" aria-busy="true" className="space-y-3">
      {[0, 1].map((i) => (
        <div key={i} className="h-24 rounded-xl border border-zinc-800/60 bg-zinc-900/60 animate-pulse motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function ErrorState({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  const forbidden = (error as { response?: { status?: number } } | null | undefined)?.response?.status === 403;
  return (
    <div role="alert" data-testid="admin-gym-load-error" className="bg-st-danger-bg border border-st-danger-border rounded-2xl py-10 text-center">
      <AlertTriangle className="w-8 h-8 text-st-danger mx-auto mb-2" />
      <p className="text-st-danger text-sm mb-3">{forbidden ? "Bạn không có quyền xem danh sách chi nhánh." : "Không tải được dữ liệu. Danh sách chưa thể hiển thị."}</p>
      <button onClick={onRetry} className="border border-st-danger-border text-st-danger hover:bg-st-danger-bg px-3 py-1.5 rounded-lg text-xs font-medium">
        Thử lại
      </button>
    </div>
  );
}

function EmptyState({ text, icon: Icon }: { text: string; icon: typeof Building2 }) {
  return (
    <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-16 text-center">
      <Icon className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
      <p className="text-zinc-600 text-sm">{text}</p>
    </div>
  );
}
