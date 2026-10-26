// ~25 Gym Owners, one Brand each, ~80 branches. The scenario matrix of plan 8.1 (O1-O10) plus generated owners that fill the
// remaining states. Pure data + deterministic generation; no I/O except the (local) asset manifest.
import { did, makeHelpers, rngFrom, seedEmail, slugify } from "../util.mjs";
import { addressLine, areasOfCity, findArea, jitterLatLng, landlinePhone, mobilePhone } from "../geo.mjs";
import { BANKS, SYSTEM_AMENITIES } from "./constants.mjs";
import { gymPhotoPool, pickDistinct } from "./assets.mjs";

// ---- amenity archetypes (core + optional extras; the optionals are sampled per branch so combos differ) ----------------
const ARCH = {
  powerhouse: { label: "gym tạ", core: ["FREE_WEIGHTS", "CARDIO_MACHINES", "LOCKER_ROOM", "SHOWER", "WIFI", "AIR_CONDITIONING"], extras: ["PARKING", "DRINKING_WATER", "PERSONAL_TRAINER", "INBODY_SCAN", "VENDING_MACHINE"], customKeys: ["stretching"], cats: ["gym-interior", "free-weights", "cardio", "locker-room", "fitness-center"] },
  premium: { label: "câu lạc bộ cao cấp", core: ["FREE_WEIGHTS", "CARDIO_MACHINES", "FUNCTIONAL_TRAINING_AREA", "GROUP_CLASSES", "LOCKER_ROOM", "SHOWER", "SAUNA", "SWIMMING_POOL", "TOWEL_SERVICE", "WIFI", "AIR_CONDITIONING", "PARKING"], extras: ["INBODY_SCAN", "PERSONAL_TRAINER", "DRINKING_WATER", "KIDS_AREA", "YOGA_STUDIO"], customKeys: ["recovery", "stretching"], cats: ["gym-interior", "pool", "fitness-center", "reception", "locker-room", "yoga-studio", "cardio"] },
  yoga: { label: "studio yoga & pilates", core: ["YOGA_STUDIO", "GROUP_CLASSES", "LOCKER_ROOM", "SHOWER", "AIR_CONDITIONING", "WIFI"], extras: ["TOWEL_SERVICE", "DRINKING_WATER", "PARKING", "PERSONAL_TRAINER", "SAUNA"], customKeys: ["stretching", "recovery"], cats: ["yoga-studio", "fitness-center", "reception", "locker-room"] },
  boxing: { label: "phòng tập boxing & võ thuật", core: ["FUNCTIONAL_TRAINING_AREA", "FREE_WEIGHTS", "GROUP_CLASSES", "SHOWER", "LOCKER_ROOM"], extras: ["PARKING", "DRINKING_WATER", "PERSONAL_TRAINER", "AIR_CONDITIONING", "WIFI"], customKeys: ["stretching"], cats: ["boxing", "functional", "free-weights", "gym-interior"] },
  crossfit: { label: "box CrossFit / functional", core: ["FUNCTIONAL_TRAINING_AREA", "FREE_WEIGHTS", "GROUP_CLASSES", "SHOWER"], extras: ["PARKING", "LOCKER_ROOM", "DRINKING_WATER", "INBODY_SCAN", "PERSONAL_TRAINER", "WIFI"], customKeys: ["recovery"], cats: ["crossfit", "functional", "free-weights"] },
  budget: { label: "phòng tập bình dân", core: ["FREE_WEIGHTS", "CARDIO_MACHINES", "LOCKER_ROOM"], extras: ["DRINKING_WATER", "PARKING", "SHOWER", "WIFI", "VENDING_MACHINE"], customKeys: [], cats: ["gym-interior", "free-weights", "cardio", "fitness-center"] },
  wellness: { label: "trung tâm thể hình & chăm sóc sức khỏe", core: ["SAUNA", "SWIMMING_POOL", "YOGA_STUDIO", "TOWEL_SERVICE", "SHOWER", "AIR_CONDITIONING", "WIFI", "LOCKER_ROOM"], extras: ["CARDIO_MACHINES", "FREE_WEIGHTS", "INBODY_SCAN", "KIDS_AREA", "PARKING", "PERSONAL_TRAINER"], customKeys: ["recovery"], cats: ["pool", "yoga-studio", "reception", "locker-room", "fitness-center"] },
};

