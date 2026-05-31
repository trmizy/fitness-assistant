// Mapping enum values → tiếng Việt để hiển thị trong UI
// Giữ nguyên các thuật ngữ quốc tế thông dụng: AI, InBody, PT, Dashboard, Chat

export const BODY_PART_VI: Record<string, string> = {
  UPPER_BODY: 'Thân trên',
  LOWER_BODY: 'Thân dưới',
  CORE: 'Cơ lõi',
  FULL_BODY: 'Toàn thân',
};

export const ACTIVITY_TYPE_VI: Record<string, string> = {
  STRENGTH: 'Sức mạnh',
  CARDIO: 'Cardio',
  MOBILITY: 'Linh hoạt',
  STRENGTH_CARDIO: 'Sức mạnh & Cardio',
  STRENGTH_MOBILITY: 'Sức mạnh & Linh hoạt',
};

export const EQUIPMENT_VI: Record<string, string> = {
  BODYWEIGHT: 'Tự trọng',
  BARBELL: 'Tạ đòn',
  DUMBBELLS: 'Tạ đôi',
  KETTLEBELL: 'Tạ ấm',
  MACHINE: 'Máy tập',
  RESISTANCE_BAND: 'Dây kháng lực',
  CABLE: 'Cáp ròng rọc',
  MEDICINE_BALL: 'Bóng tạ',
  FOAM_ROLLER: 'Con lăn xốp',
};

export const MOVEMENT_TYPE_VI: Record<string, string> = {
  PUSH: 'Đẩy',
  PULL: 'Kéo',
  HOLD: 'Giữ',
  STRETCH: 'Giãn cơ',
};

export const MUSCLE_GROUP_VI: Record<string, string> = {
  Chest: 'Ngực',
  Back: 'Lưng',
  Shoulders: 'Vai',
  Biceps: 'Tay trước',
  Triceps: 'Tay sau',
  Quadriceps: 'Đùi trước',
  Hamstrings: 'Đùi sau',
  Glutes: 'Mông',
  Calves: 'Bắp chân',
  Abdominals: 'Bụng',
  'Lower Back': 'Lưng dưới',
  Forearms: 'Cẳng tay',
  Traps: 'Cơ thang',
  Lats: 'Lưng rộng',
  abdominals: 'Bụng',
  chest: 'Ngực',
  back: 'Lưng',
  shoulders: 'Vai',
  biceps: 'Tay trước',
  triceps: 'Tay sau',
  quadriceps: 'Đùi trước',
  hamstrings: 'Đùi sau',
  glutes: 'Mông',
  calves: 'Bắp chân',
  'lower back': 'Lưng dưới',
  forearms: 'Cẳng tay',
  traps: 'Cơ thang',
  lats: 'Lưng rộng',
};

export const GOAL_VI: Record<string, string> = {
  WEIGHT_LOSS: 'Giảm mỡ',
  MUSCLE_GAIN: 'Tăng cơ',
  MAINTENANCE: 'Duy trì',
  ATHLETIC_PERFORMANCE: 'Nâng cao thể lực',
  IMPROVE_HEALTH: 'Cải thiện sức khỏe',
  GAIN_WEIGHT: 'Tăng cân',
  MAINTAIN_BODY: 'Duy trì vóc dáng',
  LOSE_FAT: 'Giảm mỡ',
};

export const ACTIVITY_LEVEL_VI: Record<string, string> = {
  SEDENTARY: 'Ít vận động',
  LIGHTLY_ACTIVE: 'Vận động nhẹ',
  MODERATELY_ACTIVE: 'Vận động vừa',
  VERY_ACTIVE: 'Năng động',
  EXTREMELY_ACTIVE: 'Cực kỳ năng động',
};

export const GENDER_VI: Record<string, string> = {
  MALE: 'Nam',
  FEMALE: 'Nữ',
  OTHER: 'Khác',
};

export const DIET_VI: Record<string, string> = {
  NO_PREFERENCE: 'Không yêu cầu',
  HIGH_PROTEIN: 'Nhiều protein',
  VEGETARIAN: 'Ăn chay (có trứng/sữa)',
  VEGAN: 'Thuần chay',
  KETO: 'Keto',
  LOW_CARB: 'Ít tinh bột',
};

export const SESSION_STATUS_VI: Record<string, string> = {
  REQUESTED: 'Chờ xác nhận',
  CONFIRMED: 'Đã xác nhận',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã huỷ',
  NO_SHOW: 'Vắng mặt',
};

export const SESSION_MODE_VI: Record<string, string> = {
  ONLINE: 'Trực tuyến',
  OFFLINE: 'Trực tiếp',
};

export const CONTRACT_STATUS_VI: Record<string, string> = {
  PENDING_REVIEW: 'Chờ duyệt',
  PENDING: 'Chờ duyệt',
  ACTIVE: 'Đang hoạt động',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã huỷ',
  REJECTED: 'Từ chối',
};

export const MEAL_TYPE_VI: Record<string, string> = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
  snack: 'Bữa phụ',
};

export const PLAN_STATUS_VI: Record<string, string> = {
  active: 'Đang dùng',
  pending_review: 'Chờ PT duyệt',
  draft: 'Bản nháp',
  archived: 'Đã lưu trữ',
};

export const INBODY_STATUS_VI: Record<string, string> = {
  extracted: 'Đã trích xuất',
  processing: 'Đang xử lý',
  uploaded: 'Đã tải lên',
  needs_confirm: 'Cần xác nhận',
  manual: 'Nhập thủ công',
  failed: 'Thất bại',
};

export const PT_APP_STATUS_VI: Record<string, string> = {
  NOT_APPLIED: 'Chưa đăng ký',
  DRAFT: 'Bản nháp',
  SUBMITTED: 'Đã nộp',
  UNDER_REVIEW: 'Đang xét duyệt',
  INFO_NEEDED: 'Cần bổ sung thông tin',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Không được chấp thuận',
};

// Helper function — trả về label VI hoặc fallback về giá trị gốc
export function viLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
