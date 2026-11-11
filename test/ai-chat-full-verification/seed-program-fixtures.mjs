// TEST FIXTURE: four public training-program templates in the ISOLATED fitness test DB (real catalog exercise ids), so
// "find / apply a training program" can be verified through chat. Names are prefixed "[TEST FIXTURE]" (never mistaken for real data).
// Idempotent (delete-then-insert by name prefix). Run from repo root: node test/ai-chat-full-verification/seed-program-fixtures.mjs
import { execSync } from "node:child_process";
const ex = {
  crunches: "00703838-193d-4f84-aeac-cc89004c7e57", pushup: "04bc270b-b0a2-431f-8281-4e146685bb4b", crunchOH: "06580dc2-0afd-4a92-bf61-18f83394aa75", rocket: "020b389b-86b4-42b5-bb37-e7cc0640cb5e",
  dbSquat: "01c98e97-3d03-4b7d-8630-dda8a10629f6", dbPress: "0595a932-8f4e-4337-9924-0bbc1d17c872", dbSplit: "0684041d-1115-4065-a0db-745fcd65159c",
  cableRow: "002d3a25-ea86-46a4-ada1-d57769f8d257", pulldown: "0031ef80-7cba-423d-b8f9-1ddd954ef753", cableCurl: "00728d48-3b4e-4d92-a5b6-ec20cf22defa", bbSquat: "00ee7322-3e4f-4a78-a361-94e26f00c2dc",
};
const days = (n, lists) => Array.from({ length: n }, (_, i) => ({ dayNumber: i + 1, title: `Ngày ${i + 1}`, exercises: lists[i % lists.length].map((exerciseId) => ({ exerciseId, sets: 3, reps: 10, restSeconds: 60 })) }));
const templates = [
  { name: "[TEST FIXTURE] Bodyweight toàn thân 3 ngày (giảm mỡ, người mới)", goal: "WEIGHT_LOSS", weeks: 6, perWeek: 3, level: "BEGINNER", days: days(3, [[ex.crunches, ex.pushup, ex.crunchOH], [ex.pushup, ex.rocket, ex.crunches]]) },
  { name: "[TEST FIXTURE] Dumbbell tại nhà 4 ngày (tăng cơ, người mới)", goal: "MUSCLE_GAIN", weeks: 8, perWeek: 4, level: "BEGINNER", days: days(4, [[ex.dbSquat, ex.dbPress], [ex.dbSplit, ex.dbPress]]) },
  { name: "[TEST FIXTURE] Gym cable push/pull 4 ngày (tăng cơ, trung cấp)", goal: "MUSCLE_GAIN", weeks: 8, perWeek: 4, level: "INTERMEDIATE", days: days(4, [[ex.cableRow, ex.pulldown, ex.cableCurl], [ex.bbSquat, ex.pulldown]]) },
  { name: "[TEST FIXTURE] Dumbbell giảm mỡ 3 ngày (người mới)", goal: "WEIGHT_LOSS", weeks: 6, perWeek: 3, level: "BEGINNER", days: days(3, [[ex.dbSquat, ex.dbSplit, ex.crunches], [ex.dbPress, ex.dbSquat, ex.crunchOH]]) },
];
const esc = (s) => s.replace(/'/g, "''");
const sql = [
  "DELETE FROM workout_program_templates WHERE name LIKE '[TEST FIXTURE]%';",
  ...templates.map((t) => `INSERT INTO workout_program_templates (id, created_by_user_id, name, description, goal, duration_weeks, days_per_week, days_json, is_public, data_origin, experience_level, shared_with_user_ids, created_at) VALUES (gen_random_uuid()::text, 'test-fixture-creator', '${esc(t.name)}', 'Test fixture for chat verification', '${t.goal}', ${t.weeks}, ${t.perWeek}, '${esc(JSON.stringify(t.days))}'::jsonb, true, 'REAL', '${t.level}', ARRAY[]::text[], now());`),
  "SELECT count(*) FROM workout_program_templates WHERE name LIKE '[TEST FIXTURE]%';",
].join("\n");
console.log(execSync("docker exec -i gymcoach-test-postgres-test-1 psql -U gymcoach_test -d gymcoach_fitness_test -At", { input: sql, encoding: "utf8" }).trim());
