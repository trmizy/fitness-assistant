// Media planner (<=40 reuse cap, C7 topic/gender matching), MinIO server-side CopyObject executor, and local DiceBear avatar generator.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PHOTO_REUSE_CAP, SCALE_EPOCH } from "./config.mjs";
import { generateAvatarBuffer } from "../../generate-avatars.mjs";
import { manifest } from "../world/assets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedRoot = path.resolve(here, "..", "..");
const repoRoot = path.resolve(seedRoot, "..", "..");

export const DEFAULT_AVATARS_DIR = path.join(seedRoot, ".runtime", "scale-profile-photos");

/** Loads @aws-sdk/client-s3 directly from backend/services/user-service/node_modules without modifying package.json. */
export function loadAwsS3Sdk() {
  const sdkPath = path.join(repoRoot, "backend", "services", "user-service", "node_modules", "@aws-sdk", "client-s3");
  if (!fs.existsSync(sdkPath)) {
    throw new Error(`@aws-sdk/client-s3 not found at ${sdkPath}`);
  }
  const req = createRequire(import.meta.url);
  return req(sdkPath);
}

/** Reads isolated usable master pools from manifest.json without mutating world cursor state. */
export function loadUsableMasterPools() {
  const m = manifest();
  const ptMale = [];
  const ptFemale = [];
  const gymByCategory = new Map();

  for (const item of m.items) {
    if (item.audit?.status === "REJECTED") continue;
    if (item.kind === "physique") {
      if (item.audit?.gender === "MALE") ptMale.push(item);
      else if (item.audit?.gender === "FEMALE") ptFemale.push(item);
    } else if (item.kind === "gym") {
      const cat = item.audit?.reclassifiedCategory || item.category;
      let arr = gymByCategory.get(cat);
      if (!arr) gymByCategory.set(cat, (arr = []));
      arr.push(item);
    }
  }
  return { ptMale, ptFemale, gymByCategory };
}

export const GYM_PHOTO_CATEGORY_MAP = Object.freeze({
  exterior: "EXTERIOR",
  "gym-interior": "MAIN_TRAINING_AREA",
  "fitness-center": "MAIN_TRAINING_AREA",
  "free-weights": "EQUIPMENT",
  crossfit: "EQUIPMENT",
  functional: "EQUIPMENT",
  cardio: "CARDIO",
  "locker-room": "CHANGING_ROOM",
  pool: "AMENITIES",
  "yoga-studio": "AMENITIES",
  boxing: "EQUIPMENT",
  reception: "OTHER",
});

/**
 * O(1)-amortized round-robin picker respecting per-master reuse cap <= 40 & per-entity hash uniqueness.
 * Replaces O(N) full-pool filtering across 35,000+ photo placements.
 */
function makeFastPoolPicker(candidates, usageMap, cap, rng) {
  if (!candidates.length) return () => null;
  const order = [...candidates];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let cursor = Math.floor(rng() * order.length);
  return (usedHashes) => {
    const len = order.length;
    // Try up to len items in balanced round-robin order so every item stays evenly loaded under cap
    for (let step = 0; step < len; step++) {
      const idx = (cursor + step) % len;
      const item = order[idx];
      const u = usageMap.get(item.id) ?? 0;
      if (u < cap && !usedHashes.has(item.sha256)) {
        usageMap.set(item.id, u + 1);
        usedHashes.add(item.sha256);
        cursor = (idx + 1) % len;
        return item;
      }
    }
    return null;
  };
}

/**
 * Assigns PT physique photos & Gym listing photos respecting:
 *   - max reuse <= 40 profiles/branches per master image
 *   - strict PT gender matching (MALE/FEMALE) & preferred discipline affinity
 *   - C7 rules: pool photo only on SWIMMING_POOL gyms, yoga-studio only on YOGA_STUDIO, boxing only on FUNCTIONAL_TRAINING_AREA
 *   - zero duplicate content_hash per entity
 */
