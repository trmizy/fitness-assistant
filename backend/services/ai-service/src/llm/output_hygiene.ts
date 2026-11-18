/**
 * Removes INTERNAL context from user-facing answers (V1 RC1, 2026-11-12; REAL HTTP/API rc-verify-v1b):
 *  - evidence labels the prompt uses for retrieval (E1, E2 …): "Theo **E1**, deload nên…" (H-04), "(E2)", "[E1]",
 *    "According to E3, …" — the claim stays, the label goes (real citations like "ISSN (Jäger 2017)" are untouched);
 *  - references to material the user never saw: "tham khảo các mẫu thực đơn … ở trên" (B4-25: the RAG meal templates),
 *    "tài liệu đã cung cấp", "the meal plans provided above". The sentence is removed — unless the answer itself shows that
 *    material earlier (a menu above in the same answer is a legitimate reference).
 * Provenance remains in the logs (retrievalDocs, manifest). Deterministic; never returns an empty answer.
 */
const LABEL = String.raw`\*{0,2}E\d{1,2}\*{0,2}`;
const LEAD_VI = new RegExp(String.raw`(^|[\n.!?]\s*|[-*•]\s+)(?:theo|dựa trên|dựa theo|như)\s+${LABEL}\s*[,:]\s*(\p{L})`, "giu");
const LEAD_EN = new RegExp(String.raw`(^|[\n.!?]\s*|[-*•]\s+)(?:according to|based on|per|as (?:shown|stated) in)\s+${LABEL}\s*[,:]\s*(\p{L})`, "giu");
const INLINE = new RegExp(String.raw`\s*[([]\s*${LABEL}(?:\s*[,;]\s*${LABEL})*\s*[)\]]`, "gu");
const MID = new RegExp(String.raw`\s+(?:theo|according to|như trong|in)\s+${LABEL}(?=[\s,.;:!?])`, "giu");

const UNSEEN_VI = /(?<![\p{L}])(?:các|những)?\s*(?:mẫu\s+)?(?:thực đơn|meal plan|tài liệu|nguồn tham khảo|dữ liệu tham khảo|ngữ cảnh)(?:\s+mẫu)?[^.!?\n]{0,60}?(?:ở trên|phía trên|bên trên|đã (?:được )?cung cấp|được cung cấp)(?![\p{L}])/iu;
const UNSEEN_EN = /\b(?:the\s+)?(?:documents?|sources?|context|meal plans?|templates?|sample menus?)\s+(?:provided|given|shown|listed)?\s*(?:above|provided)\b/i;
const MENU_SHOWN = /(?<![\p{L}])(?:bữa sáng|bữa trưa|bữa tối|breakfast|lunch|dinner)(?![\p{L}])|^\s*\|.*\|\s*$/imu;

export function stripInternalReferences(answer: string): { answer: string; labels: number; removedSentences: number } {
  let labels = 0;
  const cap = (c: string) => c.toUpperCase();
  let text = answer
    .replace(LEAD_VI, (_m, pre: string, first: string) => { labels++; return `${pre}${cap(first)}`; })
    .replace(LEAD_EN, (_m, pre: string, first: string) => { labels++; return `${pre}${cap(first)}`; })
    .replace(INLINE, () => { labels++; return ""; })
    .replace(MID, () => { labels++; return ""; });

  let removedSentences = 0;
  const lines = text.split("\n").map((line, li, all) => {
    const parts = line.split(/(?<=[.!?])\s+/u);
    const kept = parts.filter((sentence, si) => {
      const unseen = UNSEEN_VI.test(sentence) || UNSEEN_EN.test(sentence);
      if (!unseen) return true;
      const before = [...all.slice(0, li), ...parts.slice(0, si)].join("\n");
      if (MENU_SHOWN.test(before)) return true; // the material is shown above in THIS answer
      removedSentences++;
      return false;
    });
    return kept.join(" ");
  });
  text = lines.join("\n").replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1");
  // never empty / meaningless (same rule as context_fidelity_guard.ts): < 3 words or < 15% of the original → keep the original
  if (text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < 3 || text.replace(/[^\p{L}\p{N}]/gu, "").length < 0.15 * answer.replace(/[^\p{L}\p{N}]/gu, "").length) return { answer, labels: 0, removedSentences: 0 };
  return { answer: labels || removedSentences ? text : answer, labels, removedSentences };
}
