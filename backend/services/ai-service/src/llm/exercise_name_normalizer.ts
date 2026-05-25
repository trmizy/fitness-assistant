import * as fs from 'fs';
import * as path from 'path';

const CATALOG_PATH = 'data/catalog/plans/gym_exercises.csv';

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function resolveCatalogFile(): string | null {
  const envPath = process.env.EXERCISE_CATALOG_PATH;
  const candidates = [
    envPath ? path.resolve(process.cwd(), envPath) : null,
    path.resolve(process.cwd(), CATALOG_PATH),
    path.resolve(process.cwd(), '../../..', CATALOG_PATH),
    path.resolve(process.cwd(), '../../../..', CATALOG_PATH),
    path.resolve(__dirname, '../../../../../', CATALOG_PATH),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasVietnameseSignals(text: string): boolean {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộúùủũụýỳỷỹỵ]/i.test(text)
    || /\b(tay|nguc|lung|vai|chan|mong|bung|cuon|day|duoi|keo|day cap|cap|ta don|ta don 1 tay)\b/i.test(text);
}

function loadExerciseNameMap(): Map<string, string> {
  const catalogFile = resolveCatalogFile();
  const mapping = new Map<string, string>();
  if (!catalogFile) return mapping;

  try {
    const rawLines = fs.readFileSync(catalogFile, 'utf-8').split('\n');
    const rows = rawLines.slice(1).map((line) => line.replace(/\r$/, '')).filter((line) => line.trim().length > 0);

    for (const row of rows) {
      const columns = parseCSVLine(row);
      const exerciseNameVi = columns[1]?.trim();
      const exerciseNameEn = columns[2]?.trim();
      const aliasesVi = columns[3]?.trim();

      if (!exerciseNameVi || !exerciseNameEn) continue;

      mapping.set(exerciseNameVi.toLowerCase(), exerciseNameEn);

      if (aliasesVi) {
        for (const alias of aliasesVi.split(';').map((item) => item.trim()).filter(Boolean)) {
          mapping.set(alias.toLowerCase(), exerciseNameEn);
        }
      }
    }
  } catch {
    return new Map();
  }

  return mapping;
}

const exerciseNameMap = loadExerciseNameMap();
const exerciseNamePatterns = Array.from(exerciseNameMap.entries())
  .sort((a, b) => b[0].length - a[0].length)
  .map(([rawName, canonicalName]) => ({ rawName, canonicalName, regex: new RegExp(escapeRegExp(rawName), 'gi') }));

export function normalizeExerciseNames(text: string): string {
  if (!hasVietnameseSignals(text)) {
    return text;
  }

  let normalized = text;

  for (const entry of exerciseNamePatterns) {
    normalized = normalized.replace(entry.regex, entry.canonicalName);
  }

  return normalized;
}