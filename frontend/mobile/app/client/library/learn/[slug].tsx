import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { BookOpen, ChevronLeft, Clock } from "lucide-react-native";

import { Badge, Card, EmptyState, Tappable } from "../../../../src/components/ui";
import { categoryLabel, findArticle } from "../../../../src/features/library/nutritionArticles";

/**
 * SH-16 (article). Static text, so there is no loading state and nothing to refetch.
 *
 * Web's article page also offers "Hỏi AI về chủ đề này" — a live explanation as an escape hatch
 * from the canonical text. That belongs to the AI Coach domain (Phase 9) and is not faked here; the
 * article ends with its own source note, which is what the content itself claims.
 */
export default function NutritionArticleScreen() {
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const article = findArticle(slug);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}
    >
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground" numberOfLines={1}>
          {article ? categoryLabel(article.category) : "Kiến thức"}
        </Text>
      </View>

      {!article ? (
        <EmptyState
          icon={BookOpen}
          title="Không tìm thấy bài viết"
          description="Bài này có thể đã được đổi tên trong thư viện kiến thức."
        />
      ) : (
        <View className="px-5 pt-4">
          <View className="flex-row items-center gap-2">
            <Badge tone="info">{categoryLabel(article.category)}</Badge>
            <View className="flex-row items-center gap-1">
              <Clock size={12} color="#8b9299" />
              <Text className="font-body text-xs text-muted-foreground">
                {article.readMinutes} phút đọc
              </Text>
            </View>
          </View>

          <Text className="font-display mt-2 text-2xl leading-tight text-foreground">
            {article.title}
          </Text>
          <Text className="mt-2 font-body text-sm leading-6 text-muted-foreground">
            {article.summary}
          </Text>

          <View className="mt-5 gap-4">
            {article.sections.map((section, index) => (
              <View key={`${article.slug}-${index}`}>
                <Text className="font-body-semibold text-sm text-foreground">{section.heading}</Text>
                <Text className="mt-1.5 font-body text-sm leading-6 text-muted-foreground">
                  {section.body}
                </Text>
              </View>
            ))}
          </View>

          <Card className="mt-6 p-4">
            <Text className="font-body text-[11px] leading-5 text-muted-foreground">
              {article.sourceNote}
            </Text>
            <Text className="mt-1 font-body text-[11px] text-muted-foreground">
              Cập nhật {new Date(article.updatedAt).toLocaleDateString("vi-VN")}
            </Text>
          </Card>
        </View>
      )}
    </ScrollView>
  );
}
