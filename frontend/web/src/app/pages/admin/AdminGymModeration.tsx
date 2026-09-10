import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BuildingsIcon as Building2, CheckIcon as Check, XIcon as X, CircleNotchIcon as Loader2, MapPinIcon as MapPin, WarningIcon as AlertTriangle, StorefrontIcon as Store, UserPlusIcon as UserPlus, CopyIcon as Copy, PencilSimpleIcon as Pencil, ProhibitIcon as Ban, ArrowCounterClockwiseIcon as RotateCcw, MagnifyingGlassIcon as Search, NotePencilIcon as NotePencil, EyeIcon as Eye } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import type { Gym, GymBrand } from "../../types";
import { ModerationStatusBadge } from "../../components/gym-management/ModerationStatusBadge";
import { RequestChangesPanel } from "../../components/gym-management/RequestChangesPanel";
import { BranchReviewIssuesPanel } from "../../components/gym-management/BranchReviewIssuesPanel";
import { BranchReviewDetail } from "../../components/gym-management/BranchReviewDetail";

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
 * Follow-up: admin could only CREATE an owner account and only SUSPEND a branch's status —
 * no edit/suspend for owners, no edit/create for branches, an asymmetry the owner of this app
 * pointed out directly. "Owners" tab now also lists every GYM_OWNER account with
 * suspend/reactivate (wired to the disable/enable endpoint that already existed but had no
 * caller anywhere in the frontend) and a name fix; "Tất cả chi nhánh" lets admin edit any
 * branch's own details directly. Creating a NEW branch is deliberately still owner-only —
 * unlike an owner account (which genuinely has no self-service creation path), a branch's
 * owner already has a working creation flow (MyGymsPage); admin creating one on their behalf
 * was the one option NOT chosen when this scope was confirmed.
 */

type Tab = "owners" | "pending" | "gym-renames" | "brand-renames" | "closed" | "all-gyms";

