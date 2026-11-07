import { q, login } from './lib.mjs';
const pt = await login('afr.pt@example.test', 'Test@123456');
const prof = (await q('user', `insert into user_profiles (id, "userId", "updatedAt", "isPT", "firstName", "lastName") values (gen_random_uuid()::text, $1, now(), true, 'Trainer', 'Afr') returning id`, [pt.id]))[0].id;
await q('user', `insert into pt_applications (id, user_profile_id, status, approved_at, submitted_at, reviewed_at, updated_at, professional_bio, years_of_experience) values (gen_random_uuid()::text, $1, 'APPROVED', now(), now(), now(), now(), 'afr fixture trainer', 5)`, [prof]);
console.log('ok', prof);
