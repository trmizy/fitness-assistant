// Cross-database integrity checks for the marketplace seed (plan 8.2 "verify-integrity"). READ-ONLY.
// Each check returns { examined, violations: [...] }. examined === 0 means "nothing to look at yet" (reported as N/A, never
// as a silent pass), e.g. the gym/payment checks before Tier B has run.
import { seedAdmin } from "./tierA.mjs";
const SEED = `'%@seed.gymini.test'`;

async function rows(pool, sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

export async function seedUserIndex(pools) {
  const auth = await rows(pools.auth, `SELECT id, email, role::text AS role, "isActive" AS active FROM users WHERE email LIKE ${SEED}`);
  const prof = await rows(pools.user, `SELECT "userId" AS uid, "isPT" AS is_pt, pt_suspended AS suspended, email FROM user_profiles WHERE email LIKE ${SEED}`);
  return { auth, prof, authById: new Map(auth.map((a) => [a.id, a])), profById: new Map(prof.map((p) => [p.uid, p])) };
}

export const CHECKS = [
  {
    name: "auth role <-> user_profiles.is_pt",
    async run({ pools }) {
      const { auth, prof, authById, profById } = await seedUserIndex(pools);
      const v = [];
      for (const p of prof) {
        const a = authById.get(p.uid);
        if (!a) v.push({ userId: p.uid, why: "profile without auth user" });
        else if ((a.role === "PT") !== p.is_pt) v.push({ userId: p.uid, role: a.role, isPT: p.is_pt, why: "role PT <-> is_pt mismatch" });
      }
      for (const a of auth) if (a.role !== "GYM_OWNER" && a.role !== "ADMIN" && !profById.has(a.id)) v.push({ userId: a.id, why: "CUSTOMER/PT auth user without profile" });
      for (const a of auth) if (a.role === "ADMIN" && (a.id !== seedAdmin.id || a.email !== seedAdmin.email)) v.push({ userId: a.id, why: "unexpected seed admin" });
      return { examined: prof.length, violations: v };
    },
  },
  {
    name: "partner account <-> auth role GYM_OWNER",
    async run({ pools }) {
      const { auth, authById } = await seedUserIndex(pools);
      const accs = await rows(pools.gym, `SELECT a.user_id, a.role::text AS role FROM gym_partner_accounts a JOIN gym_partners p ON p.id = a.partner_id WHERE a.role = 'OWNER'`);
      const v = [];
      const owners = accs.filter((a) => authById.has(a.user_id));
      for (const a of owners) if (authById.get(a.user_id).role !== "GYM_OWNER") v.push({ userId: a.user_id, role: authById.get(a.user_id).role, why: "partner OWNER account whose auth role is not GYM_OWNER" });
      const accIds = new Set(accs.map((a) => a.user_id));
      for (const a of auth) if (a.role === "GYM_OWNER" && !accIds.has(a.id)) v.push({ userId: a.id, why: "GYM_OWNER auth user without partner account" });
      return { examined: owners.length + auth.filter((a) => a.role === "GYM_OWNER").length, violations: v };
    },
  },
  {
    name: "one Brand per Gym Owner (and per partner)",
    async run({ pools }) {
      const dup = await rows(pools.gym, `SELECT owner_id, count(*)::int n FROM gym_brands GROUP BY owner_id HAVING count(*) > 1`);
      const dupPartner = await rows(pools.gym, `SELECT brand_id, count(*)::int n FROM gym_partners WHERE brand_id IS NOT NULL GROUP BY brand_id HAVING count(*) > 1`);
      const wrongOwner = await rows(
        pools.gym,
        `SELECT p.id AS partner_id, b.owner_id AS brand_owner, a.user_id AS account_owner FROM gym_partners p
           JOIN gym_brands b ON b.id = p.brand_id JOIN gym_partner_accounts a ON a.partner_id = p.id AND a.role = 'OWNER'
          WHERE b.owner_id <> a.user_id`,
      );
      const crossBrand = await rows(pools.gym, `SELECT g.id, g.owner_id, b.owner_id AS brand_owner FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.owner_id <> b.owner_id`);
      const n = (await rows(pools.gym, `SELECT count(*)::int n FROM gym_brands`))[0].n;
      return {
        examined: n,
        violations: [
          ...dup.map((r) => ({ ...r, why: "owner has >1 brand" })),
          ...dupPartner.map((r) => ({ ...r, why: "brand attached to >1 partner" })),
          ...wrongOwner.map((r) => ({ ...r, why: "brand owner differs from partner OWNER account" })),
          ...crossBrand.map((r) => ({ ...r, why: "branch owner differs from its brand's owner" })),
        ],
      };
    },
  },
  {
    name: "gym_amenities (SYSTEM, ACTIVE) <-> gyms.facilities mirror",
    async run({ pools }) {
      const bad = await rows(
        pools.gym,
        `WITH want AS (
           SELECT g.id AS gym_id, coalesce(array_agg(a.slug ORDER BY a.slug) FILTER (WHERE a.source = 'SYSTEM' AND a.status = 'ACTIVE'), '{}') AS slugs
             FROM gyms g LEFT JOIN gym_amenities ga ON ga.gym_id = g.id LEFT JOIN amenities a ON a.id = ga.amenity_id GROUP BY g.id)
         SELECT g.id, g.facilities::text[] AS facilities, w.slugs FROM gyms g JOIN want w ON w.gym_id = g.id
          WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(g.facilities::text[]) x) <> w.slugs`,
      );
      const n = (await rows(pools.gym, `SELECT count(*)::int n FROM gyms`))[0].n;
      return { examined: n, violations: bad.map((r) => ({ gymId: r.id, facilities: r.facilities, amenities: r.slugs, why: "facilities mirror differs from gym_amenities" })) };
    },
  },
  {
    name: "PUBLISHED gym photos: <=20 per branch, exactly one cover",
    async run({ pools }) {
      const over = await rows(pools.gym, `SELECT gym_id, count(*)::int n FROM gym_photos WHERE status = 'PUBLISHED' GROUP BY gym_id HAVING count(*) > 20`);
      const covers = await rows(pools.gym, `SELECT gym_id, (count(*) FILTER (WHERE is_cover))::int AS covers FROM gym_photos WHERE status = 'PUBLISHED' GROUP BY gym_id HAVING count(*) FILTER (WHERE is_cover) <> 1`);
      const draftPublic = await rows(pools.gym, `SELECT g.id FROM gyms g WHERE g.status = 'DRAFT' AND EXISTS (SELECT 1 FROM gym_photos p WHERE p.gym_id = g.id AND p.status = 'PUBLISHED')`);
      const dupHash = await rows(pools.gym, `SELECT gym_id, content_hash, count(*)::int n FROM gym_photos WHERE status IN ('STAGED','PUBLISHED') AND content_hash IS NOT NULL GROUP BY gym_id, content_hash HAVING count(*) > 1`);
      const n = (await rows(pools.gym, `SELECT count(DISTINCT gym_id)::int n FROM gym_photos WHERE status = 'PUBLISHED'`))[0].n;
      return {
        examined: n,
        violations: [
          ...over.map((r) => ({ ...r, why: ">20 PUBLISHED photos" })),
          ...covers.map((r) => ({ ...r, why: "PUBLISHED photos but cover count != 1" })),
          ...draftPublic.map((r) => ({ ...r, why: "DRAFT branch has PUBLISHED photos" })),
          ...dupHash.map((r) => ({ ...r, why: "duplicate content hash in one branch" })),
        ],
      };
    },
  },
  {
    name: "PUBLISHED PT physique photos: <=5 per PT, exactly one cover",
    async run({ pools }) {
      const over = await rows(pools.user, `SELECT pt_user_id, count(*)::int n FROM pt_physique_photos WHERE status = 'PUBLISHED' GROUP BY pt_user_id HAVING count(*) > 5`);
      const covers = await rows(pools.user, `SELECT pt_user_id, (count(*) FILTER (WHERE is_cover))::int AS covers FROM pt_physique_photos WHERE status = 'PUBLISHED' GROUP BY pt_user_id HAVING count(*) FILTER (WHERE is_cover) <> 1`);
      const notPt = await rows(pools.user, `SELECT DISTINCT ph.pt_user_id FROM pt_physique_photos ph JOIN user_profiles p ON p."userId" = ph.pt_user_id WHERE ph.status IN ('STAGED','PUBLISHED') AND p."isPT" = false`);
      const n = (await rows(pools.user, `SELECT count(DISTINCT pt_user_id)::int n FROM pt_physique_photos WHERE status = 'PUBLISHED'`))[0].n;
      return {
        examined: n,
        violations: [
          ...over.map((r) => ({ ...r, why: ">5 PUBLISHED photos" })),
          ...covers.map((r) => ({ ...r, why: "PUBLISHED photos but cover count != 1" })),
          ...notPt.map((r) => ({ ...r, why: "physique photo owned by a non-PT" })),
        ],
      };
    },
  },
  {
    name: "listing revisions: one open; PT version=approved; gym version=1+approved",
    async run({ pools }) {
      const gOpen = await rows(pools.gym, `SELECT gym_id, count(*)::int n FROM gym_listing_revisions WHERE status IN ('DRAFT','PENDING') GROUP BY gym_id HAVING count(*) > 1`);
      const pOpen = await rows(pools.user, `SELECT pt_user_id, count(*)::int n FROM pt_listing_revisions WHERE status IN ('DRAFT','PENDING') GROUP BY pt_user_id HAVING count(*) > 1`);
      const gVer = await rows(pools.gym, `SELECT g.id, g.listing_version FROM gyms g LEFT JOIN gym_listing_revisions r ON r.gym_id = g.id WHERE g.listing_version > 0 GROUP BY g.id, g.listing_version HAVING g.listing_version <> 1 + count(r.id) FILTER (WHERE r.status = 'APPROVED')`);
      // seed PTs only: legacy PTs that existed before migration 20261017173131_pt_listing_revisions were backfilled to listing_version=1 with no revision row (product backfill, not seed data)
      const pVer = await rows(pools.user, `SELECT p."userId" AS uid, p.listing_version FROM user_profiles p LEFT JOIN pt_listing_revisions r ON r.pt_user_id = p."userId" WHERE p.listing_version > 0 AND p.email LIKE ${SEED} GROUP BY p."userId", p.listing_version HAVING p.listing_version <> count(r.id) FILTER (WHERE r.status = 'APPROVED')`);
      const n = (await rows(pools.gym, `SELECT count(*)::int n FROM gym_listing_revisions`))[0].n + (await rows(pools.user, `SELECT count(*)::int n FROM pt_listing_revisions`))[0].n;
      return {
        examined: n,
        violations: [
          ...gOpen.map((r) => ({ ...r, why: "gym has >1 open revision" })),
          ...pOpen.map((r) => ({ ...r, why: "PT has >1 open revision" })),
          ...gVer.map((r) => ({ ...r, why: "gym listing_version != 1 + approved" })),
          ...pVer.map((r) => ({ ...r, why: "PT listing_version != approved revisions (initial version 0)" })),
        ],
      };
    },
  },
  {
    name: "PT contract <-> payment ledger",
    async run({ pools }) {
      const clients = `(SELECT "userId" FROM user_profiles WHERE email LIKE ${SEED})`;
      const paid = await rows(pools.user, `SELECT c.id, c.client_user_id, c.price::numeric AS price FROM contracts c WHERE c.client_user_id IN ${clients} AND c.status IN ('ACTIVE','COMPLETED','EXPIRED')`);
      const pending = await rows(pools.user, `SELECT c.id FROM contracts c WHERE c.client_user_id IN ${clients} AND c.status IN ('PENDING_REVIEW','PENDING_PAYMENT','PENDING_SIGNATURE')`);
      const v = [];
      for (const c of paid) {
        const tx = await rows(pools.payment, `SELECT amount::numeric AS amount, payer_id FROM payment_transactions WHERE pt_contract_id = $1 AND status = 'PAID'`, [c.id]);
        if (tx.length !== 1) v.push({ contractId: c.id, paidTransactions: tx.length, why: "paid contract must have exactly one PAID payment" });
        else {
          if (Number(tx[0].amount) !== Number(c.price)) v.push({ contractId: c.id, paid: tx[0].amount, price: c.price, why: "payment amount != contract price" });
          if (tx[0].payer_id !== c.client_user_id) v.push({ contractId: c.id, why: "payer is not the contract client" });
        }
      }
      for (const c of pending) {
        const tx = await rows(pools.payment, `SELECT 1 FROM payment_transactions WHERE pt_contract_id = $1 AND status = 'PAID'`, [c.id]);
        if (tx.length) v.push({ contractId: c.id, why: "unpaid contract has a PAID payment" });
      }
      return { examined: paid.length + pending.length, violations: v };
    },
  },
  {
    name: "wallet balances = last ledger balance per bucket",
    async run({ pools }) {
      const bad = await rows(
        pools.payment,
        `WITH last AS (
           SELECT DISTINCT ON (wallet_id, bucket) wallet_id, bucket::text AS bucket, balance_after FROM wallet_ledger_entries ORDER BY wallet_id, bucket, created_at DESC, id DESC)
         SELECT w.id, l.bucket, l.balance_after,
                CASE l.bucket WHEN 'AVAILABLE' THEN w.available_balance WHEN 'PENDING' THEN w.pending_balance WHEN 'LOCKED' THEN w.locked_balance WHEN 'HOLDBACK' THEN w.holdback_balance END AS wallet_balance
           FROM wallets w JOIN last l ON l.wallet_id = w.id`,
      );
      const v = bad.filter((r) => r.wallet_balance !== null && Number(r.wallet_balance) !== Number(r.balance_after));
      const n = (await rows(pools.payment, `SELECT count(*)::int n FROM wallet_ledger_entries`))[0].n;
      const neg = await rows(pools.payment, `SELECT id FROM wallets WHERE available_balance < 0 OR pending_balance < 0 OR locked_balance < 0 OR holdback_balance < 0`);
      return {
        examined: n,
        violations: [
          ...v.map((r) => ({ walletId: r.id, bucket: r.bucket, ledger: r.balance_after, wallet: r.wallet_balance, why: "wallet bucket != last ledger balance" })),
          ...neg.map((r) => ({ walletId: r.id, why: "negative balance" })),
        ],
      };
    },
  },
  {
    name: "no WRITER_ABSENT compat event from the seed",
    async run({ pools }) {
      const bad = await rows(
        pools.gym,
        `SELECT e.id, e.entity_type::text AS entity_type, e.entity_id FROM legacy_compat_events e
          WHERE e.outcome::text = 'WRITER_ABSENT'
            AND ((e.entity_type::text = 'GYM' AND e.entity_id IN (SELECT id FROM gyms WHERE email LIKE ${SEED}))
              OR (e.entity_type::text = 'GYM_PARTNER' AND e.entity_id IN (SELECT id FROM gym_partners WHERE contact_email LIKE ${SEED})))`,
      );
      const n = (await rows(pools.gym, `SELECT count(*)::int n FROM legacy_compat_events`))[0].n;
      return { examined: n, violations: bad.map((r) => ({ ...r, why: "seed wrote gyms/gym_partners outside the compat writer" })) };
    },
  },
  {
    name: "only the designated seed admin on the seed domain",
    async run({ pools }) {
      const admins = await rows(pools.auth, `SELECT id FROM users WHERE email LIKE ${SEED} AND role = 'ADMIN' AND NOT (id = $1 AND email = $2)`, [seedAdmin.id, seedAdmin.email]);
      const n = (await rows(pools.auth, `SELECT count(*)::int n FROM users WHERE email LIKE ${SEED}`))[0].n;
      return { examined: n, violations: admins.map((r) => ({ ...r, why: "admin account on the seed domain" })) };
    },
  },
];

export async function runIntegrity(pools, { only } = {}) {
  const results = [];
  for (const check of CHECKS) {
    if (only && !only.includes(check.name)) continue;
    try {
      const r = await check.run({ pools });
      results.push({ name: check.name, examined: r.examined, violations: r.violations, status: r.violations.length ? "FAIL" : r.examined === 0 ? "N/A" : "PASS" });
    } catch (e) {
      results.push({ name: check.name, examined: 0, violations: [{ why: `check could not run: ${e.message}` }], status: "ERROR" });
    }
  }
  return results;
}
