function removeDiacritics(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"));
}

function norm(s: string): string {
  return removeDiacritics(s.toLowerCase().trim());
}

const FOOD_SYNONYMS: Record<string, string> = {
  // Thịt & Protein
  "ức gà": "chicken breast",
  "ức gà luộc": "chicken breast cooked",
  "ức gà nướng": "chicken breast grilled",
  "ức gà hấp": "chicken breast cooked",
  "thịt ức gà": "chicken breast",
  "đùi gà": "chicken thigh",
  "đùi gà luộc": "chicken thigh cooked",
  "cánh gà": "chicken wings",
  "cánh gà chiên": "chicken wings fried",
  "thịt gà": "chicken",
  "gà luộc": "chicken cooked",
  "gà nướng": "chicken grilled",
  "gà hấp": "chicken cooked",
  "gà chiên": "chicken fried",
  "thịt gà xay": "chicken ground",
  "thịt bò": "beef",
  "bò nạc": "beef lean",
  "bò xay": "beef ground",
  "bò nướng": "beef grilled",
  "thịt bò nướng": "beef grilled",
  "thịt bò luộc": "beef cooked",
  "bò kho": "beef braised",
  "thịt heo": "pork",
  "thịt lợn": "pork",
  "thịt heo nạc": "lean pork",
  "thịt heo xay": "pork ground",
  "thịt heo luộc": "pork cooked",
  "thịt kho": "pork braised",
  "sườn heo": "pork ribs",
  "ba chỉ heo": "pork belly",
  "thịt vịt": "duck",
  "vịt luộc": "duck cooked",
  "cá hồi": "salmon",
  "cá hồi nướng": "salmon grilled",
  "cá hồi hấp": "salmon cooked",
  "cá ngừ": "tuna",
  "cá ngừ đóng hộp": "tuna canned",
  "cá thu": "mackerel",
  "cá basa": "basa fish",
  "cá basa chiên": "basa fish fried",
  "cá rô phi": "tilapia",
  "cá tra": "catfish",
  "cá trắm": "carp",
  "cá kho": "fish braised",
  tôm: "shrimp",
  "tôm luộc": "shrimp cooked",
  "tôm nướng": "shrimp grilled",
  "tôm chiên": "shrimp fried",
  mực: "squid",
  "mực xào": "squid stir fried",
  trứng: "egg",
  "trứng gà": "chicken egg",
  "trứng luộc": "boiled egg",
  "trứng chiên": "fried egg",
  "trứng ốp la": "fried egg",
  "trứng hấp": "egg cooked",
  "lòng trắng trứng": "egg white",
  "lòng đỏ trứng": "egg yolk",
  "đậu phụ": "tofu",
  "đậu hũ": "tofu",
  "đậu phụ chiên": "tofu fried",
  whey: "whey protein",
  "whey protein": "whey protein",
  // Tinh bột & Món Việt
  cơm: "white rice cooked",
  "cơm trắng": "white rice cooked",
  "cơm gạo lứt": "brown rice cooked",
  "gạo lứt": "brown rice cooked",
  "cơm tấm": "pork rice",
  "bún bò": "beef rice noodles",
  "bún thịt nướng": "rice noodles pork",
  "bún chả": "rice noodles pork",
  "bún riêu": "rice noodle soup",
  phở: "rice noodle soup",
  "phở bò": "beef rice noodle soup",
  "phở gà": "chicken rice noodle soup",
  "hủ tiếu": "rice noodles",
  "yến mạch": "oats",
  "cháo yến mạch": "oatmeal cooked",
  "bánh mì": "white bread",
  "bánh mì đen": "whole wheat bread",
  "bánh mì sandwich": "sandwich bread",
  "khoai lang": "sweet potato",
  "khoai lang luộc": "sweet potato cooked",
  "khoai tây": "potato",
  "khoai tây luộc": "potato cooked",
  "khoai tây chiên": "french fries",
  bún: "rice noodles",
  miến: "glass noodles",
  "miến gà": "glass noodles chicken",
  mì: "noodles",
  "mì trứng": "egg noodles",
  "mì ý": "spaghetti cooked",
  pasta: "pasta cooked",
  nui: "pasta cooked",
  ngô: "corn",
  "bắp ngô": "corn",
  "bắp luộc": "corn cooked",
  canh: "soup",
  cháo: "rice porridge",
  "cháo gà": "chicken rice porridge",
  "cháo thịt": "pork rice porridge",
  "gỏi cuốn": "spring roll fresh",
  "chả giò": "spring roll fried",
  "nem rán": "spring roll fried",
  "canh chua": "sour soup",
  "canh rau": "vegetable soup",
  "canh bí đỏ": "pumpkin soup",
  // Đậu
  "đậu đen": "black beans",
  "đậu xanh": "mung beans",
  "đậu nành": "soybeans",
  "đậu lăng": "lentils",
  "đậu que": "green beans",
  "đậu phộng": "peanuts",
  // Rau củ
  "bông cải xanh": "broccoli",
  "súp lơ xanh": "broccoli",
  "súp lơ trắng": "cauliflower",
  "rau cải bó xôi": "spinach",
  "rau bina": "spinach",
  "rau muống": "water spinach",
  "cải xanh": "green cabbage",
  "cải thìa": "bok choy",
  "cà chua": "tomato",
  "cà rốt": "carrot",
  "xà lách": "lettuce",
  "bắp cải": "cabbage",
  "bắp cải tím": "red cabbage",
  "dưa chuột": "cucumber",
  "dưa leo": "cucumber",
  "ớt chuông": "bell pepper",
  "ớt chuông đỏ": "red bell pepper",
  "ớt chuông xanh": "green bell pepper",
  nấm: "mushroom",
  "nấm hương": "shiitake mushroom",
  "nấm kim châm": "enoki mushroom",
  "nấm rơm": "straw mushroom",
  "giá đỗ": "bean sprouts",
  "hành tây": "onion",
  "hành lá": "green onion",
  tỏi: "garlic",
  "cần tây": "celery",
  "bí đỏ": "pumpkin",
  "bí xanh": "zucchini",
  "cà tím": "eggplant",
  // Trái cây
  chuối: "banana",
  táo: "apple",
  cam: "orange",
  quýt: "mandarin orange",
  "nước cam": "orange juice",
  bưởi: "grapefruit",
  xoài: "mango",
  "đu đủ": "papaya",
  dứa: "pineapple",
  thơm: "pineapple",
  "dâu tây": "strawberry",
  nho: "grapes",
  kiwi: "kiwi",
  lê: "pear",
  "dưa hấu": "watermelon",
  "việt quất": "blueberry",
  "quả bơ": "avocado",
  "bơ trái": "avocado",
  "thanh long": "dragon fruit",
  vải: "lychee",
  nhãn: "longan",
  // Sữa & Dairy
  "sữa tươi": "whole milk",
  "sữa không đường": "skim milk",
  "sữa ít béo": "low fat milk",
  "sữa chua": "yogurt",
  "sữa chua hy lạp": "greek yogurt",
  "sữa chua Hy Lạp": "greek yogurt",
  "phô mai": "cheese",
  "phô mai tươi": "cottage cheese",
  "cà phê sữa": "coffee milk",
  "cà phê đen": "black coffee",
  "trà sữa": "milk tea",
  "nước dừa": "coconut water",
  "sinh tố chuối": "banana smoothie",
  "sinh tố bơ": "avocado smoothie",
  // Chất béo & Hạt
  bơ: "butter",
  "bơ thực vật": "margarine",
  "dầu ô liu": "olive oil",
  "dầu dừa": "coconut oil",
  "dầu mè": "sesame oil",
  "bơ đậu phộng": "peanut butter",
  "hạt hạnh nhân": "almonds",
  "hạt óc chó": "walnuts",
  "hạt điều": "cashews",
  "hạt chia": "chia seeds",
  "hạt lanh": "flaxseeds",
  // Khác
  "mật ong": "honey",
  đường: "sugar",
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
  if (!query.trim())
    return { searchQuery: query, translated: false, originalQuery: original };

  const nq = norm(query);

  // 1. Exact match — highest priority
  const exact = NORMALIZED.find((e) => e.n === nq);
  if (exact)
    return { searchQuery: exact.en, translated: true, originalQuery: original };

  // 2. Prefix match: normalized query is a prefix of a known synonym key.
  //    e.g. "uc ga l" ("ức gà l") is a prefix of "uc ga luoc" ("ức gà luộc").
  //    Only triggers at nq.length >= 3 to avoid false positives with very short inputs.
  //    Heuristic: pick the shortest matching key — most general result for partial typing.
  if (nq.length >= 3) {
    const prefixMatches = NORMALIZED.filter((e) => e.n.startsWith(nq));
    if (prefixMatches.length > 0) {
      const best = prefixMatches.reduce((a, b) =>
        a.n.length <= b.n.length ? a : b,
      );
      return {
        searchQuery: best.en,
        translated: true,
        originalQuery: original,
      };
    }
  }

  return { searchQuery: query, translated: false, originalQuery: original };
}
