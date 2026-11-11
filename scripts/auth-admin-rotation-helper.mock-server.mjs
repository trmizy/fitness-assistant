// Local-only mock of the two endpoints auth-admin-rotation-helper.ps1 calls,
// so the helper can be proven correct WITHOUT ever pointing it at AWS DEV.
// Never used for anything but this one-time local test — not a fixture for
// any other test suite.
//
// Usage: node scripts/auth-admin-rotation-helper.mock-server.mjs [port]
// Then:  pwsh scripts/auth-admin-rotation-helper.ps1 -BaseUrl http://localhost:<port>

import http from "node:http";

const PORT = Number(process.argv[2] || 4570);

let CURRENT_PASSWORD = "password123"; // mutated in-memory by a successful rotation
const USER = { id: "mock-admin-id-123", role: "ADMIN" };

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "POST" && req.url === "/auth/login") {
    const body = await readBody(req);
    if (body.password !== CURRENT_PASSWORD) {
      return send(401, { error: "Invalid credentials" });
    }
    return send(200, {
      user: { id: USER.id, email: "admin@example.com", role: USER.role },
      accessToken: "mock-access-token-" + Date.now(),
      refreshToken: "mock-refresh-token-" + Date.now(),
    });
  }

  if (req.method === "PATCH" && req.url === "/auth/me/password") {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer mock-access-token-")) {
      return send(401, { error: "Invalid token" });
    }
    const body = await readBody(req);
    if (body.currentPassword !== CURRENT_PASSWORD) {
      return send(401, { error: "Current password is incorrect" });
    }
    if (body.newPassword === CURRENT_PASSWORD) {
      return send(400, { error: "New password must be different" });
    }
    CURRENT_PASSWORD = body.newPassword;
    return send(200, { user: { id: USER.id, email: "admin@example.com", role: USER.role } });
  }

  send(404, { error: "not found (mock server)" });
});

server.listen(PORT, () => {
  console.log(`Mock auth server listening on http://localhost:${PORT}`);
  console.log(`Initial password: password123 (in-memory only, resets on restart)`);
});
