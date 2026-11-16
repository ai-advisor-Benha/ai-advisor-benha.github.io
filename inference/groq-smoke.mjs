// Explicit opt-in live test. Run only with an owner-confirmed FREE Groq account.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {engine} from '../tests/fixtures/academic-engine.mjs';
import {createHandler} from '../supabase/functions/bylaw-assistant/handler.mjs';
import {benchmarkCases,verifyBenchmark} from './benchmark-cases.mjs';
if(!process.argv.includes('--live')||process.env.LIVE_GROQ_FREE_TIER_CONFIRMED!=='true'){
  console.error('No request sent. Requires --live and LIVE_GROQ_FREE_TIER_CONFIRMED=true after verifying the Groq account is Free.');process.exit(1);
}
const secret=process.env.GATEWAY_SECRET;
assert.ok(secret&&secret.length>=32,'Configure GATEWAY_SECRET in the private environment file');
const endpoint=new URL(process.env.LOCAL_GATEWAY_URL||'http://127.0.0.1:8787/infer');
assert.ok(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&endpoint.pathname==='/infer'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'Use the local gateway only');
const e=engine(),P=globalThis.BylawProtocol;
let metrics=[],gatewayRequests=0;
const handler=createHandler({authenticate:async()=>({id:'synthetic-test-only',role:'student'}),infer:async payload=>{
  // Production queue now owns pacing and bounded retries; no artificial benchmark waits.
  if(++gatewayRequests>12)throw {code:'benchmark_budget',status:429};
  const started=performance.now();
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({subject:'f'.repeat(64),payload}),signal:AbortSignal.timeout(65000)});
  const data=await r.json().catch(()=>({}));
  const usage={};for(const field of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isFinite(data.usage?.[field]))usage[field]=data.usage[field];
  metrics.push({status:r.status,elapsed_ms:Math.round(performance.now()-started),usage,provider_attempts:Number.isInteger(data.gateway_meta?.provider_attempts)?data.gateway_meta.provider_attempts:undefined,requested_tools:data.choices?.[0]?.message?.tool_calls?.map(t=>t.function?.name)});
  console.log(JSON.stringify({event:'inference_call',...metrics.at(-1)}));
  if(!r.ok)throw {code:r.status===429?'rate_limited':r.status===504?'timeout':'unavailable',status:r.status,retryAfter:Number(r.headers.get('retry-after'))||undefined};return data;
}});
const c={window:{},BylawProtocol:P,DOMException,AbortSignal};vm.createContext(c);vm.runInContext(readFileSync(new URL('../bylaw-assistant.js',import.meta.url),'utf8'),c);
const selectedLanguage=process.argv.find(arg=>arg.startsWith('--language='))?.split('=')[1];
assert.ok(!selectedLanguage||['en','ar'].includes(selectedLanguage),'Optional --language must be en or ar');
const academic=process.argv.includes('--suite=academic'),selectedCase=process.argv.find(arg=>arg.startsWith('--case='))?.split('=')[1];
assert.ok(!selectedCase||benchmarkCases.some(c=>c.id===selectedCase),'Unknown benchmark case');
for(const item of benchmarkCases.filter(c=>(selectedCase?c.id===selectedCase:academic||c.topic==='credits')&&(!selectedLanguage||c.language===selectedLanguage))){
  const {language,question,id}=item;
  metrics=[];const started=performance.now();
  try{
    const answer=await c.window.BylawAssistant.ask({question,language,context:{program:e.run('get_student_record').program,term:'Spring',hasTranscript:true},signal:new AbortController().signal,
      tools:P.tools.map(t=>({name:t.function.name,execute:input=>e.run(t.function.name,input)})),invoke:async body=>{
        const r=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{authorization:'Bearer synthetic-local-test'},body:JSON.stringify(body)}));const data=await r.json();if(!r.ok)throw data;return data;
      }});
    const expected=verifyBenchmark(item,answer,e);
    console.log(JSON.stringify({id,language,elapsed_ms:Math.round(performance.now()-started),calls:metrics,checks:'required tool, expected facts and article verified; human semantic review still required',tools:answer.records.map(r=>r.name),expected,answer:answer.text}));
  }catch(error){console.error(JSON.stringify({id,language,elapsed_ms:Math.round(performance.now()-started),calls:metrics,code:error.code||'acceptance_failed',retryAfter:error.retryAfter,detail:error.code?undefined:error.message}));process.exitCode=1;break;}
}
