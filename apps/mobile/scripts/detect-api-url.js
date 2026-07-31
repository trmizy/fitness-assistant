// Node thuần (không cài thêm gói) — tự phát hiện IP LAN của máy dev để
// build EXPO_PUBLIC_API_URL fallback khi biến này chưa set trong .env.
// Dùng bởi app.config.ts (require trực tiếp) và có thể chạy độc lập:
//   node scripts/detect-api-url.js
"use strict";

const os = require("os");

// Heuristic loại bỏ các adapter ảo hay gặp trên máy Windows dev (VMware
// NAT, VirtualBox host-only, WSL2 vEthernet, loopback) — những dải IP
// này tồn tại song song với WiFi/Ethernet thật và os.networkInterfaces()
// không phân biệt được "đâu là mạng thật" nếu chỉ lọc theo IP.
const IGNORE_NAME_RE = /vmware|virtualbox|wsl|vethernet|loopback|hyper-v/i;

function listCandidateIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || IGNORE_NAME_RE.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        candidates.push({ name, address: addr.address });
      }
    }
  }

  return candidates;
}

// Không có cách 100% chắc chắn biết "đâu là gateway WiFi thật" chỉ từ
// os.networkInterfaces() (Node không expose default-gateway trực tiếp,
// đọc route table cần lệnh OS-specific) — ưu tiên theo thứ tự heuristic
// hay đúng nhất cho máy dev thông thường:
//   1. Dải 192.168.x.x (WiFi gia đình/văn phòng phổ biến nhất)
//   2. Dải 10.x.x.x (mạng công ty/router một số hãng)
//   3. Bất kỳ IPv4 non-internal nào còn lại
function pickBestCandidate(candidates) {
  const by192 = candidates.find((c) => c.address.startsWith("192.168."));
  if (by192) return by192;
  const by10 = candidates.find((c) => c.address.startsWith("10."));
  if (by10) return by10;
  return candidates[0] ?? null;
}

function detectLanIp() {
  const candidates = listCandidateIPv4();
  const best = pickBestCandidate(candidates);
  return best ? best.address : null;
}

module.exports = { detectLanIp, listCandidateIPv4 };

if (require.main === module) {
  const ip = detectLanIp();
  if (ip) {
    console.log(ip);
  } else {
    console.error("Không tìm thấy IP LAN nào (đã loại VMware/WSL/loopback). Kiểm tra kết nối WiFi/Ethernet.");
    process.exit(1);
  }
}
