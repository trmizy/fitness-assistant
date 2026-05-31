import fs from 'node:fs';
import path from 'node:path';

const DATASET_PATH = path.resolve('data/eval/model/ai_gym_e2e_test_cases_vi.json');
const OUTPUT_PATH = path.resolve('data/eval/model/ai_gym_quality_review_vi.json');
const AI_URL = process.env.AI_EVAL_URL || 'http://localhost:3003/ai/ask';
const USER_ID = process.env.AI_EVAL_USER_ID || 'b7ebfe26-d90c-4bf9-a354-f014dd8a658c';

function norm(s) {
  return String(s || '').toLowerCase();
}

function tokenize(s) {
  return norm(s)
    .replace(/[^a-z0-9\săâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function hasVietnamese(text) {
  const t = norm(text);
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/.test(t) || /(buoi|ngay|lich|bai|tap|dinh|duong|thuc|don)/.test(t);
}

function estimateRequestedSessions(testCase) {
  const input = norm(testCase.user_input);
  const profile = testCase.user_profile || {};
  const fromProfile = Number(profile.days_available || profile.training_days_per_week || 0);
  if (fromProfile > 0) return fromProfile;
  const m = input.match(/(\d+)\s*(buoi|buổi|ngay|ngày|day|days)/);
  if (m) return Number(m[1]);
  return 0;
}

function countScheduleMentions(answer) {
  const a = norm(answer);
  const dayWords = (a.match(/thứ|thu |buoi|buổi|ngay|ngày|day/g) || []).length;
  return dayWords;
}

function detectExerciseCompleteness(answer) {
  const a = norm(answer);
  const hasSet = /\bset\b/.test(a);
  const hasRep = /\brep\b|\blan\b/.test(a);
  const hasRest = /\bnghi\b|\brest\b/.test(a);
  const exerciseRows = (a.match(/\n\s*[-*]|\|/g) || []).length;
  const hasNotes = /(luu y|k y thuat|ky thuat|canh bao|sai thuong gap)/.test(a);
  return { hasSet, hasRep, hasRest, exerciseRows, hasNotes };
}

function detectNutritionCompleteness(answer) {
  const a = norm(answer);
  const hasCalories = /(kcal|calories|calo)/.test(a);
  const hasMacro = /(protein|carb|fat|p\/c\/f|macro)/.test(a);
  const mealMentions = (a.match(/bua|bữa|an sang|an trua|an toi|snack/g) || []).length;
  const hasAdjust = /(dieu chinh|theo doi|tang|giam|sua theo)/.test(a);
  return { hasCalories, hasMacro, mealMentions, hasAdjust };
}

function detectContradictions(answer) {
  const a = norm(answer);
  const issues = [];

  const kcal = a.match(/(\d{3,4})\s*(kcal|calories|calo)/);
  const p = a.match(/protein[^\d]*(\d{2,3})\s*g/);
  const c = a.match(/carb[^\d]*(\d{2,3})\s*g/);
  const f = a.match(/fat[^\d]*(\d{1,3})\s*g/);

  if (kcal && p && c && f) {
    const kcalNum = Number(kcal[1]);
    const calc = Number(p[1]) * 4 + Number(c[1]) * 4 + Number(f[1]) * 9;
    if (Math.abs(calc - kcalNum) > 300) {
      issues.push(`Macro (${calc} kcal) lech lon so voi tong kcal (${kcalNum}).`);
    }
  }

  return issues;
}

function detectSafety(answer) {
  const a = norm(answer);
  const issues = [];
  if (/(cam ket|bao dam|guarantee)/.test(a)) issues.push('Co ngon ngu cam ket ket qua tuyet doi.');
  if (/(10kg.*(1 tuan|1 tuần)|ep can toc do cao|nhin an cuc doan)/.test(a)) issues.push('Co dau hieu loi khuyen giam can nguy hiem.');
  if (/(tap qua dau|co gang khi dau)/.test(a)) issues.push('Co dau hieu bo qua an toan chan thuong.');
  return issues;
}

function overlapScore(question, answer) {
  const q = new Set(tokenize(question));
  const a = new Set(tokenize(answer));
  const shared = [...q].filter((x) => a.has(x)).length;
  return q.size === 0 ? 0 : shared / q.size;
}

function rewriteBetter(testCase) {
  const group = testCase.group;
  const profile = testCase.user_profile || {};

  if (group === 'bai_tap') {
    return [
      'Muc tieu: Tom tat dung yeu cau cua user va profile.',
      'Khoi dong 8-10 phut: mobility + activation dung nhom co.',
      'Bai tap chinh (it nhat 5 bai): moi bai ghi ro set, rep, nghi, cue ky thuat ngan gon.',
      'Vi du format: Squat 4x8-10, nghi 90s; RDL 3x10-12, nghi 90s; ...',
      'Luu y an toan: dau hieu dung bai, dieu chinh tai trong theo RPE 7-8.',
      'Ha nhiet 5-8 phut + ke hoach tang tai tuan sau.'
    ].join('\n');
  }

  if (group === 'lich_tap') {
    const days = estimateRequestedSessions(testCase) || 4;
    return [
      `Lich ${days} buoi/tuan (ghi ro tung ngay, khong thieu buoi).`,
      'Moi buoi: muc tieu + nhom co + tong so bai + cuong do.',
      'Phan bo recovery hop ly (khong xep 2 buoi nang lien tiep cung nhom co).',
      'Neu user co han che/chan thuong: thay bai va giam tai trong ngay lien quan.',
      'Them huong dan progression 2-4 tuan va tieu chi dieu chinh lich.'
    ].join('\n');
  }

  return [
    'Xac dinh muc kcal muc tieu theo profile va muc tieu.',
    'Khai bao macro P/C/F ro rang va nhat quan voi tong kcal.',
    'Thuc don mau day du cac bua (an sang, trua, toi, bua phu neu can).',
    'Moi bua co goi y mon an cu the, de ap dung trong thuc te.',
    'Huong dan dieu chinh sau 1-2 tuan dua tren can nang/hieu suat tap.',
    'Neu user co dietary restriction hoac benh ly: dieu chinh mon va canh bao an toan.'
  ].join('\n');
}

function reviewCase(testCase, answer) {
  const thieu = [];
  const sai = [];
  const mauThuan = [];

  let score = 10;

  const relevance = overlapScore(testCase.user_input, answer);
  if (relevance < 0.18) {
    score -= 2;
    sai.push('Tra loi chua dung tam cau hoi cua user.');
  }

  if (answer.length < 500) {
    score -= 1;
    thieu.push('Do sau chua du de ap dung ngay (co dau hieu rut gon).');
  }

  const isViRequired = norm(testCase.user_input).includes('tiếng việt') || norm(testCase.user_input).includes('tieng viet') || norm(testCase.user_profile?.language) === 'vi';
  if (isViRequired && !hasVietnamese(answer)) {
    score -= 2;
    sai.push('Khong dam bao tra loi hoan toan bang tieng Viet.');
  }

  const profile = testCase.user_profile || {};
  const profileKeys = Object.entries(profile)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => `${k}:${String(v).toLowerCase()}`);

  const personalizationHit = profileKeys.some((kv) => {
    const v = kv.split(':')[1].replace(/_/g, ' ');
    return norm(answer).includes(v);
  });

  if (profileKeys.length > 0 && !personalizationHit) {
    score -= 2;
    thieu.push('Thieu ca nhan hoa theo thong tin user_profile.');
  }

  if (testCase.group === 'bai_tap') {
    const ex = detectExerciseCompleteness(answer);
    if (!(ex.hasSet && ex.hasRep && ex.hasRest)) {
      score -= 2;
      thieu.push('Bai tap chua day du set/rep/nghi.');
    }
    if (ex.exerciseRows < 6) {
      score -= 1;
      thieu.push('So bai tap/chi tiet bai tap chua du day.');
    }
    if (!ex.hasNotes) {
      score -= 1;
      thieu.push('Thieu luu y ky thuat/an toan.');
    }
  }

  if (testCase.group === 'lich_tap') {
    const req = estimateRequestedSessions(testCase);
    const mentions = countScheduleMentions(answer);
    if (req > 0 && mentions < req) {
      score -= 2;
      thieu.push('Lich tap co dau hieu thieu buoi/ngay so voi yeu cau.');
    }
  }

  if (testCase.group === 'dinh_duong') {
    const nu = detectNutritionCompleteness(answer);
    if (!nu.hasCalories) {
      score -= 2;
      thieu.push('Thieu calories muc tieu.');
    }
    if (!nu.hasMacro) {
      score -= 2;
      thieu.push('Thieu macro (P/C/F).');
    }
    if (nu.mealMentions < 3) {
      score -= 1;
      thieu.push('Thieu cau truc bua an/mon an mau.');
    }
    if (!nu.hasAdjust) {
      score -= 1;
      thieu.push('Thieu huong dan dieu chinh theo tien do.');
    }
  }

  for (const c of detectContradictions(answer)) mauThuan.push(c);
  if (mauThuan.length > 0) score -= 2;

  for (const s of detectSafety(answer)) sai.push(s);
  if (detectSafety(answer).length > 0) score -= 2;

  if (score < 0) score = 0;
  const pass = score >= 7 && sai.length === 0 && mauThuan.length === 0;

  const canSua = [];
  if (thieu.length > 0) canSua.push('Bo sung day du cac phan bat buoc theo nhom cau hoi.');
  if (sai.length > 0) canSua.push('Sua noi dung sai/khong an toan va bo cam ket phi thuc te.');
  if (mauThuan.length > 0) canSua.push('Can doi lai so lieu de tranh mau thuan kcal-macro.');
  if (!personalizationHit) canSua.push('Chen ro thong tin profile vao quyet dinh de tang ca nhan hoa.');

  return {
    ket_luan: pass ? 'PASS' : 'FAIL',
    diem: `${score}/10`,
    thieu_gi: thieu,
    sai_gi: sai,
    co_mau_thuan_gi: mauThuan,
    can_sua_the_nao: canSua,
    phien_ban_tot_hon_mau: rewriteBetter(testCase),
  };
}

function buildQuestion(testCase) {
  const profile = testCase.user_profile || {};
  return [
    'Thong tin user:',
    JSON.stringify(profile, null, 2),
    '',
    `Cau hoi: ${testCase.user_input}`,
  ].join('\n');
}

async function askAI(question) {
  const res = await fetch(AI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': USER_ID,
    },
    body: JSON.stringify({ question }),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw
  }

  return {
    status: res.status,
    answer: data?.answer || text,
    raw: text,
  };
}

async function run() {
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const cases = dataset.test_cases || [];

  const reviews = [];
  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    // eslint-disable-next-line no-console
    console.log(`[${i + 1}/${cases.length}] Reviewing ${testCase.id}...`);

    const ai = await askAI(buildQuestion(testCase));
    const review = reviewCase(testCase, ai.answer);

    reviews.push({
      id: testCase.id,
      group: testCase.group,
      user_input: testCase.user_input,
      user_profile: testCase.user_profile,
      status_code: ai.status,
      ai_answer: ai.answer,
      qa_review: review,
    });
  }

  const summary = {
    total: reviews.length,
    pass: reviews.filter((r) => r.qa_review.ket_luan === 'PASS').length,
    fail: reviews.filter((r) => r.qa_review.ket_luan === 'FAIL').length,
    avg_score: (
      reviews.reduce((s, r) => s + Number(String(r.qa_review.diem).split('/')[0]), 0) / reviews.length
    ).toFixed(2),
  };

  const output = {
    dataset: dataset.dataset_name,
    generated_at: new Date().toISOString(),
    config: { AI_URL, USER_ID },
    summary,
    reviews,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log('---');
  // eslint-disable-next-line no-console
  console.log('Summary:', summary);
  // eslint-disable-next-line no-console
  console.log('Output:', OUTPUT_PATH);

  if (summary.fail > 0) process.exitCode = 1;
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
