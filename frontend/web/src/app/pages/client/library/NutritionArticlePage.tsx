import { useNavigate, useParams } from "react-router";
import { ArrowLeftIcon as ArrowLeft, BookOpenIcon as BookOpen, ChatTextIcon as MessageSquare } from "@phosphor-icons/react";
import { findNutritionArticle } from "./nutritionKnowledge";

export function NutritionArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const article = findNutritionArticle(slug);

  if (!article) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center text-sm text-zinc-500">
        Không tìm thấy bài viết này.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate("/client/learn/nutrition")}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại Kiến thức dinh dưỡng
      </button>

      <article className="space-y-4" data-testid="nutrition-article-detail">
        <header>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <BookOpen className="w-5 h-5 text-amber-400" /> {article.title}
          </h1>
          <p className="text-zinc-500 text-sm mt-1">{article.summary}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
              Cập nhật {article.updatedAt}
            </span>
            <span className="text-[11px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-400">
              {article.readMinutes} phút đọc
            </span>
          </div>
        </header>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100/80">
          {article.sourceNote} Fitness Assistant không chẩn đoán hay điều trị bệnh lý.
        </div>

        {article.sections.map((section) => (
          <section key={section.heading} className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-zinc-200">{section.heading}</h2>
            <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{section.body}</p>
          </section>
        ))}

        <button
          type="button"
          onClick={() => navigate("/client/chat")}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-green-500 text-black py-2.5 text-sm font-bold hover:bg-green-400 transition-colors"
        >
          <MessageSquare className="w-4 h-4" /> Hỏi AI về chủ đề này
        </button>
      </article>
    </div>
  );
}
