import { useEffect, useState } from "react";
import { Modal, ModalClose } from "../ui/Modal";
import { CaretLeftIcon as Left, CaretRightIcon as Right, ArrowsOutIcon as Expand } from "@phosphor-icons/react";

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

const navBtn =
  "absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors";

/**
 * Ảnh lớn hiện TRỌN ảnh (object-contain, không cắt) + nút ‹ › ngay hai bên ảnh lớn để chuyển ảnh; dải
 * ảnh nhỏ bên dưới để chọn nhanh. Bấm ảnh lớn (hoặc nút phóng to) để xem toàn màn hình; ←/→ chuyển
 * ảnh, Esc đóng.
 */
export function GymPhotoGallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const list = photos.filter((p) => p.url);
  const [index, setIndex] = useState(0);
  const [full, setFull] = useState(false);
  const n = list.length;
  const go = (d: number) => setIndex((i) => (i + d + n) % n);

  useEffect(() => setIndex(0), [n]);
  useEffect(() => {
    if (!full) return;
    // Esc is handled by <Modal>; only the arrow keys are ours.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, n]);

  if (n === 0) return null;
  const cur = list[Math.min(index, n - 1)];
  const label = (p: GalleryPhoto) => (p.category ? CATEGORY_LABEL[p.category] ?? "" : "");

  return (
    <div className="space-y-2">
      <div className="relative w-full aspect-[4/3] overflow-hidden rounded-xl bg-zinc-950 border border-zinc-800">
        <button type="button" onClick={() => setFull(true)} aria-label="Xem ảnh toàn màn hình" className="block h-full w-full">
          <img src={cur.url!} alt={`${title} — ${label(cur) || `ảnh ${index + 1}`}`} className="h-full w-full object-contain" />
        </button>
        {n > 1 && (
          <>
            <button type="button" aria-label="Ảnh trước" onClick={() => go(-1)} className={`${navBtn} left-2`}>
              <Left className="w-5 h-5" />
            </button>
            <button type="button" aria-label="Ảnh sau" onClick={() => go(1)} className={`${navBtn} right-2`}>
              <Right className="w-5 h-5" />
            </button>
          </>
        )}
        {label(cur) && <span className="absolute left-2 bottom-2 rounded-md bg-black/70 px-2 py-0.5 text-[11px] text-white">{label(cur)}</span>}
        <span className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-0.5 text-[11px] text-white">
          {index + 1}/{n} <Expand className="w-3 h-3" />
        </span>
      </div>

      {n > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {list.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Chọn ảnh ${i + 1}`}
              aria-current={i === index}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-950 border-2 transition-colors ${
                i === index ? "border-green-500" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <img src={p.url!} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <Modal
        open={full}
        onClose={() => setFull(false)}
        ariaLabel={`Ảnh ${title}`}
        backdropClassName="bg-black/90 z-[80]"
        className="z-[80] p-4 on-media"
        data-testid="gym-photo-lightbox"
      >
        <ModalClose className="absolute right-3 top-3 z-10 rounded-full bg-black/60 text-white hover:bg-black/80" />
        {n > 1 && (
          <>
            <button type="button" aria-label="Ảnh trước" onClick={(e) => { e.stopPropagation(); go(-1); }} className={`${navBtn} left-3`}>
              <Left className="w-5 h-5" aria-hidden="true" />
            </button>
            <button type="button" aria-label="Ảnh sau" onClick={(e) => { e.stopPropagation(); go(1); }} className={`${navBtn} right-3`}>
              <Right className="w-5 h-5" aria-hidden="true" />
            </button>
          </>
        )}
        <figure className="max-w-4xl w-full">
          <img src={cur.url!} alt={`${title} — ${label(cur) || `ảnh ${index + 1}`}`} className="max-h-[80vh] w-full object-contain rounded-lg" />
          <figcaption className="mt-2 text-center text-xs text-white/80">
            {label(cur) && `${label(cur)} · `}
            {index + 1}/{n}
          </figcaption>
        </figure>
      </Modal>
    </div>
  );
}
