/**
 * Tab "Thông tin thương hiệu". The brand block of the legacy Hồ sơ (name, logo, description, four social links) and of the legacy
 * Chi nhánh page (first-run naming, rename) now lives here; same calls (`gymService.createBrand`, `updateBrand`, the logo uploader), same
 * body: the name is sent ONLY when it really changed (a rename waits for Gymini's approval and never touches what guests see), the logo
 * takes effect at once. Owner (`brand.write`) edits; manager and accountant (`brand.view`) read the same facts with the reason it is read only.
 * 04 text-states on the button, 10 success-check only after a 2xx, 12 shake on a refusal, unsaved typing is reported to the page guard.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageSquareIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import { friendlyError, uploadApplicationFile } from "../../../services/partnerApplication";
import type { GymBrand } from "../../../types";
import { ABOUT_MAX } from "../../../components/gym/AboutCounter";
import { SOCIALS, SocialLinks } from "../../../components/gym/SocialLinks";
import { SuccessCheck, TextStates, useShake } from "../../../components/layout/gym-owner/motion";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { classifyApiError } from "../scope/scopeModel";
import {
  brandDirty,
  brandFailure,
  brandFormFrom,
  brandProblems,
  brandSavedText,
  brandUpdatePayload,
  logoProblem,
  nameChanged,
  publicBrandName,
  type BrandForm,
} from "./brandModel";

type Phase = "idle" | "saving" | "done";

export function BrandInfoTab({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const scope = useGymOwnerScope();
  const queryClient = useQueryClient();
  const canWrite = scope.can("brand.write");
  const query = useQuery<GymBrand[]>({ queryKey: ["owned-brands"], queryFn: () => gymService.listOwnedBrands(), enabled: scope.can("brand.view") });
  const brand = query.data?.[0];

  if (query.isError && !query.data) {
    if (classifyApiError(query.error) === "forbidden") return <ScopeStateFrame kind="forbidden" />;
    return (
      <div className="go-state" role="alert" data-testid="go-brand-error">
        <h2>Không tải được thông tin thương hiệu</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận bạn đã có thương hiệu hay chưa.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button></div>
      </div>
    );
  }
  if (query.isLoading || scope.status !== "ready") {
    return (
      <section className="go-panel" aria-hidden="true">
        <div className="go-task-skel" data-testid="go-brand-skeleton">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "40%" }} /><span className="go-skel-bar" style={{ width: "65%" }} /></div>
          ))}
        </div>
      </section>
    );
  }
  if (!brand) return canWrite ? <CreateBrand onDirty={onDirty} /> : <ReadOnlyEmpty />;
  const branchCount = scope.gyms.filter((g) => g.brandId === brand.id).length;
  return canWrite ? <EditBrand brand={brand} branchCount={branchCount} onDirty={onDirty} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["owned-brands"] })} /> : <ReadBrand brand={brand} branchCount={branchCount} />;
}

function ReadOnlyEmpty() {
  return (
    <section className="go-panel" data-testid="go-brand-empty">
      <div className="go-task-empty">
        <strong>Chưa có thương hiệu</strong>
        <span>Chủ phòng tập sẽ đặt tên thương hiệu trước khi có chi nhánh. Chỉ chủ phòng tập tạo và sửa được.</span>
      </div>
    </section>
  );
}

function BranchLine({ count }: { count: number }) {
  return (
    <p className="go-muted-text" data-testid="go-brand-branches">
      {count} chi nhánh thuộc thương hiệu này. <GoLink to="/gym-owner/gyms" className="go-btn-link">Mở danh sách chi nhánh</GoLink>
    </p>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- read only
function ReadBrand({ brand, branchCount }: { brand: GymBrand; branchCount: number }) {
  return (
    <section className="go-panel" aria-labelledby="go-h-brand-read" data-testid="go-brand-readonly">
      <div className="go-panel-head">
        <h2 id="go-h-brand-read">Thương hiệu</h2>
        <p>Chỉ chủ phòng tập sửa được. Bạn xem được đúng những gì khách thấy.</p>
      </div>
      <dl className="go-dl">
        <div><dt>Tên thương hiệu</dt><dd data-testid="go-brand-name-read">{publicBrandName(brand)}</dd></div>
        <div><dt>Logo</dt><dd>{brand.logoUrl ? <img className="go-brand-logo" src={brand.logoUrl} alt={`Logo ${publicBrandName(brand)}`} /> : <span className="go-muted">Chưa có logo</span>}</dd></div>
        <div><dt>Giới thiệu</dt><dd className="go-prewrap">{brand.description?.trim() ? brand.description : <span className="go-muted">Chưa có giới thiệu</span>}</dd></div>
        <div><dt>Mạng xã hội</dt><dd>{SOCIALS.some((s) => (brand as unknown as Record<string, string | null>)[s.key]) ? <SocialLinks value={brand} /> : <span className="go-muted">Chưa có liên kết</span>}</dd></div>
      </dl>
      <div className="go-panel-pad"><BranchLine count={branchCount} /></div>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- create (first run)
function CreateBrand({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "" });
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const shake = useShake<HTMLDivElement>();
  const create = useMutation({ mutationFn: () => gymService.createBrand({ name: form.name.trim(), description: form.description.trim() }) });
  const dirty = phase !== "done" && (form.name.trim() !== "" || form.description.trim() !== "");
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const submit = async () => {
    if (phase !== "idle") return;
    if (!form.name.trim()) {
      setRefusal("Nhập tên thương hiệu.");
      shake.shake();
      return;
    }
    setRefusal("");
    setPhase("saving");
    try {
      await create.mutateAsync();
      setPhase("done"); // 2xx only
      toast.success("Đã đặt tên thương hiệu. Giờ có thể thêm chi nhánh đầu tiên");
      void queryClient.invalidateQueries({ queryKey: ["owned-brands"] });
    } catch (err) {
      setPhase("idle");
      setRefusal(brandFailure(err, "create").text);
      shake.shake();
    }
  };

  return (
    <section className="go-panel" aria-labelledby="go-h-brand-new" data-testid="go-brand-create">
      <div className="go-panel-head">
        <h2 id="go-h-brand-new">Đặt tên thương hiệu của bạn</h2>
        <p>Đây là tên khách thấy khi tìm kiếm. Mọi phòng tập bạn tạo sau này đều là một chi nhánh của thương hiệu này. Có thể đổi tên sau, tên mới cần Gymini duyệt.</p>
      </div>
      <div ref={shake.ref} className="go-form-box go-panel-pad">
        {refusal && <p className="go-error" role="alert" data-testid="go-brand-refusal">{refusal}</p>}
        <label className="go-field">
          <span className="go-label">Tên thương hiệu</span>
          <input className="go-input" aria-label="Tên thương hiệu" value={form.name} maxLength={100} onChange={(e) => { setForm({ ...form, name: e.target.value }); setRefusal(""); }} data-testid="go-brand-create-name" />
        </label>
        <label className="go-field">
          <span className="go-label">Mô tả (tuỳ chọn)</span>
          <textarea className="go-input go-textarea" aria-label="Mô tả thương hiệu" rows={3} maxLength={ABOUT_MAX} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <p className="go-counter" data-over={form.description.length > ABOUT_MAX ? "true" : undefined}>{form.description.length}/{ABOUT_MAX}</p>
        </label>
        <div className="go-form-actions">
          <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={phase !== "idle"} data-testid="go-brand-create-save">
            <SuccessCheck show={phase === "done"} />
            <TextStates value={phase === "saving" ? "Đang lưu" : phase === "done" ? "Đã đặt tên" : "Đặt tên thương hiệu"} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- edit (owner)
function EditBrand({ brand, branchCount, onDirty, onChanged }: { brand: GymBrand; branchCount: number; onDirty: (dirty: boolean) => void; onChanged: () => void }) {
  const [form, setForm] = useState<BrandForm>(() => brandFormFrom(brand));
  const [phase, setPhase] = useState<Phase>("idle");
  const [refusal, setRefusal] = useState("");
  const [touched, setTouched] = useState(false);
  const [savedText, setSavedText] = useState("");
  const shake = useShake<HTMLDivElement>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useMutation({ mutationFn: (f: BrandForm) => gymService.updateBrand(brand.id, brandUpdatePayload(brand, f) as never) });

  // Same rule as the legacy form: a fresh copy of the server's values whenever they change (after a save, after a refetch).
  useEffect(() => {
    setForm(brandFormFrom(brand));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the server's own fields of this brand
  }, [brand.id, brand.name, brand.approvedName, brand.pendingName, brand.description, brand.facebookUrl, brand.instagramUrl, brand.tiktokUrl, brand.youtubeUrl]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const dirty = brandDirty(brand, form);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const problems = touched ? brandProblems(form) : {};
  const set = (patch: Partial<BrandForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (refusal) setRefusal("");
    if (phase === "done") setPhase("idle");
  };

  const submit = async () => {
    if (phase === "saving") return;
    setTouched(true);
    if (Object.keys(brandProblems(form)).length > 0) {
      shake.shake();
      return;
    }
    setRefusal("");
    setSavedText("");
    setPhase("saving");
    const renamed = nameChanged(brand, form);
    try {
      await update.mutateAsync(form);
      setPhase("done"); // 2xx only: the check is drawn now
      const text = brandSavedText(renamed);
      setSavedText(text);
      toast.success(text);
      onChanged();
      timer.current = setTimeout(() => setPhase("idle"), 1800);
    } catch (err) {
      setPhase("idle");
      setRefusal(brandFailure(err, "save").text);
      shake.shake();
    }
  };

  const reset = () => {
    setForm(brandFormFrom(brand));
    setRefusal("");
    setTouched(false);
  };

  return (
    <section className="go-panel" aria-labelledby="go-h-brand-edit" data-testid="go-brand-edit">
      <div className="go-panel-head">
        <h2 id="go-h-brand-edit">{publicBrandName(brand)}</h2>
        <p>Khách thấy các thông tin này khi xem phòng tập của bạn.</p>
      </div>
      <div ref={shake.ref} className="go-form-box go-panel-pad">
        {refusal && <p className="go-error" role="alert" data-testid="go-brand-refusal">{refusal}</p>}

        <label className="go-field">
          <span className="go-label">Tên thương hiệu</span>
          <input className="go-input" aria-label="Tên thương hiệu" aria-invalid={problems.name ? true : undefined} value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} data-testid="go-brand-name-input" />
          {problems.name ? (
            <span className="go-field-error" role="alert">{problems.name}</span>
          ) : brand.pendingName ? (
            <span className="go-hint-text" data-testid="brand-pending-approval-hint">Tên "{brand.pendingName}" đang chờ Gymini duyệt. Khách vẫn thấy "{publicBrandName(brand)}".</span>
          ) : (
            <span className="go-hint-text">Đổi tên cần Gymini duyệt trước khi hiển thị cho khách.</span>
          )}
        </label>

        <LogoField brand={brand} onChanged={onChanged} />

        <label className="go-field">
          <span className="go-label">Giới thiệu thương hiệu</span>
          <textarea className="go-input go-textarea" aria-label="Giới thiệu thương hiệu" aria-invalid={problems.description ? true : undefined} rows={3} maxLength={Math.max(ABOUT_MAX, form.description.length)} value={form.description} onChange={(e) => set({ description: e.target.value })} data-testid="go-brand-description" />
          <p className="go-counter" data-over={form.description.length > ABOUT_MAX ? "true" : undefined}>{form.description.length}/{ABOUT_MAX}</p>
          {problems.description && <span className="go-field-error" role="alert">{problems.description}</span>}
        </label>

        <fieldset className="go-fieldset">
          <legend className="go-label">Mạng xã hội</legend>
          <div className="go-social-grid">
            {SOCIALS.map((s) => (
              <label key={s.key} className="go-field">
                <span className="go-label go-label-icon"><s.icon aria-hidden="true" width={16} height={16} weight="fill" />{s.label}</span>
                <input className="go-input" aria-label={s.label} inputMode="url" placeholder={s.placeholder} maxLength={300} value={form[s.key]} onChange={(e) => set({ [s.key]: e.target.value } as Partial<BrandForm>)} />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="go-form-actions go-brand-actions-row">
          <span className="go-muted-text go-brand-dirty" data-testid="go-brand-dirty" aria-live="polite">
            {phase === "done" && savedText ? savedText : dirty ? "Có thay đổi chưa lưu." : ""}
          </span>
          <button type="button" className="go-btn" onClick={reset} disabled={!dirty || phase === "saving"} data-testid="go-brand-reset">Bỏ thay đổi</button>
          <button type="button" className="go-btn" data-variant="primary" onClick={() => void submit()} disabled={phase === "saving" || phase === "done" || !dirty} data-testid="profile-brand-save">
            <SuccessCheck show={phase === "done"} />
            <TextStates value={phase === "saving" ? "Đang lưu" : phase === "done" ? "Đã lưu" : "Lưu thương hiệu"} />
          </button>
        </div>
      </div>
      <p className="go-panel-foot">{branchCount} chi nhánh thuộc thương hiệu này. Đổi logo có hiệu lực ngay, không cần bấm Lưu.</p>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------------------- logo (same handler as the legacy uploader)
function LogoField({ brand, onChanged }: { brand: GymBrand; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (input.current) input.current.value = "";
    const problem = logoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setDone(false);
    setPercent(0);
    try {
      await uploadApplicationFile(file, { kind: "LOGO" }, setPercent);
      setDone(true); // the upload + confirmation answered: now the check is drawn
      onChanged();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 2500);
    } catch (e) {
      setError(friendlyError(e, "Tải logo thất bại.").message);
    } finally {
      setPercent(null);
    }
  };

  return (
    <div className="go-field" data-testid="go-brand-logo">
      <span className="go-label">Logo thương hiệu</span>
      <div className="go-logo-row">
        <div className="go-logo-box" aria-hidden={brand.logoUrl ? undefined : true}>
          {brand.logoUrl ? <img src={brand.logoUrl} alt="Logo thương hiệu" /> : <ImageSquareIcon width={24} height={24} aria-hidden="true" />}
        </div>
        <div className="go-logo-text">
          <p className="go-hint-text">JPG, PNG hoặc WebP, tối đa 10 MB. Không bắt buộc.</p>
          {percent !== null && <div className="go-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Đang tải logo"><span style={{ width: `${percent}%` }} /></div>}
          {error && <p className="go-field-error" role="alert" data-testid="go-brand-logo-error">{error}</p>}
          <button type="button" className="go-btn go-btn-sm" onClick={() => input.current?.click()} disabled={percent !== null} data-testid="go-brand-logo-pick">
            <SuccessCheck show={done} size={14} />
            <UploadSimpleIcon aria-hidden="true" width={14} height={14} />
            <TextStates value={percent !== null ? "Đang tải" : done ? "Đã cập nhật logo" : brand.logoUrl ? "Thay logo" : "Tải logo lên"} />
          </button>
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} data-testid="go-brand-logo-input" />
      </div>
    </div>
  );
}
