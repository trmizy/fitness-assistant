import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle2,
  CheckIcon as Check,
  PaperPlaneTiltIcon as Send,
  StorefrontIcon as Storefront,
  BuildingsIcon as Buildings,
} from "@phosphor-icons/react";
import { GymLocationFields } from "../../components/gym/GymLocationFields";
import { SOCIALS, SocialLinks, type SocialKey } from "../../components/gym/SocialLinks";
import { ABOUT_MAX, AboutCounter } from "../../components/gym/AboutCounter";
import { MapLocationPicker } from "../../components/gym/MapLocationPicker";
import { AutoPinStatus, useAutoPin, useLocationNames } from "../../components/gym/addressAutoPin";
import {
  DOC_LABEL,
  ROLE_LABEL,
  friendlyError,
  partnerApplication,
  type ApplicationView,
  type BusinessScale,
  type DocType,
  type MissingItem,
  type RepresentativeRole,
} from "../../services/partnerApplication";
import { ChangeRequestCards } from "./ChangeRequests";
import { BrandLogoUpload, DocumentUpload, PhotoUploader, PrivateNotice } from "./uploaders";
import { Card, Field, GhostButton, PrimaryButton, inputCls } from "./ui";

type StepId = "representative" | "brand" | "social" | "scale" | "branch" | "location" | "photos" | "legal" | "review";

const STEPS: { id: StepId; title: string; sections: MissingItem["section"][] }[] = [
  { id: "representative", title: "Người đại diện", sections: ["REPRESENTATIVE"] },
  { id: "brand", title: "Thương hiệu", sections: ["BRAND"] },
  // Không bắt buộc, không có mục "còn thiếu" nào — bỏ trống vẫn nộp được.
  { id: "social", title: "Mạng xã hội", sections: [] },
  { id: "scale", title: "Quy mô", sections: ["SCALE"] },
  { id: "branch", title: "Chi nhánh đầu tiên", sections: ["BRANCH"] },
  { id: "location", title: "Vị trí", sections: ["LOCATION"] },
  { id: "photos", title: "Ảnh cơ sở", sections: ["PHOTOS"] },
  { id: "legal", title: "Xác minh doanh nghiệp", sections: ["LEGAL"] },
  { id: "review", title: "Xem lại & gửi", sections: ["TERMS"] },
];

const blank = (v: string | null | undefined) => !v || !v.trim();
const opt = (v: string) => (v.trim() ? v.trim() : undefined);

/**
 * Wizard hồ sơ đối tác. Mỗi bước tự lưu lên server khi bấm "Tiếp tục" (server là nguồn sự thật; tải
 * lại trang là tiếp tục đúng chỗ, mở ở bước đầu tiên còn thiếu). Không có thao tác nào chỉ tồn tại
 * ở frontend.
 */
