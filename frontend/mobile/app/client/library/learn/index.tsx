import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BookOpen, ChevronLeft, ChevronRight, Clock, Search } from "lucide-react-native";

import { Badge, Card, EmptyState, Input, Stagger, StaggerItem, Tappable, inputPlaceholderColor } from "../../../../src/components/ui";
import {
  NUTRITION_ARTICLES,
  categoryLabel,
  searchArticles,
  totalReadMinutes,
} from "../../../../src/features/library/nutritionArticles";

/**
 * SH-16 — the nutrition knowledge library.
 *
 * Calls no backend at all, by design: the content is curated and versioned in the repo
 * (`nutritionKnowledge.ts`, copied verbatim from web) precisely so an explanation of what a calorie
 * is cannot drift between clients or be generated live by a model.
 *
 * The reference draws a photo on every card. The real articles carry no images — only text — so the
 * cards lead with the category and reading time instead of an invented picture.
 */
export default function NutritionKnowledgeScreen() {
  const insets = useSafeAreaInsets();

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const articles = useMemo(() => searchArticles(query), [query]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">Kiến thức dinh dưỡng</Text>
      </View>

      <Text className="px-6 pt-1 font-body text-sm text-muted-foreground">
        {NUTRITION_ARTICLES.length} bài giải thích ổn định · khoảng {totalReadMinutes()} phút đọc
      </Text>

      <View className="px-5 pt-4">
        <Input
          value={input}
          onChangeText={setInput}
          placeholder="Tìm calo, protein, TDEE…"
          placeholderTextColor={inputPlaceholderColor}
          icon={Search}
          autoCorrect={false}
        />
      </View>

      {articles.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Không có bài nào khớp"
          description={`Không tìm thấy gì cho "${query}". Thử một từ khoá khác, ví dụ "đạm" hay "TDEE".`}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Stagger className="gap-3">
            {articles.map((article) => (
              <StaggerItem key={article.slug}>
                <Card
                  className="p-4"
                  onPress={() =>
                    router.push({
                      pathname: "/client/library/learn/[slug]",
                      params: { slug: article.slug },
                    })
                  }
                >
                  <View className="mb-2 flex-row items-center gap-2">
                    <Badge tone="info">{categoryLabel(article.category)}</Badge>
                    <View className="flex-row items-center gap-1">
                      <Clock size={12} color="#8b9299" />
                      <Text className="font-body text-xs text-muted-foreground">
                        {article.readMinutes} phút đọc
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                      <BookOpen size={19} color="#22c55e" />
                    </View>
                    <View className="flex-1">
                      <Text className="font-display text-base text-foreground">{article.title}</Text>
                      <Text className="mt-0.5 font-body text-sm leading-5 text-muted-foreground" numberOfLines={2}>
                        {article.summary}
                      </Text>
                    </View>
                    <ChevronRight size={18} color="#8b9299" />
                  </View>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </ScrollView>
      )}
    </View>
  );
}
