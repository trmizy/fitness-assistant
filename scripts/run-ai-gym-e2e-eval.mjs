import fs from 'node:fs';
import path from 'node:path';

const DATASET_PATH = path.resolve('data/eval/model/ai_gym_e2e_test_cases_vi.json');
const OUTPUT_PATH = path.resolve('data/eval/model/ai_gym_e2e_results_vi.json');
const AI_URL = process.env.AI_EVAL_URL || 'http://localhost:3003/ai/ask';
const USER_ID = process.env.AI_EVAL_USER_ID || 'b7ebfe26-d90c-4bf9-a354-f014dd8a658c';

const STOPWORDS = new Set([
  'va', 'và', 'co', 'có', 'cho', 'nguoi', 'người', 'the', 'thể', 'khong', 'không', 'day', 'đầy',
  'du', 'đủ', 'huong', 'hướng', 'dan', 'dẫn', 'neu', 'nếu', 'hoi', 'hỏi', 'lich', 'lịch', 'tap', 'tập',
  'thuc', 'thực', 'don', 'đơn', 'macro', 'calories', 'bua', 'buổi', 'ngay', 'ngày', 'chi', 'tiết'
]);

function normalize(s) {
  return String(s || '').toLowerCase();
}

function hasVietnameseSignals(text) {
  const t = normalize(text);
  const diacritics = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/;
  const commonVi = /(\bbai\b|\btap\b|\blich\b|\bdinh\b|\bduong\b|\bbuoi\b|\bnghi\b|\bhuong\b|\bdan\b)/;
  return diacritics.test(t) || commonVi.test(t);
}

function tokenize(text) {
  return normalize(text)
    .replace(/[^a-z0-9\săâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function checkExpectedSections(answer, expectedSections) {
  const answerNorm = normalize(answer);
  const misses = [];
  for (const section of expectedSections) {
    const kws = tokenize(section).slice(0, 6);
    const hit = kws.some((kw) => answerNorm.includes(kw));
    if (!hit) misses.push(section);
  }
  return { passed: misses.length === 0, misses };
}

function checkForbidden(answer, forbiddenIssues) {
  const answerNorm = normalize(answer);
  const hits = [];
  for (const issue of forbiddenIssues) {
    const kws = tokenize(issue).slice(0, 5);
    if (kws.length === 0) continue;
    if (kws.every((kw) => answerNorm.includes(kw))) {
      hits.push(issue);
    }
  }
  return { passed: hits.length === 0, hits };
}

function checkCharacteristics(answer, testCase) {
  const lower = normalize(answer);
  const characteristicsMisses = [];

  if ((testCase.user_profile?.language || '').toLowerCase() === 'vi' && !hasVietnameseSignals(answer)) {
    characteristicsMisses.push('Khong dam bao tieng Viet');
  }

  if (answer.length < 500) {
    characteristicsMisses.push('Cau tra loi co dau hieu rut gon qua muc');
  }

  const group = testCase.group;
  if (group === 'bai_tap') {
    const hasSet = /\bset\b/i.test(lower);
    const hasRep = /\brep\b|\blan\b/i.test(lower);
    const hasRest = /\bnghi\b|\brest\b/i.test(lower);
    if (!(hasSet && hasRep && hasRest)) {
      characteristicsMisses.push('Thieu set/rep/nghi cho bai tap');
    }
  }

  if (group === 'lich_tap') {
    const hasBuoi = (lower.match(/buoi|buổi|ngay|ngày/g) || []).length >= 4;
    if (!hasBuoi) {
      characteristicsMisses.push('Lich tap co dau hieu thieu buoi/ngay');
    }
  }

  if (group === 'dinh_duong') {
    const hasCalories = /kcal|calories|calo/.test(lower);
    const hasMacro = /protein|carb|fat|p\/c\/f|macro/.test(lower);
    const hasMeals = (lower.match(/bua|bữa|an sang|an trua|an toi|snack/g) || []).length >= 3;
    if (!hasCalories) characteristicsMisses.push('Thieu calories');
    if (!hasMacro) characteristicsMisses.push('Thieu macro');
    if (!hasMeals) characteristicsMisses.push('Thieu cau truc bua an');
  }

  const profile = testCase.user_profile || {};
  const personalizationSignals = [];
  if (profile.goal) personalizationSignals.push(String(profile.goal).toLowerCase());
  if (Array.isArray(profile.injuries) && profile.injuries.length) personalizationSignals.push(...profile.injuries.map((x) => String(x).toLowerCase()));
  if (Array.isArray(profile.medical_conditions) && profile.medical_conditions.length) personalizationSignals.push(...profile.medical_conditions.map((x) => String(x).toLowerCase()));
  if (profile.diet_type) personalizationSignals.push(String(profile.diet_type).toLowerCase());

  if (personalizationSignals.length > 0) {
    const personalized = personalizationSignals.some((s) => lower.includes(s.replace(/_/g, ' ')) || lower.includes(s));
    if (!personalized) {
      characteristicsMisses.push('Chua the hien ca nhan hoa ro theo user_profile');
    }
  }

  return { passed: characteristicsMisses.length === 0, misses: characteristicsMisses };
}

function buildQuestion(testCase) {
  const profile = testCase.user_profile || {};
  return [
    'Thong tin user (de ca nhan hoa):',
    JSON.stringify(profile, null, 2),
    '',
    `Yeu cau: ${testCase.user_input}`,
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
    data,
    raw: text,
  };
}

async function run() {
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const cases = dataset.test_cases || [];
  const results = [];

  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    const composedQuestion = buildQuestion(testCase);

    // eslint-disable-next-line no-console
    console.log(`[${i + 1}/${cases.length}] Running ${testCase.id}...`);

    const ai = await askAI(composedQuestion);
    const answer = ai.data?.answer || ai.raw || '';

    const sectionCheck = checkExpectedSections(answer, testCase.expected_sections || []);
    const charCheck = checkCharacteristics(answer, testCase);
    const forbiddenCheck = checkForbidden(answer, testCase.forbidden_issues || []);

    const pass = ai.status < 400 && sectionCheck.passed && charCheck.passed && forbiddenCheck.passed;

    results.push({
      id: testCase.id,
      group: testCase.group,
      pass,
      statusCode: ai.status,
      sectionCheck,
      characteristicsCheck: charCheck,
      forbiddenCheck,
      answerPreview: answer.slice(0, 1000),
    });
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    byGroup: results.reduce((acc, r) => {
      if (!acc[r.group]) acc[r.group] = { total: 0, passed: 0, failed: 0 };
      acc[r.group].total += 1;
      if (r.pass) acc[r.group].passed += 1;
      else acc[r.group].failed += 1;
      return acc;
    }, {}),
  };

  const payload = {
    dataset: dataset.dataset_name,
    generatedAt: new Date().toISOString(),
    config: { AI_URL, USER_ID },
    summary,
    results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log('---');
  // eslint-disable-next-line no-console
  console.log('Summary:', summary);
  // eslint-disable-next-line no-console
  console.log('Output:', OUTPUT_PATH);

  if (summary.failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
