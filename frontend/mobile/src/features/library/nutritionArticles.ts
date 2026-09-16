/**
 * SH-16's pure parts. The articles themselves are static content copied verbatim from web
 * (`nutritionKnowledge.ts`) — the manifest marks this screen as calling no backend, and the spec
 * behind the content says it must stay stable rather than be generated live.
 */

import { NUTRITION_ARTICLES, type NutritionArticle } from "./nutritionKnowledge";

export type { NutritionArticle };
export { NUTRITION_ARTICLES };

export const ARTICLE_CATEGORIES = {
  basics: "Cơ bản",
  "body-composition": "Thành phần cơ thể",
  performance: "Hiệu suất",
} as const;

export function categoryLabel(category: string): string {
  return (ARTICLE_CATEGORIES as Record<string, string>)[category] ?? category;
}

/** Web's own matcher: title, summary, and the body of every section. */
export function searchArticles(query: string): NutritionArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return NUTRITION_ARTICLES;
  return NUTRITION_ARTICLES.filter(
    (article) =>
      article.title.toLowerCase().includes(q) ||
      article.summary.toLowerCase().includes(q) ||
      article.sections.some(
        (section) =>
          section.heading.toLowerCase().includes(q) || section.body.toLowerCase().includes(q),
      ),
  );
}

export function findArticle(slug: string | undefined): NutritionArticle | null {
  if (!slug) return null;
  return NUTRITION_ARTICLES.find((article) => article.slug === slug) ?? null;
}

/** Total reading time of the library, for the hub's one-line summary. */
export function totalReadMinutes(): number {
  return NUTRITION_ARTICLES.reduce((sum, article) => sum + article.readMinutes, 0);
}
