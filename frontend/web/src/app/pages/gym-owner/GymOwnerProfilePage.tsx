import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BuildingsIcon as Buildings,
  StorefrontIcon as Storefront,
  PhoneIcon as Phone,
  BankIcon as Bank,
  KeyIcon as KeyRound,
  CheckIcon as Check,
  CircleNotchIcon as Loader2,
  EyeIcon as Eye,
  EyeSlashIcon as EyeOff,
  CaretRightIcon as ChevronRight,
} from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { authService, gymService } from "../../services/api";
import type { Gym, GymBrand } from "../../types";
import { SectionCard } from "../client/settings/components/SectionCard";
import { SOCIALS, type SocialKey } from "../../components/gym/SocialLinks";

const inputCls =
  "w-full px-3 py-2.5 border border-zinc-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 bg-zinc-800/60 text-zinc-200 disabled:opacity-60 transition-all";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-green-500 px-4 py-2 text-sm font-bold text-black hover:bg-green-400 disabled:opacity-50";

type Payout = { bankName: string | null; accountNumber: string | null; accountHolder: string | null };
type OnboardingStatus = { role: "OWNER" | "MANAGER"; hasPartnerAccount?: boolean; contactPhone?: string | null; payout?: Payout | null };

const errMessage = (e: any, fallback: string) => {
  const err = e?.response?.data?.error;
  return (typeof err === "string" ? err : err?.message) || fallback;
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Đang hiển thị",
  PENDING: "Chờ duyệt",
  DRAFT: "Bản nháp",
  REJECTED: "Bị từ chối",
  SUSPENDED: "Tạm khoá",
};

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-zinc-400">{children}</span>;
}

/**
 * Hồ sơ của chủ gym / quản lý chi nhánh. Với đối tác, "danh tính" là THƯƠNG HIỆU chứ không phải họ tên
 * cá nhân — nên trang mở đầu bằng thương hiệu, rồi tới những gì chỉ người đăng nhập mới sửa được:
 *   - Thương hiệu: tên (đổi tên chờ admin duyệt), giới thiệu, mạng xã hội — chỉ chủ sở hữu.
 *   - Chi nhánh: lối tắt tới trang cài đặt từng chi nhánh (ảnh, giới thiệu, giờ mở cửa, vị trí…).
 *   - Số điện thoại liên hệ, tài khoản nhận tiền (chỉ chủ sở hữu; đổi thì có nhật ký + email báo), mật khẩu.
 * Thông tin pháp lý (tên pháp lý, MST, giấy phép) đã được Gymini xác minh nên không tự sửa ở đây.
 */
