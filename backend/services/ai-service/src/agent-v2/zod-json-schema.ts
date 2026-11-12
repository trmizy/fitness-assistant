/**
 * Gymini V2 (EXPERIMENTAL) — minimal Zod → JSON Schema for tool input schemas offered to the model.
 *
 * Covers exactly the constructs the Training contracts use (object/strict, string min/max/uuid, number int/min/max,
 * boolean, enum, literal, array min/max, optional). Anything else throws, so an unsupported schema is caught by a test
 * instead of silently producing a permissive schema. The model-facing schema is advisory; the registry still validates
 * every argument with the real Zod schema.
 */
import { z } from "zod";

type Json = Record<string, unknown>;

export function zodToJsonSchema(schema: z.ZodTypeAny): Json {
  const def: any = (schema as any)._def;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as z.AnyZodObject).shape;
      const properties: Json = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const v = value as z.ZodTypeAny;
        properties[key] = zodToJsonSchema(v);
        if (!v.isOptional()) required.push(key);
      }
      return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
    }
    case z.ZodFirstPartyTypeKind.ZodOptional:
      return zodToJsonSchema(def.innerType);
    case z.ZodFirstPartyTypeKind.ZodString: {
      const out: Json = { type: "string" };
      for (const c of def.checks ?? []) {
        if (c.kind === "min") out.minLength = c.value;
        else if (c.kind === "max") out.maxLength = c.value;
        else if (c.kind === "uuid") out.format = "uuid";
      }
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const out: Json = { type: "number" };
      for (const c of def.checks ?? []) {
        if (c.kind === "int") out.type = "integer";
        else if (c.kind === "min") out.minimum = c.value;
        else if (c.kind === "max") out.maximum = c.value;
      }
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: "boolean" };
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { type: "string", enum: [...def.values] };
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return { const: def.value };
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const out: Json = { type: "array", items: zodToJsonSchema(def.type) };
      if (def.minLength) out.minItems = def.minLength.value;
      if (def.maxLength) out.maxItems = def.maxLength.value;
      return out;
    }
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return zodToJsonSchema(def.schema);
    default:
      throw new Error(`zodToJsonSchema: unsupported schema type ${def.typeName}`);
  }
}
