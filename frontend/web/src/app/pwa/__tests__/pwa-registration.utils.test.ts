/**
 * Run with:
 * npx tsx --test src/app/pwa/__tests__/pwa-registration.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAppNavigationRequest,
  isSecurePwaContext,
  shouldBypassServiceWorkerCache,
  shouldRegisterPwa,
} from "../pwa-registration.utils";

describe("isSecurePwaContext", () => {
  it("allows HTTPS and localhost", () => {
    assert.equal(
      isSecurePwaContext({ location: { protocol: "https:", hostname: "app.test" } }),
      true,
    );
    assert.equal(
      isSecurePwaContext({ location: { protocol: "http:", hostname: "localhost" } }),
      true,
    );
  });

  it("rejects plain remote HTTP", () => {
    assert.equal(
      isSecurePwaContext({ location: { protocol: "http:", hostname: "example.com" } }),
      false,
    );
  });
});

describe("shouldRegisterPwa", () => {
  it("requires production mode, service worker support, and a secure context", () => {
    assert.equal(
      shouldRegisterPwa(
        { serviceWorker: {} },
        { location: { protocol: "https:", hostname: "app.test" } },
        false,
      ),
      true,
    );
    assert.equal(
      shouldRegisterPwa(
        { serviceWorker: {} },
        { location: { protocol: "https:", hostname: "app.test" } },
        true,
      ),
      false,
    );
    assert.equal(
      shouldRegisterPwa(
        {},
        { location: { protocol: "https:", hostname: "app.test" } },
        false,
      ),
      false,
    );
  });
});

describe("service worker cache boundaries", () => {
  it("treats browser navigations and HTML accepts as app navigations", () => {
    assert.equal(
      isAppNavigationRequest(
        new Request("https://app.test/client/workout", { headers: { accept: "text/html" } }),
      ),
      true,
    );
  });

  it("bypasses API, socket, and non-GET requests", () => {
    assert.equal(shouldBypassServiceWorkerCache(new Request("https://app.test/api/me")), true);
    assert.equal(
      shouldBypassServiceWorkerCache(new Request("https://app.test/socket.io/?EIO=4")),
      true,
    );
    assert.equal(
      shouldBypassServiceWorkerCache(
        new Request("https://app.test/client/workout", { method: "POST" }),
      ),
      true,
    );
    assert.equal(
      shouldBypassServiceWorkerCache(new Request("https://app.test/assets/app.js")),
      false,
    );
  });
});

