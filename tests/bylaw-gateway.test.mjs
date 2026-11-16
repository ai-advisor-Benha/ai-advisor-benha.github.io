import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQuota,createGateway} from '../inference/gateway.mjs';
const secret='test-only-'.repeat(5),subject='a'.repeat(64);
test('durable atomic minute/day/global quotas persist across gateway restarts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bylaw-quota-'));const path=join(dir,'quota.sqlite');let now=0;
  try{
    let q=createQuota(path,{perMinute:2,perDay:3,globalPerDay:4,now:()=>now});
    assert.equal(q.take(subject),true);assert.equal(q.take(subject),true);assert.equal(q.take(subject),false);q.close();
    q=createQuota(path,{perMinute:2,perDay:3,globalPerDay:4,now:()=>now});assert.equal(q.take(subject),false);
    now=60001;assert.equal(q.take(subject),true);assert.equal(q.take(subject),false);
    assert.equal(q.take('b'),true);assert.equal(q.take('c'),false);
    now=86400001;assert.equal(q.take(subject),true);q.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('gateway defaults reject remote/paid endpoints and weak secrets',()=>{
  const cfg={secret,model:'test-model',quota:{take:()=>true}};
  assert.throws(()=>createGateway({...cfg,upstream:'https://paid.example/v1/chat/completions'}));
  assert.throws(()=>createGateway({...cfg,secret:'weak',upstream:'http://localhost:8080/v1/chat/completions'}));
  assert.throws(()=>createGateway({...cfg,upstream:'http://localhost:8080/private'}));
});
test('gateway auth, rate limits, provider isolation and safe failures over real HTTP',async()=>{
  let calls=0,allowed=true;let captured;
  const server=createGateway({secret,upstream:'http://127.0.0.1:8080/v1/chat/completions',model:'Qwen3-8B',quota:{take:()=>allowed},fetchImpl:async(url,options)=>{calls++;captured=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:'test'}}]});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${server.address().port}/infer`;
  const send=(token=secret)=>fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({subject,payload:{messages:[{role:'system',content:'rules'},{role:'user',content:'question'}],model:'unapproved',max_tokens:999999}})});
  try{
    assert.equal((await send('wrong')).status,401);assert.equal(calls,0);
    assert.equal((await send()).status,200);assert.equal(calls,1);assert.equal(captured.model,'Qwen3-8B');assert.equal(captured.max_tokens,1200);assert.ok(!JSON.stringify(captured).includes(subject));assert.ok(!JSON.stringify(captured).includes(secret));
    allowed=false;assert.equal((await send()).status,429);assert.equal(calls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
