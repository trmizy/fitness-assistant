/**
 * Plan form drawer (owner only): CREATE only. Same service call and payload shape as the legacy GymPlansPage
 * (`gymService.createPlan(brandId, {name, price, durationDays, visitLimit?, saleStartAt?, saleEndAt?})`). The legacy page has no plan
 * edit (create + on/off only), so the new UI has none either; the backend PATCH would accept a price change, opening it is Ngai's decision.
 * Rules say themselves before the request (same bounds as gym-service plan.schemas.ts); the server stays the authority and its own
 * sentence is shown when it refuses (12 error-shake, role="alert"). 10 success-check plays ONLY after a real 2xx. 04 text-states-swap
 * on the button. Closing with typed input asks first.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { gymService } from "../../../services/api";
import { GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import {
  EMPTY_PLAN_FORM,
  createPlanPayload,
  planErrorMessage,
  planFormDirty,
  validatePlanForm,
  type PlanForm,
  type PlanFormErrors,
} from "./membersModel";

type Phase = "idle" | "saving" | "done";

export function PlanDrawer({ open, brandId, onClose, onSaved }: { open: boolean; brandId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PlanForm>(EMPTY_PLAN_FORM);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [askDiscard, setAskDiscard] = useState(false);
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // A fresh form every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_PLAN_FORM);
    setTouched(false);
    setServerError("");
    setPhase("idle");
    setAskDiscard(false);
  }, [open]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const create = useMutation({ mutationFn: (f: PlanForm) => gymService.createPlan(brandId, createPlanPayload(f)) });

  const checked = validatePlanForm(form);
  const errors: PlanFormErrors = touched ? checked.errors : {};
  const dirty = planFormDirty(form);
  const set = (k: keyof PlanForm, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (serverError) setServerError("");
  };

  const requestClose = () => {
    if (phase === "saving") return;
    if (dirty && phase !== "done") setAskDiscard(true);
    else onClose();
  };

  const submit = async () => {
    if (phase !== "idle") return;
    setTouched(true);
    if (!checked.ok) {
      shake.shake();
      return;
    }
    setServerError("");
    setPhase("saving");
    try {
      await create.mutateAsync(form);
      // 2xx: only now the check is drawn and the lists are refreshed.
      setPhase("done");
      toast.success("Đã tạo gói hội viên");
      onSaved();
      timer.current = setTimeout(onClose, 900);
    } catch (err) {
      setPhase("idle");
      setServerError(planErrorMessage(err, "Không thể tạo gói"));
      shake.shake();
    }
  };

  const label = phase === "saving" ? "Đang lưu" : phase === "done" ? "Đã tạo" : "Tạo gói";
  const field = (k: keyof PlanForm, text: string, input: React.ReactNode, hint?: string) => (
    <label className="go-field" data-error={errors[k] ? "true" : undefined}>
      <span className="go-label">{text}</span>
      {input}
      {errors[k] ? <span className="go-field-error" role="alert">{errors[k]}</span> : hint ? <span className="go-hint-text">{hint}</span> : null}
    </label>
  );
  const invalid = (k: keyof PlanForm) => (errors[k] ? true : undefined);

  return (
    <>
      <GoDrawer
        open={open}
        onClose={requestClose}
        busy={phase === "saving"}
        closeOnBackdrop={false}
        initialFocusRef={nameRef}
        title="Gói hội viên mới"
        description="Gói áp dụng cho mọi chi nhánh của thương hiệu."
        testId="go-plan-drawer"
        meta={<span className="go-muted">Áp dụng toàn thương hiệu</span>}
        footer={
          <>
            <div className="go-drawer-foot-row">
              <button type="button" className="go-btn" onClick={requestClose} disabled={phase === "saving"}>Huỷ</button>
              <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={phase !== "idle"} data-testid="go-plan-save">
                <SuccessCheck show={phase === "done"} />
                <TextStates value={label} />
              </button>
            </div>
            <p>Gói đã tạo chỉ bật hoặc tắt bán được, chưa sửa được nội dung.</p>
          </>
        }
      >
        <div ref={shake.ref} className="go-form-box" data-testid="go-plan-form">
          {serverError && <p className="go-error" role="alert" data-testid="go-plan-server-error">{serverError}</p>}
          {field("name", "Tên gói", <input ref={nameRef} className="go-input" aria-label="Tên gói" aria-invalid={invalid("name")} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ví dụ: Gói tháng" maxLength={120} />)}
          {field("price", "Giá (VND)", <input className="go-input" type="number" inputMode="numeric" aria-label="Giá (VND)" aria-invalid={invalid("price")} value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="Giá (VND)" min={0} />)}
          {field("durationDays", "Thời hạn (ngày)", <input className="go-input" type="number" inputMode="numeric" aria-label="Thời hạn (ngày)" aria-invalid={invalid("durationDays")} value={form.durationDays} onChange={(e) => set("durationDays", e.target.value)} min={1} />)}
          {field(
            "visitLimit",
            "Giới hạn lượt vào (tuỳ chọn)",
            <input className="go-input" type="number" inputMode="numeric" aria-label="Giới hạn lượt vào (tuỳ chọn)" aria-invalid={invalid("visitLimit")} value={form.visitLimit} onChange={(e) => set("visitLimit", e.target.value)} placeholder="Để trống = không giới hạn" min={1} />,
            "Hạn mức lượt dùng chung cho mọi chi nhánh của thương hiệu: khách check-in ở đâu cũng trừ vào cùng một con số.",
          )}
          <fieldset className="go-form-box" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="go-label">Thời gian mở bán (tuỳ chọn, dùng cho gói khuyến mãi)</legend>
            <div className="go-grid-2">
              <label className="go-field" data-error={errors.saleStartAt ? "true" : undefined}>
                <span className="go-label">Bắt đầu</span>
                <input className="go-input" type="date" aria-label="Ngày bắt đầu mở bán" value={form.saleStartAt} onChange={(e) => set("saleStartAt", e.target.value)} />
              </label>
              <label className="go-field" data-error={errors.saleEndAt ? "true" : undefined}>
                <span className="go-label">Kết thúc</span>
                <input className="go-input" type="date" aria-label="Ngày kết thúc mở bán" aria-invalid={invalid("saleEndAt")} value={form.saleEndAt} onChange={(e) => set("saleEndAt", e.target.value)} />
              </label>
            </div>
            {errors.saleEndAt ? <span className="go-field-error" role="alert">{errors.saleEndAt}</span> : <span className="go-hint-text">Để trống cả hai = luôn mở bán.</span>}
          </fieldset>
        </div>
      </GoDrawer>

      <GoModal
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title="Bỏ thay đổi chưa lưu?"
        description="Những gì bạn đã nhập vào biểu mẫu gói sẽ mất."
        testId="go-plan-discard"
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => setAskDiscard(false)}>Tiếp tục sửa</button>
            <button type="button" className="go-btn" data-variant="danger" onClick={() => { setAskDiscard(false); onClose(); }}>Bỏ thay đổi</button>
          </>
        }
      />
    </>
  );
}
