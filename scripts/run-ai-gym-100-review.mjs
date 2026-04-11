import fs from 'node:fs';
import path from 'node:path';

const AI_URL = process.env.AI_EVAL_URL || 'http://localhost:3003/ai/ask';
const USER_ID = process.env.AI_EVAL_USER_ID || 'b7ebfe26-d90c-4bf9-a354-f014dd8a658c';
const OUTPUT_JSON = path.resolve('data/eval/model/ai_gym_100_quality_review_vi.json');
const OUTPUT_MD = path.resolve('data/eval/model/ai_gym_100_quality_review_vi.md');

const QUESTIONS = [
  'Tôi mới tập gym, hãy cho tôi một buổi tập ngực đầy đủ cho người mới.',
  'Hãy lên cho tôi buổi tập lưng xô chi tiết, ghi rõ từng bài, set, rep và nghỉ.',
  'Tôi muốn tập chân trong 60 phút, hãy lên buổi tập thật đầy đủ.',
  'Cho tôi buổi tập vai hoàn chỉnh, đừng viết quá ngắn.',
  'Hãy cho tôi bài tập tay trước chi tiết cho nam muốn tăng cơ.',
  'Tôi muốn tập tay sau cho nữ, mục tiêu săn chắc, hãy viết đầy đủ.',
  'Cho tôi buổi push day hoàn chỉnh, không rút gọn.',
  'Hãy lên buổi pull day chi tiết để tôi có thể tập ngay.',
  'Tôi cần một buổi leg day đầy đủ, có cả bài chính và bài phụ.',
  'Tập bụng tại nhà như thế nào, hãy cho tôi một buổi tập đầy đủ.',
  'Tôi chỉ có dumbbell ở nhà, hãy lên buổi tập toàn thân chi tiết.',
  'Cho tôi bài tập mông cho nữ, ghi rõ số set, rep và cách nghỉ.',
  'Tôi muốn tập ngực trên, hãy cho tôi các bài tốt nhất và cách tập cụ thể.',
  'Hãy lên cho tôi buổi tập lưng cho người mới, đừng trả lời sơ sài.',
  'Tôi muốn tập vai nhưng bị đau nhẹ, hãy gợi ý bài phù hợp.',
  'Cho tôi bài tập chân hạn chế áp lực lên đầu gối.',
  'Hãy lên buổi tập ngực - tay sau đầy đủ cho 1 buổi gym.',
  'Tôi muốn buổi tập lưng - tay trước chi tiết, có trình tự rõ ràng.',
  'Hãy cho tôi buổi tập upper body hoàn chỉnh cho intermediate.',
  'Tôi muốn buổi lower body chi tiết, dễ áp dụng ngay ở phòng gym.',
  'Hãy lên lịch tập gym 3 buổi/tuần cho người mới muốn tăng cơ.',
  'Tôi muốn lịch tập 4 buổi/tuần để giảm mỡ, hãy viết đầy đủ từng ngày.',
  'Hãy tạo lịch tập 5 buổi/tuần cho nam 75kg muốn tăng cơ.',
  'Cho tôi lịch tập 6 buổi push pull legs đầy đủ.',
  'Tôi cần lịch tập gym 1 tuần chi tiết, không được thiếu buổi nào.',
  'Hãy lên lịch tập cho nữ 4 buổi/tuần để giảm mỡ và săn chắc.',
  'Tôi chỉ có thể tập thứ 2, 4, 6, hãy lên lịch tập hợp lý cho tôi.',
  'Tôi muốn lịch tập tại nhà 5 buổi/tuần chỉ với tạ đơn.',
  'Hãy lên lịch tập cho người beginner, đừng cho quá nặng.',
  'Tôi tập được 1 năm rồi, hãy lên lịch tập tăng cơ cho intermediate.',
  'Tôi muốn lịch tập ưu tiên ngực và vai, hãy sắp xếp cho hợp lý.',
  'Tôi muốn lịch tập ưu tiên chân và mông cho nữ.',
  'Hãy tạo lịch tập 1 tuần cho người bận, mỗi buổi chỉ 45 phút.',
  'Tôi muốn lịch tập gym kết hợp cardio để giảm mỡ.',
  'Hãy cho tôi lịch tập 3 ngày full body thật chi tiết.',
  'Tạo cho tôi lịch tập 1 tuần có cả ngày nghỉ và ngày hồi phục.',
  'Tôi muốn lịch tập tại nhà cho người thừa cân mới bắt đầu.',
  'Hãy lên lịch tập cho người ít thời gian nhưng muốn tăng cơ rõ rệt.',
  'Tôi chỉ muốn tập 4 ngày nhưng vẫn ưu tiên phát triển toàn thân.',
  'Hãy tạo lịch tập cho người muốn giữ cơ và giảm mỡ cùng lúc.',
  'Tôi nặng 70kg, muốn tăng cơ, cần ăn bao nhiêu protein mỗi ngày?',
  'Hãy cho tôi thực đơn tăng cơ 1 ngày đầy đủ.',
  'Tôi muốn meal plan 3 bữa/ngày để giảm mỡ, hãy viết chi tiết.',
  'Cho tôi thực đơn 2800 kcal để tăng cơ.',
  'Tôi muốn chế độ ăn giảm cân cho nữ, hãy ghi rõ calories và macro.',
  'Hãy tính giúp tôi protein, carb, fat cho mục tiêu giảm mỡ.',
  'Tôi muốn thực đơn tăng cơ nhưng dễ nấu và rẻ.',
  'Cho tôi thực đơn ăn chay đủ protein để tăng cơ.',
  'Tôi bị dị ứng sữa, hãy lên thực đơn phù hợp.',
  'Tôi không dùng whey, hãy cho tôi cách ăn đủ đạm.',
  'Hãy cho tôi thực đơn 1 ngày cho người tập gym buổi sáng.',
  'Tôi tập buổi tối, hãy lên thực đơn phù hợp cho cả ngày.',
  'Tôi muốn meal plan 4 bữa để tăng cơ sạch.',
  'Cho tôi thực đơn giảm mỡ 2000 kcal thật thực tế.',
  'Hãy gợi ý các món ăn giàu protein dễ mua ở Việt Nam.',
  'Tôi muốn ăn tăng cơ nhưng không muốn tăng mỡ quá nhiều, nên ăn thế nào?',
  'Hãy lên thực đơn cho nữ 58kg muốn giảm mỡ nhưng vẫn giữ cơ.',
  'Tôi muốn thực đơn dành cho sinh viên tập gym, tiết kiệm nhưng đủ chất.',
  'Hãy cho tôi thực đơn 1 ngày không có thịt bò và không có hải sản.',
  'Tôi muốn ăn healthy nhưng vẫn đủ năng lượng để tập nặng, hãy tư vấn chi tiết.',
  'Tôi nam, 75kg, 1m72, tập 1 năm, muốn tăng cơ, hãy lên kế hoạch cho tôi.',
  'Tôi nữ, 58kg, 1m60, muốn giảm mỡ, hãy lên lịch tập và ăn uống.',
  'Tôi là beginner, chỉ có thể tập ở nhà, hãy hướng dẫn chi tiết.',
  'Tôi bị đau gối, hãy cho tôi bài tập chân an toàn hơn.',
  'Tôi bị đau vai, hãy tránh các bài dễ làm vai nặng hơn.',
  'Tôi chỉ có dây kháng lực và 2 quả tạ đơn, hãy lên lịch tập.',
  'Tôi đang thừa cân và rất yếu thể lực, nên bắt đầu từ đâu?',
  'Tôi là người gầy khó tăng cân, hãy cho tôi kế hoạch tập và ăn.',
  'Tôi làm văn phòng, ngồi nhiều, hãy tư vấn lịch tập phù hợp.',
  'Tôi 35 tuổi, mới quay lại tập gym sau thời gian dài nghỉ, nên tập thế nào?',
  'Tôi chỉ tập được 30 phút mỗi ngày, hãy lên kế hoạch thực tế.',
  'Tôi hay đau lưng dưới, hãy điều chỉnh giúp tôi lịch tập.',
  'Tôi muốn tập để tăng cơ nhưng không muốn bodybuilder quá to.',
  'Tôi muốn giảm mỡ vùng bụng, hãy cho tôi cách tập và ăn hợp lý.',
  'Tôi là nữ nhưng muốn tăng sức mạnh nhiều hơn là chỉ giảm cân.',
  'Tôi tập ở nhà và không có ghế tập, hãy điều chỉnh bài tập giúp tôi.',
  'Tôi mới sinh hoạt lại sau thời gian dài không tập, hãy cho tôi kế hoạch nhẹ trước.',
  'Tôi ăn chay và tập gym, hãy cho tôi lịch ăn uống và tập luyện.',
  'Tôi không có nhiều tiền cho thực phẩm bổ sung, hãy tư vấn theo đồ ăn bình thường.',
  'Tôi muốn lên kế hoạch thật thực tế để theo được lâu dài.',
  'Trả lời bằng tiếng Việt hoàn toàn: cho tôi buổi tập ngực chi tiết.',
  'Hãy dùng tiếng Việt hoàn toàn, không xen tiếng Anh, để lên lịch tập 4 buổi.',
  'Tôi cần thực đơn tăng cơ bằng tiếng Việt hoàn toàn, đừng dùng thuật ngữ tiếng Anh nếu không cần.',
  'Đừng trả lời ngắn, hãy viết chi tiết cho tôi buổi tập lưng.',
  'Hãy ghi rõ từng bài tập, số set, số rep, thời gian nghỉ.',
  'Tôi cần lịch tập chi tiết từng ngày, không được viết chung chung.',
  'Tôi muốn thực đơn đầy đủ từng bữa sáng, trưa, tối và bữa phụ.',
  'Hãy trả lời thật thực tế, đừng chỉ nói lý thuyết.',
  'Tôi muốn câu trả lời đủ sâu để tôi áp dụng ngay hôm nay.',
  'Đừng rút gọn, tôi cần bản đầy đủ và rõ ràng.',
  'Tôi beginner nhưng muốn lịch tập 6 ngày thật nặng, hãy tư vấn giúp tôi.',
  'Tôi muốn giảm cân nhưng vẫn ăn thật nhiều để tăng cơ nhanh, làm sao cho hợp lý?',
  'Tôi đau gối nhưng vẫn muốn tập chân hiệu quả, có cách nào an toàn không?',
  'Tôi muốn tăng cơ nhưng chỉ ăn 2 bữa/ngày, hãy xem có hợp lý không.',
  'Tôi không ăn sáng, vậy có ảnh hưởng đến mục tiêu tăng cơ không?',
  'Tôi muốn giảm mỡ nhanh trong 2 tuần, hãy cho tôi kế hoạch nhưng phải thực tế.',
  'Tôi chỉ muốn tập bụng để giảm mỡ bụng, điều đó có đủ không?',
  'Tôi muốn tăng cơ nhưng ngủ rất ít, hãy tư vấn thật thực tế.',
  'Tôi muốn meal plan tăng cơ nhưng không muốn nấu ăn quá nhiều.',
  'Hãy cho tôi một kế hoạch hoàn chỉnh gồm tập luyện và dinh dưỡng cho người mới bắt đầu, viết thật đầy đủ.'
];

