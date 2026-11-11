// Deterministic chunk/stream generators for scale entities across auth, user, and gym DBs.
import {
  AMENITY_ID_BY_SLUG,
  BRAND_CORES,
  BRAND_PREFIXES,
  BRAND_SUFFIXES,
  DEMO_ADMIN_SPEC,
  DEMO_CUSTOMER_SPECS,
  DEMO_OWNER_SPECS,
  DEMO_PT_SPECS,
  GYM_REVIEW_OPENINGS,
  GYM_REVIEW_TAILS,
  OTHER_PT_BUCKETS,
  PT_TERMS_VERSION,
  REVIEW_DETAILS,
  REVIEW_OPENINGS,
  SCALE_EPOCH,
  SERVICE_MODE_WEIGHTS,
  SYSTEM_AMENITY_SLUGS,
  scaleDid,
  scaleEmail,
} from "./config.mjs";
import {
  BANKS,
  DIETS,
  EQUIPMENT,
  INJURIES,
  LANGUAGES,
  SPECIALTIES,
  TARGET_GROUPS,
  TRAINING_GOALS,
  YEARS_OF_EXPERIENCE,
} from "../world/constants.mjs";
import { isNaturalName } from "../names.mjs";
import { loadWardGeo, resetGeoSamplerCache } from "../geo-sampler.mjs";
import { allocateBranchesGeo, allocateOwnerBranchPlan, allocatePeopleLocations } from "./geo-allocator.mjs";
import { allocateMediaAssignments } from "./media.mjs";
import { computeStructuralChecksum, makeHelpers, normalizeVi, rngFrom, sha256, slugify } from "./rng.mjs";

const SURNAMES = [
  ["Nguyễn", 26], ["Trần", 12], ["Lê", 10], ["Phạm", 7], ["Hoàng", 4], ["Huỳnh", 4], ["Phan", 4], ["Vũ", 4], ["Võ", 4],
  ["Đặng", 3], ["Bùi", 3], ["Đỗ", 3], ["Hồ", 2], ["Ngô", 2], ["Dương", 2], ["Lý", 2], ["Đinh", 2], ["Trịnh", 2],
  ["Mai", 1.5], ["Lâm", 1.5], ["Tạ", 1.2], ["Cao", 1.2], ["Châu", 1.2], ["Kiều", 1.2], ["Tô", 1.2], ["Phùng", 1.2],
  ["Đoàn", 1.2], ["Quách", 1.2], ["Lương", 1.2], ["Thái", 1.2], ["Trương", 2], ["Diệp", 1], ["Vương", 1.2], ["Tống", 1.2],
  ["Khổng", 1], ["Hà", 1.5], ["Chu", 1.2], ["Nghiêm", 1], ["Mạc", 1], ["Quản", 1], ["Thân", 1], ["Doãn", 1], ["Tiêu", 1],
];
const MALE_MIDDLE = [
  "Văn", "Minh", "Quốc", "Hoàng", "Thanh", "Gia", "Đức", "Anh", "Tuấn", "Hữu", "Công", "Trọng", "Xuân", "Bảo", "Trường",
  "Thành", "Quang", "Nhật", "Đình", "Hải", "Huy", "Khắc", "Ngọc", "Việt", "Thế", "Tiến", "Phúc", "Tấn", "Mạnh", "Duy",
];
const FEMALE_MIDDLE = [
  "Thị", "Thu", "Ngọc", "Phương", "Khánh", "Bảo", "Thanh", "Mai", "Kim", "Hồng", "Diệu", "Quỳnh", "Thúy", "Hà", "Cẩm",
  "Tuyết", "Hoài", "Minh", "Gia", "Ánh", "Bích", "Mỹ", "Nhã", "Yến", "Tường", "Hải", "Lệ", "Xuân", "Trúc", "Vân",
];
const MALE_GIVEN = [
  "Khoa", "Nam", "Huy", "Quân", "Bảo", "Đạt", "Tuấn", "Hiếu", "Phúc", "Long", "Dũng", "Hùng", "Thành", "Cường", "Sơn",
  "Tài", "Trung", "Kiên", "Lộc", "Vinh", "Tâm", "Nghĩa", "Khải", "Minh", "Hải", "Phong", "Duy", "Thịnh", "Lâm", "Đăng",
  "Việt", "Toàn", "Bình", "Hưng", "Tú", "Quang", "Nhân", "Thắng", "Hoàng", "Khánh", "Tín", "Hậu", "Luân", "Nguyên",
  "Bách", "Đông", "Phát", "Sang", "Thiện", "Vũ", "Khang", "Tùng", "Chí", "Thái", "Triết", "Sỹ", "Khôi", "Dân", "Lợi",
  "Linh", "Tiến", "Tường", "Vỹ", "Ân", "Huân", "Dương", "Quý", "Hiệp", "Toại", "Kỳ", "Tân", "Kiệt",
];
const FEMALE_GIVEN = [
  "Linh", "Mai", "Trang", "Hân", "Thảo", "Hà", "Ngân", "Thư", "Uyên", "Vy", "My", "Nhi", "Quỳnh", "Lan", "Hương",
  "Phương", "Chi", "Anh", "Yến", "Trâm", "Ngọc", "Thủy", "Diệp", "Giang", "Hạnh", "Hiền", "Loan", "Oanh", "Thu",
  "Tiên", "Vân", "Xuân", "Dung", "Nhung", "Thanh", "Trinh", "Châu", "Khuê", "Lụa", "Như", "Hồng", "Hoa", "Ly", "Nga",
  "Phượng", "Tâm", "Thơm", "Tuyền", "Vi", "Yên", "Hằng", "Diễm", "Quyên", "Sương", "Trà", "Huyền", "Minh", "An", "Tuyết",
  "Nghi", "Cúc", "Đào", "Khuyên", "Kiều", "Mơ", "Nhàn", "Sen", "Thắm", "Việt", "Cẩm", "Băng", "Khanh",
];

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GOALS = ["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"];
const ACTIVITY_LEVELS = ["SEDENTARY", "LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE", "EXTREMELY_ACTIVE"];
const EXPERIENCE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const CERTS = [
  ["ACE Certified Personal Trainer", "American Council on Exercise"],
  ["NASM-CPT", "National Academy of Sports Medicine"],
  ["ISSA Certified Fitness Trainer", "International Sports Sciences Association"],
  ["ACSM Certified Exercise Physiologist", "ACSM"],
  ["Chứng chỉ HLV Thể hình Quốc gia", "Liên đoàn Cử tạ - Thể hình Việt Nam"],
  ["CrossFit Level 1 Trainer", "CrossFit"],
  ["RYT 200 Yoga Teacher", "Yoga Alliance"],
  ["Precision Nutrition Level 1", "Precision Nutrition"],
];

class ScaleNamePool {
  constructor(rng) {
    this.rng = rng;
    this.h = makeHelpers(rng);
    this.usedSlugs = new Set();
    this.usedNames = new Set();
    this.counter = 0;
  }
  uniqueSlug(full) {
    const base = slugify(full);
    let s = base;
    for (let i = 2; this.usedSlugs.has(s); i++) s = `${base}-${i}`;
    this.usedSlugs.add(s);
    return s;
  }
  nextPerson(gender, fixedSlug = null) {
    const g = gender ?? (this.rng() < 0.5 ? "MALE" : "FEMALE");
    const mPool = g === "MALE" ? MALE_MIDDLE : FEMALE_MIDDLE;
    const gPool = g === "MALE" ? MALE_GIVEN : FEMALE_GIVEN;
    let full = null;
    let firstName = "";
    let lastName = "";

    for (let attempt = 0; attempt < 60; attempt++) {
      const sur = this.h.weighted(SURNAMES);
      const mid = this.h.pick(mPool);
      const giv = this.h.pick(gPool);
      if (mid === giv) continue;
      const cand = `${sur} ${mid} ${giv}`;
      if (!this.usedNames.has(cand) && isNaturalName(cand)) {
        this.usedNames.add(cand);
        full = cand;
        firstName = sur;
        lastName = `${mid} ${giv}`;
        break;
      }
    }
    if (!full) {
      // Deterministic 4-word natural Vietnamese name when 3-word combinations fill up at >36k people
      const idx = this.counter++;
      const sur = SURNAMES[idx % SURNAMES.length][0];
      const m1 = mPool[Math.floor(idx / SURNAMES.length) % mPool.length];
      const m2 = mPool[Math.floor(idx / (SURNAMES.length * mPool.length)) % mPool.length];
      const giv = gPool[(idx * 7) % gPool.length];
      firstName = sur;
      lastName = m1 === m2 ? `${m1} ${giv}` : `${m1} ${m2} ${giv}`;
      full = `${firstName} ${lastName}`;
    }
    const slug = fixedSlug ?? this.uniqueSlug(full);
    this.usedSlugs.add(slug);
    return { full, firstName, lastName, gender: g, slug };
  }
}

const daysAgo = (days, extraHours = 0) => new Date(SCALE_EPOCH.getTime() - days * 86_400_000 + extraHours * 3_600_000);

function pickReviewComment(rng, idx) {
  if (rng() >= 0.40) return null;
  const op = REVIEW_OPENINGS[(idx * 13 + Math.floor(rng() * 15)) % REVIEW_OPENINGS.length];
  const det = REVIEW_DETAILS[(idx * 7 + Math.floor(rng() * 12)) % REVIEW_DETAILS.length];
  return `${op}, ${det}`;
}

function pickGymReviewComment(rng, idx) {
  if (rng() >= 0.45) return null;
  const op = GYM_REVIEW_OPENINGS[(idx * 11 + Math.floor(rng() * 10)) % GYM_REVIEW_OPENINGS.length];
  const tail = GYM_REVIEW_TAILS[(idx * 5 + Math.floor(rng() * 6)) % GYM_REVIEW_TAILS.length];
  return `${op}, ${tail}`;
}

function buildRatingSampler(rng, ptBaseScore) {
  // Plan C5.5: PT base quality 3.2-4.9, <=30% 5-star reviews globally, system average near upper bound (~4.25-4.30)
  const t = Math.min(1, Math.max(0, (ptBaseScore - 3.2) / 1.7));
  const p5 = Math.max(0.03, Math.min(0.42, 0.05 + 0.37 * Math.pow(t, 1.35)));
  const p1 = t < 0.25 ? 0.015 * (1 - t / 0.25) : 0.001;
  const p2 = Math.max(0.002, 0.025 * Math.pow(1 - t, 2));
  const p3 = Math.max(0.006, 0.14 * Math.pow(1 - t, 1.8));
  const c1 = p1;
  const c2 = c1 + p2;
  const c3 = c2 + p3;
  const c5Start = 1 - p5;
  return () => {
    const u = rng();
    if (u < c1) return 1;
    if (u < c2) return 2;
    if (u < c3) return 3;
    if (u >= c5Start) return 5;
    return 4;
  };
}

/**
 * Generates exact PT review counts across publicPts summing to targetTotalReviews:
 *   - 15% of PTs have 0 reviews
 *   - ~50th percentile (median) sits at ~8 reviews/PT (scaled proportionally if scaleFactor < 1)
 *   - top flagship PTs reach ~300 reviews (at scaleFactor = 1)
 */
