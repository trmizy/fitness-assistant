/**
 * Đổi địa chỉ chữ → toạ độ bằng Nominatim của OpenStreetMap (miễn phí, đúng quyết định "Leaflet + OSM,
 * không geocoding trả phí"). Chỉ là GỢI Ý để ghim sẵn trên bản đồ — người dùng vẫn kéo ghim để sửa, và
 * toạ độ chỉ được lưu khi họ bấm "Tiếp tục".
 *
 * Chính sách dùng Nominatim: tối đa 1 yêu cầu/giây, không tra hàng loạt. Nên ở đây: chỉ gọi khi người dùng
 * dừng gõ (debounce ở nơi gọi), tối đa 3 lần thử cho một địa chỉ, cách nhau hơn 1 giây.
 *
 * Luôn kèm tên phường: đã thử thật, "Phan Xích Long, Hồ Chí Minh" không có phường ra nhầm đường cùng tên
 * ở phường Minh Phụng; có "Phường Cầu Kiệu" thì ra đúng.
 */

export type GeocodePrecision = "ADDRESS" | "STREET" | "WARD";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const GAP_MS = 1100;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Loại kết quả của Nominatim → mức chính xác hiển thị cho người dùng. */
const HOUSE_TYPES = new Set(["building", "house", "amenity", "shop", "office", "leisure", "place"]);
const ROAD_TYPES = new Set(["road", "neighbourhood", "quarter", "hamlet"]);

async function search(q: string, signal: AbortSignal): Promise<{ lat: number; lon: number; type: string } | null> {
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: "vn", "accept-language": "vi" });
  const res = await fetch(`${ENDPOINT}?${params}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat: string; lon: string; addresstype?: string }[];
  if (!rows.length) return null;
  const lat = Number(rows[0].lat);
  const lon = Number(rows[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, type: rows[0].addresstype ?? "" } : null;
}

/** Bỏ số nhà / hẻm ở đầu ("123/4 Lê Lợi" → "Lê Lợi") để thử lại ở mức tên đường. */
const stripHouseNumber = (s: string) => s.replace(/^\s*(số\s*)?[\d/\-a-zA-Z]*\d[\d/\-a-zA-Z]*[\s,]+/i, "").trim();

/**
 * Thử từ cụ thể tới khái quát: địa chỉ đầy đủ → tên đường → chỉ phường. Trả về null nếu không thấy gì,
 * hoặc ném lỗi mạng (nơi gọi hiển thị thông điệp nhẹ, không chặn người dùng).
 */
export async function geocodeAddress(
  { street, ward, province }: { street: string; ward: string; province: string },
  signal: AbortSignal,
): Promise<GeocodeResult | null> {
  const area = `${ward}, ${province}`;
  const attempts = [`${street}, ${area}`];
  const streetOnly = stripHouseNumber(street);
  if (streetOnly && streetOnly !== street) attempts.push(`${streetOnly}, ${area}`);
  attempts.push(area);

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await wait(GAP_MS, signal);
    const hit = await search(attempts[i], signal);
    if (!hit) continue;
    // Lần thử cuối chỉ có phường → luôn là mức phường, dù Nominatim trả loại gì.
    const precision: GeocodePrecision =
      attempts[i] === area ? "WARD" : HOUSE_TYPES.has(hit.type) ? "ADDRESS" : ROAD_TYPES.has(hit.type) ? "STREET" : "WARD";
    return { latitude: hit.lat, longitude: hit.lon, precision };
  }
  return null;
}
