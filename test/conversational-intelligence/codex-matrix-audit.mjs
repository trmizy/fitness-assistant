import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const path='test/conversational-intelligence/x4-confirmation-matrix.mjs';
const source=fs.readFileSync(path,'utf8');
const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let claim,expectation,failed;
function visit(n){
 if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='CLAIM')claim=n.initializer.getText(tree);
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='expectationFor')expectation=n.getText(tree);
 if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='expectationFailed'&&!failed)failed=n.initializer.getText(tree);
 ts.forEachChild(n,visit);
}
visit(tree);
const get=vm.runInNewContext(`const CLAIM=${claim}; ${expectation}; expectationFor`);
const examples=[
 ['S7','U6',false,'Chưa có thay đổi nào được lưu',true],
 ['S7','U6',false,'Rồi — thao tác gần nhất đã được xác nhận và lưu.',false],
 ['S1','U1',true,'Đã cập nhật hồ sơ',false],
 ['S1','U1',false,'Đã cập nhật hồ sơ',true],
 ['S0','U1',false,'Đã lưu thành công!',true],
];
const checked=examples.map(([state,id,wrote,answer,shouldFail])=>{
 const result=!!vm.runInNewContext(failed,{exp:get(state,id),wrote,r:{answer}});
 assert.equal(result,shouldFail);return {state,id,wrote,answer,rejected:result};
});
const exitStatement=[...tree.statements].reverse().find(ts.isIfStatement).getText(tree);
const exitCodes=[];
for(const field of ['bad','failedExpectations','errors','setupFailed']){
 const child=spawnSync(process.execPath,['-e',`let bad=0,failedExpectations=0,errors=0,setupFailed=0;${field}=1;${exitStatement}`]);
 assert.equal(child.status,1);exitCodes.push({field,exit:child.status});
}
const result={checked,exitCodes,knowledgeExpectation:get('S0','U7-knowledge'),emptyS0Rejected:!!vm.runInNewContext(failed,{exp:get('S0','U1'),wrote:false,r:{answer:''}})};
fs.writeFileSync('test/conversational-intelligence/results/codex-final-followup/matrix-harness-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