function norm(s) {
  return String(s || '').toLowerCase();
}

function tokens(s) {
  return norm(s)
    .replace(/[^a-z0-9\săâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function classifyGroup(id) {
  if (id <= 20) return 'bai_tap';
  if (id <= 40) return 'lich_tap';
  if (id <= 60) return 'dinh_duong';
  if (id <= 80) return 'ca_nhan_hoa';
  if (id <= 90) return 'ngon_ngu_chi_tiet';
  return 'logic_tinh_huong_kho';
}

function overlap(q, a) {
  const tq = new Set(tokens(q));
  const ta = new Set(tokens(a));
  const s = [...tq].filter((x) => ta.has(x)).length;
  return tq.size ? s / tq.size : 0;
}

function viOnlyRequired(question) {
  return /(tiếng việt|tieng viet|khong xen tieng anh|không xen tiếng anh|hoan toan bang tieng viet|hoàn toàn bằng tiếng việt)/i.test(question);
}

function isVietnamese(answer) {
  const t = norm(answer);
  const hasViSignals = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/.test(t) || /(buoi|ngay|bai tap|lich tap|thuc don)/.test(t);
  const heavyEnglish = ((t.match(/\b(the|and|for|with|workout|schedule|meal plan|rest|sets|reps)\b/g) || []).length >= 10);
  return hasViSignals && !heavyEnglish;
}

function inferPersonalData(question) {
  const q = norm(question);
  const markers = [];
  if (/\bnam\b|\bnữ\b|\bnu\b|\bfemale\b|\bmale\b/.test(q)) markers.push('gender');
  if (/\b\d+\s*kg\b/.test(q)) markers.push('weight');
  if (/\b1m\d{1,2}\b|\b\d{3}\s*cm\b/.test(q)) markers.push('height');
  if (/beginner|intermediate|moi tap|mới tập/.test(q)) markers.push('level');
  if (/dau goi|đau gối|dau vai|đau vai|dau lung|đau lưng/.test(q)) markers.push('injury');
  return markers;
}

function scoreCase(id, q, a) {
  let score = 10;
  const errs = [];
  const wrong = [];
  const contradictions = [];

  const group = classifyGroup(id);
  const aN = norm(a);

  if (overlap(q, a) < 0.15) {
    score -= 2;
    wrong.push('Lac trong tam cau hoi.');
  }

  if (a.length < 420) {
    score -= 1;
    errs.push('Noi dung co dau hieu rut gon qua muc.');
  }

  if (viOnlyRequired(q) && !isVietnamese(a)) {
    score -= 2;
    wrong.push('Khong dam bao tra loi hoan toan bang tieng Viet.');
  }

  const personalMarkers = inferPersonalData(q);
  if (personalMarkers.length > 0) {
    const personalHit = (
      (personalMarkers.includes('weight') && /kg/.test(aN)) ||
      (personalMarkers.includes('height') && /(cm|1m)/.test(aN)) ||
      (personalMarkers.includes('gender') && /(nam|nu|nữ|female|male)/.test(aN)) ||
      (personalMarkers.includes('level') && /(beginner|intermediate|nguoi moi|người mới)/.test(aN)) ||
      (personalMarkers.includes('injury') && /(dau goi|đau gối|dau vai|đau vai|dau lung|đau lưng|an toan|an toàn)/.test(aN))
    );
    if (!personalHit) {
      score -= 2;
      errs.push('Thieu ca nhan hoa theo thong tin ca nhan cua user.');
    }
  }

  if (group === 'bai_tap' || (group === 'ca_nhan_hoa' && /(buoi tap|bài tập|lịch tập|tap)/i.test(q))) {
    const hasSet = /\bset\b/.test(aN);
    const hasRep = /\brep\b|\blan\b/.test(aN);
    const hasRest = /(nghi|rest)/.test(aN);
    const hasNotes = /(luu y|kỹ thuật|ky thuat|canh bao|an toan)/.test(aN);
    if (!(hasSet && hasRep && hasRest)) {
      score -= 2;
      errs.push('Thieu bo thong so set/rep/nghi.');
    }
    if (!hasNotes) {
      score -= 1;
      errs.push('Thieu luu y ky thuat/an toan.');
    }
  }

  if (group === 'lich_tap' || (group === 'ca_nhan_hoa' && /lịch|lich/.test(q))) {
    const req = (() => {
      const m = norm(q).match(/(\d+)\s*(buoi|buổi|ngay|ngày|day|days)/);
      return m ? Number(m[1]) : 0;
    })();
    const mentions = (aN.match(/buoi|buổi|ngay|ngày|thứ|thu /g) || []).length;
    if (req > 0 && mentions < req) {
      score -= 2;
      errs.push('Lich tap thieu buoi/ngay so voi yeu cau.');
    }
  }

  if (group === 'dinh_duong' || (group === 'ca_nhan_hoa' && /thực đơn|thuc don|meal plan|macro|calories|protein/.test(q))) {
    const hasKcal = /(kcal|calories|calo)/.test(aN);
    const hasMacro = /(protein|carb|fat|macro|p\/c\/f)/.test(aN);
    const meals = (aN.match(/bua|bữa|sáng|trưa|tối|phụ|snack/g) || []).length;
    const adjust = /(dieu chinh|theo doi|tang|giam)/.test(aN);
    if (!hasKcal) { score -= 2; errs.push('Thieu calories.'); }
    if (!hasMacro) { score -= 2; errs.push('Thieu macro.'); }
    if (meals < 3) { score -= 1; errs.push('Thieu mon an mau/cau truc bua.'); }
    if (!adjust) { score -= 1; errs.push('Thieu huong dan dieu chinh.'); }

    const kcal = aN.match(/(\d{3,4})\s*(kcal|calories|calo)/);
    const p = aN.match(/protein[^\d]*(\d{2,3})\s*g/);
    const c = aN.match(/carb[^\d]*(\d{2,3})\s*g/);
    const f = aN.match(/fat[^\d]*(\d{1,3})\s*g/);
    if (kcal && p && c && f) {
      const total = Number(p[1]) * 4 + Number(c[1]) * 4 + Number(f[1]) * 9;
      const target = Number(kcal[1]);
      if (Math.abs(total - target) > 350) {
        score -= 2;
        contradictions.push(`Tong kcal tu macro (${total}) lech lon so voi kcal muc tieu (${target}).`);
      }
    }
  }

  if (/(cam ket|bao dam|guarantee|ep can toc do cao|nhin an cuc doan)/.test(aN)) {
    score -= 2;
    wrong.push('Noi dung thieu an toan/phi thuc te.');
  }

  if (score < 0) score = 0;
  const pass = score >= 7 && wrong.length === 0 && contradictions.length === 0;

  const suggest = [];
  if (errs.length > 0) suggest.push('Bo sung cac phan bat buoc theo loai cau hoi, tang do chi tiet de ap dung ngay.');
  if (wrong.length > 0) suggest.push('Sua noi dung lech trong tam/khong an toan va dam bao dung ngon ngu user yeu cau.');
  if (contradictions.length > 0) suggest.push('Can doi lai so lieu calories-macro va logic muc tieu.');
  if (suggest.length === 0) suggest.push('Giu cau truc hien tai, toi uu them tinh ca nhan hoa va tinh thuc te.');

  return {
    pass: pass ? 'PASS' : 'FAIL',
    score: `${score}/10`,
    focus: overlap(q, a) >= 0.15 ? 'Co' : 'Khong',
    complete: errs.length === 0 ? 'Co' : 'Khong',
    too_short: a.length < 420 ? 'Co' : 'Khong',
    personalized: personalMarkers.length === 0 ? 'Khong yeu cau ro' : (errs.some((e) => e.includes('ca nhan hoa')) ? 'Khong' : 'Co'),
    contradiction: contradictions.length ? 'Co' : 'Khong',
    vietnamese_ok: viOnlyRequired(q) ? (isVietnamese(a) ? 'Co' : 'Khong') : 'Khong yeu cau ro',
    actionable: score >= 7 ? 'Co' : 'Khong',
    main_errors: [...errs, ...wrong, ...contradictions],
    suggestions: suggest,
    group,
  };
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
  try {
    const data = JSON.parse(text);
    return { status: res.status, answer: data.answer || text };
  } catch {
    return { status: res.status, answer: text };
  }
}

function toCaseBlock(item) {
  return [
    `[Test ${item.id}]`,
    `- Câu hỏi: ${item.question}`,
    `- AI trả lời có hợp lý không: ${item.review.pass}`,
    `- Đúng trọng tâm không: ${item.review.focus}`,
    `- Có đầy đủ không: ${item.review.complete}`,
    `- Có bị rút gọn quá mức không: ${item.review.too_short}`,
    `- Có cá nhân hóa không: ${item.review.personalized}`,
    `- Có mâu thuẫn logic/số liệu không: ${item.review.contradiction}`,
    `- Có đúng tiếng Việt không: ${item.review.vietnamese_ok}`,
    `- Có thể áp dụng ngay không: ${item.review.actionable}`,
    `- Lỗi chính nếu có: ${item.review.main_errors.length ? item.review.main_errors.join(' | ') : 'Khong'} `,
    `- Gợi ý sửa: ${item.review.suggestions.join(' ')}`,
    ''
  ].join('\n');
}

function buildSummary(results) {
  const byErr = {};
  const byGroup = {};
  for (const r of results) {
    const g = r.review.group;
    if (!byGroup[g]) byGroup[g] = { total: 0, pass: 0, fail: 0 };
    byGroup[g].total += 1;
    if (r.review.pass === 'PASS') byGroup[g].pass += 1;
    else byGroup[g].fail += 1;

    for (const e of r.review.main_errors) {
      byErr[e] = (byErr[e] || 0) + 1;
    }
  }

  const topErrors = Object.entries(byErr).sort((a, b) => b[1] - a[1]);
  const bestGroup = Object.entries(byGroup).sort((a, b) => (b[1].pass / b[1].total) - (a[1].pass / a[1].total))[0];
  const worstGroup = Object.entries(byGroup).sort((a, b) => (a[1].pass / a[1].total) - (b[1].pass / b[1].total))[0];

  return {
    totals: {
      total: results.length,
      pass: results.filter((x) => x.review.pass === 'PASS').length,
      fail: results.filter((x) => x.review.pass === 'FAIL').length,
      avgScore: (results.reduce((s, x) => s + Number(x.review.score.split('/')[0]), 0) / results.length).toFixed(2),
    },
    byGroup,
    topErrors,
    bestGroup,
    worstGroup,
  };
}

async function run() {
  const results = [];

  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const id = i + 1;
    const question = QUESTIONS[i];
    // eslint-disable-next-line no-console
    console.log(`[${id}/100] Testing...`);
    const ai = await askAI(question);
    const review = scoreCase(id, question, ai.answer);
    results.push({ id, question, statusCode: ai.status, answer: ai.answer, review });
  }

  const summary = buildSummary(results);

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    config: { AI_URL, USER_ID },
    summary,
    results,
  };
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(jsonPayload, null, 2), 'utf8');

  const top10Serious = summary.topErrors.slice(0, 10).map(([e, c], idx) => `${idx + 1}. ${e} (${c})`);
  const improve = [
    'Tang prompt rung buoc output theo schema bat buoc theo loai cau hoi (bai tap/lich tap/dinh duong).',
    'Bat rule ca nhan hoa khi co thong tin so lieu trong cau hoi.',
    'Them validator logic macro-kcal truoc khi tra loi.',
    'Them language lock: neu user yeu cau tieng Viet thi cam pha tieng Anh.',
    'Them anti-short-answer gate: toi thieu so muc va do dai cho cau hoi chi tiet.'
  ];

  const lines = [];
  for (const r of results) lines.push(toCaseBlock(r));
  lines.push('## Tong ket');
  lines.push(`1. Những lỗi lặp lại nhiều nhất của AI:\n${summary.topErrors.slice(0, 12).map(([e, c], i) => `${i + 1}. ${e} (${c})`).join('\n')}`);
  lines.push(`2. Nhóm câu hỏi AI làm tốt nhất: ${summary.bestGroup ? `${summary.bestGroup[0]} (${summary.bestGroup[1].pass}/${summary.bestGroup[1].total} PASS)` : 'N/A'}`);
  lines.push(`3. Nhóm câu hỏi AI làm tệ nhất: ${summary.worstGroup ? `${summary.worstGroup[0]} (${summary.worstGroup[1].pass}/${summary.worstGroup[1].total} PASS)` : 'N/A'}`);
  lines.push(`4. 10 lỗi nghiêm trọng nhất cần sửa trước:\n${top10Serious.join('\n')}`);
  lines.push(`5. Đề xuất cách cải thiện prompt hoặc logic hệ thống:\n${improve.map((x, i) => `${i + 1}. ${x}`).join('\n')}`);

  fs.writeFileSync(OUTPUT_MD, lines.join('\n'), 'utf8');

  // eslint-disable-next-line no-console
  console.log('---');
  // eslint-disable-next-line no-console
  console.log('Summary totals:', summary.totals);
  // eslint-disable-next-line no-console
  console.log('Best group:', summary.bestGroup);
  // eslint-disable-next-line no-console
  console.log('Worst group:', summary.worstGroup);
  // eslint-disable-next-line no-console
  console.log('JSON:', OUTPUT_JSON);
  // eslint-disable-next-line no-console
  console.log('MD:', OUTPUT_MD);

  if (summary.totals.fail > 0) process.exitCode = 1;
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
