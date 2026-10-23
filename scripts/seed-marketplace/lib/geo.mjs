// Real wards (codes from backend/services/user-service/prisma/data/vietnam_provinces.json - the same vendored file the
// app's reference tables are built from) with approximate centroids (within ~1 km, for map pins) and real street names.
// Seed runtime reads only this local JSON; nothing here touches the network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROVINCES_FILE = path.resolve(here, "..", "..", "..", "backend", "services", "user-service", "prisma", "data", "vietnam_provinces.json");

export const CITIES = {
  HCM: { code: 79, label: "TP. Hồ Chí Minh", phonePrefix: "028" },
  HN: { code: 1, label: "Hà Nội", phonePrefix: "024" },
  DN: { code: 48, label: "Đà Nẵng", phonePrefix: "0236" },
  DNAI: { code: 75, label: "Đồng Nai", phonePrefix: "0251" },
};

// [city, ward name as in the vendored data, lat, lng, streets, district label people say]
const RAW_AREAS = [
  ["HCM", "Phường Bến Thành", 10.7725, 106.698, ["Lê Thánh Tôn", "Pasteur", "Phạm Ngũ Lão"], "Quận 1"],
  ["HCM", "Phường Sài Gòn", 10.7798, 106.7005, ["Nguyễn Huệ", "Đồng Khởi", "Hai Bà Trưng"], "Quận 1"],
  ["HCM", "Phường Tân Định", 10.792, 106.6905, ["Hai Bà Trưng", "Điện Biên Phủ", "Nguyễn Hữu Cầu"], "Quận 1"],
  ["HCM", "Phường Cầu Ông Lãnh", 10.765, 106.6925, ["Nguyễn Thái Học", "Cô Giang", "Trần Hưng Đạo"], "Quận 1"],
  ["HCM", "Phường Bàn Cờ", 10.769, 106.683, ["Nguyễn Thiện Thuật", "Cách Mạng Tháng Tám", "Bàn Cờ"], "Quận 3"],
  ["HCM", "Phường Nhiêu Lộc", 10.7885, 106.679, ["Nguyễn Thị Minh Khai", "Trần Quang Diệu", "Nhiêu Lộc"], "Quận 3"],
  ["HCM", "Phường Xuân Hòa", 10.7835, 106.689, ["Võ Văn Tần", "Nam Kỳ Khởi Nghĩa", "Trần Quốc Thảo"], "Quận 3"],
  ["HCM", "Phường Hòa Hưng", 10.779, 106.673, ["Cách Mạng Tháng Tám", "Ba Tháng Hai", "Nguyễn Văn Cừ"], "Quận 10"],
  ["HCM", "Phường Diên Hồng", 10.769, 106.67, ["Sư Vạn Hạnh", "Nguyễn Tri Phương", "Ngô Gia Tự"], "Quận 10"],
  ["HCM", "Phường Phú Nhuận", 10.7992, 106.68, ["Phan Xích Long", "Phan Đăng Lưu", "Huỳnh Văn Bánh"], "Phú Nhuận"],
  ["HCM", "Phường Cầu Kiệu", 10.793, 106.684, ["Phan Xích Long", "Hồ Văn Huê", "Nguyễn Văn Trỗi"], "Phú Nhuận"],
  ["HCM", "Phường Đức Nhuận", 10.803, 106.676, ["Nguyễn Kiệm", "Hoàng Văn Thụ", "Phan Đình Phùng"], "Phú Nhuận"],
  ["HCM", "Phường Bình Thạnh", 10.8105, 106.709, ["Điện Biên Phủ", "Xô Viết Nghệ Tĩnh", "Nguyễn Xí"], "Bình Thạnh"],
  ["HCM", "Phường Gia Định", 10.801, 106.699, ["Nguyễn Văn Đậu", "Bạch Đằng", "Phan Văn Trị"], "Bình Thạnh"],
  ["HCM", "Phường Thạnh Mỹ Tây", 10.795, 106.714, ["Nguyễn Hữu Cảnh", "Điện Biên Phủ", "Ngô Tất Tố"], "Bình Thạnh"],
  ["HCM", "Phường Gò Vấp", 10.8386, 106.6652, ["Quang Trung", "Nguyễn Oanh", "Lê Đức Thọ"], "Gò Vấp"],
  ["HCM", "Phường Hạnh Thông", 10.829, 106.682, ["Phạm Văn Chiêu", "Nguyễn Văn Nghi", "Thống Nhất"], "Gò Vấp"],
  ["HCM", "Phường Tân Bình", 10.8014, 106.6527, ["Trường Chinh", "Cộng Hòa", "Hoàng Hoa Thám"], "Tân Bình"],
  ["HCM", "Phường Bảy Hiền", 10.79, 106.65, ["Lý Thường Kiệt", "Âu Cơ", "Hoàng Hoa Thám"], "Tân Bình"],
  ["HCM", "Phường Tân Phú", 10.79, 106.628, ["Lũy Bán Bích", "Tân Hương", "Thoại Ngọc Hầu"], "Tân Phú"],
  ["HCM", "Phường Phú Thọ Hòa", 10.781, 106.629, ["Lũy Bán Bích", "Vườn Lài", "Nguyễn Sơn"], "Tân Phú"],
  ["HCM", "Phường Thủ Đức", 10.8494, 106.7537, ["Võ Văn Ngân", "Kha Vạn Cân", "Đặng Văn Bi"], "Thủ Đức"],
  ["HCM", "Phường Tăng Nhơn Phú", 10.847, 106.7978, ["Lê Văn Việt", "Đỗ Xuân Hợp", "Man Thiện"], "Thủ Đức"],
  ["HCM", "Phường An Khánh", 10.79, 106.74, ["Mai Chí Thọ", "Trần Não", "Nguyễn Cơ Thạch"], "Thủ Đức"],
  ["HCM", "Phường Bình Trưng", 10.789, 106.771, ["Nguyễn Duy Trinh", "Đồng Văn Cống", "Trần Não"], "Thủ Đức"],
  ["HCM", "Phường Tân Thuận", 10.738, 106.721, ["Huỳnh Tấn Phát", "Nguyễn Văn Linh", "Lâm Văn Bền"], "Quận 7"],
  ["HCM", "Phường Tân Mỹ", 10.729, 106.718, ["Nguyễn Lương Bằng", "Nguyễn Đức Cảnh", "Hoàng Văn Thái"], "Quận 7"],
  ["HCM", "Phường Bình Tân", 10.7655, 106.6038, ["Kinh Dương Vương", "Tân Kỳ Tân Quý", "Lê Văn Quới"], "Bình Tân"],
  ["HCM", "Phường An Lạc", 10.751, 106.612, ["Kinh Dương Vương", "Hồ Học Lãm", "An Dương Vương"], "Bình Tân"],
  ["HCM", "Phường Chợ Lớn", 10.752, 106.66, ["Châu Văn Liêm", "Lão Tử", "Trần Hưng Đạo B"], "Quận 5"],
  ["HCM", "Phường Phú Lâm", 10.75, 106.633, ["Hậu Giang", "Minh Phụng", "Phú Lâm"], "Quận 6"],
  ["HCM", "Phường Chánh Hưng", 10.738, 106.657, ["Phạm Hùng", "Bình Đông", "Dương Bá Trạc"], "Quận 8"],
  ["HCM", "Phường Khánh Hội", 10.758, 106.704, ["Hoàng Diệu", "Tôn Đản", "Nguyễn Tất Thành"], "Quận 4"],
  ["HCM", "Phường Minh Phụng", 10.764, 106.649, ["Lạc Long Quân", "Lãnh Binh Thăng", "Minh Phụng"], "Quận 11"],
  ["HN", "Phường Cầu Giấy", 21.0333, 105.79, ["Trần Thái Tông", "Xuân Thủy", "Cầu Giấy"], "Cầu Giấy"],
  ["HN", "Phường Yên Hòa", 21.02, 105.796, ["Trung Kính", "Nguyễn Chánh", "Trần Duy Hưng"], "Cầu Giấy"],
  ["HN", "Phường Nghĩa Đô", 21.047, 105.8, ["Hoàng Quốc Việt", "Nguyễn Văn Huyên", "Hoàng Minh Giám"], "Cầu Giấy"],
  ["HN", "Phường Đống Đa", 21.018, 105.828, ["Tây Sơn", "Thái Hà", "Chùa Bộc"], "Đống Đa"],
  ["HN", "Phường Láng", 21.02, 105.806, ["Láng Hạ", "Chùa Láng", "Nguyễn Chí Thanh"], "Đống Đa"],
  ["HN", "Phường Kim Liên", 21.007, 105.834, ["Phạm Ngọc Thạch", "Đào Duy Anh", "Xã Đàn"], "Đống Đa"],
  ["HN", "Phường Hai Bà Trưng", 21.007, 105.853, ["Bạch Mai", "Minh Khai", "Trần Khát Chân"], "Hai Bà Trưng"],
  ["HN", "Phường Bạch Mai", 21.0, 105.85, ["Bạch Mai", "Trương Định", "Đại Cồ Việt"], "Hai Bà Trưng"],
  ["HN", "Phường Hoàn Kiếm", 21.0285, 105.852, ["Hàng Bài", "Tràng Tiền", "Lý Thái Tổ"], "Hoàn Kiếm"],
  ["HN", "Phường Long Biên", 21.045, 105.89, ["Nguyễn Văn Cừ", "Ngọc Lâm", "Long Biên"], "Long Biên"],
  ["HN", "Phường Bồ Đề", 21.045, 105.865, ["Nguyễn Văn Cừ", "Ngô Gia Tự", "Cổ Linh"], "Long Biên"],
  ["HN", "Phường Thanh Xuân", 20.993, 105.812, ["Nguyễn Trãi", "Khuất Duy Tiến", "Lê Văn Lương"], "Thanh Xuân"],
  ["HN", "Phường Tây Hồ", 21.068, 105.823, ["Xuân Diệu", "Lạc Long Quân", "Âu Cơ"], "Tây Hồ"],
  ["HN", "Phường Giảng Võ", 21.027, 105.82, ["Kim Mã", "Đào Tấn", "Giảng Võ"], "Ba Đình"],
  ["HN", "Phường Ba Đình", 21.036, 105.834, ["Hoàng Hoa Thám", "Liễu Giai", "Văn Cao"], "Ba Đình"],
  ["HN", "Phường Từ Liêm", 21.05, 105.76, ["Hồ Tùng Mậu", "Phạm Hùng", "Cầu Diễn"], "Nam Từ Liêm"],
  ["HN", "Phường Hà Đông", 20.971, 105.777, ["Quang Trung", "Nguyễn Văn Trác", "Lê Lợi"], "Hà Đông"],
  ["HN", "Phường Hoàng Mai", 20.974, 105.862, ["Giải Phóng", "Nguyễn Cảnh Dị", "Kim Đồng"], "Hoàng Mai"],
  ["DNAI", "Phường Biên Hòa", 10.9447, 106.8243, ["Đồng Khởi", "Phạm Văn Thuận", "Nguyễn Ái Quốc"], "Biên Hòa"],
  ["DNAI", "Phường Trấn Biên", 10.95, 106.842, ["Võ Thị Sáu", "Đồng Khởi", "Cách Mạng Tháng Tám"], "Biên Hòa"],
  ["DNAI", "Phường Hố Nai", 10.954, 106.875, ["Quốc lộ 1A", "Nguyễn Ái Quốc", "Đồng Khởi"], "Biên Hòa"],
  ["DNAI", "Phường Tam Hiệp", 10.94, 106.86, ["Phạm Văn Thuận", "Nguyễn Ái Quốc", "Đồng Khởi"], "Biên Hòa"],
  ["DN", "Phường Hải Châu", 16.061, 108.221, ["Bạch Đằng", "Nguyễn Văn Linh", "Lê Duẩn"], "Hải Châu"],
  ["DN", "Phường Thanh Khê", 16.068, 108.196, ["Điện Biên Phủ", "Hà Huy Tập", "Nguyễn Tri Phương"], "Thanh Khê"],
  ["DN", "Phường Sơn Trà", 16.072, 108.238, ["Ngô Quyền", "Nguyễn Công Trứ", "Phạm Văn Đồng"], "Sơn Trà"],
  ["DN", "Phường An Hải", 16.06, 108.23, ["Trần Hưng Đạo", "Hồ Nghinh", "Ngô Quyền"], "Sơn Trà"],
  ["DN", "Phường Ngũ Hành Sơn", 16.002, 108.263, ["Võ Nguyên Giáp", "Huyền Trân Công Chúa", "Lê Văn Hiến"], "Ngũ Hành Sơn"],
  ["DN", "Phường Cẩm Lệ", 16.02, 108.2, ["Cách Mạng Tháng Tám", "Phan Đăng Lưu", "Hoàng Văn Thái"], "Cẩm Lệ"],
  ["DN", "Phường Liên Chiểu", 16.075, 108.15, ["Nguyễn Lương Bằng", "Tôn Đức Thắng", "Hoàng Văn Thụ"], "Liên Chiểu"],
  ["DN", "Phường Hòa Cường", 16.041, 108.217, ["Núi Thành", "Nguyễn Hữu Thọ", "Cách Mạng Tháng Tám"], "Hải Châu"],
];

