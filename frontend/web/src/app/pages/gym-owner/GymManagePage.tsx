import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { BarbellIcon as Dumbbell, CircleNotchIcon as Loader2, ArrowLeftIcon as ArrowLeft, PlusIcon as Plus, XIcon as X, WalletIcon, UsersIcon as Users, ListChecksIcon as ListChecks, MoneyIcon as Banknote, GearSixIcon as Settings, LockIcon as Lock, LockOpenIcon as Unlock, WarningIcon as AlertTriangle } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymBrand, GymMembershipPlan, GymMembershipContract, Wallet, GymReviewsResponse } from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "../../components/gym/Stars";
import { GymCheckinPanel } from "../../components/gym/GymCheckinPanel";
import { CollaborationPanel } from "../../components/gym/CollaborationPanel";
import { useBackDismissible } from "../../hooks/useBackDismissible";

/** Owner-facing label for a plan's marketing window — mirrors gym-service's isPlanOnSale
 * so the badge here always matches what the public listing would actually show. */
function saleWindowLabel(plan: GymMembershipPlan): { text: string; color: string } | null {
  if (!plan.saleStartAt && !plan.saleEndAt) return null;
  const now = new Date();
  if (plan.saleStartAt && now < new Date(plan.saleStartAt)) {
    return { text: `Mở bán từ ${new Date(plan.saleStartAt).toLocaleDateString("vi-VN")}`, color: "text-blue-400" };
  }
  if (plan.saleEndAt && now > new Date(plan.saleEndAt)) {
    return { text: "Đã hết hạn bán", color: "text-zinc-500" };
  }
  const until = plan.saleEndAt ? ` đến ${new Date(plan.saleEndAt).toLocaleDateString("vi-VN")}` : "";
  return { text: `Đang mở bán${until}`, color: "text-green-400" };
}

