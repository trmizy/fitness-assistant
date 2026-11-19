/**
 * Bài viết MẪU cho bản thiết kế. Nội dung viết thận trọng, mang tính phổ thông;
 * cần chuyên gia/biên tập viên duyệt trước khi phát hành thật.
 */
export type Article = {
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  minutes: number;
  image: string; // tên ảnh trong public/media (không đuôi kích thước)
  imageAlt: string;
  credit: string;
  body: { h?: string; p?: string; list?: string[] }[];
  inGymini: string;
};

export const ARTICLES: Article[] = [
  {
    slug: "rpe-la-gi",
    category: "Tập luyện",
    title: "RPE: thang 10 điểm giúp bạn chọn đúng mức tạ",
    excerpt: "Cùng một mức tạ, có hôm nhẹ tênh, có hôm rất nặng. RPE giúp bạn ghi lại cảm nhận đó bằng một con số.",
    minutes: 4,
    image: "art-rpe",
    imageAlt: "IFBB Pro Hoàng Hải Đăng tạo dáng trên sân khấu NPC Vietnam",
    credit: "IFBB Pro Hoàng Hải Đăng",
    body: [
      { p: "RPE (Rating of Perceived Exertion) là thang tự đánh giá mức gắng sức. Trong tập tạ, cách dùng phổ biến là gắn RPE với số lần bạn còn có thể làm thêm trước khi không nâng nổi nữa." },
      { h: "Đọc thang RPE thế nào", list: [
        "RPE 10: không thể làm thêm lần nào.",
        "RPE 9: còn khoảng 1 lần nữa.",
        "RPE 8: còn khoảng 2 lần nữa.",
        "RPE 7 trở xuống: còn từ 3 lần trở lên, hiệp tập khá thoải mái.",
      ] },
      { h: "Vì sao không chỉ ghi số kg", p: "Sức của bạn thay đổi theo giấc ngủ, ăn uống và căng thẳng trong ngày. Ghi thêm RPE cho thấy một mức tạ đang nặng hay nhẹ với bạn ở thời điểm đó, nên bạn và huấn luyện viên dễ quyết định tăng, giữ hay giảm." },
      { h: "Mẹo cho người mới", p: "Đánh giá RPE cần thời gian để quen. Giai đoạn đầu, hãy ghi trung thực và chấp nhận sai số một hai điểm. Không nên cố tập tới RPE 10 ở các bài nhiều khớp như squat hay deadlift khi chưa có người bảo hộ." },
    ],
    inGymini: "Khi ghi buổi tập, bạn có thể nhập mức tạ, số hiệp, số lần và RPE của từng bài. Số liệu này cùng các chỉ số khác được tổng hợp khi đánh giá cuối chu kỳ.",
  },
  {
    slug: "giam-tai-khong-phai-lui-buoc",
    category: "Phục hồi",
    title: "Giảm tải không phải là lùi bước",
    excerpt: "Một khoảng tập nhẹ hơn có chủ đích giúp cơ thể hồi phục để đi tiếp, thay vì cố đến khi chấn thương.",
    minutes: 5,
    image: "art-giam-tai",
    imageAlt: "Các vận động viên Men's Physique, trong đó có Hoàng Hải Đăng, tại giải AGP với bảng Olympia Qualifier",
    credit: "IFBB Pro Hoàng Hải Đăng và các VĐV tại AGP",
    body: [
      { p: "Tập nặng liên tục khiến mệt mỏi tích luỹ. Đến một lúc, bạn ngủ kém hơn, các mức tạ quen thuộc bỗng nặng hơn và các cơn đau nhỏ kéo dài. Giảm tải (deload) là một khoảng thời gian ngắn tập nhẹ hơn có kế hoạch để cơ thể kịp hồi phục." },
      { h: "Giảm tải thường gồm gì", list: [
        "Giảm số hiệp mỗi bài.",
        "Giảm mức tạ so với bình thường.",
        "Giữ kỹ thuật và thói quen đến phòng tập, không nghỉ hẳn.",
      ] },
      { h: "Khi nào nên giảm tải", p: "Không có một lịch đúng cho tất cả mọi người. Tín hiệu đáng chú ý là mệt mỏi và đau tăng dần qua nhiều buổi, trong khi sức mạnh không tăng. Nếu đau kéo dài hoặc đau nhói khi vận động, hãy gặp bác sĩ thay vì chỉ giảm tải." },
    ],
    inGymini: "Giảm tải là một trong năm quyết định có thể có ở cuối chu kỳ. Gymini đưa ra quyết định này khi số liệu cho thấy mệt mỏi hoặc đau tăng lên, và AI giải thích lý do bằng lời dễ hiểu.",
  },
  {
    slug: "doc-phieu-inbody",
    category: "Số đo cơ thể",
    title: "Đọc phiếu InBody: nên xem chỉ số nào trước",
    excerpt: "Phiếu đo có hàng chục con số. Ba chỉ số dưới đây đủ để bạn theo dõi xu hướng mà không bị rối.",
    minutes: 6,
    image: "art-inbody",
    imageAlt: "IFBB Pro Trần Tuấn Anh tạo dáng trên sân khấu",
    credit: "IFBB Pro Trần Tuấn Anh",
    body: [
      { p: "Máy InBody ước tính thành phần cơ thể bằng phương pháp đo trở kháng điện sinh học. Đây là ước tính, không phải phép đo trực tiếp, nên kết quả chịu ảnh hưởng của lượng nước trong cơ thể, bữa ăn và hoạt động trước khi đo." },
      { h: "Ba chỉ số nên xem trước", list: [
        "Cân nặng: con số quen thuộc, nhưng chỉ cho biết tổng khối lượng.",
        "Khối lượng cơ xương (SMM): cho biết phần cơ bám xương, liên quan trực tiếp tới tập luyện.",
        "Phần trăm mỡ cơ thể (PBF): tỷ lệ mỡ trên tổng cân nặng.",
      ] },
      { h: "Đo sao cho so sánh được", p: "Hãy đo vào cùng khung giờ, cùng trạng thái (ví dụ buổi sáng, trước khi ăn và trước khi tập). So sánh xu hướng qua nhiều lần đo thay vì kết luận từ một lần duy nhất." },
    ],
    inGymini: "Bạn có thể chụp ảnh phiếu InBody, Gymini đọc các chỉ số và lưu lại. Số đo đầu chu kỳ được dùng làm mốc để so sánh khi đánh giá cuối chu kỳ.",
  },
  {
    slug: "hlv-online-hay-truc-tiep",
    category: "Chọn huấn luyện viên",
    title: "Huấn luyện viên online hay trực tiếp?",
    excerpt: "Hai hình thức phù hợp với hai nhu cầu khác nhau. Vài câu hỏi giúp bạn chọn trước khi trả tiền.",
    minutes: 5,
    image: "art-chon-hlv",
    imageAlt: "Hoàng Hải Đăng trên bục nhận giải Malaysia IFBB Pro Qualifier",
    credit: "IFBB Pro Hoàng Hải Đăng",
    body: [
      { p: "Huấn luyện viên trực tiếp đứng cạnh bạn, chỉnh tư thế và bảo hộ ngay tại chỗ. Huấn luyện viên online theo dõi qua giáo án, video và tin nhắn, linh hoạt hơn về giờ giấc và địa điểm." },
      { h: "Trực tiếp hợp với bạn nếu", list: [
        "Bạn mới tập và cần chỉnh kỹ thuật các bài nhiều khớp.",
        "Bạn cần người bảo hộ khi tập nặng.",
        "Bạn muốn có lịch hẹn cố định để giữ kỷ luật.",
      ] },
      { h: "Online hợp với bạn nếu", list: [
        "Bạn đã nắm kỹ thuật cơ bản.",
        "Lịch làm việc thay đổi, khó hẹn giờ cố định.",
        "Bạn tập ở nhà hoặc ở nhiều nơi khác nhau.",
      ] },
      { h: "Trước khi chọn", p: "Đọc kỹ gói dịch vụ: số buổi, thời lượng mỗi buổi, hình thức và điều kiện đi kèm. Với gói trực tiếp tại một phòng gym, bạn cần có gói hội viên còn hạn tại phòng gym đó." },
    ],
    inGymini: "Mỗi gói của huấn luyện viên ghi rõ số buổi, thời lượng, giá và hình thức online hoặc trực tiếp. Hợp đồng chốt số buổi và giá khi bắt đầu; huấn luyện viên vắng buổi thì bạn được bù buổi.",
  },
];

export const findArticle = (slug?: string) => ARTICLES.find((a) => a.slug === slug);
