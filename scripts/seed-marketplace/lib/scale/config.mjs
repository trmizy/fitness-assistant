// Constants, C3 34-province weights, entity distributions, demo specs, and review text pools for scale seeding.
import { createHash } from "node:crypto";

export const SCALE_NAMESPACE = "gymini-scale-v1";
export const SCALE_EMAIL_DOMAIN = "scale.gymini.test";
export const SCALE_EPOCH = new Date("2026-11-11T00:00:00.000Z");
export const PT_TERMS_VERSION = "2026-10-pt-draft-6";

export const PHOTO_REUSE_CAP = 40;

/** C2 + C5 target universe at scaleFactor = 1. */
export const FULL_SCALE_COUNTS = Object.freeze({
  customers: 25_000,
  customerPhysicalShare: 0.30, // ~7,500 customers with physical onboarding metrics + InBody scans
  publicPts: 10_000,
  otherPts: 400, // 8 non-public/unlisted states x 50
  owners: 900, // 700 standalone + 180 medium [2..5] + 20 large [15..90]
  branches: 2_500,
  publicBranches: 2_300, // 92% APPROVED + OPEN
  ptContracts: 15_000, // SYNTHETIC, COMPLETED only (~8 sessions avg)
  sessionsTarget: 120_000, // SYNTHETIC, COMPLETED only
  sessionReviews: 120_000, // exact C5.5 count (15% PTs with 0 reviews, median 8, max ~300)
  gymMemberships: 42_000, // SYNTHETIC, EXPIRED only
  gymReviews: 40_000, // unique (gym_id, client_id)
});

/** Computes proportional counts for sub-scale integration/perf tests (0.01, 0.1) or exact factor=1. */
export function scaledCounts(scaleFactor = 1) {
  const f = Number(scaleFactor);
  if (!Number.isFinite(f) || f <= 0 || f > 1) {
    throw new Error(`scaleFactor must be in (0, 1], got ${scaleFactor}`);
  }
  if (f === 1) return { ...FULL_SCALE_COUNTS, scaleFactor: 1 };
  const s = (n, min = 1) => Math.max(min, Math.round(n * f));
  const publicPts = s(FULL_SCALE_COUNTS.publicPts, 20);
  const otherPts = Math.max(8, Math.round((FULL_SCALE_COUNTS.otherPts * f) / 8) * 8);
  const branches = s(FULL_SCALE_COUNTS.branches, 10);
  const publicBranches = Math.min(branches - 1, Math.max(8, Math.round(branches * 0.92)));
  const owners = Math.min(branches, s(FULL_SCALE_COUNTS.owners, 5));
  const sessionsTarget = s(FULL_SCALE_COUNTS.sessionsTarget, 200);
  const sessionReviews = Math.min(sessionsTarget, s(FULL_SCALE_COUNTS.sessionReviews, 200));
  return {
    scaleFactor: f,
    customers: s(FULL_SCALE_COUNTS.customers, 50),
    customerPhysicalShare: FULL_SCALE_COUNTS.customerPhysicalShare,
    publicPts,
    otherPts,
    owners,
    branches,
    publicBranches,
    ptContracts: s(FULL_SCALE_COUNTS.ptContracts, 25),
    sessionsTarget,
    sessionReviews,
    gymMemberships: s(FULL_SCALE_COUNTS.gymMemberships, 40),
    gymReviews: s(FULL_SCALE_COUNTS.gymReviews, 40),
  };
}

/**
 * C3 canonical 34 provinces & percentage targets (sum === 100.0),
 * keyed by integer provinceCode from backend/services/user-service/prisma/data/vietnam_provinces.json.
 */
