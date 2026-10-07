import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
process.env.INTERNAL_SERVICE_SECRET = "gateway-secret";
// Nothing listens here: the polling request below must fail upstream, not hang.
process.env.CHAT_SERVICE_URL = "http://127.0.0.1:3997";

/**
 * Regression (6/10, real phone + web): one plain HTTP request to "/chat-socket.io" made
 * http-proxy-middleware subscribe itself to the raw server's "upgrade" event, and with no path
 * context that listener claimed every upgrade — the gateway's own "/socket.io" included — until
 * the gateway restarted. The chat proxy must never add an upgrade listener of its own; only
 * server.ts's explicit, path-checked forwarder may handle chat upgrades.
 */
test("an HTTP request through the chat socket proxy leaves the server's upgrade listeners alone", async () => {
  const { default: app } = await import("../app");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const before = server.listenerCount("upgrade");
    const res = await fetch(`http://127.0.0.1:${port}/chat-socket.io/?EIO=4&transport=polling`);
    await res.arrayBuffer();
    assert.equal(server.listenerCount("upgrade"), before);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
