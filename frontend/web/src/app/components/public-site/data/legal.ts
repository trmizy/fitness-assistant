/**
 * Trang pháp lý — BẢN NHÁP. Mọi con số đối chiếu với mã / docs/HANDBOOK.md (19/11/2026).
 * Cần chủ dự án (và lý tưởng là người có chuyên môn pháp lý) duyệt trước khi phát hành.
 */
export type LegalSection = { h: string; p?: string[]; list?: string[] };
export type LegalDoc = { slug: string; title: string; lead: string; updated: string; sections: LegalSection[] };

const CONTACT = "huytronh4@gmail.com";

export const TERMS: LegalDoc = {
  slug: "dieu-khoan",
  title: "Điều khoản sử dụng",
  lead: "Những quy tắc áp dụng khi bạn dùng Gymini, viết bằng lời thường. Phần tiền và hợp đồng ghi đúng như cách hệ thống đang vận hành.",
  updated: "Cập nhật ngày 27/11/2026",
  sections: [
    { h: "Gymini là gì", p: [
      "Gymini là nền tảng kết nối người tập, huấn luyện viên độc lập và phòng gym. Huấn luyện viên trên Gymini không phải nhân viên của Gymini hay của phòng gym nào. Phòng gym là đối tác đã được thẩm định giấy tờ.",
      "Lộ trình, giáo án và mục tiêu dinh dưỡng trên Gymini mang tính tham khảo, không thay thế chẩn đoán hay tư vấn của bác sĩ và chuyên gia dinh dưỡng.",
    ] },
    { h: "Tài khoản", list: [
      "Mỗi người dùng một tài khoản và tự chịu trách nhiệm giữ mật khẩu.",
      "Huấn luyện viên phải nộp hồ sơ và được duyệt trước khi hồ sơ hiển thị công khai, và phải xác nhận điều khoản dành cho huấn luyện viên trước khi nhận hợp đồng mới.",
      "Phòng gym đăng ký đối tác bằng email, nộp giấy phép kinh doanh, giấy tờ người đại diện và giấy tờ chứng minh mặt bằng; chỉ hiển thị sau khi được thẩm định.",
    ] },
    { h: "Thanh toán", list: [
      "Thanh toán qua VNPay hoặc ZaloPay. Gymini không lưu thông tin thẻ của bạn.",
      "Ví người tập không nạp tiền được; ví chỉ nhận tiền hoàn và tiền bồi thường, và bạn chỉ rút được phần tiền đó.",
      "Rút tiền được xử lý thủ công, tối thiểu 10.000 đ. Khoản rút từ 5.000.000 đ trở lên cần hai quản trị viên khác nhau duyệt và xác nhận đã chi.",
    ] },
    { h: "Hợp đồng với huấn luyện viên", list: [
      "Bạn gửi yêu cầu, huấn luyện viên nhận hoặc từ chối. Sau khi huấn luyện viên nhận, bạn có 12 giờ để thanh toán; quá hạn, yêu cầu tự huỷ.",
      "Số buổi và giá cố định khi hợp đồng bắt đầu. Tỷ lệ chia doanh thu giữa huấn luyện viên, phòng gym (nếu có) và Gymini được ghi lên hợp đồng lúc thanh toán; thay đổi sau đó không ảnh hưởng hợp đồng đã ký.",
      "Mỗi người tập có tối đa hai huấn luyện viên cùng lúc, lịch các buổi không được chồng nhau.",
      "Gói tập trực tiếp tại một phòng gym yêu cầu bạn có gói hội viên còn hạn tại phòng gym đó trong suốt thời hạn hợp đồng.",
    ] },
    { h: "Buổi tập, huỷ buổi và vắng mặt", list: [
      "Huỷ buổi chưa được xác nhận: miễn phí, không trừ buổi. Dời lịch: miễn phí.",
      "Bạn huỷ buổi đã xác nhận: buổi đó bị trừ khỏi số buổi của bạn, huấn luyện viên vẫn được trả cho buổi đó.",
      "Huấn luyện viên huỷ buổi đã xác nhận hoặc không tới: bạn được bồi thường bằng tiền đúng giá trị một buổi; huấn luyện viên không được trả cho buổi đó.",
      "Sau giờ kết thúc, huấn luyện viên báo hoàn thành; bạn xác nhận hoặc khiếu nại. Nếu bạn không phản hồi, buổi tự được xác nhận sau 3 ngày.",
    ] },
    { h: "Chấm dứt hợp đồng và hoàn tiền", list: [
      "Bạn chủ động chấm dứt: hoàn 90% giá trị các buổi chưa dùng.",
      "Huấn luyện viên chấm dứt, hai bên thoả thuận, hoặc huấn luyện viên bị khoá: hoàn 100% giá trị các buổi chưa dùng.",
      "Huấn luyện viên vắng nhiều lần: bạn được tự chấm dứt và được hoàn như trường hợp lỗi của huấn luyện viên.",
      "Hợp đồng hết hạn hoặc đã hoàn thành: không hoàn.",
    ] },
    { h: "Gói hội viên phòng gym", list: [
      "Đơn chưa thanh toán tự huỷ sau 10 phút.",
      "Bạn tự huỷ gói: không được hoàn tiền. Gymini thông báo rõ điều này trước khi bạn xác nhận huỷ.",
      "Chỉ quản trị viên Gymini hoàn tiền gói hội viên, trong ba trường hợp: phòng gym vi phạm hoặc bị khoá; phòng gym ngừng hoạt động khi gói còn hạn; lỗi giao dịch (đã thanh toán nhưng gói không kích hoạt được). Số tiền hoàn tính theo số ngày còn lại, làm tròn xuống tới nghìn đồng.",
      "Vào cửa bằng mã QR của chi nhánh; mỗi lần quét tính một lượt (cách nhau ít nhất 60 giây với cùng một gói).",
    ] },
    { h: "AI trên Gymini", p: [
      "AI giúp soạn giáo án từ danh mục bài tập có sẵn, đọc số liệu từ ảnh phiếu đo InBody, giải thích kết quả đánh giá chu kỳ và trả lời câu hỏi. AI không chẩn đoán bệnh, không tự quyết định tăng hay giảm kế hoạch, và có thể sai. Hãy dừng tập và gặp bác sĩ khi có dấu hiệu bất thường.",
    ] },
    { h: "Hành vi không được phép", list: [
      "Giao dịch ngoài hệ thống để né phí hoặc né quy tắc hoàn tiền.",
      "Đăng nội dung sai sự thật, xúc phạm, hoặc ảnh không thuộc quyền của bạn.",
      "Dùng tài khoản của người khác hoặc can thiệp vào hệ thống.",
    ] },
    { h: "Liên hệ", p: [`Thắc mắc về điều khoản: gửi email tới ${CONTACT}.`] },
  ],
};

