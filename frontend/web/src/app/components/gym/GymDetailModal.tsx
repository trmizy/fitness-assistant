import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  BarbellIcon as Dumbbell,
  MapPinIcon as MapPin,
  CircleNotchIcon as Loader2,
  CheckCircleIcon as CheckCircle,
  WarningIcon as AlertTriangle,
  XIcon as X,
  PhoneIcon as Phone,
  EnvelopeSimpleIcon as Mail,
} from "@phosphor-icons/react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { openPaymentGateway } from "../../services/paymentGateway";
import { toast } from "sonner";
import type { Gym, GymMembershipPlan } from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "./Stars";
import { GymReviewsSection } from "./GymReviewsSection";
import { PaymentMethodDialog } from "../payment/PaymentMethodDialog";
import { useBackDismissible } from "../../hooks/useBackDismissible";

/**
 * Trang tìm PT đã dùng modal 3 tab (Chi tiết/Giá gói/Đánh giá) từ lâu — tìm phòng gym vẫn
 * điều hướng hẳn sang trang khác, phải mở lại danh sách mới xem được phòng khác. Chuyển
 * sang cùng khuôn mẫu: modal portal-to-body, responsive (dialog giữa màn hình trên desktop,
 * bottom-sheet trên mobile) y hệt PTDiscoveryPage's chi tiết PT.
 *
 * Toàn bộ logic mua gói/cảnh báo nhiều phòng gym/thanh toán giữ nguyên xi từ
 * GymDetailPage.tsx cũ (route /client/gyms/:id giờ chỉ còn redirect — xem routes.tsx).
 */
