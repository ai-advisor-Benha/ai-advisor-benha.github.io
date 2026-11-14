import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Authenticated academic advisor decision notifications. Never put the Brevo key in browser JavaScript.
const SITE='https://ai-advisor-benha.github.io/';
const OWNER='mfibmm1@gmail.com';
const TABLE='advisor_decision_email_log';
function reply(status:number, body:Record<string,unknown>):Response {
  return new Response(JSON.stringify(body),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'access-control-allow-origin':SITE.slice(0,-1),
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'authorization, apikey, x-client-info, content-type'
  }});
}
function fail(message:string,status=400):never {throw {message,status};}
function escapeHTML(x:string):string{return x.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));}
async function digest(s:string):Promise<string>{
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 return [...a].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function secretKey():string{
 const old=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(old)return old;
 try{return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'';}catch{return '';}
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return reply(200,{ok:true});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 const match=/^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization')||'');
 if(!match)return reply(401,{error:'Sign in as advisor or administrator first.'});
 const url=Deno.env.get('SUPABASE_URL')||'';
 const key=secretKey(),brevo=Deno.env.get('BREVO_API_KEY')||'';
 const from=Deno.env.get('BREVO_SENDER_EMAIL')||'';
 if(!url||!key||!brevo||!from)return reply(503,{error:'Configure BREVO_API_KEY and BREVO_SENDER_EMAIL in Supabase Edge Function Secrets.'});
 const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
   const auth=await sb.auth.getUser(match[1]);
   const user=auth.data.user;
   if(auth.error||!user)fail('Your login session has expired.',401);
   const {data:actor,error:actorErr}=await sb.from('advisor_profiles').select('id,email,role').eq('id',user.id).maybeSingle();
   if(actorErr)fail('Unable to verify advisor account.',503);
   if(!actor||!['advisor','admin'].includes(actor.role))fail('Advisor or administrator role required.',403);
   const raw=await req.text();
   if(raw.length>15000)fail('Request too large.',413);
   const body=JSON.parse(raw);
   const r=body?.request, decision=body?.decision, comment=String(body?.comment||'').trim();
   if(!r||!['approved','changes'].includes(decision)||comment.length>1800)fail('Invalid decision or comment.');
   if(decision==='changes'&&!comment)fail('Enter a comment explaining the required changes.');
   if(r.type!=='ai-academic-advisor/request'||r.version!==1)fail('Invalid academic advisor request.');
   const email=String(r.email||'').trim().toLowerCase();
   const sid=String(r.studentId||''), term=String(r.term||'');
   const program=String(r.program||''),university=String(r.university||''),fp=String(r.fingerprint||'');
   const plan=r.plan;
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{4,14}$/.test(sid)||
     !/^[0-9a-f]{16}$/.test(fp)||!/^[a-zA-Z0-9_-]{1,64}$/.test(program)||
     !/^[a-zA-Z0-9_-]{1,64}$/.test(university)||!/^[a-zA-Z0-9 _-]{1,40}$/.test(term)||
     !Array.isArray(plan)||!plan.length||plan.length>25||
     plan.some((c:unknown)=>typeof c!=='string'||!/^[a-zA-Z0-9_-]{2,20}$/.test(c))||
     new Set(plan).size!==plan.length)fail('Invalid plan, ID or recipient.');
   const expected=(await digest(JSON.stringify([sid,term,[...plan].sort(),program,university]))).slice(0,16);
   if(expected!==fp)fail('Plan fingerprint mismatch. Load an unchanged student request.');
   // Never send to an arbitrary address read from an uploaded JSON document.
   const {data:recipient,error:recErr}=await sb.from('advisor_profiles')
     .select('id,email,sid,role').eq('email',email).maybeSingle();
   if(recErr)fail('Unable to look up registered student.',503);
   if(!recipient)fail('Student email is not registered in the system.',404);
   const demo=r.demo===true;
   const actorEmail=String(actor.email||'').toLowerCase();
   if(demo){
     if(actor.role!=='admin'||actorEmail!==OWNER||email!==OWNER||recipient.id!==actor.id)
       fail('Demo email is restricted to the designated administrator account.',403);
   }else if(recipient.role!=='student'||String(recipient.sid)!==sid){
     fail('Student email and registered student ID do not match.',403);
   }
   const verified=await sb.auth.admin.getUserById(recipient.id);
   if(verified.error||!verified.data.user?.email_confirmed_at)fail('Recipient email is not verified.',403);
   const contentHash=await digest(JSON.stringify([decision,comment,plan]));
   const q=sb.from(TABLE).select('id,status,created_at').eq('advisor_id',actor.id)
     .eq('recipient_id',recipient.id).eq('fingerprint',fp).eq('content_hash',contentHash);
   const prev=await q.maybeSingle();
   if(prev.error)fail('Create the advisor_decision_email_log database table before sending.',503);
   if(prev.data?.status==='sent')return reply(200,{ok:true,recipient:email,duplicate:true});
   if(prev.data?.status==='pending')fail('Email already being processed; do not resend.',409);
   if(prev.data?.status==='failed'){
     const reset=await sb.from(TABLE).update({status:'pending',error_message:null}).eq('id',prev.data.id).eq('status','failed');
     if(reset.error)fail('Cannot retry the email.',503);
   }else{
     const since=new Date(Date.now()-24*3600*1000).toISOString();
     const usage=await sb.from(TABLE).select('id',{count:'exact',head:true})
       .eq('advisor_id',actor.id).gte('created_at',since);
     if(usage.error)fail('Could not check notification sending limit.',503);
     if((usage.count||0)>=30)fail('Daily email limit reached (30 messages).',429);
     const ins=await sb.from(TABLE).insert({advisor_id:actor.id,recipient_id:recipient.id,
       recipient_email:email,fingerprint:fp,content_hash:contentHash,
       decision,demo,status:'pending'});
     if(ins.error)fail('Duplicate notification may already be processing.',409);
   }
   const title=decision==='approved'?'Study plan approved':'Changes required for study plan';
   const subject=(demo?'[DEMO] ':'')+'AI Academic Advisor — '+title;
   const safe=comment?escapeHTML(comment).replace(/\r?\n/g,'<br>'):'No additional comment.';
   const html='<div style="font:15px/1.6 Arial,sans-serif;max-width:600px;margin:auto;color:#17243a">'
     +'<h2>AI Academic Advisor — Benha University</h2>'
     +(demo?'<p><strong>DEMONSTRATION ONLY — no real student data was changed.</strong></p>':'')
     +'<p>Your advisor reviewed the plan for <strong>'+escapeHTML(term)+'</strong>.</p>'
     +'<p><strong>Decision:</strong> '+title+'</p>'
     +'<p><strong>Courses:</strong> '+plan.map(escapeHTML).join(', ')+'</p>'
     +'<p><strong>Advisor comment:</strong></p><div dir="auto" style="background:#f2f6fb;padding:12px">'
     +safe+'</div><p>Visit <a href="'+SITE+'">AI Academic Advisor</a> to review the plan.</p>'
     +'<p style="font-size:12px;color:#667">This is an academic advising notification, not confirmation of official university SIS registration.</p></div>';
   let resp:Response;
   try{
     resp=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{
       'api-key':brevo,'accept':'application/json','content-type':'application/json'},
       body:JSON.stringify({sender:{name:'AI Academic Advisor – Benha University',email:from},
         to:[{email}],subject,htmlContent:html})});
   }catch{
     await sb.from(TABLE).update({status:'failed',error_message:'Network error contacting Brevo'})
       .eq('advisor_id',actor.id).eq('recipient_id',recipient.id).eq('fingerprint',fp).eq('content_hash',contentHash);
     fail('Brevo could not be reached. Please retry.',502);
   }
   const result=await resp.json().catch(()=>({}));
   if(!resp.ok||!result.messageId){
     await sb.from(TABLE).update({status:'failed',error_message:'Brevo HTTP '+resp.status})
       .eq('advisor_id',actor.id).eq('recipient_id',recipient.id).eq('fingerprint',fp).eq('content_hash',contentHash);
     fail('Brevo rejected this email. Check your transactional logs and verified sender.',502);
   }
   await sb.from(TABLE).update({status:'sent',sent_at:new Date().toISOString(),message_id:result.messageId})
     .eq('advisor_id',actor.id).eq('recipient_id',recipient.id).eq('fingerprint',fp).eq('content_hash',contentHash);
   return reply(200,{ok:true,recipient:email,duplicate:false});
 }catch(e){
   const x=e as {message?:string,status?:number};
   return reply(x.status||500,{error:x.status?x.message:'Notification error; see Supabase Edge Function logs.'});
 }
});
