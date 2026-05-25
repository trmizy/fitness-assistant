import axios from 'axios';
import { foodRepository } from '../repositories/food.repository';

async function fetchPexelsImage(foodName: string): Promise<string | null> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: foodName, per_page: 1, orientation: 'square' },
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
};