export const C3_PROVINCES = Object.freeze([
  { code: 79, name: "TP. Hồ Chí Minh", pct: 22.0 },
  { code: 1, name: "Hà Nội", pct: 19.0 },
  { code: 48, name: "Đà Nẵng", pct: 5.5 },
  { code: 31, name: "Hải Phòng", pct: 4.5 },
  { code: 75, name: "Đồng Nai", pct: 4.5 },
  { code: 92, name: "Cần Thơ", pct: 3.5 },
  { code: 56, name: "Khánh Hòa", pct: 3.0 },
  { code: 24, name: "Bắc Ninh", pct: 2.8 },
  { code: 68, name: "Lâm Đồng", pct: 2.5 },
  { code: 46, name: "Huế", pct: 2.2 },
  { code: 38, name: "Thanh Hóa", pct: 2.2 },
  { code: 40, name: "Nghệ An", pct: 2.2 },
  { code: 22, name: "Quảng Ninh", pct: 2.0 },
  { code: 80, name: "Tây Ninh", pct: 2.0 },
  { code: 33, name: "Hưng Yên", pct: 1.8 },
  { code: 82, name: "Đồng Tháp", pct: 1.8 },
  { code: 91, name: "An Giang", pct: 1.8 },
  { code: 25, name: "Phú Thọ", pct: 1.6 },
  { code: 37, name: "Ninh Bình", pct: 1.6 },
  { code: 66, name: "Đắk Lắk", pct: 1.5 },
  { code: 52, name: "Gia Lai", pct: 1.5 },
  { code: 19, name: "Thái Nguyên", pct: 1.4 },
  { code: 86, name: "Vĩnh Long", pct: 1.4 },
  { code: 51, name: "Quảng Ngãi", pct: 1.3 },
  { code: 96, name: "Cà Mau", pct: 1.0 },
  { code: 44, name: "Quảng Trị", pct: 0.9 },
  { code: 15, name: "Lào Cai", pct: 0.8 },
  { code: 42, name: "Hà Tĩnh", pct: 0.8 },
  { code: 8, name: "Tuyên Quang", pct: 0.6 },
  { code: 20, name: "Lạng Sơn", pct: 0.5 },
  { code: 14, name: "Sơn La", pct: 0.5 },
  { code: 4, name: "Cao Bằng", pct: 0.3 },
  { code: 11, name: "Điện Biên", pct: 0.3 },
  { code: 12, name: "Lai Châu", pct: 0.2 },
]);

export const OTHER_PT_BUCKETS = Object.freeze([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_MORE_INFO",
  "REJECTED",
  "SUSPENDED",
  "ACCOUNT_RESTRICTED",
  "NOT_ACCEPTING",
]);

/** Gym non-public allocation (8% = 200 out of 2,500 branches at factor=1). */
export const NON_PUBLIC_GYM_BUCKETS = Object.freeze([
  { key: "TEMPORARILY_CLOSED", weight: 65 },
  { key: "PENDING_REVIEW", weight: 50 },
  { key: "SUSPENDED", weight: 35 },
  { key: "DRAFT", weight: 20 },
  { key: "REJECTED", weight: 10 },
  { key: "HIDDEN_PARTNER", weight: 20 }, // partner SUSPENDED / TERMINATED on standalone owner
]);

export const SERVICE_MODE_WEIGHTS = Object.freeze([
  ["OFFLINE", 0.45],
  ["HYBRID", 0.35],
  ["ONLINE", 0.20],
]);

export const SYSTEM_AMENITY_SLUGS = Object.freeze([
  "FREE_WEIGHTS",
  "CARDIO_MACHINES",
  "FUNCTIONAL_TRAINING_AREA",
  "GROUP_CLASSES",
  "YOGA_STUDIO",
  "SWIMMING_POOL",
  "PERSONAL_TRAINER",
  "INBODY_SCAN",
  "LOCKER_ROOM",
  "SHOWER",
  "SAUNA",
  "TOWEL_SERVICE",
  "PARKING",
  "WIFI",
  "AIR_CONDITIONING",
  "DRINKING_WATER",
  "KIDS_AREA",
  "VENDING_MACHINE",
]);

export const AMENITY_ID_BY_SLUG = Object.freeze(
  Object.fromEntries(SYSTEM_AMENITY_SLUGS.map((s) => [s, `amenity-sys-${s.toLowerCase().replace(/_/g, "-")}`]))
);

/** Curated demo personas embedded WITHIN the 25,000 / 10,400 / 900 budget (+ 1 admin = 36,301 users). */
export const DEMO_ADMIN_SPEC = Object.freeze({
  slug: "demo-scale-admin",
  firstName: "Quản trị",
  lastName: "Hệ thống Scale",
  role: "ADMIN",
});

