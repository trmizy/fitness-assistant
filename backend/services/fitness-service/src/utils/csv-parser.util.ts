/**
 * Roadmap P2 "Canonical import framework" (docs/features/
 * CANONICAL_IMPORT_FRAMEWORK_IMPACT_ANALYSIS.md +
 * docs/features/STRONG_IMPORT_IMPACT_ANALYSIS.md).
 *
 * Minimal RFC4180-style CSV parser: handles quoted fields (including
 * embedded commas and escaped `""` quotes) and both \n and \r\n line
 * endings. Provider-agnostic — every per-provider parser
 * (hevy-csv-parser.util.ts, strong-csv-parser.util.ts, ...) uses this
 * same tokenizer, never a second copy. Not a general-purpose CSV
 * library — scoped to what these imports actually need.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"' && normalized[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  const [headers, ...dataRows] = nonEmpty;
  return { headers: (headers ?? []).map((h) => h.trim()), rows: dataRows };
}
