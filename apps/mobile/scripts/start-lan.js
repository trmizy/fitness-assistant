"use strict";

const { spawn } = require("child_process");
const { detectLanIp } = require("./detect-api-url");

const ip = detectLanIp();

if (ip) {
  console.log("");
  console.log(`  Đảm bảo iPhone/thiết bị cùng WiFi với máy dev — IP LAN: ${ip}`);
  console.log(`  Nếu EXPO_PUBLIC_API_URL để trống trong .env, app sẽ tự dùng http://${ip}:3000`);
  console.log("");
} else {
  console.warn("  Không phát hiện được IP LAN — kiểm tra kết nối WiFi/Ethernet trước khi quét QR.");
}

const expo = spawn("npx", ["expo", "start"], { stdio: "inherit", shell: true });
expo.on("exit", (code) => process.exit(code ?? 0));
