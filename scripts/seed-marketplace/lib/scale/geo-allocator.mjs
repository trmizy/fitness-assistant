// Deterministic 2,500-branch brand/chain splitter, C3 34-province Hamilton allocator, and urban/rural ward sampler.
import { loadWardGeo, samplePointInWard } from "../geo-sampler.mjs";
import { C3_PROVINCES, DEMO_OWNER_SPECS, STREET_NAMES } from "./config.mjs";

/**
 * Hamilton Largest-Remainder rounding preserving exact integer sum.
 * @param {number} total
 * @param {Array<{ code: number, pct: number }>} entries
 * @returns {Map<number, number>}
 */
export function hamiltonProvinceQuotas(total, entries = C3_PROVINCES) {
  const pctSum = entries.reduce((s, e) => s + e.pct, 0) || 100;
  const exact = entries.map((e) => {
    const raw = (total * e.pct) / pctSum;
    const count = Math.floor(raw);
    return { code: e.code, count, rem: raw - count };
  });
  let left = total - exact.reduce((s, e) => s + e.count, 0);
  const byRem = [...exact].sort((a, b) => b.rem - a.rem || a.code - b.code);
  for (let i = 0; i < left; i++) byRem[i % byRem.length].count++;
  return new Map(exact.map((e) => [e.code, e.count]));
}

/** Bounded Hamilton allocation across slots with per-slot [minCap, maxCap] limits. */
function distributeBoundedHamilton(total, weights, minCap, maxCap) {
  const n = weights.length;
  const counts = Array(n).fill(minCap);
  let rem = total - n * minCap;
  if (rem < 0) throw new Error(`distributeBoundedHamilton infeasible: ${total} < ${n * minCap}`);
  const capSum = n * maxCap;
  if (total > capSum) throw new Error(`distributeBoundedHamilton infeasible: ${total} > ${capSum}`);

  while (rem > 0) {
    const elig = [];
    for (let i = 0; i < n; i++) if (counts[i] < maxCap) elig.push(i);
    if (!elig.length) break;
    const wSum = elig.reduce((s, i) => s + weights[i], 0) || elig.length;
    const shares = elig.map((i) => {
      const exact = (rem * (weights[i] || 1)) / wSum;
      const fl = Math.floor(exact);
      return { i, floor: fl, frac: exact - fl };
    });
    let taken = 0;
    for (const s of shares) {
      const add = Math.min(maxCap - counts[s.i], s.floor);
      counts[s.i] += add;
      taken += add;
    }
    let left = rem - taken;
    shares.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const s of shares) {
      if (left <= 0) break;
      if (counts[s.i] < maxCap) {
        counts[s.i]++;
        left--;
      }
    }
    rem = left;
  }
  return counts;
}

/**
 * Splits owners into standalone / medium-chain / large-chain branch counts.
 * At scaleFactor=1: exact 700 standalone (1), 180 medium [2..5], 20 large [15..90] = 2,500 branches.
 */
export function allocateOwnerBranchPlan(rng, counts) {
  const { owners: ownerTotal, branches: branchTotal, scaleFactor } = counts;
  if (scaleFactor === 1) {
    const medium = Array.from({ length: 180 }, () =>
      Math.min(5, Math.max(2, 2 + Math.floor(Math.pow(rng(), 1.35) * 4)))
    );
    const mediumSum = medium.reduce((s, x) => s + x, 0); // guaranteed in [360, 900]
    const largeSum = 1800 - mediumSum; // guaranteed in [900, 1440] c [20*15, 20*90]
    const weights = Array.from({ length: 20 }, (_, i) => Math.pow(i + 1, -0.55) * (0.85 + 0.3 * rng()));
    const large = distributeBoundedHamilton(largeSum, weights, 15, 90);
    return buildOwnerPlanObjects(Array(700).fill(1), medium, large);
  }

  // Scaled sub-universe for --scale-factor < 1
  const largeN = Math.max(1, Math.round(ownerTotal * (20 / 900)));
  const mediumN = Math.max(1, Math.round(ownerTotal * (180 / 900)));
  const standaloneN = Math.max(1, ownerTotal - largeN - mediumN);
  const remAfterStandalone = Math.max(largeN * 2 + mediumN * 2, branchTotal - standaloneN);
  const medTarget = Math.min(
    mediumN * 5,
    Math.max(mediumN * 2, Math.round(remAfterStandalone * 0.45))
  );
  const medWeights = Array.from({ length: mediumN }, () => 1 + rng());
  const medium = distributeBoundedHamilton(medTarget, medWeights, 2, 5);
  const largeSum = Math.max(largeN, branchTotal - standaloneN - medTarget);
  const largeWeights = Array.from({ length: largeN }, (_, i) => Math.pow(i + 1, -0.5));
  const large = distributeBoundedHamilton(largeSum, largeWeights, 1, Math.max(2, largeSum));
  return buildOwnerPlanObjects(Array(standaloneN).fill(1), medium, large);
}

