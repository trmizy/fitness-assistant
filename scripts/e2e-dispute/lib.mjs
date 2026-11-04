// Shared helpers of the isolated Dispute E2E environment scripts (project gymini-e2e-dispute ONLY). No dependencies beyond Node 20+.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT = "gymini-e2e-dispute";
export const C = {
  postgres: "gymini-e2e-dispute-postgres",
  auth: "gymini-e2e-dispute-auth",
  user: "gymini-e2e-dispute-user",
  gym: "gymini-e2e-dispute-gym",
  payment: "gymini-e2e-dispute-payment",
};
export const GATEWAY = process.env.E2E_GATEWAY_URL || "http://127.0.0.1:58100";
export const PAYMENT = process.env.E2E_PAYMENT_URL || "http://127.0.0.1:58107";
export const PASSWORD = "E2eDispute#2026";
export const STATE_DIR = join(HERE, ".state");
export const STATE_FILE = join(STATE_DIR, "seed.json");

// Fixed ids: the seed is idempotent and the accounts keep the same id across `seed` runs.
export const USERS = {
  admin1: { id: "e2e00000-0000-4000-8000-000000000001", email: "admin1.e2e-dispute@example.test", role: "ADMIN", firstName: "E2E_DISPUTE", lastName: "Admin 1" },
  admin2: { id: "e2e00000-0000-4000-8000-000000000002", email: "admin2.e2e-dispute@example.test", role: "ADMIN", firstName: "E2E_DISPUTE", lastName: "Admin 2" },
  client: { id: "e2e00000-0000-4000-8000-000000000003", email: "client.e2e-dispute@example.test", role: "CUSTOMER", firstName: "E2E_DISPUTE", lastName: "Client" },
  pt: { id: "e2e00000-0000-4000-8000-000000000004", email: "pt.e2e-dispute@example.test", role: "PT", firstName: "E2E_DISPUTE", lastName: "PT" },
  gymOwner: { id: "e2e00000-0000-4000-8000-000000000005", email: "gymowner.e2e-dispute@example.test", role: "GYM_OWNER", firstName: "E2E_DISPUTE", lastName: "Gym Owner" },
};

export function docker(args, input) {
  return execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
}
export const psql = (db, sql) => docker(["exec", "-i", C.postgres, "psql", "-U", "gymini_e2e", "-d", db, "-v", "ON_ERROR_STOP=1", "-At"], sql);

export function saveState(s) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
export const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});

export async function http(method, path, token, body, { base = GATEWAY, headers = {}, raw = false } = {}) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(base + path, {
    method,
    headers: { ...(isForm || body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = raw ? text : null;
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

export async function login(user) {
  const r = await http("POST", "/auth/login", null, { email: user.email, password: PASSWORD });
  const d = r.body?.data ?? r.body;
  const token = d?.accessToken ?? d?.tokens?.accessToken ?? d?.token;
  if (r.status !== 200 || !token) throw new Error(`login ${user.email}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return token;
}

export const data = (r) => r.body?.data ?? r.body;
export function must(r, expected, what) {
  const ok = Array.isArray(expected) ? expected : [expected];
  if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 400)}`);
  return data(r);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