export function GymManagePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  useBackDismissible(!!showCreatePlan, () => setShowCreatePlan(false));
  const [plan, setPlan] = useState({ name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" });
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPayoutInfo, setWithdrawPayoutInfo] = useState("");

  // Vòng 4 / Phase C2/C3/C4 — settings section: name/address (pending-approval), operational
  // status, and brand reassignment.
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [closingMode, setClosingMode] = useState<"TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED" | null>(null);

  const { data: gym, isLoading: gymLoading } = useQuery<Gym>({
    queryKey: ["owned-gym", id],
    queryFn: () => gymService.getOwnedGym(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (gym) {
      setEditName(gym.name);
      setEditAddress(gym.address);
    }
  }, [gym?.id, gym?.name, gym?.address]);

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
    mutationFn: (payload: { operationalStatus: "OPEN" | "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED"; reason?: string }) =>
      gymService.setGymOperationalStatus(id!, payload.operationalStatus, payload.reason),
    onSuccess: () => {
      toast.success("Đã cập nhật trạng thái hoạt động");
      setClosingMode(null);
      setCloseReason("");
      queryClient.invalidateQueries({ queryKey: ["owned-gym", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  const { data: wallet } = useQuery<Wallet>({
    queryKey: ["owned-gym-wallet", id],
    queryFn: () => gymService.getOwnedWallet(id!),
    enabled: !!id,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<GymMembershipPlan[]>({
    queryKey: ["owned-gym-plans", id],
    queryFn: () => gymService.listOwnedPlans(id!),
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

  const createPlanMutation = useMutation({
    mutationFn: () =>
      gymService.createPlan(id!, {
        name: plan.name,
        price: Number(plan.price),
        durationDays: Number(plan.durationDays),
        visitLimit: plan.visitLimit ? Number(plan.visitLimit) : undefined,
        saleStartAt: plan.saleStartAt || undefined,
        saleEndAt: plan.saleEndAt || undefined,
      }),
    onSuccess: () => {
      toast.success("Plan created");
      setShowCreatePlan(false);
      setPlan({ name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-gym-plans", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to create plan"),
  });

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
              </p>
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
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Thương hiệu</p>
            <select
              data-testid="gym-brand-select"
              value={gym.brandId ?? ""}
              onChange={(e) => updateGymMutation.mutate({ brandId: e.target.value || null })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            >
              <option value="">Không thuộc thương hiệu nào</option>
              {ownedBrands.map((b) => (
                <option key={b.id} value={b.id}>{b.approvedName ?? b.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2 pt-3 border-t border-zinc-800/60">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Trạng thái hoạt động</p>
            {gym.operationalStatus === "PERMANENTLY_CLOSED" ? (
              <p className="text-xs text-zinc-500">Phòng gym đã đóng cửa vĩnh viễn — không thể đổi trạng thái nữa.</p>
            ) : closingMode ? (
              <div className="space-y-2">
                <textarea
                  data-testid="gym-close-reason-input"
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="Lý do đóng cửa..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 min-h-[60px]"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setClosingMode(null); setCloseReason(""); }} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                    Huỷ
                  </button>
                  <button
                    type="button"
                    data-testid="gym-confirm-close-button"
                    onClick={() => setOperationalStatusMutation.mutate({ operationalStatus: closingMode, reason: closeReason })}
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
          onClick={() => setShowWithdrawForm((v) => !v)}
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

      {/* PT collaboration — component existed, fully built, but was never mounted on any
          page: an owner had no way to reach it at all. */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5">
        <CollaborationPanel as="GYM" gymId={id!} />
      </div>

      {/* Check-in */}
      <GymCheckinPanel gymId={id!} />

      {/* Plans */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-zinc-300 flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Membership Plans</h2>
          <button
            type="button"
            onClick={() => setShowCreatePlan(true)}
            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Plan
          </button>
        </div>
        {plansLoading ? (
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        ) : plans.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-sm text-zinc-500">No plans yet</div>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => {
              const saleWindow = saleWindowLabel(p);
              return (
                <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{p.name}</div>
                    <div className="text-xs text-zinc-600">{p.durationDays} days{p.visitLimit ? ` · ${p.visitLimit} visits` : " · unlimited"}</div>
                    {saleWindow && <div className={`text-[11px] mt-0.5 ${saleWindow.color}`}>{saleWindow.text}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${p.status === "ACTIVE" ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-zinc-700/50 border-zinc-700 text-zinc-400"}`}>
                      {p.status}
                    </span>
                    <span className="text-sm font-bold text-green-400">{formatVND(Number(p.price))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {/* Create plan dialog */}
      {showCreatePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">New Membership Plan</h3>
              <button type="button" onClick={() => setShowCreatePlan(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                aria-label="Plan name"
                value={plan.name}
                onChange={(e) => setPlan({ ...plan, name: e.target.value })}
                placeholder="Plan name (e.g. Monthly)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Price"
                type="number"
                value={plan.price}
                onChange={(e) => setPlan({ ...plan, price: e.target.value })}
                placeholder="Price (VND)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Duration in days"
                type="number"
                value={plan.durationDays}
                onChange={(e) => setPlan({ ...plan, durationDays: e.target.value })}
                placeholder="Duration (days)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Visit limit (optional)"
                type="number"
                value={plan.visitLimit}
                onChange={(e) => setPlan({ ...plan, visitLimit: e.target.value })}
                placeholder="Visit limit (blank = unlimited)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <div>
                <label className="text-xs text-zinc-500 mb-1.5 block">
                  Thời gian mở bán (tuỳ chọn — dùng cho gói khuyến mãi)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label="Sale start date"
                    type="date"
                    value={plan.saleStartAt}
                    onChange={(e) => setPlan({ ...plan, saleStartAt: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                  <input
                    aria-label="Sale end date"
                    type="date"
                    value={plan.saleEndAt}
                    onChange={(e) => setPlan({ ...plan, saleEndAt: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                </div>
                <p className="text-[11px] text-zinc-600 mt-1">Để trống cả hai = luôn mở bán.</p>
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setShowCreatePlan(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createPlanMutation.mutate()}
                disabled={!plan.name.trim() || !plan.price || createPlanMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-[background-color,opacity] flex items-center justify-center gap-2"
              >
                {createPlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
