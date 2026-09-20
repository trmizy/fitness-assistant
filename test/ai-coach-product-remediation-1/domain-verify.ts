// Remediation #1 (M7) — REAL fitness-service DB import: what the workout preview
// shows (weekday labels + first dates) must be what WorkoutSchedule persists.
// Run from repo root:  npx tsx test/ai-coach-product-remediation-1/domain-verify.ts
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
config({ path: 'backend/services/fitness-service/.env', override: true });
process.env.FITNESS_DISABLE_REDIS = 'true';

// Same rule as ai-service fitness-agent.service.ts::firstDateForWeekday (preview) and
// fitness-service workout.service.ts::nextDateForWeekday (import).
function firstDate(start: string, weekday: number) {
  const d = new Date(`${start}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
async function main() {
  const { prisma } = await import('../../backend/services/fitness-service/src/repositories/prisma');
  const { workoutService, workoutQueue } = await import('../../backend/services/fitness-service/src/services/workout.service');
  const userId = `remediation-domain-${randomUUID()}`;
  const out: unknown[] = [];
  try {
    const exercise = await prisma.exercise.findFirstOrThrow({ where: { source: 'SYSTEM', status: 'PUBLISHED', archivedAt: null }, select: { id: true, exerciseName: true } });
    const day = (label: string) => ({ day: label, exercises: [{ exerciseId: exercise.id, name: exercise.exerciseName, sets: 3, reps: '10', restSeconds: 60 }] });
    const start = '2026-09-18'; // a Friday — the exact Codex M7 reproduction
    const labels = ['Thứ 2 (Full Body A)', 'Thứ 4 (Full Body B)', 'Thứ 6 (Full Body C)'];
    const selectedWeekdays = [1, 3, 5];
    const base: any = { sourcePlanName: 'remediation', goal: 'WEIGHT_LOSS', durationWeeks: 2, repeatWeeks: 2, daysPerWeek: 3, startDate: start, replaceExisting: true };

    // BEFORE the fix (no selectedWeekdays): the defect Codex reproduced.
    await workoutService.importAiPlanToSchedule(userId, { ...base, sourcePlanId: randomUUID(), weeklySchedule: labels.map(day) });
    const legacy = (await prisma.workoutSchedule.findMany({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } })).slice(0, 3).map((r) => r.date.getUTCDay());
    out.push({ id: 'legacy-no-selectedWeekdays (defect)', firstThreeWeekdays: legacy });
    assert.deepEqual(legacy, [5, 6, 0], 'without selectedWeekdays the import lays days on consecutive dates (Fri/Sat/Sun)');

    // AFTER: the new caller sends selectedWeekdays.
    await workoutService.importAiPlanToSchedule(userId, { ...base, sourcePlanId: randomUUID(), selectedWeekdays, weeklySchedule: labels.map(day) });
    const rows = await prisma.workoutSchedule.findMany({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true, programDay: { select: { dayNumber: true } } } });
    const weekdays = rows.map((r) => r.date.getUTCDay());
    out.push({ id: 'with-selectedWeekdays', rows: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), weekday: r.date.getUTCDay(), dayNumber: r.programDay?.dayNumber })) });
    assert.ok(weekdays.length === 6 && weekdays.every((w) => [1, 3, 5].includes(w)), `every saved date must be Mon/Wed/Fri, got ${weekdays}`);
    for (const [i, wd] of selectedWeekdays.entries()) {
      const mine = rows.filter((r) => r.programDay?.dayNumber === i + 1).map((r) => r.date.toISOString().slice(0, 10));
      assert.equal(mine[0], firstDate(start, wd), `program day ${i + 1} first date must equal the preview firstDate for weekday ${wd}`);
      assert.ok(mine.every((d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() === wd));
    }
    // Sunday handling (0) and a non-consecutive pattern.
    await workoutService.importAiPlanToSchedule(userId, { ...base, sourcePlanId: randomUUID(), daysPerWeek: 2, selectedWeekdays: [1, 0], weeklySchedule: ['Thứ 2 (A)', 'Chủ nhật (B)'].map(day) });
    const last = await prisma.workoutSchedule.findMany({ where: { userId }, select: { date: true } });
    assert.ok(last.length === 4 && last.every((r) => [1, 0].includes(r.date.getUTCDay())));
    out.push({ id: 'monday-and-sunday', weekdays: last.map((r) => r.date.getUTCDay()) });
    console.log(JSON.stringify(out, null, 1));
    console.log('M7 DOMAIN VERIFY: PASS');
  } finally {
    await prisma.workoutSchedule.deleteMany({ where: { userId } });
    await prisma.workoutProgram.deleteMany({ where: { userId } });
    await prisma.$disconnect();
    await workoutQueue.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
