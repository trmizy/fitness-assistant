// ~80 personal trainers. P1-P16 are the plan's fixed matrix (8.1); the other 64 fill the quotas so every application state,
// every listing state, every restriction type and the 0/1/3/5 photo counts are all present.
import { did, makeHelpers, rngFrom, seedEmail, normalizeVi } from "../util.mjs";
import { addressLine, areasOfCity, findArea, jitterLatLng, mobilePhone } from "../geo.mjs";
import { LANGUAGES, SPECIALTIES, TARGET_GROUPS, TRAINING_GOALS, YEARS_OF_EXPERIENCE, WEEKDAY_SHORT } from "./constants.mjs";
import { pickPhysique } from "./assets.mjs";

export const PT_COUNT = 80;

const BIOS = [
  "Huấn luyện viên cá nhân với phương pháp tập tiến triển rõ ràng, chú trọng kỹ thuật an toàn và thói quen bền vững. Đã đồng hành cùng hàng trăm học viên đạt mục tiêu.",
  "Tập trung vào giảm mỡ và tái cấu trúc cơ thể cho người đi làm bận rộn. Giáo án ngắn gọn, ăn uống thực tế, không kiêng khem cực đoan.",
  "Chuyên tăng cơ và sức mạnh cho người mới bắt đầu đến trung cấp. Mỗi buổi tập có mục tiêu đo lường được và ghi chép tiến độ.",
  "Từng thi đấu thể hình nghiệp dư, hiện chuyển sang huấn luyện. Kết hợp tạ tự do, calisthenics và phục hồi vận động.",
  "Có nền tảng vật lý trị liệu, chuyên hỗ trợ học viên sau chấn thương quay lại tập luyện an toàn và tự tin.",
  "Huấn luyện sức bền và HIIT cho người muốn cải thiện thể lực tổng thể. Lớp online và offline linh hoạt theo lịch của bạn.",
  "Đồng hành cùng phụ nữ sau sinh và người trên 40 tuổi tập lại một cách nhẹ nhàng, đúng cách, có theo dõi nhịp tim.",
  "Huấn luyện powerlifting và sức mạnh cơ bản. Dạy kỹ thuật squat, bench, deadlift từ nền móng và lập kế hoạch chu kỳ.",
];
const METHODS = [
  "Đánh giá thể trạng ban đầu, đặt mục tiêu 12 tuần, chia giai đoạn rõ ràng và điều chỉnh theo phản hồi mỗi tuần.",
  "Quá tải tiến triển, ghi nhật ký buổi tập, kiểm tra InBody hàng tháng để đánh giá thay đổi cơ và mỡ.",
  "Kết hợp tập tạ, cardio nhẹ và hướng dẫn dinh dưỡng đơn giản, dễ theo trong sinh hoạt hằng ngày.",
];
const EDU = ["Cử nhân Giáo dục thể chất, ĐH Thể dục Thể thao", "Cao đẳng Huấn luyện thể thao", "Cử nhân Dinh dưỡng, ĐH Y Dược", "Chứng chỉ PT quốc tế kèm khóa sơ cứu"];
const CERTS = [
  ["ACE Certified Personal Trainer", "American Council on Exercise"],
  ["NASM-CPT", "National Academy of Sports Medicine"],
  ["ISSA Personal Trainer", "International Sports Sciences Association"],
  ["Chứng chỉ HLV Thể hình", "Tổng cục Thể dục Thể thao Việt Nam"],
  ["Precision Nutrition Level 1", "Precision Nutrition"],
  ["Yoga Alliance RYT-200", "Yoga Alliance"],
  ["CrossFit Level 1 Trainer", "CrossFit Inc."],
  ["FMS Level 1", "Functional Movement Systems"],
];
const PACKAGE_TEMPLATES = [
  { name: "Gói khởi động 4 buổi", sessionCount: 4, per: 1.15, mode: "OFFLINE", mins: 60, days: 45, description: "Làm quen với PT, đánh giá thể trạng và học kỹ thuật cơ bản." },
  { name: "Gói 10 buổi", sessionCount: 10, per: 1.0, mode: "OFFLINE", mins: 60, days: 90, description: "Gói phổ biến: đủ buổi để xây nền tảng kỹ thuật và thói quen." },
  { name: "Gói 20 buổi", sessionCount: 20, per: 0.92, mode: "OFFLINE", mins: 60, days: 150, description: "Lộ trình 2–3 tháng cho mục tiêu thay đổi vóc dáng rõ rệt." },
  { name: "Gói 30 buổi", sessionCount: 30, per: 0.88, mode: "OFFLINE", mins: 60, days: 210, description: "Chương trình dài hạn kèm theo dõi dinh dưỡng." },
  { name: "Gói online 8 buổi", sessionCount: 8, per: 0.7, mode: "ONLINE", mins: 45, days: 60, description: "Tập qua video, PT chỉnh kỹ thuật và gửi giáo án mỗi tuần." },
  { name: "Gói online 16 buổi", sessionCount: 16, per: 0.65, mode: "ONLINE", mins: 45, days: 120, description: "Huấn luyện từ xa linh hoạt giờ giấc, phù hợp người hay đi công tác." },
];

