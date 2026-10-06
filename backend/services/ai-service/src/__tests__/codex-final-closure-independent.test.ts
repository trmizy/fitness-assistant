import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";
import { fitnessAgentTools, PROFILE_READ_ORIGIN } from "../services/fitness-agent-tools";
import { classifyProfileReadError } from "../conversational-intelligence/global/profile-errors";
import { llmService } from "../services/llm.service";
import { llmRoute, llmRouteDeps, LlmRouteSchema } from "../conversational-intelligence/global/llm-route";
import { callLlmJson } from "../llm/json_llm_call.util";

test.after(async () => { await prisma.$disconnect(); });
async function fixture() {
  const userId = `codex-final-${randomUUID()}`;
  const s = await prisma.chatSession.create({data:{userId,title:"Independent final closure"}});
  return {userId,sessionId:s.id,identity:{userId}, async clean() {
    await prisma.fitnessAgentAction.deleteMany({where:{userId}});
    await prisma.agentWorkflowSession.deleteMany({where:{userId}});
    await prisma.chatSession.delete({where:{id:s.id}});
  }};
}
function flags(ci:string) {process.env.CONVERSATIONAL_INTELLIGENCE_V2=ci;process.env.CONVERSATIONAL_INTELLIGENCE_V2_LLM="on";}

for (const ci of ["off","on"]) test(`independent X1 origin and unrelated errors, CI ${ci}`, async () => {
  flags(ci);
  const f=await fixture();
  const saved={request:axios.request,sub:fitnessAgentDeps.tools.substituteMealItem,extract:fitnessAgentDeps.extractFoodSubstitutionIntent};
  try {
    for (const status of [422,503,500,401,403]) {
      (axios as any).request=async (cfg:any)=>{assert.equal(cfg.url,"/profile/agent/context");throw {response:{status,data:{error:status===422?"Complete your profile first":"denied"}}};};
      let caught:any;
      try {await fitnessAgentTools.getUserFitnessContext(f.identity);}catch(e){caught=e;}
      assert.equal(caught.origin,PROFILE_READ_ORIGIN);
      if(status===422 || status===503){
        const r=await fitnessAgent.tryTurn("Tìm PT cho tôi.",f.identity,f.sessionId);
        assert.match(r!.answer,status===422?/chưa có hồ sơ/:/dịch vụ hồ sơ.*gián đoạn/);
      }else{
        await assert.rejects(()=>fitnessAgent.tryTurn("Tìm PT cho tôi.",f.identity,f.sessionId),(e:any)=>e.status===status);
      }
    }
    axios.request=saved.request;
    fitnessAgentDeps.extractFoodSubstitutionIntent=async()=>({isFoodSubstitutionRequest:true,currentFoodMention:"chicken",desiredFoodMention:"fish",mealHint:null});
    for(const status of [422,503,500,401,403]){
      const error=Object.assign(new Error(status===422?"Complete your profile first":"independent downstream error"),{status});
      fitnessAgentDeps.tools.substituteMealItem=async()=>{throw error;};
      assert.equal(classifyProfileReadError(error),"UNEXPECTED");
      await assert.rejects(()=>fitnessAgent.tryTurn("tôi muốn ăn cá hồi thay ức gà",f.identity,f.sessionId),(e:any)=>e===error && e.origin===undefined);
    }
    assert.equal(await prisma.agentWorkflowSession.count({where:{userId:f.userId}}),0);
    assert.equal(await prisma.fitnessAgentAction.count({where:{userId:f.userId}}),0);
  } finally {axios.request=saved.request;fitnessAgentDeps.tools.substituteMealItem=saved.sub;fitnessAgentDeps.extractFoodSubstitutionIntent=saved.extract;await f.clean();}
});

