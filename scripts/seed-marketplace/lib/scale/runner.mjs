// Orchestrator for --tier scale: coordinates planning, checkpointing/--resume,
// UNNEST batch writing with reconciliation, MinIO CopyObject / avatars, C6 verification, and telemetry.
import fs from "node:fs";
import path from "node:path";
import { targetFingerprint } from "../preflight.mjs";
import { SCALE_NAMESPACE, scaledCounts } from "./config.mjs";
import { ScaleMetricsTracker } from "./rng.mjs";
import { COLS, buildScaleUniverse } from "./data-generators.mjs";
import { reconcileBatchCounts, writeBatchWithReconciliation } from "./db-writer.mjs";
import {
  DEFAULT_RUNTIME_DIR,
  assertCheckpointCompatible,
  assertTargetReadyForScale,
  checkpointPathFor,
  demoAccountsPathFor,
  loadCheckpoint,
  prepareScalePasswords,
  saveCheckpointAtomic,
} from "./checkpoint.mjs";
import {
  DEFAULT_AVATARS_DIR,
  createScaleS3Clients,
  generateScaleAvatars,
  loadUsableMasterPools,
  syncMediaToMinio,
} from "./media.mjs";
import { runScaleIntegrity } from "./integrity.mjs";

const ALL_PHASES = ["auth", "gym-core", "user-core", "contracts", "memberships", "media", "verify"];

