import { logger } from "@gym-coach/shared";
import { inbodyRepository } from "../repositories/inbody.repository";
import { profileRepository } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { assertPtMayAct, assertPtMayActOnContract } from "./pt-restriction.service";
import { extractInBodyVision } from "./inbody-vision.service";
import { triggerInBodyReassessmentSafe } from "../clients/fitness-service.client";
import {
  assertInBodyConsistent,
  inbodyError,
  parseInBodyInput,
  INBODY_INVALID_INPUT,
} from "./inbody.validation";
import {
  ocrExtractionsTotal,
  ocrExtractionDuration,
  inbodyUploadsTotal,
} from "@gym-coach/shared";

function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

// BR-07: max one InBody entry per user per calendar day. The `dateOnly` field
// (added in migration inbody_unique_per_day) is the unique key. Catch Prisma's
// P2002 violation and re-throw as a clean 409 rather than letting the controller
// see a raw Prisma error and return 500.
function isUniqueViolation(e: any): boolean {
  return (
    e?.code === "P2002" || /unique constraint/i.test(String(e?.message || ""))
  );
}

/** After any InBody upsert/update, propagate the newest physical metrics to UserProfile
 *  so that profile.currentWeight always reflects the latest InBody measurement.
 */
async function syncLatestInBodyToProfile(userId: string): Promise<void> {
  const latest = await inbodyRepository.findLatestByUserId(userId);
  if (!latest) return;
  const patch: Record<string, unknown> = {};
  if (typeof latest.weight === "number") patch.currentWeight = latest.weight;
  if (Object.keys(patch).length > 0) {
    // source: "INBODY" — only takes effect if this happens to be the very
    // first weight this profile has ever had (see profileRepository.upsert);
    // on every subsequent sync it's a no-op since startingWeight is already set.
    await profileRepository.upsert(userId, patch, { source: "INBODY" });
  }
}

/**
 * Visceral fat level (Float) and BMR (Int) are optional. The confirm form sends parseFloat() of whatever is typed, so an emptied
 * field arrives as NaN and a BMR like 1650.5 would be rejected by the Int column — drop non-finite values, round BMR.
 */
export function sanitizeOptionalMetrics<T extends Record<string, any>>(data: T): T {
  const out: Record<string, any> = { ...data };
  for (const key of ["visceralFat", "bmr"] as const) {
    if (!(key in out)) continue;
    const v = out[key];
    if (v === null || v === undefined || v === "") { delete out[key]; continue; }
    const num = Number(v);
    if (!Number.isFinite(num) || num <= 0) delete out[key];
    else out[key] = key === "bmr" ? Math.round(num) : Math.round(num * 10) / 10;
  }
  return out as T;
}

/**
 * InBody prints the test date day-first ("07. 08. 2026"); a vision model occasionally reads it month-first. A measurement can
 * never be in the future, so a future date whose day/month swap is a valid past date is swapped back (vision test 2026-11-11:
 * "08.12.2026" read as 2026-12-08 for a report from August). Anything else is returned unchanged for the user to confirm.
 */
export function fixDayMonthSwap(isoDate: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const today = now.toISOString().slice(0, 10);
  if (isoDate <= today) return isoDate;
  const [, y, mo, d] = m;
  if (Number(d) > 12) return isoDate;
  const swapped = `${y}-${d}-${mo}`;
  const check = new Date(`${swapped}T00:00:00Z`);
  return !isNaN(check.getTime()) && check.toISOString().slice(0, 10) === swapped && swapped <= today ? swapped : isoDate;
}

/** True when the vision result carries at least one real core metric (weight, muscle mass or fat mass > 0). */
export function hasReadableInBodyMetrics(result: any): boolean {
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  return (
    positive(result?.weight) ||
    positive(result?.skeletal_muscle_mass) ||
    positive(result?.body_fat_mass)
  );
}