test("independent X2: all routing logs redact hostile model outputs and retain correlation", async()=>{
  const saved={call:llmService.callLLM,info:logger.info,warn:logger.warn,error:logger.error};
  const lines:any[]=[]; const secret="SYNTHETIC_Bearer_PRIVATE_181cm_90kg_DO_NOT_LOG";
  for(const level of ["info","warn","error"] as const)(logger as any)[level]=(obj:any,msg:any)=>lines.push({level,obj,msg});
  try{
    const outputs=[JSON.stringify({route:"READ_STATE",topic:secret}),`{"route":${secret}}`,JSON.stringify({route:secret}),JSON.stringify({route:"READ_STATE",topic:[secret]}),`not-json ${secret}`];
    for(const [i,answer] of outputs.entries()){
      llmService.callLLM=async()=>({answer} as any);
      assert.equal(await llmRoute("unknown",{},"codex-private",`codex-final-${i}`),null);
      assert.ok(lines.some(l=>l.obj?.correlationId===`codex-final-${i}` && l.obj.accepted===false));
    }
    let calls=0;
    llmService.callLLM=async()=>{calls++;return {answer:`{"route":${secret}}`} as any;};
    assert.equal(await callLlmJson("test",LlmRouteSchema,{userId:"codex-private",phase:"global-routing",numPredict:60,attempts:2,redactErrorDetail:true}),null);
    assert.equal(calls,2);
    for(const [route,topic,text] of [["READ_STATE","PT_STATUS","PT của tôi"],["RECOMMEND","SESSIONS","nên tập mấy buổi"]]){
      llmService.callLLM=async()=>({answer:JSON.stringify({route,topic})} as any);
      assert.equal((await llmRoute(text,{},"codex-private",`valid-${topic}`))?.topic,topic);
      assert.ok(lines.some(l=>l.obj?.llmTopic===topic && l.obj.accepted===true));
    }
    assert.ok(!JSON.stringify(lines).includes(secret));
    assert.ok(lines.filter(l=>l.obj?.err).every(l=>l.obj.err.startsWith("redacted:")));
  }finally{llmService.callLLM=saved.call;Object.assign(logger,{info:saved.info,warn:saved.warn,error:saved.error});}
});

test("independent X3: meal-log and substitution reach their specialists, not hostile fallback",async()=>{
  flags("on"); const f=await fixture();
  const saved={llm:llmRouteDeps.llmRoute,meal:fitnessAgentDeps.extractMealLogIntent,sub:fitnessAgentDeps.extractFoodSubstitutionIntent,food:fitnessAgentDeps.tools.searchFood,subTool:fitnessAgentDeps.tools.substituteMealItem,context:fitnessAgentDeps.tools.getUserFitnessContext};
  let llm=0,meal=0,sub=0,profileReads=0;
  llmRouteDeps.llmRoute=async()=>{llm++;return {route:"RECOMMEND",topic:"MEALS",confidence:0.6,reason:"injected hostile fallback"};};
  fitnessAgentDeps.tools.getUserFitnessContext=async()=>{profileReads++;throw new Error("unnecessary profile read");};
  try{
    assert.equal(await fitnessAgent.tryTurn("hôm nay tôi nên tập chân hay tập lưng?",f.identity,f.sessionId),null);
    assert.equal(profileReads,0);
    fitnessAgentDeps.extractMealLogIntent=async()=>{meal++;return {isMealLogRequest:true,foodMention:"rice",quantityMultiplier:1,mealType:"lunch"} as any;};
    fitnessAgentDeps.tools.searchFood=async()=>({name:"rice",calories:100,protein:2,carbs:20,fats:1} as any);
    const r=await fitnessAgent.tryTurn("Tôi vừa ăn cơm trưa",f.identity,f.sessionId);
    assert.equal(meal,1);assert.equal(llm,0);
    assert.ok(r?.blocks.some((b:any)=>b.kind==="NUTRITION_LOG_MEAL"));
    await prisma.fitnessAgentAction.deleteMany({where:{userId:f.userId}});
    fitnessAgentDeps.extractFoodSubstitutionIntent=async()=>({isFoodSubstitutionRequest:true,currentFoodMention:"chicken",desiredFoodMention:"fish",mealHint:null});
    fitnessAgentDeps.tools.substituteMealItem=async()=>{sub++;return {status:"APPLIED",message:"independent substitution"} as any;};
    assert.equal((await fitnessAgent.tryTurn("tôi muốn ăn cá hồi thay ức gà",f.identity,f.sessionId))?.answer,"independent substitution");
    assert.equal(sub,1);assert.equal(llm,0);assert.equal(profileReads,0);
  }finally{llmRouteDeps.llmRoute=saved.llm;fitnessAgentDeps.extractMealLogIntent=saved.meal;fitnessAgentDeps.extractFoodSubstitutionIntent=saved.sub;fitnessAgentDeps.tools.searchFood=saved.food;fitnessAgentDeps.tools.substituteMealItem=saved.subTool;fitnessAgentDeps.tools.getUserFitnessContext=saved.context;await f.clean();}
});
