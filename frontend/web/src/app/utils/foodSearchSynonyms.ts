function removeDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'));
}

function norm(s: string): string {
  return removeDiacritics(s.toLowerCase().trim());
}

const FOOD_SYNONYMS: Record<string, string> = {
  // Thịt & Protein
  "ức gà": "chicken breast",
  "ức gà luộc": "chicken breast cooked",
  "ức gà nướng": "chicken breast grilled",
  "đùi gà": "chicken thigh",
  "cánh gà": "chicken wings",
  "thịt gà": "chicken",
  "gà luộc": "chicken cooked",
  "gà nướng": "chicken grilled",
  "thịt bò": "beef",
  "thịt heo": "pork",
  "thịt lợn": "pork",
  "thịt heo nạc": "lean pork",
  "thịt kho": "pork cooked",
  "cá hồi": "salmon",
  "cá ngừ": "tuna",
  "cá basa": "basa fish",
  "cá rô phi": "tilapia",
  "tôm": "shrimp",
  "trứng": "egg",
  "trứng luộc": "hard boiled egg",
  "trứng chiên": "fried egg",
  "đậu phụ": "tofu",
  "đậu hũ": "tofu",
  "whey": "whey protein",
  // Tinh bột & Món Việt
  "cơm": "white rice cooked",
  "cơm trắng": "white rice cooked",
  "cơm gạo lứt": "brown rice cooked",
  "gạo lứt": "brown rice cooked",
  "cơm tấm": "pork rice",
  "bún bò": "beef rice noodles",
  "bún thịt nướng": "rice noodles pork",
  "yến mạch": "oats",
  "bánh mì": "white bread",
  "bánh mì đen": "whole wheat bread",
  "khoai lang": "sweet potato",
  "khoai tây": "potato",
  "khoai tây chiên": "french fries",
  "phở": "rice noodle soup",
  "bún": "rice noodles",
  "miến": "glass noodles",
  "mì": "noodles",
  "ngô": "corn",
  "bắp ngô": "corn",
  "canh": "soup",
  // Đậu
  "đậu đen": "black beans",
  "đậu xanh": "mung beans",
  "đậu nành": "soybeans",
  // Rau củ
  "bông cải xanh": "broccoli",
  "súp lơ xanh": "broccoli",
  "súp lơ trắng": "cauliflower",
  "rau cải bó xôi": "spinach",
  "rau bina": "spinach",
  "cà chua": "tomato",
  "cà rốt": "carrot",
  "xà lách": "lettuce",
  "bắp cải": "cabbage",
  "dưa chuột": "cucumber",
  "ớt chuông": "bell pepper",
  "đậu que": "green beans",
  "nấm": "mushroom",
  "cần tây": "celery",
  // Trái cây
  "chuối": "banana",
  "táo": "apple",
  "cam": "orange",
  "nước cam": "orange juice",
  "bưởi": "grapefruit",
  "xoài": "mango",
  "đu đủ": "papaya",
  "dứa": "pineapple",
  "dâu tây": "strawberry",
  "nho": "grapes",
  "kiwi": "kiwi",
  "lê": "pear",
  "dưa hấu": "watermelon",
  "việt quất": "blueberry",
  // Sữa & Dairy
  "sữa tươi": "whole milk",
  "sữa không đường": "skim milk",
  "sữa ít béo": "low fat milk",
  "sữa chua": "yogurt",
  "sữa chua hy lạp": "greek yogurt",
  "phô mai": "cheese",
  "cà phê sữa": "coffee milk",
  // Chất béo & Hạt
  "bơ": "butter",
  "bơ thực vật": "margarine",
  "dầu ô liu": "olive oil",
  "dầu dừa": "coconut oil",
  "bơ đậu phộng": "peanut butter",
  "đậu phộng": "peanuts",
  "hạt hạnh nhân": "almonds",
  "hạt óc chó": "walnuts",
  "hạt điều": "cashews",
  "hạt chia": "chia seeds",
  "hạt lanh": "flaxseeds",
  "quả bơ": "avocado",
  // Khác
  "mật ong": "honey",
  "đường": "sugar",
  "socola đen": "dark chocolate",
};

// Precompute once at module load — not per render
const NORMALIZED = Object.entries(FOOD_SYNONYMS).map(([vi, en]) => ({
  n: norm(vi),
  en,
}));

export interface TranslationResult {
  searchQuery: string;
  translated: boolean;
  originalQuery: string;
}

export function translateFoodQuery(query: string): TranslationResult {
  const original = query;
  if (!query.trim()) return { searchQuery: query, translated: false, originalQuery: original };

  const nq = norm(query);

  // 1. Exact match — highest priority
  const exact = NORMALIZED.find((e) => e.n === nq);
  if (exact) return { searchQuery: exact.en, translated: true, originalQuery: original };

  // 2. Prefix match: normalized query is a prefix of a known synonym key.
  //    e.g. "uc ga l" ("ức gà l") is a prefix of "uc ga luoc" ("ức gà luộc").
  //    Only triggers at nq.length >= 3 to avoid false positives with very short inputs.
  //    Heuristic: pick the shortest matching key — most general result for partial typing.
  if (nq.length >= 3) {
    const prefixMatches = NORMALIZED.filter((e) => e.n.startsWith(nq));
    if (prefixMatches.length > 0) {
      const best = prefixMatches.reduce((a, b) => (a.n.length <= b.n.length ? a : b));
      return { searchQuery: best.en, translated: true, originalQuery: original };
    }
  }

  return { searchQuery: query, translated: false, originalQuery: original };
}