const DESCRIPTIONS = {
  powerhouse: ["Phòng tập tạ rộng với đầy đủ máy móc nhập khẩu, khu tạ tự do và cardio thoáng mát. Huấn luyện viên hỗ trợ kỹ thuật cho người mới.", "Không gian tập luyện nghiêm túc cho người muốn tăng cơ, giảm mỡ. Máy móc bảo trì định kỳ, giờ mở cửa linh hoạt.", "Gym tạ truyền thống, khu rack squat và deadlift riêng, cộng đồng hội viên thân thiện."],
  premium: ["Câu lạc bộ thể hình cao cấp với hồ bơi, phòng xông hơi và lớp nhóm mỗi ngày. Dịch vụ khăn tắm và tủ cá nhân đi kèm.", "Không gian tập luyện đầy đủ tiện nghi: khu tạ, cardio, functional, bể bơi và khu thư giãn sau tập."],
  yoga: ["Studio yoga và pilates nhỏ xinh, lớp tối đa 15 học viên, giáo viên có chứng chỉ quốc tế.", "Không gian yên tĩnh cho yoga, stretching và thiền. Có lớp cho người mới bắt đầu và lớp phục hồi sau chấn thương."],
  boxing: ["Phòng tập boxing, Muay Thai và thể lực. Bao cát, sàn đấu và huấn luyện viên từng thi đấu chuyên nghiệp.", "Lớp võ thuật và cardio đốt mỡ cường độ cao, phù hợp cả nam và nữ."],
  crossfit: ["Box CrossFit với giàn rack, tạ bumper, máy chèo và lớp WOD theo giờ cố định. Huấn luyện viên theo sát từng buổi.", "Khu functional training rộng, lớp nhóm nhỏ và chương trình tăng sức mạnh toàn thân."],
  budget: ["Phòng tập giá hợp lý cho sinh viên và người đi làm, đủ máy cơ bản, mở cửa sớm đến tối muộn.", "Gym gọn gàng, máy móc đủ dùng, giá gói theo tháng dễ chịu."],
  wellness: ["Trung tâm kết hợp tập luyện và thư giãn: hồ bơi, xông hơi, yoga và phòng gym đầy đủ.", "Không gian chăm sóc sức khỏe toàn diện, phù hợp gia đình và người muốn phục hồi sau tập."],
};

const PRICE_TIERS = {
  budget: { m1: 350000, m3: 900000, m6: 1600000, m12: 2800000 },
  mid: { m1: 600000, m3: 1600000, m6: 2900000, m12: 5000000 },
  premium: { m1: 1200000, m3: 3300000, m6: 6000000, m12: 10500000 },
};

function plansFor(tier, rng, extra = {}) {
  const p = PRICE_TIERS[tier];
  const wobble = (n) => Math.round((n * (0.94 + rng() * 0.12)) / 10000) * 10000;
  const plans = [
    { name: "Gói 1 tháng", description: "Tập không giới hạn trong 30 ngày, dùng được tất cả khu tập.", price: wobble(p.m1), durationDays: 30 },
    { name: "Gói 3 tháng", description: "Tiết kiệm hơn gói tháng, phù hợp mục tiêu 12 tuần.", price: wobble(p.m3), durationDays: 90 },
    { name: "Gói 6 tháng", description: "Gói phổ biến nhất: đủ dài để thấy thay đổi rõ rệt.", price: wobble(p.m6), durationDays: 180 },
    { name: "Gói 12 tháng", description: "Giá tốt nhất cho hội viên gắn bó cả năm.", price: wobble(p.m12), durationDays: 365 },
  ];
  if (tier !== "budget") plans.push({ name: "Gói 10 lượt", description: "10 lượt vào tập, dùng trong 60 ngày — phù hợp người đi công tác.", price: wobble(p.m1 * 0.7), durationDays: 60, visitLimit: 10 });
  if (extra.inactive) plans.push({ name: "Gói khuyến mãi hè", description: "Chương trình hè đã kết thúc.", price: wobble(p.m3 * 0.8), durationDays: 90, status: "INACTIVE" });
  return plans;
}

