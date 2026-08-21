#!/usr/bin/env node
/**
 * Seed 100 test CUSTOMER users + 5 test PT users with comprehensive related data
 * across all 5 PostgreSQL databases (gymcoach_auth, gymcoach_user, gymcoach_fitness,
 * gymcoach_ai, gymcoach_chat).
 *
 * Safe to run multiple times — idempotent via ON CONFLICT DO NOTHING.
 * Does NOT touch admin accounts or delete any existing data.
 *
 * Run:  node scripts/seed-test-users.mjs
 *       npm run seed:test-users
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const dotenv = require('dotenv');

// ── Load .env ──────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../.env') });

// ── DB pool factory ────────────────────────────────────────────────────────────
const PG_BASE = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
  user: process.env.POSTGRES_USER || 'gymcoach',
  password: process.env.POSTGRES_PASSWORD || 'gymcoach_password',
  ssl: false,
};

const pools = {
  auth:    new Pool({ ...PG_BASE, database: 'gymcoach_auth' }),
  user:    new Pool({ ...PG_BASE, database: 'gymcoach_user' }),
  fitness: new Pool({ ...PG_BASE, database: 'gymcoach_fitness' }),
  ai:      new Pool({ ...PG_BASE, database: 'gymcoach_ai' }),
  chat:    new Pool({ ...PG_BASE, database: 'gymcoach_chat' }),
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const rFloat = (min, max, d = 1) => parseFloat((Math.random() * (max - min) + min).toFixed(d));
const rPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rSubset = (arr, min, max) => [...arr].sort(() => 0.5 - Math.random()).slice(0, rInt(min, max));
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const rDate = (minDays, maxDays) => daysAgo(rInt(minDays, maxDays));
const pad = (n) => String(n).padStart(3, '0');

// Batch insert helper — returns number of rows actually inserted
async function batchInsert(client, table, columns, rows, conflictClause = 'ON CONFLICT DO NOTHING') {
  if (!rows.length) return 0;
  const colList = columns.join(', ');
  const valueSets = [];
  const params = [];
  let idx = 1;
  for (const row of rows) {
    const placeholders = columns.map(() => `$${idx++}`);
    valueSets.push(`(${placeholders.join(', ')})`);
    for (const col of columns) params.push(row[col] ?? null);
  }
  const sql = `INSERT INTO ${table} (${colList}) VALUES ${valueSets.join(',\n')} ${conflictClause}`;
  const res = await client.query(sql, params);
  return res.rowCount ?? 0;
}

// ── Static data ────────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Minh', 'Tuấn', 'Huy', 'Nam', 'Đức', 'Anh', 'Phúc', 'Long', 'Quân', 'Khánh',
  'Linh', 'Hương', 'Mai', 'Lan', 'Hằng', 'Thảo', 'Ngọc', 'Trang', 'Thu', 'Yến',
  'Dũng', 'Thịnh', 'Bình', 'Cường', 'Hải', 'Khoa', 'Lâm', 'Nhân', 'Phát', 'Sơn',
  'Trung', 'Việt', 'Xuân', 'Yên', 'An', 'Bảo', 'Chiến', 'Duy', 'Đạt', 'Giang',
  'Hiếu', 'Hoài', 'Khải', 'Lộc', 'Mạnh', 'Nghĩa', 'Nhật', 'Quốc', 'Sáng', 'Tài',
];
const LAST_NAMES = [
  'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Vũ', 'Phan', 'Võ', 'Đặng',
  'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Trịnh', 'Tô', 'Cao',
];

const GOALS = ['WEIGHT_LOSS', 'MUSCLE_GAIN', 'MAINTENANCE', 'ATHLETIC_PERFORMANCE'];
const ACTIVITY_LEVELS = ['SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTREMELY_ACTIVE'];
const EXPERIENCE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
const GENDERS = ['MALE', 'FEMALE'];

const EQUIPMENT_OPTIONS = ['barbell', 'dumbbells', 'machines', 'kettlebell', 'resistance_bands', 'bodyweight', 'cable', 'pull-up bar'];
const INJURY_OPTIONS = ['lower back', 'left knee', 'right shoulder', 'ankle', 'neck', 'wrist'];

const FOOD_ITEMS = [
  { name: 'Cơm trắng', cal: 200, p: 4, c: 44, f: 0.4 },
  { name: 'Ức gà nướng', cal: 165, p: 31, c: 0, f: 3.6 },
  { name: 'Trứng luộc', cal: 78, p: 6, c: 0.6, f: 5 },
  { name: 'Rau xào dầu hào', cal: 80, p: 3, c: 8, f: 4 },
  { name: 'Cá hồi áp chảo', cal: 208, p: 22, c: 0, f: 13 },
  { name: 'Đậu hũ chiên', cal: 145, p: 12, c: 4, f: 9 },
  { name: 'Khoai lang hấp', cal: 86, p: 1.6, c: 20, f: 0.1 },
  { name: 'Yến mạch sữa', cal: 150, p: 5, c: 27, f: 2.5 },
  { name: 'Sữa chua Hy Lạp', cal: 120, p: 10, c: 9, f: 3.6 },
  { name: 'Chuối tươi', cal: 89, p: 1.1, c: 23, f: 0.3 },
  { name: 'Salad rau củ quả', cal: 60, p: 2, c: 10, f: 1 },
  { name: 'Thịt bò xào ớt chuông', cal: 215, p: 26, c: 3, f: 11 },
  { name: 'Mì soba luộc', cal: 113, p: 6, c: 24, f: 0.1 },
  { name: 'Avocado toast', cal: 250, p: 8, c: 28, f: 13 },
  { name: 'Whey protein shake', cal: 130, p: 25, c: 5, f: 2 },
  { name: 'Hạt điều rang', cal: 160, p: 5, c: 9, f: 13 },
  { name: 'Táo xanh', cal: 52, p: 0.3, c: 14, f: 0.2 },
  { name: 'Bánh mì ngũ cốc', cal: 70, p: 3, c: 13, f: 1 },
  { name: 'Súp bí đỏ', cal: 90, p: 2, c: 18, f: 1 },
  { name: 'Phở gà ít béo', cal: 350, p: 25, c: 48, f: 6 },
  { name: 'Bún bò Huế', cal: 420, p: 28, c: 52, f: 10 },
  { name: 'Cháo gà', cal: 180, p: 15, c: 22, f: 4 },
  { name: 'Smoothie xanh', cal: 145, p: 4, c: 28, f: 2 },
  { name: 'Snack thanh protein', cal: 200, p: 20, c: 22, f: 5 },
];

const WORKOUT_NAMES = [
  'Ngày tập ngực & Triceps', 'Ngày tập lưng & Biceps', 'Ngày tập chân & Mông',
  'Ngày tập vai & Cánh tay', 'Full Body Strength', 'HIIT Cardio',
  'Push Day', 'Pull Day', 'Legs & Core', 'Upper Body Power',
  'Lower Body Hypertrophy', 'Core & Abs Session', 'Mobility & Flexibility',
  'Strength Circuit Training', 'Explosive Power', 'Endurance Cardio',
  'Chest & Shoulder Press', 'Compound Movements', 'Active Recovery',
];

const PROGRAM_TEMPLATES = [
  {
    name: 'PPL - Push Pull Legs',
    desc: 'Chương trình 6 ngày/tuần theo split Push-Pull-Legs',
    days: [
      { title: 'Push (Ngực + Vai + Triceps)', desc: 'Ngày đẩy - tập cơ trước' },
      { title: 'Pull (Lưng + Biceps)', desc: 'Ngày kéo - tập cơ sau' },
      { title: 'Legs (Đùi + Mông + Bắp chân)', desc: 'Ngày chân toàn diện' },
      { title: 'Push (biến thể)', desc: 'Lặp lại ngày đẩy với cường độ khác' },
      { title: 'Pull (biến thể)', desc: 'Lặp lại ngày kéo với volume cao hơn' },
      { title: 'Legs (biến thể)', desc: 'Chân tập trung sức mạnh' },
    ],
  },
  {
    name: 'Upper Lower Split',
    desc: 'Chương trình 4 ngày phân chia trên/dưới',
    days: [
      { title: 'Upper Body A', desc: 'Ngực + Lưng sức mạnh' },
      { title: 'Lower Body A', desc: 'Squat + Romanian Deadlift' },
      { title: 'Upper Body B', desc: 'Vai + Cánh tay hypertrophy' },
      { title: 'Lower Body B', desc: 'Leg Press + Lunge volume' },
    ],
  },
  {
    name: 'Beginner Full Body',
    desc: 'Chương trình 3 ngày toàn thân cho người mới bắt đầu',
    days: [
      { title: 'Full Body A', desc: 'Các bài cơ bản: Squat, Bench, Row' },
      { title: 'Full Body B', desc: 'Deadlift, OHP, Pull-up' },
      { title: 'Full Body C', desc: 'Ngày nhẹ + Cardio + Core' },
    ],
  },
];

const AI_QA_PAIRS = [
  ['Chế độ ăn cho người muốn giảm mỡ bụng là gì?', 'Để giảm mỡ bụng hiệu quả, bạn cần tạo thâm hụt calo khoảng 300-500 kcal/ngày. Tập trung vào protein cao (1.8-2.2g/kg), giảm carb tinh chế, và tăng rau xanh. Tập HIIT 3-4 lần/tuần kết hợp strength training sẽ tối ưu kết quả.'],
  ['Bài tập nào tốt nhất cho người mới bắt đầu?', 'Với người mới, các bài tập compound cơ bản là tốt nhất: Squat, Deadlift, Bench Press, Overhead Press, Bent-over Row. Bắt đầu với 3 sets x 8-12 reps, tăng dần trọng lượng mỗi tuần 2.5-5kg.'],
  ['Tôi nên ăn gì trước và sau khi tập?', 'Trước tập 1-2 giờ: cơm + ức gà + rau (carb phức + protein). Sau tập 30-45 phút: whey protein + chuối hoặc cơm + thịt. Uống đủ nước trong và sau tập.'],
  ['Cách tính lượng protein cần thiết mỗi ngày?', 'Công thức chuẩn cho người tập gym: 1.6-2.2g protein/kg cân nặng. Ví dụ: 70kg → cần 112-154g protein/ngày. Ưu tiên nguồn từ thực phẩm tự nhiên: thịt, trứng, cá, đậu.'],
  ['Tôi tập gym 5 ngày/tuần có quá nhiều không?', '5 ngày/tuần hợp lý nếu bạn phân chia nhóm cơ đúng cách và ngủ đủ 7-9 giờ. Quan trọng nhất là đảm bảo mỗi nhóm cơ có 48-72 giờ nghỉ giữa 2 buổi tập.'],
  ['Whey protein có cần thiết không?', 'Whey protein là thực phẩm bổ sung tiện lợi nhưng không bắt buộc. Nếu bạn ăn đủ protein từ thực phẩm tự nhiên (đạt 1.6-2g/kg/ngày), whey chỉ là lựa chọn thêm.'],
  ['Cơ bắp đau sau tập là tốt hay xấu?', 'DOMS (Delayed Onset Muscle Soreness) sau 24-48h là bình thường, cho thấy cơ đang thích nghi. Nếu đau kéo dài >72h hoặc đau nhói thì cần nghỉ ngơi và kiểm tra chấn thương.'],
  ['Làm sao tăng sức bền khi chạy bộ?', 'Áp dụng nguyên tắc 10%: mỗi tuần tăng không quá 10% quãng đường. Kết hợp easy run (80%) với interval (20%). Ít nhất 3 lần/tuần để có tiến bộ rõ rệt.'],
  ['Cần ngủ bao nhiêu tiếng để phục hồi cơ bắp?', '7-9 tiếng mỗi đêm là lý tưởng. Trong giai đoạn ngủ sâu (deep sleep), cơ thể tiết GH (Growth Hormone) giúp tổng hợp protein và phục hồi cơ bắp hiệu quả nhất.'],
  ['Tôi muốn tăng 5kg cơ trong 3 tháng có được không?', 'Tăng 5kg cơ thuần túy trong 3 tháng không thực tế với người tập tự nhiên. Tốc độ bình thường: 0.5-1kg cơ/tháng cho người mới, 0.25-0.5kg/tháng khi đã có nền. Mục tiêu thực tế hơn: 1-2kg cơ trong 3 tháng.'],
  ['Bài tập nào giúp tăng chiều cao?', 'Chiều cao phụ thuộc chủ yếu vào gen và thời điểm phát triển. Sau tuổi dậy thì, không có bài tập nào tăng chiều cao. Tuy nhiên, cải thiện tư thế qua yoga và tập lưng có thể giúp bạn cao hơn 1-2cm.'],
  ['Làm thế nào để giảm cân mà không mất cơ?', 'Giảm cân không mất cơ cần: protein cao (2g/kg), strength training 3-4x/tuần, thâm hụt calo vừa phải (300-500 kcal), ngủ đủ giấc. Tránh cardio quá nhiều và thâm hụt calo quá lớn.'],
];

const CONTRACT_PACKAGES = [
  { name: 'Gói 10 buổi cơ bản', qty: 10, price: 1500000, pps: 150000 },
  { name: 'Gói 20 buổi tiêu chuẩn', qty: 20, price: 2800000, pps: 140000 },
  { name: 'Gói 30 buổi nâng cao', qty: 30, price: 3900000, pps: 130000 },
  { name: 'Gói tháng 12 buổi', qty: 12, price: 1800000, pps: 150000 },
  { name: 'Gói VIP 50 buổi', qty: 50, price: 6000000, pps: 120000 },
];

const CONTRACT_STATUSES_WEIGHTED = [
  ...Array(30).fill('ACTIVE'),
  ...Array(12).fill('COMPLETED'),
  ...Array(4).fill('PENDING_REVIEW'),
  ...Array(3).fill('CANCELLED'),
  ...Array(1).fill('REJECTED'),
];

const SESSION_MODES = ['ONLINE', 'OFFLINE', 'HYBRID'];
const LOCATIONS = ['Gym ABC - Q1', 'Gym XYZ - Q3', 'Online qua Zoom', 'Gym FitStar - Bình Thạnh', 'Tại nhà khách hàng'];

const REVIEW_COMMENTS = [
  'HLV rất tận tâm, bài tập phù hợp với trình độ của mình.',
  'Buổi tập hiệu quả, HLV giải thích kỹ từng động tác.',
  'Rất hài lòng, cảm giác mình tiến bộ rõ rệt sau mỗi buổi.',
  'HLV đúng giờ, chuyên nghiệp và nhiệt tình.',
  'Bài tập hơi nặng nhưng mình vẫn theo được nhờ HLV hướng dẫn.',
  'Tuyệt vời! HLV biết cách tạo động lực tốt lắm.',
  'Buổi tập rất vui và hiệu quả.',
  'HLV điều chỉnh bài tập phù hợp với chấn thương của mình.',
  'Mình thích cách HLV theo dõi tiến độ và điều chỉnh kế hoạch.',
  'Sẽ tiếp tục đăng ký thêm gói sau khi hết gói này.',
];

const CHAT_MESSAGES_CLIENT = [
  'Chào HLV, tôi muốn hỏi về lịch tập tuần này ạ.',
  'HLV ơi, hôm nay tôi cảm thấy mỏi lưng, mình có thể điều chỉnh bài tập không?',
  'Tôi đã tập xong buổi hôm qua, cảm thấy khỏe hơn nhiều!',
  'HLV có thể gợi ý thêm bài tập về nhà cho tôi không?',
  'Cảm ơn HLV đã hướng dẫn nhiệt tình!',
  'Tôi muốn đặt lịch buổi tiếp theo vào thứ 5 được không ạ?',
  'HLV ơi hôm nay tôi không kịp ăn trước tập có sao không?',
];

const CHAT_MESSAGES_PT = [
  'Chào bạn! Tuần này chúng ta sẽ tăng volume thêm 10% nhé.',
  'Bạn tập tốt lắm hôm qua, tiếp tục cố gắng nhé!',
  'Nhớ ăn đủ protein sau buổi tập, ít nhất 30g trong 45 phút đầu.',
  'Lịch tuần tới: Thứ 2, 4, 6 lúc 7h sáng. Bạn xác nhận được không?',
  'Tôi thấy form Squat của bạn đã cải thiện rõ, tốt lắm!',
  'Hôm nay nghỉ nhé, cơ thể cần hồi phục sau 3 buổi liên tiếp.',
  'Nhớ uống đủ 2-3 lít nước mỗi ngày, đặc biệt ngày tập.',
];

const NOTIFICATION_EVENTS = [
  { type: 'SESSION_CONFIRMED', entity: 'SESSION', text: 'Huấn luyện viên đã xác nhận lịch tập của bạn' },
  { type: 'SESSION_COMPLETED', entity: 'SESSION', text: 'Buổi tập đã hoàn thành. Hãy để lại đánh giá!' },
  { type: 'CONTRACT_ACCEPTED', entity: 'CONTRACT', text: 'Huấn luyện viên đã chấp nhận hợp đồng của bạn' },
  { type: 'CONTRACT_CANCELLED', entity: 'CONTRACT', text: 'Hợp đồng đã bị hủy' },
  { type: 'SESSION_CANCELLED', entity: 'SESSION', text: 'Buổi tập đã bị hủy' },
  { type: 'SESSION_BOOKED', entity: 'SESSION', text: 'Bạn đã đặt lịch tập thành công' },
];

// ── SEED AUTH ──────────────────────────────────────────────────────────────────
async function seedAuth(client, passwordHash) {
  console.log('  Creating test PT users (5)...');
  const ptUsers = [];
  for (let i = 1; i <= 5; i++) {
    const id = uid();
    const email = `testpt${pad(i)}@example.com`;
    const fn = rPick(FIRST_NAMES);
    const ln = rPick(LAST_NAMES);
    await client.query(
      `INSERT INTO users (id, email, password, "firstName", "lastName", role, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,'PT',$6,$6)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email`,
      [id, email, passwordHash, fn, ln, rDate(150, 180)]
    );
    // Re-fetch in case conflict resolved to existing id
    const row = await client.query('SELECT id, email FROM users WHERE email=$1', [email]);
    ptUsers.push({ id: row.rows[0].id, email, firstName: fn, lastName: ln });
  }

  console.log('  Creating 100 test CUSTOMER users...');
  const customers = [];
  for (let i = 1; i <= 100; i++) {
    const id = uid();
    const email = `testuser${pad(i)}@example.com`;
    const fn = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
    const ln = LAST_NAMES[(i - 1) % LAST_NAMES.length];
    const createdAt = rDate(7, 170);
    await client.query(
      `INSERT INTO users (id, email, password, "firstName", "lastName", role, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,'CUSTOMER',$6,$6)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [id, email, passwordHash, fn, ln, createdAt]
    );
    const row = await client.query('SELECT id FROM users WHERE email=$1', [email]);
    customers.push({ id: row.rows[0].id, email, firstName: fn, lastName: ln, createdAt });
  }

  // Audit logs — REGISTER + 1-3 LOGINs per user
  console.log('  Creating audit logs...');
  const allUsers = [...ptUsers, ...customers];
  const auditRows = [];
  for (const u of allUsers) {
    auditRows.push({
      id: uid(), userId: u.id, action: 'REGISTER',
      ipAddress: `10.${rInt(0,255)}.${rInt(0,255)}.${rInt(1,254)}`,
      userAgent: 'Mozilla/5.0 (Seed Script)',
      createdAt: rDate(5, 170),
    });
    for (let k = 0; k < rInt(1, 4); k++) {
      auditRows.push({
        id: uid(), userId: u.id, action: 'LOGIN',
        ipAddress: `10.${rInt(0,255)}.${rInt(0,255)}.${rInt(1,254)}`,
        userAgent: 'Mozilla/5.0 Chrome/124',
        createdAt: rDate(1, 60),
      });
    }
  }
  const cols = ['id', 'userId', 'action', 'ipAddress', 'userAgent', 'createdAt'];
  // batchInsert doesn't handle camelCase column names well with pg — use manual approach
  for (const row of auditRows) {
    await client.query(
      `INSERT INTO audit_logs (id, "userId", action, "ipAddress", "userAgent", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [row.id, row.userId, row.action, row.ipAddress, row.userAgent, row.createdAt]
    );
  }

  console.log(`  ✓ ${ptUsers.length} PT + ${customers.length} CUSTOMER users, ${auditRows.length} audit logs`);
  return { ptUsers, customers };
}

// ── SEED USER SERVICE ──────────────────────────────────────────────────────────
async function seedUserService(client, ptUsers, customers) {
  const allUsers = [...ptUsers, ...customers];
  console.log('  Creating user_profiles...');
  const profiles = {}; // userId -> profileId

  for (const u of allUsers) {
    const isPT = ptUsers.some(p => p.id === u.id);
    const gender = rPick(GENDERS);
    const isMale = gender === 'MALE';
    const weight = isMale ? rFloat(60, 100, 1) : rFloat(45, 80, 1);
    const height = isMale ? rFloat(162, 185, 1) : rFloat(150, 170, 1);
    const age = rInt(18, 45);
    const bmi = parseFloat((weight / ((height / 100) ** 2)).toFixed(1));
    const goal = GOALS[Math.floor((allUsers.indexOf(u)) / 26) % 4] || rPick(GOALS);
    const profId = uid();

    await client.query(
      `INSERT INTO user_profiles
         (id, "userId", "firstName", "lastName", email, "isPT", age, gender,
          "heightCm", goal, "activityLevel", "experienceLevel",
          "preferredTrainingDays", "availableEquipment", injuries,
          "currentWeight", "targetWeight", "session_duration_minutes",
          "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::\"Gender\",$9,$10::\"Goal\",
               $11::\"ActivityLevel\",$12::\"ExperienceLevel\",
               $13,$14,$15,$16,$17,$18,$19,$19)
       ON CONFLICT ("userId") DO NOTHING`,
      [
        profId, u.id, u.firstName, u.lastName, u.email, isPT, age, gender,
        height, goal,
        rPick(ACTIVITY_LEVELS), rPick(EXPERIENCE_LEVELS),
        rSubset([1,2,3,4,5,6,7], 2, 5),
        rSubset(EQUIPMENT_OPTIONS, 1, 4),
        Math.random() < 0.3 ? rSubset(INJURY_OPTIONS, 1, 2) : [],
        weight,
        goal === 'WEIGHT_LOSS' ? weight - rFloat(5, 15, 1) : weight + rFloat(2, 10, 1),
        rPick([45, 60, 75, 90]),
        u.createdAt || rDate(7, 160),
      ]
    );
    const row = await client.query('SELECT id FROM user_profiles WHERE "userId"=$1', [u.id]);
    if (row.rows.length) profiles[u.id] = { profileId: row.rows[0].id, weight, height, bmi, gender, age };
  }

  // InBody entries — 2-5 per user
  console.log('  Creating inbody_entries...');
  let inbodyCount = 0;
  for (const u of allUsers) {
    const p = profiles[u.id];
    if (!p) continue;
    const numEntries = rInt(2, 5);
    for (let k = 0; k < numEntries; k++) {
      const w = p.weight + rFloat(-3, 2, 1);
      const bodyFatPct = rFloat(10, 30, 1);
      const bodyFat = parseFloat((w * bodyFatPct / 100).toFixed(2));
      const muscle = parseFloat((w - bodyFat - w * 0.15).toFixed(2));
      const measuredAt = rDate(k * 20, k * 20 + 30);
      const measuredDateOnly = new Date(Date.UTC(
        measuredAt.getUTCFullYear(),
        measuredAt.getUTCMonth(),
        measuredAt.getUTCDate(),
      ));
      await client.query(
        `INSERT INTO inbody_entries
           (id, "user_id", date, date_only, weight, height, bmi,
            "body_fat", "body_fat_pct", "muscle_mass",
            "right_arm_muscle","left_arm_muscle","trunk_muscle","right_leg_muscle","left_leg_muscle",
            "right_arm_fat","left_arm_fat","trunk_fat","right_leg_fat","left_leg_fat",
            status, notes, "created_at", "updated_at")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23)
         ON CONFLICT DO NOTHING`,
        [
          uid(), u.id, measuredAt, measuredDateOnly,
          w, p.height, p.bmi,
          bodyFat, bodyFatPct, muscle,
          rFloat(2, 4, 2), rFloat(2, 4, 2), rFloat(15, 25, 2),
          rFloat(7, 12, 2), rFloat(7, 12, 2),
          rFloat(0.2, 0.8, 2), rFloat(0.2, 0.8, 2), rFloat(3, 8, 2),
          rFloat(1.5, 3.5, 2), rFloat(1.5, 3.5, 2),
          rPick(['manual', 'extracted', 'manual']),
          Math.random() < 0.4 ? 'Đo tại phòng gym, sau bữa sáng 2 giờ' : null,
          rDate(k * 20, k * 20 + 30),
        ]
      );
      inbodyCount++;
    }
  }

  // Notifications — 3-6 per user
  console.log('  Creating notifications...');
  let notifCount = 0;
  for (const u of customers) {
    const numNotifs = rInt(3, 6);
    for (let k = 0; k < numNotifs; k++) {
      const ev = rPick(NOTIFICATION_EVENTS);
      await client.query(
        `INSERT INTO notifications
           (id, "user_id", text, "event_type", "entity_type", "entity_id",
            link, unread, "created_at", "updated_at")
         VALUES ($1,$2,$3,$4::\"NotificationEventType\",$5::\"NotificationEntityType\",$6,$7,$8,$9,$9)
         ON CONFLICT DO NOTHING`,
        [
          uid(), u.id, ev.text,
          ev.type, ev.entity, uid(),
          ev.entity === 'CONTRACT' ? '/pt/contracts' : '/schedule',
          Math.random() < 0.6,
          rDate(1, 60),
        ]
      );
      notifCount++;
    }
  }

  console.log(`  ✓ ${Object.keys(profiles).length} profiles, ${inbodyCount} inbody entries, ${notifCount} notifications`);
  return profiles;
}

// ── SEED CONTRACTS & SESSIONS ──────────────────────────────────────────────────
async function seedContracts(client, ptUsers, customers) {
  console.log('  Creating contracts + sessions + reviews...');
  // 60 of 100 customers get a contract
  const contractClients = customers.slice(0, 60);
  let contractCount = 0, sessionCount = 0, reviewCount = 0;
  const contractIdsForChat = []; // { ptId, clientId, contractId }

  for (const customer of contractClients) {
    const pt = ptUsers[Math.floor(contractClients.indexOf(customer) / 12) % ptUsers.length];
    const pkg = rPick(CONTRACT_PACKAGES);
    const status = rPick(CONTRACT_STATUSES_WEIGHTED);
    const contractId = uid();
    const startDate = rDate(30, 150);
    const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 90);
    const usedSessions = status === 'COMPLETED' ? pkg.qty :
                         status === 'ACTIVE' ? rInt(1, pkg.qty - 1) :
                         status === 'CANCELLED' ? rInt(0, pkg.qty - 1) : 0;

    await client.query(
      `INSERT INTO contracts
         (id, "pt_user_id", "client_user_id", status, "package_type", "package_name",
          "package_quantity", "extra_sessions", "total_sessions", "used_sessions",
          price, "price_per_session", "start_date", "end_date", "completed_at",
          "client_message", terms, "created_at", "updated_at")
       VALUES ($1,$2,$3,$4::\"ContractStatus\",'PACKAGE',$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
       ON CONFLICT DO NOTHING`,
      [
        contractId, pt.id, customer.id, status, pkg.name,
        pkg.qty, pkg.qty, usedSessions,
        pkg.price, pkg.pps, startDate, endDate,
        status === 'COMPLETED' ? new Date(endDate.getTime() - 86400000) : null,
        'Tôi muốn đăng ký gói tập để cải thiện sức khỏe và thể hình.',
        'Hủy trước 24h không mất phí. Chỉnh lịch linh hoạt theo thỏa thuận.',
        startDate,
      ]
    );
    contractCount++;
    contractIdsForChat.push({ ptId: pt.id, clientId: customer.id, contractId });

    // Sessions for ACTIVE/COMPLETED contracts
    if (status === 'ACTIVE' || status === 'COMPLETED') {
      const numSessions = status === 'COMPLETED' ? pkg.qty : usedSessions;
      for (let s = 0; s < Math.min(numSessions, 8); s++) {
        const sessionId = uid();
        const sessDate = new Date(startDate); sessDate.setDate(sessDate.getDate() + s * 7 + rInt(0, 3));
        const sessEnd = new Date(sessDate); sessEnd.setMinutes(sessEnd.getMinutes() + 60);
        const isPast = sessDate < new Date();
        const sessStatus = isPast ? rPick(['COMPLETED', 'COMPLETED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) : 'CONFIRMED';
        const mode = rPick(SESSION_MODES);

        await client.query(
          `INSERT INTO sessions
             (id, "contract_id", "client_user_id", "pt_user_id",
              status, "session_mode", "scheduled_start_at", "scheduled_end_at",
              location, notes, "session_deducted", "completed_at", "created_at", "updated_at")
           VALUES ($1,$2,$3,$4,$5::\"SessionStatus\",$6::\"SessionMode\",$7,$8,$9,$10,$11,$12,$13,$13)
           ON CONFLICT DO NOTHING`,
          [
            sessionId, contractId, customer.id, pt.id,
            sessStatus, mode, sessDate, sessEnd,
            mode !== 'ONLINE' ? rPick(LOCATIONS) : null,
            Math.random() < 0.3 ? 'Tập trung vào kỹ thuật cơ bản' : null,
            sessStatus === 'COMPLETED',
            sessStatus === 'COMPLETED' ? sessEnd : null,
            sessDate,
          ]
        );
        sessionCount++;

        // Review for completed sessions
        if (sessStatus === 'COMPLETED' && Math.random() < 0.7) {
          await client.query(
            `INSERT INTO session_reviews
               (id, "session_id", "contract_id", "client_user_id", rating, comment, "created_at")
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT DO NOTHING`,
            [
              uid(), sessionId, contractId, customer.id,
              rInt(4, 5), rPick(REVIEW_COMMENTS),
              new Date(sessEnd.getTime() + rInt(3600000, 86400000)),
            ]
          );
          reviewCount++;
        }
      }
    }
  }

  console.log(`  ✓ ${contractCount} contracts, ${sessionCount} sessions, ${reviewCount} reviews`);
  return contractIdsForChat;
}

// ── SEED FITNESS ───────────────────────────────────────────────────────────────
async function seedFitness(client, customers) {
  // Detect which tables actually exist (some may not be migrated yet)
  const tablesRes = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`
  );
  const existingTables = new Set(tablesRes.rows.map(r => r.tablename));
  const hasTable = (t) => existingTables.has(t);

  // Fetch existing exercise IDs
  const exRes = await client.query('SELECT id FROM exercises ORDER BY RANDOM() LIMIT 48');
  const exerciseIds = exRes.rows.map(r => r.id);
  if (exerciseIds.length === 0) {
    console.log('  ⚠ No exercises found in gymcoach_fitness — skipping workout data');
    return;
  }
  console.log(`  Using ${exerciseIds.length} existing exercises`);
  console.log(`  Tables available: ${[...existingTables].filter(t => t !== '_prisma_migrations').join(', ')}`);

  let workoutCount = 0, wExCount = 0, wSetCount = 0;
  let nutritionCount = 0, bodyMetricCount = 0, programCount = 0;

  for (const user of customers) {
    const userId = user.id;

    // ── Workouts (5-10 per user) ─────────────────────────────────────────────
    if (hasTable('workouts')) {
      const numWorkouts = rInt(5, 10);
      for (let w = 0; w < numWorkouts; w++) {
        const workoutId = uid();
        const wDate = rDate(1, 150);
        const duration = rPick([45, 60, 75, 90, 120]);

        await client.query(
          `INSERT INTO workouts (id, "user_id", name, description, date, duration, notes, "created_at", "updated_at")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
          [workoutId, userId, rPick(WORKOUT_NAMES), null, wDate, duration,
           Math.random() < 0.3 ? 'Buổi tập tốt, cảm thấy khỏe' : null, wDate]
        );
        workoutCount++;

        // 3-5 exercises per workout
        if (hasTable('workout_exercises')) {
          const numExercises = rInt(3, 5);
          const selectedExIds = rSubset(exerciseIds, numExercises, numExercises);
          for (let e = 0; e < selectedExIds.length; e++) {
            const weId = uid();
            const numSets = rInt(3, 5);
            const reps = rInt(6, 15);
            const weight = rFloat(20, 100, 2);

            await client.query(
              `INSERT INTO workout_exercises (id, "workout_id", "exercise_id", sets, reps, weight, "order", "created_at")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
              [weId, workoutId, selectedExIds[e], numSets, reps, weight, e, wDate]
            );
            wExCount++;

            // Workout sets
            if (hasTable('workout_sets')) {
              for (let s = 1; s <= numSets; s++) {
                await client.query(
                  `INSERT INTO workout_sets (id, "workout_exercise_id", "set_number", reps, weight, rpe, completed, "created_at")
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
                  [uid(), weId, s, reps + rInt(-2, 2), weight + rFloat(-5, 5, 1), rFloat(6, 9, 1), true, wDate]
                );
                wSetCount++;
              }
            }
          }
        }
      }
    }

    // ── Nutrition logs (15-25 entries across last 60 days) ───────────────────
    if (hasTable('nutrition_logs')) {
      const numNutrDays = rInt(15, 25);
      for (let d = 0; d < numNutrDays; d++) {
        const logDate = rDate(1, 60);
        const mealTypes = [...new Set(Array.from({length: rInt(3,5)}, () => rPick(['breakfast','lunch','dinner','snack'])))];
        for (const meal of mealTypes) {
          const food = rPick(FOOD_ITEMS);
          await client.query(
            `INSERT INTO nutrition_logs (id, "user_id", date, "meal_type", "food_name", calories, protein, carbs, fats, "created_at", "updated_at")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT DO NOTHING`,
            [uid(), userId, logDate, meal, food.name, food.cal, food.p, food.c, food.f, logDate]
          );
          nutritionCount++;
        }
      }
    }

    // ── Body metrics (only if table exists) ───────────────────────────────────
    if (hasTable('body_metrics')) {
      const numMetrics = rInt(3, 8);
      for (let m = 0; m < numMetrics; m++) {
        const mDate = rDate(m * 15, m * 15 + 20);
        await client.query(
          `INSERT INTO body_metrics (id, "user_id", date, weight, "body_fat", "muscle_mass", "body_water", "created_at", "updated_at")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
          [uid(), userId, mDate, rFloat(55, 100, 1), rFloat(10, 30, 1), rFloat(25, 60, 1), rFloat(50, 65, 1), mDate]
        );
        bodyMetricCount++;
      }
    }

    // ── Workout programs (only if table exists) ────────────────────────────────
    if (hasTable('workout_programs') && hasTable('workout_program_days') && hasTable('workout_program_exercises')) {
      const template = PROGRAM_TEMPLATES[Math.floor(customers.indexOf(user) / 34) % PROGRAM_TEMPLATES.length];
      const programId = uid();
      const progDate = rDate(20, 120);

      await client.query(
        `INSERT INTO workout_programs (id, "user_id", name, description, "created_at", "updated_at")
         VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING`,
        [programId, userId, template.name, template.desc, progDate]
      );
      programCount++;

      const dayIds = [];
      for (let d = 0; d < template.days.length; d++) {
        const dayId = uid();
        await client.query(
          `INSERT INTO workout_program_days (id, "program_id", "day_number", title, description, duration, "created_at", "updated_at")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT DO NOTHING`,
          [dayId, programId, d + 1, template.days[d].title, template.days[d].desc, rPick([45, 60, 75]), progDate]
        );
        dayIds.push(dayId);

        const dayExIds = rSubset(exerciseIds, 3, 4);
        for (let e = 0; e < dayExIds.length; e++) {
          await client.query(
            `INSERT INTO workout_program_exercises (id, "program_day_id", "exercise_id", "order", sets, reps, weight, "rest_seconds", "created_at")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [uid(), dayId, dayExIds[e], e, rInt(3, 5), rInt(8, 12), rFloat(20, 80, 1), rPick([60, 90, 120]), progDate]
          );
        }
      }

      // Workout schedules
      if (hasTable('workout_schedules') && dayIds.length > 0) {
        const usedDates = new Set();
        for (let s = 0; s < rInt(5, 10); s++) {
          let schedDate;
          let attempts = 0;
          do { schedDate = rDate(1, 90); attempts++; }
          while (usedDates.has(schedDate.toDateString()) && attempts < 10);
          if (usedDates.has(schedDate.toDateString())) continue;
          usedDates.add(schedDate.toDateString());
          await client.query(
            `INSERT INTO workout_schedules (id, "user_id", date, "program_day_id", "created_at", "updated_at")
             VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT ("user_id", date) DO NOTHING`,
            [uid(), userId, schedDate, dayIds[s % dayIds.length], schedDate]
          );
        }
      }
    }
  }

  const summary = [`${workoutCount} workouts`, `${wExCount} workout_exercises`, `${wSetCount} workout_sets`,
    `${nutritionCount} nutrition_logs`];
  if (bodyMetricCount) summary.push(`${bodyMetricCount} body_metrics`);
  if (programCount) summary.push(`${programCount} programs`);
  console.log(`  ✓ ${summary.join(', ')}`);
}

// ── SEED AI ────────────────────────────────────────────────────────────────────
async function seedAI(client, customers) {
  console.log('  Creating AI conversations + workout_plans...');
  let convCount = 0, planCount = 0;

  for (const user of customers) {
    // AI conversations (3-8 per user)
    const numConvs = rInt(3, 8);
    for (let c = 0; c < numConvs; c++) {
      const qa = AI_QA_PAIRS[c % AI_QA_PAIRS.length];
      const tokensP = rInt(80, 200);
      const tokensC = rInt(120, 400);
      const intents = ['fitness_advice', 'nutrition', 'workout_plan', 'general_health', 'exercise_form'];

      await client.query(
        `INSERT INTO conversations
           (id, "user_id", question, answer, "model_used", "response_time",
            relevance, "prompt_tokens", "completion_tokens", "total_tokens",
            cost, feedback, "used_fallback", "response_language", "route_intent",
            "warning_count", "created_at")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT DO NOTHING`,
        [
          uid(), user.id, qa[0], qa[1],
          'llama3.2:3b', rFloat(800, 3500, 0),
          rPick(['relevant', 'relevant', 'relevant', 'partially_relevant']),
          tokensP, tokensC, tokensP + tokensC,
          0.0,
          Math.random() < 0.6 ? rInt(1, 5) : null,
          Math.random() < 0.1,
          'vi', rPick(intents), 0,
          rDate(1, 90),
        ]
      );
      convCount++;
    }

    // AI workout plans (1-2 per user)
    const numPlans = rInt(1, 2);
    for (let p = 0; p < numPlans; p++) {
      const planStatuses = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'FAILED', 'QUEUED'];
      const status = rPick(planStatuses);
      const goal = rPick(['Giảm cân', 'Tăng cơ', 'Duy trì sức khỏe', 'Cải thiện sức bền']);
      const dur = rPick([4, 8, 12]);
      const dpw = rPick([3, 4, 5, 6]);

      const completedPlan = status === 'COMPLETED' ? {
        weeks: Array.from({length: Math.min(dur, 4)}, (_, w) => ({
          weekNumber: w + 1,
          days: Array.from({length: dpw}, (_, d) => ({
            day: d + 1,
            focus: rPick(['Ngực & Triceps', 'Lưng & Biceps', 'Chân & Mông', 'Vai & Cánh tay', 'Full Body', 'Cardio']),
            exercises: Array.from({length: rInt(3, 5)}, () => ({
              name: rPick(['Push-Up', 'Squat', 'Deadlift', 'Bench Press', 'Pull-Up', 'Plank', 'Lunge', 'Row']),
              sets: rInt(3, 5), reps: rInt(8, 15), restSeconds: rPick([60, 90, 120]),
            })),
          })),
        })),
      } : {};

      await client.query(
        `INSERT INTO workout_plans
           (id, "user_id", name, description, goal, duration, "days_per_week",
            plan, status, version, "created_at", "updated_at")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::\"PlanStatus\",1,$10,$10)
         ON CONFLICT DO NOTHING`,
        [
          uid(), user.id,
          `Kế hoạch ${goal} ${dur} tuần`,
          `Chương trình ${dpw} ngày/tuần tập trung ${goal.toLowerCase()}`,
          goal, dur, dpw,
          JSON.stringify(completedPlan),
          status, rDate(5, 120),
        ]
      );
      planCount++;
    }
  }

  console.log(`  ✓ ${convCount} AI conversations, ${planCount} workout_plans`);
}

// ── SEED CHAT ──────────────────────────────────────────────────────────────────
async function seedChat(client, contractPairs) {
  console.log('  Creating chat conversations + messages...');
  let convCount = 0, msgCount = 0;

  // Create chat conversations for user-PT pairs from contracts
  const pairs = contractPairs.slice(0, 50); // limit to 50 chat threads
  for (const pair of pairs) {
    const convId = uid();
    const convDate = rDate(10, 90);

    // Check if conversation between these two already exists (by participants)
    const existing = await client.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants p1 ON p1."conversationId"=c.id AND p1."userId"=$1
       JOIN conversation_participants p2 ON p2."conversationId"=c.id AND p2."userId"=$2
       LIMIT 1`,
      [pair.ptId, pair.clientId]
    );
    if (existing.rows.length > 0) continue;

    await client.query(
      `INSERT INTO conversations (id, type, "lastMessageAt", "createdAt", "updatedAt")
       VALUES ($1,'DIRECT',$2,$2,$2) ON CONFLICT DO NOTHING`,
      [convId, convDate]
    );

    // Add participants
    for (const userId of [pair.ptId, pair.clientId]) {
      await client.query(
        `INSERT INTO conversation_participants (id, "conversationId", "userId", "joinedAt")
         VALUES ($1,$2,$3,$4) ON CONFLICT ("conversationId","userId") DO NOTHING`,
        [uid(), convId, userId, convDate]
      );
    }
    convCount++;

    // Messages (4-10 per conversation)
    const numMsgs = rInt(4, 10);
    let lastMsgAt = convDate;
    for (let m = 0; m < numMsgs; m++) {
      const isClientMsg = m % 2 === 0;
      const senderId = isClientMsg ? pair.clientId : pair.ptId;
      const content = isClientMsg ? rPick(CHAT_MESSAGES_CLIENT) : rPick(CHAT_MESSAGES_PT);
      const msgAt = new Date(lastMsgAt.getTime() + rInt(3600000, 86400000));
      lastMsgAt = msgAt;

      await client.query(
        `INSERT INTO messages (id, "conversationId", "senderId", content, "readAt", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), convId, senderId, content, m < numMsgs - 2 ? msgAt : null, msgAt]
      );
      msgCount++;
    }

    // Update lastMessageAt
    await client.query(
      `UPDATE conversations SET "lastMessageAt"=$1, "updatedAt"=$1 WHERE id=$2`,
      [lastMsgAt, convId]
    );
  }

  console.log(`  ✓ ${convCount} chat conversations, ${msgCount} messages`);
}

// ── PT Availability for test PT users ─────────────────────────────────────────
async function seedPTAvailability(client, ptUsers) {
  const days = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
  let count = 0;
  for (const pt of ptUsers) {
    const activeDays = rSubset(days, 4, 6);
    for (const day of activeDays) {
      await client.query(
        `INSERT INTO pt_availability (id, "pt_user_id", "day_of_week", "start_time", "end_time", "is_active", "created_at", "updated_at")
         VALUES ($1,$2,$3::\"DayOfWeek\",$4,$5,true,$6,$6) ON CONFLICT DO NOTHING`,
        [uid(), pt.id, day, rPick(['07:00','08:00','09:00']), rPick(['17:00','18:00','19:00']), rDate(30, 90)]
      );
      count++;
    }
  }
  console.log(`  ✓ ${count} PT availability slots for ${ptUsers.length} PT users`);
}

// ── VERIFY ─────────────────────────────────────────────────────────────────────
async function verify(pools) {
  console.log('\n📊 Verification:');
  const checks = [
    { db: 'auth',    query: `SELECT role, COUNT(*) FROM users WHERE email LIKE 'test%@example.com' GROUP BY role ORDER BY role` },
    { db: 'auth',    query: `SELECT COUNT(*) FROM audit_logs a JOIN users u ON a."userId"=u.id WHERE u.email LIKE 'test%@example.com'` },
    { db: 'user',    query: `SELECT COUNT(*) FROM user_profiles` },
    { db: 'user',    query: `SELECT COUNT(*) FROM inbody_entries` },
    { db: 'user',    query: `SELECT COUNT(*) FROM notifications` },
    { db: 'user',    query: `SELECT status, COUNT(*) FROM contracts GROUP BY status ORDER BY status` },
    { db: 'user',    query: `SELECT COUNT(*) FROM sessions` },
    { db: 'user',    query: `SELECT COUNT(*) FROM session_reviews` },
    { db: 'fitness', query: `SELECT COUNT(*) FROM workouts` },
    { db: 'fitness', query: `SELECT COUNT(*) FROM nutrition_logs` },
    { db: 'ai',      query: `SELECT COUNT(*) FROM conversations` },
    { db: 'ai',      query: `SELECT status, COUNT(*) FROM workout_plans GROUP BY status ORDER BY status` },
    { db: 'chat',    query: `SELECT COUNT(*) FROM conversations` },
    { db: 'chat',    query: `SELECT COUNT(*) FROM messages` },
  ];

  for (const c of checks) {
    const res = await pools[c.db].query(c.query);
    console.log(`  [${c.db}] ${c.query.slice(7, 60).trim()}...`);
    console.log('    ', res.rows.map(r => JSON.stringify(r)).join(' | '));
  }
}

// ── MAIN ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' GymCoach Test Data Seed — 100 users + related data');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test connections
  for (const [name, pool] of Object.entries(pools)) {
    try {
      await pool.query('SELECT 1');
      console.log(`✓ Connected to gymcoach_${name}`);
    } catch (e) {
      console.error(`✗ Cannot connect to gymcoach_${name}:`, e.message);
      process.exit(1);
    }
  }

  console.log('\n🔐 Hashing password Test@123456 (bcrypt, 10 rounds)...');
  const passwordHash = await bcrypt.hash('Test@123456', 10);
  console.log('  Done.\n');

  // Seed each service
  console.log('\n[1/6] 🔑 gymcoach_auth');
  const { ptUsers, customers } = await seedAuth(await pools.auth.connect().then(c => { pools.auth._testClient = c; return c; }), passwordHash);
  pools.auth._testClient.release();

  console.log('\n[2/6] 👤 gymcoach_user — profiles, inbody, notifications');
  const userConn = await pools.user.connect();
  await seedUserService(userConn, ptUsers, customers);

  console.log('\n[3/6] 📋 gymcoach_user — contracts, sessions, reviews');
  const contractPairs = await seedContracts(userConn, ptUsers, customers);
  await seedPTAvailability(userConn, ptUsers);
  userConn.release();

  console.log('\n[4/6] 💪 gymcoach_fitness');
  const fitConn = await pools.fitness.connect();
  await seedFitness(fitConn, customers);
  fitConn.release();

  console.log('\n[5/6] 🤖 gymcoach_ai');
  const aiConn = await pools.ai.connect();
  await seedAI(aiConn, customers);
  aiConn.release();

  console.log('\n[6/6] 💬 gymcoach_chat');
  const chatConn = await pools.chat.connect();
  await seedChat(chatConn, contractPairs);
  chatConn.release();

  // Verify
  await verify(pools);

  // Close all pools
  await Promise.all(Object.values(pools).map(p => p.end()));

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' ✅ Seed complete!');
  console.log('');
  console.log(' Test accounts:');
  console.log('   Customer: testuser001@example.com → testuser100@example.com');
  console.log('   PT:       testpt001@example.com   → testpt005@example.com');
  console.log('   Password: Test@123456');
  console.log('');
  console.log(' To clean up test data:');
  console.log('   node scripts/cleanup-test-users.mjs');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