function allocatePtReviewCounts(publicPts, targetTotalReviews, scaleFactor, rng) {
  const n = publicPts.length;
  const counts = Array(n).fill(0);
  const zeroCutoff = Math.round(n * 0.15);

  // Order indices deterministically (pin demo zero/top specs first, shuffle remaining)
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const zeroSet = new Set();
  const topSet = new Set();
  for (let i = 0; i < n; i++) {
    if (publicPts[i].demo?.forceZeroReviews) zeroSet.add(i);
    if (publicPts[i].demo?.topReviews) topSet.add(i);
  }
  const ordered = [
    ...order.filter((i) => zeroSet.has(i)),
    ...order.filter((i) => !zeroSet.has(i) && !topSet.has(i)),
    ...order.filter((i) => topSet.has(i)),
  ];

  const medVal = Math.max(2, Math.round(8 * (scaleFactor === 1 ? 1 : 0.7 + 0.3 * scaleFactor)));
  const maxCap = scaleFactor === 1 ? 305 : Math.max(20, Math.round(305 * Math.sqrt(scaleFactor)));

  const halfIdx = Math.floor(n * 0.5);
  let assigned = 0;
  // Bucket 1 [zeroCutoff .. halfIdx]: strictly in [1..medVal] with index halfIdx landing at medVal
  for (let rank = zeroCutoff; rank <= halfIdx; rank++) {
    const frac = (rank - zeroCutoff) / Math.max(1, halfIdx - zeroCutoff);
    const c = Math.max(1, Math.min(medVal, Math.round(1 + frac * (medVal - 1))));
    counts[ordered[rank]] = c;
    assigned += c;
  }

  // Bucket 2 [halfIdx+1 .. n-1]: heavy-tail curve from medVal up to ~maxCap summing to remaining reviews
  let rem = Math.max(0, targetTotalReviews - assigned);
  const topRanks = [];
  for (let rank = halfIdx + 1; rank < n; rank++) topRanks.push(rank);
  const baseSum = topRanks.length * medVal;

  if (rem < baseSum) {
    // Fallback proportional scale if small test factor has tight review budget
    for (let k = 0; k < topRanks.length; k++) {
      const share = Math.max(1, Math.floor(rem / topRanks.length));
      counts[ordered[topRanks[k]]] = share;
      rem -= share;
    }
    let idx = topRanks.length - 1;
    while (rem > 0 && idx >= 0) {
      counts[ordered[topRanks[idx]]] += 1;
      rem--;
      idx = idx === 0 ? topRanks.length - 1 : idx - 1;
    }
    return counts;
  }

  const rawWeights = topRanks.map((_, pos) => {
    const t = (pos + 1) / topRanks.length;
    return Math.pow(t, 22); // steep tail -> median ~8, top few PTs reach ~290-300
  });
  const wSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  let extraLeft = rem - baseSum;
  for (let pos = 0; pos < topRanks.length; pos++) {
    const extra = Math.min(maxCap - medVal, Math.floor((extraLeft * rawWeights[pos]) / wSum));
    counts[ordered[topRanks[pos]]] = medVal + extra;
  }
  let usedNow = counts.reduce((a, b) => a + b, 0);
  let diff = targetTotalReviews - usedNow;
  let cursor = topRanks.length - 1;
  while (diff > 0) {
    const ptIdx = ordered[topRanks[cursor]];
    if (counts[ptIdx] < maxCap) {
      counts[ptIdx]++;
      diff--;
    }
    cursor = cursor === 0 ? topRanks.length - 1 : cursor - 1;
  }
  while (diff < 0) {
    const ptIdx = ordered[topRanks[cursor]];
    if (counts[ptIdx] > medVal) {
      counts[ptIdx]--;
      diff++;
    }
    cursor = cursor === 0 ? topRanks.length - 1 : cursor - 1;
  }
  return counts;
}

/**
 * Builds the compact deterministic scale world skeleton & provides lazy chunk/stream emitters
 * so heavy child tables never bloat Node.js RSS above 1 GB.
 */