const HOURS_PATTERNS = {
  standard: [["OPEN", 330, 1320], ["OPEN", 330, 1320], ["OPEN", 330, 1320], ["OPEN", 330, 1320], ["OPEN", 330, 1320], ["OPEN", 360, 1260], ["OPEN", 420, 1200]],
  late: [["OPEN", 360, 1380], ["OPEN", 360, 1380], ["OPEN", 360, 1380], ["OPEN", 360, 1380], ["OPEN", 360, 1380], ["OPEN", 420, 1320], ["OPEN", 480, 1260]],
  allday: [["ALL_DAY"], ["ALL_DAY"], ["ALL_DAY"], ["ALL_DAY"], ["ALL_DAY"], ["ALL_DAY"], ["ALL_DAY"]],
  studio: [["OPEN", 360, 1260], ["OPEN", 360, 1260], ["OPEN", 360, 1260], ["OPEN", 360, 1260], ["OPEN", 360, 1260], ["OPEN", 420, 1140], ["CLOSED"]],
};
const hoursToDays = (pattern) =>
  ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map((day, i) => {
    const [type, open, close] = pattern[i];
    return type === "OPEN" ? { day, type, openMinute: open, closeMinute: close } : { day, type };
  });

// ---- scenario tables -------------------------------------------------------------------------------------------------
// listing kind of a branch: what the owner's listing workflow looks like AFTER the branch itself went live.
//  rounds   = how many revisions were submitted and APPROVED before the final state
//  tweaks   = what each approved round changed (see tweaks.mjs); open = what the open / closed-final revision changes
const L = (finalKind, rounds = 0, open = []) => ({ finalKind, rounds, open });

