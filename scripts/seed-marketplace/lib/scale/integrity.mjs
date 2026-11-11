// Set-based SQL integrity verifier for the Scale Marketplace Seed (C6: zero JS N+1 loops).
import path from "node:path";
import { C3_PROVINCES, PHOTO_REUSE_CAP, PT_TERMS_VERSION, SCALE_EMAIL_DOMAIN } from "./config.mjs";
import { verifyLocalAvatars, verifyMinioMediaObjects } from "./media.mjs";

const SCALE_LIKE = `'%@${SCALE_EMAIL_DOMAIN}'`;

async function rows(pool, sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

/**
 * Executes all C6 set-based integrity assertions across auth, user, gym, payment, and media.
 * Enforces strict C3 / 700-180-20 / >=40% ward coverage checks when scaleFactor === 1.
 */
export async function runScaleIntegrity({
  pools,
  scaleFactor = 1,
  checkMedia = false,
  avatarsDir,
  s3,
  ListObjectsV2Command,
}) {
  const results = [];
  const runCheck = async (name, fn) => {
    try {
      const r = await fn();
      results.push({
        name,
        examined: r.examined,
        violations: r.violations,
        meta: r.meta,
        status: r.violations.length > 0 ? "FAIL" : r.examined === 0 ? "N/A" : "PASS",
      });
    } catch (e) {
      results.push({ name, examined: 0, violations: [{ why: `error: ${e.message}` }], status: "ERROR" });
    }
  };

  // 1. Cross-DB User & Role Parity (3 bulk queries + O(N) Set/Map join — zero per-row queries)
  await runCheck("1. Cross-DB auth <-> user_profiles <-> gym_partner_accounts parity", async () => {
    const [authRows, profRows, ownerAccRows] = await Promise.all([
      rows(pools.auth, `SELECT id, email, role::text AS role FROM users WHERE email LIKE ${SCALE_LIKE}`),
      rows(pools.user, `SELECT "userId" AS uid, "isPT" AS is_pt, data_origin FROM user_profiles WHERE email LIKE ${SCALE_LIKE}`),
      rows(
        pools.gym,
        `SELECT a.user_id, a.role::text AS role FROM gym_partner_accounts a JOIN gym_partners p ON p.id = a.partner_id WHERE p.contact_email LIKE ${SCALE_LIKE}`
      ),
    ]);
    const authById = new Map(authRows.map((r) => [r.id, r]));
    const profById = new Map(profRows.map((r) => [r.uid, r]));
    const ownerSet = new Set(ownerAccRows.filter((a) => a.role === "OWNER").map((a) => a.user_id));

    const v = [];
    for (const p of profRows) {
      if (p.data_origin !== "SYNTHETIC") v.push({ uid: p.uid, why: "scale profile missing data_origin=SYNTHETIC" });
      const a = authById.get(p.uid);
      if (!a) v.push({ uid: p.uid, why: "profile without auth user" });
      else if ((a.role === "PT") !== p.is_pt) v.push({ uid: p.uid, role: a.role, isPT: p.is_pt, why: "role <-> isPT mismatch" });
    }
    let admins = 0;
    for (const a of authRows) {
      if (a.role === "ADMIN") admins++;
      else if (a.role === "GYM_OWNER") {
        if (!ownerSet.has(a.id)) v.push({ uid: a.id, why: "GYM_OWNER missing partner account" });
      } else if (!profById.has(a.id)) {
        v.push({ uid: a.id, role: a.role, why: "CUSTOMER/PT missing user_profiles row" });
      }
    }
    if (admins > 1) v.push({ admins, why: "more than 1 ADMIN on scale domain" });
    return { examined: authRows.length, violations: v.slice(0, 50) };
  });

  // 2. PT Schema, Listing, Packages, Locations, Terms, Restrictions, Media Cap <= 40 (Set-based SQL)
  await runCheck("2. PT listing, packages, locations, terms, restrictions & <=40 photo cap", async () => {
    const [
      appMiss,
      verBad,
      openRevDup,
      pkgBadMode,
      locBadOnline,
      locMissingOffline,
      termsMiss,
      photoCountBad,
      photoCoverBad,
      photoHashDup,
      photoCapOver,
      restContractBad,
      ptTotal,
    ] = await Promise.all([
      rows(
        pools.user,
        `SELECT p."userId" AS uid FROM user_profiles p LEFT JOIN pt_applications a ON a.user_profile_id = p.id
         WHERE p.email LIKE ${SCALE_LIKE} AND p."isPT" = true AND a.id IS NULL LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT p."userId" AS uid, p.listing_version FROM user_profiles p
         LEFT JOIN pt_listing_revisions r ON r.pt_user_id = p."userId"
         WHERE p.email LIKE ${SCALE_LIKE} AND p."isPT" = true
         GROUP BY p."userId", p.listing_version
         HAVING p.listing_version <> count(r.id) FILTER (WHERE r.status = 'APPROVED') LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT pt_user_id FROM pt_listing_revisions WHERE status IN ('DRAFT','PENDING')
         GROUP BY pt_user_id HAVING count(*) > 1 LIMIT 20`
      ),
      // Package sessionMode must match application serviceMode (HYBRID must have >=1 active ONLINE & >=1 active OFFLINE)
      rows(
        pools.user,
        `SELECT p."userId" AS uid, a.service_mode::text AS service_mode,
                count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'ONLINE') AS on_cnt,
                count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'OFFLINE') AS off_cnt,
                count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'HYBRID') AS hyb_cnt
         FROM user_profiles p
         JOIN pt_applications a ON a.user_profile_id = p.id
         LEFT JOIN pt_service_packages pk ON pk.pt_user_id = p."userId"
         WHERE p.email LIKE ${SCALE_LIKE} AND p."isPT" = true AND a.status = 'APPROVED' AND p.pt_suspended = false AND p.is_accepting_clients = true
           AND NOT EXISTS (SELECT 1 FROM pt_restrictions r WHERE r.pt_user_id = p."userId" AND r.ended_at IS NULL AND r.scope = 'ACCOUNT')
         GROUP BY p."userId", a.service_mode
         HAVING (a.service_mode = 'ONLINE' AND (count(*) FILTER (WHERE pk.is_active AND pk.session_mode <> 'ONLINE') > 0 OR count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'ONLINE') = 0))
             OR (a.service_mode = 'OFFLINE' AND (count(*) FILTER (WHERE pk.is_active AND pk.session_mode <> 'OFFLINE') > 0 OR count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'OFFLINE') = 0))
             OR (a.service_mode = 'HYBRID' AND (count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'ONLINE') = 0 OR count(*) FILTER (WHERE pk.is_active AND pk.session_mode = 'OFFLINE') = 0))
         LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT p."userId" AS uid FROM user_profiles p
         JOIN pt_applications a ON a.user_profile_id = p.id
         JOIN pt_training_locations l ON l.pt_user_id = p."userId"
         WHERE p.email LIKE ${SCALE_LIKE} AND a.service_mode = 'ONLINE' LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT p."userId" AS uid FROM user_profiles p
         JOIN pt_applications a ON a.user_profile_id = p.id
         LEFT JOIN pt_training_locations l ON l.pt_user_id = p."userId"
         WHERE p.email LIKE ${SCALE_LIKE} AND a.service_mode IN ('OFFLINE','HYBRID') AND a.status = 'APPROVED'
         GROUP BY p."userId" HAVING count(l.id) = 0 LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT p."userId" AS uid FROM user_profiles p
         JOIN pt_applications a ON a.user_profile_id = p.id
         LEFT JOIN pt_terms_acceptances t ON t.user_id = p."userId" AND t.version = $1
         WHERE p.email LIKE ${SCALE_LIKE} AND a.status = 'APPROVED' AND t.id IS NULL LIMIT 20`,
        [PT_TERMS_VERSION]
      ),
      rows(
        pools.user,
        `SELECT pt_user_id, count(*)::int AS n FROM pt_physique_photos WHERE status = 'PUBLISHED' GROUP BY pt_user_id HAVING count(*) > 5 LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT pt_user_id, (count(*) FILTER (WHERE is_cover))::int AS c FROM pt_physique_photos WHERE status = 'PUBLISHED' GROUP BY pt_user_id HAVING count(*) FILTER (WHERE is_cover) <> 1 LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT pt_user_id, content_hash FROM pt_physique_photos WHERE status IN ('STAGED','PUBLISHED') AND content_hash IS NOT NULL GROUP BY pt_user_id, content_hash HAVING count(*) > 1 LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT ph.content_hash, count(DISTINCT ph.pt_user_id)::int AS uses
         FROM pt_physique_photos ph JOIN user_profiles p ON p."userId" = ph.pt_user_id
         WHERE p.email LIKE ${SCALE_LIKE} AND ph.content_hash IS NOT NULL
         GROUP BY ph.content_hash HAVING count(DISTINCT ph.pt_user_id) > $1 LIMIT 20`,
        [PHOTO_REUSE_CAP]
      ),
      rows(
        pools.user,
        `SELECT r.id FROM pt_restrictions r LEFT JOIN contracts c ON c.id = r.contract_id
         WHERE c.data_origin = 'SYNTHETIC'
            OR (r.scope = 'CONTRACT' AND EXISTS (SELECT 1 FROM user_profiles p WHERE p."userId" = r.pt_user_id AND p.email LIKE ${SCALE_LIKE})) LIMIT 20`
      ),
      rows(pools.user, `SELECT count(*)::int AS n FROM user_profiles WHERE email LIKE ${SCALE_LIKE} AND "isPT" = true`),
    ]);

    const v = [
      ...appMiss.map((r) => ({ ...r, why: "PT missing pt_applications" })),
      ...verBad.map((r) => ({ ...r, why: "PT listing_version != APPROVED revisions" })),
      ...openRevDup.map((r) => ({ ...r, why: "PT >1 open revision" })),
      ...pkgBadMode.map((r) => ({ ...r, why: "PT package sessionMode mismatches serviceMode" })),
      ...locBadOnline.map((r) => ({ ...r, why: "ONLINE PT has pt_training_locations" })),
      ...locMissingOffline.map((r) => ({ ...r, why: "OFFLINE/HYBRID approved PT missing locations" })),
      ...termsMiss.map((r) => ({ ...r, why: "approved PT missing pt_terms_acceptances" })),
      ...photoCountBad.map((r) => ({ ...r, why: "PT >5 published photos" })),
      ...photoCoverBad.map((r) => ({ ...r, why: "PT published cover count != 1" })),
      ...photoHashDup.map((r) => ({ ...r, why: "PT duplicate photo hash" })),
      ...photoCapOver.map((r) => ({ ...r, why: `PT photo master exceeded cap ${PHOTO_REUSE_CAP}` })),
      ...restContractBad.map((r) => ({ ...r, why: "CONTRACT restriction on scale/SYNTHETIC data" })),
    ];
    return { examined: ptTotal[0].n, violations: v };
  });

  // 3. Gym Hierarchy, Mirror, data_origin, Hours, Photos, Compat Writer & Cap <= 40 (Set-based SQL in gym_db)
  await runCheck("3. Gym hierarchy, facilities mirror, data_origin, 7h, photos <=40 cap & compat_writer", async () => {
    const [
      brandDup,
      partnerMismatch,
      facilitiesMismatch,
      hoursBad,
      verBad,
      photoOver,
      photoCoverBad,
      draftPubPhoto,
      photoCapOver,
      writerAbsent,
      gymOriginBad,
      gymTotal,
    ] = await Promise.all([
      rows(pools.gym, `SELECT owner_id, count(*)::int AS n FROM gym_brands GROUP BY owner_id HAVING count(*) > 1 LIMIT 20`),
      rows(
        pools.gym,
        `SELECT g.id FROM gyms g LEFT JOIN gym_brands b ON b.id = g.brand_id LEFT JOIN gym_partners p ON p.brand_id = b.id
         LEFT JOIN gym_partner_accounts a ON a.partner_id = p.id AND a.role = 'OWNER' AND a.status = 'ACTIVE'
         WHERE g.email LIKE ${SCALE_LIKE} AND (b.id IS NULL OR p.id IS NULL OR a.id IS NULL OR g.owner_id <> b.owner_id OR b.owner_id <> a.user_id) LIMIT 20`
      ),
      rows(
        pools.gym,
        `WITH want AS (
           SELECT g.id AS gym_id, coalesce(array_agg(a.slug ORDER BY a.slug) FILTER (WHERE a.source = 'SYSTEM' AND a.status = 'ACTIVE'), '{}') AS slugs
           FROM gyms g LEFT JOIN gym_amenities ga ON ga.gym_id = g.id LEFT JOIN amenities a ON a.id = ga.amenity_id
           WHERE g.email LIKE ${SCALE_LIKE} GROUP BY g.id
         )
         SELECT g.id FROM gyms g JOIN want w ON w.gym_id = g.id
         WHERE (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(g.facilities::text[]) x) <> w.slugs LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT g.id, count(DISTINCT h.day)::int AS days FROM gyms g LEFT JOIN gym_operating_hours h ON h.gym_id = g.id
         WHERE g.email LIKE ${SCALE_LIKE} GROUP BY g.id HAVING count(h.id) <> 7 OR count(DISTINCT h.day) <> 7 LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT g.id, g.listing_version FROM gyms g LEFT JOIN gym_listing_revisions r ON r.gym_id = g.id
         WHERE g.email LIKE ${SCALE_LIKE} AND g.listing_version > 0
         GROUP BY g.id, g.listing_version HAVING g.listing_version <> 1 + count(r.id) FILTER (WHERE r.status = 'APPROVED') LIMIT 20`
      ),
      rows(pools.gym, `SELECT gym_id FROM gym_photos WHERE status = 'PUBLISHED' GROUP BY gym_id HAVING count(*) > 20 LIMIT 20`),
      rows(pools.gym, `SELECT gym_id FROM gym_photos WHERE status = 'PUBLISHED' GROUP BY gym_id HAVING count(*) FILTER (WHERE is_cover) <> 1 LIMIT 20`),
      rows(pools.gym, `SELECT g.id FROM gyms g WHERE g.email LIKE ${SCALE_LIKE} AND g.status = 'DRAFT' AND EXISTS (SELECT 1 FROM gym_photos p WHERE p.gym_id = g.id AND p.status = 'PUBLISHED') LIMIT 20`),
      rows(
        pools.gym,
        `SELECT ph.content_hash, count(DISTINCT ph.gym_id)::int AS uses
         FROM gym_photos ph JOIN gyms g ON g.id = ph.gym_id
         WHERE g.email LIKE ${SCALE_LIKE} AND ph.content_hash IS NOT NULL
         GROUP BY ph.content_hash HAVING count(DISTINCT ph.gym_id) > $1 LIMIT 20`,
        [PHOTO_REUSE_CAP]
      ),
      rows(
        pools.gym,
        `SELECT e.id FROM legacy_compat_events e WHERE e.outcome::text = 'WRITER_ABSENT'
           AND ((e.entity_type::text = 'GYM' AND e.entity_id IN (SELECT id FROM gyms WHERE email LIKE ${SCALE_LIKE}))
             OR (e.entity_type::text = 'GYM_PARTNER' AND e.entity_id IN (SELECT id FROM gym_partners WHERE contact_email LIKE ${SCALE_LIKE}))) LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT g.id, g.data_origin::text AS data_origin FROM gyms g
         WHERE (
           g.email LIKE ${SCALE_LIKE}
           OR EXISTS (
             SELECT 1 FROM gym_brands b
             JOIN gym_partners p ON p.brand_id = b.id
             WHERE b.id = g.brand_id AND p.contact_email LIKE ${SCALE_LIKE}
           )
           OR EXISTS (SELECT 1 FROM gym_membership_contracts m WHERE m.gym_id = g.id AND m.data_origin = 'SYNTHETIC'::"DataOrigin")
           OR EXISTS (SELECT 1 FROM gym_reviews r WHERE r.gym_id = g.id AND r.data_origin = 'SYNTHETIC'::"DataOrigin")
         )
         AND g.data_origin <> 'SYNTHETIC'::"DataOrigin"
         LIMIT 20`
      ),
      rows(pools.gym, `SELECT count(*)::int AS n FROM gyms WHERE email LIKE ${SCALE_LIKE}`),
    ]);

    const v = [
      ...brandDup.map((r) => ({ ...r, why: ">1 brand per owner" })),
      ...partnerMismatch.map((r) => ({ ...r, why: "gym/brand/partner/owner account chain invalid" })),
      ...facilitiesMismatch.map((r) => ({ ...r, why: "gyms.facilities mirror drift" })),
      ...hoursBad.map((r) => ({ ...r, why: "gym_operating_hours != 7 distinct days" })),
      ...verBad.map((r) => ({ ...r, why: "gym listing_version != 1 + approved revisions" })),
      ...photoOver.map((r) => ({ ...r, why: ">20 published gym photos" })),
      ...photoCoverBad.map((r) => ({ ...r, why: "gym published cover count != 1" })),
      ...draftPubPhoto.map((r) => ({ ...r, why: "DRAFT gym has PUBLISHED photos" })),
      ...photoCapOver.map((r) => ({ ...r, why: `gym photo exceeded reuse cap ${PHOTO_REUSE_CAP}` })),
      ...writerAbsent.map((r) => ({ ...r, why: "WRITER_ABSENT logged for scale gym/partner" })),
      ...gymOriginBad.map((r) => ({ ...r, why: "scale gym data_origin != SYNTHETIC" })),
    ];
    return { examined: gymTotal[0].n, violations: v };
  });

  // 4. Financial Inertia ("Trơ tài chính") & Terminated States Only (SYNTHETIC)
  await runCheck("4. Financially inert SYNTHETIC (COMPLETED/EXPIRED only, 0 payment/settlement)", async () => {
    const [
      badPtStatus,
      badSessStatus,
      badSettlements,
      badGymMemStatus,
      badReferrals,
      badWallets,
      scaleUserRows,
      scalePtContractRows,
      scaleGymContractRows,
      cntContracts,
      cntMemberships,
    ] = await Promise.all([
      rows(
        pools.user,
        `SELECT count(*)::int AS n FROM contracts WHERE data_origin = 'SYNTHETIC'
           AND (status <> 'COMPLETED' OR payment_transaction_id IS NOT NULL
                OR COALESCE(released_to_pt, 0) <> 0 OR COALESCE(released_to_gym, 0) <> 0 OR COALESCE(released_to_platform, 0) <> 0)`
      ),
      rows(
        pools.user,
        `SELECT count(*)::int AS n FROM sessions s JOIN contracts c ON c.id = s.contract_id
         WHERE c.data_origin = 'SYNTHETIC' AND s.status <> 'COMPLETED'`
      ),
      rows(
        pools.user,
        `SELECT count(*)::int AS n FROM session_settlements ss JOIN contracts c ON c.id = ss.contract_id WHERE c.data_origin = 'SYNTHETIC'`
      ),
      rows(
        pools.gym,
        `SELECT count(*)::int AS n FROM gym_membership_contracts WHERE data_origin = 'SYNTHETIC'::"DataOrigin"
           AND (status <> 'EXPIRED' OR payment_txn_id IS NOT NULL OR payout_released_at IS NOT NULL OR refund_clawback_done = true)`
      ),
      rows(
        pools.gym,
        `SELECT count(*)::int AS n FROM gym_membership_referrals r JOIN gym_membership_contracts m ON m.id = r.membership_contract_id
         WHERE m.data_origin = 'SYNTHETIC'::"DataOrigin"`
      ),
      rows(
        pools.payment,
        `SELECT count(*)::int AS n FROM wallets WHERE owner_type <> 'PLATFORM' OR owner_id NOT IN ('ESCROW','REVENUE')
           OR available_balance <> 0 OR pending_balance <> 0 OR locked_balance <> 0 OR holdback_balance <> 0`
      ),
      rows(pools.auth, `SELECT array_agg(id) AS ids FROM users WHERE email LIKE ${SCALE_LIKE}`),
      rows(pools.user, `SELECT array_agg(id) AS ids FROM contracts WHERE data_origin = 'SYNTHETIC'`),
      rows(pools.gym, `SELECT array_agg(id) AS ids FROM gym_membership_contracts WHERE data_origin = 'SYNTHETIC'::"DataOrigin"`),
      rows(pools.user, `SELECT count(*)::int AS n FROM contracts WHERE data_origin = 'SYNTHETIC'`),
      rows(pools.gym, `SELECT count(*)::int AS n FROM gym_membership_contracts WHERE data_origin = 'SYNTHETIC'::"DataOrigin"`),
    ]);

    const userIds = scaleUserRows[0]?.ids ?? [];
    const ptCIds = scalePtContractRows[0]?.ids ?? [];
    const gymCIds = scaleGymContractRows[0]?.ids ?? [];
    const [badTx, badLedger, badWithdraw] = await Promise.all([
      rows(
        pools.payment,
        `SELECT count(*)::int AS n FROM payment_transactions
         WHERE payer_id = ANY($1::text[]) OR pt_contract_id = ANY($2::text[]) OR membership_id = ANY($3::text[])`,
        [userIds, ptCIds, gymCIds]
      ),
      rows(
        pools.payment,
        `SELECT count(*)::int AS n FROM wallet_ledger_entries l JOIN payment_transactions t ON t.id = l.transaction_id
         WHERE t.payer_id = ANY($1::text[]) OR t.pt_contract_id = ANY($2::text[]) OR t.membership_id = ANY($3::text[])`,
        [userIds, ptCIds, gymCIds]
      ),
      rows(
        pools.payment,
        `SELECT count(*)::int AS n FROM withdrawal_requests w JOIN wallets wl ON wl.id = w.wallet_id
         WHERE wl.owner_id = ANY($1::text[])`,
        [userIds]
      ),
    ]);

    const v = [];
    const addIf = (n, why) => { if (n > 0) v.push({ count: n, why }); };
    addIf(badPtStatus[0].n, "SYNTHETIC PT contracts not COMPLETED or carry payment/release fields");
    addIf(badSessStatus[0].n, "SYNTHETIC PT sessions not COMPLETED");
    addIf(badSettlements[0].n, "session_settlements attached to SYNTHETIC contracts");
    addIf(badGymMemStatus[0].n, "SYNTHETIC gym memberships not EXPIRED or carry payment/payout fields");
    addIf(badReferrals[0].n, "gym_membership_referrals attached to SYNTHETIC memberships");
    addIf(badWallets[0].n, "non-escrow or non-zero wallets exist");
    addIf(badTx[0].n, "payment_transactions reference scale users/contracts/memberships");
    addIf(badLedger[0].n, "wallet_ledger_entries reference scale transactions");
    addIf(badWithdraw[0].n, "withdrawal_requests reference scale users");
    return { examined: cntContracts[0].n + cntMemberships[0].n, violations: v };
  });

  // 5. Contract/Session/Review & Affiliation Relational Integrity (Set-based SQL)
  await runCheck("5. Contracts <-> Sessions <-> Reviews, SYNTHETIC gym origin & PT-Gym Affiliations parity", async () => {
    const [sessMismatch, revMismatch, gymRevBad, ciBad, revGymOriginBad, memGymOriginBad, reviewTotal, gymRevMemTotal] = await Promise.all([
      rows(
        pools.user,
        `SELECT c.id FROM contracts c LEFT JOIN sessions s ON s.contract_id = c.id
         WHERE c.data_origin = 'SYNTHETIC' GROUP BY c.id, c.used_sessions HAVING c.used_sessions <> count(s.id) FILTER (WHERE s.status = 'COMPLETED') LIMIT 20`
      ),
      rows(
        pools.user,
        `SELECT r.id FROM session_reviews r JOIN sessions s ON s.id = r.session_id
         JOIN contracts c ON c.id = r.contract_id
         WHERE c.data_origin = 'SYNTHETIC' AND (s.contract_id <> r.contract_id OR s.client_user_id <> r.client_user_id OR s.status <> 'COMPLETED') LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT r.gym_id, r.client_id FROM gym_reviews r WHERE r.data_origin = 'SYNTHETIC'::"DataOrigin" GROUP BY r.gym_id, r.client_id HAVING count(*) > 1 LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT ci.id FROM gym_check_ins ci JOIN gym_membership_contracts m ON m.id = ci.membership_id
         WHERE m.data_origin = 'SYNTHETIC'::"DataOrigin" AND (ci.gym_id <> m.gym_id OR ci.client_id <> m.client_id) LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT r.id, r.gym_id, g.data_origin::text AS gym_data_origin
         FROM gym_reviews r
         LEFT JOIN gyms g ON g.id = r.gym_id
         WHERE r.data_origin = 'SYNTHETIC'::"DataOrigin"
           AND (g.id IS NULL OR g.data_origin <> 'SYNTHETIC'::"DataOrigin")
         LIMIT 20`
      ),
      rows(
        pools.gym,
        `SELECT m.id, m.gym_id, g.data_origin::text AS gym_data_origin
         FROM gym_membership_contracts m
         LEFT JOIN gyms g ON g.id = m.gym_id
         WHERE m.data_origin = 'SYNTHETIC'::"DataOrigin"
           AND (g.id IS NULL OR g.data_origin <> 'SYNTHETIC'::"DataOrigin")
         LIMIT 20`
      ),
      rows(pools.user, `SELECT count(*)::int AS n FROM session_reviews r JOIN contracts c ON c.id = r.contract_id WHERE c.data_origin = 'SYNTHETIC'`),
      rows(
        pools.gym,
        `SELECT (
           (SELECT count(*)::int FROM gym_reviews WHERE data_origin = 'SYNTHETIC'::"DataOrigin") +
           (SELECT count(*)::int FROM gym_membership_contracts WHERE data_origin = 'SYNTHETIC'::"DataOrigin")
         ) AS n`
      ),
    ]);
    const v = [
      ...sessMismatch.map((r) => ({ ...r, why: "contract used_sessions != completed sessions" })),
      ...revMismatch.map((r) => ({ ...r, why: "session_review mismatches session/contract/client" })),
      ...gymRevBad.map((r) => ({ ...r, why: "duplicate (gym_id, client_id) review" })),
      ...ciBad.map((r) => ({ ...r, why: "gym_check_in mismatches membership gym/client" })),
      ...revGymOriginBad.map((r) => ({ ...r, why: "SYNTHETIC gym_reviews points to missing/non-SYNTHETIC gym" })),
      ...memGymOriginBad.map((r) => ({ ...r, why: "SYNTHETIC gym_membership_contracts points to missing/non-SYNTHETIC gym" })),
    ];
    return { examined: reviewTotal[0].n + gymRevMemTotal[0].n, violations: v };
  });

  // 6. Geo Bounds, C3 Province Quotas, Chains 700/180/20, Ward >=40%, Review Distribution C5.5
  await runCheck("6. Geo polygon bbox, C3 quotas, chain bounds, >=40% ward coverage & review C5.5", async () => {
    const wardBoundsRows = await rows(pools.user, `SELECT ward_code, province_code, min_lat, max_lat, min_lng, max_lng FROM vietnam_ward_geo`);
    const wardBounds = new Map(wardBoundsRows.map((w) => [w.ward_code, w]));

    const [gymLocRows, ptLocRows, ownerBranchCounts, revDistRows] = await Promise.all([
      rows(pools.gym, `SELECT id, brand_id, owner_id, province_code, ward_code, latitude, longitude FROM gyms WHERE email LIKE ${SCALE_LIKE}`),
      rows(
        pools.user,
        `SELECT l.pt_user_id, l.province_code, l.ward_code, l.latitude, l.longitude
         FROM pt_training_locations l JOIN user_profiles p ON p."userId" = l.pt_user_id WHERE p.email LIKE ${SCALE_LIKE}`
      ),
      rows(
        pools.gym,
        `SELECT owner_id, count(*)::int AS branches, count(DISTINCT province_code)::int AS provs FROM gyms WHERE email LIKE ${SCALE_LIKE} GROUP BY owner_id`
      ),
      rows(
        pools.user,
        `SELECT p."userId" AS uid, count(r.id)::int AS cnt, COALESCE(avg(r.rating), 0)::float8 AS avg_r
         FROM user_profiles p
         JOIN pt_applications a ON a.user_profile_id = p.id
         LEFT JOIN contracts c ON c.pt_user_id = p."userId" AND c.data_origin = 'SYNTHETIC'
         LEFT JOIN session_reviews r ON r.contract_id = c.id
         WHERE p.email LIKE ${SCALE_LIKE} AND p."isPT" = true AND a.status = 'APPROVED' AND p.pt_suspended = false AND p.is_accepting_clients = true
           AND EXISTS (SELECT 1 FROM pt_service_packages pk WHERE pk.pt_user_id = p."userId" AND pk.is_active = true)
           AND NOT EXISTS (SELECT 1 FROM pt_restrictions rs WHERE rs.pt_user_id = p."userId" AND rs.ended_at IS NULL AND rs.scope = 'ACCOUNT')
         GROUP BY p."userId"`
      ),
    ]);

    const v = [];
    const eps = 0.002;
    for (const g of gymLocRows) {
      const wb = wardBounds.get(g.ward_code);
      if (!wb || wb.province_code !== g.province_code) {
        v.push({ gymId: g.id, why: "gym ward/province invalid in vietnam_ward_geo" });
        if (v.length >= 20) break;
      } else if (g.latitude < wb.min_lat - eps || g.latitude > wb.max_lat + eps || g.longitude < wb.min_lng - eps || g.longitude > wb.max_lng + eps) {
        v.push({ gymId: g.id, why: "gym GPS outside ward bbox" });
        if (v.length >= 20) break;
      }
    }
    for (const l of ptLocRows) {
      const wb = wardBounds.get(l.ward_code);
      if (!wb || wb.province_code !== l.province_code) {
        v.push({ ptUserId: l.pt_user_id, why: "PT location ward/province invalid" });
        if (v.length >= 20) break;
      } else if (l.latitude < wb.min_lat - eps || l.latitude > wb.max_lat + eps || l.longitude < wb.min_lng - eps || l.longitude > wb.max_lng + eps) {
        v.push({ ptUserId: l.pt_user_id, why: "PT GPS outside ward bbox" });
        if (v.length >= 20) break;
      }
    }

    // Check scaleFactor=1 structural tolerances strictly
    const meta = { gyms: gymLocRows.length, coveredWards: new Set(gymLocRows.map((g) => g.ward_code)).size };
    if (scaleFactor === 1) {
      if (gymLocRows.length !== 2500) v.push({ count: gymLocRows.length, why: "total gyms != 2500" });
      if (ownerBranchCounts.length !== 900) v.push({ owners: ownerBranchCounts.length, why: "total owners != 900" });

      const stand = ownerBranchCounts.filter((o) => o.branches === 1).length;
      const med = ownerBranchCounts.filter((o) => o.branches >= 2 && o.branches <= 5).length;
      const large = ownerBranchCounts.filter((o) => o.branches >= 15 && o.branches <= 90).length;
      if (stand !== 700 || med !== 180 || large !== 20) {
        v.push({ stand, med, large, why: "owner branch split != 700 standalone / 180 medium [2..5] / 20 large [15..90]" });
      }
      const overSpread = ownerBranchCounts.filter((o) => o.branches >= 15 && o.provs > 6);
      if (overSpread.length) v.push({ sample: overSpread[0], why: "large chain spans > 6 provinces" });

      // C3 +-0.5 percentage point check
      const byProv = new Map();
      for (const g of gymLocRows) byProv.set(g.province_code, (byProv.get(g.province_code) ?? 0) + 1);
      for (const c3 of C3_PROVINCES) {
        const actualPct = ((byProv.get(c3.code) ?? 0) * 100) / gymLocRows.length;
        if (Math.abs(actualPct - c3.pct) > 0.5) {
          v.push({ provinceCode: c3.code, actualPct, targetPct: c3.pct, why: "C3 province share exceeded ±0.5%" });
        }
      }

      const wardCoverage = meta.coveredWards / 3321;
      meta.wardCoveragePct = Number((wardCoverage * 100).toFixed(2));
      if (wardCoverage < 0.4) v.push({ wardCoverage, why: "ward coverage < 40% of 3321" });
    }

    // Check review stats meta
    if (revDistRows.length > 0) {
      const zeroPct = revDistRows.filter((r) => r.cnt === 0).length / revDistRows.length;
      const sortedCnts = revDistRows.map((r) => r.cnt).sort((a, b) => a - b);
      const median = sortedCnts[Math.floor(sortedCnts.length / 2)];
      meta.zeroReviewPct = Number((zeroPct * 100).toFixed(1));
      meta.medianReviewsPerPt = median;
    }

    return { examined: gymLocRows.length + ptLocRows.length, violations: v, meta };
  });

  // 7. Media links (optional when MinIO + avatar dir checked)
  if (checkMedia) {
    await runCheck("7. Zero broken media links (MinIO objects + local WebP avatars)", async () => {
      const [ptKeys, gymKeys, avatarUrls] = await Promise.all([
        rows(
          pools.user,
          `SELECT ph.storage_key FROM pt_physique_photos ph JOIN user_profiles p ON p."userId" = ph.pt_user_id WHERE p.email LIKE ${SCALE_LIKE}`
        ),
        rows(
          pools.gym,
          `SELECT ph.s3_key FROM gym_photos ph JOIN gyms g ON g.id = ph.gym_id WHERE g.email LIKE ${SCALE_LIKE} AND ph.s3_key IS NOT NULL`
        ),
        rows(
          pools.user,
          `SELECT "userId" AS uid, photo_url FROM user_profiles WHERE email LIKE ${SCALE_LIKE} AND photo_url LIKE '/uploads/profile-photos/%'`
        ),
      ]);

      const avatarPlans = avatarUrls.map((r) => ({
        userId: r.uid,
        fileName: path.basename(r.photo_url),
        photoUrl: r.photo_url,
      }));
      const localRes = verifyLocalAvatars(avatarPlans, avatarsDir);
      const s3Res = s3
        ? await verifyMinioMediaObjects({
            ptStorageKeys: ptKeys.map((r) => r.storage_key),
            gymS3Keys: gymKeys.map((r) => r.s3_key),
            s3,
            ListObjectsV2Command,
          })
        : { examined: 0, missingPtCount: 0, missingGymCount: 0, sampleMissing: [] };

      const v = [];
      if (localRes.missing.length) v.push({ count: localRes.missing.length, sample: localRes.missing.slice(0, 5), why: "missing local avatar WebP" });
      if (s3Res.missingPtCount || s3Res.missingGymCount) v.push({ ...s3Res, why: "missing MinIO media objects" });
      return { examined: localRes.examined + s3Res.examined, violations: v };
    });
  }

  return results;
}