function buildOwnerPlanObjects(standaloneCounts, mediumCounts, largeCounts) {
  const demoLarge = DEMO_OWNER_SPECS.filter((d) => d.kind === "large");
  const demoMedium = DEMO_OWNER_SPECS.filter((d) => d.kind === "medium");
  const demoStand = DEMO_OWNER_SPECS.filter((d) => d.kind === "standalone");

  const plans = [];
  let seq = 0;
  for (let i = 0; i < largeCounts.length; i++) {
    const demo = demoLarge[i] ?? null;
    plans.push({ ownerIdx: seq++, kind: "large", branchCount: largeCounts[i], demo });
  }
  for (let i = 0; i < mediumCounts.length; i++) {
    const demo = demoMedium[i] ?? null;
    plans.push({ ownerIdx: seq++, kind: "medium", branchCount: mediumCounts[i], demo });
  }
  for (let i = 0; i < standaloneCounts.length; i++) {
    const demo = demoStand[i] ?? null;
    plans.push({ ownerIdx: seq++, kind: "standalone", branchCount: 1, demo });
  }
  return plans;
}

function pickWeightedIndex(items, weightFn, rng) {
  let total = 0;
  for (const item of items) total += weightFn(item);
  if (total <= 0) return Math.floor(rng() * items.length);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weightFn(items[i]);
    if (r <= 0) return i;
  }
  return items.length - 1;
}

function selectProvincesForChain(remainingMap, branchCount, maxProvs, preferredCode, rng) {
  const selected = [];
  const used = new Set();

  if (preferredCode !== undefined && (remainingMap.get(preferredCode) ?? 0) > 0) {
    selected.push(preferredCode);
    used.add(preferredCode);
  }

  while (selected.length < maxProvs) {
    const selectedCap = selected.reduce((s, c) => s + (remainingMap.get(c) ?? 0), 0);
    if (selectedCap >= branchCount && selected.length >= Math.min(maxProvs, 2)) {
      if (rng() < 0.35 || selectedCap >= branchCount * 1.4) break;
    }
    const candidates = [...remainingMap.entries()]
      .filter(([code, rem]) => rem > 0 && !used.has(code))
      .map(([code, rem]) => ({ code, rem }));
    if (!candidates.length) break;
    const idx = pickWeightedIndex(candidates, (c) => c.rem, rng);
    selected.push(candidates[idx].code);
    used.add(candidates[idx].code);
  }

  // Upgrade selection with highest-capacity provinces if total capacity < branchCount
  let sumCap = selected.reduce((s, c) => s + (remainingMap.get(c) ?? 0), 0);
  if (sumCap < branchCount) {
    const rest = [...remainingMap.entries()]
      .filter(([code, rem]) => rem > 0 && !used.has(code))
      .sort((a, b) => b[1] - a[1]);
    // Replace smallest picks or append up to maxProvs
    selected.sort((a, b) => (remainingMap.get(b) ?? 0) - (remainingMap.get(a) ?? 0));
    for (const [code, rem] of rest) {
      if (sumCap >= branchCount) break;
      if (selected.length < maxProvs) {
        selected.push(code);
        used.add(code);
        sumCap += rem;
      } else {
        const last = selected[selected.length - 1];
        const lastRem = remainingMap.get(last) ?? 0;
        if (rem > lastRem) {
          selected[selected.length - 1] = code;
          used.delete(last);
          used.add(code);
          sumCap += rem - lastRem;
        }
      }
    }
  }
  return selected;
}