export async function runScaleSeed({
  target,
  pools,
  scaleFactor = 1,
  batchSize = 1000,
  namespace = SCALE_NAMESPACE,
  resume = false,
  only = null,
  skipMedia = target.kind === "test",
  runtimeDir = DEFAULT_RUNTIME_DIR,
  avatarsDir = DEFAULT_AVATARS_DIR,
  metricsPath = null,
  reportPath = null,
  s3 = null,
  s3Commands = null,
  masterPools = loadUsableMasterPools(),
  log = (msg) => console.log(msg),
}) {
  const counts = scaledCounts(scaleFactor);
  const tracker = new ScaleMetricsTracker(counts.scaleFactor, namespace);
  const fp = targetFingerprint(target);
  const cpFile = checkpointPathFor(target, runtimeDir);
  const existingCp = loadCheckpoint(cpFile);

  await assertTargetReadyForScale({ target, pools, resume, checkpoint: existingCp });

  const { result: { universe } } = await tracker.trackPhase("plan", async () => {
    const u = buildScaleUniverse({ counts, namespace, masterPools });
    return { rows: 0, universe: u };
  });

  if (resume) {
    assertCheckpointCompatible(existingCp, {
      targetFingerprint: fp,
      scaleFactor: counts.scaleFactor,
      structuralChecksum: universe.structuralChecksum,
      namespace,
    });
    log(`[scale] resuming from checkpoint (${cpFile}) checksum=${universe.structuralChecksum.slice(0, 12)}`);
  } else {
    log(`[scale] plan ready factor=${counts.scaleFactor} checksum=${universe.structuralChecksum.slice(0, 12)} (gyms=${universe.branches.length}, pts=${universe.pts.length}, customers=${universe.customers.length})`);
  }

  const checkpoint = existingCp ?? {
    targetFingerprint: fp,
    namespace,
    scaleFactor: counts.scaleFactor,
    batchSize,
    structuralChecksum: universe.structuralChecksum,
    completedBatches: {}, // { [tableKey]: numberOfCommittedBatches }
    completedTables: {},
    phasesDone: {},
    createdAt: new Date().toISOString(),
  };

  if (!resume) saveCheckpointAtomic(cpFile, checkpoint);

  const phaseSet = only ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean)) : new Set(ALL_PHASES);

  async function runTableBatches({ tableKey, pool, table, columns, batchIterable, setCompatWriter = false, conflictTarget = '("id")', keyMode = "id" }) {
    if (checkpoint.completedTables[tableKey] && resume) {
      log(`[scale] skip completed ${tableKey}`);
      return { rows: 0, skipped: true };
    }
    const alreadyDoneBatches = resume ? (checkpoint.completedBatches[tableKey] ?? 0) : 0;
    let totalWritten = 0;
    let bIdx = 0;
    let lastReconciledBatch = null;

    for (const batch of batchIterable) {
      if (bIdx < alreadyDoneBatches) {
        if (bIdx === alreadyDoneBatches - 1) lastReconciledBatch = batch;
        bIdx++;
        continue;
      }
      if (lastReconciledBatch) {
        // Re-verify last checkpointed batch before continuing (v2.2 / C6 #4)
        await reconcileBatchCounts({ pool, table, rows: lastReconciledBatch, batchIndex: alreadyDoneBatches - 1, keyMode });
        lastReconciledBatch = null;
      }
      const res = await writeBatchWithReconciliation({
        pool,
        table,
        columns,
        rows: batch,
        batchIndex: bIdx,
        setCompatWriter,
        conflictTarget,
        keyMode,
      });
      totalWritten += res.actual;
      bIdx++;
      checkpoint.completedBatches[tableKey] = bIdx;
      saveCheckpointAtomic(cpFile, checkpoint);
      tracker.sampleMemory();
    }

    // Also reconcile tail batch on resume when table finished last batch right before interruption
    if (lastReconciledBatch) {
      await reconcileBatchCounts({ pool, table, rows: lastReconciledBatch, batchIndex: alreadyDoneBatches - 1, keyMode });
    }
    checkpoint.completedTables[tableKey] = true;
    saveCheckpointAtomic(cpFile, checkpoint);
    return { rows: totalWritten, batches: bIdx };
  }

  // 1. Auth DB
  if (phaseSet.has("auth") && !(resume && checkpoint.phasesDone.auth)) {
    const authDone = resume && checkpoint.completedTables["auth.users"];
    let bulkHash = null;
    let demoHashes = new Map();
    if (!authDone) {
      const pwOut = await prepareScalePasswords({
        demoSpecs: universe.demoAuthSpecs,
        demoOutPath: demoAccountsPathFor(runtimeDir),
      });
      bulkHash = pwOut.bulkHash;
      demoHashes = pwOut.demoHashes;
    }
    await tracker.trackPhase("auth.users", async () =>
      runTableBatches({
        tableKey: "auth.users",
        pool: pools.auth,
        table: "users",
        columns: COLS.authUsers,
        batchIterable: authDone ? [] : universe.chunkIter(universe.buildAuthUserRows(bulkHash, demoHashes), batchSize),
      })
    );
    checkpoint.phasesDone.auth = true;
    saveCheckpointAtomic(cpFile, checkpoint);
  }

  // 2. Gym Core DB (brands -> partners [compat] -> partner_accounts -> gyms [compat] -> children)
  if (phaseSet.has("gym-core") && !(resume && checkpoint.phasesDone["gym-core"])) {
    const gData = universe.buildGymStaticTables();
    const steps = [
      ["gym.gym_brands", "gymBrands", "gym_brands", COLS.gymBrands, false, '("id")', "id"],
      ["gym.gym_partners", "gymPartners", "gym_partners", COLS.gymPartners, true, '("id")', "id"],
      ["gym.gym_partner_accounts", "gymPartnerAccounts", "gym_partner_accounts", COLS.gymPartnerAccounts, false, '("id")', "id"],
      ["gym.gyms", "gyms", "gyms", COLS.gyms, true, '("id")', "id"],
      ["gym.gym_operating_hours", "gymHours", "gym_operating_hours", COLS.gymHours, false, '("id")', "id"],
      ["gym.gym_amenities", "gymAmenities", "gym_amenities", COLS.gymAmenities, false, '("gym_id", "amenity_id")', "gym_amenities"],
      ["gym.gym_photos", "gymPhotos", "gym_photos", COLS.gymPhotos, false, '("id")', "id"],
      ["gym.gym_listing_revisions", "gymListingRevisions", "gym_listing_revisions", COLS.gymRevisions, false, '("id")', "id"],
      ["gym.gym_membership_plans", "gymPlans", "gym_membership_plans", COLS.gymPlans, false, '("id")', "id"],
      ["gym.gym_trainer_affiliations", "gymAffiliations", "gym_trainer_affiliations", COLS.gymAffiliations, false, '("id")', "id"],
      ["gym.gym_pt_collaborations", "gymCollabs", "gym_pt_collaborations", COLS.gymCollabs, false, '("id")', "id"],
    ];
    for (const [key, prop, table, cols, compat, conflict, keyMode] of steps) {
      await tracker.trackPhase(key, () =>
        runTableBatches({
          tableKey: key,
          pool: pools.gym,
          table,
          columns: cols,
          batchIterable: universe.chunkIter(gData[prop], batchSize),
          setCompatWriter: compat,
          conflictTarget: conflict,
          keyMode,
        })
      );
      gData[prop] = null;
    }
    checkpoint.phasesDone["gym-core"] = true;
    saveCheckpointAtomic(cpFile, checkpoint);
  }

  // 3. User Core DB (profiles -> PT entities -> InBody)
  if (phaseSet.has("user-core") && !(resume && checkpoint.phasesDone["user-core"])) {
    await tracker.trackPhase("user.user_profiles", () =>
      runTableBatches({
        tableKey: "user.user_profiles",
        pool: pools.user,
        table: "user_profiles",
        columns: COLS.userProfiles,
        batchIterable: universe.iterUserProfileBatches(batchSize),
      })
    );
    const uData = universe.buildUserStaticTables();
    const uSteps = [
      ["user.pt_applications", "ptApplications", "pt_applications", COLS.ptApplications],
      ["user.pt_application_certificates", "ptCerts", "pt_application_certificates", COLS.ptCerts],
      ["user.pt_terms_acceptances", "ptTerms", "pt_terms_acceptances", COLS.ptTerms],
      ["user.pt_training_locations", "ptLocations", "pt_training_locations", COLS.ptLocations],
      ["user.pt_service_packages", "ptPackages", "pt_service_packages", COLS.ptPackages],
      ["user.pt_availability", "ptAvailability", "pt_availability", COLS.ptAvailability],
      ["user.pt_physique_photos", "ptPhotos", "pt_physique_photos", COLS.ptPhotos],
      ["user.pt_listing_revisions", "ptListingRevisions", "pt_listing_revisions", COLS.ptRevisions],
      ["user.pt_restrictions", "ptRestrictions", "pt_restrictions", COLS.ptRestrictions],
    ];
    for (const [key, prop, table, cols] of uSteps) {
      await tracker.trackPhase(key, () =>
        runTableBatches({
          tableKey: key,
          pool: pools.user,
          table,
          columns: cols,
          batchIterable: universe.chunkIter(uData[prop], batchSize),
        })
      );
      uData[prop] = null;
    }
    await tracker.trackPhase("user.inbody_entries", () =>
      runTableBatches({
        tableKey: "user.inbody_entries",
        pool: pools.user,
        table: "inbody_entries",
        columns: COLS.inbody,
        batchIterable: universe.iterInbodyBatches(batchSize),
      })
    );
    checkpoint.phasesDone["user-core"] = true;
    saveCheckpointAtomic(cpFile, checkpoint);
  }

  // 4. Streaming PT Historical Contracts, Completed Sessions & Session Reviews
  if (phaseSet.has("contracts") && !(resume && checkpoint.phasesDone.contracts)) {
    await tracker.trackPhase("user.contracts", () =>
      runTableBatches({
        tableKey: "user.contracts",
        pool: pools.user,
        table: "contracts",
        columns: COLS.contracts,
        batchIterable: universe.iterContractBatches(batchSize),
      })
    );
    await tracker.trackPhase("user.sessions", () =>
      runTableBatches({
        tableKey: "user.sessions",
        pool: pools.user,
        table: "sessions",
        columns: COLS.sessions,
        batchIterable: universe.iterSessionBatches(batchSize),
      })
    );
    await tracker.trackPhase("user.session_reviews", () =>
      runTableBatches({
        tableKey: "user.session_reviews",
        pool: pools.user,
        table: "session_reviews",
        columns: COLS.sessionReviews,
        batchIterable: universe.iterSessionReviewBatches(batchSize),
      })
    );
    checkpoint.phasesDone.contracts = true;
    saveCheckpointAtomic(cpFile, checkpoint);
  }

  // 5. Streaming Gym EXPIRED Memberships, Check-ins & Reviews
  if (phaseSet.has("memberships") && !(resume && checkpoint.phasesDone.memberships)) {
    await tracker.trackPhase("gym.gym_membership_contracts", () =>
      runTableBatches({
        tableKey: "gym.gym_membership_contracts",
        pool: pools.gym,
        table: "gym_membership_contracts",
        columns: COLS.gymMemberships,
        batchIterable: universe.iterGymMembershipBatches(batchSize),
      })
    );
    await tracker.trackPhase("gym.gym_check_ins", () =>
      runTableBatches({
        tableKey: "gym.gym_check_ins",
        pool: pools.gym,
        table: "gym_check_ins",
        columns: COLS.gymCheckIns,
        batchIterable: universe.iterGymCheckInBatches(batchSize),
      })
    );
    await tracker.trackPhase("gym.gym_reviews", () =>
      runTableBatches({
        tableKey: "gym.gym_reviews",
        pool: pools.gym,
        table: "gym_reviews",
        columns: COLS.gymReviews,
        batchIterable: universe.iterGymReviewBatches(batchSize),
      })
    );
    checkpoint.phasesDone.memberships = true;
    saveCheckpointAtomic(cpFile, checkpoint);
  }

  // 6. Media (MinIO server-side CopyObject + local DiceBear avatars)
  let s3Clients = s3;
  if (!skipMedia && phaseSet.has("media") && !(resume && checkpoint.phasesDone.media)) {
    if (!s3Clients) s3Clients = createScaleS3Clients();
    await tracker.trackPhase("media.avatars", async () => {
      const av = await generateScaleAvatars({
        avatarPlans: universe.avatarPlans,
        outDir: avatarsDir,
        resume,
        log,
      });
      tracker.totals.avatarsWritten += av.written;
      return { rows: av.total };
    });
    await tracker.trackPhase("media.minio", async () => {
      const m = await syncMediaToMinio({
        ptPhotos: universe.mediaPlan.ptPhotos,
        gymPhotos: universe.mediaPlan.gymPhotos,
        s3: s3Clients,
        commands: s3Commands,
        resume,
        log,
      });
      tracker.totals.s3ObjectsCopied += m.copiedPt + m.copiedGym;
      return { rows: m.copiedPt + m.copiedGym };
    });
    checkpoint.phasesDone.media = true;
    saveCheckpointAtomic(cpFile, checkpoint);
  }

  // 7. Set-based C6 Verification
  let integrityResults = [];
  if (phaseSet.has("verify")) {
    const checkMedia = !skipMedia;
    if (checkMedia && !s3Clients) s3Clients = createScaleS3Clients();
    const { result } = await tracker.trackPhase("verify.c6", async () => {
      integrityResults = await runScaleIntegrity({
        pools,
        scaleFactor: counts.scaleFactor,
        checkMedia,
        avatarsDir,
        s3: checkMedia ? s3Clients : null,
        ListObjectsV2Command: s3Commands?.ListObjectsV2Command,
      });
      return { rows: integrityResults.reduce((s, r) => s + r.examined, 0) };
    });
  }

  const failedChecks = integrityResults.filter((r) => r.status === "FAIL" || r.status === "ERROR");
  const metrics = tracker.summary({
    structuralChecksum: universe.structuralChecksum,
    targetKind: target.kind,
    skipMedia,
    integrityPassed: failedChecks.length === 0,
  });

  const mFile = metricsPath ?? path.join(runtimeDir, "scale-metrics.json");
  const rFile = reportPath ?? path.join(runtimeDir, "scale-report.json");
  fs.mkdirSync(path.dirname(mFile), { recursive: true });
  fs.writeFileSync(mFile, JSON.stringify(metrics, null, 2));
  fs.writeFileSync(rFile, JSON.stringify({ metrics, integrityResults }, null, 2));

  if (failedChecks.length > 0) {
    throw new Error(`Scale integrity failed on ${failedChecks.length} check(s): ${failedChecks.map((f) => f.name).join("; ")}`);
  }

  log(`[scale] DONE factor=${counts.scaleFactor} elapsed=${metrics.totalElapsedMs}ms peakRss=${metrics.peakRssMb}MB`);
  return { metrics, integrityResults, universe };
}
