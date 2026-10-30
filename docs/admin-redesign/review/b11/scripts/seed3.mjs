import { call, login, payViaSim, recon, loadState, saveState } from './lib.mjs';
const PW='Test@123456';
const st = { gymId:'bd9948ee-077a-4071-9c82-f24f1db29be2', planId:'e6abacb2-fc31-4a42-8347-2b3a1fdec3c1', memberships:{} };
const admin = await login('afr.admin@example.test', PW);
for (const c of ['c1','c2','c3','c4']) {
  const cl = await login(`afr.${c}@example.test`, PW);
  let r = await call('POST', `/gyms/${st.gymId}/memberships`, { token: cl.token, body: { planId: st.planId, provider: 'VNPAY' } });
  if (r.status !== 201) { console.log(c, 'purchase', r.status, JSON.stringify(r.body).slice(0,300)); continue; }
  const mid = r.body.data.membership.id; const red = r.body.data.payment.redirectUrl;
  const p = await payViaSim(red, true);
  r = await call('GET', `/me/gym-memberships/${mid}`, { token: cl.token });
  console.log(c, 'membership', mid, 'status', r.body?.data?.status, 'txn', p.txnId, p.status);
  st.memberships[c] = { id: mid, txn: p.txnId, userId: cl.id };
}
const rc = await recon(admin.token); console.log('recon', JSON.stringify(rc));
saveState(st);
