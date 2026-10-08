/**
 * Nguồn ô nền bản đồ, theo thứ tự thử. Cùng danh sách với app (`features/services/mapTiles.ts`).
 *
 * Một nguồn là không đủ: DNS của mạng di động VinaPhone không phân giải được `openstreetmap.org`,
 * nên bản đồ chỉ còn cái ghim trên nền xám (đo trên điện thoại thật, 8/10). Hai nguồn dự phòng là
 * máy chủ ô OpenStreetMap miễn phí khác, không cần khoá, ở tên miền khác — đều dùng theo nguyên tắc
 * "dùng vừa phải" của cộng đồng, hợp với lưu lượng hiện tại chứ không phải lưu lượng lớn.
 */
interface TileSource {
  url: string;
  subdomains?: string;
  maxNativeZoom: number;
  attribution: string;
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const TILE_SOURCES: TileSource[] = [
  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM },
  // Đức trước Pháp có chủ ý: máy chủ Pháp vẽ `name:fr`, mà đường ở trung tâm TP.HCM hầu hết có
  // tên tiếng Pháp ("Rue Lê Lợi", "Boulevard Hàm Nghi"). Kiểu Đức rơi về tên địa phương.
  { url: "https://tile.openstreetmap.de/{z}/{x}/{y}.png", maxNativeZoom: 18, attribution: `${OSM} · OSM Deutschland` },
  {
    url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxNativeZoom: 20,
    attribution: `${OSM} · OSM France`,
  },
];

/**
 * Gắn lớp nền vào bản đồ; nguồn hiện tại hỏng 2 ô liền mà chưa hiện được ô nào thì chuyển sang
 * nguồn kế. Nguồn đã hiện được ô thì giữ — một ô lỗi lẻ về sau không phải lý do đổi cả bản đồ.
 */
export function addBaseTiles(Lf: any, map: any): void {
  let index = 0;
  let layer: any = null;
  const use = (n: number) => {
    const s = TILE_SOURCES[n];
    let loaded = false;
    let errors = 0;
    if (layer) map.removeLayer(layer);
    layer = Lf.tileLayer(s.url, {
      maxZoom: 19,
      maxNativeZoom: s.maxNativeZoom,
      subdomains: s.subdomains ?? "abc",
      attribution: s.attribution,
    });
    layer.on("tileload", () => {
      loaded = true;
    });
    layer.on("tileerror", () => {
      errors++;
      if (!loaded && errors >= 2 && n === index && index < TILE_SOURCES.length - 1) {
        index++;
        use(index);
      }
    });
    layer.addTo(map);
  };
  use(0);
}
