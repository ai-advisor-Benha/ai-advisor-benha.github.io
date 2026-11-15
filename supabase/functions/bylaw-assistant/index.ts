import { createHandler } from './handler.mjs';

// No service-role key: caller JWT + publishable key, using existing profile RLS.
const env=(key:string)=>Deno.env.get(key)||'';
function publicKey(){try{return JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS')).default||env('SUPABASE_ANON_KEY');}catch{return env('SUPABASE_ANON_KEY');}}
async function authenticate(jwt:string){
  const url=env('SUPABASE_URL'),key=publicKey();
  if(!url||!key)throw {code:'unavailable',status:503};
  const headers={apikey:key,Authorization:`Bearer ${jwt}`};
  const userResponse=await fetch(`${url}/auth/v1/user`,{headers,signal:AbortSignal.timeout(10000)});
  if(!userResponse.ok)throw {code:'unauthorized',status:401};
  const user=await userResponse.json();
  if(!user.id||!user.email_confirmed_at||user.is_anonymous)throw {code:'unauthorized',status:401};
  const profile=await fetch(`${url}/rest/v1/advisor_profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,{headers,signal:AbortSignal.timeout(10000)});
  if(!profile.ok)throw {code:'unavailable',status:503};
  const rows=await profile.json();return {id:user.id,role:rows[0]?.role};
}
async function infer(payload:unknown,userId:string,signal:AbortSignal){
  const url=env('BYLAW_GATEWAY_URL'),secret=env('BYLAW_GATEWAY_SECRET');
  if(!url||secret.length<32||/REPLACE_WITH|CHANGE_ME/i.test(secret)||new URL(url).protocol!=='https:')throw {code:'unavailable',status:503};
  // Pseudonym used ONLY by our gateway for durable quotas; never passed to the model.
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(userId));
  const subject=[...new Uint8Array(signed)].map(n=>n.toString(16).padStart(2,'0')).join('');
  let response:Response;
  try{response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json',Authorization:`Bearer ${secret}`},
    body:JSON.stringify({subject,payload}),signal:AbortSignal.any([signal,AbortSignal.timeout(55000)])});}
  catch{throw {code:'timeout',status:504};}
  if(!response.ok)throw {code:response.status===429?'rate_limited':'unavailable',status:response.status===429?429:503};
  // Bound upstream output too; raw upstream errors and credentials never reach the browser.
  const {readJSON}=await import('./handler.mjs');return readJSON(response,64000);
}
Deno.serve(createHandler({authenticate,infer,origins:['https://ai-advisor-benha.github.io',...env('BYLAW_ALLOWED_ORIGINS').split(',').map(x=>x.trim()).filter(Boolean)]}));