const OWNERS_FIXED = [
  {
    n: 1, name: "Nguyễn Trường Thành", gender: "MALE", brand: "Iron District Fitness", city: "HCM", state: "ACTIVE", tier: "premium", inactivePlan: true,
    branches: [
      { district: ["HCM", "Phường Bến Thành"], label: "Quận 1", arch: "premium", status: "APPROVED", op: "OPEN", photos: 20, firstOfApplication: true, listing: L("APPROVED", 1, ["description", "addAmenity:KIDS_AREA"]), forceAmenities: 14 },
      { district: ["HCM", "Phường Bình Thạnh"], label: "Bình Thạnh", arch: "powerhouse", status: "APPROVED", op: "OPEN", photos: 3, listing: L("PENDING", 0, ["swapPhoto:1", "addAmenity:SWIMMING_POOL"]), forceAmenities: 9 },
      { district: ["HCM", "Phường Thủ Đức"], label: "Thủ Đức", arch: "budget", status: "APPROVED", op: "TEMPORARILY_CLOSED", opReason: "Sửa chữa hệ thống điều hòa, dự kiến mở lại sau 2 tuần.", photos: 3, listing: L("DRAFT", 0, ["description"]), forceAmenities: 4 },
    ],
  },
  {
    n: 2, name: "Vũ Tấn Cường", gender: "MALE", brand: "Peak Performance", city: "HCM", state: "ACTIVE", tier: "mid",
    branches: [
      { district: ["HCM", "Phường Phú Nhuận"], label: "Phú Nhuận", arch: "boxing", status: "APPROVED", op: "OPEN", photos: 6, firstOfApplication: true, listing: L("CHANGES_REQUESTED", 0, ["description", "proposal:Phòng boxing:TRAINING_ZONE"]) },
      { district: ["HCM", "Phường Gò Vấp"], label: "Gò Vấp", arch: "powerhouse", status: "SUSPENDED", op: "OPEN", photos: 4, listing: L("NONE") },
    ],
  },
  {
    n: 3, name: "Lâm Thu Hà", gender: "FEMALE", brand: "Lotus Yoga & Fitness", city: "HCM", state: "ACTIVE", tier: "mid",
    branches: [
      { district: ["HCM", "Phường Nhiêu Lộc"], label: "Quận 3", arch: "yoga", status: "APPROVED", op: "OPEN", photos: 6, firstOfApplication: true, listing: L("REJECTED", 0, ["description", "proposal:Phòng karaoke:SERVICE"]) },
      { district: ["HCM", "Phường An Khánh"], label: "Thảo Điền", arch: "yoga", status: "APPROVED", op: "OPEN", photos: 4, legacyNoAmenities: true, listing: L("NONE") },
    ],
  },
  {
    n: 4, name: "Trịnh Gia Bảo", gender: "MALE", brand: "Hanoi Strength Lab", city: "HN", state: "ACTIVE", tier: "mid",
    branches: [
      { district: ["HN", "Phường Cầu Giấy"], label: "Cầu Giấy", arch: "powerhouse", status: "APPROVED", op: "OPEN", photos: 8, firstOfApplication: true, appProposal: { name: "Khu strongman", category: "TRAINING_ZONE", note: "Có xích, tạ yoke, tạ đá và lốp xe cho bài strongman.", outcome: "APPROVED" }, listing: L("NONE") },
      { district: ["HN", "Phường Long Biên"], label: "Long Biên", arch: "powerhouse", status: "PENDING_REVIEW", op: "OPEN", photos: 5, listing: L("NONE") },
      { district: ["HN", "Phường Đống Đa"], label: "Đống Đa", arch: "powerhouse", status: "DRAFT", wizardStep: 4, photos: 2, listing: L("NONE") },
      { district: ["HN", "Phường Hai Bà Trưng"], label: "Hai Bà Trưng", arch: "budget", status: "APPROVED", op: "PERMANENTLY_CLOSED", opReason: "Hết hợp đồng thuê mặt bằng, chuyển toàn bộ hội viên sang chi nhánh Cầu Giấy.", photos: 3, listing: L("NONE") },
    ],
  },
  { n: 5, name: "Phùng Thanh Sơn", gender: "MALE", brand: "Saigon Movement Studio", city: "HCM", state: "APPROVED_PAYOUT_PENDING", tier: "mid",
    branches: [{ district: ["HCM", "Phường Tân Bình"], label: "Tân Bình", arch: "crossfit", status: "APPROVED", op: "OPEN", photos: 5, firstOfApplication: true, listing: L("NONE") }] },
  { n: 6, name: "Đoàn Minh Tâm", gender: "MALE", brand: "Tâm Fitness Studio", city: "HCM", state: "ONBOARDING", onboardingSections: 6, tier: "mid",
    branches: [{ district: ["HCM", "Phường Hòa Hưng"], label: "Quận 10", arch: "functional", status: "DRAFT", firstOfApplication: true, photos: 0, listing: L("NONE") }] },
  { n: 7, name: "Huỳnh Kim Ngân", gender: "FEMALE", brand: "Coastal Fit Đà Nẵng", city: "DN", state: "UNDER_REVIEW", tier: "mid",
    branches: [{ district: ["DN", "Phường Sơn Trà"], label: "Sơn Trà", arch: "wellness", status: "DRAFT", firstOfApplication: true, photos: 4, appProposal: { name: "Khu tắm biển nước ngọt", category: "FACILITY", note: "Vòi sen ngoài trời dành cho khách đi biển ghé tập.", outcome: "PENDING" }, listing: L("NONE") }] },
  { n: 8, name: "Tô Quang Vinh", gender: "MALE", brand: "Urban Pulse Gym", city: "HN", state: "CHANGES_REQUESTED", changes: { issues: [{ category: "AMENITIES", message: "Chi nhánh chưa có tiện ích nào được chọn. Vui lòng chọn tối thiểu các tiện ích hiện có tại phòng tập." }] }, tier: "mid",
    branches: [{ district: ["HN", "Phường Nghĩa Đô"], label: "Nghĩa Đô", arch: "powerhouse", status: "DRAFT", firstOfApplication: true, photos: 3, noAmenitiesInApplication: true, listing: L("NONE") }] },
  { n: 9, name: "Kiều Anh Thư", gender: "FEMALE", brand: "Bamboo Wellness", city: "HCM", state: "REJECTED", rejectReason: "Giấy phép kinh doanh không khớp với địa chỉ cơ sở đăng ký. Vui lòng nộp hồ sơ mới với giấy tờ chính xác.", tier: "mid",
    branches: [{ district: ["HCM", "Phường Tân Mỹ"], label: "Quận 7", arch: "wellness", status: "DRAFT", firstOfApplication: true, photos: 3, listing: L("NONE") }] },
  { n: 10, name: "Cao Văn Lộc", gender: "MALE", brand: "Titan Gym Biên Hòa", city: "DNAI", state: "SUSPENDED", suspendReason: "Có nhiều khiếu nại chưa được xử lý về hoàn tiền hội viên. Tạm ngưng để rà soát.", tier: "budget",
    branches: [
      { district: ["DNAI", "Phường Biên Hòa"], label: "Biên Hòa", arch: "powerhouse", status: "APPROVED", op: "OPEN", photos: 5, firstOfApplication: true, listing: L("NONE") },
      { district: ["DNAI", "Phường Trấn Biên"], label: "Trấn Biên", arch: "budget", status: "APPROVED", op: "OPEN", photos: 4, listing: L("NONE") },
    ] },
];

