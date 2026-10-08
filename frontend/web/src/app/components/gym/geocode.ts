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

async function searchNominatim(q: string, signal: AbortSignal): Promise<{ lat: number; lon: number; type: string } | null> {
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: "vn", "accept-language": "vi" });
  const res = await fetch(`${ENDPOINT}?${params}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat: string; lon: string; addresstype?: string }[];
  if (!rows.length) return null;
  const lat = Number(rows[0].lat);
  const lon = Number(rows[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, type: rows[0].addresstype ?? "" } : null;
}

/**
 * Bộ tra dự phòng: Photon (komoot) — cũng là dữ liệu OpenStreetMap, miễn phí, không cần khoá.
 * Cần vì DNS của mạng di động VinaPhone không phân giải được `openstreetmap.org`: trên mạng đó
 * Nominatim hỏng ở MỌI lần tra, người dùng phải ghim mù (đo trên điện thoại thật, 8/10).
 */
const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
/** Khung bao Việt Nam (kinh độ tây, vĩ độ nam, kinh độ đông, vĩ độ bắc) — thay cho `countrycodes=vn`. */
const VN_BBOX = "102.1,8.1,109.6,23.5";

type Hit = { lat: number; lon: number; type: string };

/** Kết quả Photon → cùng hình dạng với Nominatim; `type` quy về các loại mà bảng mức chính xác đã biết. */
export function photonHit(body: unknown): Hit | null {
  const feature = (
    body as {
      features?: { geometry?: { coordinates?: unknown[] }; properties?: { type?: string; countrycode?: string; housenumber?: string } }[];
    }
  )?.features?.[0];
  const [lon, lat] = (feature?.geometry?.coordinates ?? []).map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (feature?.properties?.countrycode && feature.properties.countrycode !== "VN") return null;
  const kind = feature?.properties?.type;
  // Photon khớp lỏng: "house" có thể là một toà nhà trùng tên đường. Chỉ coi là đúng địa chỉ khi kết
  // quả mang số nhà; còn lại hạ xuống mức đường để người dùng được nhắc kéo ghim cho đúng cửa.
  const exact = kind === "house" && !!feature?.properties?.housenumber;
  return { lat, lon, type: exact ? "house" : kind === "house" || kind === "street" ? "road" : "" };
}

async function searchPhoton(q: string, signal: AbortSignal): Promise<Hit | null> {
  const params = new URLSearchParams({ q, limit: "1", bbox: VN_BBOX });
  const res = await fetch(`${PHOTON_ENDPOINT}?${params}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return photonHit(await res.json());
}

/** Nominatim đã hỏng một lần trong phiên này thì các lần sau hỏi thẳng bộ dự phòng. */
let nominatimUnreachable = false;

async function search(q: string, signal: AbortSignal): Promise<Hit | null> {
  if (!nominatimUnreachable) {
    try {
      return await searchNominatim(q, signal);
    } catch (e) {
      // Người dùng gõ tiếp (huỷ) không phải là Nominatim hỏng.
      if ((e as { name?: string })?.name === "AbortError") throw e;
      nominatimUnreachable = true;
    }
  }
  return searchPhoton(q, signal);
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
