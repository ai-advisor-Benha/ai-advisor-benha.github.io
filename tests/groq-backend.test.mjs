import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createGateway,createQuota} from '../inference/gateway.mjs';
import {providerConfig,GROQ_URL} from '../inference/providers.mjs';
import {createHandler} from '../supabase/functions/bylaw-assistant/handler.mjs';
import {engine} from './fixtures/academic-engine.mjs';
const secret='synthetic-gateway-'.repeat(3),key='synthetic-provider-key',subject='a'.repeat(64);
const config={secret,provider:'groq',allowRemote:true,upstreamKey:key,quota:{take:()=>true}};
const completion=text=>({choices:[{finish_reason:'stop',message:{content:text}}]});
const call=name=>({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name,arguments:'{}'}}]}}]});
const payload={messages:[{role:'system',content:'rules'},{role:'user',content:'question'}]};
async function serve(options,run){
  const server=createGateway({...config,...options});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=(body=payload,token=secret)=>fetch(`http://127.0.0.1:${server.address().port}/infer`,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({subject,payload:body})});
  try{await run(send);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('Groq adapter pins endpoint, requires opt-in/key and excludes llama.cpp settings',()=>{
  for(const bad of [{allowRemote:false},{upstreamKey:''},{upstream:GROQ_URL+'?secret=x'},{upstream:'https://evil.invalid/openai/v1/chat/completions'},{provider:'unknown'}])assert.throws(()=>providerConfig({...config,...bad}));
  const adapter=providerConfig(config),body=adapter.body({...payload,model:'attacker',chat_template_kwargs:{enable_thinking:true}});
  assert.equal(adapter.url.href,GROQ_URL);assert.equal(body.model,'qwen/qwen3.8-27b');assert.equal(body.reasoning_effort,'none');assert.equal(body.max_completion_tokens,1200);
  assert.ok(!('chat_template_kwargs' in body));assert.ok(!('max_tokens' in body));
});
test('persistent token reservations reject oversized calls and share budget across users',()=>{
  const q=createQuota(':memory:',{tokensPerMinute:100,tokensPerDay:150});
  try{assert.equal(q.take('a',101),false);assert.equal(q.take('a',60),true);assert.equal(q.take('b',41),false);assert.equal(q.take('b',40),true);}finally{q.close();}
});
test('Groq gateway authenticates, strips identities and sends provider key only upstream',async()=>{
  let captured,count=0;
  await serve({fetchImpl:async(url,options)=>{count++;assert.equal(url.href,GROQ_URL);captured=options;return Response.json(completion('ready'));}},async send=>{
    assert.equal((await send(payload,'wrong')).status,401);assert.equal(count,0);
    assert.equal((await send()).status,200);assert.equal(captured.headers.Authorization,'Bearer '+key);
    assert.ok(!captured.body.includes(subject));assert.ok(!captured.body.includes(secret));assert.ok(!captured.body.includes(key));
  });
});
for(const [name,fetchImpl,status,code] of [
  ['rate limit',async()=>new Response('PRIVATE',{status:429}),429,'rate_limited'],
  ['outage',async()=>new Response('PRIVATE',{status:503}),503,'unavailable'],
  ['bad credential',async()=>new Response('PRIVATE',{status:401}),503,'unavailable'],
  ['network failure',async()=>{throw Error('PRIVATE');},503,'unavailable'],
  ['timeout',async()=>{throw new DOMException('PRIVATE','TimeoutError');},504,'timeout'],
  ['invalid JSON',async()=>new Response('PRIVATE'),503,'unavailable'],
  ['invalid completion',async()=>Response.json({choices:[]}),502,'unavailable'],
  ['truncated answer',async()=>Response.json({choices:[{finish_reason:'length',message:{content:'18'}}]}),502,'unavailable'],
  ['oversized response',async()=>new Response('x'.repeat(65000)),502,'unavailable']
])test(`Groq ${name} fails safely`,async()=>serve({fetchImpl},async send=>{
  const r=await send();assert.equal(r.status,status);assert.deepEqual(await r.json(),{code,...(status===429?{retryAfter:60}:{})});
}));
test('busy gateway rejects another call without invoking provider',async()=>{
  let unblock,started;const ready=new Promise(resolve=>{started=resolve;});
  await serve({maxConcurrent:1,maxPending:0,fetchImpl:async()=>{started();await new Promise(resolve=>{unblock=resolve;});return Response.json(completion('ready'));}},async send=>{
    const first=send();await ready;assert.equal((await send()).status,429);unblock();assert.equal((await first).status,200);
  });
});
for(const [language,question] of [['en','What is my credit limit?'],['ar','كم ساعة يمكنني تسجيلها؟']])test(`${language}: Groq contract → Edge handler → actual synthetic academic engine → cited answer`,async(t)=>{
  const e=engine();let count=0;
  const quota=createQuota(':memory:',{tokensPerMinute:8000,tokensPerDay:200000});t.after(()=>quota.close());
  await serve({quota,fetchImpl:async(url,options)=>{
    const sent=JSON.parse(options.body),data=JSON.parse(sent.messages[1].content);count++;
    assert.ok(!options.body.includes('Private Student'));assert.ok(!options.body.includes('12345678901234'));
    if(!data.academic_evidence.length)return Response.json(call('credit_limit'));
    const evidence=data.academic_evidence[0].result;
    assert.equal(evidence.max_hours,e.run('credit_limit').max_hours);assert.equal(evidence.article,e.run('credit_limit').article);
    return Response.json(completion(language==='ar'?`الحد ${evidence.max_hours} ساعة وفق ${evidence.article}. راجع المرشد.`:`The limit is ${evidence.max_hours} hours under ${evidence.article}. Consult your advisor.`));
  }},async send=>{
    const handler=createHandler({authenticate:async()=>({id:'synthetic',role:'student'}),infer:async body=>{const r=await send(body);return r.json();}});
    const c={window:{},BylawProtocol,DOMException,AbortSignal};vm.createContext(c);vm.runInContext(readFileSync(new URL('../bylaw-assistant.js',import.meta.url),'utf8'),c);
    const result=await c.window.BylawAssistant.ask({question,language,context:{program:'CS',term:'Spring',hasTranscript:true},tools:['credit_limit','get_student_record'].map(name=>({name,execute:i=>e.run(name,i)})),signal:new AbortController().signal,
      invoke:async body=>{const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)}));assert.equal(r.status,200);return r.json();}});
    assert.match(result.text,/18/);assert.ok(result.text.includes(e.run('credit_limit').article));assert.equal(count,1);
  });
});
