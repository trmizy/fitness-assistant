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
    await profileRepository.upsert(userId, patch);
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
    const payload = { ...data, date: measuredDate, dateOnly };
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

  async extractFromImage(_userId: string, imagePath: string) {
    const startTime = Date.now();
    try {
      const result = await extractInBodyVision(imagePath);

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
