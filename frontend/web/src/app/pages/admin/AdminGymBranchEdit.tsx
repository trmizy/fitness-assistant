import { useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckIcon as Check, CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import type { Gym } from "../../types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { MAX_ADMIN_REASON, MIN_ADMIN_REASON, gymEditFormFrom, validateGymEdit, type GymEditForm } from "../../utils/adminGymManage";

const LABEL = "mb-1 block text-xs font-semibold text-adm-text-2";
const FIELD = "min-h-10";

/**
 * N14A-01: admin "Sửa thông tin" of one branch. Only the fields that changed are sent. The public introduction text (`description`) is part of
 * the branch's public listing, so changing it needs a reason of at least 10 characters (the server stores it on the revision); the reason box
 * therefore appears only while that text differs from what the branch has now. Editing a phone number alone never asks for a reason.
 */
export function AdminGymBranchEdit({ gym, onClose }: { gym: Gym; onClose: () => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const initial = useMemo(() => gymEditFormFrom(gym), [gym]);
  const [form, setForm] = useState<GymEditForm>(initial);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (patch: Partial<GymEditForm>) => {
    setServerError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  const check = validateGymEdit(initial, form, reason);
  const descriptionChanged = form.description.trim() !== initial.description.trim();
  const reasonCount = reason.trim().length;
  const reasonError = !check.ok ? check.reasonError : null;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminService.updateGymDetails(gym.id, body),
    onSuccess: () => {
      toast.success("Đã cập nhật thông tin chi nhánh");
      void queryClient.invalidateQueries({ queryKey: ["admin-gyms"] });
      onClose();
    },
    onError: (e: any) => setServerError(e?.response?.data?.error?.message || "Không thể cập nhật. Vui lòng thử lại."),
  });

  const submit = () => {
    setTouched(true);
    if (check.ok) save.mutate(check.body);
  };

  const disabled = save.isPending || !form.name.trim() || !form.address.trim() || (check.ok === false && check.nothingChanged);

  return (
    <form
      data-testid="admin-gym-edit-form"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label className={LABEL} htmlFor={`${uid}-name`}>Tên chi nhánh</label>
        <Input id={`${uid}-name`} className={FIELD} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${uid}-address`}>Địa chỉ</label>
        <Input id={`${uid}-address`} className={FIELD} value={form.address} onChange={(e) => set({ address: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`${uid}-city`}>Thành phố</label>
          <Input id={`${uid}-city`} className={FIELD} value={form.city} onChange={(e) => set({ city: e.target.value })} />
        </div>
        <div>
          <label className={LABEL} htmlFor={`${uid}-phone`}>Số điện thoại</label>
          <Input id={`${uid}-phone`} className={FIELD} inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor={`${uid}-email`}>Email</label>
        <Input id={`${uid}-email`} className={FIELD} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${uid}-desc`}>Giới thiệu công khai</label>
        <Textarea id={`${uid}-desc`} rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        <p className="mt-1 text-[11px] text-adm-text-2">Đây là phần khách nhìn thấy trên trang chi nhánh. Sửa phần này cần ghi lý do.</p>
      </div>

      {descriptionChanged && (
        <div data-testid="admin-gym-edit-reason-block" className="rounded-xl border border-st-warning-border bg-st-warning-bg p-3">
          <label className={LABEL} htmlFor={`${uid}-reason`}>
            Lý do sửa phần giới thiệu <span className="text-st-danger">*</span>
          </label>
          <Textarea
            id={`${uid}-reason`}
            rows={2}
            maxLength={MAX_ADMIN_REASON}
            value={reason}
            aria-invalid={touched && reasonError ? true : undefined}
            aria-describedby={`${uid}-reason-hint`}
            placeholder="Ví dụ: Gỡ thông tin sai về giờ mở cửa theo phản ánh của hội viên"
            onChange={(e) => {
              setServerError(null);
              setReason(e.target.value);
            }}
          />
          <div id={`${uid}-reason-hint`} className="mt-1 flex items-start justify-between gap-3 text-[11px]">
            <span role={touched && reasonError ? "alert" : undefined} className={touched && reasonError ? "text-st-danger" : "text-adm-text-2"}>
              {touched && reasonError ? reasonError : `Tối thiểu ${MIN_ADMIN_REASON} ký tự. Lý do được lưu cùng lần sửa.`}
            </span>
            <span data-testid="admin-gym-edit-reason-count" className={`shrink-0 tabular-nums ${reasonCount >= MIN_ADMIN_REASON ? "text-st-success" : "text-adm-text-2"}`}>
              {reasonCount}/{MIN_ADMIN_REASON}
            </span>
          </div>
        </div>
      )}

      {serverError && (
        <p role="alert" data-testid="admin-gym-edit-error" className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2 text-xs text-st-danger">
          {serverError}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" data-testid="admin-gym-save-edit-button" disabled={disabled} className="min-h-10">
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Lưu thay đổi
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending} className="min-h-10">
          Huỷ
        </Button>
        {check.ok === false && check.nothingChanged && <span className="self-center text-[11px] text-adm-text-2">Chưa có thay đổi nào.</span>}
      </div>
    </form>
  );
}
