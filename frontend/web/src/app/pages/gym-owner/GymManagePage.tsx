import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, ArrowLeftIcon as ArrowLeft, WalletIcon, UsersIcon as Users, MoneyIcon as Banknote, GearSixIcon as Settings, LockIcon as Lock, LockOpenIcon as Unlock, WarningIcon as AlertTriangle, CaretDownIcon as ChevronDown } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymBrand, GymMembershipContract, Wallet, GymReviewsResponse, GymOperatingHoursDay, GymFacility } from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "../../components/gym/Stars";
import { GymCheckinPanel } from "../../components/gym/GymCheckinPanel";
import { CollaborationPanel } from "../../components/gym/CollaborationPanel";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import { GymLocationFields, type GymLocationValue } from "../../components/gym/GymLocationFields";
import { RequestChangesPanel } from "../../components/gym-management/RequestChangesPanel";
import { StepOpeningHours } from "../../components/gym/AddBranchWizard/StepOpeningHours";
import { StepFacilities } from "../../components/gym/AddBranchWizard/StepFacilities";
import { StepPhotos } from "../../components/gym/AddBranchWizard/StepPhotos";
import { StepVerification } from "../../components/gym/AddBranchWizard/StepVerification";

const ALL_WEEK_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
function defaultHours(gymId: string): GymOperatingHoursDay[] {
  return ALL_WEEK_DAYS.map((day) => ({ id: null, gymId, day, type: "CLOSED", openMinute: null, closeMinute: null }));
}

/** GYM_BRANCH_FORM_SPEC.md, Phase 5 — a plain expand/collapse section, same visual language
 * as the existing "Tên & địa chỉ"/"Vị trí"/"Trạng thái hoạt động" settings blocks but for the
 * 4 domains that used to only be editable inside the DRAFT-only wizard (§74: all 4 are free
 * edit regardless of approval status, so nothing here needs a pending/approval overlay). */
