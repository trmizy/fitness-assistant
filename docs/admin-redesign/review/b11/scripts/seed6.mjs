import { call, login, loadState, saveState, dbInv, rec, inv } from './lib.mjs';
const PW = 'Test@123456'; const st = loadState();
const pt = await login('afr.pt@example.test', PW); const admin = await login('afr.admin@example.test', PW);
for (const c of ['c3', 'c4']) {
  const cl = await login(`afr.${c}@example.test`, PW); const oid = st.orders[c];
  let r = await call('POST', `/marketplace/orders/${oid}/intake`, { token: cl.token, body: { intakeData: { goal: 'afr' }, consentCategories: ['basic_info', 'training_goals'] } }); console.log(c, 'intake', r.status, r.body?.data?.status ?? JSON.stringify(r.body).slice(0, 200));
  r = await call('POST', `/marketplace/orders/${oid}/start-review`, { token: pt.token }); console.log(c, 'start-review', r.status, r.body?.data?.status ?? JSON.stringify(r.body).slice(0, 200));
  r = await call('POST', `/marketplace/orders/${oid}/refund-request`, { token: cl.token, body: { reason: 'AFR test: ke hoach khong phu hop' } }); console.log(c, 'refund-request', r.status, r.body?.data?.status ?? JSON.stringify(r.body).slice(0, 300));
}
let r = await call('GET', '/marketplace/orders/refund-requests', { token: admin.token }); console.log('A1', r.status, r.body?.data?.length);
r = await call('GET', `/marketplace/orders/${st.orders.c3}/refund-calculation`, { token: admin.token }); console.log('A2', r.status, JSON.stringify(r.body));
await inv(admin.token, '30-after-service-refund-requests');
