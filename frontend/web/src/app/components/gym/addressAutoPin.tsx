import { useEffect, useRef, useState } from "react";
import { CircleNotchIcon as Loader } from "@phosphor-icons/react";
import { locationService } from "../../services/api";
import { geocodeAddress, type GeocodePrecision } from "./geocode";

/*
 * Tự ghim bản đồ theo địa chỉ đã nhập — dùng chung cho wizard hồ sơ đối tác và hộp "Thêm chi nhánh"
 * của chủ gym. Chỉ là gợi ý: người dùng vẫn kéo ghim để sửa, toạ độ chỉ lưu khi họ bấm lưu.
 */

/** Tên tỉnh/thành và phường/xã đang chọn (bộ chọn chỉ giữ mã) — cần cho câu tra địa chỉ trên bản đồ. */
export function useLocationNames(provinceCode: number | null, wardCode: number | null) {
  const [provinces, setProvinces] = useState<{ code: number; name: string }[]>([]);
  const [wards, setWards] = useState<{ code: number; name: string }[]>([]);
  useEffect(() => {
    locationService.getProvinces().then(setProvinces).catch(() => {});
  }, []);
  useEffect(() => {
    setWards([]);
    if (!provinceCode) return;
    locationService.getWards(provinceCode).then(setWards).catch(() => {});
  }, [provinceCode]);
  return {
    province: provinces.find((p) => p.code === provinceCode)?.name ?? null,
    ward: wards.find((w) => w.code === wardCode)?.name ?? null,
  };
}

type AutoPinStatus =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "found"; precision: GeocodePrecision }
  | { state: "notfound" }
  | { state: "error" };

/**
 * Khi đủ số nhà/đường + phường + tỉnh và người dùng ngừng gõ, tra toạ độ rồi ghim sẵn. Chỉ tra lại khi
 * địa chỉ ĐỔI — kéo ghim bằng tay xong thì không bị ghi đè. Hồ sơ đã có ghim lưu sẵn thì lần mở lại
 * không tự tra (giữ nguyên ghim người dùng đã chỉnh).
 */
export function useAutoPin({
  enabled,
  hadSavedPin,
  street,
  ward,
  province,
  onPin,
}: {
  enabled: boolean;
  hadSavedPin: boolean;
  street: string;
  ward: string | null;
  province: string | null;
  onPin: (latitude: number, longitude: number) => void;
}) {
  const [status, setStatus] = useState<AutoPinStatus>({ state: "idle" });
  const lastKey = useRef<string | null>(null);
  const skipSaved = useRef(hadSavedPin);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;

  const key = enabled && street.length >= 5 && ward && province ? `${street}|${ward}|${province}` : null;

  useEffect(() => {
    if (!key) return;
    if (skipSaved.current) {
      skipSaved.current = false;
      lastKey.current = key;
      return;
    }
    if (key === lastKey.current) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      lastKey.current = key;
      setStatus({ state: "searching" });
      geocodeAddress({ street, ward: ward!, province: province! }, ctrl.signal)
        .then((hit) => {
          if (!hit) return setStatus({ state: "notfound" });
          onPinRef.current(hit.latitude, hit.longitude);
          setStatus({ state: "found", precision: hit.precision });
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setStatus({ state: "error" });
        });
    }, 1200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // street/ward/province đều nằm trong key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { status, markManual: () => setStatus({ state: "idle" }) };
}

const PIN_MESSAGE: Record<GeocodePrecision, string> = {
  ADDRESS: "Đã ghim theo địa chỉ. Kéo ghim nếu chưa đúng cửa chi nhánh.",
  STREET: "Chỉ tìm thấy tên đường — hãy kéo ghim tới đúng số nhà.",
  WARD: "Chỉ tìm thấy phường/xã — hãy kéo ghim tới đúng vị trí chi nhánh.",
};

export function AutoPinStatus({ status }: { status: AutoPinStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "searching")
    return (
      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
        <Loader className="w-3.5 h-3.5 animate-spin" /> Đang tìm vị trí theo địa chỉ…
      </p>
    );
  if (status.state === "found")
    return <p className={`text-xs ${status.precision === "ADDRESS" ? "text-green-400" : "text-amber-300"}`}>{PIN_MESSAGE[status.precision]}</p>;
  return (
    <p className="text-xs text-amber-300">
      {status.state === "notfound" ? "Không tìm thấy địa chỉ này trên bản đồ" : "Chưa tra được bản đồ lúc này"} — hãy bấm lên bản đồ để ghim vị trí.
    </p>
  );
}
