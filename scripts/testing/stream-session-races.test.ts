/** TEST FIXTURE: execute the actual chatStream method with deferred network responses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createSessionGuard } from '../../frontend/web/src/app/services/sessionGuard';

function deferred<T = any>() {
  let resolve!: (v:T)=>void, reject!: (e:any)=>void;
  const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
const tick = () => new Promise<void>(resolve=>setImmediate(resolve));

function fixture(kind:'web'|'mobile') {
  const path = kind==='web' ? 'frontend/web/src/app/services/api.ts' : 'frontend/mobile/src/services/api.ts';
  const ast=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
  let method:ts.MethodDeclaration|undefined;
  function walk(node:ts.Node) {
    if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='chatStream') method=node;
    ts.forEachChild(node,walk);
  }
  walk(ast);
  assert.ok(method,'production stream method found');
  const response=deferred(), refresh=deferred(), chunk=deferred();
  const guard=createSessionGuard();
  const events:any[]=[];
  let requests=0, refreshes=0, clears=0, reads=0;
  const context=vm.createContext({
    exports:{}, API_URL:'http://fixture', sessionGuard:guard, AbortController, TextDecoder,
    setTimeout, clearTimeout, window:{setTimeout,clearTimeout},
    tokenStore:{get:()=> 'A-access'}, hasUsableToken:(t:any)=>typeof t==='string'&&t.length>0,
    fetch:()=>{requests++;return response.promise;},
    streamingFetch:()=>{requests++;return response.promise;},
    refreshOnce:()=>{refreshes++;return refresh.promise;},
    clearSessionAndRedirectToLogin:async(generation:number)=>{guard.assertCurrent(generation);clears++;guard.begin();},
    aiFriendlyErrorMessage:()=> 'temporary error',
  });
  vm.runInContext(ts.transpileModule(`exports.service = { ${method.getText(ast)} };`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  const cancel=(context.exports as any).service.chatStream('hello',Object.fromEntries(['onStatus','onToken','onDone','onError'].map(k=>[k,(v:any)=>events.push([k,v])])));
  const streamResponse={status:200,ok:true,body:{getReader:()=>({read:()=>{reads++;return chunk.promise;}})}};
  return {response,refresh,chunk,guard,events,cancel,streamResponse,counts:()=>({requests,refreshes,clears,reads})};
}

for(const kind of ['web','mobile'] as const) {
  test(`${kind}: old streaming 401 cannot refresh or clear the new account`,async()=>{
    const f=fixture(kind);
    try {
      f.guard.begin();
      f.response.resolve({status:401});
      await tick();
      assert.deepEqual(f.counts(),{requests:1,refreshes:0,clears:0,reads:0});
      assert.deepEqual(f.events,[]);
    } finally {f.cancel();}
  });
  test(`${kind}: token chunk from old account is suppressed`,async()=>{
    const f=fixture(kind);
    try {
      f.response.resolve(f.streamResponse); await tick();
      assert.equal(f.counts().reads,1);
      f.guard.begin();
      f.chunk.resolve({done:false,value:new TextEncoder().encode('data: {"type":"token","content":"private A"}\n')});
      await tick();
      assert.deepEqual(f.events,[]);
    } finally {f.cancel();}
  });
  test(`${kind}: account switch during stream refresh prevents retry and logout`,async()=>{
    const f=fixture(kind);
    try {
      f.response.resolve({status:401}); await tick();
      assert.equal(f.counts().refreshes,1);
      f.guard.begin(); f.refresh.resolve('A-new'); await tick();
      assert.equal(f.counts().requests,1);
      assert.equal(f.counts().clears,0);
      assert.deepEqual(f.events,[]);
    } finally {f.cancel();}
  });
  test(`${kind}: transient stream refresh failure preserves the session`,async()=>{
    const f=fixture(kind);
    try {
      f.response.resolve({status:401}); await tick();
      f.refresh.reject(new Error('429 refresh unavailable')); await tick();
      assert.equal(f.counts().clears,0);
      assert.equal(f.guard.current(),0);
      assert.equal(f.events[0]?.[0],'onError');
    } finally {f.cancel();}
  });
}
