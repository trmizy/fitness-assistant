import { logger } from "@gym-coach/shared";
import { inbodyRepository } from "../repositories/inbody.repository";
import { profileRepository } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { extractInBodyVision } from "./inbody-vision.service";
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

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
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

export const inbodyService = {
  async getHistory(userId: string) {
    return inbodyRepository.findByUserId(userId);
  },

  // BR-32: PT views a client's InBody — requires ACTIVE or COMPLETED contract
  async getClientHistory(ptUserId: string, clientUserId: string) {
    const contract = await contractRepository.findActiveOrCompletedByPair(
      ptUserId,
      clientUserId,
    );
    if (!contract) {
      throw err("No contract relationship with this client", 403);
    }
    return inbodyRepository.findByUserId(clientUserId);
  },

  async getLatest(userId: string) {
    return inbodyRepository.findLatestByUserId(userId);
  },

  async createEntry(userId: string, data: any) {
    inbodyUploadsTotal.inc({ method: "manual" });
    const measuredDate = data.date ? new Date(data.date) : new Date();
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
    if ((bodyFat === undefined || bodyFat === null) && data.weight != null && data.bodyFatPct != null) {
      bodyFat = Math.round(Number(data.weight) * (Number(data.bodyFatPct) / 100) * 10) / 10;
    }
    if (bodyFat === undefined || bodyFat === null) {
      throw err("Cần nhập Mỡ cơ thể (kg) hoặc % Mỡ cơ thể để tính ra được", 400);
    }

    const payload = { ...data, bodyFat, date: measuredDate, dateOnly };
    const { dateOnly: _d, userId: _u, ...updatePayload } = payload;
    const entry = await inbodyRepository.upsertByUserAndDate(
      userId,
      dateOnly,
      payload,
      updatePayload,
    );
    // Sync latest InBody metrics to the profile so AI always reads fresh data
    await syncLatestInBodyToProfile(userId).catch(() => {});
    return entry;
  },

  // BR-06: client may edit an InBody entry (e.g. tweak OCR results before confirming).
  // Only the owner can update. If `date` is changed, `dateOnly` is recomputed so the
  // unique-per-day constraint keeps making sense.
  async updateEntry(userId: string, id: string, data: any) {
    const existing = await inbodyRepository.findById(id);
    if (!existing || existing.userId !== userId) {
      throw err("InBody entry not found", 404);
    }
    const patch: Record<string, any> = { ...data };
    if (data.date !== undefined) {
      const newDate = new Date(data.date);
      patch.date = newDate;
      patch.dateOnly = startOfUtcDay(newDate);
    }
    try {
      const updated = await inbodyRepository.update(id, patch);
      // Re-sync: the edit might have changed weight on the latest entry
      await syncLatestInBodyToProfile(userId).catch(() => {});
      return updated;
    } catch (e: any) {
      if (isUniqueViolation(e)) {
        throw err("Bản ghi InBody trong ngày đã tồn tại", 409);
      }
      throw e;
    }
  },

  async extractFromImage(_userId: string, imagePath: string, uploadMimeType?: string) {
    const startTime = Date.now();
    try {
      const result = await extractInBodyVision(imagePath, uploadMimeType);

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
          measurementDate = parsed.toISOString().slice(0, 10);
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
      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: "failure" });
      ocrExtractionDuration.observe(durationSec);

      logger.error({ error: "InBody extraction failed", message: error?.message });
      throw new Error(`Failed to extract data: ${error.message}`);
    }
  },
};
