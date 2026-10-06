// Shared helpers for the full conversational verification (Level C = REAL HTTP through the gateway with real JWTs).
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3000";
export const SECRET = "test_internal_service_secret_32_chars_minimum";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function http(method, url, { token, body, headers = {}, timeoutMs = 240000 } = {}) {
  const started = Date.now();
  const res = await fetch(url.startsWith("http") ? url : `${GATEWAY}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, ms: Date.now() - started };
}

export function psql(db, sql) {
  return execSync(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d ${db} -At -F "|" -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
}
export const q = (db, sql) => psql(`gymcoach_${db}_test`, sql);

// Harness fix (docs/conversational-intelligence-final-x4-runtime-closure.md): `/auth/register`'s `devOtp` field is
// only echoed when email delivery itself reports failure (`!emailResult.delivered`, see auth-service's
// email.service.ts) — an environment-dependent condition (SMTP configured and reachable vs. not), not a stable
// contract. The verification override deliberately blanks SMTP_* so this holds in THIS stack, but the harness must
// not hard-depend on that being true everywhere it runs. EmailVerification.otpHash is an unsalted
// sha256(sixDigitOtp) (generateOtp()/hashOtp() in auth.service.ts) over a ~900k-value space — brute-forcing it
// against the real DB column takes low-single-digit milliseconds in Node's crypto and touches no application code;
// it is a test-only fallback, never a bypass of the real /auth/register/verify call that follows.
function recoverOtpFromHash(email) {
  const hash = q("auth", `select "otpHash" from email_verifications where email='${email}'`);
  if (!hash) return null;
  for (let otp = 100000; otp <= 999999; otp++) {
    if (crypto.createHash("sha256").update(String(otp)).digest("hex") === hash) return String(otp);
  }
  return null;
}
/** Real registration: POST /auth/register -> OTP (devOtp if echoed, else recovered from the real DB hash) -> POST /auth/register/verify -> real JWT. */
export async function registerUser(email, fullName, password = "TestPass#12345") {
  let r = await http("POST", "/auth/register", { body: { email, password, fullName, role: "CLIENT" } });
  if (r.status === 409) { // already registered in a previous run: log in
    r = await http("POST", "/auth/login", { body: { email, password } });
    return { email, token: r.json.accessToken, userId: r.json.user?.id, refresh: r.json.refreshToken };
  }
  if (r.status >= 300) throw new Error(`register failed ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  const otp = r.json.devOtp ?? recoverOtpFromHash(email);
  if (!otp) throw new Error(`register ${r.status}: no devOtp in response and no email_verifications row recoverable for ${email}`);
  const v = await http("POST", "/auth/register/verify", { body: { email, otp } });
  if (v.status >= 300) throw new Error(`verify failed ${v.status} ${JSON.stringify(v.json).slice(0, 200)}`);
  return { email, token: v.json.accessToken, userId: v.json.user?.id, refresh: v.json.refreshToken };
}
export async function login(email, password = "TestPass#12345") {
  const r = await http("POST", "/auth/login", { body: { email, password } });
  return { email, token: r.json.accessToken, userId: r.json.user?.id };
}
export const putProfile = (u, profile) => http("PUT", "/profile/me", { token: u.token, body: profile });

/** One chat turn through the real product entry point (/ai/ask). */
export async function say(u, question, sessionId) {
  const r = await http("POST", "/ai/ask", { token: u.token, body: { question, ...(sessionId ? { sessionId } : {}) } });
  const d = r.json?.data ?? r.json;
  return { status: r.status, ms: r.ms, raw: r.json, data: d, sessionId: d?.sessionId ?? sessionId, answer: d?.answer ?? "", block: d?.block ?? d?.agentBlock ?? null };
}
export const confirmAction = (u, id) => http("POST", `/ai/agent/actions/${id}/confirm`, { token: u.token, body: { confirmed: true } });
export const dismissAction = (u, id) => http("POST", `/ai/agent/actions/${id}/dismiss`, { token: u.token, body: {} });

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}
