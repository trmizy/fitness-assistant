import { inbodyRepository } from '../repositories/inbody.repository';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ocrExtractionsTotal, ocrExtractionDuration, inbodyUploadsTotal } from '@gym-coach/shared';

const execAsync = promisify(exec);

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
      // Call the Python OCR script
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      
      const { stdout, stderr } = await execAsync(
        `${pythonCmd} -m inbody_extractor --image "${imagePath}" --json`,
        { maxBuffer: 10 * 1024 * 1024 },
      );

      if (stderr && !stdout.trim()) {
        throw new Error(`OCR Error: ${stderr}`);
      }

      const result = JSON.parse(stdout.trim());

      // Record OCR metrics
      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: 'success' });
      ocrExtractionDuration.observe(durationSec);
      inbodyUploadsTotal.inc({ method: 'image' });

      // Compute BMI and body fat % from extracted values
      const weight = result.weight || 0;
      const heightCm = result.height;
      const bodyFat = result.body_fat_mass || 0;
      const bmi = (heightCm && heightCm > 0)
        ? Math.round((weight / ((heightCm / 100) ** 2)) * 10) / 10
        : undefined;
      const bodyFatPct = (weight > 0 && bodyFat > 0)
        ? Math.round((bodyFat / weight) * 1000) / 10
        : undefined;

      // Map OCR result to Database model (fields match InBodyResult in models.py)
      const entryData = {
        weight,
        height: heightCm,
        muscleMass: result.skeletal_muscle_mass || 0,
        bodyFat,
        bmi,
        bodyFatPct,

        // Segmental Lean Analysis
        rightArmMuscle: result.segmental_lean_analysis?.right_arm_muscle,
        leftArmMuscle: result.segmental_lean_analysis?.left_arm_muscle,
        trunkMuscle: result.segmental_lean_analysis?.trunk_muscle,
        rightLegMuscle: result.segmental_lean_analysis?.right_leg_muscle,
        leftLegMuscle: result.segmental_lean_analysis?.left_leg_muscle,

        // Segmental Fat Analysis (Python SegmentalAnalysis reuses *_muscle field names)
        rightArmFat: result.segmental_fat_analysis?.right_arm_muscle,
        leftArmFat: result.segmental_fat_analysis?.left_arm_muscle,
        trunkFat: result.segmental_fat_analysis?.trunk_muscle,
        rightLegFat: result.segmental_fat_analysis?.right_leg_muscle,
        leftLegFat: result.segmental_fat_analysis?.left_leg_muscle,

        status: 'extracted',
        notes: 'AI Extracted from image',
      };

      // We don't save immediately, we return to the user for review
      return { result, entryData };
    } catch (error: any) {
      // Record failure metrics
      const durationSec = (Date.now() - startTime) / 1000;
      ocrExtractionsTotal.inc({ status: 'failure' });
      ocrExtractionDuration.observe(durationSec);

      console.error('Extraction failed:', error);
      throw new Error(`Failed to extract data: ${error.message}`);
    }
  }
};

