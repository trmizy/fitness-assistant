// Read-only SQL evidence. Uses exactly the same guarded target as the seed.
import fs from 'node:fs';
import { resolveTarget, assertSeedAllowed } from './lib/guard.mjs';
import { makePools, closePools } from './lib/tierA.mjs';
import { allTableCounts } from './lib/preflight.mjs';
const kind = process.argv[process.argv.indexOf('--target') + 1] || 'fresh';
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--target') || !process.argv.includes('--output')) throw new Error('Required: --target fresh|partner --output path.json');
const target = resolveTarget({kind});
assertSeedAllowed(target, {reseed:true});
const pools = makePools(target);
const queries = {
  ptApplications: ['user', 'SELECT status, count(*)::int n FROM pt_applications GROUP BY status ORDER BY status'],
  ptRevisions: ['user', 'SELECT status, count(*)::int n FROM pt_listing_revisions GROUP BY status ORDER BY status'],
  ptPhotoBuckets: ['user', `SELECT n AS photos, count(*)::int pts FROM (SELECT u.id, count(p.id)::int n FROM user_profiles u LEFT JOIN pt_physique_photos p ON p.pt_user_id=u."userId" AND p.status='PUBLISHED' WHERE u."isPT"=true GROUP BY u.id) q GROUP BY n ORDER BY n`],
  ptPackages: ['user', 'SELECT is_active, count(*)::int n FROM pt_service_packages GROUP BY is_active'],
  partners: ['gym', 'SELECT status, verification_status, count(*)::int n FROM gym_partners GROUP BY status, verification_status ORDER BY status, verification_status'],
  partnerAccess: ['gym', `SELECT CASE WHEN a.status <> 'ACTIVE' THEN 'RESTRICTED' WHEN p.status='ACTIVE' AND p.verification_status='VERIFIED' THEN CASE WHEN a.onboarding_completed_at IS NULL THEN 'APPROVED_PAYOUT_PENDING' ELSE 'ACTIVE' END WHEN p.status='SUSPENDED' THEN 'SUSPENDED' WHEN p.status='PROSPECT' THEN CASE p.verification_status WHEN 'NOT_VERIFIED' THEN 'ONBOARDING' WHEN 'IN_REVIEW' THEN 'UNDER_REVIEW' WHEN 'NEEDS_INFO' THEN 'CHANGES_REQUESTED' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'RESTRICTED' END ELSE 'RESTRICTED' END state, count(*)::int n FROM gym_partners p JOIN gym_partner_accounts a ON a.partner_id=p.id AND a.role='OWNER' GROUP BY state ORDER BY state`],
  branches: ['gym', 'SELECT status, operational_status, count(*)::int n FROM gyms GROUP BY status, operational_status ORDER BY status, operational_status'],
  gymRevisions: ['gym', 'SELECT status, count(*)::int n FROM gym_listing_revisions GROUP BY status ORDER BY status'],
  proposals: ['gym', 'SELECT status, kind, count(*)::int n FROM amenity_proposals GROUP BY status, kind ORDER BY status, kind'],
  plans: ['gym', 'SELECT status, count(*)::int n FROM gym_membership_plans GROUP BY status ORDER BY status'],
  memberships: ['gym', 'SELECT status, count(*)::int n FROM gym_membership_contracts GROUP BY status ORDER BY status'],
  contracts: ['user', 'SELECT status, count(*)::int n FROM contracts GROUP BY status ORDER BY status'],
  transactions: ['payment', 'SELECT status, count(*)::int n FROM payment_transactions GROUP BY status ORDER BY status'],
  reviews: ['gym', 'SELECT rating, count(*)::int n FROM gym_reviews GROUP BY rating ORDER BY rating'],
  users: ['auth', 'SELECT role, "isActive", count(*)::int n FROM users GROUP BY role, "isActive" ORDER BY role, "isActive"'],
};
try {
  const result = {at:new Date().toISOString(), databases:target.dbs, counts:await allTableCounts(pools), states:{}, queries};
  for (const [key, [service,sql]] of Object.entries(queries)) {
    try { result.states[key] = (await pools[service].query(sql)).rows; }
    catch(e) { result.states[key] = {error:e.message}; process.exitCode=1; }
  }
  fs.writeFileSync(output, JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.states,null,2));
} finally { await closePools(pools); }