export function buildScaleUniverse({ counts, namespace = "gymini-scale-v1", masterPools }) {
  const rng = rngFrom(`${namespace}:root:${counts.scaleFactor}`);
  const h = makeHelpers(rng);
  let wardGeo = loadWardGeo();
  const names = new ScaleNamePool(rng);

  // 1. Admin + Customers + PTs + Owners identities
  const admin = {
    id: scaleDid(namespace, "admin"),
    email: scaleEmail(DEMO_ADMIN_SPEC.slug),
    firstName: DEMO_ADMIN_SPEC.firstName,
    lastName: DEMO_ADMIN_SPEC.lastName,
    role: "ADMIN",
    slug: DEMO_ADMIN_SPEC.slug,
    isDemo: true,
    note: "Scale Admin",
  };

  const custLocs = allocatePeopleLocations(counts.customers, DEMO_CUSTOMER_SPECS, wardGeo, rng, `${namespace}:cust`, false);
  const customers = Array.from({ length: counts.customers }, (_, i) => {
    const demo = DEMO_CUSTOMER_SPECS[i] ?? null;
    const person = names.nextPerson(demo?.gender ?? (i % 2 === 0 ? "MALE" : "FEMALE"), demo?.slug ?? null);
    const hasPhysical = demo ? demo.hasPhysical : rng() < counts.customerPhysicalShare;
    const age = 19 + Math.floor(rng() * 32);
    const heightCm = person.gender === "MALE" ? 164 + Math.floor(rng() * 19) : 153 + Math.floor(rng() * 16);
    const startW = Number((person.gender === "MALE" ? 60 + rng() * 32 : 47 + rng() * 22).toFixed(1));
    const goal = h.pick(GOALS);
    const targetW =
      goal === "WEIGHT_LOSS"
        ? Number((startW - 4 - rng() * 7).toFixed(1))
        : goal === "MUSCLE_GAIN"
          ? Number((startW + 3 + rng() * 5).toFixed(1))
          : startW;
    const createdAt = daysAgo(30 + Math.floor(rng() * 510));
    return {
      idx: i,
      userId: scaleDid(namespace, "cust-user", i),
      profileId: scaleDid(namespace, "cust-prof", i),
      email: scaleEmail(person.slug),
      firstName: person.firstName,
      lastName: person.lastName,
      gender: person.gender,
      slug: person.slug,
      isDemo: Boolean(demo),
      demoSpec: demo,
      hasPhysical,
      age,
      dob: new Date(Date.UTC(2026 - age, Math.floor(rng() * 12), 1 + Math.floor(rng() * 28))),
      heightCm,
      startingWeight: startW,
      currentWeight: Number(((startW + targetW) / 2).toFixed(1)),
      targetWeight: targetW,
      goal,
      activityLevel: h.pick(ACTIVITY_LEVELS),
      experienceLevel: h.pick(EXPERIENCE_LEVELS),
      dietaryPreference: h.pick(DIETS),
      loc: custLocs[i],
      referralCode: `SC${sha256(`${namespace}:ref:c:${i}`).slice(0, 8).toUpperCase()}`,
      createdAt,
    };
  });

  // 2. Owners + Brands + 2,500 Branches + Ward/Geo
  const ownerPlans = allocateOwnerBranchPlan(rng, counts);
  const { branchAssignmentsByOwner, branchGeoByKey, provQuotas } = allocateBranchesGeo(ownerPlans, counts, rng, wardGeo);
  const usedBrandNames = new Set();

  // Flatten branches first so we know exact non-public branch slice (8% = 200 branches at factor=1)
  const owners = [];
  const branches = [];
  for (let i = 0; i < ownerPlans.length; i++) {
    const plan = ownerPlans[i];
    const person = names.nextPerson(null, plan.demo?.slug ?? null);
    let brandName = `${h.pick(BRAND_PREFIXES)} ${h.pick(BRAND_CORES)} ${h.pick(BRAND_SUFFIXES)}`;
    while (usedBrandNames.has(brandName)) {
      brandName = `${h.pick(BRAND_PREFIXES)} ${h.pick(BRAND_CORES)} ${h.pick(BRAND_SUFFIXES)} ${i + 1}`;
    }
    usedBrandNames.add(brandName);

    const ownerId = scaleDid(namespace, "owner-user", i);
    const brandId = scaleDid(namespace, "brand", i);
    const partnerId = scaleDid(namespace, "partner", i);
    const accountId = scaleDid(namespace, "partner-acc", i);
    const bank = h.pick(BANKS);
    const ownerEmail = scaleEmail(person.slug);
    const createdAt = daysAgo(120 + Math.floor(rng() * 420));

    const ownerObj = {
      idx: i,
      userId: ownerId,
      brandId,
      partnerId,
      accountId,
      email: ownerEmail,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: person.full,
      kind: plan.kind,
      branchCount: plan.branchCount,
      brandName,
      legalName: `Công ty TNHH ${brandName}`,
      taxCode: `0${1 + (i % 9)}${String(10000000 + i * 7919).slice(0, 8)}`,
      phone: `09${String(10000000 + ((i * 9301 + 49297) % 89999999)).slice(0, 8)}`,
      bankName: bank[0],
      isDemo: Boolean(plan.demo),
      demoSpec: plan.demo,
      partnerStatus: "ACTIVE",
      createdAt,
      plans: [],
    };

    const planTotal = 2 + Math.floor(rng() * 3);
    for (let pIdx = 0; pIdx < planTotal; pIdx++) {
      const duration = [30, 90, 180, 365][pIdx % 4];
      const basePrice = duration === 30 ? 450_000 : duration === 90 ? 1_200_000 : duration === 180 ? 2_200_000 : 3_900_000;
      const tierMult = plan.kind === "large" ? 1.35 : plan.kind === "medium" ? 1.15 : 0.95;
      ownerObj.plans.push({
        id: scaleDid(namespace, "gym-plan", ownerId, pIdx),
        brandId,
        name: duration === 30 ? "Gói Hội Viên 1 Tháng" : duration === 90 ? "Gói Hội Viên 3 Tháng" : duration === 180 ? "Gói Tiêu Chuẩn 6 Tháng" : "Gói Đặc Quyền 12 Tháng",
        price: Math.round((basePrice * tierMult + Math.floor(rng() * 200_000)) / 10000) * 10000,
        durationDays: duration,
        visitLimit: pIdx === 0 && rng() < 0.35 ? 16 : null,
        status: pIdx === planTotal - 1 && rng() < 0.08 ? "INACTIVE" : "ACTIVE",
        createdAt,
      });
    }
    owners.push(ownerObj);

    const provCodes = branchAssignmentsByOwner.get(plan.ownerIdx) ?? [];
    for (let bIdx = 0; bIdx < provCodes.length; bIdx++) {
      const geo = branchGeoByKey.get(`${plan.ownerIdx}:${bIdx}`);
      const gymId = scaleDid(namespace, "gym", ownerId, bIdx);
      // Select 6-12 amenities deterministically, keeping SWIMMING_POOL (~20%) and YOGA_STUDIO (~38%) realistic
      const chosen = new Set(["FREE_WEIGHTS", "CARDIO_MACHINES", "AIR_CONDITIONING", "DRINKING_WATER", "WIFI", "LOCKER_ROOM"]);
      if (rng() < 0.48) chosen.add("FUNCTIONAL_TRAINING_AREA");
      if (rng() < 0.38) chosen.add("YOGA_STUDIO");
      if (rng() < 0.22) chosen.add("SWIMMING_POOL");
      for (const cand of SYSTEM_AMENITY_SLUGS) {
        if (chosen.size >= 11) break;
        if (cand !== "SWIMMING_POOL" && cand !== "YOGA_STUDIO" && rng() < 0.45) chosen.add(cand);
      }
      const facilities = [...chosen].sort();

      branches.push({
        idx: branches.length,
        id: gymId,
        ownerIdx: i,
        ownerId,
        brandId,
        name: plan.branchCount === 1 ? brandName : `${brandName} - ${geo.wardName.replace(/^(Phường|Xã|Thị trấn|Đặc khu)\s+/, "")}`,
        email: scaleEmail(`gym-${i}-${bIdx}`),
        phone: ownerObj.phone,
        geo,
        facilities,
        status: "APPROVED",
        operationalStatus: "OPEN",
        listingVersion: branches.length % 10 === 0 ? 2 : 1,
        hasRevisionRow: branches.length % 10 === 0,
        closureReason: null,
        isPublic: true,
        isDemoBranch: Boolean(plan.demo && bIdx === 0),
        createdAt,
      });
    }
  }

  // Assign 8% non-public/hidden gym statuses (preferring non-large-chain branches; hidden partners ONLY on standalone)
  const nonPublicTarget = counts.branches - counts.publicBranches;
  const hiddenQuota = Math.max(1, Math.round(nonPublicTarget * 0.1));
  const standaloneBranchIdxs = [];
  const otherBranchIdxs = [];
  for (const b of branches) {
    if (b.isDemoBranch) continue;
    if (owners[b.ownerIdx].kind === "standalone") standaloneBranchIdxs.push(b.idx);
    else otherBranchIdxs.push(b.idx);
  }
  const applyGymNonPublic = (branch, mode) => {
    branch.isPublic = false;
    if (mode === "HIDDEN_PARTNER") {
      owners[branch.ownerIdx].partnerStatus = rng() < 0.5 ? "SUSPENDED" : "TERMINATED";
      branch.status = "APPROVED";
      branch.operationalStatus = "OPEN";
    } else if (mode === "TEMPORARILY_CLOSED") {
      branch.status = "APPROVED";
      branch.operationalStatus = "TEMPORARILY_CLOSED";
      branch.closureReason = "Đang bảo trì và nâng cấp khu vực máy tập định kỳ.";
    } else if (mode === "PENDING_REVIEW") {
      branch.status = "PENDING_REVIEW";
      branch.listingVersion = 0;
      branch.hasRevisionRow = false;
    } else if (mode === "SUSPENDED") {
      branch.status = "SUSPENDED";
    } else if (mode === "DRAFT") {
      branch.status = "DRAFT";
      branch.listingVersion = 0;
      branch.hasRevisionRow = false;
    } else if (mode === "REJECTED") {
      branch.status = "REJECTED";
      branch.listingVersion = 0;
      branch.hasRevisionRow = false;
    }
  };

  let assignedNonPublic = 0;
  // Handle demo non-public owners first
  for (const o of owners) {
    if (o.demoSpec?.branchMode && o.demoSpec.branchMode !== "OPEN") {
      const b = branches.find((br) => br.ownerIdx === o.idx);
      if (b) { applyGymNonPublic(b, o.demoSpec.branchMode); assignedNonPublic++; }
    }
  }
  const nonPubModes = ["TEMPORARILY_CLOSED", "PENDING_REVIEW", "SUSPENDED", "DRAFT", "REJECTED"];
  let hiddenGiven = 0;
  for (const bIdx of standaloneBranchIdxs) {
    if (assignedNonPublic >= nonPublicTarget) break;
    if (hiddenGiven < hiddenQuota) {
      applyGymNonPublic(branches[bIdx], "HIDDEN_PARTNER");
      hiddenGiven++;
      assignedNonPublic++;
    } else {
      applyGymNonPublic(branches[bIdx], nonPubModes[assignedNonPublic % nonPubModes.length]);
      assignedNonPublic++;
    }
  }
  for (const bIdx of otherBranchIdxs) {
    if (assignedNonPublic >= nonPublicTarget) break;
    applyGymNonPublic(branches[bIdx], nonPubModes[assignedNonPublic % nonPubModes.length]);
    assignedNonPublic++;
  }

  const publicBranches = branches.filter((b) => b.isPublic);
  const publicBranchesByProv = new Map();
  for (const b of publicBranches) {
    let arr = publicBranchesByProv.get(b.geo.provinceCode);
    if (!arr) publicBranchesByProv.set(b.geo.provinceCode, (arr = []));
    arr.push(b);
  }

  // Free ~120MB wardGeo parse cache & closure ref immediately after PT/Customer/Branch placement finishes
  const totalPts = counts.publicPts + counts.otherPts;
  const ptLocs = allocatePeopleLocations(totalPts, DEMO_PT_SPECS, wardGeo, rng, `${namespace}:pt`, true);
  wardGeo = null;
  resetGeoSamplerCache();
  const pts = [];
  const demoPublicSpecs = DEMO_PT_SPECS.filter((d) => d.bucket === "PUBLIC");
  const demoOtherSpecs = DEMO_PT_SPECS.filter((d) => d.bucket !== "PUBLIC");

  for (let i = 0; i < totalPts; i++) {
    const isPublic = i < counts.publicPts;
    const demo = isPublic ? demoPublicSpecs[i] ?? null : demoOtherSpecs[i - counts.publicPts] ?? null;
    // Balanced 50/50 gender across both public and all PTs so FEMALE photo reuse <= 40 has comfortable headroom
    const gender = demo?.gender ?? (i % 2 === 0 ? "MALE" : "FEMALE");
    const person = names.nextPerson(gender, demo?.slug ?? null);
    const serviceMode = demo?.serviceMode ?? h.weighted(SERVICE_MODE_WEIGHTS);
    const bucket = isPublic ? "PUBLIC" : demo?.bucket ?? OTHER_PT_BUCKETS[(i - counts.publicPts) % OTHER_PT_BUCKETS.length];
    const isApproved = isPublic || ["SUSPENDED", "ACCOUNT_RESTRICTED", "NOT_ACCEPTING"].includes(bucket);
    const hasPublishedListing = isApproved; // includes public + suspended/restricted/not-accepting (their listing still carries photos, hidden by ptPublicWhere)
    const specList = h.sample(SPECIALTIES, 2 + Math.floor(rng() * 3));
    if (demo?.specialtyFocus && !specList.includes(demo.specialtyFocus)) specList[0] = demo.specialtyFocus;

    const ptUserId = scaleDid(namespace, "pt-user", i);
    const profileId = scaleDid(namespace, "pt-prof", i);
    const appId = scaleDid(namespace, "pt-app", i);
    const homeLoc = ptLocs[i];

    // Training locations: ONLY for OFFLINE / HYBRID (1-3 per PT, ~60% linked to a nearby public seed gym)
    const locations = [];
    const gymLinks = [];
    const seenGymIds = new Set();
    if (serviceMode !== "ONLINE" && (isPublic || isApproved)) {
      const rLoc = rng();
      const locCount = rLoc < 0.45 ? 1 : rLoc < 0.80 ? 2 : 3;
      const provGyms = publicBranchesByProv.get(homeLoc.provinceCode) ?? publicBranches;
      for (let k = 0; k < locCount; k++) {
        const useSeedGym = provGyms.length > 0 && rng() < 0.60;
        let gym = null;
        if (useSeedGym) {
          gym = provGyms[Math.floor(rng() * provGyms.length)];
        }
        locations.push({
          id: scaleDid(namespace, "pt-loc", ptUserId, k),
          ptUserId,
          provinceCode: gym ? gym.geo.provinceCode : homeLoc.provinceCode,
          wardCode: gym ? gym.geo.wardCode : homeLoc.wardCode,
          gymName: gym ? gym.name : `Phòng tập độc lập ${homeLoc.wardName}`,
          gymNameNormalized: normalizeVi(gym ? gym.name : `Phòng tập độc lập ${homeLoc.wardName}`),
          addressLine: gym ? gym.geo.address : homeLoc.addressLine,
          gymId: gym ? gym.id : null,
          isPrimary: k === 0,
          latitude: gym ? gym.geo.latitude : homeLoc.latitude,
          longitude: gym ? gym.geo.longitude : homeLoc.longitude,
        });
        if (gym && !seenGymIds.has(gym.id)) {
          seenGymIds.add(gym.id);
          gymLinks.push(gym);
        }
      }
    }

    // Service packages (~3.2/PT average -> ~32,000 rows): mode MUST match serviceMode; HYBRID gets both ONLINE and OFFLINE
    const packages = [];
    if (isApproved) {
      const sessPriceBase = (220 + Math.floor(rng() * 48) * 10) * 1000;
      const mkPkg = (idx, mode, countSessions, disc) => ({
        id: scaleDid(namespace, "pt-pkg", ptUserId, idx),
        ptUserId,
        name: countSessions === 1 ? `Buổi tập ${mode === "ONLINE" ? "Online" : "1:1"}` : `Gói ${countSessions} buổi ${mode === "ONLINE" ? "Online" : "Tại phòng"}`,
        description: `Chương trình huấn luyện cá nhân ${countSessions} buổi theo mục tiêu thể hình & sức khỏe.`,
        sessionCount: countSessions,
        price: Math.round((sessPriceBase * countSessions * disc) / 10000) * 10000,
        sessionMode: mode,
        durationMinutes: 60,
        validityDays: Math.max(30, countSessions * 7),
        isActive: idx < 4 && (idx <= 1 || rng() > 0.08),
      });
      if (serviceMode === "ONLINE") {
        packages.push(mkPkg(0, "ONLINE", 1, 1.0), mkPkg(1, "ONLINE", 8, 0.92));
        if (rng() < 0.70) packages.push(mkPkg(2, "ONLINE", 16, 0.85));
      } else if (serviceMode === "OFFLINE") {
        packages.push(mkPkg(0, "OFFLINE", 1, 1.0), mkPkg(1, "OFFLINE", 8, 0.92), mkPkg(2, "OFFLINE", 16, 0.85));
        if (rng() < 0.45) packages.push(mkPkg(3, "OFFLINE", 24, 0.80));
      } else {
        packages.push(
          mkPkg(0, "OFFLINE", 8, 0.92),
          mkPkg(1, "ONLINE", 8, 0.88),
          mkPkg(2, "OFFLINE", 16, 0.85)
        );
        if (rng() < 0.65) packages.push(mkPkg(3, "ONLINE", 1, 0.95));
      }
    }

    // Availability (~5.5 weekly slots/PT -> ~55,000 rows)
    const availSlots = [];
    if (isApproved) {
      const slotCount = rng() < 0.05 ? 0 : rng() < 0.15 ? 2 : rng() < 0.82 ? 5 + Math.floor(rng() * 2) : 7 + Math.floor(rng() * 3);
      for (let sIdx = 0; sIdx < slotCount; sIdx++) {
        const day = WEEKDAYS[sIdx % 7];
        const startH = 6 + ((sIdx * 3 + (i % 4)) % 12);
        const durH = 2 + (sIdx % 3);
        availSlots.push({
          id: scaleDid(namespace, "pt-avail", ptUserId, sIdx),
          ptUserId,
          dayOfWeek: day,
          startTime: `${String(startH).padStart(2, "0")}:00`,
          endTime: `${String(Math.min(22, startH + durH)).padStart(2, "0")}:00`,
        });
      }
    }

    const createdAt = daysAgo(45 + Math.floor(rng() * 500));
    const approvedAt = isApproved ? new Date(createdAt.getTime() + 2 * 86_400_000) : null;
    const baseRating = Number((3.2 + Math.pow(rng(), 0.46) * 1.7).toFixed(2)); // in [3.20, 4.90], mean ~4.36

    pts.push({
      idx: i,
      userId: ptUserId,
      profileId,
      appId,
      email: scaleEmail(person.slug),
      firstName: person.firstName,
      lastName: person.lastName,
      gender,
      slug: person.slug,
      isDemo: Boolean(demo),
      demoSpec: demo,
      isPublic,
      bucket,
      isApproved,
      hasPublishedListing,
      ptSuspended: bucket === "SUSPENDED",
      accountRestricted: bucket === "ACCOUNT_RESTRICTED",
      isAcceptingClients: bucket !== "NOT_ACCEPTING",
      appStatus: isApproved ? "APPROVED" : bucket,
      serviceMode,
      specialties: specList,
      languages: rng() < 0.35 ? ["Tiếng Việt", "English"] : ["Tiếng Việt"],
      yearsOfExperience: h.pick(YEARS_OF_EXPERIENCE),
      homeLoc,
      primaryGymId: gymLinks[0]?.id ?? null,
      locations,
      gymLinks,
      packages,
      availSlots,
      certs: CERTS.slice(i % 4, (i % 4) + 1 + (i % 2)),
      photoUrl: `/uploads/profile-photos/${ptUserId}.webp`,
      baseRating,
      createdAt,
      approvedAt,
    });
  }
  names.usedSlugs.clear();
  names.usedNames.clear();

  // Assign PT review counts strictly on public PTs
  const publicPtsList = pts.slice(0, counts.publicPts);
  const ptRevCounts = allocatePtReviewCounts(publicPtsList, counts.sessionReviews, counts.scaleFactor, rng);
  for (let i = 0; i < publicPtsList.length; i++) {
    publicPtsList[i].targetReviews = ptRevCounts[i];
  }
  for (let i = counts.publicPts; i < pts.length; i++) pts[i].targetReviews = 0;

  // 4. Media allocations (<= 40 reuse cap, gender-safe, topic-safe)
  const mediaPlan = allocateMediaAssignments({
    pts,
    gyms: branches,
    pools: masterPools,
    rng,
    didFn: (...parts) => scaleDid(namespace, ...parts),
  });

  // Avatars for ALL PTs + ALL Demo Customers (owners & bulk customers omit photo file to keep ~45 MB disk footprint)
  const avatarPlans = [];
  for (const pt of pts) {
    avatarPlans.push({ userId: pt.userId, fileName: `${pt.userId}.webp`, photoUrl: pt.photoUrl });
  }
  for (const c of customers) {
    if (c.isDemo) {
      c.photoUrl = `/uploads/profile-photos/${c.userId}.webp`;
      avatarPlans.push({ userId: c.userId, fileName: `${c.userId}.webp`, photoUrl: c.photoUrl });
    } else {
      c.photoUrl = null;
    }
  }

  // 5. Structural contract/session distribution plan across public PTs (SYNTHETIC, COMPLETED only!)
  // Ensures every PT with targetReviews > 0 gets enough COMPLETED sessions so session_reviews_session_id_key is 1:1.
  const ptContractPlans = [];
  const ptContractPlanByIdx = new Map();
  const contractsCountTarget = counts.ptContracts;
  let totalPlannedSessions = 0;
  let totalPlannedContracts = 0;

  for (const pt of publicPtsList) {
    const revN = pt.targetReviews;
    let ptSessNeed = revN > 0 ? revN + (rng() < 0.35 ? 1 : 0) : rng() < 0.2 ? 6 : 0;
    if (ptSessNeed === 0) continue;
    const avgPerContract = 8;
    const nC = Math.max(1, Math.round(ptSessNeed / avgPerContract));
    const perC = [];
    let leftS = ptSessNeed;
    for (let k = 0; k < nC; k++) {
      const sCount = k === nC - 1 ? leftS : Math.max(4, Math.min(12, Math.round(leftS / (nC - k))));
      perC.push(sCount);
      leftS -= sCount;
    }
    const planEntry = { ptIdx: pt.idx, sessionCounts: perC, reviewTarget: revN };
    ptContractPlans.push(planEntry);
    ptContractPlanByIdx.set(pt.idx, planEntry);
    totalPlannedContracts += perC.length;
    totalPlannedSessions += ptSessNeed;
  }
  // Top up contracts/sessions to match ~ptContracts & ~sessionsTarget evenly if needed
  let padIdx = 0;
  while (totalPlannedContracts < contractsCountTarget || totalPlannedSessions < counts.sessionsTarget) {
    const p = publicPtsList[(padIdx * 73) % publicPtsList.length];
    if (p.targetReviews === 0 && totalPlannedContracts >= contractsCountTarget) { padIdx++; continue; }
    const addSess = 8;
    const existing = ptContractPlanByIdx.get(p.idx);
    if (existing) existing.sessionCounts.push(addSess);
    else {
      const planEntry = { ptIdx: p.idx, sessionCounts: [addSess], reviewTarget: p.targetReviews };
      ptContractPlans.push(planEntry);
      ptContractPlanByIdx.set(p.idx, planEntry);
    }
    totalPlannedContracts++;
    totalPlannedSessions += addSess;
    padIdx++;
    if (padIdx > 200_000) break;
  }

  // Non-secret structural projection -> deterministic SHA-256 (excludes passwords, tokens, dynamic dates)
  const structuralChecksum = computeStructuralChecksum({
    namespace,
    counts,
    provQuotas: [...provQuotas.entries()],
    ownerSummary: owners.map((o) => [o.userId, o.kind, o.branchCount, o.partnerStatus]),
    branchSample: branches.slice(0, 120).map((b) => [b.id, b.geo.provinceCode, b.geo.wardCode, Number(b.geo.latitude.toFixed(6)), Number(b.geo.longitude.toFixed(6)), b.status]),
    ptSample: pts.slice(0, 120).map((p) => [p.userId, p.serviceMode, p.bucket, p.targetReviews]),
    mediaSummary: {
      ptPhotos: mediaPlan.ptPhotos.length,
      gymPhotos: mediaPlan.gymPhotos.length,
      maxPtReuse: mediaPlan.maxPtReuse,
      maxGymReuse: mediaPlan.maxGymReuse,
    },
    plannedContracts: totalPlannedContracts,
    plannedSessions: totalPlannedSessions,
  });

  // ---- Lazy Streaming Iterators (Batch-sized memory efficiency) ----
  const chunkIter = (rows, batchSize) => ({
    *[Symbol.iterator]() {
      for (let i = 0; i < rows.length; i += batchSize) yield rows.slice(i, i + batchSize);
    },
  });

  function buildAuthUserRows(bulkHash, demoHashes) {
    const rows = [
      {
        id: admin.id,
        email: admin.email,
        password: demoHashes.get(admin.email),
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: "ADMIN",
        isActive: true,
        must_change_password: false,
        createdAt: SCALE_EPOCH,
        updatedAt: SCALE_EPOCH,
      },
    ];
    for (const c of customers) {
      rows.push({
        id: c.userId,
        email: c.email,
        password: demoHashes.get(c.email) ?? bulkHash,
        firstName: c.firstName,
        lastName: c.lastName,
        role: "CUSTOMER",
        isActive: true,
        must_change_password: false,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      });
    }
    for (const p of pts) {
      rows.push({
        id: p.userId,
        email: p.email,
        password: demoHashes.get(p.email) ?? bulkHash,
        firstName: p.firstName,
        lastName: p.lastName,
        role: "PT",
        isActive: p.bucket !== "SUSPENDED",
        must_change_password: false,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
      });
    }
    for (const o of owners) {
      rows.push({
        id: o.userId,
        email: o.email,
        password: demoHashes.get(o.email) ?? bulkHash,
        firstName: o.firstName,
        lastName: o.lastName,
        role: "GYM_OWNER",
        isActive: o.partnerStatus === "ACTIVE",
        must_change_password: false,
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
      });
    }
    return rows;
  }

  function* iterUserProfileBatches(batchSize) {
    let buf = [];
    for (const c of customers) {
      buf.push({
        id: c.profileId,
        userId: c.userId,
        age: c.hasPhysical ? c.age : null,
        gender: c.gender,
        heightCm: c.hasPhysical ? c.heightCm : null,
        goal: c.hasPhysical ? c.goal : null,
        activityLevel: c.hasPhysical ? c.activityLevel : null,
        experienceLevel: c.hasPhysical ? c.experienceLevel : null,
        preferredTrainingDays: c.hasPhysical ? [1, 3, 5] : null,
        availableEquipment: c.hasPhysical ? EQUIPMENT.slice(0, 3) : null,
        injuries: c.hasPhysical && c.idx % 7 === 0 ? [INJURIES[c.idx % INJURIES.length]] : [],
        currentWeight: c.hasPhysical ? c.currentWeight : null,
        targetWeight: c.hasPhysical ? c.targetWeight : null,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
        isPT: false,
        session_duration_minutes: 60,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        competes_in_sport: false,
        has_completed_onboarding: c.hasPhysical,
        date_of_birth: c.dob,
        dietary_preference: c.hasPhysical ? c.dietaryPreference : null,
        first_name_normalized: normalizeVi(c.firstName),
        gym_id: null,
        is_accepting_clients: false,
        last_name_normalized: normalizeVi(c.lastName),
        not_accepting_reason: null,
        photo_url: c.photoUrl,
        pt_suspended: false,
        referral_code: c.referralCode,
        search_city: c.loc.provinceName,
        search_district: null,
        search_ward: c.loc.wardName,
        specialties: [],
        startingWeight: c.hasPhysical ? c.startingWeight : null,
        startingWeightSource: c.hasPhysical ? "ONBOARDING" : null,
        safety_screening_status: "CLEARED",
        safety_screening_flags: [],
        region: c.loc.provinceName,
        data_origin: "SYNTHETIC",
        pt_budget_vnd: 400_000,
        listing_version: 0,
        listing_published_at: null,
        search_province_code: c.loc.provinceCode,
        search_ward_code: c.loc.wardCode,
      });
      if (buf.length >= batchSize) { yield buf; buf = []; }
    }
    for (const p of pts) {
      buf.push({
        id: p.profileId,
        userId: p.userId,
        age: 23 + (p.idx % 16),
        gender: p.gender,
        heightCm: p.gender === "MALE" ? 172 + (p.idx % 12) : 160 + (p.idx % 10),
        goal: "ATHLETIC_PERFORMANCE",
        activityLevel: "VERY_ACTIVE",
        experienceLevel: "ADVANCED",
        preferredTrainingDays: [1, 2, 3, 4, 5, 6],
        availableEquipment: EQUIPMENT.slice(0, 5),
        injuries: [],
        currentWeight: p.gender === "MALE" ? 73 : 55,
        targetWeight: p.gender === "MALE" ? 74 : 54,
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
        isPT: true,
        session_duration_minutes: 60,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        competes_in_sport: p.idx % 5 === 0,
        has_completed_onboarding: true,
        date_of_birth: new Date(Date.UTC(1994 - (p.idx % 10), p.idx % 12, 10)),
        dietary_preference: "Ăn cân bằng",
        first_name_normalized: normalizeVi(p.firstName),
        gym_id: p.primaryGymId,
        is_accepting_clients: p.isAcceptingClients,
        last_name_normalized: normalizeVi(p.lastName),
        not_accepting_reason: p.isAcceptingClients ? null : "Đang tạm kín lịch học viên tháng này.",
        photo_url: p.photoUrl,
        pt_suspended: p.ptSuspended,
        referral_code: null,
        search_city: p.homeLoc.provinceName,
        search_district: null,
        search_ward: p.homeLoc.wardName,
        specialties: p.specialties,
        startingWeight: p.gender === "MALE" ? 72 : 55,
        startingWeightSource: "MANUAL",
        safety_screening_status: "CLEARED",
        safety_screening_flags: [],
        region: p.homeLoc.provinceName,
        data_origin: "SYNTHETIC",
        pt_budget_vnd: null,
        listing_version: p.hasPublishedListing ? 1 : 0,
        listing_published_at: p.approvedAt,
        search_province_code: p.homeLoc.provinceCode,
        search_ward_code: p.homeLoc.wardCode,
      });
      if (buf.length >= batchSize) { yield buf; buf = []; }
    }
    if (buf.length) yield buf;
  }

  function* iterInbodyBatches(batchSize) {
    let buf = [];
    for (const c of customers) {
      if (!c.hasPhysical) continue;
      const scans = 2 + (c.idx % 2);
      for (let k = 0; k < scans; k++) {
        const d = daysAgo(20 + k * 45 + (c.idx % 15));
        const w = Number((c.startingWeight + ((c.currentWeight - c.startingWeight) * (scans - k)) / scans).toFixed(1));
        const hM = c.heightCm / 100;
        const fatPct = c.gender === "MALE" ? 17.5 - k * 0.4 : 24.5 - k * 0.5;
        const bodyFat = Number(((w * fatPct) / 100).toFixed(1));
        const muscle = Number((w * (c.gender === "MALE" ? 0.43 : 0.36)).toFixed(1));
        buf.push({
          id: scaleDid(namespace, "inbody", c.userId, k),
          user_id: c.userId,
          date: d,
          date_only: d,
          weight: w,
          height: c.heightCm,
          bmi: Number((w / (hM * hM)).toFixed(1)),
          bmr: c.gender === "MALE" ? 1680 : 1380,
          body_fat: bodyFat,
          body_fat_pct: Number(fatPct.toFixed(1)),
          muscle_mass: muscle,
          visceral_fat: 6,
          status: "manual",
          created_at: d,
          updated_at: d,
        });
        if (buf.length >= batchSize) { yield buf; buf = []; }
      }
    }
    if (buf.length) yield buf;
  }

  function* iterContractBatches(batchSize) {
    let buf = [];
    for (const plan of ptContractPlans) {
      const pt = pts[plan.ptIdx];
      const pkg = pt.packages[0] ?? {
        id: null,
        name: "Gói tập cá nhân 8 buổi",
        price: 3_200_000,
        sessionMode: pt.serviceMode === "ONLINE" ? "ONLINE" : "OFFLINE",
      };
      for (let k = 0; k < plan.sessionCounts.length; k++) {
        const sCount = plan.sessionCounts[k];
        const cust = customers[(pt.idx * 97 + k * 31) % customers.length];
        const startOffsetDays = 30 + ((pt.idx * 17 + k * 53) % 500);
        const startDate = daysAgo(startOffsetDays);
        const endDate = daysAgo(Math.max(1, startOffsetDays - sCount * 3));
        const perSess = Math.round(Number(pkg.price) / Math.max(1, pkg.sessionCount ?? 8) / 1000) * 1000 || 350_000;
        buf.push({
          id: scaleDid(namespace, "pt-contract", pt.userId, k),
          pt_user_id: pt.userId,
          client_user_id: cust.userId,
          status: "COMPLETED",
          package_name: pkg.name,
          total_sessions: sCount,
          used_sessions: sCount,
          price: perSess * sCount,
          start_date: startDate,
          end_date: endDate,
          completed_at: endDate,
          created_at: startDate,
          updated_at: endDate,
          package_type: "PACKAGE",
          price_per_session: perSess,
          package_id: pkg.id,
          package_source_name: pkg.name,
          session_mode: pkg.sessionMode,
          session_duration_minutes: 60,
          gym_id: pt.primaryGymId,
          source: "INDEPENDENT",
          data_origin: "SYNTHETIC",
        });
        if (buf.length >= batchSize) { yield buf; buf = []; }
      }
    }
    if (buf.length) yield buf;
  }

  function* iterSessionBatches(batchSize) {
    let buf = [];
    for (const plan of ptContractPlans) {
      const pt = pts[plan.ptIdx];
      const mode = pt.serviceMode === "ONLINE" ? "ONLINE" : "OFFLINE";
      const locName = pt.locations[0]?.gymName ?? "Tập trực tuyến";
      for (let k = 0; k < plan.sessionCounts.length; k++) {
        const sCount = plan.sessionCounts[k];
        const cust = customers[(pt.idx * 97 + k * 31) % customers.length];
        const contractId = scaleDid(namespace, "pt-contract", pt.userId, k);
        const startOffsetDays = 30 + ((pt.idx * 17 + k * 53) % 500);
        for (let sIdx = 0; sIdx < sCount; sIdx++) {
          const dayOff = Math.max(1, startOffsetDays - sIdx * 3);
          const schedStart = daysAgo(dayOff, 8 + (sIdx % 10));
          const schedEnd = new Date(schedStart.getTime() + 3_600_000);
          buf.push({
            id: scaleDid(namespace, "pt-session", contractId, sIdx),
            contract_id: contractId,
            client_user_id: cust.userId,
            pt_user_id: pt.userId,
            status: "COMPLETED",
            session_mode: mode,
            scheduled_start_at: schedStart,
            scheduled_end_at: schedEnd,
            location: locName,
            session_deducted: true,
            completed_at: schedEnd,
            created_at: schedStart,
            updated_at: schedEnd,
          });
          if (buf.length >= batchSize) { yield buf; buf = []; }
        }
      }
    }
    if (buf.length) yield buf;
  }

  function* iterSessionReviewBatches(batchSize) {
    const revRng = rngFrom(`${namespace}:reviews`);
    let buf = [];
    let globalIdx = 0;
    for (const plan of ptContractPlans) {
      if (plan.reviewTarget <= 0) continue;
      const pt = pts[plan.ptIdx];
      const ratePick = buildRatingSampler(revRng, pt.baseRating);
      let left = plan.reviewTarget;

      for (let k = 0; k < plan.sessionCounts.length && left > 0; k++) {
        const sCount = plan.sessionCounts[k];
        const cust = customers[(pt.idx * 97 + k * 31) % customers.length];
        const contractId = scaleDid(namespace, "pt-contract", pt.userId, k);
        const startOffsetDays = 30 + ((pt.idx * 17 + k * 53) % 500);
        for (let sIdx = 0; sIdx < sCount && left > 0; sIdx++) {
          const dayOff = Math.max(1, startOffsetDays - sIdx * 3);
          const createdAt = daysAgo(Math.max(0, dayOff - 0.1), 11 + (sIdx % 8));
          const sessionId = scaleDid(namespace, "pt-session", contractId, sIdx);
          buf.push({
            id: scaleDid(namespace, "pt-rev", sessionId),
            session_id: sessionId,
            contract_id: contractId,
            client_user_id: cust.userId,
            rating: ratePick(),
            comment: pickReviewComment(revRng, globalIdx++),
            created_at: createdAt,
          });
          left--;
          if (buf.length >= batchSize) { yield buf; buf = []; }
        }
      }
    }
    if (buf.length) yield buf;
  }

  function* iterGymMembershipBatches(batchSize) {
    let buf = [];
    const activeEligible = branches.filter((b) => b.status === "APPROVED");
    // Reserve ~40k unique (gym_id, client_id) membership pairs cleanly so gym_reviews also maps cleanly <= 1/pair
    for (let mIdx = 0; mIdx < counts.gymMemberships; mIdx++) {
      const gym = activeEligible[mIdx % activeEligible.length];
      const owner = owners[gym.ownerIdx];
      const plan = owner.plans[mIdx % owner.plans.length];
      const custOffset = Math.floor(mIdx / activeEligible.length);
      const cust = customers[(gym.idx * 17 + custOffset * 23) % customers.length];
      const endDaysAgo = 5 + ((mIdx * 13) % 420);
      const startDate = daysAgo(endDaysAgo + plan.durationDays);
      const endDate = daysAgo(endDaysAgo);
      buf.push({
        id: scaleDid(namespace, "gym-mem", mIdx),
        gym_id: gym.id,
        plan_id: plan.id,
        client_id: cust.userId,
        status: "EXPIRED",
        start_date: startDate,
        end_date: endDate,
        price_at_purchase: plan.price,
        duration_days_snapshot: plan.durationDays,
        total_visits: plan.visitLimit,
        used_visits: plan.visitLimit ? Math.min(plan.visitLimit, 4 + (mIdx % 12)) : 8 + (mIdx % 15),
        data_origin: "SYNTHETIC",
        created_at: startDate,
        updated_at: endDate,
      });
      if (buf.length >= batchSize) { yield buf; buf = []; }
    }
    if (buf.length) yield buf;
  }

  function* iterGymCheckInBatches(batchSize) {
    let buf = [];
    const activeEligible = branches.filter((b) => b.status === "APPROVED");
    for (let mIdx = 0; mIdx < counts.gymMemberships; mIdx++) {
      const gym = activeEligible[mIdx % activeEligible.length];
      const owner = owners[gym.ownerIdx];
      const plan = owner.plans[mIdx % owner.plans.length];
      const custOffset = Math.floor(mIdx / activeEligible.length);
      const cust = customers[(gym.idx * 17 + custOffset * 23) % customers.length];
      const visitDate = daysAgo(6 + ((mIdx * 13) % 420));
      buf.push({
        id: scaleDid(namespace, "gym-ci", mIdx),
        membership_id: scaleDid(namespace, "gym-mem", mIdx),
        gym_id: gym.id,
        client_id: cust.userId,
        checked_in_by: owner.userId,
        source: "QR",
        created_at: visitDate,
      });
      if (buf.length >= batchSize) { yield buf; buf = []; }
    }
    if (buf.length) yield buf;
  }

  function* iterGymReviewBatches(batchSize) {
    const grRng = rngFrom(`${namespace}:gym-reviews`);
    let buf = [];
    const activeEligible = branches.filter((b) => b.status === "APPROVED");
    for (let rIdx = 0; rIdx < counts.gymReviews; rIdx++) {
      const gym = activeEligible[rIdx % activeEligible.length];
      const round = Math.floor(rIdx / activeEligible.length);
      // Step by round directly so gcd(1, N) === 1 for any customers.length
      const cust = customers[(gym.idx * 37 + round) % customers.length];
      const rating = Math.min(5, Math.max(1, Math.round(3.6 + grRng() * 1.4)));
      const createdAt = daysAgo(3 + Math.floor(grRng() * 520));
      buf.push({
        id: scaleDid(namespace, "gym-rev", gym.id, cust.userId),
        gym_id: gym.id,
        client_id: cust.userId,
        rating,
        comment: pickGymReviewComment(grRng, rIdx),
        data_origin: "SYNTHETIC",
        created_at: createdAt,
        updated_at: createdAt,
      });
      if (buf.length >= batchSize) { yield buf; buf = []; }
    }
    if (buf.length) yield buf;
  }

  const demoAuthSpecs = [
    admin,
    ...customers.filter((c) => c.isDemo).map((c) => ({ role: "CUSTOMER", slug: c.slug, email: c.email, note: c.hasPhysical ? "InBody+Profile" : "Minimal" })),
    ...pts.filter((p) => p.isDemo).map((p) => ({ role: "PT", slug: p.slug, email: p.email, note: `${p.bucket}/${p.serviceMode}` })),
    ...owners.filter((o) => o.isDemo).map((o) => ({ role: "GYM_OWNER", slug: o.email.split("@")[0], email: o.email, note: `${o.kind} (${o.branchCount} branches)` })),
  ];

  return {
    namespace,
    counts,
    structuralChecksum,
    admin,
    customers,
    pts,
    owners,
    branches,
    mediaPlan,
    avatarPlans,
    demoAuthSpecs,
    provQuotas,
    buildAuthUserRows,
    iterUserProfileBatches,
    iterInbodyBatches,
    iterContractBatches,
    iterSessionBatches,
    iterSessionReviewBatches,
    iterGymMembershipBatches,
    iterGymCheckInBatches,
    iterGymReviewBatches,
    chunkIter,
    buildUserStaticTables() {
      const ptApplications = [];
      const ptCerts = [];
      const ptTerms = [];
      const ptLocations = [];
      const ptPackages = [];
      const ptAvailability = [];
      const ptListingRevisions = [];
      const ptRestrictions = [];

      const ptPhotosByPtId = new Map();
      for (const ph of mediaPlan.ptPhotos) {
        let arr = ptPhotosByPtId.get(ph.ptUserId);
        if (!arr) ptPhotosByPtId.set(ph.ptUserId, (arr = []));
        arr.push(ph);
      }

      for (const p of pts) {
        ptApplications.push({
          id: p.appId,
          user_profile_id: p.profileId,
          status: p.appStatus,
          phone_number: `09${String(20000000 + ((p.idx * 7919) % 79999999)).slice(0, 8)}`,
          current_address: p.homeLoc.addressLine,
          years_of_experience: p.yearsOfExperience,
          education_background: "Cử nhân Giáo dục Thể chất & Khoa học Vận động",
          previous_work_experience: "Huấn luyện viên cá nhân tại câu lạc bộ thể hình",
          professional_bio: `Huấn luyện viên ${p.specialties.slice(0, 2).join(", ")} với định hướng giáo án cá nhân hóa, theo dõi chỉ số tiến bộ định kỳ và kỹ thuật an toàn.`,
          main_specialties: p.specialties,
          target_client_groups: TARGET_GROUPS.slice(p.idx % 4, (p.idx % 4) + 3),
          primary_training_goals: TRAINING_GOALS.slice(0, 3),
          training_methods_approach: "Progressive overload kết hợp phục hồi vận động.",
          service_mode: p.serviceMode,
          operating_areas: [p.homeLoc.provinceName],
          desired_session_price: 350_000,
          package_price: 2_600_000,
          sessions_per_package: 8,
          session_duration_minutes: 60,
          available_days: SHORT_DAYS.slice(0, 6),
          available_from: "06:00",
          available_until: "21:30",
          availability_blocks: p.availSlots.map((a) => ({ dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime })),
          gym_affiliation: p.gymLinks[0]?.name ?? null,
          online_price_per_session: p.serviceMode === "OFFLINE" ? null : 280_000,
          offline_price_per_session: p.serviceMode === "ONLINE" ? null : 380_000,
          online_package_price: p.serviceMode === "OFFLINE" ? null : 2_100_000,
          offline_package_price: p.serviceMode === "ONLINE" ? null : 2_800_000,
          application_training_locations: p.locations.map((l) => ({
            provinceCode: l.provinceCode,
            wardCode: l.wardCode,
            gymName: l.gymName,
            addressLine: l.addressLine,
          })),
          residence_address_line: p.homeLoc.addressLine,
          residence_province_code: p.homeLoc.provinceCode,
          residence_ward_code: p.homeLoc.wardCode,
          languages: p.languages,
          admin_note: p.bucket === "NEEDS_MORE_INFO" ? "Vui lòng bổ sung bản chụp chứng chỉ rõ nét." : null,
          rejection_reason: p.bucket === "REJECTED" ? "Hồ sơ chưa đáp ứng đủ thời lượng kinh nghiệm tối thiểu." : null,
          submitted_at: p.appStatus === "DRAFT" ? null : p.createdAt,
          reviewed_at: p.approvedAt ?? (p.appStatus === "REJECTED" || p.appStatus === "NEEDS_MORE_INFO" ? p.createdAt : null),
          approved_at: p.approvedAt,
          created_at: p.createdAt,
          updated_at: p.approvedAt ?? p.createdAt,
        });

        for (let cIdx = 0; cIdx < p.certs.length; cIdx++) {
          const [cName, org] = p.certs[cIdx];
          ptCerts.push({
            id: scaleDid(namespace, "pt-cert", p.userId, cIdx),
            application_id: p.appId,
            certificate_name: cName,
            issuing_organization: org,
            is_currently_valid: true,
            certification_status: "ACTIVE",
            issue_date: daysAgo(700),
            expiration_date: null,
            created_at: p.createdAt,
          });
        }

        if (p.appStatus !== "DRAFT") {
          ptTerms.push({
            id: scaleDid(namespace, "pt-terms", p.userId),
            user_id: p.userId,
            version: PT_TERMS_VERSION,
            source: "APPLICATION",
            accepted_at: p.createdAt,
          });
        }

        for (const loc of p.locations) {
          ptLocations.push({
            id: loc.id,
            pt_user_id: p.userId,
            province_code: loc.provinceCode,
            ward_code: loc.wardCode,
            gym_name: loc.gymName,
            gym_name_normalized: loc.gymNameNormalized,
            address_line: loc.addressLine,
            gym_id: loc.gymId,
            is_primary: loc.isPrimary,
            is_active: true,
            latitude: loc.latitude,
            longitude: loc.longitude,
            created_at: p.createdAt,
            updated_at: p.createdAt,
          });
        }

        for (const pkg of p.packages) {
          ptPackages.push({
            id: pkg.id,
            pt_user_id: p.userId,
            name: pkg.name,
            description: pkg.description,
            session_count: pkg.sessionCount,
            price: pkg.price,
            session_mode: pkg.sessionMode,
            session_duration_minutes: pkg.durationMinutes,
            validity_days: pkg.validityDays,
            is_active: pkg.isActive,
            created_at: p.createdAt,
            updated_at: p.createdAt,
            version: 1,
          });
        }

        for (const slot of p.availSlots) {
          ptAvailability.push({
            id: slot.id,
            pt_user_id: p.userId,
            day_of_week: slot.dayOfWeek,
            start_time: slot.startTime,
            end_time: slot.endTime,
            is_active: true,
            created_at: p.createdAt,
            updated_at: p.createdAt,
          });
        }

        if (p.hasPublishedListing) {
          const ptPhotosOfThis = ptPhotosByPtId.get(p.userId) ?? [];
          const photoIds = ptPhotosOfThis.map((ph) => ph.id);
          const coverPhotoId = ptPhotosOfThis.find((ph) => ph.isCover)?.id ?? null;
          ptListingRevisions.push({
            id: scaleDid(namespace, "pt-rev-lst", p.userId),
            pt_user_id: p.userId,
            status: "APPROVED",
            source: "OWNER",
            base_version: 0,
            draft_version: 1,
            payload: {
              profile: {
                professionalBio: `Huấn luyện viên ${p.specialties[0]}`,
                mainSpecialties: p.specialties,
                languages: p.languages,
              },
              packages: p.packages.map((k) => ({ id: k.id, name: k.name, price: k.price, sessionCount: k.sessionCount, sessionMode: k.sessionMode })),
              photoIds,
              coverPhotoId,
            },
            previous_snapshot: null,
            system_adjustments: [],
            submitted_by: p.userId,
            submitted_at: p.approvedAt,
            reviewed_by: admin.id,
            reviewed_at: p.approvedAt,
            created_at: p.approvedAt,
            updated_at: p.approvedAt,
          });
        }

        if (p.accountRestricted) {
          ptRestrictions.push({
            id: scaleDid(namespace, "pt-rest", p.userId),
            pt_user_id: p.userId,
            type: p.idx % 2 === 0 ? "TEMPORARY_SUSPENSION" : "PERMANENT_BAN",
            reason_category: "CONDUCT_REVIEW",
            reason_text: "Tài khoản đang trong diện rà soát quy trình vận hành scale.",
            public_reason: "Tài khoản tạm ngưng nhận học viên.",
            imposed_by: admin.id,
            started_at: p.createdAt,
            scope: "ACCOUNT",
            contract_id: null,
            created_at: p.createdAt,
            updated_at: p.createdAt,
          });
        }
      }

      const ptPhotos = mediaPlan.ptPhotos.map((ph) => ({
        id: ph.id,
        pt_user_id: ph.ptUserId,
        storage_key: ph.storageKey,
        status: ph.status,
        sort_order: ph.sortOrder,
        is_cover: ph.isCover,
        mime: ph.mime,
        bytes: ph.bytes,
        content_hash: ph.contentHash,
        uploaded_by: ph.uploadedBy,
        created_at: ph.createdAt,
      }));

      return {
        ptApplications,
        ptCerts,
        ptTerms,
        ptLocations,
        ptPackages,
        ptAvailability,
        ptPhotos,
        ptListingRevisions,
        ptRestrictions,
      };
    },

    buildGymStaticTables() {
      const gymBrands = [];
      const gymPartners = [];
      const gymPartnerAccounts = [];
      const gyms = [];
      const gymHours = [];
      const gymAmenities = [];
      const gymListingRevisions = [];
      const gymPlans = [];
      const gymAffiliations = [];
      const gymCollabs = [];

      for (const o of owners) {
        gymBrands.push({
          id: o.brandId,
          owner_id: o.userId,
          name: o.brandName,
          approved_name: o.brandName,
          description: `Hệ thống phòng tập ${o.brandName} với trang thiết bị đồng bộ và huấn luyện viên giàu kinh nghiệm.`,
          created_at: o.createdAt,
          updated_at: o.createdAt,
        });
        gymPartners.push({
          id: o.partnerId,
          legal_name: o.legalName,
          partner_kind: o.kind === "standalone" ? "INDIVIDUAL" : "BUSINESS",
          tax_code: o.taxCode,
          business_license_no: `GP-${o.taxCode}`,
          contact_email: o.email,
          contact_phone: o.phone,
          status: o.partnerStatus,
          brand_id: o.brandId,
          suspended_at: o.partnerStatus === "SUSPENDED" ? daysAgo(15) : null,
          suspended_reason: o.partnerStatus === "SUSPENDED" ? "Tạm ngưng kiểm tra hồ sơ đối tác scale." : null,
          terminated_at: o.partnerStatus === "TERMINATED" ? daysAgo(10) : null,
          termination_reason: o.partnerStatus === "TERMINATED" ? "Đối tác ngưng hợp tác trên môi trường kiểm thử." : null,
          expected_branch_count: o.branchCount,
          terms_accepted_version: "2026-09-v1",
          terms_accepted_at: o.createdAt,
          verification_status: "VERIFIED",
          verified_at: o.createdAt,
          verified_by: admin.id,
          source: "SELF_SERVICE",
          representative_name: o.fullName,
          representative_role: "GYM_OWNER",
          business_scale: o.branchCount > 1 ? "MULTIPLE_BRANCHES" : "ONE_BRANCH",
          application_flow_version: 2,
          created_at: o.createdAt,
          updated_at: o.createdAt,
        });
        gymPartnerAccounts.push({
          id: o.accountId,
          partner_id: o.partnerId,
          user_id: o.userId,
          role: "OWNER",
          status: "ACTIVE",
          invited_at: o.createdAt,
          activated_at: o.createdAt,
          onboarding_completed_at: o.createdAt,
          contact_phone: o.phone,
          created_at: o.createdAt,
          updated_at: o.createdAt,
        });
        for (const p of o.plans) {
          gymPlans.push({
            id: p.id,
            brand_id: p.brandId,
            name: p.name,
            description: `Gói hội viên ${p.name} áp dụng tại toàn hệ thống ${o.brandName}.`,
            price: p.price,
            duration_days: p.durationDays,
            visit_limit: p.visitLimit,
            status: p.status,
            created_at: p.createdAt,
            updated_at: p.createdAt,
          });
        }
      }

      const gymPhotosByGymId = new Map();
      for (const ph of mediaPlan.gymPhotos) {
        let arr = gymPhotosByGymId.get(ph.gymId);
        if (!arr) gymPhotosByGymId.set(ph.gymId, (arr = []));
        arr.push(ph);
      }

      for (const b of branches) {
        const isPub = b.status === "APPROVED";
        gyms.push({
          id: b.id,
          owner_id: b.ownerId,
          name: b.name,
          approved_name: isPub ? b.name : null,
          description: `Chi nhánh ${b.name} phục vụ tập luyện sức mạnh, cardio và huấn luyện cá nhân.`,
          address: b.geo.address,
          approved_address: isPub ? b.geo.address : null,
          city: b.geo.provinceName,
          phone: b.phone,
          email: b.email,
          status: b.status,
          brand_id: b.brandId,
          operational_status: b.operationalStatus,
          closure_reason: b.closureReason,
          expected_reopen_at: b.operationalStatus === "TEMPORARILY_CLOSED" ? new Date(SCALE_EPOCH.getTime() + 14 * 86_400_000) : null,
          province_code: b.geo.provinceCode,
          ward_code: b.geo.wardCode,
          latitude: b.geo.latitude,
          longitude: b.geo.longitude,
          facilities: b.facilities,
          listing_version: b.listingVersion,
          listing_published_at: isPub ? b.createdAt : null,
          created_flow_version: 2,
          created_at: b.createdAt,
          updated_at: b.createdAt,
        });

        for (const day of WEEKDAYS) {
          gymHours.push({
            id: scaleDid(namespace, "gym-hr", b.id, day),
            gym_id: b.id,
            day,
            type: "OPEN",
            open_minute: day === "SUNDAY" ? 420 : 330,
            close_minute: day === "SUNDAY" ? 1260 : 1350,
            created_at: b.createdAt,
            updated_at: b.createdAt,
          });
        }

        for (const slug of b.facilities) {
          gymAmenities.push({
            gym_id: b.id,
            amenity_id: AMENITY_ID_BY_SLUG[slug],
            created_at: b.createdAt,
          });
        }

        if (b.hasRevisionRow) {
          const phOfB = gymPhotosByGymId.get(b.id) ?? [];
          gymListingRevisions.push({
            id: scaleDid(namespace, "gym-rev-lst", b.id),
            gym_id: b.id,
            status: "APPROVED",
            source: "OWNER",
            base_version: 1,
            draft_version: 1,
            payload: {
              description: `Chi nhánh ${b.name} đã hoàn tất cập nhật tin đăng chuẩn.`,
              amenityIds: b.facilities.map((s) => AMENITY_ID_BY_SLUG[s]),
              proposalIds: [],
              photoIds: phOfB.map((ph) => ph.id),
              coverPhotoId: phOfB.find((ph) => ph.isCover)?.id ?? null,
            },
            previous_snapshot: null,
            submitted_by: b.ownerId,
            submitted_at: b.createdAt,
            reviewed_by: admin.id,
            reviewed_at: b.createdAt,
            created_at: b.createdAt,
            updated_at: b.createdAt,
          });
        }
      }

      const gymPhotos = mediaPlan.gymPhotos.map((ph) => ({
        id: ph.id,
        gym_id: ph.gymId,
        file_name: ph.fileName,
        sort_order: ph.sortOrder,
        is_cover: ph.isCover,
        s3_key: ph.s3Key,
        category: ph.category,
        visibility: ph.visibility,
        status: ph.status,
        content_hash: ph.contentHash,
        uploaded_by: ph.uploadedBy,
        created_at: ph.createdAt,
      }));

      // Deduplicated (gym_id, pt_id) collaborations & affiliations from PT training locations (~8,000)
      const seenPair = new Set();
      const ptPhotosByPtId = new Map();
      for (const ph of mediaPlan.ptPhotos) {
        let arr = ptPhotosByPtId.get(ph.ptUserId);
        if (!arr) ptPhotosByPtId.set(ph.ptUserId, (arr = []));
        arr.push(ph);
      }

      for (const p of pts) {
        for (const g of p.gymLinks) {
          const key = `${g.id}:${p.userId}`;
          if (seenPair.has(key)) continue;
          seenPair.add(key);
          gymAffiliations.push({
            id: scaleDid(namespace, "gym-aff", g.id, p.userId),
            gym_id: g.id,
            pt_id: p.userId,
            status: "ACTIVE",
            employment_type: "PARTNER",
            visibility: "PUBLIC",
            joined_at: p.createdAt,
            created_at: p.createdAt,
            updated_at: p.createdAt,
          });
          gymCollabs.push({
            id: scaleDid(namespace, "gym-col", g.id, p.userId),
            gym_id: g.id,
            pt_user_id: p.userId,
            proposed_pt_rate: 0.70,
            proposed_gym_rate: 0.20,
            platform_rate: 0.10,
            status: "ACCEPTED",
            proposed_by: "PT",
            round: 1,
            expires_at: new Date(SCALE_EPOCH.getTime() + 180 * 86_400_000),
            accepted_at: p.createdAt,
            effective_at: p.createdAt,
            created_at: p.createdAt,
            updated_at: p.createdAt,
          });
        }
      }

      return {
        gymBrands,
        gymPartners,
        gymPartnerAccounts,
        gyms,
        gymHours,
        gymAmenities,
        gymPhotos,
        gymListingRevisions,
        gymPlans,
        gymAffiliations,
        gymCollabs,
      };
    },
  };
}

