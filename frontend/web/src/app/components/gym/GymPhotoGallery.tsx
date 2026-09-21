import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeftIcon as Left, CaretRightIcon as Right, XIcon as X } from "@phosphor-icons/react";

export interface GalleryPhoto {
  id: string;
  url: string | null;
  category?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Mặt tiền",
  MAIN_TRAINING_AREA: "Khu tập chính",
  EQUIPMENT: "Trang thiết bị",
  CARDIO: "Khu cardio",
  CHANGING_ROOM: "Phòng thay đồ",
  AMENITIES: "Tiện ích",
  OTHER: "Khác",
};

/** Ảnh bìa lớn + dải ảnh nhỏ; bấm để xem to, chuyển ảnh bằng nút hoặc phím ←/→, Esc để đóng. */
export function GymPhotoGallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const list = photos.filter((p) => p.url);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % list.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + list.length) % list.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, list.length]);

  if (list.length === 0) return null;
  const label = (p: GalleryPhoto) => (p.category ? CATEGORY_LABEL[p.category] ?? "" : "");

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen(0)} className="relative block w-full aspect-[16/9] overflow-hidden rounded-xl bg-zinc-950">
        <img src={list[0].url!} alt={`${title} — ảnh bìa`} className="h-full w-full object-cover" />
        {label(list[0]) && <span className="absolute left-2 bottom-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] text-zinc-100">{label(list[0])}</span>}
        {list.length > 1 && <span className="absolute right-2 bottom-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] text-zinc-100">{list.length} ảnh</span>}
      </button>
      {list.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {list.slice(1).map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setOpen(i + 1)}
              className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-600"
            >
              <img src={p.url!} alt={`${title} — ${label(p) || `ảnh ${i + 2}`}`} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {open !== null &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label={`Ảnh ${title}`} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={() => setOpen(null)}>
            <button type="button" aria-label="Đóng" onClick={() => setOpen(null)} className="absolute right-3 top-3 rounded-full bg-zinc-800 p-2 text-zinc-200 hover:bg-zinc-700">
              <X className="w-5 h-5" />
            </button>
            {list.length > 1 && (
              <>
                <button type="button" aria-label="Ảnh trước" onClick={(e) => { e.stopPropagation(); setOpen((open - 1 + list.length) % list.length); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700">
                  <Left className="w-5 h-5" />
                </button>
                <button type="button" aria-label="Ảnh sau" onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % list.length); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700">
                  <Right className="w-5 h-5" />
                </button>
              </>
            )}
            <figure onClick={(e) => e.stopPropagation()} className="max-w-4xl w-full">
              <img src={list[open].url!} alt={`${title} — ${label(list[open]) || `ảnh ${open + 1}`}`} className="max-h-[80vh] w-full object-contain rounded-lg" />
              <figcaption className="mt-2 text-center text-xs text-zinc-400">
                {label(list[open]) && `${label(list[open])} · `}
                {open + 1}/{list.length}
              </figcaption>
            </figure>
          </div>,
          document.body,
        )}
    </div>
  );
}
