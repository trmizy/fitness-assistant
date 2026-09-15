import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  HandshakeIcon as Handshake,
  MagnifyingGlassIcon as Search,
  PlusIcon as Plus,
  CircleNotchIcon as Loader2,
  CaretRightIcon as ChevronRight,
  ArrowLeftIcon as ArrowLeft,
  DotsThreeVerticalIcon as MoreVertical,
  CopyIcon as Copy,
  CheckIcon as Check,
  XIcon as X,
  WarningIcon as AlertTriangle,
  ProhibitIcon as Ban,
  ArrowCounterClockwiseIcon as RotateCcw,
  EyeIcon as Eye,
  KeyIcon as KeyRound,
  PencilSimpleIcon as PencilSimple,
  SignOutIcon as LogOut,
  UserMinusIcon as UserMinus,
  ArrowsLeftRightIcon as ArrowLeftRight,
  BuildingsIcon as Building2,
  FileTextIcon as FileText,
  WalletIcon as Wallet,
  ClockCounterClockwiseIcon as History,
  UsersIcon as Users,
  NotepadIcon as Notepad,
  MagnifyingGlassIcon as MagnifyingGlass,
  WarningCircleIcon as WarningCircle,
  UserGearIcon as UserGear,
} from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { formatVND } from "../../utils/currency";
import { PartnerStatusBadge, VerificationStatusBadge } from "../../components/gym-management/PartnerStatusBadge";
import { ModerationStatusBadge } from "../../components/gym-management/ModerationStatusBadge";
import { getPartnerStatusMeta } from "../../components/gym-management/statusConfig";
import { EmptyState as SharedEmptyState } from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { ISSUE_TYPE_LABEL, SOURCE_LABEL, statusMeta, ComplaintDetailDialog } from "./AdminComplaintsPage";

const DOC_TYPE_LABEL: Record<string, { label: string; required: boolean }> = {
  BUSINESS_LICENSE: { label: "Giấy phép kinh doanh", required: true },
  REPRESENTATIVE_ID: { label: "CCCD người đại diện", required: true },
  PREMISES_PROOF: { label: "Giấy tờ mặt bằng", required: true },
  TAX_CODE_CERTIFICATE: { label: "Mã số thuế", required: false },
  SITE_PHOTOS: { label: "Ảnh thực địa", required: false },
  FIRE_SAFETY_CERTIFICATE: { label: "Giấy chứng nhận PCCC", required: false },
};

const CHANNEL_LABEL: Record<string, string> = { EMAIL: "Email", CALL: "Điện thoại", MEETING: "Gặp mặt", OTHER: "Khác" };

// GYM_MANAGEMENT master spec §56 — delegates to the shared status-badge library
// (components/gym-management/statusConfig.ts) instead of this file's own color map, which
// used to disagree with AdminGymModeration.tsx's map for the same statuses.
function StatusChip({ status }: { status: string }) {
  return <PartnerStatusBadge status={status} />;
}

function relativeOrAbsolute(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "hôm nay";
  if (days === 1) return "1 ngày trước";
  if (days > 0 && days < 14) return `${days} ngày trước`;
  return d.toLocaleDateString("vi-VN");
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN") + " " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function EmptyState({ text }: { text: string }) {
  return <SharedEmptyState title={text} />;
}

// ── Trang chính ──────────────────────────────────────────────────────────────

export function AdminPartnersPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) return <PartnerDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  return <PartnerList onSelect={setSelectedId} />;
}