let _provinces;
function provinces() {
  if (!_provinces) _provinces = JSON.parse(fs.readFileSync(PROVINCES_FILE, "utf8"));
  return _provinces;
}

let _areas;
/** All curated areas, each resolved to real province/ward codes. Throws if a ward name is not in the vendored data. */
export function areas() {
  if (_areas) return _areas;
  _areas = RAW_AREAS.map(([cityKey, wardName, lat, lng, streets, district]) => {
    const city = CITIES[cityKey];
    const prov = provinces().find((p) => p.code === city.code);
    const ward = prov?.wards.find((w) => w.name === wardName);
    if (!ward) throw new Error(`geo: ward "${wardName}" not found in province ${city.code}`);
    return { cityKey, city: city.label, provinceCode: prov.code, provinceName: prov.name, wardCode: ward.code, wardName, district, lat, lng, streets, phonePrefix: city.phonePrefix };
  });
  return _areas;
}

export const areasOfCity = (cityKey) => areas().filter((a) => a.cityKey === cityKey);
export const findArea = (cityKey, wardName) => {
  const a = areas().find((x) => x.cityKey === cityKey && x.wardName === wardName);
  if (!a) throw new Error(`geo: unknown area ${cityKey}/${wardName}`);
  return a;
};

/** Street address line for an area: "<no> <street>" - no ward text, the ward is a separate field. */
export function addressLine(area, rng) {
  const street = area.streets[Math.floor(rng() * area.streets.length)];
  const no = 1 + Math.floor(rng() * 380);
  const alley = rng() < 0.25 ? `/${1 + Math.floor(rng() * 40)}` : "";
  return `${no}${alley} ${street}`;
}

/** Pin position: the area centroid moved by up to ~400 m, rounded to 5 decimals (about 1 m). */
export function jitterLatLng(area, rng) {
  const lat = area.lat + (rng() - 0.5) * 0.007;
  const lng = area.lng + (rng() - 0.5) * 0.007;
  return { latitude: Number(lat.toFixed(5)), longitude: Number(lng.toFixed(5)) };
}

/** Mobile numbers: 03x/05x/07x/08x/09x + 8 digits (deterministic). */
export function mobilePhone(rng) {
  const prefixes = ["090", "093", "089", "070", "076", "077", "078", "079", "081", "082", "083", "084", "085", "086", "088", "091", "094", "096", "097", "098", "032", "033", "034", "035", "036", "037", "038", "039"];
  const p = prefixes[Math.floor(rng() * prefixes.length)];
  let rest = "";
  for (let i = 0; i < 7; i++) rest += Math.floor(rng() * 10);
  return `${p}${rest}`;
}

export function landlinePhone(area, rng) {
  const len = area.phonePrefix.length === 3 ? 8 : 7;
  let rest = String(2 + Math.floor(rng() * 8));
  for (let i = 1; i < len; i++) rest += Math.floor(rng() * 10);
  return `${area.phonePrefix}${rest}`;
}
