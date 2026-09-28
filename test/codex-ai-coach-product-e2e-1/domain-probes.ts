import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
config({ path: 'backend/services/fitness-service/.env', override: true });
process.env.FITNESS_DISABLE_REDIS = 'true';
async function main() {
  const { prisma } = await import('../../backend/services/fitness-service/src/repositories/prisma');
  const { workoutService, workoutQueue } = await import('../../backend/services/fitness-service/src/services/workout.service');
  const { nutritionService } = await import('../../backend/services/fitness-service/src/services/nutrition.service');
  const userId = `codex-product-domain-${randomUUID()}`;
  const emit = (id: string, observed: unknown) => console.log(JSON.stringify({ id, observed }));
  try {
    const exercise = await prisma.exercise.findFirstOrThrow({ where: { source: 'SYSTEM', status: 'PUBLISHED', archivedAt: null }, select: { id: true, exerciseName: true, contraindications: true, difficultyLevel: true } });
    const old = await prisma.workoutSchedule.createMany({ data: [
      { userId, date: new Date('2026-08-01'), sourceType: 'MANUAL', status: 'IN_PROGRESS' },
      { userId, date: new Date('2026-12-01'), sourceType: 'MANUAL', status: 'NOT_STARTED' },
    ] });
    const input: any = { sourcePlanId: randomUUID(), sourcePlanName: 'Codex isolated', goal: 'WEIGHT_LOSS', durationWeeks: 1, repeatWeeks: 1, daysPerWeek: 1, startDate: '2026-09-20', replaceExisting: true,
      weeklySchedule: [{ day: 'Sunday', exercises: [{ exerciseId: exercise.id, name: exercise.exerciseName, sets: 3, reps: '10', restSeconds: 60 }] }] };
    const saved = await workoutService.importAiPlanToSchedule(userId, input);
    const schedules = await prisma.workoutSchedule.findMany({ where: { userId }, select: { date:true, trainingCycleId:true, sourceType:true } });
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].trainingCycleId, null);
    emit('real-workout-save-no-cycle-and-replacement', { createdOld: old.count, result: { cancelled: saved.cancelledScheduleCount, created:saved.createdScheduleCount }, schedules, exercise });
    const labels = ['Thứ 2 (Full Body A)', 'Thứ 4 (Full Body B)', 'Thứ 6 (Full Body C)'];
    await workoutService.importAiPlanToSchedule(userId,{...input,sourcePlanId:randomUUID(),daysPerWeek:3,startDate:'2026-09-18',weeklySchedule:labels.map(day=>({...input.weeklySchedule[0],day}))});
    emit('preview-weekdays-vs-persisted-dates',{preview:labels,saved:await prisma.workoutSchedule.findMany({where:{userId},orderBy:{date:'asc'},select:{date:true}})});
    const invalid = { ...input, sourcePlanId:randomUUID(), weeklySchedule:[{ day:'Sunday', exercises:[{ exerciseId:'nonexistent-codex-exercise', name:'Invented', sets:3, reps:'10', restSeconds:60 }] }] };
    let rejected = false;
    try { await workoutService.importAiPlanToSchedule(userId, invalid); } catch { rejected = true; }
    assert.ok(rejected); emit('real-raw-exercise-rejected', rejected);
    const generatedCatalog = await prisma.exercise.findMany({where:{source:'SYSTEM',status:'PUBLISHED',archivedAt:null,exerciseName:{in:['Back Squat','Deadlift','Romanian Deadlift','Bench Press','Overhead Press']}},select:{id:true,exerciseName:true,difficultyLevel:true,contraindications:true}});
    emit('generated-name-catalog-safety-metadata',generatedCatalog);
    const required = await prisma.exerciseEquipment.findFirst({where:{requirementType:'REQUIRED',exercise:{source:'SYSTEM',status:'PUBLISHED',archivedAt:null}},include:{exercise:true}});
    if (required) {
      const other = await prisma.equipment.findFirst({where:{id:{not:required.equipmentId}}});
      if (other) {
        await prisma.userEquipment.create({data:{userId,equipmentId:other.id}});
        let mismatch:any;
        try { await workoutService.importAiPlanToSchedule(userId,{...input,sourcePlanId:randomUUID(),weeklySchedule:[{day:'Sunday',exercises:[{exerciseId:required.exerciseId,name:required.exercise.exerciseName,sets:3,reps:'10',restSeconds:60}]}]}); }
        catch(e:any){mismatch={status:e.status,message:e.message};}
        emit('real-equipment-mismatch',mismatch??'No mismatch for this alternative equipment combination');
      }
    }
    const payload: any = { sourcePlanId:randomUUID(), sourcePlanName:'Codex nutrition', goal:'WEIGHT_LOSS', durationWeeks:1, mealsPerDay:2, dailyCaloriesTarget:2200, proteinTargetGrams:165, carbTargetGrams:248, fatTargetGrams:61,
      weeklySchedule:Array.from({length:7},(_,i)=>({dayNumber:i+1,title:'Day',totalCalories:2200,meals:[{mealType:'BREAKFAST',title:'Test meal',items:[{name:'Isolated fixture food',quantity:100,unit:'g',calories:200,protein:10,carbs:20,fat:5}]}]})) };
    const n1 = await nutritionService.importAiPlan(userId,payload);
    const n1Again = await nutritionService.importAiPlan(userId,payload);
    emit('nutrition-without-goal-roadmap-cycle', { saved:!!n1.createdProgramId, repeated:n1Again.alreadyExists, goalCount:await prisma.nutritionGoal.count({where:{userId}}) });
    const goal = await prisma.nutritionGoal.create({data:{userId,calories:1800,protein:150,carbs:180,fat:53,triggeredBy:'ONBOARDING'}});
    await nutritionService.importAiPlan(userId,{...payload,sourcePlanId:randomUUID()});
    emit('nutrition-existing-goal', { goals: await prisma.nutritionGoal.findMany({where:{userId},select:{id:true,calories:true,status:true}}), programs:await prisma.nutritionProgram.findMany({where:{userId},select:{dailyCaloriesTarget:true,status:true,sourceGoalId:true}}), expectedGoalId:goal.id });
  } finally {
    await prisma.workoutSchedule.deleteMany({where:{userId}});
    await prisma.workoutProgram.deleteMany({where:{userId}});
    await prisma.nutritionProgram.deleteMany({where:{userId}});
    await prisma.nutritionGoal.deleteMany({where:{userId}});
    await prisma.userEquipment.deleteMany({where:{userId}});
    await prisma.$disconnect();
    await workoutQueue.close();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
