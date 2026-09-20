import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { Apple, ChevronLeft, ChevronRight, Search } from "lucide-react-native";

import { Card, EmptyState, Input, Tappable, inputPlaceholderColor } from "../../../../src/components/ui";
import { foodService } from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import {
  FOOD_SORTS,
  MIN_FOOD_QUERY,
  caloriesLabel,
  foodTotalPages,
  gramLabel,
  normalizeFoods,
  type FoodItem,
  type FoodSort,
} from "../../../../src/features/library/foodLibrary";

const PAGE_SIZE = 20;

/**
 * SH-13 — the food catalog (13k USDA rows).
 *
 * Visual authority: `New Frontend/discover/FoodLibrary.tsx`. Its category chips are NOT built: the
 * `Food` table has no food-group column, and web says so in its own comment before offering what is
 * actually computable — sort by macro, and filter by supplement / has-image. The layout the design
 * specifies (search, a chip row, image + macros per row) is kept exactly; only the chips' meaning
 * follows the data.
 *
 * Search and browse are two different endpoints: `/food/search` fuzzy-matches and returns a bare
 * array with no paging, `/food` pages through everything. Sorting and filters only apply to browse,
 * so they hide while a search is running rather than pretending to affect it — same as web.
 */
export default function FoodLibraryScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<FoodSort>("name");
  const [supplement, setSupplement] = useState<"all" | "true" | "false">("all");
  const [onlyWithImage, setOnlyWithImage] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [sortBy, supplement, onlyWithImage]);

  const isSearching = search.length >= MIN_FOOD_QUERY;

  const searchQuery = useQuery({
    queryKey: ["food-search", search],
    queryFn: () => foodService.search(search),
    enabled: isSearching,
    staleTime: 60_000,
  });

  const browseQuery = useQuery({
    queryKey: ["food-browse", page, sortBy, supplement, onlyWithImage],
    queryFn: () =>
      foodService.list({
        page,
        limit: PAGE_SIZE,
        sortBy,
        ...(supplement === "all" ? {} : { isSupplement: supplement === "true" }),
        ...(onlyWithImage ? { hasImage: true } : {}),
      }),
    enabled: !isSearching,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const foods = useMemo(
    () => normalizeFoods(isSearching ? searchQuery.data : browseQuery.data),
    [isSearching, searchQuery.data, browseQuery.data],
  );
  const totalPages = isSearching ? 1 : foodTotalPages(browseQuery.data, PAGE_SIZE);
  const loading = isSearching ? searchQuery.isLoading : browseQuery.isLoading;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">Thư viện thực phẩm</Text>
      </View>

      <View className="px-5 pt-4">
        <Input
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Tìm thực phẩm…"
          placeholderTextColor={inputPlaceholderColor}
          icon={Search}
          autoCorrect={false}
        />
      </View>

      {/* Each row is wrapped in a plain View: a horizontal ScrollView left as a direct child of this
          column stretches to fill the screen's leftover height, which pushed the list far below the
          chips. Same wrapper the exercise library uses. */}
      {isSearching ? null : (
        <>
          <View className="pt-3">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="items-start gap-2 px-5"
            >
              {FOOD_SORTS.map((option) => (
                <Chip
                  key={option.value}
                  active={sortBy === option.value}
                  label={option.label}
                  onPress={() => setSortBy(option.value)}
                />
              ))}
            </ScrollView>
          </View>
          <View className="pt-2">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="items-start gap-2 px-5"
            >
              <Chip active={supplement === "all"} label="Tất cả loại" onPress={() => setSupplement("all")} />
              <Chip active={supplement === "false"} label="Thực phẩm thường" onPress={() => setSupplement("false")} />
              <Chip active={supplement === "true"} label="Thực phẩm bổ sung" onPress={() => setSupplement("true")} />
              <Chip active={onlyWithImage} label="Có ảnh" onPress={() => setOnlyWithImage((v) => !v)} />
            </ScrollView>
          </View>
        </>
      )}

      <Text className="px-6 pb-1 pt-3 font-body text-xs text-muted-foreground">
        Giá trị dinh dưỡng trên 100 g
        {isSearching ? ` · ${foods.length} kết quả` : ` · trang ${page}/${totalPages}`}
      </Text>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : foods.length === 0 ? (
        <EmptyState
          icon={Apple}
          title="Không tìm thấy thực phẩm nào"
          description={
            isSearching
              ? "Catalog là dữ liệu USDA — thử từ khoá tiếng Anh, ví dụ “chicken breast”."
              : "Thử bỏ bớt bộ lọc."
          }
        />
      ) : (
        <FlashList
          data={foods}
          keyExtractor={(item: FoodItem) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View className="h-2.5" />}
          renderItem={({ item }) => (
            <Card
              className="flex-row items-center gap-3 p-3"
              onPress={() =>
                router.push({ pathname: "/client/library/foods/[id]", params: { id: item.id } })
              }
            >
              <View className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-panel">
                {item.imageUrl ? (
                  <Image
                    source={{ uri: item.imageUrl }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={item.id}
                  />
                ) : (
                  <View className="h-full w-full items-center justify-center">
                    <Apple size={20} color={accent.primary} />
                  </View>
                )}
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
                  {item.name}
                </Text>
                <Text className="mt-0.5 font-body text-xs text-muted-foreground">
                  {caloriesLabel(item.calories)}
                  {item.foodForm ? ` · ${item.foodForm}` : ""}
                </Text>
                <View className="mt-1.5 flex-row gap-3">
                  <Text className="font-body text-xs text-primary">{gramLabel(item.protein)} đạm</Text>
                  <Text className="font-body text-xs" style={{ color: "#a78bfa" }}>
                    {gramLabel(item.carbs)} tinh bột
                  </Text>
                  <Text className="font-body text-xs text-warning">{gramLabel(item.fats)} béo</Text>
                </View>
              </View>
              <ChevronRight size={18} color="#8b9299" />
            </Card>
          )}
          ListFooterComponent={
            isSearching ? null : (
              <View className="flex-row items-center justify-between pt-4">
                <Tappable
                  className={`flex-row items-center gap-1 rounded-xl border border-border px-3.5 py-2 ${page <= 1 ? "opacity-40" : ""}`}
                  disabled={page <= 1}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={16} color="#8b9299" />
                  <Text className="font-body text-xs text-muted-foreground">Trước</Text>
                </Tappable>
                <Text className="font-body text-xs text-muted-foreground">
                  {page}/{totalPages}
                  {browseQuery.isFetching ? " · đang tải…" : ""}
                </Text>
                <Tappable
                  className={`flex-row items-center gap-1 rounded-xl border border-border px-3.5 py-2 ${page >= totalPages ? "opacity-40" : ""}`}
                  disabled={page >= totalPages}
                  onPress={() => setPage((p) => p + 1)}
                >
                  <Text className="font-body text-xs text-muted-foreground">Sau</Text>
                  <ChevronRight size={16} color="#8b9299" />
                </Tappable>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Tappable
      className={`rounded-full border px-3.5 py-1.5 ${active ? "border-primary bg-primary/15" : "border-border bg-card"}`}
      onPress={onPress}
    >
      <Text className={`font-body-medium text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Tappable>
  );
}
