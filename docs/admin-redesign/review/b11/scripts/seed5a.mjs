import { call, login, q } from './lib.mjs';
const pt = await login('afr.pt@example.test', 'Test@123456');
let r = await call('GET', '/profile/me', { token: pt.token }); console.log('profile/me', r.status);
console.log(await q('user', 'select id, "userId", "isPT" from user_profiles'));
console.log(await q('user', "select column_name from information_schema.columns where table_name='pt_applications' order by ordinal_position"));
