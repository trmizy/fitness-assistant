export type NutritionArticle = {
  slug: string;
  title: string;
  summary: string;
  category: "basics" | "body-composition" | "performance";
  readMinutes: number;
  updatedAt: string;
  sourceNote: string;
  sections: Array<{ heading: string; body: string }>;
};

// Nutrition Knowledge Library — curated, static, versioned content (spec
// §20/§21: never generated live by an LLM; canonical article stays stable,
// "Hỏi AI về chủ đề này" on the article page is the live-explanation escape
// hatch, not the source of truth). Vietnamese, matching every other
// client-facing page in this app.
export const NUTRITION_ARTICLES: NutritionArticle[] = [
  {
    slug: "calories",
    title: "Calo",
    summary: "Calo là gì, và vì sao cân bằng năng lượng lại quan trọng.",
    category: "basics",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Nội dung giáo dục do sản phẩm biên soạn, không phải tư vấn y khoa.",
    sections: [
      {
        heading: "Ý chính",
        body: "Calo là đơn vị đo năng lượng. Trong ứng dụng này, mục tiêu calo hằng ngày do hệ thống tính toán dựa trên hồ sơ và mục tiêu của bạn, rồi hiển thị theo đơn vị kcal.",
      },
      {
        heading: "Cách áp dụng",
        body: "Theo dõi calo đều đặn để thấy xu hướng thay đổi. Một ngày ăn khác thường không quan trọng bằng mức trung bình của nhiều ngày liên tiếp.",
      },
    ],
  },
  {
    slug: "protein",
    title: "Protein (Đạm)",
    summary: "Protein hỗ trợ phục hồi cơ, phát triển cơ và cảm giác no.",
    category: "basics",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Kiến thức dinh dưỡng thể thao phổ thông cho người trưởng thành khoẻ mạnh.",
    sections: [
      {
        heading: "Ý chính",
        body: "Protein cung cấp axit amin để cơ thể phục hồi và xây dựng mô. Tập luyện sức mạnh làm tăng nhu cầu protein hằng ngày.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Chia đều protein qua các bữa nếu điều đó giúp bạn duy trì thói quen. Tổng lượng protein trong ngày thường quan trọng hơn thời điểm ăn chính xác.",
      },
    ],
  },
  {
    slug: "carbohydrates",
    title: "Carbohydrate (Tinh bột/Đường)",
    summary: "Carb là nguồn nhiên liệu chính cho tập luyện và hoạt động hằng ngày.",
    category: "basics",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Nội dung giáo dục sản phẩm, không dành cho hướng dẫn theo bệnh lý cụ thể.",
    sections: [
      {
        heading: "Ý chính",
        body: "Carbohydrate được phân giải thành glucose và một phần dự trữ dưới dạng glycogen. Buổi tập nặng thường cảm thấy tốt hơn khi lượng carb nạp vào không quá thấp.",
      },
      {
        heading: "Lựa chọn thực phẩm",
        body: "Ngũ cốc nguyên hạt, trái cây, khoai tây, gạo và các loại đậu đều phù hợp. Chọn loại thực phẩm hỗ trợ kế hoạch và hệ tiêu hoá của bạn.",
      },
    ],
  },
  {
    slug: "fat",
    title: "Chất béo",
    summary: "Chất béo đậm đặc năng lượng và hỗ trợ các chức năng cơ thể bình thường.",
    category: "basics",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Nội dung giáo dục sản phẩm, không phải tư vấn điều trị y khoa.",
    sections: [
      {
        heading: "Ý chính",
        body: "Chất béo trong khẩu phần cung cấp năng lượng và hỗ trợ chức năng hormone, tế bào bình thường. Chất béo đậm đặc calo, nên khẩu phần ăn có thể làm tổng calo thay đổi nhanh.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Các loại hạt, dầu ăn, bơ, trứng, sữa, cá và thịt đều là nguồn chất béo. Cân đối lượng nạp vào theo mục tiêu calo và sở thích cá nhân.",
      },
    ],
  },
  {
    slug: "bmr",
    title: "BMR (Chuyển hoá cơ bản)",
    summary: "BMR ước tính năng lượng cơ thể tiêu hao khi nghỉ ngơi.",
    category: "body-composition",
    readMinutes: 2,
    updatedAt: "2026-09-01",
    sourceNote: "Kết quả ước tính khác nhau tuỳ công thức và từng cá nhân.",
    sections: [
      {
        heading: "Ý chính",
        body: "BMR ước tính năng lượng cơ thể bạn tiêu hao khi hoàn toàn nghỉ ngơi. Đây là điểm khởi đầu, không phải số đo chính xác tuyệt đối.",
      },
      {
        heading: "Trong ứng dụng",
        body: "Fitness Assistant dùng dữ liệu hồ sơ để ước tính nhu cầu năng lượng, sau đó cập nhật khuyến nghị theo mục tiêu và mức độ vận động.",
      },
    ],
  },
  {
    slug: "tdee",
    title: "TDEE (Tổng năng lượng tiêu hao hằng ngày)",
    summary: "TDEE ước tính tổng năng lượng bạn tiêu hao trong một ngày.",
    category: "body-composition",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Nội dung giáo dục sản phẩm cho việc lập kế hoạch tổng quát.",
    sections: [
      {
        heading: "Ý chính",
        body: "TDEE bắt đầu từ năng lượng tiêu hao khi nghỉ ngơi rồi cộng thêm năng lượng do vận động. Đây là con số ước tính, cần đối chiếu với xu hướng cân nặng thực tế.",
      },
      {
        heading: "Vì sao TDEE thay đổi",
        body: "Tập luyện, số bước đi, cân nặng, giấc ngủ và mức độ tuân thủ kế hoạch đều có thể làm thay đổi nhu cầu năng lượng thực tế.",
      },
    ],
  },
  {
    slug: "calorie-deficit",
    title: "Thâm hụt calo",
    summary: "Thâm hụt calo nghĩa là nạp năng lượng ít hơn mức tiêu hao theo thời gian.",
    category: "body-composition",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Không phải chỉ định giảm cân theo y khoa.",
    sections: [
      {
        heading: "Ý chính",
        body: "Thâm hụt calo thường dẫn đến giảm cân theo thời gian. Câu hỏi quan trọng là mức thâm hụt đó có bền vững và phù hợp với việc tập luyện hay không.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Mức thâm hụt vừa phải, đều đặn thường dễ duy trì hơn cắt giảm quá mạnh. Theo dõi năng lượng, hồi phục và cảm giác đói để điều chỉnh kịp thời.",
      },
    ],
  },
  {
    slug: "calorie-surplus",
    title: "Thặng dư calo",
    summary: "Thặng dư calo hỗ trợ giai đoạn tăng cân và xây dựng cơ bắp.",
    category: "body-composition",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Kiến thức dinh dưỡng thể thao phổ thông.",
    sections: [
      {
        heading: "Ý chính",
        body: "Thặng dư calo nghĩa là nạp năng lượng nhiều hơn mức tiêu hao. Kết hợp với tập luyện tiến bộ, điều này có thể hỗ trợ tăng cơ.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Thặng dư càng lớn không đồng nghĩa hiệu quả càng cao. Tăng cân từ từ có thể giảm tích mỡ không mong muốn mà vẫn hỗ trợ tập luyện.",
      },
    ],
  },
  {
    slug: "protein-muscle-gain",
    title: "Protein và tăng cơ",
    summary: "Vì sao protein và tập luyện tiến bộ cần đi cùng nhau.",
    category: "performance",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Kiến thức thể dục phổ thông cho người trưởng thành khoẻ mạnh.",
    sections: [
      {
        heading: "Ý chính",
        body: "Tăng cơ cần có kích thích tập luyện, đủ năng lượng và đủ protein. Chỉ riêng protein không thể thay thế việc tập luyện sức mạnh có tiến bộ.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Dùng kế hoạch trong ứng dụng làm mục tiêu chuẩn. Không tự ý thay đổi quy tắc tập luyện qua trò chuyện với AI hay trong Cài đặt.",
      },
    ],
  },
  {
    slug: "protein-fat-loss",
    title: "Protein và giảm mỡ",
    summary: "Protein có thể hỗ trợ ra sao trong giai đoạn giảm cân.",
    category: "body-composition",
    readMinutes: 3,
    updatedAt: "2026-09-01",
    sourceNote: "Không phải tư vấn dinh dưỡng y khoa cá nhân hoá.",
    sections: [
      {
        heading: "Ý chính",
        body: "Trong giai đoạn giảm mỡ, protein có thể giúp giữ lại khối cơ nếu kết hợp với tập sức mạnh và hồi phục đầy đủ.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Vẫn cần chú ý tổng mục tiêu calo. Protein hỗ trợ, nhưng không thể bù đắp cho cân bằng năng lượng tổng thể.",
      },
    ],
  },
  {
    slug: "hydration",
    title: "Bù nước",
    summary: "Nhu cầu nước thay đổi theo mồ hôi, nhiệt độ và thời lượng tập.",
    category: "performance",
    readMinutes: 2,
    updatedAt: "2026-09-01",
    sourceNote: "Kiến thức bù nước phổ thông, không phải hướng dẫn lâm sàng.",
    sections: [
      {
        heading: "Ý chính",
        body: "Bù nước hỗ trợ chất lượng tập luyện và các hoạt động hằng ngày. Nhu cầu tăng lên khi buổi tập dài hơn, nóng hơn hoặc ra nhiều mồ hôi hơn.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Dùng cảm giác khát, màu nước tiểu, hiệu suất tập luyện và thay đổi cân nặng quanh các buổi tập dài làm tín hiệu tham khảo đơn giản.",
      },
    ],
  },
  {
    slug: "meal-timing",
    title: "Thời điểm ăn uống",
    summary: "Thời điểm ăn có thể hỗ trợ hiệu suất, nhưng sự đều đặn quan trọng hơn.",
    category: "performance",
    readMinutes: 2,
    updatedAt: "2026-09-01",
    sourceNote: "Kiến thức thể dục phổ thông.",
    sections: [
      {
        heading: "Ý chính",
        body: "Thời điểm ăn có thể ảnh hưởng đến cảm giác thoải mái và chất lượng buổi tập. Hầu hết mọi người nên ưu tiên tổng lượng calo hằng ngày và những bữa ăn có thể duy trì lâu dài trước.",
      },
      {
        heading: "Áp dụng thực tế",
        body: "Ăn quá sát giờ tập nặng có thể gây nặng bụng; đợi quá lâu có thể khiến bạn thiếu năng lượng. Hãy tìm nhịp ăn phù hợp mà bạn có thể duy trì.",
      },
    ],
  },
];

export function findNutritionArticle(slug?: string) {
  return NUTRITION_ARTICLES.find((article) => article.slug === slug);
}
