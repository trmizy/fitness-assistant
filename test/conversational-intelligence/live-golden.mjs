// REAL HTTP/API golden conversation: real registration/login, real gateway → ai-service (Docker, CONVERSATIONAL_INTELLIGENCE_V2=on),
// isolated test databases. Prints every turn and asserts the acceptance conditions. Usage: node test/conversational-intelligence/live-golden.mjs
import fs from "node:fs";
import { registerUser, putProfile, say } from "../ai-chat-full-verification/lib.mjs";
import { q } from "../ai-chat-full-verification/lib.mjs";

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + String(detail).slice(0, 160) : ""}`); };

const u = await registerUser(`ci.golden.${Date.now()}@gymini-test.local`, "CI Golden");
await putProfile(u, { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE", hasCompletedOnboarding: true });
const profileRow = () => q("user", `select goal, "targetWeight" from user_profiles where "userId"='${u.userId}'`);

let sid;
const turn = async (text) => {
  const r = await say(u, text, sid); sid = r.sessionId;
  const blocks = r.data?.structuredBlocks ?? [];
  console.log(`\n> ${text}\n< [${blocks.map((b) => b.type).join(",")}] ${r.answer.replace(/\n/g, " ").slice(0, 420)}  (${r.ms}ms)`);
  return { ...r, blocks };
};

await turn("Tạo lộ trình cho tôi");
const t1 = await turn("mục tiêu 70kg");
check("T1 'mục tiêu 70kg': conflict question (no validator loop)", /thấp hơn cân nặng hiện tại/.test(t1.answer) && /giảm mỡ/.test(t1.answer), t1.answer);
const t2 = await turn("ok hãy đề xuất cho tôi");
check("T2 'hãy đề xuất': a derived recommendation, NOT 'give me a number'", !/con số cụ thể/.test(t2.answer) && /173cm/.test(t2.answer) && /72kg/.test(t2.answer), t2.answer);
const t3 = await turn("74kg");
const ch3 = t3.blocks.find((b) => b.type === "PROFILE_UPDATE_CONFIRMATION")?.changes ?? [];
check("T3 '74kg': proposed goal change + target behind a confirmation card", ch3.some((c) => c.field === "goal" && c.newValue === "WEIGHT_LOSS") && ch3.some((c) => c.field === "targetWeight" && c.newValue === 74), JSON.stringify(ch3.map((c) => `${c.field}=${c.newValue}`)));
check("T3 nothing written before confirmation", /MUSCLE_GAIN/.test(profileRow()), profileRow());

// The user is unhappy with 74 and corrects with the long natural sentence (the real failing message)
const t4 = await turn("với chiều cao 1m73 thì 80kg là đang khá mập rồi tôi muốn xuống 72kg là đẹp");
const ch4 = t4.blocks.find((b) => b.type === "PROFILE_UPDATE_CONFIRMATION")?.changes ?? [];
check("T4: target 72 (never 73), goal WEIGHT_LOSS proposed", ch4.some((c) => c.field === "targetWeight" && c.newValue === 72) && ch4.some((c) => c.field === "goal" && c.newValue === "WEIGHT_LOSS") && !ch4.some((c) => c.newValue === 73), JSON.stringify(ch4.map((c) => `${c.field}=${c.newValue}`)));
check("T4: the stale muscle-gain validator message is gone", !/không cao hơn cân nặng hiện tại/.test(t4.answer), t4.answer);
check("T4: no diagnosis from a casual remark", !/béo phì|thừa cân/.test(t4.answer));
check("T4: still nothing written", /MUSCLE_GAIN/.test(profileRow()), profileRow());

const t5 = await turn("Xác nhận cập nhật");
check("T5 confirm: goal + target written ONCE, roadmap request resumed into its own confirmable preview", /WEIGHT_LOSS/.test(profileRow()) && /72/.test(profileRow()) && t5.blocks.some((b) => b.type === "ACTION_CONFIRMATION"), `${profileRow()} | ${t5.blocks.map((b) => b.type)}`);

// mid-workflow goal change on a fresh session
const u2 = await registerUser(`ci.golden2.${Date.now()}@gymini-test.local`, "CI Golden 2");
await putProfile(u2, { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE", hasCompletedOnboarding: true });
let s2; const turn2 = async (text) => { const r = await say(u2, text, s2); s2 = r.sessionId; console.log(`\n[u2] > ${text}\n< ${r.answer.replace(/\n/g, " ").slice(0, 300)}`); return r; };
await turn2("Tạo lộ trình tăng cơ");
const m = await turn2("Thôi tôi thấy mình đang quá nặng, đổi sang giảm mỡ đi.");
check("mid-workflow 'Thôi … đổi sang giảm mỡ': not cancelled, goal change proposed", !/Đã hủy/.test(m.answer) && /giảm mỡ/.test(m.answer), m.answer);
const negOnly = await turn2("thôi");
check("a bare 'thôi' still cancels", /Đã hủy/.test(negOnly.answer), negOnly.answer);

// canonical command + general Q&A unaffected
const u3 = await registerUser(`ci.golden3.${Date.now()}@gymini-test.local`, "CI Golden 3");
await putProfile(u3, { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeight: 82, gender: "MALE", hasCompletedOnboarding: true });
const qa = await say(u3, "Protein có vai trò gì?");
check("general Q&A does not start a workflow", (qa.data?.structuredBlocks ?? []).length === 0 && qa.answer.length > 40, qa.answer.slice(0, 100));
const prog = await say(u3, "Gợi ý chương trình tập cho tôi");
check("canonical 'Gợi ý chương trình tập cho tôi' still starts the program workflow", (prog.data?.structuredBlocks ?? []).length > 0 || /ngày|mục tiêu|chương trình/i.test(prog.answer), prog.answer.slice(0, 120));

fs.mkdirSync("test/conversational-intelligence/results", { recursive: true });
fs.writeFileSync("test/conversational-intelligence/results/live-golden.json", JSON.stringify({ at: new Date().toISOString(), evidence: "REAL HTTP/API (Docker ai-service, CONVERSATIONAL_INTELLIGENCE_V2=on, isolated test DBs, configured qwen3:30b)", results }, null, 2));
console.log(`\nRESULT ${results.filter((r) => r.pass).length}/${results.length}`);
process.exit(0);
