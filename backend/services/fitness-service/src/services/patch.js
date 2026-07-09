const fs = require('fs');
const path = 'd:/project_personal/fitness-assistant/backend/services/fitness-service/src/services/workout.service.ts';
let code = fs.readFileSync(path, 'utf8');

const replacement = `  async importAiPlanToSchedule(userId: string, input: ImportAiPlanDto) {
    const existingProgram = await (prisma.workoutProgram as any).findFirst({
      where: {
        userId,
        sourcePlanId: input.sourcePlanId,
        aiPlanVersion: input.sourcePlanVersion ?? null,
      },
      include: {
        days: {
          include: {
            schedules: true,
            exercises: {
              include: { exercise: true },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { dayNumber: 'asc' },
        },
      },
    });

    if (existingProgram) {
      const repeatWeeks = input.repeatWeeks ?? input.durationWeeks;
      const startDate = parseDateOnly(input.startDate);
      const selectedWeekdays = input.selectedWeekdays;

      if (selectedWeekdays) {
        const uniqueWeekdays = new Set(selectedWeekdays);
        if (uniqueWeekdays.size !== selectedWeekdays.length || selectedWeekdays.length !== input.daysPerWeek) {
          throw {
            status: 400,
            message: \`Kế hoạch này có \${input.daysPerWeek} buổi/tuần. Vui lòng chọn đúng \${input.daysPerWeek} ngày tập.\`,
          };
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        let cancelledScheduleCount = 0;
        const shouldReplace = input.replaceExisting !== false;
        if (shouldReplace) {
          const deleteResult = await (tx.workoutSchedule as any).deleteMany({
            where: {
              userId,
              workoutId: null,
              date: { gte: startDate },
            },
          });
          cancelledScheduleCount = deleteResult.count ?? 0;
        }

        const otherActivePrograms = await (tx.workoutProgram as any).findMany({
          where: { userId, status: 'ACTIVE', id: { not: existingProgram.id } },
          select: { id: true },
        });
        if (otherActivePrograms.length > 0) {
          const otherProgramIds: string[] = otherActivePrograms.map((p: any) => p.id);
          const otherDays = await (tx.workoutProgramDay as any).findMany({
            where: { programId: { in: otherProgramIds } },
            select: { id: true },
          });
          if (otherDays.length > 0) {
            await (tx.workoutSchedule as any).deleteMany({
              where: {
                userId,
                programDayId: { in: otherDays.map((d: any) => d.id) },
                workoutId: null,
              },
            });
          }
        }

        await (tx.workoutProgram as any).updateMany({
          where: {
            userId,
            status: 'ACTIVE',
            id: { not: existingProgram.id },
          },
          data: { status: 'ARCHIVED', archivedAt: new Date() },
        });

        const program = await (tx.workoutProgram as any).update({
          where: { id: existingProgram.id },
          data: { status: 'ACTIVE', archivedAt: null },
          include: {
            days: {
              include: {
                schedules: true,
                exercises: {
                  include: { exercise: true },
                  orderBy: { order: 'asc' },
                },
              },
              orderBy: { dayNumber: 'asc' },
            },
          },
        });

        const scheduleRows: any[] = [];
        const schedulePreview: any[] = [];
        const programDays = [...(program.days as any[])].sort((a: any, b: any) => a.dayNumber - b.dayNumber);

        if (selectedWeekdays) {
          for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
            for (const [weekdayIndex, weekday] of selectedWeekdays.entries()) {
              const day = programDays[weekdayIndex];
              if (!day) continue;
              const plannedDate = nextDateForWeekday(startDate, weekday, weekIndex);
              scheduleRows.push({
                userId,
                date: plannedDate,
                programDayId: day.id,
                sourcePlanId: input.sourcePlanId,
                sourceType: 'AI_PLAN',
                notes: \`\${input.sourcePlanName || goalLabel(input.goal)} - Week \${weekIndex + 1} Day \${day.dayNumber}\`,
              });
              if (schedulePreview.length < 14) {
                schedulePreview.push({
                  date: formatDateOnly(plannedDate),
                  programDayId: day.id,
                  dayLabel: CLEAN_WEEKDAY_LABELS[weekday] || WEEKDAY_LABELS[weekday],
                });
              }
            }
          }
        } else {
          for (let weekIndex = 0; weekIndex < repeatWeeks; weekIndex += 1) {
            for (const day of programDays) {
              const plannedDate = new Date(startDate);
              plannedDate.setDate(plannedDate.getDate() + (weekIndex * 7) + (day.dayNumber - 1));
              scheduleRows.push({
                userId,
                date: plannedDate,
                programDayId: day.id,
                sourcePlanId: input.sourcePlanId,
                sourceType: 'AI_PLAN',
                notes: \`\${input.sourcePlanName || goalLabel(input.goal)} - Week \${weekIndex + 1} Day \${day.dayNumber}\`,
              });
              if (schedulePreview.length < 14) {
                schedulePreview.push({
                  date: formatDateOnly(plannedDate),
                  programDayId: day.id,
                  dayLabel: \`Day \${day.dayNumber}\`,
                });
              }
            }
          }
        }

        const createResult = scheduleRows.length > 0
          ? await (tx.workoutSchedule as any).createMany({ data: scheduleRows, skipDuplicates: true })
          : { count: 0 };

        return {
          program,
          createdScheduleCount: createResult.count,
          cancelledScheduleCount,
          skippedDuplicateCount: Math.max(0, scheduleRows.length - createResult.count),
          schedulePreview,
        };
      });

      const totalScheduleCount = (result.program.days as any[]).reduce(
        (count: number, day: any) => count + (day.schedules?.length || 0),
        0,
      ) + result.createdScheduleCount;
      return {
        success: true,
        message: 'AI plan already saved to workout schedule',
        sourcePlanId: input.sourcePlanId,
        createdProgramId: existingProgram.id,
        createdScheduleCount: result.createdScheduleCount,
        cancelledScheduleCount: result.cancelledScheduleCount,
        skippedDuplicateCount: result.skippedDuplicateCount,
        alreadyExists: true,
        selectedWeekdays: input.selectedWeekdays,
        schedulePreview: result.schedulePreview,
        totalScheduleCount,
        program: result.program,
      };
    }
`;

const lines = code.split('\n');
const startIndex = lines.findIndex(l => l.includes('async importAiPlanToSchedule(userId: string, input: ImportAiPlanDto) {'));
const endIndex = lines.findIndex((l, i) => i > startIndex && l.includes('const exerciseCatalog = await exerciseRepository.findMany({});'));

if (startIndex !== -1 && endIndex !== -1) {
  lines.splice(startIndex, endIndex - startIndex, replacement);
  fs.writeFileSync(path, lines.join('\n'));
  console.log('SUCCESS');
} else {
  console.log('FAILED to find indexes', startIndex, endIndex);
}
