// Sends a minimal NEW academic-plan request notification to the ASSIGNED
// academic advisor only. The online inbox is authoritative; mail is optional.
// Deploy separately to Supabase; never expose Brevo/service-role secrets in JS.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT_SITE = 'https://ai-advisor-benha.github.io/';
const allowedOrigins = new Set([
  new URL(PROJECT_SITE).origin,
  ...(Deno.env.get('ALLOWED_WEB_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean)
]);
const emailLog = 'advisor_request_notice_log';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safe = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
function reply(request:Request,status:number,value:Record<string,unknown>) {
  const origin = request.headers.get('origin') || '';
  return new Response(JSON.stringify(value),{status,headers:{
    'content-type':'application/json;charset=utf-8',
    'vary':'origin',
    ...(allowedOrigins.has(origin) ? {'access-control-allow-origin':origin} : {}),
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'authorization, apikey, x-client-info, content-type'
  }});
}
function fromEnvJson(name:string) {
  try { const v = JSON.parse(Deno.env.get(name) || '{}'); return typeof v.default==='string' ? v.default : ''; }
  catch { return ''; }
}
function fail(message:string,status=400):never { throw {status,message}; }

Deno.serve(async(request:Request) => {
  if (request.method === 'OPTIONS') return reply(request,200,{ok:true});
  if (request.method !== 'POST') return reply(request,405,{error:'POST required'});
  if (!allowedOrigins.has(request.headers.get('origin')||'') && request.headers.has('origin'))
    return reply(request,403,{error:'Unknown website origin.'});
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')||'')?.[1];
  if (!token) return reply(request,401,{error:'Student login required.'});
  const url = Deno.env.get('SUPABASE_URL')||'';
  const publicKey = fromEnvJson('SUPABASE_PUBLISHABLE_KEYS')||Deno.env.get('SUPABASE_ANON_KEY')||'';
  const privateKey = fromEnvJson('SUPABASE_SECRET_KEYS')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const brevoKey = Deno.env.get('BREVO_API_KEY')||'';
  const sender = Deno.env.get('BREVO_SENDER_EMAIL')||'';
  if (!url||!publicKey||!privateKey||!brevoKey||!sender)
    return reply(request,503,{error:'Advisor email service is not configured.'});
  const actorClient=createClient(url,publicKey,{global:{headers:{Authorization:'Bearer '+token}},
    auth:{persistSession:false,autoRefreshToken:false}});
  const trusted=createClient(url,privateKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const userResponse=await actorClient.auth.getUser(token);
    const actor=userResponse.data.user;
    if (userResponse.error||!actor) fail('Your session has expired.',401);
    const {data:profile,error:profileError}=await actorClient.from('advisor_profiles')
      .select('role').eq('id',actor.id).maybeSingle();
    if(profileError||profile?.role!=='student')fail('Only authenticated students can request new-plan notifications.',403);

    const input=await request.text();
    if (input.length>500)fail('Invalid request.',413);
    const body=JSON.parse(input);
    if (!uuid.test(String(body?.requestId||''))) fail('Invalid request identifier.');
    const {data:plan,error:readError}=await trusted.from('advisor_plan_requests')
      .select('id,student_id,advisor_id,student_name,term,program,status')
      .eq('id',body.requestId).eq('student_id',actor.id).maybeSingle();
    if (readError)fail('Could not read saved plan.',503);
    if (!plan)fail('Your online request was not found.',404);
    if (plan.status !== 'pending')
      fail('This request has already been reviewed. Its decision is available in the online dashboard.',409);
    const assignment=await trusted.from('advisor_student_assignments')
      .select('advisor_id').eq('student_id',actor.id).maybeSingle();
    if (assignment.error||assignment.data?.advisor_id!==plan.advisor_id)
      fail('The academic advisor assignment has changed. Ask an administrator.',403);
    const advisorProfile=await trusted.from('advisor_profiles')
      .select('id,email,role').eq('id',plan.advisor_id).maybeSingle();
    if (advisorProfile.error||!advisorProfile.data||
        !['advisor','admin'].includes(advisorProfile.data.role))
      fail('Assigned academic advisor could not be verified.',403);
    const verified=await trusted.auth.admin.getUserById(advisorProfile.data.id);
    if (verified.error||!verified.data.user?.email_confirmed_at)
      fail('Academic advisor email is not verified.',403);

    const prev=await trusted.from(emailLog).select('status,attempts,created_at')
      .eq('request_id',plan.id).maybeSingle();
    if (prev.error)fail('Notification log is unavailable.',503);
    if (prev.data?.status==='sent') return reply(request,200,{ok:true,duplicate:true});
    if (prev.data?.attempts>=3) fail('Notification retry limit reached; the request is still visible online.',429);
    if (prev.data?.status==='pending' &&
        Date.now()-new Date(prev.data.created_at).getTime()<10*60*1000)
      return reply(request,200,{ok:true,duplicate:true,processing:true});
    // Rate limit new email notifications per student independent of inbox submissions.
    const since=new Date(Date.now()-24*60*60*1000).toISOString();
    const usage=await trusted.from(emailLog).select('request_id',{count:'exact',head:true})
      .eq('student_id',actor.id).gte('created_at',since);
    if (usage.error) fail('Notification rate limit unavailable.',503);
    if ((usage.count||0)>=10 && !prev.data)
      fail('Daily request-email limit reached; the request is still visible online.',429);

    if (prev.data) {
      const update=await trusted.from(emailLog)
        .update({status:'pending',attempts:prev.data.attempts+1,error_message:null})
        .eq('request_id',plan.id).eq('status',prev.data.status)
        .eq('attempts',prev.data.attempts).select('request_id').maybeSingle();
      if(update.error)fail('Could not retry advisor notification.',503);
      if(!update.data)return reply(request,200,{ok:true,processing:true});
    } else {
      const insert=await trusted.from(emailLog).insert({
        request_id:plan.id,student_id:actor.id,advisor_id:plan.advisor_id,
        status:'pending',attempts:1
      });
      if(insert.error)return reply(request,200,{ok:true,processing:true});
    }

    const displayName=safe(String(plan.student_name||'Student').slice(0,120));
    const term=safe(String(plan.term||'').slice(0,40));
    const program=safe(String(plan.program||'').slice(0,64));
    const html='<div style="font:15px/1.6 Arial,sans-serif;max-width:580px;margin:auto;color:#17243a">'
      +'<h2>AI Academic Advisor — Benha University</h2>'
      +'<p>A new academic approval request is waiting in your advisor dashboard.</p>'
      +'<p><strong>Student:</strong> '+displayName+'</p>'
      +'<p><strong>Program:</strong> '+program+'<br><strong>Semester:</strong> '+term+'</p>'
      +'<p><a href="'+PROJECT_SITE+'">Sign in to review the request</a>.</p>'
      +'<p style="font-size:12px;color:#667">The academic record is available only after signing in. This email contains no grades, student ID, or transcript.</p></div>';
    let response:Response;
    try {
      response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',
        headers:{'api-key':brevoKey,'accept':'application/json','content-type':'application/json'},
        body:JSON.stringify({sender:{name:'AI Academic Advisor – Benha University',email:sender},
          to:[{email:advisorProfile.data.email}],subject:'New student academic plan awaiting your approval',
          htmlContent:html})});
    } catch {
      await trusted.from(emailLog).update({status:'failed',error_message:'Brevo network error'})
        .eq('request_id',plan.id);
      fail('Advisor email service could not be reached; request was saved online.',502);
    }
    const result=await response.json().catch(()=>({}));
    if (!response.ok||!result.messageId) {
      await trusted.from(emailLog)
        .update({status:'failed',error_message:'Brevo HTTP '+response.status})
        .eq('request_id',plan.id);
      fail('Advisor email was rejected; request was saved online.',502);
    }
    await trusted.from(emailLog).update({status:'sent',message_id:result.messageId,sent_at:new Date().toISOString()})
      .eq('request_id',plan.id);
    return reply(request,200,{ok:true});
  }catch(e) {
    const x=e as {status?:number,message?:string};
    return reply(request,x.status||500,{error:x.status?x.message:'Request email failed; check Supabase logs.'});
  }
});
