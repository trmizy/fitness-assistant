import axios from "axios";
import { foodRepository } from "../repositories/food.repository";
import { boundedInt } from "./exercise.service";

async function fetchPexelsImage(foodName: string): Promise<string | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const res = await axios.get("https://api.pexels.com/v1/search", {
      params: { query: foodName, per_page: 1, orientation: "square" },
      headers: { Authorization: key },
      timeout: 5000,
    });
    return (res.data.photos?.[0]?.src?.medium as string) ?? null;
  } catch {
    return null;
  }
}

export const foodService = {
  async search(query: string) {
    const foods = await foodRepository.searchByName(query, 20);

    const missing = foods.filter((f) => !f.imageUrl).slice(0, 5);
    await Promise.all(
      missing.map(async (food) => {
        const imageUrl = await fetchPexelsImage(food.name);
        if (imageUrl) {
          await foodRepository.updateImageUrl(food.id, imageUrl);
          food.imageUrl = imageUrl;
        }
      }),
    );

    return foods;
  },

  // Product Completeness pass — Food Library browse page (§18/§19 of the
  // spec: "reuse existing nutrition/food source", never a parallel food
  // database). No category/food-group field exists on `Food` (verified —
  // not just unexposed), so this is deliberately search+sort only, no
  // classification filter invented. `sortBy` covers the "protein-rich /
  // carb-rich / fat-rich" sort the spec explicitly allows as real/derivable.
  async listFoods(filters: {
    page?: string | number;
    limit?: string | number;
    sortBy?: string;
    source?: string;
    foodForm?: string;
    isSupplement?: string | boolean;
    hasImage?: string | boolean;
  }) {
    const page = boundedInt(filters.page, 1, 1, 10_000);
    const limit = boundedInt(filters.limit, 30, 1, 100);
    const sortBy = (["protein", "carbs", "fats"] as const).includes(filters.sortBy as any)
      ? (filters.sortBy as "protein" | "carbs" | "fats")
      : "name";
    const source = String(filters.source ?? "").trim() || undefined;
    const foodForm = String(filters.foodForm ?? "").trim() || undefined;
    const supplementParam = filters.isSupplement;
    const isSupplement =
      supplementParam === true || supplementParam === "true"
        ? true
        : supplementParam === false || supplementParam === "false"
          ? false
          : undefined;
    const hasImage = filters.hasImage === true || filters.hasImage === "true";
    const { data, total } = await foodRepository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      sortBy,
      source,
      foodForm,
      isSupplement,
      hasImage,
    });
    return { foods: data, pagination: { page, limit, total } };
  },

  async getFilterOptions() {
    return foodRepository.getFilterOptions();
  },

  async getFood(id: string) {
    const food = await foodRepository.findById(id);
    if (!food) throw { status: 404, message: "Food not found" };
    return food;
  },
};