function PartnerList({ onSelect }: { onSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const queueQuery = useQuery({ queryKey: ["admin-partner-queue"], queryFn: () => adminService.getPartnerQueue() });
  const partnersQuery = useQuery({
    queryKey: ["admin-partners", statusFilter],
    queryFn: () => adminService.listPartners(statusFilter === "ALL" ? undefined : statusFilter),
  });

  const partners = (partnersQuery.data ?? []).filter((p: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.legalName?.toLowerCase().includes(q) || p.contactEmail?.toLowerCase().includes(q) || p.taxCode?.toLowerCase().includes(q);
  });

  const q = queueQuery.data;
  const queueItems = q
    ? [
        { count: q.pendingProspects, label: "Hồ sơ chờ thẩm định", filter: "PROSPECT" },
        { count: q.pendingGyms, label: "Chi nhánh chờ duyệt", filter: null },
        { count: q.pendingBrandRenames, label: "Tên thương hiệu chờ duyệt", filter: null },
        { count: q.invitedTooLong, label: "Đã mời > 7 ngày chưa đăng nhập", filter: "INVITED" },
        { count: q.expiringDocs, label: "Giấy phép sắp hết hạn", filter: null },
      ].filter((item) => item.count > 0)
    : [];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <Handshake className="w-5 h-5 text-green-400" /> Đối tác phòng tập
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Hồ sơ pháp nhân, tài khoản đăng nhập, thẩm định, tạm khoá/chấm dứt hợp tác — tách
            biệt khỏi "Quản lý gym & owner" (nơi đó chỉ còn duyệt chi nhánh/tên thương hiệu).
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all"
        >
          <Plus className="w-4 h-4" /> Hồ sơ mới
        </button>
      </div>

      {/* Hàng đợi việc cần làm */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4">
        <h3 className="text-sm font-bold text-zinc-200 mb-3">Cần bạn xử lý</h3>
        {queueQuery.isLoading ? (
          <Loader2 className="w-4 h-4 text-green-500 animate-spin" />
        ) : queueItems.length === 0 ? (
          <p className="text-xs text-zinc-500">✅ Không có việc nào chờ xử lý.</p>
        ) : (
          <div className="space-y-1">
            {queueItems.map((item) => (
              <button
                key={item.label}
                onClick={() => item.filter && setStatusFilter(item.filter)}
                className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors text-left"
              >
                <span className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                  <span className="font-bold text-amber-400">{item.count}</span> {item.label}
                </span>
                <ChevronRight className="w-4 h-4 text-zinc-600" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tìm kiếm + lọc */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800/60 rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên, email, mã số thuế..."
            className="flex-1 text-sm bg-transparent outline-none text-zinc-300 placeholder-zinc-600"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(["ALL", "PROSPECT", "INVITED", "ACTIVE", "SUSPENDED", "TERMINATED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === s ? "bg-green-500 text-black" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800/60 border border-zinc-800/60"
              }`}
            >
              {s === "ALL" ? "Tất cả" : getPartnerStatusMeta(s).label}
            </button>
          ))}
        </div>
      </div>

      {/* Danh sách */}
      {partnersQuery.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-green-500 animate-spin" /></div>
      ) : partners.length === 0 ? (
        <EmptyState text="Không có đối tác nào khớp bộ lọc." />
      ) : (
        <div className="space-y-2.5">
          {partners.map((p: any) => {
            const owner = p.accounts?.find((a: any) => a.role === "OWNER" && a.status === "ACTIVE");
            const managerCount = p.accounts?.filter((a: any) => a.role === "MANAGER" && a.status === "ACTIVE").length ?? 0;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                data-testid="admin-partner-card"
                className="w-full text-left bg-zinc-900 rounded-xl border border-zinc-800/60 hover:border-zinc-700 p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{p.legalName}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">
                      {p.contactEmail} {p.rejectedAt && <span className="text-amber-500">· đã từ chối</span>}
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-1">
                      {managerCount > 0 ? `${managerCount + 1} tài khoản · ` : ""}
                      {p.status === "INVITED" && `mời ${relativeOrAbsolute(p.createdAt)}`}
                      {p.status === "ACTIVE" && owner && `đối tác từ ${relativeOrAbsolute(p.createdAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusChip status={p.status} />
                    <ChevronRight className="w-4 h-4 text-zinc-600" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showCreate && <CreatePartnerModal onClose={() => setShowCreate(false)} onCreated={() => queryClient.invalidateQueries({ queryKey: ["admin-partners"] })} />}
    </div>
  );
}

function CreatePartnerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  // `partnerKind` is no longer asked for: the two kinds collected exactly the same fields and
  // nothing downstream ever branched on the value (no different required-document set, no
  // different commission treatment — grep partnerKind in gym-service: it is stored and echoed
  // back, nothing more). The column keeps its BUSINESS default rather than being dropped, so
  // existing INDIVIDUAL rows still read back correctly.
  const [form, setForm] = useState({
    legalName: "", taxCode: "", businessLicenseNo: "",
    contactEmail: "", contactPhone: "", commissionRateOverride: "",
  });
  const createMutation = useMutation({
    mutationFn: () =>
      adminService.createPartner({
        legalName: form.legalName.trim(),
        taxCode: form.taxCode.trim() || undefined,
        businessLicenseNo: form.businessLicenseNo.trim() || undefined,
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim() || undefined,
        commissionRateOverride: form.commissionRateOverride ? Number(form.commissionRateOverride) : null,
      }),
    onSuccess: () => {
      toast.success("Đã tạo hồ sơ đối tác (PROSPECT)");
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể tạo hồ sơ"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-200">Hồ sơ đối tác mới</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-zinc-500">Tạo ngay khi nhận được email/liên hệ đầu tiên — chưa cấp tài khoản đăng nhập ở bước này.</p>

        <div className="space-y-2.5">
          <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Tên pháp lý *" className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600" />
          <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Email liên hệ *" className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600" />
          <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="Số điện thoại" className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600" />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.taxCode} onChange={(e) => setForm({ ...form, taxCode: e.target.value })} placeholder="Mã số thuế" className="px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600" />
            <input value={form.businessLicenseNo} onChange={(e) => setForm({ ...form, businessLicenseNo: e.target.value })} placeholder="Số giấy phép KD" className="px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600" />
          </div>
          <input
            value={form.commissionRateOverride}
            onChange={(e) => setForm({ ...form, commissionRateOverride: e.target.value })}
            placeholder="Chiết khấu riêng (0-1, để trống = dùng mức chung)"
            className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600"
          />
        </div>

        <button
          onClick={() => createMutation.mutate()}
          disabled={!form.legalName.trim() || !form.contactEmail.trim() || createMutation.isPending}
          className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Tạo hồ sơ
        </button>
      </div>
    </div>
  );
}

// ── Màn hình 360° ─────────────────────────────────────────────────────────────

type DetailTab = "overview" | "accounts" | "gyms" | "documents" | "money" | "audit" | "notes" | "complaints";

function PartnerDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"suspend" | "unsuspend" | "terminate" | "provisioned" | "viewAs" | null>(null);
  const [provisionResult, setProvisionResult] = useState<{ inviteLink: string; emailSent: boolean } | null>(null);
  const queryClient = useQueryClient();

  const detailQuery = useQuery({ queryKey: ["admin-partner-detail", id], queryFn: () => adminService.getPartner(id) });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-partner-detail", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
    queryClient.invalidateQueries({ queryKey: ["admin-partner-queue"] });
  };

  const provisionMutation = useMutation({
    mutationFn: () => adminService.provisionPartnerOwner(id),
    onSuccess: (data: any) => {
      toast.success("Đã cấp tài khoản — thư mời đã gửi");
      setProvisionResult({ inviteLink: data.inviteLink, emailSent: data.emailSent });
      setDialog("provisioned");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cấp tài khoản"),
  });

  if (detailQuery.isLoading || !detailQuery.data) {
    return (
      <div className="p-6 flex justify-center"><Loader2 className="w-6 h-6 text-green-500 animate-spin" /></div>
    );
  }

  const { partner, gyms, brand, invitations, identities } = detailQuery.data;
  const ownerAccount = partner.accounts?.find((a: any) => a.role === "OWNER" && a.status === "ACTIVE");
  const ownerIdentity = identities?.find((i: any) => i.accountId === ownerAccount?.id);

  const TABS: { key: DetailTab; label: string; icon: any }[] = [
    { key: "overview", label: "Tổng quan", icon: Building2 },
    { key: "accounts", label: "Tài khoản", icon: Users },
    { key: "gyms", label: "Chi nhánh", icon: Building2 },
    { key: "documents", label: "Giấy tờ", icon: FileText },
    { key: "money", label: "Tiền", icon: Wallet },
    { key: "audit", label: "Nhật ký", icon: History },
    // §65 — "INTERNAL NOTES (Owner-invisible)". Deliberately only reachable from this admin
    // page; owner.routes.ts never exposes the backing endpoint.
    { key: "notes", label: "Ghi chú nội bộ", icon: Notepad },
    { key: "complaints", label: "Khiếu nại", icon: AlertTriangle },
  ];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại danh sách
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-zinc-100">{partner.legalName}</h1>
            <StatusChip status={partner.status} />
          </div>
          {/* Nhãn "Doanh nghiệp / Cá nhân" đã bỏ cùng lúc với bộ chọn ở form tạo hồ sơ: hai
              loại thu thập đúng cùng bộ trường và không có nghiệp vụ nào phân biệt chúng, nên
              nhãn này chỉ nói lại một giá trị mặc định, không phải một thông tin. */}
          <p className="text-xs text-zinc-500 mt-0.5">
            {partner.taxCode ? `MST ${partner.taxCode} · ` : ""}Tạo lúc {formatDateTime(partner.createdAt)}
          </p>
          {partner.suspendedReason && (
            <p className="text-xs text-amber-400 mt-1">Lý do tạm khoá: "{partner.suspendedReason}"</p>
          )}
          {partner.terminationReason && (
            <p className="text-xs text-red-400 mt-1">Lý do chấm dứt: "{partner.terminationReason}"</p>
          )}
        </div>

        <div className="relative flex-shrink-0">
          <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-1 px-3 py-2 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800">
            <MoreVertical className="w-4 h-4" /> Hành động
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-10 overflow-hidden" onMouseLeave={() => setMenuOpen(false)}>
              {partner.status === "PROSPECT" && (
                <button
                  onClick={() => { provisionMutation.mutate(); setMenuOpen(false); }}
                  disabled={provisionMutation.isPending}
                  className="w-full text-left px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
                >
                  <Check className="w-3.5 h-3.5 text-green-400" /> Cấp tài khoản
                </button>
              )}
              {(partner.status === "ACTIVE" || partner.status === "SUSPENDED") && (
                <button
                  onClick={() => { setDialog("viewAs"); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 flex items-center gap-2"
                >
                  <Eye className="w-3.5 h-3.5" /> Xem dưới góc nhìn đối tác
                </button>
              )}
              {partner.status === "ACTIVE" && (
                <button onClick={() => { setDialog("suspend"); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-xs text-amber-400 hover:bg-zinc-800 flex items-center gap-2">
                  <Ban className="w-3.5 h-3.5" /> Tạm khoá
                </button>
              )}
              {partner.status === "SUSPENDED" && (
                <button onClick={() => { setDialog("unsuspend"); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-xs text-green-400 hover:bg-zinc-800 flex items-center gap-2">
                  <RotateCcw className="w-3.5 h-3.5" /> Bỏ tạm khoá
                </button>
              )}
              {partner.status !== "TERMINATED" && partner.status !== "PROSPECT" && (
                <button onClick={() => { setDialog("terminate"); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-xs text-red-400 hover:bg-zinc-800 flex items-center gap-2 border-t border-zinc-800">
                  <UserMinus className="w-3.5 h-3.5" /> Chấm dứt hợp tác
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-zinc-800/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              tab === t.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Chi nhánh" value={String(gyms?.length ?? 0)} />
            <StatCard label="Thương hiệu" value={brand?.name ?? "Chưa đặt tên"} />
            <StatCard label="Tài khoản" value={String(partner.accounts?.filter((a: any) => a.status === "ACTIVE").length ?? 0)} />
            <StatCard label="Chiết khấu riêng" value={partner.commissionRateOverride != null ? `${(Number(partner.commissionRateOverride) * 100).toFixed(0)}%` : "Mức chung"} />
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-zinc-500">Email liên hệ</span><span className="text-zinc-300">{partner.contactEmail ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">Điện thoại</span><span className="text-zinc-300">{partner.contactPhone ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">Chủ sở hữu</span><span className="text-zinc-300">{ownerIdentity ? `${ownerIdentity.firstName ?? ""} ${ownerIdentity.lastName ?? ""} (${ownerIdentity.email})` : "Chưa có"}</span></div>
            {partner.expectedBranchCount != null && <div className="flex justify-between"><span className="text-zinc-500">Số chi nhánh dự kiến</span><span className="text-zinc-300">{partner.expectedBranchCount}</span></div>}
            {partner.negotiationNotes && <div className="pt-2 border-t border-zinc-800/60"><span className="text-zinc-500 text-xs">Ghi chú đàm phán:</span><p className="text-zinc-300 text-xs mt-1">{partner.negotiationNotes}</p></div>}
          </div>
          <VerificationPanel partner={partner} onChange={invalidate} />
          <EditPartnerForm partner={partner} onSaved={invalidate} />
        </div>
      )}

      {tab === "accounts" && <AccountsTab partner={partner} identities={identities} invitations={invitations} onChange={invalidate} />}
      {tab === "gyms" && (
        <div className="space-y-2.5">
          {(gyms ?? []).length === 0 ? (
            <EmptyState text="Chủ sở hữu chưa tạo chi nhánh nào." />
          ) : (
            gyms.map((g: any) => (
              <div key={g.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">{g.approvedName ?? g.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{g.approvedAddress ?? g.address}{g.city ? `, ${g.city}` : ""}</p>
                </div>
                <ModerationStatusBadge status={g.status} />
              </div>
            ))
          )}
        </div>
      )}
      {tab === "documents" && <DocumentsTab partnerId={id} />}
      {tab === "money" && <MoneyTab partnerId={id} partnerStatus={partner.status} />}
      {tab === "audit" && <AuditTab partnerId={id} />}
      {tab === "notes" && <InternalNotesTab partnerId={id} />}
      {tab === "complaints" && <PartnerComplaintsTab partnerId={id} />}

      {dialog === "provisioned" && provisionResult && (
        <ProvisionResultModal inviteLink={provisionResult.inviteLink} emailSent={provisionResult.emailSent} onClose={() => setDialog(null)} />
      )}
      {dialog === "suspend" && <SuspendDialog partnerId={id} onClose={() => setDialog(null)} onDone={invalidate} />}
      {dialog === "unsuspend" && <UnsuspendDialog partnerId={id} onClose={() => setDialog(null)} onDone={invalidate} />}
      {dialog === "terminate" && <TerminateDialog partnerId={id} onClose={() => setDialog(null)} onDone={invalidate} />}
      {dialog === "viewAs" && <ViewAsPartnerModal partnerId={id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-sm font-bold text-zinc-200 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function EditPartnerForm({ partner, onSaved }: { partner: any; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({
    legalName: partner.legalName ?? "", contactEmail: partner.contactEmail ?? "", contactPhone: partner.contactPhone ?? "",
    taxCode: partner.taxCode ?? "", businessLicenseNo: partner.businessLicenseNo ?? "",
    commissionRateOverride: partner.commissionRateOverride != null ? String(partner.commissionRateOverride) : "",
    expectedBranchCount: partner.expectedBranchCount != null ? String(partner.expectedBranchCount) : "",
    negotiationNotes: partner.negotiationNotes ?? "",
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      adminService.updatePartner(partner.id, {
        legalName: form.legalName.trim(), contactEmail: form.contactEmail.trim(), contactPhone: form.contactPhone.trim() || null,
        taxCode: form.taxCode.trim() || null, businessLicenseNo: form.businessLicenseNo.trim() || null,
        commissionRateOverride: form.commissionRateOverride ? Number(form.commissionRateOverride) : null,
        expectedBranchCount: form.expectedBranchCount ? Number(form.expectedBranchCount) : null,
        negotiationNotes: form.negotiationNotes.trim() || null,
      }),
    onSuccess: () => { toast.success("Đã lưu"); onSaved(); setExpanded(false); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể lưu"),
  });

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)} className="text-xs text-green-400 hover:text-green-300 font-semibold">
        Sửa hồ sơ / điều khoản đã chốt
      </button>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Tên pháp lý" className="px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Email" className="px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="Điện thoại" className="px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={form.taxCode} onChange={(e) => setForm({ ...form, taxCode: e.target.value })} placeholder="Mã số thuế" className="px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={form.commissionRateOverride} onChange={(e) => setForm({ ...form, commissionRateOverride: e.target.value })} placeholder="Chiết khấu riêng (0-1)" className="px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={form.expectedBranchCount} onChange={(e) => setForm({ ...form, expectedBranchCount: e.target.value })} placeholder="Số chi nhánh dự kiến" className="px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
      </div>
      <textarea value={form.negotiationNotes} onChange={(e) => setForm({ ...form, negotiationNotes: e.target.value })} placeholder="Ghi chú đàm phán" rows={2} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      <div className="flex gap-2">
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold">
          {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Lưu
        </button>
        <button onClick={() => setExpanded(false)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Huỷ</button>
      </div>
    </div>
  );
}

function ProvisionResultModal({ inviteLink, emailSent, onClose }: { inviteLink: string; emailSent: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-green-500/20 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-sm font-bold text-green-400">
          <Check className="w-4 h-4" /> Đã tạo thư mời
        </div>
        <p className="text-xs text-zinc-500">
          {emailSent ? "Email đã được gửi tới người liên hệ." : "Không gửi được email tự động — hãy sao chép liên kết dưới đây và gửi thủ công."}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-amber-400 font-mono truncate">{inviteLink}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(inviteLink).catch(() => {}); toast.success("Đã sao chép"); }}
            className="p-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 flex-shrink-0"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
        <button onClick={onClose} className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300">Đóng</button>
      </div>
    </div>
  );
}

// ── Tab: Tài khoản ─────────────────────────────────────────────────────────

function AccountsTab({ partner, identities, invitations, onChange }: { partner: any; identities: any[]; invitations: any[]; onChange: () => void }) {
  const [transferTarget, setTransferTarget] = useState<string | null>(null);

  // Moved here when the "Owners" tab was removed from AdminGymModeration: fixing a misspelled
  // display name was the ONE thing that tab did which had no equivalent anywhere else, so it
  // rides along with the other per-account actions rather than disappearing. Email is
  // deliberately not editable — see authService.updateUserNameAsAdmin's doc comment.
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);
  const [nameForm, setNameForm] = useState({ firstName: "", lastName: "" });
  const renameMutation = useMutation({
    mutationFn: ({ userId, firstName, lastName }: { userId: string; firstName: string; lastName?: string }) =>
      adminService.updateGymOwnerName(userId, { firstName, lastName }),
    onSuccess: () => {
      toast.success("Đã cập nhật tên");
      setEditingNameFor(null);
      onChange();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật tên"),
  });

  const resetPwMutation = useMutation({
    mutationFn: (accountId: string) => adminService.resetPartnerAccountPassword(accountId),
    onSuccess: (data: any) => {
      navigator.clipboard.writeText(data.resetLink).catch(() => {});
      toast.success(data.emailSent ? "Đã gửi email đặt lại mật khẩu (đã sao chép liên kết)" : "Không gửi được email — đã sao chép liên kết, hãy gửi thủ công");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể phát hành liên kết"),
  });
  const forceLogoutMutation = useMutation({
    mutationFn: (accountId: string) => adminService.forceLogoutPartnerAccount(accountId),
    onSuccess: () => toast.success("Đã buộc đăng xuất"),
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể thực hiện"),
  });
  const revokeMutation = useMutation({
    mutationFn: (accountId: string) => adminService.revokePartnerAccountAsAdmin(accountId, "Thu hồi bởi quản trị viên"),
    onSuccess: () => { toast.success("Đã thu hồi tài khoản"); onChange(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể thu hồi"),
  });
  const transferMutation = useMutation({
    mutationFn: (toAccountId: string) => adminService.transferPartnerOwnership(partner.id, toAccountId, "Chuyển quyền sở hữu bởi quản trị viên"),
    onSuccess: () => { toast.success("Đã chuyển quyền sở hữu"); setTransferTarget(null); onChange(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể chuyển quyền"),
  });
  const revokeInviteMutation = useMutation({
    mutationFn: (invitationId: string) => adminService.revokePartnerInvitation(partner.id, invitationId),
    onSuccess: () => { toast.success("Đã thu hồi thư mời"); onChange(); },
  });
  const resendInviteMutation = useMutation({
    mutationFn: (invitationId: string) => adminService.resendPartnerInvitation(partner.id, invitationId),
    onSuccess: (data: any) => {
      navigator.clipboard.writeText(data.inviteLink).catch(() => {});
      toast.success("Đã gửi lại thư mời (đã sao chép liên kết)");
      onChange();
    },
  });

  const activeAccounts = (partner.accounts ?? []).filter((a: any) => a.status !== "REVOKED");
  const revokedAccounts = (partner.accounts ?? []).filter((a: any) => a.status === "REVOKED");
  const pendingInvitations = (invitations ?? []).filter((i: any) => i.status === "PENDING");

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {activeAccounts.map((a: any) => {
          const identity = identities?.find((i: any) => i.accountId === a.id);
          const name = identity ? `${identity.firstName ?? ""} ${identity.lastName ?? ""}`.trim() || identity.email : a.userId;
          return (
            <div key={a.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">
                    {name} <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${a.role === "OWNER" ? "bg-purple-500/10 border-purple-500/20 text-purple-400" : "bg-blue-500/10 border-blue-500/20 text-blue-400"}`}>{a.role === "OWNER" ? "Chủ sở hữu" : "Quản lý"}</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{identity?.email}</p>
                  {a.role === "MANAGER" && <p className="text-[11px] text-zinc-600 mt-0.5">{a.scopedGymIds?.length ?? 0} chi nhánh được gán</p>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${a.status === "ACTIVE" ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-zinc-700/50 border-zinc-700 text-zinc-400"}`}>
                  {a.status === "ACTIVE" ? "Hoạt động" : a.status}
                </span>
              </div>
              {editingNameFor === a.id && (
                <div className="mt-2.5 flex gap-1.5 flex-wrap items-center">
                  <input
                    value={nameForm.firstName}
                    onChange={(e) => setNameForm({ ...nameForm, firstName: e.target.value })}
                    placeholder="Họ"
                    className="flex-1 min-w-[110px] px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 placeholder-zinc-600"
                  />
                  <input
                    value={nameForm.lastName}
                    onChange={(e) => setNameForm({ ...nameForm, lastName: e.target.value })}
                    placeholder="Tên"
                    className="flex-1 min-w-[110px] px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 placeholder-zinc-600"
                  />
                  <button
                    onClick={() => renameMutation.mutate({ userId: a.userId, firstName: nameForm.firstName.trim(), lastName: nameForm.lastName.trim() || undefined })}
                    disabled={!nameForm.firstName.trim() || renameMutation.isPending}
                    className="text-[11px] bg-green-500 disabled:opacity-50 text-black px-2.5 py-1.5 rounded-lg font-bold"
                  >
                    Lưu
                  </button>
                  <button onClick={() => setEditingNameFor(null)} className="text-[11px] text-zinc-500 px-2 py-1.5">Huỷ</button>
                </div>
              )}
              <div className="flex gap-1.5 mt-3 flex-wrap">
                <button
                  onClick={() => {
                    setEditingNameFor(a.id);
                    setNameForm({ firstName: identity?.firstName ?? "", lastName: identity?.lastName ?? "" });
                  }}
                  className="flex items-center gap-1 text-[11px] border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-2.5 py-1.5 rounded-lg"
                >
                  <PencilSimple className="w-3 h-3" /> Sửa tên
                </button>
                <button onClick={() => resetPwMutation.mutate(a.id)} className="flex items-center gap-1 text-[11px] border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-2.5 py-1.5 rounded-lg">
                  <KeyRound className="w-3 h-3" /> Đặt lại mật khẩu
                </button>
                <button onClick={() => forceLogoutMutation.mutate(a.id)} className="flex items-center gap-1 text-[11px] border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-2.5 py-1.5 rounded-lg">
                  <LogOut className="w-3 h-3" /> Buộc đăng xuất
                </button>
                {a.role === "MANAGER" && (
                  <button onClick={() => setTransferTarget(a.id)} className="flex items-center gap-1 text-[11px] border border-zinc-700 text-zinc-300 hover:bg-zinc-800 px-2.5 py-1.5 rounded-lg">
                    <ArrowLeftRight className="w-3 h-3" /> Chuyển quyền sở hữu
                  </button>
                )}
                {activeAccounts.filter((x: any) => x.role === "OWNER").length + (a.role === "OWNER" ? -1 : 0) > 0 || a.role === "MANAGER" ? (
                  <button onClick={() => revokeMutation.mutate(a.id)} className="flex items-center gap-1 text-[11px] border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg">
                    <UserMinus className="w-3 h-3" /> Thu hồi
                  </button>
                ) : null}
              </div>
              {transferTarget === a.id && (
                <div className="mt-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-zinc-400">Chuyển quyền sở hữu sang "{name}"? Chủ hiện tại sẽ trở thành quản lý.</p>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => transferMutation.mutate(a.id)} disabled={transferMutation.isPending} className="text-[11px] bg-green-500 text-black px-2 py-1 rounded font-bold">Xác nhận</button>
                    <button onClick={() => setTransferTarget(null)} className="text-[11px] text-zinc-500 px-2 py-1">Huỷ</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingInvitations.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Thư mời đang chờ</h4>
          <div className="space-y-2">
            {pendingInvitations.map((inv: any) => {
              const isOld = Date.now() - new Date(inv.createdAt).getTime() > 7 * 86_400_000;
              return (
                <div key={inv.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-zinc-300">{inv.email} <span className="text-zinc-600">· {inv.role === "OWNER" ? "Chủ sở hữu" : "Quản lý"}</span></p>
                    <p className={`text-[11px] mt-0.5 ${isOld ? "text-amber-400" : "text-zinc-600"}`}>
                      Mời {relativeOrAbsolute(inv.createdAt)} {isOld && "⚠️"}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => resendInviteMutation.mutate(inv.id)} className="text-[11px] border border-zinc-700 text-zinc-300 px-2 py-1 rounded-lg">Gửi lại</button>
                    <button onClick={() => revokeInviteMutation.mutate(inv.id)} className="text-[11px] border border-red-500/30 text-red-400 px-2 py-1 rounded-lg">Thu hồi</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {revokedAccounts.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-2">Đã thu hồi</h4>
          <div className="space-y-1.5">
            {revokedAccounts.map((a: any) => {
              const identity = identities?.find((i: any) => i.accountId === a.id);
              return (
                <div key={a.id} className="text-xs text-zinc-600 px-3 py-2 bg-zinc-900/50 rounded-lg">
                  {identity?.email ?? a.userId} · thu hồi {relativeOrAbsolute(a.revokedAt)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Giấy tờ ───────────────────────────────────────────────────────────

function DocumentsTab({ partnerId }: { partnerId: string }) {
  const queryClient = useQueryClient();
  const [uploadUrl, setUploadUrl] = useState<Record<string, string>>({});
  const docsQuery = useQuery({ queryKey: ["admin-partner-documents", partnerId], queryFn: () => adminService.listPartnerDocuments(partnerId) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-partner-documents", partnerId] });

  const uploadMutation = useMutation({
    mutationFn: ({ docType, fileUrl }: { docType: string; fileUrl: string }) => adminService.upsertPartnerDocument(partnerId, docType, fileUrl),
    onSuccess: () => { toast.success("Đã ghi nhận tệp"); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể ghi nhận"),
  });
  const verifyMutation = useMutation({
    mutationFn: ({ docType, decision }: { docType: string; decision: "VERIFIED" | "REJECTED" }) => adminService.verifyPartnerDocument(partnerId, docType, decision),
    onSuccess: () => { toast.success("Đã cập nhật"); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  if (docsQuery.isLoading) return <Loader2 className="w-5 h-5 text-green-500 animate-spin" />;

  return (
    <div className="space-y-2.5">
      {(docsQuery.data ?? []).map((doc: any) => {
        const meta = DOC_TYPE_LABEL[doc.docType] ?? { label: doc.docType, required: false };
        const statusCls =
          doc.status === "VERIFIED" ? "bg-green-500/10 border-green-500/20 text-green-400"
          : doc.status === "REJECTED" ? "bg-red-500/10 border-red-500/20 text-red-400"
          : doc.status === "RECEIVED" ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
          : "bg-zinc-700/50 border-zinc-700 text-zinc-400";
        const statusText = { VERIFIED: "Đã xác minh", REJECTED: "Bị từ chối", RECEIVED: "Đã nộp", PENDING: "Chưa nộp" }[doc.status as string] ?? doc.status;
        return (
          <div key={doc.docType} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  {meta.required ? "🔴" : "🟡"} {meta.label}
                </p>
                {doc.fileUrl && <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:underline break-all">{doc.fileUrl}</a>}
                {doc.verifiedAt && <p className="text-[11px] text-zinc-600 mt-0.5">Xác minh lúc {formatDateTime(doc.verifiedAt)}</p>}
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${statusCls}`}>{statusText}</span>
            </div>
            <div className="flex gap-1.5 mt-3">
              <input
                value={uploadUrl[doc.docType] ?? ""}
                onChange={(e) => setUploadUrl({ ...uploadUrl, [doc.docType]: e.target.value })}
                placeholder="Dán URL tệp đã tải lên..."
                className="flex-1 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200"
              />
              <button
                onClick={() => uploadMutation.mutate({ docType: doc.docType, fileUrl: uploadUrl[doc.docType] })}
                disabled={!uploadUrl[doc.docType]?.trim() || uploadMutation.isPending}
                className="text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 px-2.5 py-1.5 rounded-lg"
              >
                Ghi nhận
              </button>
            </div>
            {doc.fileUrl && doc.status !== "VERIFIED" && (
              <div className="flex gap-1.5 mt-2">
                <button onClick={() => verifyMutation.mutate({ docType: doc.docType, decision: "VERIFIED" })} className="flex items-center gap-1 text-[11px] bg-green-500/10 border border-green-500/20 text-green-400 px-2.5 py-1 rounded-lg">
                  <Check className="w-3 h-3" /> Xác minh
                </button>
                <button onClick={() => verifyMutation.mutate({ docType: doc.docType, decision: "REJECTED" })} className="flex items-center gap-1 text-[11px] border border-red-500/30 text-red-400 px-2.5 py-1 rounded-lg">
                  <X className="w-3 h-3" /> Từ chối
                </button>
              </div>
            )}
          </div>
        );
      })}

      <ContactLogSection partnerId={partnerId} />
    </div>
  );
}

function ContactLogSection({ partnerId }: { partnerId: string }) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState("CALL");
  const [note, setNote] = useState("");
  const logQuery = useQuery({ queryKey: ["admin-partner-contact-log", partnerId], queryFn: () => adminService.listPartnerContactLog(partnerId) });
  const addMutation = useMutation({
    mutationFn: () => adminService.addPartnerContactLog(partnerId, { channel, note: note.trim() }),
    onSuccess: () => { setNote(""); queryClient.invalidateQueries({ queryKey: ["admin-partner-contact-log", partnerId] }); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể ghi"),
  });

  return (
    <div className="pt-2">
      <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Nhật ký trao đổi</h4>
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3 space-y-2 mb-2">
        <div className="flex gap-1.5">
          {(["EMAIL", "CALL", "MEETING", "OTHER"] as const).map((c) => (
            <button key={c} onClick={() => setChannel(c)} className={`text-[11px] px-2 py-1 rounded-lg ${channel === c ? "bg-green-500 text-black font-bold" : "bg-zinc-800 text-zinc-400"}`}>
              {CHANNEL_LABEL[c]}
            </button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nội dung trao đổi..." rows={2} className="w-full px-2.5 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 resize-none" />
        <button onClick={() => addMutation.mutate()} disabled={!note.trim() || addMutation.isPending} className="text-[11px] bg-green-500 hover:bg-green-400 disabled:opacity-40 text-black px-3 py-1.5 rounded-lg font-bold">
          Ghi lại
        </button>
      </div>
      <div className="space-y-1.5">
        {(logQuery.data ?? []).map((l: any) => (
          <div key={l.id} className="text-xs bg-zinc-900/60 rounded-lg px-3 py-2">
            <span className="text-zinc-600">{formatDateTime(l.occurredAt)} · {CHANNEL_LABEL[l.channel] ?? l.channel}</span>
            <p className="text-zinc-300 mt-0.5">{l.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Tiền (chỉ thông tin cấp đối tác này — mức chiết khấu chung nằm ở "Tài chính") ──

function MoneyTab({ partnerId, partnerStatus }: { partnerId: string; partnerStatus: string }) {
  const rateQuery = useQuery({ queryKey: ["admin-commission-rate"], queryFn: () => adminService.getCommissionRate() });
  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <p className="text-xs text-zinc-500">Mức chiết khấu nền tảng đang áp dụng chung</p>
        <p className="text-lg font-bold text-zinc-200 mt-1">
          {rateQuery.data ? `${(Number(rateQuery.data.rate) * 100).toFixed(0)}%` : "—"}
        </p>
        <p className="text-[11px] text-zinc-600 mt-1">Sửa chiết khấu riêng cho đối tác này ở tab Tổng quan → "Sửa hồ sơ".</p>
      </div>
      {(partnerStatus === "ACTIVE" || partnerStatus === "SUSPENDED") && <TerminationImpactPreview partnerId={partnerId} />}
    </div>
  );
}

function TerminationImpactPreview({ partnerId }: { partnerId: string }) {
  const [show, setShow] = useState(false);
  const impactQuery = useQuery({ queryKey: ["admin-partner-termination-impact", partnerId], queryFn: () => adminService.getTerminationImpact(partnerId), enabled: show });
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
      <button onClick={() => setShow(true)} className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> Xem trước hệ quả nếu chấm dứt hợp tác
      </button>
      {show && (
        impactQuery.isLoading ? <Loader2 className="w-4 h-4 text-green-500 animate-spin mt-2" /> : impactQuery.data && (
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <div><span className="text-zinc-500">Hội viên còn hạn:</span> <span className="text-zinc-200 font-semibold">{impactQuery.data.activeMembers}</span></div>
            <div><span className="text-zinc-500">Giá trị chưa dùng:</span> <span className="text-zinc-200 font-semibold">{formatVND(impactQuery.data.unusedValueTotal)}</span></div>
            <div><span className="text-zinc-500">Hợp đồng PT đang chạy:</span> <span className="text-zinc-200 font-semibold">{impactQuery.data.activePtContracts}</span></div>
            <div><span className="text-zinc-500">Chi nhánh đang hoạt động:</span> <span className="text-zinc-200 font-semibold">{impactQuery.data.activeGyms}/{impactQuery.data.totalGyms}</span></div>
            <div className="col-span-2"><span className="text-zinc-500">Số dư ví chưa rút:</span> <span className="text-zinc-200 font-semibold">{formatVND(impactQuery.data.walletBalanceTotal)}</span></div>
          </div>
        )
      )}
    </div>
  );
}

// ── Tab: Nhật ký kiểm toán ──────────────────────────────────────────────────

const AUDIT_ACTION_LABEL: Record<string, string> = {
  PARTNER_CREATED: "Tạo hồ sơ đối tác", PARTNER_UPDATED: "Cập nhật hồ sơ", ACCOUNT_PROVISIONED: "Cấp tài khoản",
  INVITATION_RESENT: "Gửi lại thư mời", INVITATION_REVOKED: "Thu hồi thư mời", PASSWORD_RESET_SENT: "Phát hành link đặt lại mật khẩu",
  SESSIONS_REVOKED: "Buộc đăng xuất", ACCOUNT_REVOKED: "Thu hồi tài khoản", OWNERSHIP_TRANSFERRED: "Chuyển quyền sở hữu",
  PARTNER_SUSPENDED: "Tạm khoá", PARTNER_UNSUSPENDED: "Bỏ tạm khoá", PARTNER_TERMINATED: "Chấm dứt hợp tác",
  VIEWED_AS_PARTNER: "Xem dưới góc nhìn đối tác",
};

function AuditTab({ partnerId }: { partnerId: string }) {
  const logQuery = useQuery({ queryKey: ["admin-partner-audit", partnerId], queryFn: () => adminService.getPartnerAuditLog(partnerId) });
  if (logQuery.isLoading) return <Loader2 className="w-5 h-5 text-green-500 animate-spin" />;
  if (!logQuery.data?.length) return <EmptyState text="Chưa có hoạt động nào." />;
  return (
    <div className="space-y-2">
      {logQuery.data.map((l: any) => (
        <div key={l.id} className="flex items-start gap-3 bg-zinc-900 rounded-lg px-3 py-2.5 text-xs">
          <span className="text-zinc-600 whitespace-nowrap flex-shrink-0">{formatDateTime(l.createdAt)}</span>
          <div>
            <span className="text-zinc-300 font-medium">{AUDIT_ACTION_LABEL[l.action] ?? l.action}</span>
            {l.reason && <span className="text-zinc-500"> — "{l.reason}"</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// GYM_MANAGEMENT master spec §60 — the verification axis, separate from partner.status
// (see GYM_PARTNER_STATUS_MAPPING.md). Only meaningful for a PROSPECT still being vetted —
// once an OWNER account exists, this stays VERIFIED and is shown read-only.
function VerificationPanel({ partner, onChange }: { partner: any; onChange: () => void }) {
  const [notes, setNotes] = useState("");
  const setStatusMutation = useMutation({
    mutationFn: (target: string) => adminService.setPartnerVerificationStatus(partner.id, target, notes.trim() || undefined),
    onSuccess: () => { toast.success("Đã cập nhật trạng thái thẩm định"); setNotes(""); onChange(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const canEdit = partner.status === "PROSPECT";

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
          <MagnifyingGlass className="w-3.5 h-3.5" /> Thẩm định hồ sơ
        </span>
        <VerificationStatusBadge status={partner.verificationStatus} />
      </div>
      {partner.verificationNotes && (
        <p className="text-xs text-zinc-500">
          Ghi chú gần nhất: <span className="text-zinc-300">"{partner.verificationNotes}"</span>
        </p>
      )}
      {!canEdit && (
        <p className="text-[11px] text-zinc-600">
          Chỉ thay đổi được khi hồ sơ đang ở dạng tiềm năng (PROSPECT) — trước khi cấp tài khoản.
        </p>
      )}
      {canEdit && (
        <div className="space-y-2">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ghi chú (bắt buộc khi yêu cầu bổ sung)…"
            rows={2}
            className="text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={setStatusMutation.isPending} onClick={() => setStatusMutation.mutate("IN_REVIEW")}>
              Bắt đầu xem xét
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={setStatusMutation.isPending || !notes.trim()}
              onClick={() => setStatusMutation.mutate("NEEDS_INFO")}
            >
              <WarningCircle className="w-3.5 h-3.5" /> Yêu cầu bổ sung
            </Button>
            <Button size="sm" disabled={setStatusMutation.isPending} onClick={() => setStatusMutation.mutate("VERIFIED")}>
              <Check className="w-3.5 h-3.5" /> Xác nhận đã thẩm định
            </Button>
          </div>
          <p className="text-[11px] text-zinc-600">Chưa "Xác nhận đã thẩm định" thì chưa cấp được tài khoản OWNER.</p>
        </div>
      )}
    </div>
  );
}

// §65 — "INTERNAL NOTES (Owner-invisible)".
function InternalNotesTab({ partnerId }: { partnerId: string }) {
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const notesQuery = useQuery({ queryKey: ["admin-partner-notes", partnerId], queryFn: () => adminService.listPartnerInternalNotes(partnerId) });
  const addMutation = useMutation({
    mutationFn: () => adminService.addPartnerInternalNote(partnerId, text.trim()),
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["admin-partner-notes", partnerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể thêm ghi chú"),
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5">
        <UserGear className="w-3.5 h-3.5" /> Chỉ admin thấy được — chủ sở hữu không bao giờ nhìn thấy mục này.
      </p>
      <div className="flex gap-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ví dụ: đã gọi điện, hẹn tuần sau…" rows={2} className="text-sm" />
        <Button disabled={!text.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
          Thêm
        </Button>
      </div>
      {notesQuery.isLoading ? (
        <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
      ) : !notesQuery.data?.length ? (
        <EmptyState text="Chưa có ghi chú nội bộ nào." />
      ) : (
        <div className="space-y-2">
          {notesQuery.data.map((n: any) => (
            <div key={n.id} className="bg-zinc-900 rounded-lg px-3 py-2.5 text-xs border border-zinc-800/60">
              <p className="text-zinc-300">{n.text}</p>
              <p className="text-zinc-600 mt-1">{formatDateTime(n.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// GYM_MANAGEMENT master spec, Phase 5 — the COMPLAINTS tab on a partner's detail page.
// Reuses AdminComplaintsPage's own label maps + status meta + detail dialog rather than
// duplicating them — one shared queue, one shared vocabulary, per the design decision that
// there's exactly one GymComplaint table regardless of where it's being viewed from.
function PartnerComplaintsTab({ partnerId }: { partnerId: string }) {
  const [selected, setSelected] = useState<any | null>(null);
  const queryClient = useQueryClient();
  const complaintsQuery = useQuery({ queryKey: ["admin-partner-complaints", partnerId], queryFn: () => adminService.listPartnerComplaints(partnerId) });

  if (complaintsQuery.isLoading) return <Loader2 className="w-5 h-5 text-green-500 animate-spin" />;
  if (!complaintsQuery.data?.length) return <EmptyState text="Chưa có khiếu nại nào." />;

  return (
    <div className="space-y-2">
      {complaintsQuery.data.map((c: any) => {
        const meta = statusMeta(c.status);
        return (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className="w-full text-left bg-zinc-900 rounded-lg px-3 py-2.5 text-xs border border-zinc-800/60 hover:border-zinc-700 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <span className="font-semibold text-zinc-300">{ISSUE_TYPE_LABEL[c.issueType as keyof typeof ISSUE_TYPE_LABEL]}</span>
              <span className="text-zinc-600"> · {SOURCE_LABEL[c.source as keyof typeof SOURCE_LABEL]}</span>
              <p className="text-zinc-500 mt-0.5 truncate">{c.description}</p>
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              meta.tone === "success" ? "bg-green-500/10 border-green-500/20 text-green-400" :
              meta.tone === "warning" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
              "bg-blue-500/10 border-blue-500/20 text-blue-400"
            }`}>
              {meta.label}
            </span>
          </button>
        );
      })}
      {selected && (
        <ComplaintDetailDialog
          complaint={selected}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            queryClient.invalidateQueries({ queryKey: ["admin-partner-complaints", partnerId] });
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function SuspendDialog({ partnerId, onClose, onDone }: { partnerId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => adminService.suspendPartner(partnerId, reason.trim()),
    onSuccess: () => { toast.success("Đã tạm khoá đối tác"); onDone(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể tạm khoá"),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-amber-500/20 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
          <AlertTriangle className="w-4 h-4" /> Tạm khoá đối tác?
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
            <p className="font-bold text-red-400 mb-1.5">Sẽ xảy ra</p>
            <ul className="space-y-1 text-zinc-400">
              <li>✗ Chủ sở hữu không đăng nhập được</li>
              <li>✗ Ngừng bán gói hội viên mới</li>
              <li>✗ Ngừng gia hạn gói sắp hết hạn</li>
              <li>✗ Đóng băng rút tiền</li>
              <li>✗ Ẩn khỏi trang tìm kiếm</li>
            </ul>
          </div>
          <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
            <p className="font-bold text-green-400 mb-1.5">Vẫn tiếp tục</p>
            <ul className="space-y-1 text-zinc-400">
              <li>✓ Hội viên còn hạn dùng tới hết hạn</li>
              <li>✓ Check-in bình thường</li>
              <li>✓ Tài khoản quản lý vẫn hoạt động</li>
              <li>✓ Doanh thu vẫn được ghi nhận</li>
            </ul>
          </div>
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc)..." rows={2} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-zinc-400 border border-zinc-700 rounded-lg">Không khoá</button>
          <button onClick={() => mutation.mutate()} disabled={!reason.trim() || mutation.isPending} className="flex-1 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black rounded-lg">
            {mutation.isPending ? "Đang xử lý..." : "Tạm khoá"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnsuspendDialog({ partnerId, onClose, onDone }: { partnerId: string; onClose: () => void; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: () => adminService.unsuspendPartner(partnerId),
    onSuccess: () => { toast.success("Đã bỏ tạm khoá"); onDone(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể thực hiện"),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-sm w-full bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-zinc-200">Bỏ tạm khoá đối tác này? Chủ sở hữu sẽ đăng nhập lại được ngay và chi nhánh hiện lại ở trang tìm kiếm.</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-zinc-400 border border-zinc-700 rounded-lg">Huỷ</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 py-2 text-xs font-bold bg-green-500 hover:bg-green-400 text-black rounded-lg">Bỏ tạm khoá</button>
        </div>
      </div>
    </div>
  );
}

function TerminateDialog({ partnerId, onClose, onDone }: { partnerId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<"SERVE_UNTIL_EXPIRY" | "PRORATED_REFUND" | null>(null);
  const impactQuery = useQuery({ queryKey: ["admin-partner-termination-impact", partnerId], queryFn: () => adminService.getTerminationImpact(partnerId) });
  const mutation = useMutation({
    mutationFn: () => adminService.terminatePartner(partnerId, { reason: reason.trim(), memberPolicy: policy! }),
    onSuccess: (data: any) => {
      toast.success(`Đã chấm dứt hợp tác${data.refunded > 0 ? ` — đã hoàn tiền ${data.refunded} hội viên` : ""}`);
      if (data.refundErrors?.length) toast.error(`${data.refundErrors.length} hội viên hoàn tiền thất bại — cần xử lý tay`);
      onDone(); onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể chấm dứt"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl border border-red-500/20 p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-sm font-bold text-red-400">
          <UserMinus className="w-4 h-4" /> Chấm dứt hợp tác? Không quay lại được.
        </div>

        {impactQuery.isLoading ? (
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        ) : impactQuery.data && (
          <div className="bg-zinc-800/60 rounded-lg p-3 text-xs space-y-1">
            <p className="text-zinc-400">Hiện đang có:</p>
            <p className="text-zinc-200">
              <span className="font-bold">{impactQuery.data.activeMembers}</span> hội viên còn hạn, tổng giá trị chưa dùng{" "}
              <span className="font-bold">{formatVND(impactQuery.data.unusedValueTotal)}</span>
            </p>
            <p className="text-zinc-200"><span className="font-bold">{impactQuery.data.activePtContracts}</span> hợp đồng PT đang chạy tại các chi nhánh</p>
            <p className="text-zinc-200"><span className="font-bold">{impactQuery.data.activeGyms}</span> chi nhánh đang hoạt động</p>
            <p className="text-zinc-200">Số dư ví chưa rút: <span className="font-bold">{formatVND(impactQuery.data.walletBalanceTotal)}</span></p>
          </div>
        )}

        <div>
          <p className="text-xs text-zinc-400 mb-2">Chọn cách xử lý hội viên còn hạn:</p>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
              <input type="radio" checked={policy === "SERVE_UNTIL_EXPIRY"} onChange={() => setPolicy("SERVE_UNTIL_EXPIRY")} className="mt-0.5 accent-red-500" />
              Phục vụ tới hết hạn, ngừng bán mới ngay
            </label>
            <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
              <input type="radio" checked={policy === "PRORATED_REFUND"} onChange={() => setPolicy("PRORATED_REFUND")} className="mt-0.5 accent-red-500" />
              Hoàn tiền theo tỷ lệ phần chưa dùng cho từng hội viên
            </label>
          </div>
        </div>

        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do chấm dứt (bắt buộc)..." rows={2} className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-zinc-400 border border-zinc-700 rounded-lg">Không chấm dứt</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!reason.trim() || !policy || mutation.isPending}
            className="flex-1 py-2 text-xs font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white rounded-lg"
          >
            {mutation.isPending ? "Đang xử lý..." : "Xác nhận chấm dứt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewAsPartnerModal({ partnerId, onClose }: { partnerId: string; onClose: () => void }) {
  const viewQuery = useQuery({ queryKey: ["admin-view-as-partner", partnerId], queryFn: () => adminService.viewAsPartner(partnerId) });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="max-w-lg w-full bg-zinc-900 rounded-2xl border border-blue-500/20 p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-sm font-bold text-blue-400">
          <Eye className="w-4 h-4" /> Xem dưới góc nhìn đối tác (chỉ đọc)
        </div>
        <p className="text-[11px] text-zinc-600">Hành động này đã được ghi vào nhật ký kiểm toán.</p>
        {viewQuery.isLoading ? (
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        ) : viewQuery.data && (
          <div className="text-xs text-zinc-300 space-y-2">
            <p><span className="text-zinc-500">Thương hiệu:</span> {viewQuery.data.brand?.name ?? "Chưa đặt tên"}</p>
            <p><span className="text-zinc-500">Số chi nhánh:</span> {viewQuery.data.gyms?.length ?? 0}</p>
            <div className="space-y-1">
              {(viewQuery.data.gyms ?? []).map((g: any) => (
                <div key={g.id} className="bg-zinc-800/50 rounded-lg px-3 py-2">{g.approvedName ?? g.name} — {g.status}</div>
              ))}
            </div>
          </div>
        )}
        <button onClick={onClose} className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300">Đóng</button>
      </div>
    </div>
  );
}
