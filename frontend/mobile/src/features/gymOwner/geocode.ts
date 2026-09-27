/**
 * Địa chỉ chữ → toạ độ, bằng Nominatim của OpenStreetMap. Cùng một tệp với web
 * (`components/gym/geocode.ts`) — cùng endpoint, cùng thứ tự thử, cùng cách suy mức chính xác — nên
 * một địa chỉ ghim ở web và ghim trong app ra đúng một chỗ.
 *
 * Chỉ là GỢI Ý để ghim sẵn bản đồ: người dùng vẫn kéo ghim, và toạ độ chỉ lưu khi họ bấm tạo.
 *
 * Chính sách Nominatim: tối đa 1 yêu cầu/giây, không tra hàng loạt → nơi gọi phải debounce, và ba
 * lần thử ở đây cách nhau hơn một giây.
 *
 * Khác web ở đúng một chỗ: `DOMException` không có trong Hermes, nên huỷ giữa đường ném một `Error`
 * mang `name = "AbortError"` — nơi gọi vẫn kiểm bằng `name` như trên web.
 */

export type GeocodePrecision = "ADDRESS" | "STREET" | "WARD";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const GAP_MS = 1100;

export function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(abortError());
    });
  });

/** Loại kết quả của Nominatim → mức chính xác hiển thị cho người dùng. */
const HOUSE_TYPES = new Set(["building", "house", "amenity", "shop", "office", "leisure", "place"]);
const ROAD_TYPES = new Set(["road", "neighbourhood", "quarter", "hamlet"]);

async function search(q: string, signal: AbortSignal): Promise<{ lat: number; lon: number; type: string } | null> {
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "1",
    countrycodes: "vn",
    "accept-language": "vi",
  });
  const res = await fetch(`${ENDPOINT}?${params}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat: string; lon: string; addresstype?: string }[];
  if (!rows.length) return null;
  const lat = Number(rows[0].lat);
  const lon = Number(rows[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, type: rows[0].addresstype ?? "" } : null;
}

/** Bỏ số nhà / hẻm ở đầu ("123/4 Lê Lợi" → "Lê Lợi") để thử lại ở mức tên đường. */
export const stripHouseNumber = (s: string) =>
  s.replace(/^\s*(số\s*)?[\d/\-a-zA-Z]*\d[\d/\-a-zA-Z]*[\s,]+/i, "").trim();

/** Câu tra: luôn kèm tên phường — "Phan Xích Long, Hồ Chí Minh" thiếu phường ra nhầm đường cùng tên. */
export function geocodeAttempts({ street, ward, province }: { street: string; ward: string; province: string }) {
  const area = `${ward}, ${province}`;
  const attempts = [`${street}, ${area}`];
  const streetOnly = stripHouseNumber(street);
  if (streetOnly && streetOnly !== street) attempts.push(`${streetOnly}, ${area}`);
  attempts.push(area);
  return { attempts, area };
}

/**
 * Thử từ cụ thể tới khái quát: địa chỉ đầy đủ → tên đường → chỉ phường. Trả null nếu không thấy gì,
 * hoặc ném lỗi mạng (nơi gọi hiển thị một dòng nhẹ, không chặn người dùng).
 */
export async function geocodeAddress(
  loc: { street: string; ward: string; province: string },
  signal: AbortSignal,
): Promise<GeocodeResult | null> {
  const { attempts, area } = geocodeAttempts(loc);

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await wait(GAP_MS, signal);
    const hit = await search(attempts[i], signal);
    if (!hit) continue;
    // Lần thử cuối chỉ có phường → luôn là mức phường, dù Nominatim trả loại gì.
    const precision: GeocodePrecision =
      attempts[i] === area
        ? "WARD"
        : HOUSE_TYPES.has(hit.type)
          ? "ADDRESS"
          : ROAD_TYPES.has(hit.type)
            ? "STREET"
            : "WARD";
    return { latitude: hit.lat, longitude: hit.lon, precision };
  }
  return null;
}

export const PRECISION_TEXT: Record<GeocodePrecision, string> = {
  ADDRESS: "Đã ghim theo địa chỉ bạn nhập",
  STREET: "Đã ghim theo tên đường — kéo ghim cho đúng cửa nếu cần",
  WARD: "Chỉ ghim được tới phường/xã — kéo ghim về đúng chỗ",
};
