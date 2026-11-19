// Ảnh VĐV (IFBB Pro Việt Nam + Mr. Olympia) — chỉ dùng cho demo khoá luận. Cắt collage + xuất WebP theo tên slot.
const sharp = require('D:/FitnessAssistant/backend/services/user-service/node_modules/sharp');
const V = '_media-raw/vnpro/', M = '_media-raw/mro/';
const SRC = {
  dang_card: [V + 'dang-gs2.jpg'],
  giang_overall: [V + 'giang-overall.jpg'],
  phuc_card: [V + 'phuc-classic.jpg'],
  dang_podium: [V + 'dang-gs1.jpg'],
  dang_global: [V + 'dang-ruby2.png'],
  dang_npc: [V + 'dang-ruby3.webp', { left: 0, top: 0, width: 590, height: 800 }],
  tuananh: [V + 'tuananh-ruby.webp', { left: 0, top: 0, width: 600, height: 800 }],
  agp_group: [V + 'dang-gs3.jpg', { left: 0, top: 0, width: 1448, height: 860 }],
  arnold: [M + 'arnold-1974.jpg'],
  dexter: [M + 'dexter-2008-4.jpg'],
};
const SLOTS = {
  'chip-nguoi-tap': ['tuananh', [480]], 'chip-hlv': ['phuc_card', [480]],
  'stage-nguoi-tap': ['dang_card', [800, 1400]], 'stage-hlv': ['giang_overall', [800, 1400]],
  'eco-nguoi-tap': ['dexter', [800, 1400]], 'eco-hlv': ['arnold', [800, 1400]],
  'art-rpe': ['dang_npc', [800, 1400]], 'art-giam-tai': ['agp_group', [800, 1400]],
  'art-inbody': ['tuananh', [800, 1400]], 'art-chon-hlv': ['dang_podium', [800, 1400]],
  'cta': ['dang_global', [1000, 1920]], 'trainers-hero': ['phuc_card', [800, 1400]],
};
(async () => {
  for (const [slot, [src, widths]] of Object.entries(SLOTS)) {
    const [file, crop] = SRC[src];
    for (const w of widths) {
      let img = sharp(file); if (crop) img = img.extract(crop);
      const info = await img.resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(`public/media/${slot}-${w}.webp`);
      console.log(slot, w, '->', info.width + 'x' + info.height);
    }
  }
})();
