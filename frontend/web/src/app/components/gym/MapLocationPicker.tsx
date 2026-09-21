import { useEffect, useRef, useState } from "react";
import { CircleNotchIcon as Loader2, MapPinIcon as MapPin } from "@phosphor-icons/react";

interface Props {
  latitude: number | null;
  longitude: number | null;
  onChange: (pos: { latitude: number; longitude: number }) => void;
}

const DEFAULT_CENTER: [number, number] = [10.7769, 106.7009];

/**
 * Bản đồ OpenStreetMap (Leaflet, nạp động để không nằm trong bundle chính): bấm hoặc kéo ghim để
 * đặt vị trí. Không geocoding trả phí. Toạ độ chỉ được đặt khi người dùng thật sự chọn — không
 * bao giờ tự điền toạ độ giả. Lỗi tải bản đồ thì trả về thông báo, form vẫn dùng được với nút
 * "Dùng vị trí hiện tại".
 */
export function MapLocationPicker({ latitude, longitude, onChange }: Props) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [L] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
        if (cancelled || !el.current) return;
        const Lf: any = (L as any).default ?? L;
        leafletRef.current = Lf;

        const hasPos = latitude != null && longitude != null;
        const map = Lf.map(el.current, { zoomControl: true, attributionControl: true }).setView(
          hasPos ? [latitude, longitude] : DEFAULT_CENTER,
          hasPos ? 16 : 12,
        );
        Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        const icon = Lf.divIcon({
          className: "",
          html: '<div style="width:22px;height:22px;border-radius:9999px;background:#22C55E;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const place = (lat: number, lng: number) => {
          if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
          } else {
            markerRef.current = Lf.marker([lat, lng], { draggable: true, icon }).addTo(map);
            markerRef.current.on("dragend", () => {
              const p = markerRef.current.getLatLng();
              onChangeRef.current({ latitude: p.lat, longitude: p.lng });
            });
          }
        };
        if (hasPos) place(latitude!, longitude!);
        map.on("click", (e: any) => {
          place(e.latlng.lat, e.latlng.lng);
          onChangeRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng });
        });
        mapRef.current = map;
        setState("ready");
        // Container có thể vừa hiện ra (bước wizard) — buộc Leaflet đo lại kích thước.
        setTimeout(() => map.invalidateSize(), 120);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // Chỉ khởi tạo một lần; vị trí đổi từ ngoài được đồng bộ ở effect dưới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đồng bộ khi vị trí đổi từ bên ngoài (vd nút "Dùng vị trí hiện tại").
  useEffect(() => {
    const map = mapRef.current;
    const Lf = leafletRef.current;
    if (!map || !Lf || latitude == null || longitude == null) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
    } else {
      const icon = Lf.divIcon({
        className: "",
        html: '<div style="width:22px;height:22px;border-radius:9999px;background:#22C55E;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      markerRef.current = Lf.marker([latitude, longitude], { draggable: true, icon }).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current.getLatLng();
        onChangeRef.current({ latitude: p.lat, longitude: p.lng });
      });
    }
    map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
  }, [latitude, longitude]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 h-64 sm:h-72">
        <div ref={el} className="absolute inset-0" />
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 p-4 text-center">
            <MapPin className="w-6 h-6 text-zinc-500" />
            <p className="text-xs text-zinc-400">Không tải được bản đồ. Bạn vẫn có thể dùng nút "Dùng vị trí hiện tại" bên dưới.</p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-zinc-600">
        {latitude != null && longitude != null
          ? "Kéo ghim hoặc bấm lên bản đồ để chỉnh vị trí chính xác của chi nhánh."
          : "Bấm lên bản đồ tại vị trí chi nhánh để đặt ghim."}
      </p>
    </div>
  );
}