// Column type schemas matching PostgreSQL column definitions in user/auth/gym scale DBs.
export const COLS = Object.freeze({
  authUsers: [
    { name: "id", cast: "text" },
    { name: "email", cast: "text" },
    { name: "password", cast: "text" },
    { name: "firstName", cast: "text" },
    { name: "lastName", cast: "text" },
    { name: "role", cast: '"Role"' },
    { name: "isActive", cast: "bool" },
    { name: "must_change_password", cast: "bool" },
    { name: "createdAt", cast: "timestamp" },
    { name: "updatedAt", cast: "timestamp" },
  ],
  userProfiles: [
    { name: "id", cast: "text" },
    { name: "userId", cast: "text" },
    { name: "age", cast: "int4" },
    { name: "gender", cast: '"Gender"' },
    { name: "heightCm", cast: "float8" },
    { name: "goal", cast: '"Goal"' },
    { name: "activityLevel", cast: '"ActivityLevel"' },
    { name: "experienceLevel", cast: '"ExperienceLevel"' },
    { name: "preferredTrainingDays", kind: "int4[]" },
    { name: "availableEquipment", kind: "text[]" },
    { name: "injuries", kind: "text[]" },
    { name: "currentWeight", cast: "float8" },
    { name: "targetWeight", cast: "float8" },
    { name: "createdAt", cast: "timestamp" },
    { name: "updatedAt", cast: "timestamp" },
    { name: "isPT", cast: "bool" },
    { name: "session_duration_minutes", cast: "int4" },
    { name: "firstName", cast: "text" },
    { name: "lastName", cast: "text" },
    { name: "email", cast: "text" },
    { name: "competes_in_sport", cast: "bool" },
    { name: "has_completed_onboarding", cast: "bool" },
    { name: "date_of_birth", cast: "date" },
    { name: "dietary_preference", cast: "text" },
    { name: "first_name_normalized", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "is_accepting_clients", cast: "bool" },
    { name: "last_name_normalized", cast: "text" },
    { name: "not_accepting_reason", cast: "text" },
    { name: "photo_url", cast: "text" },
    { name: "pt_suspended", cast: "bool" },
    { name: "referral_code", cast: "text" },
    { name: "search_city", cast: "text" },
    { name: "search_district", cast: "text" },
    { name: "search_ward", cast: "text" },
    { name: "specialties", kind: "text[]" },
    { name: "startingWeight", cast: "float8" },
    { name: "startingWeightSource", cast: "text" },
    { name: "safety_screening_status", cast: '"SafetyScreeningStatus"' },
    { name: "safety_screening_flags", kind: "text[]" },
    { name: "region", cast: "text" },
    { name: "data_origin", cast: "text" },
    { name: "pt_budget_vnd", cast: "int4" },
    { name: "listing_version", cast: "int4" },
    { name: "listing_published_at", cast: "timestamptz" },
    { name: "search_province_code", cast: "int4" },
    { name: "search_ward_code", cast: "int4" },
  ],
  ptApplications: [
    { name: "id", cast: "text" },
    { name: "user_profile_id", cast: "text" },
    { name: "status", cast: '"PTApplicationStatus"' },
    { name: "phone_number", cast: "text" },
    { name: "current_address", cast: "text" },
    { name: "years_of_experience", cast: "text" },
    { name: "education_background", cast: "text" },
    { name: "previous_work_experience", cast: "text" },
    { name: "professional_bio", cast: "text" },
    { name: "main_specialties", kind: "text[]" },
    { name: "target_client_groups", kind: "text[]" },
    { name: "primary_training_goals", kind: "text[]" },
    { name: "training_methods_approach", cast: "text" },
    { name: "service_mode", cast: '"ServiceMode"' },
    { name: "operating_areas", kind: "text[]" },
    { name: "desired_session_price", cast: "float8" },
    { name: "package_price", cast: "float8" },
    { name: "sessions_per_package", cast: "int4" },
    { name: "session_duration_minutes", cast: "int4" },
    { name: "available_days", kind: "text[]" },
    { name: "available_from", cast: "text" },
    { name: "available_until", cast: "text" },
    { name: "availability_blocks", cast: "jsonb" },
    { name: "gym_affiliation", cast: "text" },
    { name: "online_price_per_session", cast: "float8" },
    { name: "offline_price_per_session", cast: "float8" },
    { name: "online_package_price", cast: "float8" },
    { name: "offline_package_price", cast: "float8" },
    { name: "application_training_locations", cast: "jsonb" },
    { name: "residence_address_line", cast: "text" },
    { name: "residence_province_code", cast: "int4" },
    { name: "residence_ward_code", cast: "int4" },
    { name: "languages", kind: "text[]" },
    { name: "admin_note", cast: "text" },
    { name: "rejection_reason", cast: "text" },
    { name: "submitted_at", cast: "timestamp" },
    { name: "reviewed_at", cast: "timestamp" },
    { name: "approved_at", cast: "timestamp" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  ptCerts: [
    { name: "id", cast: "text" },
    { name: "application_id", cast: "text" },
    { name: "certificate_name", cast: "text" },
    { name: "issuing_organization", cast: "text" },
    { name: "is_currently_valid", cast: "bool" },
    { name: "certification_status", cast: "text" },
    { name: "issue_date", cast: "timestamp" },
    { name: "expiration_date", cast: "timestamp" },
    { name: "created_at", cast: "timestamp" },
  ],
  ptTerms: [
    { name: "id", cast: "text" },
    { name: "user_id", cast: "text" },
    { name: "version", cast: "text" },
    { name: "source", cast: "text" },
    { name: "accepted_at", cast: "timestamptz" },
  ],
  ptLocations: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "province_code", cast: "int4" },
    { name: "ward_code", cast: "int4" },
    { name: "gym_name", cast: "text" },
    { name: "gym_name_normalized", cast: "text" },
    { name: "address_line", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "is_primary", cast: "bool" },
    { name: "is_active", cast: "bool" },
    { name: "latitude", cast: "float8" },
    { name: "longitude", cast: "float8" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  ptPackages: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "name", cast: "text" },
    { name: "description", cast: "text" },
    { name: "session_count", cast: "int4" },
    { name: "price", cast: "numeric" },
    { name: "session_mode", cast: '"SessionMode"' },
    { name: "session_duration_minutes", cast: "int4" },
    { name: "validity_days", cast: "int4" },
    { name: "is_active", cast: "bool" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
    { name: "version", cast: "int4" },
  ],
  ptAvailability: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "day_of_week", cast: '"DayOfWeek"' },
    { name: "start_time", cast: "text" },
    { name: "end_time", cast: "text" },
    { name: "is_active", cast: "bool" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  ptPhotos: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "storage_key", cast: "text" },
    { name: "status", cast: '"PtPhysiquePhotoStatus"' },
    { name: "sort_order", cast: "int4" },
    { name: "is_cover", cast: "bool" },
    { name: "mime", cast: "text" },
    { name: "bytes", cast: "int4" },
    { name: "content_hash", cast: "text" },
    { name: "uploaded_by", cast: "text" },
    { name: "created_at", cast: "timestamptz" },
  ],
  ptRevisions: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "status", cast: '"PtListingRevisionStatus"' },
    { name: "source", cast: '"PtListingRevisionSource"' },
    { name: "base_version", cast: "int4" },
    { name: "draft_version", cast: "int4" },
    { name: "payload", cast: "jsonb" },
    { name: "previous_snapshot", cast: "jsonb" },
    { name: "system_adjustments", cast: "jsonb" },
    { name: "submitted_by", cast: "text" },
    { name: "submitted_at", cast: "timestamptz" },
    { name: "reviewed_by", cast: "text" },
    { name: "reviewed_at", cast: "timestamptz" },
    { name: "created_at", cast: "timestamptz" },
    { name: "updated_at", cast: "timestamptz" },
  ],
  ptRestrictions: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "type", cast: '"PtRestrictionType"' },
    { name: "reason_category", cast: '"PtRestrictionReasonCategory"' },
    { name: "reason_text", cast: "text" },
    { name: "public_reason", cast: "text" },
    { name: "imposed_by", cast: "text" },
    { name: "started_at", cast: "timestamp" },
    { name: "scope", cast: '"PtRestrictionScope"' },
    { name: "contract_id", cast: "text" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  inbody: [
    { name: "id", cast: "text" },
    { name: "user_id", cast: "text" },
    { name: "date", cast: "timestamp" },
    { name: "date_only", cast: "date" },
    { name: "weight", cast: "float8" },
    { name: "height", cast: "float8" },
    { name: "bmi", cast: "float8" },
    { name: "bmr", cast: "int4" },
    { name: "body_fat", cast: "float8" },
    { name: "body_fat_pct", cast: "float8" },
    { name: "muscle_mass", cast: "float8" },
    { name: "visceral_fat", cast: "float8" },
    { name: "status", cast: "text" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  contracts: [
    { name: "id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "client_user_id", cast: "text" },
    { name: "status", cast: '"ContractStatus"' },
    { name: "package_name", cast: "text" },
    { name: "total_sessions", cast: "int4" },
    { name: "used_sessions", cast: "int4" },
    { name: "price", cast: "numeric" },
    { name: "start_date", cast: "timestamp" },
    { name: "end_date", cast: "timestamp" },
    { name: "completed_at", cast: "timestamp" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
    { name: "package_type", cast: '"PackageType"' },
    { name: "price_per_session", cast: "numeric" },
    { name: "package_id", cast: "text" },
    { name: "package_source_name", cast: "text" },
    { name: "session_mode", cast: '"SessionMode"' },
    { name: "session_duration_minutes", cast: "int4" },
    { name: "gym_id", cast: "text" },
    { name: "source", cast: '"ContractSource"' },
    { name: "data_origin", cast: "text" },
  ],
  sessions: [
    { name: "id", cast: "text" },
    { name: "contract_id", cast: "text" },
    { name: "client_user_id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "status", cast: '"SessionStatus"' },
    { name: "session_mode", cast: '"SessionMode"' },
    { name: "scheduled_start_at", cast: "timestamp" },
    { name: "scheduled_end_at", cast: "timestamp" },
    { name: "location", cast: "text" },
    { name: "session_deducted", cast: "bool" },
    { name: "completed_at", cast: "timestamp" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  sessionReviews: [
    { name: "id", cast: "text" },
    { name: "session_id", cast: "text" },
    { name: "contract_id", cast: "text" },
    { name: "client_user_id", cast: "text" },
    { name: "rating", cast: "int4" },
    { name: "comment", cast: "text" },
    { name: "created_at", cast: "timestamp" },
  ],
  gymBrands: [
    { name: "id", cast: "text" },
    { name: "owner_id", cast: "text" },
    { name: "name", cast: "text" },
    { name: "approved_name", cast: "text" },
    { name: "description", cast: "text" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymPartners: [
    { name: "id", cast: "text" },
    { name: "legal_name", cast: "text" },
    { name: "partner_kind", cast: '"GymPartnerKind"' },
    { name: "tax_code", cast: "text" },
    { name: "business_license_no", cast: "text" },
    { name: "contact_email", cast: "text" },
    { name: "contact_phone", cast: "text" },
    { name: "status", cast: '"GymPartnerStatus"' },
    { name: "brand_id", cast: "text" },
    { name: "suspended_at", cast: "timestamp" },
    { name: "suspended_reason", cast: "text" },
    { name: "terminated_at", cast: "timestamp" },
    { name: "termination_reason", cast: "text" },
    { name: "expected_branch_count", cast: "int4" },
    { name: "terms_accepted_version", cast: "text" },
    { name: "terms_accepted_at", cast: "timestamp" },
    { name: "verification_status", cast: '"PartnerVerificationStatus"' },
    { name: "verified_at", cast: "timestamp" },
    { name: "verified_by", cast: "text" },
    { name: "source", cast: '"GymPartnerSource"' },
    { name: "representative_name", cast: "text" },
    { name: "representative_role", cast: '"PartnerRepresentativeRole"' },
    { name: "business_scale", cast: '"PartnerBusinessScale"' },
    { name: "application_flow_version", cast: "int4" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymPartnerAccounts: [
    { name: "id", cast: "text" },
    { name: "partner_id", cast: "text" },
    { name: "user_id", cast: "text" },
    { name: "role", cast: '"PartnerAccountRole"' },
    { name: "status", cast: '"PartnerAccountStatus"' },
    { name: "invited_at", cast: "timestamp" },
    { name: "activated_at", cast: "timestamp" },
    { name: "onboarding_completed_at", cast: "timestamp" },
    { name: "contact_phone", cast: "text" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gyms: [
    { name: "id", cast: "text" },
    { name: "owner_id", cast: "text" },
    { name: "name", cast: "text" },
    { name: "approved_name", cast: "text" },
    { name: "description", cast: "text" },
    { name: "address", cast: "text" },
    { name: "approved_address", cast: "text" },
    { name: "city", cast: "text" },
    { name: "phone", cast: "text" },
    { name: "email", cast: "text" },
    { name: "status", cast: '"GymStatus"' },
    { name: "brand_id", cast: "text" },
    { name: "operational_status", cast: '"GymOperationalStatus"' },
    { name: "closure_reason", cast: "text" },
    { name: "expected_reopen_at", cast: "timestamp" },
    { name: "province_code", cast: "int4" },
    { name: "ward_code", cast: "int4" },
    { name: "latitude", cast: "float8" },
    { name: "longitude", cast: "float8" },
    { name: "facilities", kind: "enum[]", enumType: '"GymFacility"' },
    { name: "listing_version", cast: "int4" },
    { name: "listing_published_at", cast: "timestamptz" },
    { name: "created_flow_version", cast: "int4" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymHours: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "day", cast: '"WeekDay"' },
    { name: "type", cast: '"DayScheduleType"' },
    { name: "open_minute", cast: "int4" },
    { name: "close_minute", cast: "int4" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymAmenities: [
    { name: "gym_id", cast: "text" },
    { name: "amenity_id", cast: "text" },
    { name: "created_at", cast: "timestamptz" },
  ],
  gymPhotos: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "file_name", cast: "text" },
    { name: "sort_order", cast: "int4" },
    { name: "is_cover", cast: "bool" },
    { name: "s3_key", cast: "text" },
    { name: "category", cast: '"GymPhotoCategory"' },
    { name: "visibility", cast: '"GymPhotoVisibility"' },
    { name: "status", cast: '"GymPhotoStatus"' },
    { name: "content_hash", cast: "text" },
    { name: "uploaded_by", cast: "text" },
    { name: "created_at", cast: "timestamp" },
  ],
  gymRevisions: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "status", cast: '"GymListingRevisionStatus"' },
    { name: "source", cast: '"GymListingRevisionSource"' },
    { name: "base_version", cast: "int4" },
    { name: "draft_version", cast: "int4" },
    { name: "payload", cast: "jsonb" },
    { name: "previous_snapshot", cast: "jsonb" },
    { name: "submitted_by", cast: "text" },
    { name: "submitted_at", cast: "timestamptz" },
    { name: "reviewed_by", cast: "text" },
    { name: "reviewed_at", cast: "timestamptz" },
    { name: "created_at", cast: "timestamptz" },
    { name: "updated_at", cast: "timestamptz" },
  ],
  gymPlans: [
    { name: "id", cast: "text" },
    { name: "brand_id", cast: "text" },
    { name: "name", cast: "text" },
    { name: "description", cast: "text" },
    { name: "price", cast: "numeric" },
    { name: "duration_days", cast: "int4" },
    { name: "visit_limit", cast: "int4" },
    { name: "status", cast: '"GymMembershipPlanStatus"' },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymAffiliations: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "pt_id", cast: "text" },
    { name: "status", cast: '"AffiliationStatus"' },
    { name: "employment_type", cast: '"AffiliationEmployment"' },
    { name: "visibility", cast: '"GymTrainerVisibility"' },
    { name: "joined_at", cast: "timestamp" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymCollabs: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "pt_user_id", cast: "text" },
    { name: "proposed_pt_rate", cast: "numeric" },
    { name: "proposed_gym_rate", cast: "numeric" },
    { name: "platform_rate", cast: "numeric" },
    { name: "status", cast: '"CollaborationStatus"' },
    { name: "proposed_by", cast: '"CollaborationParty"' },
    { name: "round", cast: "int4" },
    { name: "expires_at", cast: "timestamp" },
    { name: "accepted_at", cast: "timestamp" },
    { name: "effective_at", cast: "timestamp" },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymMemberships: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "plan_id", cast: "text" },
    { name: "client_id", cast: "text" },
    { name: "status", cast: '"GymMembershipContractStatus"' },
    { name: "start_date", cast: "timestamp" },
    { name: "end_date", cast: "timestamp" },
    { name: "price_at_purchase", cast: "numeric" },
    { name: "duration_days_snapshot", cast: "int4" },
    { name: "total_visits", cast: "int4" },
    { name: "used_visits", cast: "int4" },
    { name: "data_origin", cast: '"DataOrigin"' },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
  gymCheckIns: [
    { name: "id", cast: "text" },
    { name: "membership_id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "client_id", cast: "text" },
    { name: "checked_in_by", cast: "text" },
    { name: "source", cast: '"GymCheckInSource"' },
    { name: "created_at", cast: "timestamp" },
  ],
  gymReviews: [
    { name: "id", cast: "text" },
    { name: "gym_id", cast: "text" },
    { name: "client_id", cast: "text" },
    { name: "rating", cast: "int4" },
    { name: "comment", cast: "text" },
    { name: "data_origin", cast: '"DataOrigin"' },
    { name: "created_at", cast: "timestamp" },
    { name: "updated_at", cast: "timestamp" },
  ],
});