// generated owners: [name?, brand, city, state, branchCount, tier]
const GENERATED = [
  { brand: "Dragon Fit Club", city: "HCM", state: "ACTIVE", count: 10, tier: "mid" },
  { brand: "Phoenix Athletic Club", city: "HN", state: "ACTIVE", count: 9, tier: "premium" },
  { brand: "Hải Đăng Sport Center", city: "DN", state: "ACTIVE", count: 7, tier: "mid" },
  { brand: "Saigon Barbell Club", city: "HCM", state: "ACTIVE", count: 8, tier: "mid" },
  { brand: "Mekong Fitness", city: "HCM", state: "ACTIVE", count: 7, tier: "budget" },
  { brand: "Zen Pilates Studio", city: "HN", state: "ACTIVE", count: 6, tier: "premium" },
  { brand: "Việt Power Gym", city: "HN", state: "ACTIVE", count: 6, tier: "budget" },
  { brand: "Sắc Xanh Wellness", city: "HCM", state: "APPROVED_PAYOUT_PENDING", count: 1, tier: "mid" },
  { brand: "Rồng Vàng Boxing Club", city: "DNAI", state: "SUSPENDED", count: 2, tier: "budget" },
  { brand: "Ocean CrossFit", city: "DN", state: "ONBOARDING", onboardingSections: 3, count: 1, tier: "mid" },
  { brand: "Alpha Strength Club", city: "HN", state: "ONBOARDING", onboardingSections: 9, count: 1, tier: "mid" },
  { brand: "Lạc Hồng Gym & Spa", city: "HCM", state: "UNDER_REVIEW", count: 1, tier: "premium" },
  { brand: "Thể Hình Bình Minh", city: "HCM", state: "UNDER_REVIEW", count: 1, tier: "budget" },
  { brand: "Vạn Phúc Fitness", city: "DN", state: "CHANGES_REQUESTED", changes: { issues: [{ category: "PHOTOS", message: "Ảnh cơ sở bị mờ và thiếu ảnh khu tập chính. Vui lòng tải lại ít nhất 3 ảnh rõ nét." }], documents: [{ docType: "BUSINESS_LICENSE", note: "Bản scan giấy phép bị cắt mất góc, vui lòng tải lại bản đầy đủ." }] }, count: 1, tier: "mid" },
  { brand: "Fit24 Sài Gòn", city: "HCM", state: "REJECTED", rejectReason: "Cơ sở chưa hoàn thiện, ảnh chụp công trình đang thi công. Hãy nộp lại khi phòng tập sẵn sàng đón khách.", count: 1, tier: "mid" },
];

