#!/usr/bin/env node
// Mid-flow trigger for h-client-package-changed.yaml (REAL HTTP/API through the gateway).
//
// The flow must change a PT package's price WHILE the client app is already looking at it. Maestro cannot run node, but its
// runScript can call http, so this script runs as a tiny localhost-only HTTP server next to the flow:
//
//   node h-package-trigger.mjs serve     start it BEFORE the flow, keep it running; Ctrl+C restores the price if the run left it changed
//   node h-package-trigger.mjs restore   put the original price back (works without the server, from .state/h-package.json)
//   node h-package-trigger.mjs status    print the saved state
//
//   GET  /state    -> the package the flow will select + ASCII/regex forms of its old and new price (no change made)
//   POST /change   -> price +DELTA through a REAL revision: PT draft -> submit -> admin approve (the published package version bumps)
//   POST /restore  -> the original price through another approved revision
//
// Env: SEED_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD (required); GATEWAY_URL, PT_SLUG (default ly-thanh-dat = P11), PKG_INDEX (default 0 =
//      first active package), DELTA (default 100000 VND), PORT (default 8765). Listens on 127.0.0.1 only.
// A PT with an open DRAFT/PENDING revision, or with no active ONLINE/OFFLINE package at PKG_INDEX, aborts before anything is changed.
import http from "node:http";
import { FLOW2, call, dropState, loadState, loginAdmin, loginSeed, log, run, saveState, unwrap } from "./lib.mjs";

const PT_SLUG = process.env.PT_SLUG || "ly-thanh-dat";
const PORT = Number(process.env.PORT || 8765);
const DELTA = Number(process.env.DELTA || 100000);
const STATE = "h-package";

const dotted = (n) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, ".");
// A package as the draft schema wants it: only its own editable fields (the published row also carries version etc.).
const editable = (p, price) => ({
  id: p.id,
  name: p.name,
  description: p.description ?? null,
  price,
  sessionCount: p.sessionCount,
  sessionMode: p.sessionMode,
  sessionDurationMinutes: p.sessionDurationMinutes,
  validityDays: p.validityDays ?? null,
  isActive: p.isActive,
});

async function listing(pt) {
  return unwrap(await call("GET", "/profile/me/listing", { token: pt, expect: [200] }));
}

/** PT draft -> submit -> admin approve, changing ONE package's price. Returns the new published price. */
async function publishPrice(pkgId, price) {
  const pt = await loginSeed(PT_SLUG);
  const admin = await loginAdmin();
  const before = await listing(pt);
  if (before.openRevision) throw new Error(`PT ${PT_SLUG} has an open revision (${before.openRevision.status}); resolve it first`);
  const published = before.published.payload;
  const target = published.packages.find((p) => p.id === pkgId);
  if (!target) throw new Error("package no longer in the published listing");
  if (Number(target.price) === price) return price; // already there

  await call("POST", "/profile/me/listing/draft", { token: pt, body: {}, headers: FLOW2, expect: [200, 201] });
  const draft = (await listing(pt)).openRevision;
  if (!draft) throw new Error("draft was not created");
  const payload = {
    profile: published.profile,
    packages: published.packages.map((p) => editable(p, p.id === pkgId ? price : Number(p.price))),
    photoIds: published.photoIds,
    coverPhotoId: published.coverPhotoId,
  };
  await call("PUT", "/profile/me/listing/draft", { token: pt, body: { expectedDraftVersion: draft.draftVersion, payload }, headers: FLOW2, expect: [200] });
  const saved = (await listing(pt)).openRevision;
  await call("POST", "/profile/me/listing/submit", { token: pt, body: { expectedDraftVersion: saved.draftVersion }, headers: FLOW2, expect: [200] });
  const pending = (await listing(pt)).openRevision;
  if (pending?.status !== "PENDING") throw new Error(`revision is ${pending?.status}, expected PENDING`);
  await call("POST", `/admin/listings/pts/revisions/${pending.id}/approve`, { token: admin, body: { note: "E2E Maestro: doi gia goi de kiem PACKAGE_CHANGED" }, expect: [200] });
  const after = await listing(pt);
  const now = after.published.payload.packages.find((p) => p.id === pkgId);
  if (after.openRevision || Number(now?.price) !== price) throw new Error(`published price is ${now?.price}, expected ${price}`);
  return price;
}

