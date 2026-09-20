import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
async function main() {
  assert.match(process.env.DATABASE_URL!, /localhost:55433\/gymcoach_fitness_test/);
  const { prisma } = await import('../../backend/services/fitness-service/src/repositories/prisma');
  const b = await import('../../backend/services/fitness-service/src/services/nutrition-onboarding-bootstrap.service');
  const { nutritionRepository: repo } = await import('../../backend/services/fitness-service/src/repositories/nutrition.repository');
  const profile = {goal:'WEIGHT_LOSS',currentWeight:113.6,startingWeight:113.6,targetWeight:80,experienceLevel:'BEGINNER',competesInSport:false,injuries:[],age:22,gender:'MALE',heightCm:178,activityLevel:'SEDENTARY',hasCompletedOnboarding:true,nutritionBudgetLevel:'LOW'};
  let queued=0,notified=0;
  Object.assign(b.nutritionBootstrapDeps,{fetchUserProfile:async()=>profile,fetchLatestInBodyOnOrBefore:async()=>null,queueInitialNutritionPlanSafe:async()=>{queued++;return{planId:'p',jobId:'j',status:'QUEUED'};},createPersistentNotification:async()=>{notified++;}});
  const users:string[]=[];
  const fresh=()=>{const u=randomUUID();users.push(u);return u;};
  const state=async(userId:string)=>({goals:await prisma.$queryRaw<any[]>`SELECT id,status,training_cycle_id FROM nutrition_goals WHERE user_id=${userId}`,cycles:await prisma.trainingCycle.findMany({where:{userId,status:'ACTIVE'}}),audits:await prisma.recommendationAudit.count({where:{userId,decision:'INITIAL_PLAN_CREATED'}})});
  const {default:app}=await import('../../backend/services/fitness-service/src/app');
  const server=app.listen(0); const port=(server.address() as AddressInfo).port;
  const post=async(u:string)=>{const r=await fetch(`http://127.0.0.1:${port}/internal/onboarding/bootstrap-nutrition`,{method:'POST',headers:{'x-internal-token':process.env.INTERNAL_SERVICE_SECRET!,'x-user-id':u,'content-type':'application/json'},body:'{}'});return{http:r.status,body:await r.json() as any};};
  try {
    const u=fresh();
    const results=await Promise.all(Array.from({length:10},()=>post(u)));
    assert.ok(results.every(r=>r.http===200&&r.body.success===true));
    assert.equal(results.filter(r=>r.body.data.status==='created').length,1);
    assert.equal(results.filter(r=>r.body.data.status==='already_initialized').length,9);
    const s=await state(u); assert.equal(s.goals.length,1);assert.equal(s.cycles.length,1);assert.equal(s.goals[0].status,'ACTIVE');assert.equal(s.goals[0].training_cycle_id,s.cycles[0].id);
    assert.ok(results.every(r=>r.body.data.goalId===s.goals[0].id));
    assert.deepEqual([s.audits,queued,notified],[1,1,1]);
    console.log(JSON.stringify({case:'http-first',statuses:results.map(r=>r.http),created:1,existing:9,goalId:s.goals[0].id,cycleId:s.cycles[0].id,audits:s.audits,queued,notified}));
    const again=await Promise.all(Array.from({length:10},()=>post(u)));
    assert.ok(again.every(r=>r.http===200&&r.body.data.status==='already_initialized'&&r.body.data.goalId===s.goals[0].id));
    assert.deepEqual(await state(u),s);assert.deepEqual([queued,notified],[1,1]);
    console.log(JSON.stringify({case:'http-existing',responses:10,noChurn:true,noNewSideEffects:true}));
    const partial=fresh(); await b.bootstrapNutritionForUser(partial);
    const prev=await state(partial);
    await prisma.recommendationAudit.deleteMany({where:{userId:partial}});
    await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id=${partial}`;
    queued=0;notified=0;
    const recovered=await Promise.all(Array.from({length:10},()=>b.bootstrapNutritionForUser(partial)));
    const ps=await state(partial);
    assert.equal(recovered.filter(r=>r.status==='created').length,1);
    assert.ok(recovered.every(r=>'goalId' in r&&r.goalId===ps.goals[0].id));
    assert.equal(ps.goals.length,1);assert.equal(ps.cycles.length,1);assert.equal(ps.goals[0].training_cycle_id,prev.cycles[0].id);
    assert.deepEqual([ps.audits,queued,notified],[1,1,1]);
    console.log(JSON.stringify({case:'partial',callers:10,sameExistingCycle:true,audits:ps.audits,queued,notified}));
    const failure=fresh(); let code:any;
    await assert.rejects(()=>repo.createFirstActiveGoalIfAbsent(failure,{calories:null as any,protein:1,carbs:1,fat:1},{}),(e:any)=>{code={prisma:e.code,postgres:e.meta?.code};return e.code==='P2010'&&e.meta?.code==='23502';});
    assert.equal((await state(failure)).goals.length,0);
    assert.equal((await b.bootstrapNutritionForUser(failure)).status,'created');
    console.log(JSON.stringify({case:'rollback-and-retry',error:code,noPartialGoal:true,retry:'created'}));
    const a=fresh(),other=fresh();let unlock!:()=>void,acquired!:()=>void;
    const held=new Promise<void>(r=>{acquired=r;});const release=new Promise<void>(r=>{unlock=r;});
    const tx=prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"nutrition-bootstrap:"+a},0))`;acquired();await release;},{timeout:15000});
    await held;
    let aDone=false;const pending=b.bootstrapNutritionForUser(a).then(r=>{aDone=true;return r;});
    try {
      const otherResult=await b.bootstrapNutritionForUser(other);
      assert.equal(otherResult.status,'created');assert.equal(aDone,false);
      console.log(JSON.stringify({case:'cross-user-barrier',lockAcquired:true,bCompletedWhileAHeld:true}));
    } finally {unlock();await tx;await pending;}
  } finally {
    await new Promise<void>(r=>server.close(()=>r()));
    for(const userId of users){await prisma.recommendationAudit.deleteMany({where:{userId}});await prisma.$executeRaw`DELETE FROM nutrition_goals WHERE user_id=${userId}`;await prisma.trainingCycle.deleteMany({where:{userId}});}
    await prisma.$disconnect();
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