const GEN_STATUS_QUOTA = [
  ["APPROVED/OPEN", 36], ["APPROVED/TEMPORARILY_CLOSED", 5], ["APPROVED/PERMANENTLY_CLOSED", 2], ["SUSPENDED/OPEN", 2], ["DRAFT", 3], ["PENDING_REVIEW", 3], ["REJECTED", 2],
]; // sums to 53 = 10+9+7+8+7+6+6 minus the 7 application branches that are always APPROVED/OPEN -> see below (46 free slots)

const ACTIVE_LISTING_QUOTA = [
  ["NONE", 8], ["DRAFT", 4], ["PENDING", 5], ["CHANGES_REQUESTED", 3], ["REJECTED", 2], ["STALE", 2], ["APPROVED", 15],
];

const TWEAK_ROUND_SETS = [["description"], ["description", "addAmenity:KIDS_AREA"], ["addAmenity:SAUNA"], ["description", "swapPhoto:0"], ["addAmenity:DRINKING_WATER", "description"]];
const TWEAK_OPEN_SETS = [["description"], ["swapPhoto:1"], ["addAmenity:INBODY_SCAN", "description"], ["addAmenity:PARKING"], ["description", "swapPhoto:0"]];

function expandQuota(pairs) {
  const out = [];
  for (const [v, n] of pairs) for (let i = 0; i < n; i++) out.push(v);
  return out;
}
function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ARCH_KEYS = Object.keys(ARCH);
const ARCH_BY_TIER = { budget: ["budget", "budget", "powerhouse", "boxing"], mid: ["powerhouse", "powerhouse", "crossfit", "yoga", "boxing", "wellness"], premium: ["premium", "premium", "wellness", "yoga", "powerhouse"] };

function amenitiesFor(archKey, rng, h, forceCount) {
  const a = ARCH[archKey];
  let sys = [...a.core, ...h.sample(a.extras, h.int(0, a.extras.length))];
  if (forceCount) {
    const rest = SYSTEM_AMENITIES.filter((s) => !sys.includes(s));
    while (sys.length < forceCount - 2 && rest.length) sys.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
    while (sys.length > forceCount - 2) sys.pop();
  }
  const custom = forceCount ? ["stretching", "recovery"] : h.sample(a.customKeys, h.int(0, a.customKeys.length));
  return { system: [...new Set(sys)], custom };
}