function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pt-3 border-t border-zinc-800/60">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{title}</p>
        <ChevronDown className={`w-4 h-4 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function GymManagePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPayoutInfo, setWithdrawPayoutInfo] = useState("");

  // Vòng 4 / Phase C2/C3/C4 — settings section: name/address (pending-approval), operational
  // status, and brand reassignment.
  // Đi từ trang Hồ sơ ("Sửa ảnh, giới thiệu, giờ mở cửa") → ?settings=1 mở sẵn phần cài đặt.
  const [searchParams] = useSearchParams();
  const [showSettings, setShowSettings] = useState(searchParams.get("settings") === "1");
  const [editDescription, setEditDescription] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editLocation, setEditLocation] = useState<GymLocationValue>({ provinceCode: null, wardCode: null, latitude: null, longitude: null });
  const [editLocationNote, setEditLocationNote] = useState("");
  const [editFacilities, setEditFacilities] = useState<GymFacility[]>([]);
  const [closeReason, setCloseReason] = useState("");
  const [closingMode, setClosingMode] = useState<"TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED" | null>(null);
  // GYM_MANAGEMENT master spec §61 — owner-entered expected reopen date, only meaningful for
  // TEMPORARILY_CLOSED (Phase 1 backend already supports this; no UI consumed it until now).
  const [closeReopenDate, setCloseReopenDate] = useState("");

  const { data: gym, isLoading: gymLoading } = useQuery<Gym>({
    queryKey: ["owned-gym", id],
    queryFn: () => gymService.getOwnedGym(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (gym) {
      setEditName(gym.name);
      setEditAddress(gym.address);
      setEditLocation({
        provinceCode: gym.provinceCode ?? null,
        wardCode: gym.wardCode ?? null,
        latitude: gym.latitude ?? null,
        longitude: gym.longitude ?? null,
      });
      setEditLocationNote(gym.locationNote ?? "");
      setEditFacilities(gym.facilities ?? []);
      setEditDescription(gym.description ?? "");
      setEditPhone(gym.phone ?? "");
      setEditEmail(gym.email ?? "");
    }
  }, [gym?.description, gym?.phone, gym?.email, gym?.id, gym?.name, gym?.address, gym?.provinceCode, gym?.wardCode, gym?.latitude, gym?.longitude, gym?.locationNote, gym?.facilities]);

  // GYM_BRANCH_FORM_SPEC.md, Phase 5 — same hours endpoints the wizard's Step 3 already
  // uses (§74: free edit regardless of DRAFT/APPROVED status).
  const { data: hours } = useQuery<GymOperatingHoursDay[]>({
    queryKey: ["owned-gym-hours", id],
    queryFn: () => gymService.getGymHours(id!),
    enabled: !!id,
  });
  const setHoursMutation = useMutation({
    mutationFn: (days: GymOperatingHoursDay[]) => gymService.setGymHours(id!, days),
    onSuccess: () => {
      toast.success("Đã lưu giờ hoạt động");
      queryClient.invalidateQueries({ queryKey: ["owned-gym-hours", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể lưu giờ hoạt động"),
  });

  // GYM_BRANCH_FORM_SPEC.md, Phase 5 — permanent-closure impact summary (§9 of
  // GYM_BRANCH_FORM_API_GAPS.md), fetched only once the owner actually opens that flow.
  const { data: closureImpact, isLoading: closureImpactLoading } = useQuery({
    queryKey: ["owned-gym-closure-impact", id],
    queryFn: () => gymService.getClosureImpact(id!),
    enabled: !!id && closingMode === "PERMANENTLY_CLOSED",
  });

  const { data: ownedBrands = [] } = useQuery<GymBrand[]>({
    queryKey: ["owned-brands"],
    queryFn: () => gymService.listOwnedBrands(),
  });

  const updateGymMutation = useMutation({
    mutationFn: (payload: Parameters<typeof gymService.updateGym>[1]) => gymService.updateGym(id!, payload),
    onSuccess: () => {
      toast.success("Đã lưu — thay đổi tên/địa chỉ sẽ hiển thị công khai sau khi admin duyệt");
      queryClient.invalidateQueries({ queryKey: ["owned-gym", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể lưu thay đổi"),
  });

  const setOperationalStatusMutation = useMutation({
    mutationFn: (payload: { operationalStatus: "OPEN" | "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED"; reason?: string; expectedReopenAt?: string }) =>
      gymService.setGymOperationalStatus(id!, payload.operationalStatus, payload.reason, payload.expectedReopenAt),
    onSuccess: () => {
      toast.success("Đã cập nhật trạng thái hoạt động");
      setClosingMode(null);
      setCloseReason("");
      setCloseReopenDate("");
      queryClient.invalidateQueries({ queryKey: ["owned-gym", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const { data: wallet } = useQuery<Wallet>({
    queryKey: ["owned-gym-wallet", id],
    queryFn: () => gymService.getOwnedWallet(id!),
    enabled: !!id,
  });

  const { data: memberships = [] } = useQuery<GymMembershipContract[]>({
    queryKey: ["owned-gym-memberships", id],
    queryFn: () => gymService.listOwnedMemberships(id!),
    enabled: !!id,
  });

  const { data: reviews } = useQuery<GymReviewsResponse>({
    queryKey: ["gym-reviews", id],
    queryFn: () => gymService.getGymReviews(id!),
    enabled: !!id,
  });

  // Money-flow plan 5.3 — manual withdrawal flow. Requesting only creates a PENDING row; no
  // money moves until an admin confirms a real bank transfer and marks it paid.
  const { data: gymWithdrawals = [] } = useQuery<any[]>({
    queryKey: ["owned-gym-withdrawals", id],
    queryFn: () => gymService.listGymWithdrawals(id!),
    enabled: !!id,
  });

  const { data: onboarding } = useQuery<{ payout?: { bankName: string | null; accountNumber: string | null; accountHolder: string | null } | null }>({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const savedPayout = onboarding?.payout?.accountNumber
    ? [onboarding.payout.bankName, onboarding.payout.accountNumber, onboarding.payout.accountHolder].filter(Boolean).join(" — ")
    : "";

  const withdrawMutation = useMutation({
    mutationFn: () => gymService.requestGymWithdrawal(id!, withdrawAmount, withdrawPayoutInfo),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu rút tiền");
      setShowWithdrawForm(false);
      setWithdrawAmount("");
      setWithdrawPayoutInfo("");
      queryClient.invalidateQueries({ queryKey: ["owned-gym-withdrawals", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể tạo yêu cầu rút tiền"),
  });

  const openGymWithdrawals = gymWithdrawals.filter((w) => w.status === "PENDING" || w.status === "APPROVED");
  // Money-flow §16: PENDING/APPROVED are not an eligibility gate — the balance was already
  // withdrawable the moment the request was created. Both states just mean "an admin still
  // has to physically send a bank transfer" (no payout API is integrated); APPROVED only
  // means that transfer's amount has been reserved so nothing else can eat into it meanwhile.
  const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
    PENDING: "Đang chờ xử lý — sẽ chuyển khoản thủ công",
    APPROVED: "Đã giữ chỗ — đang chờ chuyển khoản",
    PAID: "Đã chi trả",
    REJECTED: "Bị từ chối",
  };

  if (gymLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!gym) {
    return <div className="p-6 max-w-3xl mx-auto text-center text-zinc-500">Gym not found</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <button type="button" onClick={() => navigate("/gym-owner/gyms")} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-4 h-4" /> Back to my gyms
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Dumbbell className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">{gym.name}</h1>
            <div className="text-xs text-zinc-500">{gym.address}{gym.city ? `, ${gym.city}` : ""}</div>
            {reviews && reviews.count > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
                <Stars value={reviews.averageRating} /> {reviews.averageRating.toFixed(1)} ({reviews.count} đánh giá)
              </div>
            )}
            {(gym.pendingName || gym.pendingAddress) && (
              <p data-testid="gym-pending-approval-hint" className="text-[11px] text-amber-400 mt-1">
                {gym.pendingName && <>Tên mới đang chờ duyệt: <strong>{gym.pendingName}</strong>. </>}
                {gym.pendingAddress && <>Địa chỉ mới đang chờ duyệt: <strong>{gym.pendingAddress}</strong>.</>}
              </p>
            )}
            {gym.operationalStatus && gym.operationalStatus !== "OPEN" && (
              <p data-testid="gym-operational-status-badge" data-status={gym.operationalStatus} className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {gym.operationalStatus === "TEMPORARILY_CLOSED" ? "Đang tạm đóng cửa" : "Đã đóng cửa vĩnh viễn"}
                {gym.closureReason ? ` — ${gym.closureReason}` : ""}
                {gym.operationalStatus === "TEMPORARILY_CLOSED" && gym.expectedReopenAt
                  ? ` · Dự kiến mở lại: ${new Date(gym.expectedReopenAt).toLocaleDateString("vi-VN")}`
                  : ""}
              </p>
            )}
            {(gym.pendingNameNote || gym.pendingAddressNote) && (
              <div className="mt-2">
                <RequestChangesPanel mode="view" nameNote={gym.pendingNameNote} addressNote={gym.pendingAddressNote} />
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          data-testid="gym-settings-toggle"
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Settings className="w-3.5 h-3.5" /> Cài đặt
        </button>
      </div>

      {/* Settings — Vòng 4 / Phase C2/C3/C4 */}
      {showSettings && (
        <div data-testid="gym-settings-panel" className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Tên & địa chỉ</p>
            <p className="text-[11px] text-zinc-600">
              Đổi tên/địa chỉ ở đây không hiển thị công khai ngay — phải chờ admin duyệt. Trong
              lúc chờ, phòng gym vẫn bán gói và cho check-in bình thường.
            </p>
            <input
              data-testid="gym-edit-name-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <input
              data-testid="gym-edit-address-input"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <button
              type="button"
              data-testid="gym-save-name-address-button"
              onClick={() => updateGymMutation.mutate({ name: editName, address: editAddress })}
              disabled={!editName.trim() || !editAddress.trim() || updateGymMutation.isPending}
              className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-black text-xs font-bold rounded-lg transition-all"
            >
              Lưu
            </button>
          </div>

          <div className="space-y-2 pt-3 border-t border-zinc-800/60">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Giới thiệu & liên hệ</p>
            <p className="text-[11px] text-zinc-600">Hiện ở mục "Chi tiết" khi khách xem chi nhánh. Có hiệu lực ngay, không cần admin duyệt.</p>
            <textarea
              data-testid="gym-edit-description-input"
              aria-label="Giới thiệu chi nhánh"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Không gian, thiết bị, lớp tập, đội ngũ huấn luyện viên…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                data-testid="gym-edit-phone-input"
                aria-label="Điện thoại chi nhánh"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                inputMode="tel"
                maxLength={20}
                placeholder="Điện thoại chi nhánh"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
              />
              <input
                data-testid="gym-edit-email-input"
                aria-label="Email chi nhánh"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                inputMode="email"
                maxLength={200}
                placeholder="Email chi nhánh"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
              />
            </div>
            <button
              type="button"
              data-testid="gym-save-about-button"
              onClick={() => updateGymMutation.mutate({ description: editDescription.trim(), phone: editPhone.trim(), email: editEmail.trim() })}
              disabled={updateGymMutation.isPending}
              className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-black text-xs font-bold rounded-lg transition-all"
            >
              Lưu giới thiệu & liên hệ
            </button>
          </div>

          {/* GYM_BRANCH_FORM_SPEC.md §51/§79/§89 — read-only context, never a selector. A
              branch permanently belongs to the owner's one brand; there is no "Đổi thương
              hiệu" action anywhere (this used to be a live <select> that could detach a
              branch or reassign it to another owned brand — removed as a direct
              invariant violation, confirmed with the user before removing it). */}
          <div className="space-y-2 pt-3 border-t border-zinc-800/60">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Thương hiệu</p>
            <p className="text-sm text-zinc-300">
              {ownedBrands[0] ? (ownedBrands[0].approvedName ?? ownedBrands[0].name) : "Chưa thiết lập thương hiệu"}
            </p>
          </div>

          <div className="space-y-2 pt-3 border-t border-zinc-800/60">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Vị trí</p>
            <p className="text-[11px] text-zinc-600">
              Dùng để khách tìm được chi nhánh này theo tỉnh/thành và thấy đúng chi nhánh gần
              mình nhất. Có hiệu lực ngay, không cần admin duyệt.
            </p>
            <GymLocationFields value={editLocation} onChange={setEditLocation} />
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Hướng dẫn tới nơi (tuỳ chọn)</label>
              <input
                value={editLocationNote}
                onChange={(e) => setEditLocationNote(e.target.value)}
                placeholder="Ví dụ: Toà nhà màu xanh, cổng sau, tầng 3"
                maxLength={300}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
              />
            </div>
            <button
              type="button"
              onClick={() => updateGymMutation.mutate({ ...editLocation, locationNote: editLocationNote })}
              disabled={updateGymMutation.isPending}
              className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-black text-xs font-bold rounded-lg transition-all"
            >
              Lưu vị trí
            </button>
          </div>

          <CollapsibleSection title="Giờ hoạt động">
            <StepOpeningHours
              value={hours ?? defaultHours(id!)}
              onChange={(next) => setHoursMutation.mutate(next)}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Tiện ích & Dịch vụ">
            <StepFacilities
              value={editFacilities}
              onChange={(next) => {
                setEditFacilities(next);
                updateGymMutation.mutate({ facilities: next });
              }}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Hình ảnh">
            <StepPhotos gymId={id!} />
          </CollapsibleSection>

          <CollapsibleSection title="Xác minh">
            <StepVerification gymId={id!} />
          </CollapsibleSection>

          <div className="space-y-2 pt-3 border-t border-zinc-800/60">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Trạng thái hoạt động</p>
            {gym.operationalStatus === "PERMANENTLY_CLOSED" ? (
              <p className="text-xs text-zinc-500">Phòng gym đã đóng cửa vĩnh viễn — không thể đổi trạng thái nữa.</p>
            ) : closingMode ? (
              <div className="space-y-2">
                {closingMode === "PERMANENTLY_CLOSED" && (
                  <div data-testid="gym-closure-impact-summary" className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5" /> Ảnh hưởng khi đóng cửa vĩnh viễn
                    </p>
                    {closureImpactLoading ? (
                      <Loader2 className="w-4 h-4 text-zinc-600 animate-spin" />
                    ) : closureImpact ? (
                      <ul className="text-xs text-zinc-400 space-y-0.5">
                        <li>
                          <span className="text-zinc-200 font-semibold">{closureImpact.activeMembers}</span> hội viên đang có gói hiệu lực
                          {closureImpact.unusedValueTotal > 0 && (
                            <> — tổng giá trị chưa dùng ước tính <span className="text-zinc-200 font-semibold">{formatVND(closureImpact.unusedValueTotal)}</span></>
                          )}
                        </li>
                        <li><span className="text-zinc-200 font-semibold">{closureImpact.activeCollaborations}</span> cộng tác PT đang hoạt động tại chi nhánh này</li>
                        <li>Số dư ví hiện tại: <span className="text-zinc-200 font-semibold">{formatVND(closureImpact.walletBalance)}</span></li>
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-600">Không thể tải số liệu ảnh hưởng — vẫn có thể tiếp tục.</p>
                    )}
                    <p className="text-[11px] text-zinc-600">
                      Hành động này không thể hoàn tác. Hội viên đang hoạt động sẽ được Gymini xem xét hoàn tiền riêng, không tự động ngay lúc này.
                    </p>
                  </div>
                )}
                <textarea
                  data-testid="gym-close-reason-input"
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="Lý do đóng cửa..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 min-h-[60px]"
                />
                {closingMode === "TEMPORARILY_CLOSED" && (
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-500">Ngày dự kiến mở lại (không bắt buộc)</span>
                    <input
                      type="date"
                      data-testid="gym-close-reopen-date-input"
                      value={closeReopenDate}
                      onChange={(e) => setCloseReopenDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
                    />
                  </label>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setClosingMode(null); setCloseReason(""); setCloseReopenDate(""); }} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                    Huỷ
                  </button>
                  <button
                    type="button"
                    data-testid="gym-confirm-close-button"
                    onClick={() =>
                      setOperationalStatusMutation.mutate({
                        operationalStatus: closingMode,
                        reason: closeReason,
                        ...(closingMode === "TEMPORARILY_CLOSED" && closeReopenDate ? { expectedReopenAt: closeReopenDate } : {}),
                      })
                    }
                    disabled={!closeReason.trim() || setOperationalStatusMutation.isPending}
                    className="px-4 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-all"
                  >
                    Xác nhận {closingMode === "TEMPORARILY_CLOSED" ? "tạm đóng cửa" : "đóng cửa vĩnh viễn"}
                  </button>
                </div>
              </div>
            ) : gym.operationalStatus === "TEMPORARILY_CLOSED" ? (
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  data-testid="gym-reopen-button"
                  onClick={() => setOperationalStatusMutation.mutate({ operationalStatus: "OPEN" })}
                  disabled={setOperationalStatusMutation.isPending}
                  className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                >
                  <Unlock className="w-3.5 h-3.5" /> Mở lại
                </button>
                <button
                  type="button"
                  data-testid="gym-permanently-close-toggle"
                  onClick={() => setClosingMode("PERMANENTLY_CLOSED")}
                  className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" /> Đóng cửa vĩnh viễn
                </button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  data-testid="gym-temporarily-close-toggle"
                  onClick={() => setClosingMode("TEMPORARILY_CLOSED")}
                  className="flex items-center gap-1.5 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" /> Tạm đóng cửa
                </button>
                <button
                  type="button"
                  data-testid="gym-permanently-close-toggle"
                  onClick={() => setClosingMode("PERMANENTLY_CLOSED")}
                  className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" /> Đóng cửa vĩnh viễn
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Wallet */}
      <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <WalletIcon className="w-5 h-5 text-green-400" />
          <div>
            <div className="text-xs text-zinc-400">Có thể rút</div>
            <div data-testid="gym-wallet-available-balance" data-value={wallet?.availableBalance ?? "0"} className="text-xl font-bold text-zinc-100">{formatVND(Number(wallet?.availableBalance ?? 0))}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Đang chờ (gói hội viên chưa kết thúc)</div>
          <div className="text-base font-semibold text-amber-400">{formatVND(Number(wallet?.pendingBalance ?? 0))}</div>
        </div>
        <button
          data-testid="gym-request-withdrawal-toggle"
          onClick={() => {
            setShowWithdrawForm((v) => !v);
            if (!withdrawPayoutInfo) setWithdrawPayoutInfo(savedPayout);
          }}
          className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
        >
          <Banknote className="w-3.5 h-3.5" /> Yêu cầu rút tiền
        </button>

        {showWithdrawForm && (
          <div className="w-full bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-3.5 space-y-2">
            <input
              data-testid="gym-withdraw-amount-input"
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Số tiền (VNĐ)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <input
              data-testid="gym-withdraw-payout-info-input"
              value={withdrawPayoutInfo}
              onChange={(e) => setWithdrawPayoutInfo(e.target.value)}
              placeholder="Số tài khoản / ngân hàng nhận tiền"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowWithdrawForm(false)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                Huỷ
              </button>
              <button
                data-testid="gym-withdraw-submit-button"
                onClick={() => withdrawMutation.mutate()}
                disabled={!withdrawAmount || !withdrawPayoutInfo.trim() || withdrawMutation.isPending}
                className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-lg transition-all"
              >
                Gửi yêu cầu
              </button>
            </div>
          </div>
        )}

        {openGymWithdrawals.length > 0 && (
          <div data-testid="gym-open-withdrawal-requests" className="w-full space-y-1.5">
            {openGymWithdrawals.map((w) => (
              <div key={w.id} data-testid="gym-withdrawal-request-row" data-status={w.status} data-amount={w.amount} className="flex items-center justify-between text-xs bg-zinc-900/60 border border-zinc-800/60 rounded-lg px-3 py-2">
                <span className="text-zinc-400">{formatVND(Number(w.amount))}</span>
                <span className="text-amber-400 font-medium">{WITHDRAWAL_STATUS_LABEL[w.status] ?? w.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Check-in */}
      <GymCheckinPanel gymId={id!} />

      {/* PT collaboration for THIS branch specifically — proposing/inviting only makes sense
          in a specific gym's context, which is why this stays here even though there is now
          also a brand-wide aggregate view (see GymCollaborationsPage.tsx, reachable from the
          "Quản lý cộng tác" nav entry) for just glancing at every branch's offers at once
          without hunting through each gym's own page. */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5">
        <CollaborationPanel as="GYM" gymId={id!} />
      </div>

      {/* Plans moved to their own top-level page — a plan is sold by the BRAND now (see
          GymPlansPage.tsx), not this one branch, so there is nothing gym-specific left to
          manage here. */}
      <button
        type="button"
        onClick={() => navigate("/gym-owner/plans")}
        className="w-full flex items-center justify-between bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 hover:border-green-500/40 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-zinc-300">
          Gói hội viên được quản lý chung cho cả thương hiệu
        </span>
        <span className="text-xs font-semibold text-green-400 shrink-0">Quản lý gói →</span>
      </button>

      {/* Memberships */}
      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2 flex items-center gap-1.5"><Users className="w-4 h-4" /> Members ({memberships.length})</h2>
        {memberships.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-sm text-zinc-500">No members yet</div>
        ) : (
          <div className="space-y-2">
            {memberships.map((m) => (
              <div key={m.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 flex items-center justify-between">
                <div>
                  <div className="text-xs text-zinc-500">{m.clientId.slice(0, 8)}...</div>
                  {m.status === "ACTIVE" && (
                    <div className="text-[11px] text-zinc-600 mt-0.5">
                      {m.totalVisits != null ? `Lượt: ${m.usedVisits}/${m.totalVisits}` : `Lượt đã vào: ${m.usedVisits} · không giới hạn`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                    m.status === "ACTIVE" ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : m.status === "PENDING_PAYMENT" ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                    : "bg-zinc-700/50 border-zinc-700 text-zinc-400"
                  }`}>
                    {m.status}
                  </span>
                  <span className="text-sm font-bold text-green-400">{formatVND(Number(m.priceAtPurchase))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