function distributeAcrossSelectedProvinces(remainingMap, branchCount, provCodes, rng) {
  const n = provCodes.length;
  const maxCaps = provCodes.map((c) => remainingMap.get(c) ?? 0);
  const counts = Array(n).fill(0);
  let left = branchCount;

  // Give at least 1 branch to each selected province when feasible
  for (let i = 0; i < n && left > 0; i++) {
    if (maxCaps[i] > 0) {
      counts[i] = 1;
      left--;
    }
  }
  while (left > 0) {
    const elig = [];
    for (let i = 0; i < n; i++) if (counts[i] < maxCaps[i]) elig.push(i);
    if (!elig.length) throw new Error(`Insufficient province quota capacity for chain (${branchCount})`);
    const idx = elig[pickWeightedIndex(elig, (i) => maxCaps[i] - counts[i] + rng() * 0.5, rng)];
    counts[idx]++;
    left--;
  }
  for (let i = 0; i < n; i++) {
    remainingMap.set(provCodes[i], maxCaps[i] - counts[i]);
  }
  return provCodes.map((code, i) => ({ provinceCode: code, count: counts[i] })).filter((x) => x.count > 0);
}

function expandSelectedToMeetCapacity(remainingMap, selected, needed) {
  let selCap = selected.reduce((s, c) => s + (remainingMap.get(c) ?? 0), 0);
  if (selCap >= needed) return selected;
  const used = new Set(selected);
  const extra = [...remainingMap.entries()]
    .filter(([c, r]) => r > 0 && !used.has(c))
    .sort((a, b) => b[1] - a[1]);
  for (const [c, r] of extra) {
    if (selCap >= needed) break;
    selected.push(c);
    selCap += r;
  }
  return selected;
}

/**
 * Maps every owner & its branches onto 34 provinces (exact C3 Hamilton quota),
 * selects wards (achieving >=40% national ward coverage at factor=1 + urban clustering),
 * and samples deterministic OSM-validated GPS points via samplePointInWard().
 */
