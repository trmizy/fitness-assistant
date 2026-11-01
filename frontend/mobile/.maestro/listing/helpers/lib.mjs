// Shared bits of the Maestro helper scripts (Phase M follow-up). REAL HTTP/API through the gateway only: no SQL, no direct service ports.
//
// Environment (nothing secret is ever hard-coded, printed or written to the state files):
//   GATEWAY_URL     default http://localhost:3000 (the host's own gateway; the phone talks to it through the tunnel)
//   SEED_PASSWORD   password of the <slug>@seed.gymini.test accounts (scripts/seed-marketplace/SEED.md, "Accounts")
//   ADMIN_EMAIL / ADMIN_PASSWORD   an ADMIN account of the target stack (the kept admin; not a seed account on the main DB)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GATEWAY_URL = (process.env.GATEWAY_URL || "http://localhost:3000").replace(/\/$/, "");
const here = path.dirname(fileURLToPath(import.meta.url));
export const STATE_DIR = path.join(here, ".state");

export function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing environment variable ${name}. See ../README.md (section "Helpers").`);
    process.exit(2);
  }
  return v;
}

/** The two headers the new listing flow expects on draft / submit / withdraw / discard (same as the seed's Tier B). */
export const FLOW2 = { "X-Gymini-Listing-Flow": "2", "X-Gymini-Client": "maestro-helper/1" };

export const unwrap = (r) => (r?.json && typeof r.json === "object" && !Array.isArray(r.json) && "data" in r.json ? r.json.data : r?.json);

export class ApiError extends Error {
  constructor(msg, res) {
    super(msg);
    this.status = res?.status;
    this.json = res?.json;
  }
}

export async function call(method, p, { token, body, headers = {}, expect } = {}) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
  let payload;
  if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(GATEWAY_URL + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  const out = { status: res.status, json };
  if (expect && !expect.includes(res.status)) {
    const code = json?.error?.code ?? json?.code ?? "";
    throw new ApiError(`${method} ${p} -> ${res.status} ${code}`.trim(), out);
  }
  return out;
}

export async function login(email, password) {
  const r = await call("POST", "/auth/login", { body: { email, password }, expect: [200] });
  const t = r.json?.accessToken ?? r.json?.data?.accessToken;
  if (!t) throw new ApiError(`login for ${email} returned no accessToken`, r);
  return t;
}

export const loginSeed = (slug) => login(`${slug}@seed.gymini.test`, need("SEED_PASSWORD"));
export const loginAdmin = () => login(need("ADMIN_EMAIL"), need("ADMIN_PASSWORD"));

/** Lower-case, accent-free, single-spaced: lets an ASCII env value match a Vietnamese name. */
export const fold = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function saveState(name, data) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}
export function loadState(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}
export function dropState(name) {
  try {
    fs.unlinkSync(path.join(STATE_DIR, `${name}.json`));
  } catch {
    /* already gone */
  }
}

export const log = (...a) => console.log("[maestro-helper]", ...a);

/** Run main(); a failure prints the status/code (never a body that could carry a token) and exits 1. */
export function run(main) {
  main().catch((e) => {
    console.error("[maestro-helper] FAILED:", e?.message ?? e);
    if (e?.json?.error?.message) console.error("  server:", e.json.error.message);
    process.exitCode = 1;
  });
}
