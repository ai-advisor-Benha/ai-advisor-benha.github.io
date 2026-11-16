// No secrets, no network: measures real request construction with mocked explanation.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {engine} from '../tests/fixtures/academic-engine.mjs';
import {createHandler} from '../supabase/functions/bylaw-assistant/handler.mjs';
const e=engine(),P=globalThis.BylawProtocol;
for(const [language,question] of [['en','What is my maximum Spring credit limit?'],['ar','كم ساعة يمكنني تسجيلها في الربيع؟']]){
  let calls=0,inputBytes=0;
  const handler=createHandler({authenticate:async()=>({id:'synthetic',role:'student'}),infer:async payload=>{
    calls++;inputBytes+=Buffer.byteLength(JSON.stringify(payload),'utf8');
    assert.ok(!payload.tools);const data=JSON.parse(payload.messages[1].content),credit=data.academic_evidence.find(x=>x.name==='credit_limit').result;
    assert.equal(credit.max_hours,e.run('credit_limit').max_hours);assert.equal(credit.article,e.run('credit_limit').article);
    const text=language==='ar'?`الحد ${credit.max_hours} ساعة وفق ${credit.article}. راجع المرشد.`:`The maximum is ${credit.max_hours} hours under ${credit.article}. Consult your advisor.`;
    return {choices:[{finish_reason:'stop',message:{content:text}}]};
  }});
  const c={window:{},BylawProtocol:P,DOMException,AbortSignal,AbortController};vm.createContext(c);vm.runInContext(readFileSync(new URL('../bylaw-assistant.js',import.meta.url),'utf8'),c);
  const result=await c.window.BylawAssistant.ask({question,language,context:{program:e.run('get_student_record').program,term:'Spring',hasTranscript:true},tools:P.tools.map(t=>({name:t.function.name,execute:i=>e.run(t.function.name,i)})),signal:new AbortController().signal,invoke:async body=>{
    const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)}));assert.equal(r.status,200);return r.json();
  }});
  assert.equal(calls,1);assert.match(result.text,/18/);assert.match(result.text,/Art\. 9-c/);
  console.log(JSON.stringify({mode:'offline_mock_NOT_live_Groq',language,model_calls:calls,request_utf8_bytes:inputBytes,estimated_input_tokens:Math.ceil(inputBytes/3),tool_calls:result.records.map(r=>r.name),correct_max_hours:18,correct_article:'Art. 9-c'}));
}