export const DEMO_CUSTOMER_SPECS = Object.freeze([
  { slug: "demo-client-hcm-inbody", provinceCode: 79, hasPhysical: true, gender: "FEMALE" },
  { slug: "demo-client-hcm-minimal", provinceCode: 79, hasPhysical: false, gender: "MALE" },
  { slug: "demo-client-hanoi-history", provinceCode: 1, hasPhysical: true, gender: "MALE" },
  { slug: "demo-client-hanoi-weightloss", provinceCode: 1, hasPhysical: true, gender: "FEMALE" },
  { slug: "demo-client-danang-active", provinceCode: 48, hasPhysical: true, gender: "MALE" },
  { slug: "demo-client-haiphong", provinceCode: 31, hasPhysical: false, gender: "FEMALE" },
  { slug: "demo-client-cantho", provinceCode: 92, hasPhysical: true, gender: "MALE" },
  { slug: "demo-client-dongnai", provinceCode: 75, hasPhysical: false, gender: "FEMALE" },
  { slug: "demo-client-hue", provinceCode: 46, hasPhysical: true, gender: "MALE" },
  { slug: "demo-client-nhatrang", provinceCode: 56, hasPhysical: true, gender: "FEMALE" },
]);

export const DEMO_PT_SPECS = Object.freeze([
  { slug: "demo-pt-top-hcm", provinceCode: 79, bucket: "PUBLIC", serviceMode: "HYBRID", gender: "MALE", topReviews: true },
  { slug: "demo-pt-yoga-hcm", provinceCode: 79, bucket: "PUBLIC", serviceMode: "OFFLINE", gender: "FEMALE", specialtyFocus: "Yoga" },
  { slug: "demo-pt-online-hn", provinceCode: 1, bucket: "PUBLIC", serviceMode: "ONLINE", gender: "FEMALE" },
  { slug: "demo-pt-offline-hn", provinceCode: 1, bucket: "PUBLIC", serviceMode: "OFFLINE", gender: "MALE", specialtyFocus: "Powerlifting" },
  { slug: "demo-pt-boxing-dn", provinceCode: 48, bucket: "PUBLIC", serviceMode: "HYBRID", gender: "MALE", specialtyFocus: "Boxing & MMA" },
  { slug: "demo-pt-noreview-ct", provinceCode: 92, bucket: "PUBLIC", serviceMode: "HYBRID", gender: "FEMALE", forceZeroReviews: true },
  { slug: "demo-pt-not-accepting", provinceCode: 79, bucket: "NOT_ACCEPTING", serviceMode: "OFFLINE", gender: "MALE" },
  { slug: "demo-pt-pending-review", provinceCode: 1, bucket: "UNDER_REVIEW", serviceMode: "HYBRID", gender: "FEMALE" },
  { slug: "demo-pt-suspended", provinceCode: 79, bucket: "SUSPENDED", serviceMode: "OFFLINE", gender: "MALE" },
  { slug: "demo-pt-restricted", provinceCode: 1, bucket: "ACCOUNT_RESTRICTED", serviceMode: "ONLINE", gender: "FEMALE" },
]);

export const DEMO_OWNER_SPECS = Object.freeze([
  { slug: "demo-owner-large-1", kind: "large", provinceCode: 79 },
  { slug: "demo-owner-large-2", kind: "large", provinceCode: 1 },
  { slug: "demo-owner-medium-1", kind: "medium", provinceCode: 79 },
  { slug: "demo-owner-medium-2", kind: "medium", provinceCode: 48 },
  { slug: "demo-owner-standalone-1", kind: "standalone", provinceCode: 79, branchMode: "OPEN" },
  { slug: "demo-owner-standalone-2", kind: "standalone", provinceCode: 1, branchMode: "OPEN" },
  { slug: "demo-owner-temp-closed", kind: "standalone", provinceCode: 79, branchMode: "TEMPORARILY_CLOSED" },
  { slug: "demo-owner-pending-branch", kind: "standalone", provinceCode: 1, branchMode: "PENDING_REVIEW" },
  { slug: "demo-owner-suspended", kind: "standalone", provinceCode: 48, branchMode: "HIDDEN_PARTNER" },
]);

