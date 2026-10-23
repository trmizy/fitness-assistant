import { ArrowDownIcon, ArrowUpIcon, StarIcon, TrashIcon } from "@phosphor-icons/react";
import { ListingImage } from "./ListingImage";
import { cn } from "../ui/utils";

export interface PhotoTile {
  id: string;
  url: string | null;
  isCover: boolean;
  /** STAGED = uploaded but not public yet. */
  status?: string;
}

interface Props {
  photos: PhotoTile[];
  /** B21: order is changed with ↑ ↓ buttons (keyboard-usable), never by drag only. */
  onMove?: (id: string, direction: -1 | 1) => void;
  onSetCover?: (id: string) => void;
  onRemove?: (id: string) => void;
  removeLabel?: string;
  /** Pending / preview: show the photos, no buttons. */
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
}

const btn =
  "inline-flex size-9 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50";

/** The photo list of a listing: ↑ ↓ to reorder, "đặt làm ảnh bìa", remove. Used by the PT page and the admin dialogs. */
export function ListingPhotoGrid({ photos, onMove, onSetCover, onRemove, removeLabel = "Gỡ ảnh", readOnly, disabled, className }: Props) {
  return (
    <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", className)}>
      {photos.map((p, index) => (
        <li key={p.id} className={cn("overflow-hidden rounded-xl border bg-zinc-900", p.isCover ? "border-green-500/50" : "border-zinc-800/70")}>
          <div className="relative">
            <ListingImage url={p.url} alt={`Ảnh ${index + 1}`} className="aspect-square w-full" />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">{index + 1}</span>
            {p.isCover && (
              <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold text-black">
                <StarIcon className="size-3" weight="fill" /> Ảnh bìa
              </span>
            )}
            {p.status === "STAGED" && (
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black">Chưa công khai</span>
            )}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5 p-2">
              {onMove && (
                <>
                  <button type="button" className={btn} aria-label={`Chuyển ảnh ${index + 1} lên trước`} disabled={disabled || index === 0} onClick={() => onMove(p.id, -1)}>
                    <ArrowUpIcon className="size-4" />
                  </button>
                  <button type="button" className={btn} aria-label={`Chuyển ảnh ${index + 1} xuống sau`} disabled={disabled || index === photos.length - 1} onClick={() => onMove(p.id, 1)}>
                    <ArrowDownIcon className="size-4" />
                  </button>
                </>
              )}
              {onSetCover && (
                <button type="button" className={cn(btn, "w-auto gap-1 px-2.5 text-xs")} disabled={disabled || p.isCover} onClick={() => onSetCover(p.id)}>
                  <StarIcon className="size-4" /> Đặt làm bìa
                </button>
              )}
              {onRemove && (
                <button type="button" className={cn(btn, "ml-auto text-red-400")} aria-label={`${removeLabel} ${index + 1}`} title={removeLabel} disabled={disabled} onClick={() => onRemove(p.id)}>
                  <TrashIcon className="size-4" />
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
