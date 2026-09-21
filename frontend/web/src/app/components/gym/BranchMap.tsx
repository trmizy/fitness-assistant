import { useEffect, useRef, useState } from "react";
import { CircleNotchIcon as Loader2, MapPinIcon as MapPin } from "@phosphor-icons/react";

export interface BranchPin {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const dot = (color: string, size: number) =>
  `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`;

/**
 * Bản đồ CHỈ XEM các chi nhánh của một thương hiệu (Leaflet + OpenStreetMap, nạp động như
 * MapLocationPicker). Chi nhánh đang xem ghim xanh lớn, các chi nhánh khác ghim xám; bấm ghim để xem
 * tên + địa chỉ. Chi nhánh chưa có toạ độ thì không vẽ — không bao giờ đoán vị trí.
 */
export function BranchMap({ branches, currentId, onSelect }: { branches: BranchPin[]; currentId: string; onSelect?: (id: string) => void }) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const pins = branches.filter((b) => b.latitude != null && b.longitude != null);
  const key = pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join("|") + `#${currentId}`;

  useEffect(() => {
    if (pins.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [L] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
        if (cancelled || !el.current) return;
        const Lf: any = (L as any).default ?? L;
        const map = Lf.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
        Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        const current = Lf.divIcon({ className: "", html: dot("#22C55E", 24), iconSize: [24, 24], iconAnchor: [12, 12] });
        const other = Lf.divIcon({ className: "", html: dot("#71717A", 18), iconSize: [18, 18], iconAnchor: [9, 9] });
        const latlngs: [number, number][] = [];
        for (const b of pins) {
          const ll: [number, number] = [b.latitude!, b.longitude!];
          latlngs.push(ll);
          const isCurrent = b.id === currentId;
          const m = Lf.marker(ll, { icon: isCurrent ? current : other, zIndexOffset: isCurrent ? 1000 : 0 }).addTo(map);
          m.bindPopup(`<strong>${escapeHtml(b.name)}</strong><br/>${escapeHtml(b.address)}${isCurrent ? "<br/><em>Chi nhánh đang xem</em>" : ""}`);
          if (!isCurrent) m.on("click", () => onSelectRef.current?.(b.id));
        }
        const here = pins.find((p) => p.id === currentId);
        if (latlngs.length > 1) map.fitBounds(latlngs, { padding: [28, 28], maxZoom: 16 });
        else map.setView(latlngs[0], 16);
        if (here && latlngs.length > 1) map.panTo([here.latitude, here.longitude]);
        mapRef.current = map;
        setState("ready");
        setTimeout(() => map.invalidateSize(), 120);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (pins.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center text-xs text-zinc-500">
        Chi nhánh chưa cập nhật vị trí trên bản đồ.
      </div>
    );
  }

  return (
    <div className="relative h-56 sm:h-64 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div ref={el} className="absolute inset-0" />
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 p-4 text-center">
          <MapPin className="w-6 h-6 text-zinc-500" />
          <p className="text-xs text-zinc-400">Không tải được bản đồ lúc này.</p>
        </div>
      )}
    </div>
  );
}
