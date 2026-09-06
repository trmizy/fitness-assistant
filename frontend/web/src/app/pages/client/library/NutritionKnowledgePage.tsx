import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { BookOpenIcon as BookOpen, CaretRightIcon as ChevronRight, MagnifyingGlassIcon as Search } from "@phosphor-icons/react";
import { NUTRITION_ARTICLES } from "./nutritionKnowledge";

const CATEGORY_LABELS = {
  basics: "Cơ bản",
  "body-composition": "Thành phần cơ thể",
  performance: "Hiệu suất",
} as const;

export function NutritionKnowledgePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const articles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NUTRITION_ARTICLES;
    return NUTRITION_ARTICLES.filter(
      (article) =>
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q) ||
        article.sections.some(
          (section) =>
            section.heading.toLowerCase().includes(q) ||
            section.body.toLowerCase().includes(q),
        ),
    );
  }, [query]);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <BookOpen className="w-5 h-5 text-amber-400" /> Kiến thức dinh dưỡng
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Giải thích ổn định, được biên soạn kỹ cho các khái niệm dinh dưỡng ứng dụng sử dụng
        </p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          data-testid="nutrition-knowledge-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm calo, protein, TDEE..."
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900 text-sm text-zinc-200 outline-none focus:ring-2 focus:ring-amber-500/40"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="nutrition-knowledge-results">
        {articles.map((article) => (
          <button
            key={article.slug}
            type="button"
            data-testid={`nutrition-article-card-${article.slug}`}
            onClick={() => navigate(`/client/learn/nutrition/${article.slug}`)}
            className="flex items-start justify-between gap-3 text-left bg-zinc-900 border border-zinc-800/60 hover:border-zinc-700 rounded-xl p-3.5 transition-all"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-zinc-200 truncate">{article.title}</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 flex-shrink-0">
                  {CATEGORY_LABELS[article.category]}
                </span>
              </div>
              <p className="text-xs text-zinc-500 mt-1">{article.summary}</p>
              <p className="text-[11px] text-zinc-600 mt-2">{article.readMinutes} phút đọc</p>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600 mt-0.5 flex-shrink-0" />
          </button>
        ))}
      </div>

      {articles.length === 0 && (
        <div className="text-center py-16 text-sm text-zinc-500">
          Chưa có bài viết phù hợp.
        </div>
      )}
    </div>
  );
}
