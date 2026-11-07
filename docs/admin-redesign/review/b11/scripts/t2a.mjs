import fs from 'fs';
import { call, login } from './lib.mjs';
const EV = 'D:/admin-fr/docs/admin-redesign/review/b11/api';
const PW='Test@123456';
const admin = await login('afr.admin@example.test', PW), cust = await login('afr.c4@example.test', PW), owner = await login('afr.owner@example.test', PW);
const eps = [
 ['P1','GET','/admin/payments'],['P2','GET','/admin/payments/gateway-discrepancies'],['P3','GET','/admin/payments/reconciliation'],
 ['P4','GET','/admin/payments/finance-overview?groupBy=day'],['P4m','GET','/admin/payments/finance-overview?groupBy=month'],
 ['P4q','GET','/admin/payments/finance-overview?groupBy=quarter&from=2026-01-01T00:00:00.000Z&to=2026-12-31T23:59:59.000Z'],
 ['P5','GET','/admin/payments/commissions'],['P7','GET','/admin/payments/withdrawals'],['P13','GET','/admin/payments/obligations'],
 ['U1','GET','/admin/sessions/disputed'],['U2','GET','/admin/sessions/reconciliation'],['G2','GET','/admin/gym-memberships/pending-issues'],
 ['G4','GET','/admin/commission-rate'],['G5','GET','/admin/commission-rate/history'],['A1','GET','/marketplace/orders/refund-requests'],
 ['W1','GET','/admin/dashboard'],['SYS','GET','/admin/system-monitor'],['USERS','GET','/auth/users'],['GYMS','GET','/admin/gyms'],['BRANDS','GET','/admin/brands'],
 ['PTAPP','GET','/pt-applications/admin'],['PARTNERS','GET','/admin/partners'],['PARTNERS_OV','GET','/admin/partners/overview-stats'],['PTS','GET','/profile/pts'],
 ['COMPL','GET','/admin/complaints'],['LISTQ','GET','/admin/listings/gyms'],['LISTPT','GET','/admin/listings/pts'],
];
const rows = [];
for (const [id, m, path] of eps) {
  const a = await call(m, path, { token: admin.token });
  const n = await call(m, path, {});
  const c = await call(m, path, { token: cust.token });
  const o = await call(m, path, { token: owner.token });
  fs.writeFileSync(`${EV}/${id}.json`, JSON.stringify(a.body, null, 1).slice(0, 200000));
  const top = a.body && typeof a.body === 'object' ? Object.keys(a.body).slice(0,8).join(',') : typeof a.body;
  rows.push({ id, path, admin: a.status, noToken: n.status, customer: c.status, gymOwner: o.status, top });
  console.log(id.padEnd(12), String(a.status).padEnd(4), 'anon', n.status, 'cust', c.status, 'owner', o.status, '|', top);
}
fs.writeFileSync(`${EV}/_matrix.json`, JSON.stringify(rows, null, 1));