export function allocateMediaAssignments({ pts, gyms, pools = loadUsableMasterPools(), rng, cap = PHOTO_REUSE_CAP, didFn }) {
  const ptUsage = new Map();
  const gymUsage = new Map();
  const ptPhotos = [];
  const gymPhotos = [];

  // Pre-group PT photos by discipline hint to prioritize relevant photos before falling back to gender pool
  const filterSpecialty = (pool, term) =>
    pool.filter((i) => Array.isArray(i.audit?.disciplines) && i.audit.disciplines.some((d) => String(d).includes(term)));

  const ptMaleBoxing = filterSpecialty(pools.ptMale, "BOXING");
  const ptFemaleBoxing = filterSpecialty(pools.ptFemale, "BOXING");
  const ptMaleYoga = filterSpecialty(pools.ptMale, "YOGA");
  const ptFemaleYoga = filterSpecialty(pools.ptFemale, "YOGA");

  const pickPtMale = makeFastPoolPicker(pools.ptMale, ptUsage, cap, rng);
  const pickPtFemale = makeFastPoolPicker(pools.ptFemale, ptUsage, cap, rng);
  const pickPtMaleBox = makeFastPoolPicker(ptMaleBoxing, ptUsage, cap, rng);
  const pickPtFemaleBox = makeFastPoolPicker(ptFemaleBoxing, ptUsage, cap, rng);
  const pickPtMaleYoga = makeFastPoolPicker(ptMaleYoga, ptUsage, cap, rng);
  const pickPtFemaleYoga = makeFastPoolPicker(ptFemaleYoga, ptUsage, cap, rng);

  for (const pt of pts) {
    const canPublish = pt.hasPublishedListing;
    if (!canPublish) continue;

    // Every PT with a published listing gets >= 1 photo (production-like coverage; decision Ngài 12/11):
    // 30%: 1, 30%: 2, 24%: 3, 10%: 4, 6%: 5 -> avg 2.32 photos/PT. Same single rng() draw per PT as before.
    const r = rng();
    const count = r < 0.3 ? 1 : r < 0.6 ? 2 : r < 0.84 ? 3 : r < 0.94 ? 4 : 5;

    const pickBase = pt.gender === "FEMALE" ? pickPtFemale : pickPtMale;
    const pickBox = pt.specialties.includes("Boxing & MMA") ? (pt.gender === "FEMALE" ? pickPtFemaleBox : pickPtMaleBox) : null;
    const pickYoga = pt.specialties.includes("Yoga") ? (pt.gender === "FEMALE" ? pickPtFemaleYoga : pickPtMaleYoga) : null;

    const usedHashes = new Set();
    for (let i = 0; i < count; i++) {
      let master = null;
      if (i === 0 && pickBox) master = pickBox(usedHashes);
      if (!master && i === 0 && pickYoga) master = pickYoga(usedHashes);
      if (!master) master = pickBase(usedHashes);
      if (!master) {
        throw new Error(`PT master photo pool exhausted under cap=${cap} for gender=${pt.gender}`);
      }
      const photoId = didFn("pt-photo", pt.userId, i);
      ptPhotos.push({
        id: photoId,
        ptUserId: pt.userId,
        masterId: master.id,
        masterFile: master.file,
        storageKey: `pt-physique/${pt.userId}/${photoId}.webp`,
        status: "PUBLISHED",
        sortOrder: i,
        isCover: i === 0,
        mime: "image/webp",
        bytes: master.bytes,
        contentHash: master.sha256,
        uploadedBy: pt.userId,
        createdAt: pt.createdAt,
      });
    }
  }

  // General gym categories (always safe for any branch)
  const generalGymCats = ["gym-interior", "fitness-center", "free-weights", "cardio", "crossfit", "functional", "exterior", "locker-room", "reception"];
  const generalGymItems = generalGymCats.flatMap((c) => pools.gymByCategory.get(c) ?? []);
  const heroCats = ["gym-interior", "fitness-center", "free-weights", "functional", "exterior"];
  const heroGymItems = heroCats.flatMap((c) => pools.gymByCategory.get(c) ?? []);

  const pickHeroGym = makeFastPoolPicker(heroGymItems, gymUsage, cap, rng);
  const pickGeneralGym = makeFastPoolPicker(generalGymItems, gymUsage, cap, rng);
  const pickPoolGym = makeFastPoolPicker(pools.gymByCategory.get("pool") ?? [], gymUsage, cap, rng);
  const pickYogaGym = makeFastPoolPicker(pools.gymByCategory.get("yoga-studio") ?? [], gymUsage, cap, rng);
  const pickBoxingGym = makeFastPoolPicker(pools.gymByCategory.get("boxing") ?? [], gymUsage, cap, rng);

  for (const gym of gyms) {
    // DRAFT gets STAGED photos only (0 PUBLISHED); PENDING/REJECTED stay STAGED; APPROVED/SUSPENDED are PUBLISHED
    const isPublished = gym.status === "APPROVED" || gym.status === "SUSPENDED";
    const count = gym.status === "DRAFT" ? (rng() < 0.5 ? 0 : 1) : 3 + Math.floor(rng() * 5); // avg ~5.0
    if (count === 0) continue;

    const facSet = new Set(gym.facilities);
    const hasPool = facSet.has("SWIMMING_POOL");
    const hasYoga = facSet.has("YOGA_STUDIO");
    const hasBoxing = facSet.has("FUNCTIONAL_TRAINING_AREA");

    const usedHashes = new Set();
    for (let i = 0; i < count; i++) {
      let master = null;
      if (i === 0) {
        master = pickHeroGym(usedHashes);
      } else if (i === 1 && hasPool && rng() < 0.75) {
        master = pickPoolGym(usedHashes);
      } else if (i === 1 && hasYoga && rng() < 0.55) {
        master = pickYogaGym(usedHashes);
      } else if (i === 2 && hasBoxing && rng() < 0.45) {
        master = pickBoxingGym(usedHashes);
      }
      if (!master) {
        master = pickGeneralGym(usedHashes);
      }
      if (!master) {
        throw new Error(`Gym master photo pool exhausted under cap=${cap}`);
      }
      const effCat = master.audit?.reclassifiedCategory || master.category;
      const photoId = didFn("gym-photo", gym.id, i);
      gymPhotos.push({
        id: photoId,
        gymId: gym.id,
        ownerId: gym.ownerId,
        masterId: master.id,
        masterFile: master.file,
        fileName: `${photoId}.webp`,
        s3Key: `listing-photos/${gym.id}/${photoId}.webp`,
        sortOrder: i,
        isCover: isPublished && i === 0,
        category: GYM_PHOTO_CATEGORY_MAP[effCat] || "OTHER",
        visibility: isPublished ? "PUBLIC" : "PRIVATE",
        status: isPublished ? "PUBLISHED" : "STAGED",
        contentHash: master.sha256,
        uploadedBy: gym.ownerId,
        createdAt: gym.createdAt ?? SCALE_EPOCH,
      });
    }
  }

  return {
    ptPhotos,
    gymPhotos,
    ptMasterIdsUsed: [...ptUsage.keys()],
    gymMasterIdsUsed: [...gymUsage.keys()],
    maxPtReuse: Math.max(0, ...ptUsage.values()),
    maxGymReuse: Math.max(0, ...gymUsage.values()),
  };
}

