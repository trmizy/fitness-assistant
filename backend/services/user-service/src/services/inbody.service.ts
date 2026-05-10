import { inbodyRepository } from '../repositories/inbody.repository';
import { extractInBodyVision } from './inbody-vision.service';
import { ocrExtractionsTotal, ocrExtractionDuration, inbodyUploadsTotal } from '@gym-coach/shared';

export const inbodyService = {
  async getHistory(userId: string) {
    return inbodyRepository.findByUserId(userId);
  },

  async getLatest(userId: string) {
    return inbodyRepository.findLatestByUserId(userId);
  },

  async createEntry(userId: string, data: any) {
    inbodyUploadsTotal.inc({ method: 'manual' });
    return inbodyRepository.create(userId, data);
  },

  async extractFromImage(_userId: string, imagePath: string) {
    const startTime = Date.now();
    try {
      const result = await extractInBodyVision(imagePath);

      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: 'success' });
      ocrExtractionDuration.observe(durationSec);
      inbodyUploadsTotal.inc({ method: 'image' });

      const weight = result.weight || 0;
      const heightCm = result.height;
      const bodyFat = result.body_fat_mass || 0;
      const bmi = (heightCm && heightCm > 0)
        ? Math.round((weight / ((heightCm / 100) ** 2)) * 10) / 10
        : undefined;
      const bodyFatPct = (weight > 0 && bodyFat > 0)
        ? Math.round((bodyFat / weight) * 1000) / 10
        : undefined;

      const entryData = {
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

        status: 'extracted',
        notes: 'AI Extracted from image',
      };

      return { result, entryData };
    } catch (error: any) {
      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: 'failure' });
      ocrExtractionDuration.observe(durationSec);

      console.error('Extraction failed:', error);
      throw new Error(`Failed to extract data: ${error.message}`);
    }
  }
};

