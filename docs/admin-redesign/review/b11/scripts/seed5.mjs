import { call, login, register, pool, payViaSim, loadState, saveState, rec, inv, dbInv } from './lib.mjs';
const PW = 'Test@123456'; const st = loadState();
let pt;
try { pt = await login('afr.pt@example.test', PW); } catch {
  await register('afr.pt@example.test', PW, 'Trainer', 'Afr');
  const a = pool('auth'); await a.query("update users set role='PT' where email='afr.pt@example.test'"); await a.end();
  pt = await login('afr.pt@example.test', PW);
}
console.log('pt', pt.id, pt.role);
const admin = await login('afr.admin@example.test', PW);
let r = await call('POST', '/marketplace/services', { token: pt.token, body: { serviceType: 'ONLINE_COACHING', title: 'AFR Online Coaching', description: 'afr stack', price: 600000, deliverables: ['Training plan'], initialDeliveryDays: 3, supportWeeks: 4 } });
console.log('create service', r.status, JSON.stringify(r.body).slice(0, 400));
const svc = r.body?.data?.id;
st.ptId = pt.id; st.serviceId = svc; st.orders = st.orders || {};
for (const c of ['c3', 'c4']) {
  const cl = await login(`afr.${c}@example.test`, PW);
  r = await call('POST', `/marketplace/services/${svc}/purchase`, { token: cl.token, body: { provider: 'VNPAY' } });
  console.log(c, 'purchase', r.status, JSON.stringify(r.body).slice(0, 400));
  const order = r.body?.data?.order ?? r.body?.data; const red = r.body?.data?.payment?.redirectUrl ?? r.body?.data?.redirectUrl;
  if (red) { const p = await payViaSim(red, true); console.log(c, 'paid', p.status); }
  st.orders[c] = order?.id;
  r = await call('GET', `/marketplace/orders/${order?.id}`, { token: cl.token }); console.log(c, 'order status', r.body?.data?.status);
}
saveState(st);
console.log(await dbInv());