export function ApplicationWizard({ view, onChanged }: { view: ApplicationView; onChanged: () => Promise<unknown> | void }) {
  const firstIncomplete = useMemo(() => {
    const idx = STEPS.findIndex((s) => s.id !== "review" && view.missing.some((m) => s.sections.includes(m.section)));
    return idx === -1 ? STEPS.length - 1 : idx;
    // Chỉ tính một lần khi mở, để việc lưu từng bước không kéo người dùng đi chỗ khác.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [idx, setIdx] = useState(firstIncomplete);
  const step = STEPS[idx];
  const editable = view.editable;
  const isDone = (s: (typeof STEPS)[number]) => !view.missing.some((m) => s.sections.includes(m.section));
  const doneCount = STEPS.filter((s) => s.id !== "review" && isDone(s)).length;
  const percent = Math.round((doneCount / (STEPS.length - 1)) * 100);

  const goTo = (id: string) => {
    const i = STEPS.findIndex((s) => s.id === id);
    if (i >= 0) setIdx(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [idx]);

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="lg:hidden mb-1">
          <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
            <span>
              Bước {idx + 1}/{STEPS.length}: <span className="text-zinc-200 font-semibold">{step.title}</span>
            </span>
            <span>{percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800">
            <div className="h-1.5 rounded-full bg-green-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <nav aria-label="Các bước hồ sơ" className="hidden lg:block space-y-1">
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <span>Tiến độ hồ sơ</span>
              <span>{percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800">
              <div className="h-1.5 rounded-full bg-green-500 transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
          {STEPS.map((s, i) => {
            const done = s.id !== "review" && isDone(s);
            return (
              <button
                key={s.id}
                onClick={() => setIdx(i)}
                aria-current={i === idx ? "step" : undefined}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  i === idx ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-green-500 text-black" : "border border-zinc-600 text-zinc-500"}`}>
                  {done ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                {s.title}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="space-y-4 min-w-0">
        <ChangeRequestCards issues={view.issues.filter((i) => i.status !== "RESOLVED")} editable={editable} onGoTo={goTo} onChanged={onChanged} />

        <Card>
          <h1 className="text-lg font-bold text-zinc-100 mb-4">{step.title}</h1>
          {step.id === "representative" && <StepRepresentative view={view} editable={editable} onChanged={onChanged} onDone={() => setIdx(idx + 1)} />}
          {step.id === "brand" && <StepBrand view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "social" && <StepSocial view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "scale" && <StepScale view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "branch" && <StepBranch view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "location" && <StepLocation view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "photos" && <StepPhotos view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "legal" && <StepLegal view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onDone={() => setIdx(idx + 1)} />}
          {step.id === "review" && <StepReview view={view} editable={editable} onChanged={onChanged} onBack={() => setIdx(idx - 1)} onGoTo={goTo} />}
        </Card>
      </div>
    </div>
  );
}

interface StepProps {
  view: ApplicationView;
  editable: boolean;
  onChanged: () => Promise<unknown> | void;
  onBack?: () => void;
  onDone?: () => void;
}

function Nav({ onBack, next, nextLabel = "Tiếp tục", loading, disabled }: { onBack?: () => void; next: () => void; nextLabel?: string; loading?: boolean; disabled?: boolean }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-3 max-lg:sticky max-lg:bottom-0 max-lg:-mx-5 max-lg:border-t max-lg:border-zinc-800 max-lg:bg-zinc-900/95 max-lg:px-5 max-lg:py-3 max-lg:backdrop-blur">
      {onBack ? (
        <GhostButton onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> Quay lại
        </GhostButton>
      ) : (
        <span />
      )}
      <PrimaryButton onClick={next} loading={loading} disabled={disabled}>
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </PrimaryButton>
    </div>
  );
}

/** Lưu bước hiện tại rồi chuyển bước; khi hồ sơ đang khoá (chỉ xem) thì chỉ chuyển bước. */
function useSaveStep(editable: boolean, onChanged: () => Promise<unknown> | void, onDone?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async (save: () => Promise<unknown>) => {
      if (editable) {
        await save();
        // Đợi dữ liệu mới về trước khi sang bước sau, để bước sau không khởi tạo từ dữ liệu cũ.
        await onChanged();
      }
    },
    onSuccess: () => {
      setError(null);
      onDone?.();
    },
    onError: (e) => setError(friendlyError(e, "Không lưu được. Vui lòng thử lại.").message),
  });
  return { error, saving: m.isPending, save: (fn: () => Promise<unknown>) => m.mutate(fn) };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-3 text-xs text-red-400">{error}</p> : null;
}

// ── Từng bước ───────────────────────────────────────────────────────────────────────────────

function StepRepresentative({ view, editable, onChanged, onDone }: StepProps) {
  const [name, setName] = useState(view.partner.representativeName ?? "");
  const [phone, setPhone] = useState(view.representativePhone ?? "");
  const [role, setRole] = useState<RepresentativeRole | "">(view.partner.representativeRole ?? "");
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  const valid = name.trim().length >= 2 && phone.trim().length >= 8 && role !== "";
  return (
    <>
      <div className="space-y-3.5">
        <p className="text-sm text-zinc-400">Người sẽ chịu trách nhiệm hồ sơ và liên hệ với Gymini.</p>
        <Field label="Họ và tên *">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} autoComplete="name" className={inputCls} />
        </Field>
        <Field label="Số điện thoại *">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editable} inputMode="tel" autoComplete="tel" className={inputCls} />
        </Field>
        <Field label="Vai trò *">
          <select value={role} onChange={(e) => setRole(e.target.value as RepresentativeRole)} disabled={!editable} className={inputCls}>
            <option value="">Chọn vai trò</option>
            {(Object.keys(ROLE_LABEL) as RepresentativeRole[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorLine error={error} />
      <Nav next={() => save(() => partnerApplication.saveRepresentative({ name: name.trim(), phone: phone.trim(), role: role as RepresentativeRole }))} loading={saving} disabled={editable && !valid} />
    </>
  );
}

function StepBrand({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const [name, setName] = useState(view.brand?.name ?? "");
  const [description, setDescription] = useState(view.brand?.description ?? "");
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  return (
    <>
      <div className="space-y-3.5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400 flex gap-2">
          <Buildings className="w-4 h-4 text-green-400 shrink-0 mt-px" />
          Mỗi tài khoản đối tác có đúng một thương hiệu. Tất cả chi nhánh của bạn — bây giờ và sau này — đều thuộc thương hiệu này.
        </div>
        <Field label="Tên thương hiệu *" hint="Tên hiển thị cho khách hàng, ví dụ chuỗi phòng tập của bạn.">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={120} className={inputCls} />
        </Field>
        <Field label="Giới thiệu ngắn">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} rows={3} maxLength={ABOUT_MAX} className={inputCls} />
          <AboutCounter value={description} />
        </Field>
        {view.brand ? (
          <BrandLogoUpload logoUrl={view.brand.logoUrl} disabled={!editable} onChanged={onChanged} />
        ) : (
          <p className="text-[11px] text-zinc-600">Lưu tên thương hiệu rồi bạn có thể tải logo lên (không bắt buộc).</p>
        )}
      </div>
      <ErrorLine error={error} />
      <Nav onBack={onBack} next={() => save(() => partnerApplication.saveBrand({ name: name.trim(), description: opt(description) }))} loading={saving} disabled={editable && name.trim().length < 2} />
    </>
  );
}

function StepSocial({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const [links, setLinks] = useState<Record<SocialKey, string>>({
    facebookUrl: view.brand?.facebookUrl ?? "",
    instagramUrl: view.brand?.instagramUrl ?? "",
    tiktokUrl: view.brand?.tiktokUrl ?? "",
    youtubeUrl: view.brand?.youtubeUrl ?? "",
  });
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  return (
    <>
      <div className="space-y-3.5">
        <p className="text-sm text-zinc-400">
          Không bắt buộc. Các trang này hiện ở mục "Chi tiết" khi khách xem phòng gym của bạn, giúp họ tin tưởng và theo dõi thương hiệu.
        </p>
        {!view.brand && <p className="text-sm text-amber-300">Hãy lưu tên thương hiệu ở bước trước.</p>}
        {SOCIALS.map((so) => (
          <Field key={so.key} label={so.label}>
            <div className="relative">
              <so.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" weight="fill" />
              <input
                aria-label={so.label}
                value={links[so.key]}
                onChange={(e) => setLinks((l) => ({ ...l, [so.key]: e.target.value }))}
                disabled={!editable || !view.brand}
                inputMode="url"
                placeholder={so.placeholder}
                maxLength={300}
                className={`${inputCls} pl-9`}
              />
            </div>
          </Field>
        ))}
      </div>
      <ErrorLine error={error} />
      <Nav
        onBack={onBack}
        next={() =>
          save(() =>
            partnerApplication.saveSocial({
              facebookUrl: links.facebookUrl.trim(),
              instagramUrl: links.instagramUrl.trim(),
              tiktokUrl: links.tiktokUrl.trim(),
              youtubeUrl: links.youtubeUrl.trim(),
            }),
          )
        }
        loading={saving}
        disabled={editable && !view.brand}
      />
    </>
  );
}

function StepScale({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const [scale, setScale] = useState<BusinessScale | "">(view.partner.businessScale ?? "");
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  const Option = ({ value, title, body }: { value: BusinessScale; title: string; body: string }) => (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setScale(value)}
      aria-pressed={scale === value}
      className={`text-left rounded-xl border p-4 transition-colors ${scale === value ? "border-green-500 bg-green-500/5" : "border-zinc-800 hover:border-zinc-600"}`}
    >
      <p className="text-sm font-bold text-zinc-100 flex items-center gap-2">
        <Storefront className="w-4 h-4 text-green-400" /> {title}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{body}</p>
    </button>
  );
  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">Bạn đang vận hành bao nhiêu chi nhánh?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Option value="ONE_BRANCH" title="Một chi nhánh" body="Bạn đang có một cơ sở phòng tập." />
          <Option value="MULTIPLE_BRANCHES" title="Nhiều chi nhánh" body="Bạn có hoặc dự định mở nhiều cơ sở dưới cùng một thương hiệu." />
        </div>
        {scale === "MULTIPLE_BRANCHES" && (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
            Hồ sơ này chỉ cần hoàn thiện <span className="text-zinc-200 font-semibold">chi nhánh đầu tiên</span>. Bạn có thể thêm các chi nhánh khác sau khi hồ sơ được duyệt.
          </p>
        )}
      </div>
      <ErrorLine error={error} />
      <Nav onBack={onBack} next={() => save(() => partnerApplication.saveBusinessScale(scale as BusinessScale))} loading={saving} disabled={editable && scale === ""} />
    </>
  );
}

function StepBranch({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const b = view.branch;
  const [name, setName] = useState(b?.name ?? "");
  const [phone, setPhone] = useState(b?.phone ?? "");
  const [email, setEmail] = useState(b?.email ?? "");
  const [description, setDescription] = useState(b?.description ?? "");
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  const valid = name.trim().length >= 2 && phone.trim().length >= 8;
  return (
    <>
      <div className="space-y-3.5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
          Chi nhánh này sẽ tự thuộc thương hiệu <span className="text-zinc-200 font-semibold">{view.brand?.name ?? "của bạn"}</span>.
        </div>
        <Field label="Tên chi nhánh *">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={120} className={inputCls} />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Số điện thoại chi nhánh *">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editable} inputMode="tel" className={inputCls} />
          </Field>
          <Field label="Email chi nhánh">
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editable} inputMode="email" className={inputCls} />
          </Field>
        </div>
        <Field label="Giới thiệu chi nhánh">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} rows={3} maxLength={ABOUT_MAX} className={inputCls} />
          <AboutCounter value={description} />
        </Field>
      </div>
      <ErrorLine error={error} />
      <Nav
        onBack={onBack}
        next={() =>
          save(() =>
            partnerApplication.saveBranch({ name: name.trim(), phone: phone.trim(), email: opt(email), description: opt(description) }),
          )
        }
        loading={saving}
        disabled={editable && !valid}
      />
    </>
  );
}

function StepLocation({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const b = view.branch;
  const [address, setAddress] = useState(b?.address ?? "");
  const [loc, setLoc] = useState({
    provinceCode: b?.provinceCode ?? null,
    wardCode: b?.wardCode ?? null,
    latitude: b?.latitude ?? null,
    longitude: b?.longitude ?? null,
  });
  const [note, setNote] = useState(b?.locationNote ?? "");
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  const names = useLocationNames(loc.provinceCode, loc.wardCode);
  const pin = useAutoPin({
    enabled: editable,
    hadSavedPin: b?.latitude != null && b?.longitude != null,
    street: address.trim(),
    ward: names.ward,
    province: names.province,
    onPin: (latitude, longitude) => setLoc((l) => ({ ...l, latitude, longitude })),
  });
  const valid =
    address.trim().length >= 5 && loc.provinceCode != null && loc.wardCode != null && loc.latitude != null && loc.longitude != null;
  return (
    <>
      <div className="space-y-3.5">
        {!b && <p className="text-sm text-amber-300">Hãy hoàn thành bước Chi nhánh trước.</p>}
        <Field label="Số nhà, tên đường *" hint="Ví dụ: 123 Lê Lợi. Chọn thêm tỉnh/thành và phường/xã, bản đồ sẽ tự ghim theo địa chỉ.">
          <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!editable} maxLength={255} className={inputCls} />
        </Field>
        <GymLocationFields
          value={loc}
          onChange={(next) => {
            if (!editable) return;
            // "Dùng vị trí hiện tại" cũng là ghim tay → bỏ thông báo ghim-theo-địa-chỉ cũ.
            if (next.latitude !== loc.latitude || next.longitude !== loc.longitude) pin.markManual();
            setLoc(next);
          }}
        />
        {editable && (
          <>
            <AutoPinStatus status={pin.status} />
            <MapLocationPicker
              latitude={loc.latitude}
              longitude={loc.longitude}
              onChange={(p) => {
                pin.markManual();
                setLoc((l) => ({ ...l, ...p }));
              }}
            />
          </>
        )}
        <Field label="Chỉ dẫn đường đi" hint="Ví dụ: cổng sau toà nhà, tầng 2.">
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={!editable} maxLength={300} className={inputCls} />
        </Field>
      </div>
      <ErrorLine error={error} />
      <Nav
        onBack={onBack}
        next={() => save(() => partnerApplication.saveBranch({ address: address.trim(), ...loc, locationNote: opt(note) }))}
        loading={saving}
        disabled={editable && (!valid || !b)}
      />
    </>
  );
}

function StepPhotos({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const enough = view.photos.length >= view.minPhotos;
  return (
    <>
      {!view.branch && <p className="mb-3 text-sm text-amber-300">Hãy hoàn thành bước Chi nhánh trước khi tải ảnh.</p>}
      <PhotoUploader photos={view.photos} minPhotos={view.minPhotos} disabled={!editable || !view.branch} onChanged={onChanged} />
      <Nav onBack={onBack} next={() => onDone?.()} disabled={editable && !enough} />
    </>
  );
}

function StepLegal({ view, editable, onChanged, onBack, onDone }: StepProps) {
  const [legalName, setLegalName] = useState(view.partner.legalName ?? "");
  const [taxCode, setTaxCode] = useState(view.partner.taxCode ?? "");
  const [licenseNo, setLicenseNo] = useState(view.partner.businessLicenseNo ?? "");
  const { error, saving, save } = useSaveStep(editable, onChanged, onDone);
  const docs = view.documents.filter((d) => d.required);
  const extras = view.documents.filter((d) => !d.required);
  return (
    <>
      <div className="space-y-3.5">
        <Field label="Tên pháp lý của doanh nghiệp *">
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={!editable} maxLength={200} className={inputCls} />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Mã số thuế">
            <input value={taxCode} onChange={(e) => setTaxCode(e.target.value)} disabled={!editable} maxLength={30} className={inputCls} />
          </Field>
          <Field label="Số giấy phép kinh doanh">
            <input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} disabled={!editable} maxLength={50} className={inputCls} />
          </Field>
        </div>
        <div className="space-y-2.5 pt-1">
          <h2 className="text-sm font-semibold text-zinc-200">Giấy tờ bắt buộc</h2>
          {docs.map((d) => (
            <DocumentUpload key={d.docType} doc={d} disabled={!editable} onChanged={onChanged} />
          ))}
          {extras.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-zinc-200 pt-2">
                Giấy tờ bổ sung <span className="font-normal text-zinc-500">(không bắt buộc)</span>
              </h2>
              <p className="text-[11px] text-zinc-500 -mt-1">Có thì tải lên để hồ sơ được duyệt nhanh hơn — không có cũng gửi được.</p>
              {extras.map((d) => (
                <DocumentUpload key={d.docType} doc={d} disabled={!editable} onChanged={onChanged} />
              ))}
            </>
          )}
          <PrivateNotice />
        </div>
      </div>
      <ErrorLine error={error} />
      <Nav
        onBack={onBack}
        next={() => save(() => partnerApplication.saveLegal({ legalName: legalName.trim(), taxCode: opt(taxCode) ?? null, businessLicenseNo: opt(licenseNo) ?? null }))}
        loading={saving}
        disabled={editable && legalName.trim().length < 2}
      />
    </>
  );
}

const SECTION_TO_STEP: Record<MissingItem["section"], StepId> = {
  REPRESENTATIVE: "representative",
  BRAND: "brand",
  SCALE: "scale",
  BRANCH: "branch",
  LOCATION: "location",
  PHOTOS: "photos",
  LEGAL: "legal",
  TERMS: "review",
};

function StepReview({ view, editable, onChanged, onBack, onGoTo }: StepProps & { onGoTo: (step: string) => void }) {
  const [accept, setAccept] = useState(Boolean(view.partner.termsAcceptedAt));
  const [error, setError] = useState<string | null>(null);
  const resubmitting = view.accessState === "CHANGES_REQUESTED";

  const nonTermsMissing = view.missing.filter((m) => m.section !== "TERMS");
  const openIssues = view.issues.filter((i) => i.status === "OPEN").length;
  const docsToReplace = view.documents.filter((d) => d.status === "REJECTED").length;
  const blockedByChanges = resubmitting && (openIssues > 0 || docsToReplace > 0);

  const submit = useMutation({
    mutationFn: async () => {
      if (resubmitting) return partnerApplication.resubmit();
      return partnerApplication.submit(accept);
    },
    onSuccess: () => {
      toast.success(resubmitting ? "Đã gửi lại hồ sơ" : "Đã gửi hồ sơ. Gymini sẽ xem xét và báo kết quả qua email.");
      onChanged();
    },
    onError: (e) => {
      const f = friendlyError(e, "Không gửi được hồ sơ. Vui lòng thử lại.");
      setError(f.message);
      onChanged();
    },
  });

  const canSubmit = editable && nonTermsMissing.length === 0 && (resubmitting || accept) && !blockedByChanges;

  return (
    <>
      <div className="space-y-4">
        {nonTermsMissing.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-2">
            <p className="text-sm font-semibold text-amber-300">Còn {nonTermsMissing.length} nội dung cần hoàn thiện</p>
            <ul className="space-y-1.5">
              {nonTermsMissing.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                  <span>{m.message}</span>
                  <button onClick={() => onGoTo(SECTION_TO_STEP[m.section])} className="shrink-0 text-green-400 hover:text-green-300 font-semibold">Đi tới</button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3.5 text-sm text-green-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Hồ sơ đã đủ thông tin.
          </div>
        )}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Summary label="Người đại diện" value={[view.partner.representativeName, view.partner.representativeRole ? ROLE_LABEL[view.partner.representativeRole] : null].filter(Boolean).join(" · ")} />
          <Summary label="Thương hiệu" value={view.brand?.name} />
          <div>
            <dt className="text-xs text-zinc-500">Mạng xã hội</dt>
            <dd className="mt-1">
              {SOCIALS.some((so) => view.brand?.[so.key]) ? <SocialLinks value={view.brand} compact /> : <span className="text-sm text-zinc-500">Chưa thêm</span>}
            </dd>
          </div>
          <Summary label="Chi nhánh đầu tiên" value={view.branch?.name} />
          <Summary label="Địa chỉ" value={view.branch?.address} />
          <Summary label="Tên pháp lý" value={view.partner.legalName} />
          <Summary label="Số ảnh" value={String(view.photos.length)} />
        </dl>
        <ul className="text-xs text-zinc-500 space-y-0.5">
          {view.documents.filter((d) => d.required).map((d) => (
            <li key={d.docType}>
              {DOC_LABEL[d.docType as DocType]}: {d.hasFile ? "đã tải lên" : "chưa có"}
            </li>
          ))}
        </ul>

        {blockedByChanges && (
          <p className="text-xs text-amber-300">
            Để gửi lại, hãy đánh dấu "đã cập nhật" cho {openIssues > 0 ? `${openIssues} yêu cầu còn mở` : "các yêu cầu"}
            {docsToReplace > 0 ? ` và thay ${docsToReplace} giấy tờ cần cập nhật` : ""}.
          </p>
        )}

        {!resubmitting && (
          <label className="flex items-start gap-2.5 text-xs text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} disabled={!editable} className="mt-0.5 accent-green-500" />
            <span>Tôi xác nhận thông tin cung cấp là chính xác và đồng ý với điều khoản đối tác của Gymini.</span>
          </label>
        )}
      </div>
      <ErrorLine error={error} />
      <div className="mt-6 flex items-center justify-between gap-3 max-lg:sticky max-lg:bottom-0 max-lg:-mx-5 max-lg:border-t max-lg:border-zinc-800 max-lg:bg-zinc-900/95 max-lg:px-5 max-lg:py-3 max-lg:backdrop-blur">
        <GhostButton onClick={onBack}>
          <ArrowLeft className="w-4 h-4" /> Quay lại
        </GhostButton>
        {editable && (
          <PrimaryButton onClick={() => submit.mutate()} disabled={!canSubmit} loading={submit.isPending}>
            <Send className="w-4 h-4" /> {resubmitting ? "Gửi lại hồ sơ" : "Gửi hồ sơ"}
          </PrimaryButton>
        )}
      </div>
    </>
  );
}

function Summary({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={blank(value) ? "text-zinc-600" : "text-zinc-200"}>{blank(value) ? "Chưa có" : value}</dd>
    </div>
  );
}