interface GymOwnerAccount {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive?: boolean;
  createdAt: string;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function AdminGymModeration() {
  const [tab, setTab] = useState<Tab>("pending");
  const queryClient = useQueryClient();

  // No self-registration path for GYM_OWNER (see authService.createGymOwnerAccount's doc
  // comment) — this is the only place that account gets created. The random temporary
  // password only ever comes back in THIS mutation's response, once; there is nowhere in the
  // app to look it up again afterward, so it stays on screen (copyable) until the admin
  // starts a new one.
  const [ownerForm, setOwnerForm] = useState({ email: "", firstName: "", lastName: "" });
  const [createdOwner, setCreatedOwner] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const createOwnerMutation = useMutation({
    mutationFn: () =>
      adminService.createGymOwner({
        email: ownerForm.email.trim(),
        firstName: ownerForm.firstName.trim(),
        lastName: ownerForm.lastName.trim() || undefined,
      }),
    onSuccess: (data: any) => {
      toast.success("Đã tạo tài khoản chủ gym");
      setCreatedOwner({ email: data.user.email, temporaryPassword: data.temporaryPassword });
      setOwnerForm({ email: "", firstName: "", lastName: "" });
      // Bug found live-testing this: the new account didn't appear in "Danh sách tài khoản
      // Owner" below until a manual page refresh — this mutation never invalidated that list.
      queryClient.invalidateQueries({ queryKey: ["admin-gym-owners"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể tạo tài khoản"),
  });

  const { data: owners = [], isLoading: ownersLoading } = useQuery<GymOwnerAccount[]>({
    queryKey: ["admin-gym-owners"],
    queryFn: () => adminService.listGymOwners(),
  });
  const invalidateOwners = () => queryClient.invalidateQueries({ queryKey: ["admin-gym-owners"] });

  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null);
  const [ownerEditForm, setOwnerEditForm] = useState({ firstName: "", lastName: "" });
  const updateOwnerNameMutation = useMutation({
    mutationFn: ({ id, firstName, lastName }: { id: string; firstName: string; lastName?: string }) =>
      adminService.updateGymOwnerName(id, { firstName, lastName }),
    onSuccess: () => {
      toast.success("Đã cập nhật tên chủ gym");
      setEditingOwnerId(null);
      invalidateOwners();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });
  const setOwnerActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminService.setGymOwnerActive(id, isActive),
    onSuccess: (_data, vars) => {
      toast.success(vars.isActive ? "Đã kích hoạt lại tài khoản" : "Đã đình chỉ tài khoản");
      invalidateOwners();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const { data: gyms = [], isLoading: gymsLoading } = useQuery<Gym[]>({
    queryKey: ["admin-gyms"],
    queryFn: () => adminService.listGymsForAdmin(),
  });
  const { data: brands = [], isLoading: brandsLoading } = useQuery<GymBrand[]>({
    queryKey: ["admin-brands"],
    queryFn: () => adminService.listBrandsForAdmin(),
  });
  const { data: permanentlyClosed = [], isLoading: closedLoading } = useQuery<(Gym & { activeMembershipCount: number })[]>({
    queryKey: ["admin-gyms-permanently-closed"],
    queryFn: () => adminService.listPermanentlyClosedGyms(),
  });

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
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
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

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "owners", label: "Owners", count: 0 },
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
          <Building2 className="w-5 h-5 text-green-400" /> Quản lý gym & owner
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tạo, đổi tên, đình chỉ/kích hoạt lại tài khoản đối tác chủ gym (không có đăng ký tự
          do — liên hệ ngoài ứng dụng trước, admin tạo tài khoản ở đây); duyệt phòng gym mới,
          duyệt đổi tên/địa chỉ, duyệt đổi tên thương hiệu, sửa trực tiếp thông tin bất kỳ chi
          nhánh nào, và theo dõi các phòng gym đã đóng cửa vĩnh viễn còn hội viên đang hoạt
          động cần hoàn tiền.
        </p>
      </div>

      <div data-testid="admin-gym-moderation-tabs" className="flex gap-1.5 flex-wrap border-b border-zinc-800/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`admin-gym-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              tab === t.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-black/20" : "bg-amber-500/20 text-amber-400"}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "owners" && (
        <div className="space-y-8">
        <div className="max-w-md space-y-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Không có luồng tự đăng ký làm chủ gym — đối tác liên hệ trực tiếp (email/điện
            thoại) ngoài ứng dụng, admin tạo tài khoản ở đây với mật khẩu ngẫu nhiên, rồi tự
            gửi lại cho họ qua đúng kênh đã liên hệ. Đăng nhập lần đầu sẽ bị buộc đổi mật khẩu
            trước khi dùng được gì khác.
          </p>

          {createdOwner ? (
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-green-400">
                <Check className="w-4 h-4" /> Đã tạo tài khoản cho {createdOwner.email}
              </div>
              <div>
                <label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1">
                  Mật khẩu tạm thời — chỉ hiện đúng 1 lần, hãy gửi ngay
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-amber-400 font-mono">
                    {createdOwner.temporaryPassword}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(createdOwner.temporaryPassword).catch(() => {});
                      toast.success("Đã sao chép");
                    }}
                    className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors shrink-0"
                    title="Sao chép"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCreatedOwner(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Tạo tài khoản khác
              </button>
            </div>
          ) : (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1.5 block">Email *</label>
                <input
                  value={ownerForm.email}
                  onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })}
                  placeholder="chusohuu@example.com"
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1.5 block">Họ *</label>
                <input
                  value={ownerForm.firstName}
                  onChange={(e) => setOwnerForm({ ...ownerForm, firstName: e.target.value })}
                  placeholder="Nguyễn Văn"
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1.5 block">Tên (tuỳ chọn)</label>
                <input
                  value={ownerForm.lastName}
                  onChange={(e) => setOwnerForm({ ...ownerForm, lastName: e.target.value })}
                  placeholder="A"
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
                />
              </div>
              <button
                type="button"
                onClick={() => createOwnerMutation.mutate()}
                disabled={!ownerForm.email.trim() || !ownerForm.firstName.trim() || createOwnerMutation.isPending}
                className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
              >
                {createOwnerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Tạo tài khoản
              </button>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-bold text-zinc-200 mb-3">Danh sách tài khoản Owner</h3>
          {ownersLoading ? (
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : owners.length === 0 ? (
            <EmptyState text="Chưa có tài khoản chủ gym nào." icon={UserPlus} />
          ) : (
            <div className="space-y-3">
              {owners.map((o) => {
                const name = [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email;
                const isEditingOwner = editingOwnerId === o.id;
                const isSuspended = o.isActive === false;
                return (
                  <div key={o.id} data-testid="admin-owner-card" data-owner-id={o.id} data-active={String(!isSuspended)} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {isEditingOwner ? (
                          <div className="flex gap-2 mb-1.5">
                            <input
                              value={ownerEditForm.firstName}
                              onChange={(e) => setOwnerEditForm({ ...ownerEditForm, firstName: e.target.value })}
                              placeholder="Họ"
                              className="w-1/2 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                            />
                            <input
                              value={ownerEditForm.lastName}
                              onChange={(e) => setOwnerEditForm({ ...ownerEditForm, lastName: e.target.value })}
                              placeholder="Tên"
                              className="w-1/2 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                            />
                          </div>
                        ) : (
                          <p className="text-sm font-semibold text-zinc-200 truncate">{name}</p>
                        )}
                        <p className="text-xs text-zinc-500 truncate">{o.email}</p>
                        <p className="text-[11px] text-zinc-600 mt-0.5">Tạo lúc {formatDateTime(o.createdAt)}</p>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                          isSuspended ? "bg-zinc-700/50 border-zinc-700 text-zinc-400" : "bg-green-500/10 border-green-500/20 text-green-400"
                        }`}
                      >
                        {isSuspended ? "Đã đình chỉ" : "Đang hoạt động"}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {isEditingOwner ? (
                        <>
                          <button
                            data-testid="admin-owner-save-name-button"
                            onClick={() =>
                              updateOwnerNameMutation.mutate({
                                id: o.id,
                                firstName: ownerEditForm.firstName.trim(),
                                lastName: ownerEditForm.lastName.trim() || undefined,
                              })
                            }
                            disabled={!ownerEditForm.firstName.trim() || updateOwnerNameMutation.isPending}
                            className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                          >
                            <Check className="w-3.5 h-3.5" /> Lưu
                          </button>
                          <button
                            onClick={() => setEditingOwnerId(null)}
                            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                          >
                            Huỷ
                          </button>
                        </>
                      ) : (
                        <button
                          data-testid="admin-owner-edit-name-button"
                          onClick={() => {
                            setEditingOwnerId(o.id);
                            setOwnerEditForm({ firstName: o.firstName ?? "", lastName: o.lastName ?? "" });
                          }}
                          className="flex items-center gap-1 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Sửa tên
                        </button>
                      )}
                      <button
                        data-testid={isSuspended ? "admin-owner-reactivate-button" : "admin-owner-suspend-button"}
                        onClick={() => setOwnerActiveMutation.mutate({ id: o.id, isActive: isSuspended })}
                        disabled={setOwnerActiveMutation.isPending}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isSuspended
                            ? "border border-green-500/30 text-green-400 hover:bg-green-500/10"
                            : "border border-red-500/30 text-red-400 hover:bg-red-500/10"
                        }`}
                      >
                        {isSuspended ? <RotateCcw className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        {isSuspended ? "Kích hoạt lại" : "Đình chỉ"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      )}

      {tab === "pending" && (
        <div className="space-y-3">
          {gymsLoading ? (
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
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
                        {g.brand.approvedName == null && <span className="text-amber-400 font-semibold"> · chi nhánh đầu tiên, tên thương hiệu cũng đang chờ duyệt</span>}
                      </p>
                    )}
                  </div>
                  <ModerationStatusBadge status={g.status} />
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    data-testid="admin-gym-view-detail-button"
                    onClick={() => setDetailTargetId(detailTargetId === g.id ? null : g.id)}
                    className="flex items-center gap-1 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" /> {detailTargetId === g.id ? "Ẩn chi tiết" : "Xem chi tiết"}
                  </button>
                  <button
                    data-testid="admin-gym-approve-button"
                    onClick={() => setStatusMutation.mutate({ id: g.id, status: "APPROVED" })}
                    disabled={setStatusMutation.isPending}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Check className="w-3.5 h-3.5" /> Duyệt
                  </button>
                  <button
                    data-testid="admin-gym-request-changes-button"
                    onClick={() => setBranchReviewTargetId(branchReviewTargetId === g.id ? null : g.id)}
                    className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <NotePencil className="w-3.5 h-3.5" /> Yêu cầu chỉnh sửa
                  </button>
                  <button
                    data-testid="admin-gym-reject-button"
                    onClick={() => setStatusMutation.mutate({ id: g.id, status: "REJECTED" })}
                    disabled={setStatusMutation.isPending}
                    className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
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
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : gymsWithPendingRename.length === 0 ? (
            <EmptyState text="Không có phòng gym nào đang chờ duyệt đổi tên/địa chỉ." icon={Building2} />
          ) : (
            gymsWithPendingRename.map((g) => (
              <div key={g.id} data-testid="admin-gym-rename-card" data-gym-id={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                {g.pendingName && (
                  <div className="text-xs">
                    <span className="text-zinc-600">Tên hiện đang hiển thị: </span><span className="text-zinc-400">{g.approvedName ?? g.name}</span>
                    <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-amber-400 font-semibold">{g.pendingName}</span>
                  </div>
                )}
                {g.pendingAddress && (
                  <div className="text-xs">
                    <span className="text-zinc-600">Địa chỉ hiện đang hiển thị: </span><span className="text-zinc-400">{g.approvedAddress ?? g.address}</span>
                    <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-amber-400 font-semibold">{g.pendingAddress}</span>
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
                    className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
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
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
          ) : brandsWithPendingRename.length === 0 ? (
            <EmptyState text="Không có thương hiệu nào đang chờ duyệt đổi tên." icon={Store} />
          ) : (
            brandsWithPendingRename.map((b) => (
              <div key={b.id} data-testid="admin-brand-rename-card" data-brand-id={b.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2">
                <div className="text-xs">
                  <span className="text-zinc-600">Tên hiện đang hiển thị: </span>
                  <span className="text-zinc-400">{b.approvedName ?? "(chưa từng được duyệt)"}</span>
                  <span className="text-zinc-600"> → chờ duyệt: </span><span className="text-amber-400 font-semibold">{b.pendingName}</span>
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
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
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
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/10 border-red-500/20 text-red-400 whitespace-nowrap flex items-center gap-1">
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
            <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
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
                        <ModerationStatusBadge status={g.status} />
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

function EmptyState({ text, icon: Icon }: { text: string; icon: typeof Building2 }) {
  return (
    <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-16 text-center">
      <Icon className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
      <p className="text-zinc-600 text-sm">{text}</p>
    </div>
  );
}