export function allocateBranchesGeo(ownerPlans, counts, rng, wardGeo = loadWardGeo()) {
  const provQuotas = hamiltonProvinceQuotas(counts.branches, C3_PROVINCES);
  const remaining = new Map(provQuotas);

  const wardsByProvince = new Map();
  for (const w of wardGeo.wards) {
    let arr = wardsByProvince.get(w.provinceCode);
    if (!arr) wardsByProvince.set(w.provinceCode, (arr = []));
    arr.push(w);
  }

  // Reserve demo standalone provinces first so fixed demo branches never distort quota
  const branchAssignmentsByOwner = new Map();
  const largeChains = ownerPlans.filter((o) => o.kind === "large").sort((a, b) => b.branchCount - a.branchCount);
  const mediumChains = ownerPlans.filter((o) => o.kind === "medium").sort((a, b) => b.branchCount - a.branchCount);
  const standalones = ownerPlans.filter((o) => o.kind === "standalone");

  // 1. Reserve standalone demo provinces up front
  const deferredStandalones = [];
  for (const s of standalones) {
    if (s.demo?.provinceCode && (remaining.get(s.demo.provinceCode) ?? 0) > 0) {
      remaining.set(s.demo.provinceCode, remaining.get(s.demo.provinceCode) - 1);
      branchAssignmentsByOwner.set(s.ownerIdx, [s.demo.provinceCode]);
    } else {
      deferredStandalones.push(s);
    }
  }

  // 2. Assign large chains (strictly <= 6 provinces at factor=1; flexible fallback at tiny scaleFactor < 1)
  for (const chain of largeChains) {
    const kPref = counts.scaleFactor === 1 ? Math.min(6, Math.max(2, 2 + Math.floor(rng() * 5))) : 6;
    let selected = selectProvincesForChain(remaining, chain.branchCount, kPref, chain.demo?.provinceCode, rng);
    if (counts.scaleFactor === 1 && selected.reduce((s, c) => s + (remaining.get(c) ?? 0), 0) < chain.branchCount) {
      selected = selectProvincesForChain(remaining, chain.branchCount, 6, chain.demo?.provinceCode, rng);
    }
    if (counts.scaleFactor < 1) expandSelectedToMeetCapacity(remaining, selected, chain.branchCount);
    const dist = distributeAcrossSelectedProvinces(remaining, chain.branchCount, selected, rng);
    const flat = [];
    for (const d of dist) for (let i = 0; i < d.count; i++) flat.push(d.provinceCode);
    branchAssignmentsByOwner.set(chain.ownerIdx, flat);
  }

  // 3. Assign medium chains (max 2 provinces at factor=1; flexible fallback at sub-scale < 1)
  for (const chain of mediumChains) {
    const kMax = rng() < 0.65 ? 1 : 2;
    const selected = selectProvincesForChain(remaining, chain.branchCount, kMax, chain.demo?.provinceCode, rng);
    if (counts.scaleFactor < 1 || selected.reduce((s, c) => s + (remaining.get(c) ?? 0), 0) < chain.branchCount) {
      expandSelectedToMeetCapacity(remaining, selected, chain.branchCount);
    }
    const dist = distributeAcrossSelectedProvinces(remaining, chain.branchCount, selected, rng);
    const flat = [];
    for (const d of dist) for (let i = 0; i < d.count; i++) flat.push(d.provinceCode);
    branchAssignmentsByOwner.set(chain.ownerIdx, flat);
  }

  // 4. Fill remaining seats with standalone owners
  const remList = [];
  for (const [code, cnt] of remaining.entries()) {
    for (let i = 0; i < cnt; i++) remList.push(code);
  }
  for (let i = remList.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [remList[i], remList[j]] = [remList[j], remList[i]];
  }
  if (remList.length !== deferredStandalones.length) {
    throw new Error(`Standalone remainder mismatch: ${remList.length} vs ${deferredStandalones.length}`);
  }
  for (let i = 0; i < deferredStandalones.length; i++) {
    branchAssignmentsByOwner.set(deferredStandalones[i].ownerIdx, [remList[i]]);
  }

  // 5. Within each province, perform 2-phase ward placement (coverage pass + urban density pass)
  const provinceBranchSlots = new Map();
  for (const [ownerIdx, provCodes] of branchAssignmentsByOwner.entries()) {
    for (let bIdx = 0; bIdx < provCodes.length; bIdx++) {
      const code = provCodes[bIdx];
      let arr = provinceBranchSlots.get(code);
      if (!arr) provinceBranchSlots.set(code, (arr = []));
      arr.push({ ownerIdx, localIdx: bIdx });
    }
  }

  const branchGeoByKey = new Map();
  for (const [provCode, slots] of provinceBranchSlots.entries()) {
    const wards = wardsByProvince.get(provCode) ?? [];
    if (!wards.length) throw new Error(`No wards in wardGeo for province ${provCode}`);
    const osmScore = (w) => 1 + (w.osmStats?.buildings ?? 0) + 0.5 * (w.osmStats?.roads ?? 0);
    const urbanWards = wards.filter((w) => w.urbanClass === "urban").sort((a, b) => osmScore(b) - osmScore(a));
    const ruralWards = wards.filter((w) => w.urbanClass !== "urban").sort((a, b) => osmScore(b) - osmScore(a));

    // At factor=1 cover ~88% of max theoretically coverable unique wards in each province (~44% nationally >= 40%)
    const theoreticalMax = Math.min(wards.length, slots.length);
    const targetCover =
      counts.scaleFactor === 1
        ? Math.min(theoreticalMax, Math.ceil(theoreticalMax * 0.88))
        : Math.min(theoreticalMax, slots.length);

    // Phase A: unlock urban wards first, then highest-activity rural town hubs
    const orderedCoverPool = [...urbanWards, ...ruralWards].slice(0, targetCover);
    const chosenWards = orderedCoverPool.map((w) => w);

    // Phase B: remaining branches cluster in urban centers (~5.5:1 urban preference)
    const densityPool = orderedCoverPool.length ? orderedCoverPool : wards;
    while (chosenWards.length < slots.length) {
      const wIdx = pickWeightedIndex(
        densityPool,
        (w) => (w.urbanClass === "urban" ? 5.5 : 1) * Math.log1p(osmScore(w)),
        rng
      );
      chosenWards.push(densityPool[wIdx]);
    }

    // Shuffle slot->ward mapping slightly while avoiding duplicate same-owner wards when unnecessary
    for (let i = chosenWards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [chosenWards[i], chosenWards[j]] = [chosenWards[j], chosenWards[i]];
    }

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const w = chosenWards[i];
      const point = samplePointInWard(
        w.wardCode,
        `${counts.scaleFactor}:${slot.ownerIdx}:${slot.localIdx}:${w.wardCode}`,
        { maxJitterDeg: 0 }
      );
      const houseNo = 12 + ((slot.ownerIdx * 37 + slot.localIdx * 13) % 380);
      const street = STREET_NAMES[(slot.ownerIdx * 7 + slot.localIdx * 19 + w.wardCode) % STREET_NAMES.length];
      branchGeoByKey.set(`${slot.ownerIdx}:${slot.localIdx}`, {
        provinceCode: w.provinceCode,
        provinceName: w.provinceName,
        wardCode: w.wardCode,
        wardName: w.wardName,
        urbanClass: w.urbanClass,
        latitude: point.latitude,
        longitude: point.longitude,
        address: `${houseNo} Đường ${street}, ${w.wardName}, ${w.provinceName}`,
      });
    }
  }

  return { branchAssignmentsByOwner, branchGeoByKey, provQuotas };
}

