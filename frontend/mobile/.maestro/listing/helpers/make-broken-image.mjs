#!/usr/bin/env node
// Writes a deliberately broken "image" to the path given as argv[2] (used by push-broken-image.sh; pure Node, no dependencies).
//   --kind header-only   (default) a JPEG start-of-image + JFIF header and nothing else, the shape the server's own tests call "header-only JPEG"
//   --kind truncated-png a valid generated PNG cut in half (magic bytes fine, the pixel stream is cut)
//   --kind text          plain text under an image name
// The server (user-service normalizeImage, sharp failOn "error") refuses all three with 422 IMAGE_INVALID.
import fs from "node:fs";
import zlib from "node:zlib";

const out = process.argv[2];
const kindIdx = process.argv.indexOf("--kind");
const kind = kindIdx > -1 ? process.argv[kindIdx + 1] : "header-only";
if (!out) {
  console.error("usage: make-broken-image.mjs <outfile> [--kind header-only|truncated-png|text]");
  process.exit(2);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (x * 7 + y) & 255;
      raw[row + 2 + x * 3] = (y * 5) & 255;
      raw[row + 3 + x * 3] = (x + y * 3) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let bytes;
if (kind === "header-only") {
  bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), Buffer.alloc(4096, 0x20)]);
} else if (kind === "truncated-png") {
  const full = png(600, 600);
  bytes = full.subarray(0, Math.floor(full.length / 2));
} else if (kind === "text") {
  bytes = Buffer.from("this is just a text file, not a picture\n".repeat(80));
} else {
  console.error(`unknown --kind ${kind}`);
  process.exit(2);
}
fs.writeFileSync(out, bytes);
console.log(`wrote ${bytes.length} bytes (${kind}) to ${out}`);