const APP_QUOTA = [["DRAFT", 4], ["SUBMITTED", 4], ["UNDER_REVIEW", 3], ["NEEDS_MORE_INFO", 3], ["REJECTED", 3]]; // the rest (63) are APPROVED
// listing outcome for APPROVED PTs: 61 slots + 2 extra APPROVED
const LISTING_QUOTA = [["NONE", 6], ["DRAFT", 6], ["PENDING", 8], ["CHANGES_REQUESTED", 5], ["REJECTED", 4], ["STALE", 4], ["APPROVED", 30]];

const F = (full, gender, extra) => ({ full, gender, ...extra });
const FIXED = [
  F("Trần Minh Khoa", "MALE", { app: "APPROVED", listing: "APPROVED", listingRounds: 3, photos: 5, packages: 4, inactivePkgs: 1, contracts: ["ACTIVE", "COMPLETED"], reviews: 12, city: "HCM", ward: "Phường Bến Thành", spec: ["Tăng cơ", "Thể hình"] }),
  F("Lê Hoàng Nam", "MALE", { app: "APPROVED", listing: "PENDING", pendingPriceBump: { pkgIndex: 1, from: 2000000, to: 2500000 }, photos: 3, swapPhoto: true, packages: 2, contracts: ["ACTIVE"], city: "HCM", ward: "Phường Nhiêu Lộc", spec: ["Giảm mỡ", "HIIT"] }),
  F("Phạm Gia Huy", "MALE", { app: "APPROVED", listing: "CHANGES_REQUESTED", childDraft: true, photos: 1, packages: 1, city: "HCM", ward: "Phường Bình Thạnh", spec: ["Powerlifting"] }),
  F("Nguyễn Hoàng Anh", "FEMALE", { app: "APPROVED", listing: "REJECTED", photos: 3, packages: 3, city: "HN", ward: "Phường Cầu Giấy", spec: ["Yoga", "Dẻo dai & Vận động"] }),
  F("Trần Ngọc Mai", "FEMALE", { app: "APPROVED", listing: "DRAFT", photos: 0, packages: 5, sparseProfile: true, city: "HCM", ward: "Phường Phú Nhuận", spec: ["Giảm mỡ"] }),
  F("Võ Minh Quân", "MALE", { app: "APPROVED", fresh: true, listing: "PENDING", firstListing: true, photos: 0, packages: 0, city: "HN", ward: "Phường Đống Đa", spec: ["Thể hình"] }),
  F("Bùi Thanh Hà", "FEMALE", { app: "APPROVED", listing: "APPROVED", listingRounds: 1, photos: 3, packages: 2, suspended: true, city: "HCM", ward: "Phường Tân Bình", spec: ["Yoga", "Phục hồi chấn thương"] }),
  F("Đặng Quốc Bảo", "MALE", { app: "APPROVED", listing: "APPROVED", listingRounds: 1, photos: 1, packages: 2, contractRestricted: true, contracts: ["ACTIVE"], city: "HN", ward: "Phường Hai Bà Trưng", spec: ["Powerlifting", "Tăng cơ"] }),
  F("Hoàng Thu Trang", "FEMALE", { app: "APPROVED", listing: "APPROVED", listingRounds: 2, photos: 5, packages: 6, notAccepting: true, city: "DN", ward: "Phường Hải Châu", spec: ["Giảm mỡ", "Dinh dưỡng thể thao"] }),
  F("Châu Ngọc Hân", "FEMALE", { app: "APPROVED", listing: "STALE", photos: 3, packages: 2, adminDirectEdit: true, city: "HCM", ward: "Phường Gò Vấp", spec: ["Functional Training", "HIIT"] }),
  F("Lý Thành Đạt", "MALE", { app: "APPROVED", listing: "APPROVED", listingRounds: 1, photos: 1, packages: 1, noOrders: true, city: "DN", ward: "Phường Sơn Trà", spec: ["Boxing & MMA"] }),
  F("Đỗ Khánh Linh", "FEMALE", { app: "DRAFT", city: "HCM", ward: "Phường Tân Phú", spec: ["Yoga"] }),
  F("Phan Anh Tuấn", "MALE", { app: "SUBMITTED", city: "HCM", ward: "Phường Thủ Đức", spec: ["Tăng cơ"] }),
  F("Mai Phương Thảo", "FEMALE", { app: "UNDER_REVIEW", city: "HN", ward: "Phường Yên Hòa", spec: ["Giảm mỡ", "Yoga"] }),
  F("Tạ Minh Hiếu", "MALE", { app: "NEEDS_MORE_INFO", adminNote: "Ảnh CCCD mặt sau bị mờ và chưa có bản sao chứng chỉ. Vui lòng tải lại ảnh rõ nét.", city: "HCM", ward: "Phường Tăng Nhơn Phú", spec: ["Calisthenics"] }),
  F("Kha Bảo Ngọc", "FEMALE", { app: "REJECTED", rejectionReason: "Chứng chỉ không còn hiệu lực và thông tin kinh nghiệm chưa thể xác minh.", city: "HN", ward: "Phường Thanh Xuân", spec: ["Dinh dưỡng thể thao"] }),
];