export function GymDetailModal({ gymId, onClose }: { gymId: string; onClose: () => void }) {
  const navigate = useNavigate();
  useBackDismissible(true, onClose);

  const [isDesktopView, setIsDesktopView] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktopView(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const [tab, setTab] = useState<"detail" | "pricing" | "reviews">("detail");
  useEffect(() => setTab("detail"), [gymId]);

  const [buyTarget, setBuyTarget] = useState<GymMembershipPlan | null>(null);
  const [warningTarget, setWarningTarget] = useState<GymMembershipPlan | null>(null);
  useBackDismissible(!!warningTarget, () => setWarningTarget(null));
  const [referralCode, setReferralCode] = useState("");

  const { data: gym, isLoading: gymLoading } = useQuery<Gym>({
    queryKey: ["gym", gymId],
    queryFn: () => gymService.getGym(gymId),
  });
  const { data: plans = [], isLoading: plansLoading } = useQuery<GymMembershipPlan[]>({
    queryKey: ["gym-plans", gymId],
    queryFn: () => gymService.listPlans(gymId),
  });
  const { data: multiGymWarnings = [] } = useQuery({
    queryKey: ["membership-warnings", gymId],
    queryFn: () => gymService.getMembershipWarnings(gymId),
  });

  const startBuy = (plan: GymMembershipPlan) => {
    if (multiGymWarnings.length > 0) setWarningTarget(plan);
    else setBuyTarget(plan);
  };

  const buyMutation = useMutation({
    mutationFn: ({ planId, provider }: { planId: string; provider: string }) =>
      gymService.buyMembership(gymId, planId, provider, referralCode.trim() || undefined, multiGymWarnings.length > 0),
    onSuccess: (result: any) => {
      const payment = result?.data?.payment ?? result?.payment;
      if (payment?.status === "PAID") {
        toast.success("Đã mua gói — chúc bạn tập luyện vui vẻ!");
        onClose();
        navigate("/client/gym-memberships");
        return;
      }
      if (payment?.redirectUrl) {
        void openPaymentGateway({ url: payment.redirectUrl, transactionId: payment.transactionId, navigate });
        return;
      }
      toast.error(payment?.failureReason || "Không tạo được giao dịch thanh toán — thử lại từ Hội viên gym của bạn");
      setBuyTarget(null);
      onClose();
      navigate("/client/gym-memberships");
    },
    onError: (err: any) => {
      setBuyTarget(null);
      const code = err?.response?.data?.error?.code;
      if (code === "ALREADY_HAS_PENDING_MEMBERSHIP") {
        toast.error("Bạn đang có gói chưa thanh toán ở phòng gym này — hoàn tất trước đã.");
        onClose();
        navigate("/client/gym-memberships");
        return;
      }
      if (code === "ALREADY_HAS_OPEN_MEMBERSHIP") {
        toast.error("Bạn đã có gói đang hoạt động ở phòng gym này.");
        return;
      }
      const referralMessages: Record<string, string> = {
        REFERRAL_CODE_NOT_FOUND: "Mã giới thiệu không tồn tại",
        CANNOT_REFER_YOURSELF: "Bạn không thể tự giới thiệu chính mình",
        REFERRAL_NOT_APPLICABLE_AT_THIS_GYM: "Mã giới thiệu này không áp dụng cho phòng tập bạn đang chọn",
        REFERRAL_ONLY_FOR_FIRST_MEMBERSHIP: "Mã giới thiệu chỉ áp dụng cho lần mua gói đầu tiên tại phòng gym này",
      };
      toast.error(referralMessages[code] || code || "Không mua được gói");
    },
  });

  const content = gymLoading || !gym ? (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
    </div>
  ) : (
    <>
      {/* Header */}
      <div className="p-5 border-b border-zinc-800/60">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <Dumbbell className="w-6 h-6 text-green-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-zinc-100 truncate">{gym.name}</h2>
              <div className="flex items-center gap-1 text-xs text-zinc-500 mt-0.5">
                <MapPin className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{gym.address}{gym.city ? `, ${gym.city}` : ""}</span>
              </div>
              {typeof gym.reviewCount === "number" && gym.reviewCount > 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
                  <Stars value={gym.averageRating ?? 0} /> {(gym.averageRating ?? 0).toFixed(1)}{" "}
                  <span className="text-zinc-600">({gym.reviewCount} đánh giá)</span>
                </div>
              ) : (
                <span className="text-xs text-zinc-600">Chưa có đánh giá</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors flex-shrink-0" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/60 border-b border-zinc-700/40 p-1">
        {(
          [
            { key: "detail", label: "Chi tiết" },
            { key: "pricing", label: "Giá gói" },
            { key: "reviews", label: "Bình luận" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.key ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-5">
        {tab === "detail" && (
          <>
            {gym.description && <p className="text-sm text-zinc-400 leading-relaxed">{gym.description}</p>}
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-zinc-400">
                <MapPin className="w-4 h-4 text-zinc-600 flex-shrink-0" /> {gym.address}{gym.city ? `, ${gym.city}` : ""}
              </div>
              {gym.phone && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Phone className="w-4 h-4 text-zinc-600 flex-shrink-0" /> {gym.phone}
                </div>
              )}
              {gym.email && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Mail className="w-4 h-4 text-zinc-600 flex-shrink-0" /> {gym.email}
                </div>
              )}
            </div>
            {!gym.description && !gym.phone && !gym.email && (
              <p className="text-sm text-zinc-600">Phòng gym chưa cập nhật thêm thông tin mô tả.</p>
            )}
          </>
        )}

        {tab === "pricing" && (
          <>
            {plans.length > 0 && (
              <div>
                <label htmlFor="referral-code" className="text-xs font-semibold text-zinc-500 mb-1 block">
                  Mã giới thiệu (không bắt buộc)
                </label>
                <input
                  id="referral-code"
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="VD: HUY2ABC"
                  maxLength={16}
                  className="w-full sm:w-64 px-3 py-2 bg-zinc-900 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 font-mono tracking-wider"
                />
              </div>
            )}
            {plansLoading ? (
              <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
            ) : plans.length === 0 ? (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-8 text-center text-sm text-zinc-500">
                Chưa có gói hội viên nào.
              </div>
            ) : (
              <div className="space-y-3">
                {plans.map((p) => (
                  <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-zinc-200">{p.name}</div>
                      {p.description && <div className="text-xs text-zinc-500 mt-0.5">{p.description}</div>}
                      <div className="text-xs text-zinc-600 mt-1">
                        {p.durationDays} ngày{p.visitLimit ? ` · ${p.visitLimit} lượt` : " · không giới hạn lượt"}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-green-400 mb-2">{formatVND(Number(p.price))}</div>
                      <button
                        type="button"
                        onClick={() => startBuy(p)}
                        disabled={buyMutation.isPending}
                        className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                      >
                        {buyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        Mua
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "reviews" && <GymReviewsSection gymId={gymId} />}
      </div>
    </>
  );

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex justify-center ${isDesktopView ? "items-center p-4" : "items-end"}`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={
          isDesktopView
            ? "w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800/60 bg-zinc-900 shadow-2xl"
            : "w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-zinc-800/60 bg-zinc-900"
        }
      >
        {content}
      </div>

      {warningTarget && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.stopPropagation()} role="presentation">
          <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <h3 className="text-zinc-100 font-bold">Bạn đang có gói ở phòng gym khác</h3>
            </div>
            <div className="p-5 space-y-2 text-sm text-zinc-300">
              <p className="text-zinc-400">Bạn hoàn toàn có thể là hội viên nhiều phòng gym cùng lúc — chỉ là một lời nhắc trước khi mua thêm:</p>
              <ul className="space-y-1.5">
                {multiGymWarnings.map((w) => (
                  <li key={w.gymId} className="rounded-lg bg-zinc-800/60 px-3 py-2">
                    <span className="font-semibold text-zinc-200">{w.gymName}</span>
                    <span className="text-zinc-500"> — còn hiệu lực đến {new Date(w.endDate).toLocaleDateString("vi-VN")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setWarningTarget(null)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Để sau
              </button>
              <button
                type="button"
                onClick={() => { setBuyTarget(warningTarget); setWarningTarget(null); }}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all"
              >
                Vẫn tiếp tục mua
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {buyTarget && createPortal(
        <div className="fixed inset-0 z-[70]" onClick={(e) => e.stopPropagation()}>
          <PaymentMethodDialog
            amount={Number(buyTarget.price)}
            title="Chọn phương thức thanh toán gói tập"
            isSubmitting={buyMutation.isPending}
            onClose={() => setBuyTarget(null)}
            onConfirm={(provider) => buyMutation.mutate({ planId: buyTarget.id, provider })}
          />
        </div>,
        document.body,
      )}
    </div>,
    document.body,
  );
}
