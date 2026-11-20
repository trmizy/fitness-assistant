import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { renderReport } from "./report.mjs";

const port = Number(process.argv[2] ?? 4187);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Chọn port từ 1024 đến 65535.");

const reportFile = new URL("../AI_V1_AUDIT_KHOA_LUAN.md", import.meta.url);
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/viewer.css", ["viewer.css", "text/css; charset=utf-8"]],
  ["/viewer.mjs", ["viewer.mjs", "text/javascript; charset=utf-8"]],
  ["/flows.mjs", ["flows.mjs", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
]);

async function handle(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  const path = new URL(request.url, "http://localhost").pathname;
  let content;
  let type;
  if (path === "/bao-cao") {
    const [markdown, template] = await Promise.all([
      readFile(reportFile, "utf8"),
      readFile(new URL("report.html", import.meta.url), "utf8"),
    ]);
    const rendered = renderReport(markdown);
    content = template.replace("<!-- report-contents -->", () => rendered.contents)
      .replace("<!-- report-body -->", () => rendered.body);
    type = "text/html; charset=utf-8";
  } else if (path === "/AI_V1_AUDIT_KHOA_LUAN.md") {
    content = await readFile(reportFile);
    type = "text/markdown; charset=utf-8";
  } else if (assets.has(path)) {
    const [file, mimeType] = assets.get(path);
    content = await readFile(new URL(file, import.meta.url));
    type = mimeType;
  } else {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Trang không tồn tại.");
    return;
  }

  response.writeHead(200, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(content),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
  }).end(request.method === "HEAD" ? undefined : content);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error.message);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Không đọc được báo cáo.");
  });
});
server.listen(port, "127.0.0.1", () => console.log("Gymini AI V1 · http://localhost:" + port + "/"));