export const PRIVACY: LegalDoc = {
  slug: "quyen-rieng-tu",
  title: "Chính sách quyền riêng tư",
  lead: "Gymini thu thập dữ liệu gì, dùng để làm gì, và chia sẻ với ai. Liệt kê theo đúng những gì hệ thống đang làm.",
  updated: "Cập nhật ngày 27/11/2026",
  sections: [
    { h: "Dữ liệu Gymini thu thập", list: [
      "Tài khoản: email, tên, mật khẩu (được mã hoá).",
      "Hồ sơ tập luyện: tuổi, giới tính, chiều cao, cân nặng, mục tiêu, thói quen và câu trả lời sàng lọc sức khoẻ khi bắt đầu.",
      "Số đo cơ thể: cân nặng theo thời gian, ảnh phiếu đo InBody bạn tải lên và các chỉ số đọc được từ ảnh.",
      "Hoạt động: buổi tập đã ghi, bữa ăn đã đánh dấu, lịch hẹn, lượt check-in phòng gym, đánh giá bạn viết.",
      "Tin nhắn với huấn luyện viên và câu hỏi gửi cho AI Coach.",
      "Huấn luyện viên: hồ sơ chuyên môn, giấy tờ nộp khi đăng ký, ảnh công khai do chính huấn luyện viên đăng.",
      "Phòng gym: thông tin thương hiệu, chi nhánh, vị trí trên bản đồ, giấy tờ pháp lý, ảnh cơ sở. Ảnh tải lên được xoá thông tin EXIF/GPS trước khi lưu.",
      "Giao dịch: mã giao dịch, số tiền, trạng thái. Thông tin thẻ do VNPay/ZaloPay xử lý, Gymini không lưu.",
    ] },
    { h: "Gymini dùng dữ liệu để", list: [
      "Lập lộ trình, giáo án, mục tiêu dinh dưỡng và đánh giá cuối mỗi chu kỳ.",
      "Kết nối bạn với huấn luyện viên và phòng gym, quản lý hợp đồng, lịch và thanh toán.",
      "Thẩm định huấn luyện viên và phòng gym, xử lý khiếu nại và hoàn tiền.",
      "Gửi email cần thiết cho tài khoản (xác nhận, đặt lại mật khẩu, thông báo giao dịch).",
    ] },
    { h: "Ai nhìn thấy dữ liệu của bạn", list: [
      "Huấn luyện viên đang có hợp đồng với bạn xem được lộ trình, buổi tập, dinh dưỡng và tiến độ của bạn để hướng dẫn.",
      "Phòng gym thấy thông tin gói hội viên và lượt check-in của bạn tại phòng gym đó, theo quyền của từng vai trò (chủ, quản lý, lễ tân, kế toán).",
      "Hồ sơ công khai của huấn luyện viên và phòng gym chỉ gồm thông tin đã được duyệt để hiển thị.",
    ] },
    { h: "Bên thứ ba xử lý dữ liệu", list: [
      "Amazon Web Services: lưu trữ và vận hành hệ thống.",
      "Anthropic (Claude): đọc ảnh phiếu đo InBody và ảnh bạn gửi trong AI Coach. Google (Gemini): dự phòng khi dịch vụ trên không phản hồi.",
      "VNPay, ZaloPay: xử lý thanh toán.",
      "Gmail (Google): gửi email thông báo của tài khoản từ địa chỉ gymini@gmail.com.",
    ] },
    { h: "Quyền của bạn", list: [
      "Xem và sửa thông tin hồ sơ trong ứng dụng.",
      "Xuất dữ liệu tập luyện của bạn từ mục Xuất dữ liệu trong ứng dụng.",
      `Yêu cầu xoá tài khoản và dữ liệu: gửi email tới ${CONTACT}. Một số dữ liệu giao dịch có thể phải lưu lại theo quy định kế toán.`,
    ] },
    { h: "Lưu trữ", p: ["Dữ liệu được lưu trong thời gian tài khoản còn hoạt động. Khi bạn yêu cầu xoá tài khoản, Gymini xoá dữ liệu cá nhân của bạn, trừ dữ liệu giao dịch phải giữ lại theo quy định kế toán."] },
    { h: "Liên hệ", p: [`Câu hỏi về quyền riêng tư: gửi email tới ${CONTACT}.`] },
  ],
};

export const LEGAL_DOCS = [TERMS, PRIVACY];