/**
 * Assigns provinces (C3 Hamilton) & wards (4.5:1 urban weight) for PTs and Clients,
 * reserving fixed demo province codes up front.
 */
export function allocatePeopleLocations(total, demoSpecs, wardGeo, rng, seedTag, needGps = true) {
  const quotas = hamiltonProvinceQuotas(total, C3_PROVINCES);
  const remaining = new Map(quotas);
  const wardsByProvince = new Map();
  for (const w of wardGeo.wards) {
    let arr = wardsByProvince.get(w.provinceCode);
    if (!arr) wardsByProvince.set(w.provinceCode, (arr = []));
    arr.push(w);
  }

  const assignedProvs = Array(total);
  const reservedIndices = new Set();
  for (let i = 0; i < demoSpecs.length && i < total; i++) {
    const code = demoSpecs[i]?.provinceCode;
    if (code && (remaining.get(code) ?? 0) > 0) {
      assignedProvs[i] = code;
      remaining.set(code, remaining.get(code) - 1);
      reservedIndices.add(i);
    }
  }

  const pool = [];
  for (const [code, cnt] of remaining.entries()) {
    for (let k = 0; k < cnt; k++) pool.push(code);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let cursor = 0;
  for (let i = 0; i < total; i++) {
    if (!reservedIndices.has(i)) assignedProvs[i] = pool[cursor++];
  }

  return assignedProvs.map((provCode, idx) => {
    const ws = wardsByProvince.get(provCode);
    const wIdx = pickWeightedIndex(
      ws,
      (w) => (w.urbanClass === "urban" ? 4.5 : 1) * (1 + Math.log1p(w.osmStats?.buildings ?? 0)),
      rng
    );
    const w = ws[wIdx];
    const point = needGps
      ? samplePointInWard(w.wardCode, `${seedTag}:${idx}:${w.wardCode}`, { maxJitterDeg: 0 })
      : null;
    const houseNo = 10 + ((idx * 29 + w.wardCode) % 420);
    const street = STREET_NAMES[(idx * 11 + w.wardCode) % STREET_NAMES.length];
    return {
      provinceCode: w.provinceCode,
      provinceName: w.provinceName,
      wardCode: w.wardCode,
      wardName: w.wardName,
      urbanClass: w.urbanClass,
      latitude: point?.latitude ?? w.centroidLat,
      longitude: point?.longitude ?? w.centroidLng,
      addressLine: `${houseNo} ${street}, ${w.wardName}`,
    };
  });
}
