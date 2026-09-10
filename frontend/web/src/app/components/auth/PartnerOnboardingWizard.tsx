import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CircleNotchIcon as Loader2,
  CheckIcon as Check,
  UserIcon as UserIcon,
  StorefrontIcon as Store,
  BankIcon as Bank,
  FileTextIcon as FileText,
  SignOutIcon as LogOut,
} from "@phosphor-icons/react";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";

/**
 * Phase 3 mục 3.1 — trình thiết lập lần đầu, 5 bước, không bỏ qua được. Toàn màn hình,
 * không có nút thoát (trừ "Đăng xuất" — thoát khỏi trình thiết lập KHÔNG phải là hoàn tất
 * nó). Đóng app giữa chừng, mở lại thì tiếp đúng bước đang dở — điều này tự đúng vì bước
 * hiện tại luôn tính lại từ dữ liệu đã lưu ở server (`currentStep`), không lưu ở client.
 *
 * Quản lý chi nhánh (MANAGER) chỉ thấy bước 1-2 — bước 1 (đặt mật khẩu) đã xong lúc chấp
 * nhận thư mời trước khi màn này còn xuất hiện, nên với MANAGER màn này chỉ hiện bước 2.
 */

const STEP_META = [
  { key: "contact", label: "Xác nhận liên hệ", icon: UserIcon },
  { key: "brand", label: "Đặt tên thương hiệu", icon: Store },
  { key: "payout", label: "Thông tin nhận tiền", icon: Bank },
  { key: "terms", label: "Điều khoản đối tác", icon: FileText },
] as const;

export function PartnerOnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { logout } = useApp();
  const queryClient = useQueryClient();

  const { data: progress, isLoading } = useQuery({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
  });

  const isOwner = progress?.role === "OWNER";
  const visibleSteps = isOwner ? STEP_META : STEP_META.slice(0, 1);
  const stepIndex = progress ? Math.max(0, Math.min(visibleSteps.length - 1, progress.currentStep - 2)) : 0;

  const [phone, setPhone] = useState("");
  const [brandName, setBrandName] = useState("");
  const [brandDescription, setBrandDescription] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [termsAgreed, setTermsAgreed] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["partner-onboarding-status"] });

  const onDone = (data: any) => {
    queryClient.setQueryData(["partner-onboarding-status"], data);
    if (data?.completed) onComplete();
  };

  const contactMutation = useMutation({
    mutationFn: () => gymService.submitOnboardingContact(phone),
    onSuccess: onDone,
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể lưu"),
  });
  const brandMutation = useMutation({
    mutationFn: () => gymService.submitOnboardingBrand({ name: brandName, description: brandDescription || undefined }),
    onSuccess: onDone,
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể lưu"),
  });
  const payoutMutation = useMutation({
    mutationFn: () => gymService.submitOnboardingPayout({ bankName, accountNumber, accountHolder }),
    onSuccess: onDone,
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể lưu"),
  });
  const termsMutation = useMutation({
    mutationFn: () => gymService.submitOnboardingTerms(),
    onSuccess: onDone,
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || "Không thể lưu"),
  });

  if (isLoading || !progress) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const currentKey = visibleSteps[stepIndex]?.key ?? "contact";

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-6">
        {/* Thanh tiến độ */}
        <div className="flex items-center gap-1.5">
          {visibleSteps.map((s, i) => (
            <div key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? "bg-green-500" : "bg-zinc-800"}`} />
          ))}
        </div>
        <p className="text-xs text-zinc-500 text-center -mt-3">
          Bước {stepIndex + 1}/{visibleSteps.length}
        </p>

        {currentKey === "contact" && (
          <div className="space-y-4">
            <div className="text-center">
              <UserIcon className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <h2 className="text-lg font-bold text-zinc-100">Xác nhận thông tin liên hệ</h2>
              <p className="text-xs text-zinc-500 mt-1">Số điện thoại này dùng để liên hệ khi cần thiết.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Số điện thoại *</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0900000000"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
            <button
              onClick={() => contactMutation.mutate()}
              disabled={!phone.trim() || contactMutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {contactMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Tiếp tục
            </button>
          </div>
        )}

        {currentKey === "brand" && (
          <div className="space-y-4">
            <div className="text-center">
              <Store className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <h2 className="text-lg font-bold text-zinc-100">Đặt tên thương hiệu</h2>
              <p className="text-xs text-zinc-500 mt-1">Đây là tên khách hàng sẽ nhìn thấy khi tìm phòng tập của bạn.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Tên thương hiệu *</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="VD: Gymini Fitness"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Mô tả (tuỳ chọn)</label>
              <textarea
                value={brandDescription}
                onChange={(e) => setBrandDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <p className="text-[11px] text-zinc-600 flex items-start gap-1.5">
              <FileText className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              Tên sẽ hiển thị công khai sau khi quản trị viên duyệt.
            </p>
            <button
              onClick={() => brandMutation.mutate()}
              disabled={!brandName.trim() || brandMutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {brandMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Tiếp tục
            </button>
          </div>
        )}

        {currentKey === "payout" && (
          <div className="space-y-4">
            <div className="text-center">
              <Bank className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <h2 className="text-lg font-bold text-zinc-100">Thông tin nhận tiền</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Chúng tôi cần thông tin này để chuyển doanh thu cho bạn. Bạn có thể sửa sau trong phần Cài đặt.
              </p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Ngân hàng *</label>
              <input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="VD: Vietcombank"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Số tài khoản *</label>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Tên chủ tài khoản *</label>
              <input
                value={accountHolder}
                onChange={(e) => setAccountHolder(e.target.value.toUpperCase())}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              />
            </div>
            <button
              onClick={() => payoutMutation.mutate()}
              disabled={!bankName.trim() || !accountNumber.trim() || !accountHolder.trim() || payoutMutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {payoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Tiếp tục
            </button>
          </div>
        )}

        {currentKey === "terms" && (
          <div className="space-y-4">
            <div className="text-center">
              <FileText className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <h2 className="text-lg font-bold text-zinc-100">Điều khoản đối tác</h2>
              <p className="text-xs text-zinc-500 mt-1">Đọc kỹ trước khi bắt đầu vận hành trên nền tảng.</p>
            </div>
            <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3 max-h-40 overflow-y-auto text-xs text-zinc-400 leading-relaxed">
              Đối tác chịu trách nhiệm về tính chính xác của thông tin phòng tập, gói hội viên và
              nghĩa vụ thuế phát sinh. Nền tảng thu chiết khấu trên mỗi giao dịch thành công theo mức
              đã công bố. Vi phạm điều khoản sử dụng có thể dẫn đến tạm khoá hoặc chấm dứt hợp tác.
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={termsAgreed} onChange={(e) => setTermsAgreed(e.target.checked)} className="accent-green-500" />
              Tôi đã đọc và đồng ý với điều khoản đối tác.
            </label>
            <button
              onClick={() => termsMutation.mutate()}
              disabled={!termsAgreed || termsMutation.isPending}
              className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black px-4 py-2.5 rounded-lg text-sm font-bold transition-all"
            >
              {termsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Hoàn tất thiết lập
            </button>
          </div>
        )}

        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors pt-1"
        >
          <LogOut className="w-3.5 h-3.5" /> Đăng xuất
        </button>
      </div>
    </div>
  );
}