export function buildOwners(names, { clientsByCity } = {}) {
  const pool = gymPhotoPool();
  const owners = [];
  const usedBranchSlugs = new Set();

  // slots for the generated ACTIVE chains' non-first branches
  const rngSlots = rngFrom("owners:slots");
  const genActive = GENERATED.filter((g) => g.state === "ACTIVE");
  const freeSlots = shuffled(expandQuota(GEN_STATUS_QUOTA), rngSlots);
  // 53 listed in the quota vs 46 free slots (53 - 7 application branches): drop the first 7 APPROVED/OPEN to keep the totals honest
  let dropped = 0;
  const slots = freeSlots.filter((s) => (s === "APPROVED/OPEN" && dropped < 7 ? (dropped++, false) : true));
  const listingSlots = shuffled(expandQuota(ACTIVE_LISTING_QUOTA), rngFrom("owners:listing"));

  const build = (spec, idx) => {
    const isFixed = idx < OWNERS_FIXED.length;
    const person = isFixed ? names.reserve(spec.name, spec.gender) : names.next();
    const slug = person.slug;
    const rng = rngFrom(`owner:${slug}`);
    const h = makeHelpers(rng);
    const cityKey = spec.city;
    const cityAreas = areasOfCity(cityKey);
    const usedAreas = new Set();
    const branches = [];

    const specBranches = isFixed
      ? spec.branches
      : Array.from({ length: spec.count }, (_, i) => ({ generated: true, first: i === 0 }));

    specBranches.forEach((b, bi) => {
      let area, label, archKey, status, op, photos, listing, opReason, legacyNoAmenities, forceAmenities, wizardStep, firstOfApplication, appProposal, noAmenitiesInApplication;
      if (b.generated) {
        let pick;
        do pick = h.pick(cityAreas);
        while (usedAreas.has(pick.wardName) && usedAreas.size < cityAreas.length);
        area = pick;
        label = pick.district === spec.city ? pick.wardName.replace(/^(Phường|Xã) /, "") : pick.wardName.replace(/^(Phường|Xã) /, "");
        archKey = h.pick(ARCH_BY_TIER[spec.tier]);
        firstOfApplication = bi === 0;
        if (spec.state === "ACTIVE" && !firstOfApplication) {
          const slot = slots.shift() ?? "APPROVED/OPEN";
          if (slot.startsWith("APPROVED")) { status = "APPROVED"; op = slot.split("/")[1]; }
          else if (slot.startsWith("SUSPENDED")) { status = "SUSPENDED"; op = "OPEN"; }
          else { status = slot; op = undefined; }
        } else if (spec.state === "ACTIVE") {
          status = "APPROVED"; op = "OPEN";
        } else if (spec.state === "APPROVED_PAYOUT_PENDING") {
          status = "APPROVED"; op = "OPEN";
        } else if (spec.state === "SUSPENDED") {
          status = "APPROVED"; op = "OPEN";
        } else {
          status = "DRAFT";
        }
        const live = status === "APPROVED" && op !== "PERMANENTLY_CLOSED";
        const wantsListing = spec.state === "ACTIVE" && live && !firstOfApplication ? listingSlots.shift() ?? "NONE" : "NONE";
        listing = L(wantsListing, wantsListing === "APPROVED" ? 1 + (h.chance(0.3) ? 1 : 0) : 0, wantsListing === "NONE" ? [] : h.pick(TWEAK_OPEN_SETS));
        if (wantsListing === "APPROVED") listing.roundTweaks = Array.from({ length: listing.rounds }, () => h.pick(TWEAK_ROUND_SETS));
        photos = status === "DRAFT" && !firstOfApplication ? h.int(0, 3) : h.pick([3, 4, 5, 5, 6, 6, 8, 10, 12]);
        if (status === "DRAFT" && firstOfApplication) photos = h.pick([0, 3, 4]);
        opReason = op === "TEMPORARILY_CLOSED" ? h.pick(["Bảo trì định kỳ khu cardio.", "Nâng cấp sàn tập và hệ thống thông gió.", "Đóng cửa trong dịp sửa chữa mặt bằng."]) : op === "PERMANENTLY_CLOSED" ? h.pick(["Hết hợp đồng thuê mặt bằng.", "Chủ cơ sở chuyển hướng kinh doanh."]) : undefined;
        wizardStep = status === "DRAFT" ? h.int(2, 6) : undefined;
        legacyNoAmenities = false;
      } else {
        area = findArea(b.district[0], b.district[1]);
        ({ label, status, op, photos, listing, opReason, legacyNoAmenities, forceAmenities, wizardStep, firstOfApplication, appProposal, noAmenitiesInApplication } = b);
        archKey = b.arch === "functional" ? "crossfit" : b.arch;
      }
      usedAreas.add(area.wardName);
      const bh = makeHelpers(rngFrom(`branch:${slug}:${bi}`));
      const name = `${spec.brand} ${label}`;
      let bslug = slugify(name);
      for (let k = 2; usedBranchSlugs.has(bslug); k++) bslug = `${slugify(name)}-${k}`;
      usedBranchSlugs.add(bslug);
      const pin = jitterLatLng(area, rng);
      const amenities = legacyNoAmenities || noAmenitiesInApplication ? { system: [], custom: [] } : amenitiesFor(archKey, rng, bh, forceAmenities);
      const photoFiles = pickDistinct(pool, ARCH[archKey].cats, photos ?? 0, bh);
      const descList = DESCRIPTIONS[archKey];
      branches.push({
        key: `branch:${bslug}`,
        slug: bslug,
        gymId: did("branch", bslug),
        ownerSlug: slug,
        index: bi,
        name,
        label,
        area,
        archetype: archKey,
        archetypeLabel: ARCH[archKey].label,
        address: addressLine(area, rng),
        latitude: pin.latitude,
        longitude: pin.longitude,
        phone: landlinePhone(area, rng),
        email: `${bslug}@seed.gymini.test`,
        description: descList[Math.floor(rng() * descList.length)],
        locationNote: bh.chance(0.5) ? "Cổng chính nhìn ra đường lớn, có bảng hiệu màu cam." : undefined,
        status,
        op,
        opReason,
        wizardStep,
        firstOfApplication: !!firstOfApplication,
        legacyNoAmenities: !!legacyNoAmenities,
        amenities,
        photoFiles,
        coverIndex: 0,
        hours: hoursToDays(HOURS_PATTERNS[bh.pick(["standard", "standard", "late", "studio", ...(archKey === "budget" ? [] : ["allday"])])]),
        appProposal: appProposal ?? null,
        listing: listing ?? L("NONE"),
        createdVia: firstOfApplication ? "APPLICATION" : legacyNoAmenities ? "LEGACY_QUICK" : bh.chance(0.15) && status !== "DRAFT" ? "QUICK" : "WIZARD",
      });
    });

    const planRng = rngFrom(`plans:${slug}`);
    const brandSlug = slugify(spec.brand);
    const state = spec.state;
    const partner = {
      state,
      onboardingSections: spec.onboardingSections ?? null,
      changes: spec.changes ?? null,
      rejectReason: spec.rejectReason ?? null,
      suspendReason: spec.suspendReason ?? null,
      payoutDone: state === "ACTIVE" || state === "SUSPENDED",
      representative: { name: person.full, phone: mobilePhone(rng), role: h.pick(["GYM_OWNER", "GYM_OWNER", "CO_FOUNDER", "LEGAL_REPRESENTATIVE"]) },
      scale: branches.length > 1 ? "MULTIPLE_BRANCHES" : "ONE_BRANCH",
      legal: { legalName: `Công ty TNHH ${spec.brand}`, taxCode: sellerTaxCode(idx, h.int(300000000, 319999999), h.int(100, 999)), businessLicenseNo: `${h.int(41, 79)}${h.pick(["A", "B", "C"])}-${h.int(100000, 999999)}` },
      social: { facebookUrl: `https://www.facebook.com/${brandSlug.replace(/-/g, "")}`, instagramUrl: h.chance(0.7) ? `https://www.instagram.com/${brandSlug.replace(/-/g, "_")}` : null, tiktokUrl: h.chance(0.3) ? `https://www.tiktok.com/@${brandSlug.replace(/-/g, "")}` : null, youtubeUrl: null },
      bank: (() => { const [bank] = h.pick(BANKS); return { bankName: bank, accountNumber: String(h.int(100000000, 999999999)) + String(h.int(100, 999)), accountHolder: person.full.normalize("NFD").replace(/\p{M}+/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toUpperCase() }; })(),
      contactPhone: mobilePhone(rng),
    };
    owners.push({
      key: `owner:${slug}`,
      kind: "OWNER",
      n: spec.n ?? idx + 1,
      slug,
      person,
      email: seedEmail(slug),
      city: cityKey,
      brand: { name: spec.brand, slug: brandSlug, description: `${spec.brand} — chuỗi phòng tập ${ARCH[branches[0].archetype].label} tại ${branches[0].area.city}.`.slice(0, 300), tier: spec.tier },
      partner,
      branches,
      plans: plansFor(spec.tier, planRng, { inactive: !!spec.inactivePlan || (idx % 4 === 0) }),
    });
  };

  OWNERS_FIXED.forEach((s, i) => build(s, i));
  GENERATED.forEach((s, i) => build({ ...s, n: OWNERS_FIXED.length + i + 1 }, OWNERS_FIXED.length + i));
  return owners;
}

export { ARCH, PRICE_TIERS };

/**
 * Valid Vietnamese tax code (gym-service TAX_CODE_PATTERN: 10 digits, optional "-NNN" branch suffix), deterministic and unique per
 * owner: 10 digits = "0" + 9 digits whose upper part is the owner index (so two owners can never clash) and whose lower part comes
 * from the rng draw. The two rng draws stay in place so the rest of the world does not shift.
 */
export function sellerTaxCode(idx, draw, _branchDraw) {
  return `0${String(300000000 + idx * 100000 + (draw % 100000))}`;
}
