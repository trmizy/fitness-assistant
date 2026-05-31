import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

export interface VisionResult {
  measurement_date: string | null; // ISO date string "YYYY-MM-DD" extracted from the report
  weight: number | null;
  height: number | null;
  skeletal_muscle_mass: number | null;
  body_fat_mass: number | null;
  segmental_lean_analysis: {
    right_arm: number | null;
    left_arm: number | null;
    trunk: number | null;
    right_leg: number | null;
    left_leg: number | null;
  };
  segmental_fat_analysis: {
    right_arm: number | null;
    left_arm: number | null;
    trunk: number | null;
    right_leg: number | null;
    left_leg: number | null;
  };
}

const INBODY_TOOL: Anthropic.Tool = {
  name: 'extract_inbody_metrics',
  description: 'Extract all numeric measurements from an InBody body composition report image.',
  input_schema: {
    type: 'object',
    properties: {
      measurement_date: {
        type: 'string',
        description: 'The measurement/test date printed on the InBody report. Format: YYYY-MM-DD. Look for dates like "2024.05.01", "05/01/2024", "01-05-2024", or any printed date near the patient name or header. Return null if not visible.',
      },
      weight: { type: 'number', description: 'Total body weight in kg' },
      height: { type: 'number', description: 'Height in cm' },
      skeletal_muscle_mass: { type: 'number', description: 'Skeletal muscle mass in kg' },
      body_fat_mass: { type: 'number', description: 'Body fat mass in kg' },
      segmental_lean_analysis: {
        type: 'object',
        description: 'Lean (muscle) mass per body segment in kg from the silhouette chart',
        properties: {
          right_arm: { type: 'number', description: 'kg, expected 0.5–10' },
          left_arm: { type: 'number', description: 'kg, expected 0.5–10' },
          trunk: { type: 'number', description: 'kg, expected 10–60' },
          right_leg: { type: 'number', description: 'kg, expected 3–20' },
          left_leg: { type: 'number', description: 'kg, expected 3–20' },
        },
        required: ['right_arm', 'left_arm', 'trunk', 'right_leg', 'left_leg'],
      },
      segmental_fat_analysis: {
        type: 'object',
        description: 'Fat mass per body segment in kg from the silhouette chart',
        properties: {
          right_arm: { type: 'number', description: 'kg, expected 0–10' },
          left_arm: { type: 'number', description: 'kg, expected 0–10' },
          trunk: { type: 'number', description: 'kg, expected 0–50' },
          right_leg: { type: 'number', description: 'kg, expected 0–15' },
          left_leg: { type: 'number', description: 'kg, expected 0–15' },
        },
        required: ['right_arm', 'left_arm', 'trunk', 'right_leg', 'left_leg'],
      },
    },
    required: [
      'measurement_date', 'weight', 'height', 'skeletal_muscle_mass', 'body_fat_mass',
      'segmental_lean_analysis', 'segmental_fat_analysis',
    ],
  },
};

export async function extractInBodyVision(imagePath: string): Promise<VisionResult> {
  const base64Data = fs.readFileSync(imagePath).toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = (ext === '.png' ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg';

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.INBODY_VISION_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    tools: [INBODY_TOOL],
    tool_choice: { type: 'any' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: 'Extract all body composition metrics from this InBody report. IMPORTANT: Also extract the measurement_date printed on the report (the date when the test was taken) — it may appear near the patient name, header, or footer in formats like YYYY.MM.DD, MM/DD/YYYY, or similar. Convert it to YYYY-MM-DD format. The Segmental Lean Analysis and Segmental Fat Analysis sections show a body silhouette with kg values labeled per body part (right arm, left arm, trunk, right leg, left leg). Use null for any value that is not visible or cannot be read.',
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return structured InBody data');
  }
  return toolUse.input as VisionResult;
}