async function preflight() {
  const pt = await loginSeed(PT_SLUG);
  const l = await listing(pt);
  if (l.openRevision) throw new Error(`PT ${PT_SLUG} has an open revision (${l.openRevision.status}); resolve it first`);
  const active = (l.published?.payload?.packages ?? []).filter((p) => p.isActive);
  const pkg = active[Number(process.env.PKG_INDEX || 0)];
  if (!pkg) throw new Error(`PT ${PT_SLUG} has ${active.length} active package(s); PKG_INDEX is out of range`);
  const saved = loadState(STATE);
  // keep the ORIGINAL price across restarts of this script: a changed-but-unrestored run must still restore to it
  const originalPrice = saved && saved.pkgId === pkg.id && saved.phase === "changed" ? saved.originalPrice : Number(pkg.price);
  const newPrice = originalPrice + DELTA > 1_000_000_000 ? originalPrice - DELTA : originalPrice + DELTA;
  const st = {
    ptSlug: PT_SLUG,
    pkgId: pkg.id,
    pkgName: pkg.name,
    sessionMode: pkg.sessionMode,
    originalPrice,
    newPrice,
    currentPrice: Number(pkg.price),
    phase: saved && saved.pkgId === pkg.id ? saved.phase : "ready",
    at: new Date().toISOString(),
  };
  saveState(STATE, st);
  return st;
}

const view = (st) => ({
  ptSlug: st.ptSlug,
  pkgName: st.pkgName,
  pkgRegex: escapeRe(st.pkgName),
  sessionMode: st.sessionMode,
  oldPrice: st.originalPrice,
  newPrice: st.newPrice,
  oldPriceRegex: `.*${escapeRe(dotted(st.originalPrice))}.*`,
  newPriceRegex: `.*${escapeRe(dotted(st.newPrice))}.*`,
  phase: st.phase,
});

async function change() {
  const st = loadState(STATE) ?? (await preflight());
  if (st.phase === "changed") return st;
  await publishPrice(st.pkgId, st.newPrice);
  const next = { ...st, currentPrice: st.newPrice, phase: "changed", changedAt: new Date().toISOString() };
  saveState(STATE, next);
  log(`price changed ${st.originalPrice} -> ${st.newPrice} (revision approved)`);
  return next;
}

async function restore() {
  const st = loadState(STATE);
  if (!st) throw new Error("no helpers/.state/h-package.json - nothing to restore");
  await publishPrice(st.pkgId, st.originalPrice);
  dropState(STATE);
  log(`price restored to ${st.originalPrice}; PT ${st.ptSlug} has no open revision`);
  return { ...st, phase: "restored" };
}

const mode = process.argv[2];
if (mode === "restore") {
  run(async () => void (await restore()));
} else if (mode === "status") {
  console.log(JSON.stringify(loadState(STATE) ?? { phase: "none" }, null, 2));
} else if (mode === "serve") {
  run(async () => {
    const st = await preflight();
    if (st.sessionMode === "OFFLINE") log("WARNING: the package is OFFLINE; the app then also wants a gym picked before it lets the client press buy");
    const server = http.createServer(async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      try {
        if (req.method === "GET" && req.url === "/state") return send(200, view(loadState(STATE) ?? (await preflight())));
        if (req.method === "POST" && req.url === "/change") return send(200, { changed: true, ...view(await change()) });
        if (req.method === "POST" && req.url === "/restore") return send(200, { restored: true, ...view(await restore()) });
        send(404, { error: "unknown route" });
      } catch (e) {
        log("request failed:", e?.message ?? e);
        send(500, { error: String(e?.message ?? e) });
      }
    });
    server.listen(PORT, "127.0.0.1", () => log(`READY on 127.0.0.1:${PORT} - package "${st.pkgName}" of ${PT_SLUG}, ${st.originalPrice} -> ${st.newPrice} on /change`));
    const stop = async () => {
      server.close();
      const cur = loadState(STATE);
      if (cur?.phase === "changed" && process.env.AUTO_RESTORE !== "0") {
        try {
          await restore();
        } catch (e) {
          console.error("[maestro-helper] auto-restore FAILED - run `node h-package-trigger.mjs restore`:", e?.message ?? e);
          process.exit(1);
        }
      }
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
} else {
  console.error("usage: node h-package-trigger.mjs serve | restore | status");
  process.exit(2);
}