export function GymOwnerProfilePage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: status } = useQuery<OnboardingStatus>({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const { data: brands = [] } = useQuery<GymBrand[]>({ queryKey: ["owned-brands"], queryFn: () => gymService.listOwnedBrands() });
  const { data: gyms = [] } = useQuery<Gym[]>({ queryKey: ["owned-gyms"], queryFn: () => gymService.listOwnedGyms() });
  const brand = brands[0];
  const isOwner = status?.role !== "MANAGER";
  const brandName = brand ? brand.approvedName ?? brand.name : null;

  // ── Thương hiệu ──
  const [brandForm, setBrandForm] = useState({ name: "", description: "", ...({} as Record<SocialKey, string>) });
  useEffect(() => {
    if (!brand) return;
    setBrandForm({
      name: brand.pendingName ?? brand.approvedName ?? brand.name,
      description: brand.description ?? "",
      ...(Object.fromEntries(SOCIALS.map((so) => [so.key, brand[so.key] ?? ""])) as Record<SocialKey, string>),
    });
  }, [brand?.id, brand?.name, brand?.pendingName, brand?.description, brand?.facebookUrl, brand?.instagramUrl, brand?.tiktokUrl, brand?.youtubeUrl]);
  const currentName = brand ? brand.pendingName ?? brand.approvedName ?? brand.name : "";
  const nameChanged = !!brand && brandForm.name.trim() !== currentName;
  const brandMutation = useMutation({
    mutationFn: () =>
      gymService.updateBrand(brand!.id, {
        // Chỉ gửi tên khi thật sự đổi — gửi tên là tạo một yêu cầu đổi tên chờ admin duyệt.
        ...(nameChanged ? { name: brandForm.name.trim() } : {}),
        description: brandForm.description.trim(),
        ...(Object.fromEntries(SOCIALS.map((so) => [so.key, brandForm[so.key].trim()])) as Record<SocialKey, string>),
      }),
    onSuccess: () => {
      toast.success(nameChanged ? "Đã lưu — tên thương hiệu mới sẽ hiển thị sau khi Gymini duyệt" : "Đã lưu thông tin thương hiệu");
      queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    },
    onError: (e) => toast.error(errMessage(e, "Không lưu được — kiểm tra lại các link")),
  });

  // ── Số điện thoại ──
  const [phone, setPhone] = useState("");
  useEffect(() => setPhone(status?.contactPhone ?? ""), [status?.contactPhone]);
  const phoneDirty = phone.trim() !== (status?.contactPhone ?? "");
  const phoneValid = /^\+?[0-9 .-]{8,20}$/.test(phone.trim());
  const phoneMutation = useMutation({
    mutationFn: () => gymService.submitOnboardingContact(phone.trim()),
    onSuccess: () => {
      toast.success("Đã cập nhật số điện thoại");
      queryClient.invalidateQueries({ queryKey: ["partner-onboarding-status"] });
    },
    onError: (e) => toast.error(errMessage(e, "Không cập nhật được số điện thoại — thử lại sau")),
  });

  // ── Tài khoản nhận tiền ──
  const [bank, setBank] = useState({ bankName: "", accountNumber: "", accountHolder: "" });
  useEffect(() => {
    setBank({
      bankName: status?.payout?.bankName ?? "",
      accountNumber: status?.payout?.accountNumber ?? "",
      accountHolder: status?.payout?.accountHolder ?? "",
    });
  }, [status?.payout?.bankName, status?.payout?.accountNumber, status?.payout?.accountHolder]);
  const bankDirty =
    bank.bankName.trim() !== (status?.payout?.bankName ?? "") ||
    bank.accountNumber.trim() !== (status?.payout?.accountNumber ?? "") ||
    bank.accountHolder.trim() !== (status?.payout?.accountHolder ?? "");
  const bankValid = !!bank.bankName.trim() && !!bank.accountNumber.trim() && !!bank.accountHolder.trim();
  const bankMutation = useMutation({
    mutationFn: () =>
      gymService.submitOnboardingPayout({
        bankName: bank.bankName.trim(),
        accountNumber: bank.accountNumber.trim(),
        accountHolder: bank.accountHolder.trim(),
      }),
    onSuccess: () => {
      toast.success("Đã cập nhật tài khoản nhận tiền");
      queryClient.invalidateQueries({ queryKey: ["partner-onboarding-status"] });
    },
    onError: (e) => toast.error(errMessage(e, "Không cập nhật được tài khoản nhận tiền")),
  });

  // ── Mật khẩu ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const passwordMutation = useMutation({
    mutationFn: () => authService.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Đã đổi mật khẩu");
    },
    onError: (e) => toast.error(errMessage(e, "Không đổi được mật khẩu — kiểm tra lại mật khẩu hiện tại")),
  });
  const pwMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canChangePassword = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center gap-3.5 rounded-xl border border-zinc-800/60 bg-zinc-900 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-500 text-lg font-bold text-black">
          {(brandName?.[0] || user?.email?.[0] || "G").toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-zinc-100">{brandName ?? "Chưa đặt tên thương hiệu"}</h1>
          <p className="truncate text-sm text-zinc-400">{user?.email}</p>
          <span className="mt-1 inline-block rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-green-400">
            {isOwner ? "Chủ phòng gym" : "Quản lý chi nhánh"}
          </span>
        </div>
      </div>

      {brand && (
        <SectionCard id="profile-brand" icon={Storefront} title="Thương hiệu" description="Khách thấy các thông tin này khi xem phòng gym của bạn.">
          <div className="space-y-3">
            <label className="block">
              <Label>Tên thương hiệu</Label>
              <input aria-label="Tên thương hiệu" value={brandForm.name} onChange={(e) => setBrandForm((f) => ({ ...f, name: e.target.value }))} disabled={!isOwner} maxLength={100} className={inputCls} />
              {brand.pendingName ? (
                <span className="mt-1 block text-[11px] text-amber-300">Tên "{brand.pendingName}" đang chờ Gymini duyệt — khách vẫn thấy "{brand.approvedName ?? brand.name}".</span>
              ) : (
                <span className="mt-1 block text-[11px] text-zinc-500">Đổi tên cần Gymini duyệt trước khi hiển thị cho khách.</span>
              )}
            </label>
            <label className="block">
              <Label>Giới thiệu thương hiệu</Label>
              <textarea aria-label="Giới thiệu thương hiệu" value={brandForm.description} onChange={(e) => setBrandForm((f) => ({ ...f, description: e.target.value }))} disabled={!isOwner} rows={3} maxLength={2000} className={inputCls} />
            </label>
            <div>
              <Label>Mạng xã hội</Label>
              <div className="space-y-2">
                {SOCIALS.map((so) => (
                  <div key={so.key} className="relative">
                    <so.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" weight="fill" />
                    <input
                      aria-label={so.label}
                      value={brandForm[so.key]}
                      onChange={(e) => setBrandForm((f) => ({ ...f, [so.key]: e.target.value }))}
                      disabled={!isOwner}
                      inputMode="url"
                      placeholder={so.placeholder}
                      maxLength={300}
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {isOwner && (
            <div className="mt-4 flex justify-end">
              <button type="button" data-testid="profile-brand-save" onClick={() => brandMutation.mutate()} disabled={brandMutation.isPending || !brandForm.name.trim()} className={btnCls}>
                {brandMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Lưu thương hiệu
              </button>
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard id="profile-branches" icon={Buildings} title="Chi nhánh" description="Ảnh, giới thiệu, điện thoại, giờ mở cửa và vị trí được chỉnh riêng cho từng chi nhánh.">
        {gyms.length === 0 ? (
          <p className="text-sm text-zinc-500">Chưa có chi nhánh nào.</p>
        ) : (
          <ul className="space-y-2">
            {gyms.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/gym-owner/gyms/${g.id}?settings=1`)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left hover:border-zinc-600"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-200">{g.approvedName ?? g.name}</span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {STATUS_LABEL[g.status] ?? g.status} · Sửa ảnh, giới thiệu, giờ mở cửa
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard id="profile-phone" icon={Phone} title="Số điện thoại liên hệ" description="Gymini dùng số này khi cần liên hệ trực tiếp với bạn.">
        {status?.hasPartnerAccount === false ? (
          <p className="text-sm text-zinc-400">Tài khoản của bạn được tạo trước khi có hồ sơ đối tác nên chưa có số liên hệ riêng. Liên hệ Gymini nếu cần cập nhật.</p>
        ) : (
          <>
            <label className="block">
              <Label>Số điện thoại</Label>
              <input aria-label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} disabled={!status} className={inputCls} />
              {phone.trim() && !phoneValid && <span className="mt-1 block text-[11px] text-amber-300">Số điện thoại chưa hợp lệ.</span>}
            </label>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => phoneMutation.mutate()} disabled={!phoneDirty || !phoneValid || phoneMutation.isPending} className={btnCls}>
                {phoneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Lưu số điện thoại
              </button>
            </div>
          </>
        )}
      </SectionCard>

      {isOwner && status?.payout && (
        <SectionCard id="profile-payout" icon={Bank} title="Tài khoản nhận tiền" description="Tài khoản Gymini chuyển doanh thu tới khi bạn rút tiền.">
          <div className="space-y-3">
            <label className="block">
              <Label>Ngân hàng</Label>
              <input aria-label="Ngân hàng" value={bank.bankName} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} placeholder="VD: Vietcombank" maxLength={100} className={inputCls} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <Label>Số tài khoản</Label>
                <input aria-label="Số tài khoản" value={bank.accountNumber} onChange={(e) => setBank((b) => ({ ...b, accountNumber: e.target.value }))} inputMode="numeric" maxLength={30} className={inputCls} />
              </label>
              <label className="block">
                <Label>Tên chủ tài khoản</Label>
                <input aria-label="Tên chủ tài khoản" value={bank.accountHolder} onChange={(e) => setBank((b) => ({ ...b, accountHolder: e.target.value }))} maxLength={100} className={inputCls} />
              </label>
            </div>
            <p className="text-[11px] text-zinc-500">Mỗi lần đổi, Gymini ghi nhật ký và gửi email báo tới {user?.email} để bảo vệ bạn.</p>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" data-testid="profile-payout-save" onClick={() => bankMutation.mutate()} disabled={!bankDirty || !bankValid || bankMutation.isPending} className={btnCls}>
              {bankMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Lưu tài khoản nhận tiền
            </button>
          </div>
        </SectionCard>
      )}

      <SectionCard id="profile-password" icon={KeyRound} title="Đổi mật khẩu" description="Mật khẩu mới tối thiểu 8 ký tự.">
        <div className="space-y-3">
          {(
            [
              ["Mật khẩu hiện tại", currentPassword, setCurrentPassword, "current-password"],
              ["Mật khẩu mới", newPassword, setNewPassword, "new-password"],
              ["Nhập lại mật khẩu mới", confirmPassword, setConfirmPassword, "new-password"],
            ] as const
          ).map(([label, value, set, auto]) => (
            <label key={label} className="block">
              <Label>{label}</Label>
              <input aria-label={label} type={showPw ? "text" : "password"} value={value} onChange={(e) => set(e.target.value)} autoComplete={auto} className={inputCls} />
            </label>
          ))}
          {newPassword.length > 0 && newPassword.length < 8 && <p className="text-[11px] text-amber-300">Mật khẩu mới cần ít nhất 8 ký tự.</p>}
          {pwMismatch && <p className="text-[11px] text-amber-300">Hai lần nhập mật khẩu mới chưa khớp.</p>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setShowPw((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-200">
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          </button>
          <button type="button" onClick={() => passwordMutation.mutate()} disabled={!canChangePassword || passwordMutation.isPending} className={btnCls}>
            {passwordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Đổi mật khẩu
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
