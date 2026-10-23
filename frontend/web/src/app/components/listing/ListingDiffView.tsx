import type { ReactNode } from "react";
import { ArrowRightIcon, MinusIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { DiffRow } from "../../utils/listingDiff";
import { ListingImage } from "./ListingImage";
import { cn } from "../ui/utils";

export interface GymDiffFlags {
  hasDisabledAmenity: boolean;
  disabledAmenities: Array<{ id: string; name: string }>;
  hasPendingProposal: boolean;
  pendingProposals: Array<{ id: string; name: string }>;
}

interface Props {
  rows: DiffRow[];
  /** id → image URL for the thumbnails of the photo / cover rows. */
  photoUrlOf?: (id: string) => string | null;
  /** Gym only: the revision still has a disabled amenity / a custom amenity waiting for a decision. */
  flags?: GymDiffFlags;
  /** Opens the "Đề xuất tiện ích" tab. */
  onOpenProposals?: () => void;
  emptyText?: string;
}

const add = "border-green-500/25 bg-green-500/10 text-green-300";
const del = "border-red-500/25 bg-red-500/10 text-red-300";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800/70 bg-zinc-900/60 p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h4>
      {children}
    </section>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone: "add" | "del" }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", tone === "add" ? add : del)}>
      {tone === "add" ? <PlusIcon className="size-3" weight="bold" /> : <MinusIcon className="size-3" weight="bold" />}
      {children}
    </span>
  );
}

function Value({ text, tone }: { text: string | null; tone: "old" | "new" }) {
  return (
    <div className={cn("whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm", tone === "old" ? del : add)}>
      {text ? text : <span className="italic opacity-70">Trống</span>}
    </div>
  );
}

function Thumbs({ ids, photoUrlOf, tone }: { ids: string[]; photoUrlOf?: (id: string) => string | null; tone?: "add" | "del" }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => (
        <ListingImage
          key={id}
          url={photoUrlOf?.(id) ?? null}
          alt="Ảnh"
          className={cn("size-16 rounded-lg border-2", tone === "add" ? "border-green-500/60" : tone === "del" ? "border-red-500/60 opacity-70" : "border-zinc-700")}
        />
      ))}
    </div>
  );
}

/**
 * <ListingDiffView/> — field-by-field "hiện tại → đề xuất" for one revision (PT or gym). The server computes what
 * changed (`changes`); utils/listingDiff.ts words it; this only draws it. Photos show what was added, what was taken
 * out, whether the order changed and which one is the cover now; packages show their price / sessions / mode edits.
 */
export function ListingDiffView({ rows, photoUrlOf, flags, onOpenProposals, emptyText = "Không có thay đổi nào so với tin đăng hiện tại." }: Props) {
  return (
    <div className="space-y-3">
      {flags?.hasDisabledAmenity && (
        <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300" role="status">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            Có tiện ích đã ngừng trong danh mục: <b>{flags.disabledAmenities.map((a) => a.name).join(", ")}</b>. Bạn có thể chọn "Duyệt và bỏ tiện ích đã tắt".
          </div>
        </div>
      )}
      {flags?.hasPendingProposal && (
        <div className="flex gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-300" role="status">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <div>
              Bản sửa còn tiện ích tùy chỉnh đang chờ duyệt: <b>{flags.pendingProposals.map((p) => p.name).join(", ")}</b>. Cần xử lý đề xuất trước khi duyệt bản sửa.
            </div>
            {onOpenProposals && (
              <button type="button" onClick={onOpenProposals} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                Mở tab "Đề xuất tiện ích" <ArrowRightIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 && <p className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">{emptyText}</p>}

      {rows.map((row) => {
        switch (row.kind) {
          case "text":
            return (
              <Block key={row.key} title={row.label}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[11px] text-zinc-500">Hiện tại</p>
                    <Value text={row.before} tone="old" />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-zinc-500">Đề xuất</p>
                    <Value text={row.after} tone="new" />
                  </div>
                </div>
              </Block>
            );
          case "list":
            return (
              <Block key={row.key} title={row.label}>
                <div className="flex flex-wrap gap-1.5">
                  {row.added.map((v) => <Chip key={`a-${v}`} tone="add">{v}</Chip>)}
                  {row.removed.map((v) => <Chip key={`r-${v}`} tone="del">{v}</Chip>)}
                </div>
              </Block>
            );
          case "amenities":
            return (
              <Block key={row.key} title={row.label}>
                <div className="flex flex-wrap gap-1.5">
                  {row.added.map((v, i) => <Chip key={`a-${i}-${v}`} tone="add">{v}</Chip>)}
                  {row.removed.map((v, i) => <Chip key={`r-${i}-${v}`} tone="del">{v}</Chip>)}
                </div>
              </Block>
            );
          case "package":
            return (
              <Block key={row.key} title={row.change === "added" ? "Gói mới" : row.change === "removed" ? "Gói bị gỡ" : "Gói thay đổi"}>
                <p className="mb-2 text-sm font-semibold text-zinc-100">{row.name}</p>
                <dl className="space-y-1.5">
                  {row.fields.map((f) => (
                    <div key={f.label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <dt className="w-full text-[11px] text-zinc-500 sm:w-40">{f.label}</dt>
                      <dd className="flex flex-wrap items-center gap-2">
                        {f.before !== null && <span className={cn("rounded-md border px-2 py-0.5 text-xs", del, f.after !== null && "line-through")}>{f.before}</span>}
                        {f.before !== null && f.after !== null && <ArrowRightIcon className="size-3.5 text-zinc-500" />}
                        {f.after !== null && <span className={cn("rounded-md border px-2 py-0.5 text-xs", add)}>{f.after}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Block>
            );
          case "photos":
            return (
              <Block key={row.key} title="Ảnh">
                <div className="space-y-3">
                  {row.added.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs text-green-300">Thêm {row.added.length} ảnh</p>
                      <Thumbs ids={row.added} photoUrlOf={photoUrlOf} tone="add" />
                    </div>
                  )}
                  {row.removed.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs text-red-300">Gỡ {row.removed.length} ảnh</p>
                      <Thumbs ids={row.removed} photoUrlOf={photoUrlOf} tone="del" />
                    </div>
                  )}
                  {row.reordered && <p className="text-xs text-amber-300">Thứ tự ảnh được thay đổi.</p>}
                  <div>
                    <p className="mb-1 text-xs text-zinc-500">Thứ tự sau khi duyệt</p>
                    <Thumbs ids={row.after} photoUrlOf={photoUrlOf} />
                  </div>
                </div>
              </Block>
            );
          case "cover":
            return (
              <Block key={row.key} title="Ảnh bìa">
                <div className="flex items-center gap-3">
                  {row.before ? <ListingImage url={photoUrlOf?.(row.before) ?? null} alt="Ảnh bìa hiện tại" className="size-16 rounded-lg border-2 border-red-500/60 opacity-70" /> : <span className="text-xs text-zinc-500">Chưa có</span>}
                  <ArrowRightIcon className="size-4 text-zinc-500" />
                  {row.after ? <ListingImage url={photoUrlOf?.(row.after) ?? null} alt="Ảnh bìa đề xuất" className="size-16 rounded-lg border-2 border-green-500/60" /> : <span className="text-xs text-zinc-500">Bỏ ảnh bìa</span>}
                </div>
              </Block>
            );
        }
      })}
    </div>
  );
}