/** Realistic Vietnamese gym brand word banks for 900 distinct natural gym brand names. */
export const BRAND_PREFIXES = Object.freeze([
  "Sài Gòn", "Hà Nội", "Đông Dương", "Thăng Long", "Lạc Việt", "Bình Minh", "Hoàng Gia", "Thiên Trường", "Nam Việt", "Tâm Đức",
  "Đất Việt", "Hòa Bình", "Phương Nam", "Trường Sơn", "Cửu Long", "Sông Hàn", "Biển Đông", "Tây Nguyên", "Hải Đăng", "Ngọc Việt",
  "An Khang", "Đại Phát", "Hưng Thịnh", "Kim Cương", "Vĩnh Phú", "Bách Việt", "Việt Mỹ", "Phố Núi", "Tâm An", "Sức Trẻ",
  "Nhiệt Huyết", "Đỉnh Cao", "Phong Độ", "Bản Lĩnh", "Vươn Xa", "Bứt Phá", "Năng Động", "Khỏe Đẹp", "Thanh Xuân", "Minh Tâm",
]);

export const BRAND_CORES = Object.freeze([
  "Fitness", "Gym", "Athletic", "Strength", "Iron", "Powerhouse", "Wellness", "Core", "Peak", "Titan",
  "Spartan", "Olympus", "Zenith", "Pulse", "Vitality", "Motion", "Active", "Apex", "Prime", "Victory",
  "Horizon", "Vanguard", "Summit", "Force", "Dynasty", "Balance", "Flex", "Ignite", "Fusion", "Momentum",
]);

export const BRAND_SUFFIXES = Object.freeze([
  "Club", "Center", "Studio", "Station", "Arena", "Complex", "House", "Hub", "Academy", "Lab", "Box", "Factory",
]);

export const STREET_NAMES = Object.freeze([
  "Nguyễn Huệ", "Lê Lợi", "Hai Bà Trưng", "Trần Hưng Đạo", "Cách Mạng Tháng Tám", "Nguyễn Thị Minh Khai", "Điện Biên Phủ",
  "Võ Văn Tần", "Pasteur", "Phan Xích Long", "Quang Trung", "Cộng Hòa", "Trường Chinh", "Lũy Bán Bích", "Hoàng Văn Thụ",
  "Nguyễn Văn Cừ", "Lê Văn Việt", "Nguyễn Lương Bằng", "Huỳnh Tấn Phát", "Phạm Văn Đồng", "Nguyễn Oanh", "Lạc Long Quân",
  "Giải Phóng", "Thái Hà", "Chùa Bộc", "Xuân Thủy", "Cầu Giấy", "Trung Kính", "Nguyễn Trãi", "Khuất Duy Tiến", "Tố Hữu",
  "Lê Văn Lương", "Bạch Mai", "Kim Mã", "Đội Cấn", "Hoàng Quốc Việt", "Nguyễn Văn Huyên", "Trần Duy Hưng", "Lê Duẩn",
  "Nguyễn Văn Linh", "Ngô Quyền", "Tôn Đức Thắng", "Hùng Vương", "Phan Chu Trinh", "Lý Thường Kiệt", "Trần Phú", "Nguyễn Ái Quốc",
  "Đồng Khởi", "Phạm Văn Thuận", "30 Tháng 4", "Mậu Thân", "Nguyễn Văn Cừ Nối Dài", "Lê Hồng Phong", "Nguyễn Văn Trỗi",
]);

