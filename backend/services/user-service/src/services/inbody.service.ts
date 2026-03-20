import { inbodyRepository } from '../repositories/inbody.repository';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const inbodyService = {
  async getHistory(userId: string) {
    return inbodyRepository.findByUserId(userId);
  },

  async getLatest(userId: string) {
    return inbodyRepository.findLatestByUserId(userId);
  },

  async createEntry(userId: string, data: any) {
    return inbodyRepository.create(userId, data);
  },

  async extractFromImage(_userId: string, imagePath: string) {
    try {
      // Call the Python OCR script
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      
      const { stdout, stderr } = await execAsync(`${pythonCmd} -m inbody_extractor --image "${imagePath}" --json`);
      
      if (stderr && !stdout) {
        throw new Error(`OCR Error: ${stderr}`);
      }

      const result = JSON.parse(stdout);
      
      // Map OCR result to Database model
      const entryData = {
        weight: result.composition?.weight || 0,
        height: result.composition?.height,
        muscleMass: result.composition?.skeletal_muscle_mass || 0,
        bodyFat: result.composition?.body_fat_mass || 0,
        bodyFatPct: result.composition?.percent_body_fat,
        bmi: result.composition?.bmi,
        bmr: result.composition?.bmr,
        
        // Segmental Lean
        rightArmMuscle: result.segmental_lean?.right_arm?.lean_mass,
        leftArmMuscle: result.segmental_lean?.left_arm?.lean_mass,
        trunkMuscle: result.segmental_lean?.trunk?.lean_mass,
        rightLegMuscle: result.segmental_lean?.right_leg?.lean_mass,
        leftLegMuscle: result.segmental_lean?.left_leg?.lean_mass,

        // Segmental Fat
        rightArmFat: result.segmental_fat?.right_arm?.fat_mass,
        leftArmFat: result.segmental_fat?.left_arm?.fat_mass,
        trunkFat: result.segmental_fat?.trunk?.fat_mass,
        rightLegFat: result.segmental_fat?.right_leg?.fat_mass,
        leftLegFat: result.segmental_fat?.left_leg?.fat_mass,

        status: 'extracted',
        notes: 'AI Extracted from image',
      };

      // We don't save immediately, we return to the user for review
      return { result, entryData };
    } catch (error: any) {
      console.error('Extraction failed:', error);
      throw new Error(`Failed to extract data: ${error.message}`);
    }
  }
};
