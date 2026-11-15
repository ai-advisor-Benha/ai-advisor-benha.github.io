import test from 'node:test';
import assert from 'node:assert/strict';

test('actual Edge entry verifies Auth and profile RLS, uses no privileged key, and pseudonymizes quota identity',async()=>{
  const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
  let handler;let confirmed=true,role='student',anonymous=false,authOK=true;
  const calls=[];
  const env={SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'public-test-key',BYLAW_GATEWAY_URL:'https://model.example.invalid/infer',BYLAW_GATEWAY_SECRET:'test-secret-'.repeat(4)};
  globalThis.Deno={env:{get:key=>env[key]},serve:h=>{handler=h;}};
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'private-user-id',email_confirmed_at:confirmed?'2026-01-01':null,is_anonymous:anonymous},{status:authOK?200:401});
    if(url.includes('/rest/v1/advisor_profiles'))return Response.json([{role}]);
    if(url===env.BYLAW_GATEWAY_URL)return Response.json({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'lookup_rule',arguments:'{"topic":"registration"}'}}]}}]});
    throw Error('Unexpected network request');
  };
  try{
    await import('../supabase/functions/bylaw-assistant/index.ts');
    const run=()=>handler(new Request('https://edge.example.invalid',{method:'POST',headers:{authorization:'Bearer verified-test-jwt'},body:JSON.stringify({question:'Registration rules?',language:'en',context:{program:'CS',term:'Fall',hasTranscript:false}})}));
    for(const r of ['student','advisor','admin']){role=r;calls.length=0;assert.equal((await run()).status,200);
      assert.equal(calls[0].options.headers.Authorization,'Bearer verified-test-jwt');
      assert.equal(calls[1].options.headers.Authorization,'Bearer verified-test-jwt');
      assert.match(calls[1].url,/select=role/);
      const inference=calls[2];assert.match(JSON.parse(inference.options.body).subject,/^[a-f0-9]{64}$/);
      assert.ok(!inference.options.body.includes('private-user-id'));assert.ok(!inference.options.body.includes('verified-test-jwt'));
    }
    for(const scenario of ['unconfirmed','anonymous','expired','wrong-role']){
      confirmed=scenario!=='unconfirmed';anonymous=scenario==='anonymous';authOK=scenario!=='expired';role=scenario==='wrong-role'?'visitor':'student';calls.length=0;
      assert.equal((await run()).status,scenario==='wrong-role'?403:401);
      assert.ok(!calls.some(c=>c.url===env.BYLAW_GATEWAY_URL));
    }
  }finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;}
});