/** Runs async worker tasks with bounded concurrency. */
async function mapPool(items, concurrency, worker) {
  let idx = 0;
  const n = Math.min(concurrency, items.length);
  const runners = Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
}

/** Generates deterministic 256x256 WebP avatars to local disk (uploads/profile-photos). */
export async function generateScaleAvatars({ avatarPlans, outDir = DEFAULT_AVATARS_DIR, concurrency = 16, resume = false, log = () => {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  let written = 0;
  let skipped = 0;

  await mapPool(avatarPlans, concurrency, async (plan) => {
    const filePath = path.join(outDir, plan.fileName);
    if (resume && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      skipped++;
      return;
    }
    const buf = await generateAvatarBuffer(plan.userId, { size: 256 });
    await fs.promises.writeFile(filePath, buf);
    written++;
  });

  log(`[avatars] dir=${outDir} written=${written} skipped=${skipped} total=${avatarPlans.length}`);
  return { written, skipped, total: avatarPlans.length, outDir };
}

/** Checks 100% of planned avatar files exist on disk and are non-empty. */
export function verifyLocalAvatars(avatarPlans, outDir = DEFAULT_AVATARS_DIR) {
  const missing = [];
  for (const plan of avatarPlans) {
    const p = path.join(outDir, plan.fileName);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) missing.push(plan.photoUrl);
  }
  return { examined: avatarPlans.length, missing };
}

export function createScaleS3Clients(env = process.env) {
  const { S3Client } = loadAwsS3Sdk();
  const endpoint = env.SEED_MINIO_ENDPOINT || env.PT_MEDIA_S3_ENDPOINT || "http://127.0.0.1:59000";
  const region = env.SEED_MINIO_REGION || "us-east-1";
  const credentials = {
    accessKeyId: env.SEED_MINIO_ACCESS_KEY || env.PT_MEDIA_S3_ACCESS_KEY_ID || "scale_minio",
    secretAccessKey: env.SEED_MINIO_SECRET_KEY || env.PT_MEDIA_S3_SECRET_ACCESS_KEY || "scale_minio_secret_isolated",
  };
  const client = new S3Client({ endpoint, region, forcePathStyle: true, credentials });
  return {
    ptClient: client,
    gymClient: client,
    ptBucket: env.PT_MEDIA_S3_BUCKET || "gymini-user-media",
    gymBucket: env.PARTNER_S3_PRIVATE_BUCKET || "gymini-partner-private",
  };
}

async function listKeysByPrefix(s3Client, ListObjectsV2Command, bucket, prefix) {
  const keys = new Set();
  let ContinuationToken;
  do {
    const out = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }));
    for (const obj of out.Contents ?? []) if (obj.Key) keys.add(obj.Key);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

/**
 * Uploads each master image ONCE, then executes server-side CopyObject inside MinIO
 * to every PT / Gym storage key. Supports resume and injected S3 commands for unit testing.
 */
