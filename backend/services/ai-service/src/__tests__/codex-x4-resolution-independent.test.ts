import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent } from "../services/fitness-agent.service";
import { workflowStateRepository } from "../agent-workflow/workflow-state.repository";

test.after(async () => prisma.$disconnect());
const question = "Đã lưu thành công chưa?";
const ago = (n: number) => new Date(Date.now() - n * 60000);
async function fixture() {
  const userId = `codex-x4-order-${randomUUID()}`;
  const session = await prisma.chatSession.create({data:{userId,title:"Independent X4 ordering"}});
  const identity = {userId};
  return {
    userId, session, identity,
    workflow: (updatedAt: Date, relevant = true) => prisma.agentWorkflowSession.create({data:{
      userId,sessionId:session.id,workflowType:relevant?"UPDATE_GOAL":"CREATE_WORKOUT_PLAN",
      status:relevant?"COMPLETED":"CANCELLED",updatedAt,createdAt:new Date(updatedAt.getTime()-60000),expiresAt:new Date(Date.now()+600000),
      ...(relevant?{pendingProfileUpdate:[{slotKey:"goal",profileField:"goal",oldValue:"MUSCLE_GAIN",newValue:"WEIGHT_LOSS"}]}:{}),
    }}),
    // X4 event-ordering fix (docs/conversational-intelligence-x4-event-ordering-fix.md): FitnessAgentAction gained
    // an `updatedAt` column (Defect B) to track real status-transition time, distinct from `createdAt`. Without an
    // explicit value here, Prisma's `@updatedAt` would set it to the actual wall-clock time of THIS fixture's own
    // `create()` call, not the synthetic backdated `createdAt` the scenario intends — a mismatch no real row can
    // have (a genuinely-just-created row always has updatedAt === createdAt; they only diverge after a REAL later
    // `.update()`, e.g. dismissDraft, which is exercised separately by the `oldAction`/`dismissDraft` path below).
    // Passed explicitly so a directly-inserted terminal-status row is schema-consistent with that invariant.
    action: (status: string, createdAt: Date) => prisma.fitnessAgentAction.create({data:{
      userId,sessionId:session.id,kind:"CREATE_WORKOUT_PLAN",risk:"MEDIUM",status,createdAt,updatedAt:createdAt,
      payload:{weeklySchedule:[]},expiresAt:new Date(Date.now()+600000),
    }}),
    answer: () => fitnessAgent.tryTurn(question,identity,session.id),
    snapshot: async () => JSON.stringify({actions:await prisma.fitnessAgentAction.findMany({where:{userId}}),workflows:await prisma.agentWorkflowSession.findMany({where:{userId}})}),
    clean: async () => {
      await prisma.fitnessAgentAction.deleteMany({where:{userId}});
      await prisma.agentWorkflowSession.deleteMany({where:{userId}});
      await prisma.chatSession.deleteMany({where:{userId}});
    },
  };
}

for(const scenario of ["profile-only","newer-cancelled-action","newer-profile","pending-action","repeated-confirm","cross-user","history-over-five","action-cancelled-later"]){
  test(`independent X4 resolution: ${scenario}`,async()=>{
    const f=await fixture();
    try {
      if(scenario==="newer-profile") await f.action("CANCELLED",ago(20));
      const oldAction=scenario==="action-cancelled-later"?await f.action("PENDING",ago(20)):null;
      await f.workflow(ago(10));
      if(scenario==="newer-cancelled-action") await f.action("CANCELLED",ago(1));
      if(scenario==="pending-action") await f.action("PENDING",ago(20));
      if(scenario==="history-over-five") for(let i=1;i<=6;i++) await f.workflow(ago(i),false);
      if(oldAction){
        const result=await fitnessAgent.dismissDraft(f.identity,oldAction.id);
        assert.equal((await prisma.fitnessAgentAction.findUnique({where:{id:oldAction.id}}))?.status,"CANCELLED");
        console.log(JSON.stringify({scenario,dismissResult:result,actionCreatedAt:oldAction.createdAt,profileUpdatedAt:ago(10)}));
      }
      if(scenario==="cross-user"){
        const other=await fixture();
        try{
          assert.equal(await workflowStateRepository.findLatestProfileConfirmation(other.userId,f.session.id),null);
          assert.equal(await workflowStateRepository.findLatestProfileConfirmation(f.userId,other.session.id),null);
          await assert.rejects(()=>fitnessAgent.tryTurn(question,other.identity,f.session.id));
          assert.match((await other.answer())!.answer,/Chưa có thay đổi/);
        }finally{await other.clean();}
        return;
      }
      const before=await f.snapshot();
      const r=await f.answer();
      console.log(JSON.stringify({scenario,answer:r?.answer,history:JSON.parse(before)}));
      assert.equal(await f.snapshot(),before,"status query must not mutate confirmation records");
      if(["newer-cancelled-action","action-cancelled-later"].includes(scenario)) assert.match(r!.answer,/đã được bỏ qua/);
      else if(scenario==="pending-action") assert.match(r!.answer,/Chưa/);
      else assert.match(r!.answer,/^Rồi/);
      if(scenario==="repeated-confirm"){
        const repeat=await fitnessAgent.tryTurn("Xác nhận cập nhật.",f.identity,f.session.id);
        assert.match(repeat!.answer,/đã được xác nhận và lưu rồi/);
        assert.equal(await f.snapshot(),before);
      }
    }finally{await f.clean();}
  });
}
