// Natural Vietnamese personal names. Pools are real, common names; combinations are drawn deterministically and
// every full name is unique, so no "Nguyễn Văn A", "Test PT", "Demo User", "PT 01" can ever appear (see names.test.mjs).
import { makeHelpers, rngFrom, slugify } from "./util.mjs";

const SURNAMES = [
  ["Nguyễn", 30], ["Trần", 12], ["Lê", 10], ["Phạm", 7], ["Hoàng", 4], ["Huỳnh", 4], ["Phan", 4], ["Vũ", 4], ["Võ", 4],
  ["Đặng", 3], ["Bùi", 3], ["Đỗ", 3], ["Hồ", 2], ["Ngô", 2], ["Dương", 2], ["Lý", 2], ["Đinh", 1], ["Trịnh", 1],
  ["Mai", 1], ["Lâm", 1], ["Tạ", 1], ["Cao", 1], ["Châu", 1], ["Kiều", 1], ["Tô", 1], ["Phùng", 1], ["Đoàn", 1],
  ["Kha", 1], ["Quách", 1], ["Lương", 1], ["Thái", 1], ["Trương", 2], ["Diệp", 1], ["Văn", 1], ["La", 1],
];

const MALE_MIDDLE = ["Văn", "Minh", "Quốc", "Hoàng", "Thanh", "Gia", "Đức", "Anh", "Tuấn", "Hữu", "Công", "Trọng", "Xuân", "Bảo", "Trường", "Thành", "Quang", "Nhật", "Đình", "Hải"];
const FEMALE_MIDDLE = ["Thị", "Thu", "Ngọc", "Phương", "Khánh", "Bảo", "Thanh", "Mai", "Kim", "Hồng", "Diệu", "Quỳnh", "Thúy", "Hà", "Cẩm", "Tuyết", "Hoài", "Minh", "Gia", "Ánh"];
const MALE_GIVEN = [
  "Khoa", "Nam", "Huy", "Quân", "Bảo", "Đạt", "Tuấn", "Hiếu", "Phúc", "Long", "Dũng", "Hùng", "Thành", "Cường", "Sơn", "Tài", "Trung",
  "Kiên", "Lộc", "Vinh", "Tâm", "Nghĩa", "Khải", "Minh", "Hải", "Phong", "Duy", "Thịnh", "Lâm", "Đăng", "Việt", "Toàn", "Bình", "Hưng",
  "Tú", "Quang", "Nhân", "Thắng", "Hoàng", "Khánh", "Tín", "Hậu", "Luân", "Nguyên", "Bách", "Đông", "Phát", "Sang", "Thiện", "Vũ",
];
const FEMALE_GIVEN = [
  "Linh", "Mai", "Trang", "Hân", "Thảo", "Hà", "Ngân", "Thư", "Uyên", "Vy", "My", "Nhi", "Quỳnh", "Lan", "Hương", "Phương", "Chi", "Anh",
  "Yến", "Trâm", "Ngọc", "Thủy", "Diệp", "Giang", "Hạnh", "Hiền", "Loan", "Oanh", "Thu", "Tiên", "Vân", "Xuân", "Dung", "Nhung", "Thanh",
  "Trinh", "Châu", "Khuê", "Lụa", "Như", "Hồng", "Hoa", "Ly", "Nga", "Phượng", "Tâm", "Thơm", "Tuyền", "Vi", "Yên",
];

export const BLOCKED_NAME_PATTERNS = [
  /\bTest\b/i, /\bDemo\b/i, /\bUser\b/i, /\bPT\s*\d+/i, /\bClient\s*\d+/i, /\bOwner\s*\d+/i, /\bseed\b/i,
  /Nguyễn Văn [A-ZĐ]$/u, /\bTrần Thị [A-ZĐ]$/u, /\bfoo\b/i, /\bbar\b/i, /lorem/i,
];

export function isNaturalName(full) {
  return typeof full === "string" && full.trim().split(/\s+/).length >= 3 && !BLOCKED_NAME_PATTERNS.some((re) => re.test(full)) && /^[\p{L} ]+$/u.test(full);
}

/**
 * Hands out unique people. `reserve()` marks fixed names (the ones in the scenario matrix) so that generated people
 * never collide with them. Everything is derived from the book's seed, so the n-th generated person is always the same.
 */
export class NameBook {
  constructor(seed = "names") {
    this.rng = rngFrom(`${seed}:names`);
    this.h = makeHelpers(this.rng);
    this.usedNames = new Set();
    this.usedSlugs = new Set();
  }

  slugFor(full) {
    const base = slugify(full);
    let slug = base;
    for (let i = 2; this.usedSlugs.has(slug); i++) slug = `${base}-${i}`;
    this.usedSlugs.add(slug);
    return slug;
  }

  reserve(full, gender) {
    if (this.usedNames.has(full)) throw new Error(`duplicate fixed name: ${full}`);
    this.usedNames.add(full);
    const parts = full.split(" ");
    // Same split as the registration forms (web RegisterPage / mobile register): firstName = the first word (họ),
    // lastName = the rest; screens render `${firstName} ${lastName}` -> "Trần Minh Khoa".
    return { full, firstName: parts[0], lastName: parts.slice(1).join(" "), surname: parts[0], gender, slug: this.slugFor(full) };
  }

  next(gender) {
    const g = gender ?? (this.rng() < 0.5 ? "MALE" : "FEMALE");
    for (let attempt = 0; attempt < 500; attempt++) {
      const surname = this.h.weighted(SURNAMES);
      const middle = this.h.pick(g === "MALE" ? MALE_MIDDLE : FEMALE_MIDDLE);
      const given = this.h.pick(g === "MALE" ? MALE_GIVEN : FEMALE_GIVEN);
      // a middle name equal to the given name ("Anh Anh") reads wrong
      if (middle === given) continue;
      const full = `${surname} ${middle} ${given}`;
      if (this.usedNames.has(full) || !isNaturalName(full)) continue;
      this.usedNames.add(full);
      return { full, firstName: surname, lastName: `${middle} ${given}`, surname, gender: g, slug: this.slugFor(full) };
    }
    throw new Error("name pool exhausted");
  }
}
