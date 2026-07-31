import { z } from "zod";

// Text inputs give us strings; empty string must become "not provided"
// (undefined), not coerce to 0 — z.coerce.number() would otherwise turn
// "" into 0 for optional fields, silently corrupting the data.
const emptyToUndefined = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);
const optionalNumber = (schema: z.ZodNumber) => z.preprocess(emptyToUndefined, schema.optional());
const requiredNumber = (schema: z.ZodNumber) => z.preprocess(emptyToUndefined, schema);

// backend/services/user-service InBodyEntry — weight/bodyFat/muscleMass
// are the only non-nullable columns in the Prisma model; everything else
// is optional. POST /inbody itself has no server-side Zod schema (free-
// form `data: any`), so this validation is purely client-side UX.
export const inBodyEntrySchema = z.object({
  weight: requiredNumber(z.coerce.number().positive("Cân nặng phải > 0")),
  bodyFat: requiredNumber(z.coerce.number().min(0, "Không được âm")),
  bodyFatPct: optionalNumber(z.coerce.number().min(0).max(100)),
  muscleMass: requiredNumber(z.coerce.number().positive("Khối cơ phải > 0")),
  visceralFat: optionalNumber(z.coerce.number().min(0)),
  bmr: optionalNumber(z.coerce.number().int().positive()),
  height: optionalNumber(z.coerce.number().positive()),
  notes: z.string().optional(),
});

export type InBodyEntryFormValues = z.infer<typeof inBodyEntrySchema>;