const expand = (pairs) => pairs.flatMap(([v, n]) => Array(n).fill(v));
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildPts(names) {
  const rngQ = rngFrom("pts:quota");
  const fixedApp = {};
  const fixedListing = {};
  for (const f of FIXED) {
    fixedApp[f.app] = (fixedApp[f.app] ?? 0) + 1;
    if (f.app === "APPROVED") fixedListing[f.listing] = (fixedListing[f.listing] ?? 0) + 1;
  }
  const appSlots = [];
  for (const [k, n] of APP_QUOTA) for (let i = 0; i < n - (fixedApp[k] ?? 0); i++) appSlots.push(k);
  const approvedToGenerate = PT_COUNT - FIXED.length - appSlots.length;
  const listingSlots = [];
  for (const [k, n] of LISTING_QUOTA) for (let i = 0; i < n - (fixedListing[k] ?? 0); i++) listingSlots.push(k);
  while (listingSlots.length < approvedToGenerate) listingSlots.push("APPROVED");
  const listing = shuffle(listingSlots, rngQ);
  const apps = shuffle([...appSlots, ...Array(approvedToGenerate).fill("APPROVED")], rngQ);

  // special flags among generated APPROVED PTs
  const approvedIdx = apps.map((a, i) => (a === "APPROVED" ? i : -1)).filter((i) => i >= 0);
  const flagged = shuffle(approvedIdx, rngQ);
  const suspended = new Set(flagged.slice(0, 2)); // + P7 = 3 suspended accounts
  const accountRestricted = new Set(flagged.slice(2, 5)); // PT-scope (ACCOUNT) restriction via POST /admin/pts/:id/suspend
  const contractRestricted = new Set(flagged.slice(5, 7)); // + P8 = 3 contract-scope
  const notAccepting = new Set(flagged.slice(7, 10)); // + P9
  const photoCounts = [0, 1, 3, 5];

  const out = [];
  let gen = 0;
  const build = (spec, isFixed, genIdx) => {
    const person = isFixed ? names.reserve(spec.full, spec.gender) : names.next();
    const slug = person.slug;
    const rng = rngFrom(`pt:${slug}`);
    const h = makeHelpers(rng);
    const cityKey = spec.city ?? h.weighted([["HCM", 55], ["HN", 30], ["DN", 15]]);
    const area = spec.ward ? findArea(cityKey, spec.ward) : h.pick(areasOfCity(cityKey));
    const appState = spec.app;
    const approved = appState === "APPROVED";
    const specialties = spec.spec ?? h.sample(SPECIALTIES, h.int(1, 3));
    const online = h.chance(0.35);
    const mode = online ? "HYBRID" : "OFFLINE";
    const base = h.pick([250000, 300000, 350000, 400000, 450000, 500000, 600000, 700000]);
    const pinned = spec.pendingPriceBump ? 200000 : base; // 10 sessions = 2.000.000 for the "price bump" PT
    const photos = approved ? (spec.photos ?? h.pick([0, 1, 3, 3, 5, 5])) : 0;
    const pkgCount = approved ? (spec.packages ?? h.pick([0, 1, 2, 2, 3, 3, 4, 5, 6])) : 0;
    const inactive = approved ? (spec.inactivePkgs ?? (pkgCount >= 3 && h.chance(0.3) ? 1 : 0)) : 0;
    const listingKind = approved ? (spec.listing ?? listing.shift()) : null;
    const packages = Array.from({ length: pkgCount }, (_, i) => {
      const t = PACKAGE_TEMPLATES[i % PACKAGE_TEMPLATES.length];
      let price = Math.round((pinned * t.sessionCount * t.per) / 10000) * 10000;
      if (t.sessionCount === 10 && spec.pendingPriceBump) price = spec.pendingPriceBump.from;
      return {
        name: t.name,
        description: t.description,
        price,
        sessionCount: t.sessionCount,
        sessionMode: t.mode,
        sessionDurationMinutes: t.mins,
        validityDays: t.days,
        isActive: i >= pkgCount - inactive ? false : true,
      };
    });
    if (spec.pendingPriceBump && packages[spec.pendingPriceBump.pkgIndex]) packages[spec.pendingPriceBump.pkgIndex].price = spec.pendingPriceBump.from;
    const gender = person.gender;
    const years = h.pick(YEARS_OF_EXPERIENCE.slice(1));
    const certN = h.int(1, 3);
    const avail = h.sample(WEEKDAY_SHORT, h.int(3, 6));
    const idx = isFixed ? null : genIdx;
    const flags = {
      suspended: !!spec.suspended || (idx !== null && suspended.has(idx)),
      accountRestricted: !!spec.accountRestricted || (idx !== null && accountRestricted.has(idx)),
      contractRestricted: !!spec.contractRestricted || (idx !== null && contractRestricted.has(idx)),
      notAccepting: !!spec.notAccepting || (idx !== null && notAccepting.has(idx)),
    };
    const loc = { ...jitterLatLng(area, rng), addressLine: addressLine(area, rng) };
    const ptn = {
      key: `pt:${slug}`,
      kind: "PT",
      slug,
      person,
      email: seedEmail(slug),
      userId: did("pt", slug),
      profileId: did("pt-profile", slug),
      isFixed,
      app: {
        state: appState,
        adminNote: spec.adminNote ?? (appState === "NEEDS_MORE_INFO" ? "Vui lòng bổ sung bản sao chứng chỉ còn hiệu lực." : null),
        rejectionReason: spec.rejectionReason ?? (appState === "REJECTED" ? h.pick(["Chứng chỉ chưa thể xác minh với đơn vị cấp.", "Hồ sơ kinh nghiệm chưa đủ để tham gia nền tảng."]) : null),
        phoneNumber: mobilePhone(rng),
        nationalIdNumber: String(h.int(79000000000, 79999999999)),
        currentAddress: `${loc.addressLine}, ${area.wardName}, ${area.provinceName}`,
        yearsOfExperience: years,
        educationBackground: h.pick(EDU),
        previousWorkExperience: `${h.int(2, 8)} năm huấn luyện tại các câu lạc bộ ở ${area.city}.`,
        professionalBio: spec.sparseProfile ? null : h.pick(BIOS),
        mainSpecialties: specialties,
        targetClientGroups: spec.sparseProfile ? [] : h.sample(TARGET_GROUPS, h.int(2, 4)),
        primaryTrainingGoals: spec.sparseProfile ? [] : h.sample(TRAINING_GOALS, h.int(2, 3)),
        trainingMethodsApproach: spec.sparseProfile ? null : h.pick(METHODS),
        linkedinUrl: h.chance(0.3) ? `https://www.linkedin.com/in/${slug}` : null,
        websiteUrl: h.chance(0.25) ? `https://${slug.replace(/-/g, "")}.example.vn` : null,
        serviceMode: mode,
        operatingAreas: [area.district, area.city],
        onlinePricePerSession: online ? Math.round(pinned * 0.7 / 10000) * 10000 : null,
        offlinePricePerSession: pinned,
        onlinePackagePrice: online ? Math.round(pinned * 8 * 0.65 / 10000) * 10000 : null,
        offlinePackagePrice: Math.round(pinned * 10 / 10000) * 10000,
        sessionsPerPackage: 10,
        sessionDurationMinutes: 60,
        availableDays: avail,
        availableFrom: h.pick(["05:30", "06:00", "07:00"]),
        availableUntil: h.pick(["20:00", "21:00", "21:30"]),
        availabilityBlocks: avail.map((d) => ({ dayOfWeek: WEEKDAY_SHORT.indexOf(d) + 1 === 7 ? 0 : WEEKDAY_SHORT.indexOf(d) + 1, startTime: "06:00", endTime: "11:00" })),
        languages: h.chance(0.7) ? ["Tiếng Việt"] : ["Tiếng Việt", h.pick(LANGUAGES.slice(1, 3))],
        gymAffiliation: h.chance(0.4) ? `Phòng tập khu vực ${area.district}` : null,
        trainingLocations: [
          { provinceCode: area.provinceCode, wardCode: area.wardCode, gymName: h.chance(0.6) ? `Phòng tập ${area.district}` : null, addressLine: loc.addressLine, isPrimary: true, ...(h.chance(0.5) ? { note: undefined } : {}) },
        ],
        certificates: Array.from({ length: certN }, (_, c) => {
          const [name, org] = CERTS[(h.int(0, CERTS.length - 1) + c) % CERTS.length];
          return { certificateName: name, issuingOrganization: org, isCurrentlyValid: appState !== "REJECTED", certificationStatus: "Valid", issueDate: `${h.int(2018, 2024)}-0${h.int(1, 9)}-15` };
        }),
      },
      city: cityKey,
      area,
      loc,
      gender,
      specialties,
      listing: {
        kind: listingKind,
        rounds: spec.listingRounds ?? (listingKind === "APPROVED" ? h.pick([1, 1, 2]) : 0),
        firstListing: !!spec.firstListing,
        childDraft: !!spec.childDraft || listingKind === "CHANGES_REQUESTED",
        adminDirectEdit: !!spec.adminDirectEdit || listingKind === "STALE",
        swapPhoto: !!spec.swapPhoto,
        pendingPriceBump: spec.pendingPriceBump ?? null,
      },
      photoFiles: pickPhysique(gender, photos),
      packages,
      flags,
      contracts: approved && !spec.noOrders && !flags.suspended ? (spec.contracts ?? (h.chance(0.35) ? [h.pick(["ACTIVE", "ACTIVE", "COMPLETED", "PENDING_PAYMENT"])] : [])) : [],
      reviewTarget: spec.reviews ?? 0,
      profile: {
        userId: did("pt", slug),
        profileId: did("pt-profile", slug),
        firstName: person.firstName,
        lastName: person.lastName,
        email: seedEmail(slug),
        gender,
        heightCm: gender === "MALE" ? h.int(168, 190) : h.int(155, 175),
        firstNameNormalized: normalizeVi(person.firstName),
        lastNameNormalized: normalizeVi(person.lastName),
      },
    };
    // A published photo / package can only exist after an APPROVED revision (an approved application is listing v1 = empty).
    if (approved && !ptn.listing.firstListing) {
      if (listingKind === "NONE") {
        ptn.photoFiles = [];
        ptn.packages = [];
        ptn.listing.rounds = 0;
      } else if (ptn.listing.rounds < 1 && (ptn.photoFiles.length > 0 || ptn.packages.length > 0)) {
        ptn.listing.rounds = 1;
      }
    }
    if (ptn.packages.length === 0) ptn.contracts = [];
    out.push(ptn);
  };

  FIXED.forEach((f) => build(f, true, null));
  const remainingApps = apps;
  while (out.length < PT_COUNT) {
    const i = gen++;
    build({ app: remainingApps[i] }, false, i);
  }
  void photoCounts;
  return out;
}