export async function syncMediaToMinio({
  ptPhotos,
  gymPhotos,
  s3,
  commands,
  assetsDir = path.join(seedRoot, "assets"),
  masterPrefix = "_seed-masters",
  concurrency = 32,
  resume = false,
  log = () => {},
}) {
  const cmds = commands ?? loadAwsS3Sdk();
  const { PutObjectCommand, CopyObjectCommand, ListObjectsV2Command } = cmds;

  // Deduplicate master objects to upload
  const ptMasters = new Map();
  for (const p of ptPhotos) ptMasters.set(p.masterId, p.masterFile);
  const gymMasters = new Map();
  for (const g of gymPhotos) gymMasters.set(g.masterId, g.masterFile);

  const existingPtMasters = resume ? await listKeysByPrefix(s3.ptClient, ListObjectsV2Command, s3.ptBucket, `${masterPrefix}/pt/`) : new Set();
  const existingGymMasters = resume ? await listKeysByPrefix(s3.gymClient, ListObjectsV2Command, s3.gymBucket, `${masterPrefix}/gym/`) : new Set();

  let uploadedMasters = 0;
  await mapPool([...ptMasters.entries()], 16, async ([masterId, relFile]) => {
    const key = `${masterPrefix}/pt/${masterId}.webp`;
    if (existingPtMasters.has(key)) return;
    const body = await fs.promises.readFile(path.join(assetsDir, relFile));
    await s3.ptClient.send(new PutObjectCommand({ Bucket: s3.ptBucket, Key: key, Body: body, ContentType: "image/webp" }));
    uploadedMasters++;
  });

  await mapPool([...gymMasters.entries()], 16, async ([masterId, relFile]) => {
    const key = `${masterPrefix}/gym/${masterId}.webp`;
    if (existingGymMasters.has(key)) return;
    const body = await fs.promises.readFile(path.join(assetsDir, relFile));
    await s3.gymClient.send(new PutObjectCommand({ Bucket: s3.gymBucket, Key: key, Body: body, ContentType: "image/webp" }));
    uploadedMasters++;
  });

  const existingPtKeys = resume ? await listKeysByPrefix(s3.ptClient, ListObjectsV2Command, s3.ptBucket, "pt-physique/") : new Set();
  const existingGymKeys = resume ? await listKeysByPrefix(s3.gymClient, ListObjectsV2Command, s3.gymBucket, "listing-photos/") : new Set();

  let copiedPt = 0;
  let copiedGym = 0;
  let skipped = 0;

  await mapPool(ptPhotos, concurrency, async (p) => {
    if (existingPtKeys.has(p.storageKey)) { skipped++; return; }
    const sourceKey = `${masterPrefix}/pt/${p.masterId}.webp`;
    await s3.ptClient.send(
      new CopyObjectCommand({
        Bucket: s3.ptBucket,
        Key: p.storageKey,
        CopySource: `${s3.ptBucket}/${sourceKey}`,
        ContentType: "image/webp",
        MetadataDirective: "REPLACE",
      })
    );
    copiedPt++;
  });

  await mapPool(gymPhotos, concurrency, async (g) => {
    if (existingGymKeys.has(g.s3Key)) { skipped++; return; }
    const sourceKey = `${masterPrefix}/gym/${g.masterId}.webp`;
    await s3.gymClient.send(
      new CopyObjectCommand({
        Bucket: s3.gymBucket,
        Key: g.s3Key,
        CopySource: `${s3.gymBucket}/${sourceKey}`,
        ContentType: "image/webp",
        MetadataDirective: "REPLACE",
      })
    );
    copiedGym++;
  });

  log(`[minio] uploadedMasters=${uploadedMasters} copiedPt=${copiedPt} copiedGym=${copiedGym} skipped=${skipped}`);
  return { uploadedMasters, copiedPt, copiedGym, skipped };
}

/** Verifies via ListObjectsV2 that 100% of planned/DB PT & Gym media keys exist in MinIO. */
export async function verifyMinioMediaObjects({ ptStorageKeys, gymS3Keys, s3, ListObjectsV2Command }) {
  const listCmd = ListObjectsV2Command ?? loadAwsS3Sdk().ListObjectsV2Command;
  const ptPresent = ptStorageKeys.length ? await listKeysByPrefix(s3.ptClient, listCmd, s3.ptBucket, "pt-physique/") : new Set();
  const gymPresent = gymS3Keys.length ? await listKeysByPrefix(s3.gymClient, listCmd, s3.gymBucket, "listing-photos/") : new Set();

  const missingPt = ptStorageKeys.filter((k) => !ptPresent.has(k));
  const missingGym = gymS3Keys.filter((k) => !gymPresent.has(k));
  return {
    examined: ptStorageKeys.length + gymS3Keys.length,
    missingPtCount: missingPt.length,
    missingGymCount: missingGym.length,
    sampleMissing: [...missingPt.slice(0, 5), ...missingGym.slice(0, 5)],
  };
}
