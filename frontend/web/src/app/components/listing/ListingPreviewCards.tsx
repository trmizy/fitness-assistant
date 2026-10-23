import { CheckCircleIcon, ClockIcon } from "@phosphor-icons/react";
import type { PtListingPreview } from "../../types";
import type { GymListingPreviewDto } from "../../services/ptListingApi";
import { formatVND } from "../../utils/currency";
import { optionsWithSaved, TARGET_GROUP_OPTIONS, TRAINING_GOAL_OPTIONS } from "../../utils/ptListing";
import { AmenityIcon } from "./AmenityIcon";
import { ListingImage } from "./ListingImage";

const labelOf = (known: typeof TARGET_GROUP_OPTIONS, values: string[]) => {
  const all = optionsWithSaved(known, values);
  return values.map((v) => all.find((o) => o.value === v)?.label ?? v);
};

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <span key={v} className="rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-300">
          {v}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h4>
      {children}
    </div>
  );
}

const modeLabel = (m: string) => (m === "ONLINE" ? "Online" : "Trực tiếp");

/**
 * What a client would see on the trainer's card and detail — built from the server's preview DTO (same price
 * derivation as the public one), so "từ X/buổi" and "Gói từ Y" match what will really be shown.
 */
export function PtPreviewCard({ preview }: { preview: PtListingPreview }) {
  const photos = preview.photos;
  const cover = photos.find((p) => p.isCover) ?? photos[0] ?? null;
  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        {cover ? <ListingImage url={cover.url} alt="Ảnh bìa" className="size-20 shrink-0 rounded-xl" /> : <div className="size-20 shrink-0 rounded-xl bg-zinc-800" />}
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-zinc-100">{preview.name}</h3>
          {preview.fromPricePerSession ? (
            <p className="text-sm font-semibold text-green-400">từ {formatVND(preview.fromPricePerSession)}/buổi</p>
          ) : (
            <p className="text-sm text-zinc-500">Chưa có gói đang bán</p>
          )}
          <Chips items={preview.profile.mainSpecialties} />
        </div>
      </div>

      {preview.profile.professionalBio && (
        <Section title="Giới thiệu">
          <p className="whitespace-pre-wrap text-sm text-zinc-300">{preview.profile.professionalBio}</p>
        </Section>
      )}
      {preview.profile.trainingMethodsApproach && (
        <Section title="Phương pháp huấn luyện">
          <p className="whitespace-pre-wrap text-sm text-zinc-300">{preview.profile.trainingMethodsApproach}</p>
        </Section>
      )}
      <Section title="Nhóm học viên">
        <Chips items={labelOf(TARGET_GROUP_OPTIONS, preview.profile.targetClientGroups)} />
      </Section>
      <Section title="Mục tiêu huấn luyện">
        <Chips items={labelOf(TRAINING_GOAL_OPTIONS, preview.profile.primaryTrainingGoals)} />
      </Section>
      <Section title="Ngôn ngữ">
        <Chips items={preview.profile.languages} />
      </Section>

      {photos.length > 0 && (
        <Section title="Ảnh hình thể">
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <ListingImage key={p.id} url={p.url} alt={`Ảnh ${i + 1}`} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        </Section>
      )}

      <Section title={preview.fromPackagePrice ? `Gói dịch vụ · Gói từ ${formatVND(preview.fromPackagePrice)}` : "Gói dịch vụ"}>
        {preview.packages.length === 0 ? (
          <p className="text-sm text-zinc-500">Chưa có gói nào đang bán.</p>
        ) : (
          <ul className="space-y-2">
            {preview.packages.map((p, i) => (
              <li key={p.id ?? `new-${i}`} className="rounded-xl border border-zinc-800/70 bg-zinc-800/30 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-zinc-100">{p.name}</span>
                  <span className="shrink-0 font-bold text-green-400">{formatVND(p.price)}</span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {p.sessionCount} buổi · {p.sessionDurationMinutes} phút/buổi · {modeLabel(p.sessionMode)}
                  {p.validityDays ? ` · dùng trong ${p.validityDays} ngày` : ""}
                </p>
                {p.isNew && <span className="mt-1 inline-block rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-300">Gói mới</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function GymPreviewCard({ preview }: { preview: GymListingPreviewDto }) {
  const cover = preview.photos.find((p) => p.isCover) ?? preview.photos[0] ?? null;
  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800/70 bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        {cover ? <ListingImage url={cover.url} alt="Ảnh bìa" className="size-20 shrink-0 rounded-xl" /> : <div className="size-20 shrink-0 rounded-xl bg-zinc-800" />}
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-zinc-100">{preview.name}</h3>
          <p className="text-sm text-zinc-500">{[preview.address, preview.city].filter(Boolean).join(", ")}</p>
        </div>
      </div>
      {preview.description && (
        <Section title="Giới thiệu">
          <p className="whitespace-pre-wrap text-sm text-zinc-300">{preview.description}</p>
        </Section>
      )}
      <Section title="Tiện ích">
        <div className="flex flex-wrap gap-1.5">
          {preview.amenities.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-300">
              <AmenityIcon iconKey={a.iconKey} className="size-3.5" />
              {a.name}
              {a.disabled && <span className="text-amber-400">(đã tắt)</span>}
            </span>
          ))}
          {preview.pendingAmenities.map((a) => (
            <span key={a.proposalId} className="inline-flex items-center gap-1 rounded-full border border-dashed border-blue-500/40 px-2.5 py-1 text-xs text-blue-300">
              <ClockIcon className="size-3.5" /> {a.name} · chờ duyệt
            </span>
          ))}
          {preview.amenities.length === 0 && preview.pendingAmenities.length === 0 && <span className="text-sm text-zinc-500">Chưa chọn tiện ích.</span>}
        </div>
      </Section>
      {preview.photos.length > 0 && (
        <Section title="Ảnh">
          <div className="grid grid-cols-3 gap-2">
            {preview.photos.map((p, i) => (
              <ListingImage key={p.id} url={p.url} alt={`Ảnh ${i + 1}`} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function PreviewNotice({ expiresAt }: { expiresAt: string | null }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-zinc-500">
      <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0" />
      Đây là bản xem trước nội dung đang soạn — khách chưa thấy cho tới khi được duyệt.
      {expiresAt ? " Liên kết ảnh chưa công khai chỉ dùng được trong ít phút." : ""}
    </p>
  );
}
