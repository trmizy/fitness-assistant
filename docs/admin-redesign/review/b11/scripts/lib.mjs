import { createRequire } from 'module';
const require = createRequire('D:/admin-fr/backend/services/payment-service/package.json');
const pg = require('pg');
export const GW = 'http://localhost:43000';
export const PAY = 'http://localhost:43007';
const PGB = { host: 'localhost', port: 55433, user: 'gymcoach_test', password: 'gymcoach_test_password' };
export function pool(short) {
  const database = `gymcoach_${short}_afr_test`;
  if (!/^gymcoach_(auth|user|payment|gym|ai)_afr_test$/.test(database)) throw new Error('bad db');
  return new pg.Pool({ ...PGB, database });
}
export async function call(method, path, { token, body, base = GW, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
export async function register(email, password, firstName, lastName) {
  let r = await call('POST', '/auth/register', { body: { email, password, firstName, lastName } });
  if (r.status >= 300) throw new Error('register ' + JSON.stringify(r));
  const otp = r.body.devOtp; if (!otp) throw new Error('no devOtp ' + JSON.stringify(r.body));
  r = await call('POST', '/auth/register/verify', { body: { email, otp } });
  if (r.status >= 300) throw new Error('verify ' + JSON.stringify(r));
  return r.body;
}
export async function login(email, password) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error('login ' + JSON.stringify(r));
  return { token: r.body.accessToken, id: r.body.user.id, role: r.body.user.role, email };
}
import fs from 'fs';
export const STATE_FILE = 'C:/Users/Windows/AppData/Local/Temp/claude/d--FitnessAssistant/8150a6b1-e4ea-4fe2-88a6-fd7d83b674f1/scratchpad/b11/state.json';
export const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE,'utf8')); } catch { return {}; } };
export const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
export async function payViaSim(redirectUrl, success = true) {
  const u = new URL(redirectUrl); const txnId = u.searchParams.get('txnId');
  const html = await (await fetch(PAY + '/payments/vnpay/sim?txnId=' + txnId)).text();
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const href = hrefs[success ? 0 : 1];
  const r = await fetch(PAY + href, { redirect: 'manual' });
  return { txnId, status: r.status, location: r.headers.get('location') };
}
export async function recon(token) {
  const r = await call('GET', '/admin/payments/reconciliation', { token });
  return { http: r.status, ...(r.body?.data ?? {}) };
}
export async function dbInv() {
  const p = pool('payment');
  const rows = (await p.query("select owner_type, owner_id, available_balance::text a, pending_balance::text p, locked_balance::text l, holdback_balance::text h from wallets")).rows;
  await p.end();
  let esc = 0n, claims = 0n;
  const toI = (s) => BigInt(Math.round(Number(s)));
  for (const w of rows) {
    const sum = toI(w.a) + toI(w.p) + toI(w.l) + toI(w.h);
    if (w.owner_type === 'PLATFORM' && w.owner_id === 'ESCROW') esc = toI(w.a); else claims += sum;
  }
  return { escrow: esc.toString(), claims: claims.toString(), drift: (esc - claims).toString(), wallets: rows.length };
}
export async function walletOf(ownerType, ownerId) {
  const p = pool('payment');
  const r = (await p.query("select id, available_balance::text a, pending_balance::text p, locked_balance::text l, holdback_balance::text h from wallets where owner_type=$1 and owner_id=$2", [ownerType, ownerId])).rows[0];
  await p.end(); return r;
}
export async function q(short, sql, params) { const p = pool(short); const r = await p.query(sql, params); await p.end(); return r.rows; }
export const RES_FILE = 'D:/admin-fr/docs/admin-redesign/review/b11/t2-results.json';
export function rec(id, ok, detail) {
  let arr = []; try { arr = JSON.parse(fs.readFileSync(RES_FILE, 'utf8')); } catch {}
  arr = arr.filter(x => x.id !== id); arr.push({ id, ok, detail, at: new Date().toISOString() });
  fs.writeFileSync(RES_FILE, JSON.stringify(arr, null, 1));
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400));
}
// invariant: API (P3) AND independent DB sum must agree: ESCROW.available == sum(claims), balanced, no negative wallets
export async function inv(adminToken, label) {
  const api = await recon(adminToken); const db = await dbInv();
  const ok = api.http === 200 && api.balanced === true && api.drift === '0.00' && db.drift === '0' && api.negativeWallets.length === 0;
  rec('INV:' + label, ok, { apiHttp: api.http, apiEscrow: api.escrow, apiClaims: api.claims, apiDrift: api.drift, dbEscrow: db.escrow, dbClaims: db.claims, dbDrift: db.drift });
  return ok;
}