export const inbodyService = {
  async getHistory(userId: string) {
    return inbodyRepository.findByUserId(userId);
  },

  // BR-32 as tightened by audit finding #9 (owner decision, final): a PT reads a client's InBody history ONLY while a contract between
  // them is ACTIVE. Unconditional - there is no flag and no fallback to COMPLETED. COMPLETED / CANCELLED / EXPIRED / REJECTED / never-paid
  // contracts, another PT and "no relationship" are all 403. The client's own read (getHistory) is untouched and no InBody row is ever
  // deleted by this rule. There is no client-granted access model; none exists to consult.
  async getClientHistory(ptUserId: string, clientUserId: string) {
    // A restricted PT does not read clients' body data (coaching access is paused with the contract).
    await assertPtMayAct(ptUserId);
    const contract = await contractRepository.findActivePtClientPair(ptUserId, clientUserId);
    if (!contract) {
      throw err("No active coaching relationship with this client", 403);
    }
    // A contract paused on its own (CONTRACT scope) closes the PT's access to THAT client's body data too.
    await assertPtMayActOnContract(ptUserId, contract.id);
    return inbodyRepository.findByUserId(clientUserId);
  },

  async getLatest(userId: string) {
    return inbodyRepository.findLatestByUserId(userId);
  },

  // Gymini Adaptive Roadmap Production Closure — bounded server-side
  // lookup for fitness-service's forecast-reconciliation reads (which
  // need "the latest measurement at/before this specific historical
  // date", not the user's whole history). See
  // docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_DESIGN.md §6/§7.
  async getLatestOnOrBefore(userId: string, cutoff: Date) {
    return inbodyRepository.findLatestByUserIdOnOrBefore(userId, cutoff);
  },

  async createEntry(userId: string, raw: unknown) {
    // Whitelist + range validation (N13G-01/02/03): userId/id/createdAt/unknown keys never get past here,
    // and bad types/ranges are a 400 with a Vietnamese message, never a 500.
    const data = parseInBodyInput(raw, "create");
    if (data.weight === undefined) {
      throw inbodyError("Cần nhập Cân nặng", 400, INBODY_INVALID_INPUT, "weight");
    }
    inbodyUploadsTotal.inc({ method: "manual" });
    const measuredDate = data.date ?? new Date();
    const dateOnly = startOfUtcDay(measuredDate);

    // The manual-entry form only marks "Cân nặng" (weight) and "Ngày kiểm tra" (date) as
    // required (*) — every other field, including "Mỡ cơ thể (kg)" (bodyFat), is presented as
    // optional. But bodyFat is a non-nullable column, so a perfectly reasonable submission
    // (weight + bodyFatPct, skipping the kg field many people don't know off-hand) used to hit
    // an uncaught Prisma validation error and a raw 500 the frontend couldn't even show a
    // message for — found live via TC-AI-001 in the E2E suite. Derive it from weight ×
    // bodyFatPct/100 when it's missing but derivable; only reject (with a real 400, not a raw
    // 500) when there's truly no way to know it.
    let bodyFat = data.bodyFat;
    if (bodyFat === undefined && data.bodyFatPct != null) {
      bodyFat = Math.round(data.weight * (data.bodyFatPct / 100) * 10) / 10;
    }
    if (bodyFat === undefined) {
      throw err("Cần nhập Mỡ cơ thể (kg) hoặc % Mỡ cơ thể để tính ra được", 400, INBODY_INVALID_INPUT);
    }

    // Same class of bug as bodyFat above (Gymini Cross-System Fitness Journey
    // Integration phase): "Cơ bắp (kg)" (muscleMass) is presented as optional
    // in the manual-entry form but is a non-nullable column with no
    // derivation path (unlike bodyFat, skeletal muscle mass cannot be
    // reasonably computed from weight/bodyFat alone) — a real, reachable
    // submission with it left blank used to hit an uncaught Prisma
    // validation error and a raw 500. Reject cleanly instead.
    if (data.muscleMass === undefined) {
      throw err("Cần nhập Cơ bắp (kg)", 400, INBODY_INVALID_INPUT);
    }
    assertInBodyConsistent({ weight: data.weight, muscleMass: data.muscleMass, bodyFat });

    // The reverse direction too: fat mass without a percentage left bodyFatPct null, shown as "null%" on the InBody page.
    const pctMissing = data.bodyFatPct === undefined || data.bodyFatPct === null || Number.isNaN(Number(data.bodyFatPct));
    const bodyFatPct = pctMissing && Number(data.weight) > 0 && Number(bodyFat) > 0
      ? Math.round((Number(bodyFat) / Number(data.weight)) * 1000) / 10
      : data.bodyFatPct;
    // `data` is already whitelisted by parseInBodyInput (no userId / id / createdAt), so nothing needs stripping but dateOnly.
    const payload = { ...sanitizeOptionalMetrics(data), bodyFat, ...(bodyFatPct != null && !Number.isNaN(Number(bodyFatPct)) ? { bodyFatPct } : {}), date: measuredDate, dateOnly };
    const { dateOnly: _d, ...updatePayload } = payload;
    const entry = await inbodyRepository.upsertByUserAndDate(
      userId,
      dateOnly,
      payload,
      updatePayload,
    );
    // Sync latest InBody metrics to the profile so AI always reads fresh data
    await syncLatestInBodyToProfile(userId).catch(() => {});
    // AI Nutrition Cycle Engine (Gymini) Phase 3 — best-effort, non-blocking:
    // ask fitness-service whether this new measurement warrants an
    // automatic cycle reassessment (see inbody-reassessment.service.ts for
    // the cooldown/no-spam gating). triggerInBodyReassessmentSafe never
    // throws (short timeout, resolves to null on any failure), and never
    // affects whether this InBody entry itself was saved successfully.
    await triggerInBodyReassessmentSafe(userId);
    return entry;
  },

  // BR-06: client may edit an InBody entry (e.g. tweak OCR results before confirming).
  // Only the owner can update. If `date` is changed, `dateOnly` is recomputed so the
  // unique-per-day constraint keeps making sense. Only whitelisted measurement fields are
  // editable (N13G-01): never userId / id / createdAt / dateOnly.
  async updateEntry(userId: string, id: string, raw: unknown) {
    const existing = await inbodyRepository.findById(id);
    if (!existing || existing.userId !== userId) {
      throw err("Không tìm thấy bản ghi InBody", 404, "INBODY_NOT_FOUND");
    }
    const data = parseInBodyInput(raw, "patch");
    if (Object.keys(data).length === 0) {
      throw err("Không có dữ liệu hợp lệ để cập nhật", 400, INBODY_INVALID_INPUT);
    }
    assertInBodyConsistent({
      weight: data.weight ?? existing.weight,
      muscleMass: data.muscleMass ?? existing.muscleMass,
      bodyFat: data.bodyFat ?? existing.bodyFat,
    });
    const patch: Record<string, any> = { ...sanitizeOptionalMetrics(data) };
    if (data.date !== undefined) {
      patch.dateOnly = startOfUtcDay(data.date);
    }
    try {
      const updated = await inbodyRepository.update(id, patch);
      // Re-sync: the edit might have changed weight on the latest entry
      await syncLatestInBodyToProfile(userId).catch(() => {});
      // See createEntry above — same best-effort reassessment-check call.
      await triggerInBodyReassessmentSafe(userId);
      return updated;
    } catch (e: any) {
      if (isUniqueViolation(e)) {
        throw err("Bản ghi InBody trong ngày đã tồn tại", 409, "INBODY_DUPLICATE_DAY");
      }
      throw e;
    }
  },

  // N13G-04: the owner can delete a wrong entry; anyone else gets the same 404 as for a missing id
  // (no existence oracle). The profile weight is re-derived from whatever is now the latest entry.
  async deleteEntry(userId: string, id: string) {
    const existing = await inbodyRepository.findById(id);
    if (!existing || existing.userId !== userId) {
      throw err("Không tìm thấy bản ghi InBody", 404, "INBODY_NOT_FOUND");
    }
    await inbodyRepository.delete(id);
    await syncLatestInBodyToProfile(userId).catch(() => {});
    return { deleted: true, id };
  },

  async extractFromImage(_userId: string, imagePath: string, uploadMimeType?: string) {
    const startTime = Date.now();
    try {
      const result = await extractInBodyVision(imagePath, uploadMimeType);

      // N13G-06: a photo that is not an InBody sheet comes back with every metric 0/empty. Never hand
      // that to the review form (it would save zeros as a real measurement) - tell the user instead.
      if (!hasReadableInBodyMetrics(result)) {
        ocrExtractionsTotal.inc({ status: "unreadable" });
        ocrExtractionDuration.observe((Date.now() - startTime) / 1000);
        throw err(
          "Không đọc được chỉ số từ ảnh. Hãy chụp lại rõ nét phiếu InBody (đủ sáng, không bị cắt) hoặc nhập tay.",
          422,
          "INBODY_SCAN_UNREADABLE",
        );
      }

      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: "success" });
      ocrExtractionDuration.observe(durationSec);
      inbodyUploadsTotal.inc({ method: "image" });

      const weight = result.weight || 0;
      const heightCm = result.height;
      const bodyFat = result.body_fat_mass || 0;
      const bmi =
        heightCm && heightCm > 0
          ? Math.round((weight / (heightCm / 100) ** 2) * 10) / 10
          : undefined;
      const bodyFatPct =
        weight > 0 && bodyFat > 0
          ? Math.round((bodyFat / weight) * 1000) / 10
          : undefined;

      // Parse measurement_date from OCR. If Claude returned a valid date string,
      // use it as the measurement date. Otherwise fall back to today.
      let measurementDate: string | null = null;
      if (
        result.measurement_date &&
        typeof result.measurement_date === "string"
      ) {
        const cleaned = result.measurement_date.trim();
        // Validate it parses as a real date
        const parsed = new Date(cleaned);
        if (!isNaN(parsed.getTime()) && cleaned.length >= 8) {
          // Return as YYYY-MM-DD
          measurementDate = fixDayMonthSwap(parsed.toISOString().slice(0, 10));
        }
      }

      const entryData = {
        // date will be the measurement date from OCR, or null (frontend will show date picker defaulting to today)
        date: measurementDate,
        weight,
        height: heightCm,
        muscleMass: result.skeletal_muscle_mass || 0,
        bodyFat,
        bmi,
        bodyFatPct,
        // Already columns on InBodyEntry; previously never filled from a scan.
        ...(result.visceral_fat_level != null ? { visceralFat: result.visceral_fat_level } : {}),
        ...(result.bmr != null ? { bmr: Math.round(result.bmr) } : {}),

        rightArmMuscle: result.segmental_lean_analysis?.right_arm,
        leftArmMuscle: result.segmental_lean_analysis?.left_arm,
        trunkMuscle: result.segmental_lean_analysis?.trunk,
        rightLegMuscle: result.segmental_lean_analysis?.right_leg,
        leftLegMuscle: result.segmental_lean_analysis?.left_leg,

        rightArmFat: result.segmental_fat_analysis?.right_arm,
        leftArmFat: result.segmental_fat_analysis?.left_arm,
        trunkFat: result.segmental_fat_analysis?.trunk,
        rightLegFat: result.segmental_fat_analysis?.right_leg,
        leftLegFat: result.segmental_fat_analysis?.left_leg,

        status: "extracted",
        notes: "AI Extracted from image",
      };

      return { result, entryData };
    } catch (error: any) {
      if (error?.code === "INBODY_SCAN_UNREADABLE") throw error; // already counted as "unreadable"
      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: "failure" });
      ocrExtractionDuration.observe(durationSec);

      logger.error({ error: "InBody extraction failed", message: error?.message });
      throw new Error(`Failed to extract data: ${error.message}`);
    }
  },
};
