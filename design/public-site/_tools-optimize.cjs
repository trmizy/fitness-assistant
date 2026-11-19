const sharp = require('D:/FitnessAssistant/backend/services/user-service/node_modules/sharp');
const fs = require('fs');
const MAP = {
  'chip-nguoi-tap': ['35201872', [480]], 'chip-hlv': ['37963580', [480]], 'chip-phong': ['17211446', [480]],
  'stage-nguoi-tap': ['27898326', [800, 1400]], 'stage-hlv': ['4853289', [800, 1400]], 'stage-phong': ['19025671', [800, 1400]],
  'eco-nguoi-tap': ['35201872', [800, 1400]], 'eco-hlv': ['37963578', [800, 1400]], 'eco-phong': ['17227606', [800, 1400]],
  'art-rpe': ['7444369', [800, 1400]], 'art-giam-tai': ['31849590', [800, 1400]], 'art-inbody': ['36387538', [800, 1400]], 'art-chon-hlv': ['4853671', [800, 1400]],
  'cta': ['9545907', [1000, 1920]], 'trainers-hero': ['35986381', [800, 1400]], 'gyms-hero': ['8933584', [1000, 1920]],
};
(async () => {
  for (const [name, [id, widths]] of Object.entries(MAP)) {
    for (const w of widths) {
      const out = `public/media/${name}-${w}.webp`;
      const info = await sharp(`_media-raw/p${id}.jpg`).resize({ width: w, withoutEnlargement: true }).webp({ quality: 74 }).toFile(out);
      console.log(out, info.width + 'x' + info.height, Math.round(info.size / 1024) + 'KB');
    }
  }
})();
