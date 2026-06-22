/**
 * A robust JSON parser that handles markdown fences and extracts balanced JSON objects.
 * Safely parses even if braces exist within string properties.
 */
export function safeParseJsonCandidate(raw: string): unknown | null {
  // Strip common code fences and labels
  const cleaned = String(raw || '')
    .replace(/```\s*json\s*/i, '')
    .replace(/```/g, '')
    .replace(/^\s*JSON\s*[:\-]\s*/i, '')
    .trim();

  // Find first balanced JSON object (handles braces within strings)
  function extractBalanced(s: string): string | null {
    const start = s.indexOf('{');
    if (start === -1) return null;
    
    let inString = false;
    let escape = false;
    let depth = 0;
    
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return null;
  }

  // Try full-parse first
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const candidate = extractBalanced(cleaned);
  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      const repaired = candidate.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"');
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}