/** 150+ distinct curated Vietnamese coaching review components (synthetic showcase, never claiming real identity). */
export const REVIEW_OPENINGS = Object.freeze([
  "Huấn luyện viên hướng dẫn kỹ thuật rất rõ ràng",
  "Lịch tập được điều chỉnh sát với thể trạng từng tuần",
  "Không khí buổi tập tích cực và giữ nhịp độ tốt",
  "Các bài khởi động và giãn cơ cuối buổi khá bài bản",
  "Theo sát từng set tập và sửa tư thế kịp thời",
  "Giao tiếp dễ hiểu, tập trung vào mục tiêu ban đầu",
  "Chương trình phối hợp sức mạnh và sức bền hợp lý",
  "Rất đúng giờ và chuẩn bị giáo án trước mỗi buổi",
  "Cách giải thích cơ chế vận động giúp giảm mỏi khớp rõ rệt",
  "Kế hoạch tăng tạ từng bước an toàn, không ép quá sức",
  "Buổi tập diễn ra gọn gàng, tối ưu thời gian nghỉ giữa hiệp",
  "Hướng dẫn kiểm soát nhịp thở khi thực hiện bài nặng hiệu quả",
  "Thái độ chuyên nghiệp, theo dõi tiến độ đo lường định kỳ",
  "Điều chỉnh bài thay thế linh hoạt khi bị căng cơ vai",
  "Khối lượng tập vừa sức nhưng vẫn đủ thử thách để tiến bộ",
]);

export const REVIEW_DETAILS = Object.freeze([
  "sau 4 tuần cảm thấy lưng dưới đỡ mỏi hơn trước nhiều.",
  "từng động tác squat và deadlift vào đúng nhóm cơ mục tiêu.",
  "nhịp tim và thể lực cải thiện đều qua từng tháng.",
  "lịch tập bận rộn vẫn sắp xếp được khung giờ phù hợp.",
  "nhờ ghi chú chi tiết nên tự tập thêm ở nhà dễ dàng hơn.",
  "tư thế cột sống khi ngồi làm việc cũng cải thiện đáng kể.",
  "biết cách ăn uống cân đối hơn thay vì kiêng khem cực đoan.",
  "độ linh hoạt khớp hông và cổ chân mở hơn rõ ràng.",
  "mức tạ tăng đều mà không gặp chấn thương nào.",
  "sau mỗi chu kỳ tập đều có đánh giá lại chỉ số rõ ràng.",
  "cảm giác tự tin hơn khi sử dụng các máy tập trong phòng gym.",
  "phần vai và lưng trên khỏe hơn, đỡ đau mỏi cổ vai gáy.",
]);

export const GYM_REVIEW_OPENINGS = Object.freeze([
  "Không gian phòng tập rộng rãi, thoáng khí",
  "Khu tạ tự do đầy đủ bánh tạ và rack tập sạch sẽ",
  "Máy cardio hoạt động ổn định, không phải chờ lâu giờ thấp điểm",
  "Khu thay đồ và tủ khóa gọn gàng, vệ sinh thường xuyên",
  "Khu vực tập functional có đủ thảm và phụ kiện cơ bản",
  "Ánh sáng và nhiệt độ điều hòa dễ chịu suốt buổi tập",
  "Giờ mở cửa linh hoạt từ sáng sớm tới tối muộn",
  "Thiết bị được bảo trì đều, tay nắm không bị rỉ sét",
  "Có khu vực giãn cơ riêng yên tĩnh sau khi tập nặng",
  "Lối vào và bãi giữ xe thuận tiện cho hội viên đi làm về",
]);

export const GYM_REVIEW_TAILS = Object.freeze([
  "phù hợp để duy trì lịch tập dài hạn.",
  "khung giờ 17h30–19h30 hơi đông nhưng vẫn xoay vòng máy ổn.",
  "vệ sinh sàn tập và khăn lau được nhắc nhở khá tốt.",
  "tổng thể xứng đáng trong tầm chi phí hàng tháng.",
  "dụng cụ xếp đặt ngăn nắp, dễ tìm đúng mức tạ.",
  "chất lượng ổn định giữa các ngày trong tuần.",
]);

export const scaleEmail = (slug) => `${slug}@${SCALE_EMAIL_DOMAIN}`;
export const isScaleEmail = (email) => typeof email === "string" && email.toLowerCase().endsWith(`@${SCALE_EMAIL_DOMAIN}`);

export function scaleDid(namespace, ...parts) {
  const hex = createHash("sha256").update(`${namespace}:${parts.join(":")}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

