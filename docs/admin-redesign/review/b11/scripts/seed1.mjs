import fs from 'fs';
import { call, register, login, pool, GW } from './lib.mjs';
const PW = 'Test@123456';
const out = {};
const users = [['afr.admin@example.test','Admin','Afr'],['afr.owner@example.test','Owner','Afr'],['afr.c1@example.test','Client','Mot'],['afr.c2@example.test','Client','Hai'],['afr.c3@example.test','Client','Ba'],['afr.c4@example.test','Client','Bon']];
for (const [e,f,l] of users) { const r = await register(e, PW, f, l); console.log('registered', e, r.user?.id, r.user?.role); }
const auth = pool('auth');
await auth.query("update users set role='ADMIN' where email='afr.admin@example.test'");
await auth.query("update users set role='GYM_OWNER' where email='afr.owner@example.test'");
console.log((await auth.query("select email, role from users order by email")).rows);
await auth.end();
