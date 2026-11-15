// Run: node --test tests/advisor-inbox.test.mjs
// Pure mocked-client smoke tests. These do NOT replace the live Supabase RLS/role matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../advisor-inbox.js', import.meta.url), 'utf8');

function app(role, {
  actualRole = role, rows = [], rpcError = null, advisorReview = null, assigned = true, notifyError = null,
  preflightStatus = 'verified'
} = {}) {
  const elements = new Map();
  const calls = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML:'', textContent:'', style:{},
      classList:{add(){},remove(){}},
      querySelectorAll(){return[]},
      scrollIntoView(){}
    });
    return elements.get(id);
  };
  const S = {
    session:{role,actualRole,authUserId:'user-1',email:'student@example.edu',sid:'12345678901234'},
    transcript:{student:{nationalId:'12345678901234',number:'99912345',name:'طالب اختبار تجريبي كامل'}},
    analysis:null,plan:['CS101'],depId:null,advisorView:role==='advisor'
  };
  let lastTable='';
  const query = {
    select(){return this},eq(){return this},order(){return this},
    async limit(){return {data:rows,error:null}},
    async range(){return {data:rows,count:rows.length,error:null}},
    async maybeSingle(){return {data:lastTable==='advisor_student_assignments' && assigned ? {advisor_id:'advisor-1'} : null,error:null}}
  };
  const client = () => ({
    from(table){lastTable=table;calls.push(['from',table]);return query},
    functions:{async invoke(name,args){calls.push(['invoke',name,args]);return notifyError ? {error:{message:notifyError}} : {data:{ok:true},error:null}}},
    async rpc(name,args) {
      calls.push(['rpc',name,args]);
      return rpcError ? {error:{message:rpcError}} : {data:name==='advisor_check_transcript_roster' ?
        {status:preflightStatus,advisorName:'Official Test Advisor',method:'official_roster'} :
        name==='advisor_get_my_code'?'ADV-'+'A'.repeat(24):'11111111-1111-4111-8111-111111111111',error:null};
    }
  });
  const context = {
    window:{},document:{addEventListener(){}},S,client,
    $:el,esc:x=>String(x??'').replace(/[&<>"']/g,
      c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    LANG:'en',activeStudentId:()=> '12345678901234',
    planFingerprint:async()=> 'f'.repeat(16),
    renderDecision(){},renderAdvisorWS(){},
    buildRequest:async()=>request,
    requestToState(){return {rows:[],overCap:false}},
    advReview:advisorReview,
    adminAccountsCache:{},setInterval(){return 1},clearInterval(){}
  };
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'advisor-inbox.js'});
  return {api:context.window.AdvisorInbox,calls,elements,S};
}

const request={
  type:'ai-academic-advisor/request',version:1,studentId:'12345678901234',
  email:'student@example.edu',program:'cs',term:'Spring',
  fingerprint:'f'.repeat(16),studentNumber:'99912345',studentName:'طالب اختبار تجريبي كامل',plan:['CS101'],attempts:[]
};

test('student submission invokes the authenticated online RPC', async()=>{
  const x=app('student',{rows:[{term:'Spring',program:'cs',status:'pending',created_at:'2026-11-15T00:00:00Z'}]});
  assert.equal(await x.api.submit(request),true);
  assert.ok(x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_submit_verified_plan'));
  assert.match(x.elements.get('student-online-requests').innerHTML,/Request matched/);
});

test('offline or unassigned student retains the downloadable-JSON fallback message',async()=>{
  const x=app('student',{rpcError:'No academic advisor is assigned'});
  assert.equal(await x.api.submit(request),false);
  assert.match(x.elements.get('student-advisor-verification').innerHTML,/Verification could not be completed/);
});

test('owner demo account does not submit a sample transcript to the online backend',async()=>{
  const x=app('student',{actualRole:'admin'});
  assert.equal(await x.api.submit({...request,demo:true}),false);
  assert.ok(!x.calls.some(([kind])=>kind==='rpc'));
});

test('advisor inbox loads assigned rows and saves decisions through the RPC',async()=>{
  const x=app('advisor',{
    rows:[{id:'r-1',student_name:'Student Test',student_email:'student@example.edu',
      program:'cs',term:'Spring',status:'pending',created_at:'2026-11-15T00:00:00Z'}],
    advisorReview:{onlineId:'r-1',onlineStatus:'pending'}
  });
  await x.api.refreshAdvisor();
  assert.match(x.elements.get('advisor-online-inbox').innerHTML,/Student Test/);
  assert.equal(await x.api.saveDecision('r-1',{decision:'approved'}),true);
  assert.ok(x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_save_plan_decision'));
});

test('admin assignment panel exposes email-based assignment form',async()=>{
  const x=app('admin');
  await x.api.refreshAdminAssignments();
  assert.match(x.elements.get('admin-advisor-assignments').innerHTML,/Manual advisor assignment/);
  assert.match(x.elements.get('admin-advisor-assignments').innerHTML,/assign-student-email/);
});

test('new student is matched automatically without advisor email or code',async()=>{
  const x=app('student',{assigned:false});
  assert.equal(await x.api.submit(request),true);
  const item=x.calls.find(([kind,name])=>kind==='rpc'&&name==='advisor_submit_verified_plan');
  assert.ok(item);
  assert.equal(item[2].p_request.studentNumber,'99912345');
  assert.equal(item[2].p_advisor_code,undefined);
  assert.ok(!x.elements.get('student-online-requests').innerHTML.includes('student-advisor-code-form'));
  assert.ok(x.calls.some(([kind,name])=>kind==='invoke'&&name==='advisor-request-notify'));
});

test('student cannot submit without matching an approved official roster',async()=>{
  const x=app('student',{assigned:false,rpcError:'not found in any approved academic advisor roster'});
  assert.equal(await x.api.submit(request),false);
  assert.match(x.elements.get('student-advisor-verification').innerHTML,/Verification could not be completed/);
});

test('manually entered legacy code does not replace official roster matching',async()=>{
  const x=app('student',{assigned:false});
  assert.equal(await x.api.submit(request,'ADV-'+'A'.repeat(24)),true);
  assert.ok(x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_submit_verified_plan'));
  assert.ok(!x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_submit_plan'));
});

test('failed Brevo new-request email does not lose the pending online request',async()=>{
  const x=app('student',{notifyError:'Brevo unavailable'});
  assert.equal(await x.api.submit(request),true);
  assert.match(x.elements.get('student-online-requests').innerHTML,/Brevo unavailable/);
});

test('verified advisor sees their own stable routing code',async()=>{
  const x=app('advisor');
  await x.api.refreshAdvisorCode();
  assert.match(x.elements.get('advisor-online-inbox').innerHTML,/ADV-AAAAAAAAAAAAAAAAAAAAAAAA/);
  assert.ok(x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_get_my_code'));
});


test('early verification checks the registered ID, university code and full name',async()=>{
  const x=app('student');
  assert.equal(await x.api.verifyTranscript(),true);
  const check=x.calls.find(([kind,name])=>kind==='rpc'&&name==='advisor_check_transcript_roster');
  assert.ok(check);
  assert.equal(check[2].p_student_id,'12345678901234');
  assert.equal(check[2].p_student_number,'99912345');
  assert.equal(check[2].p_student_name,'طالب اختبار تجريبي كامل');
  assert.match(x.elements.get('student-advisor-verification').innerHTML,/Official Test Advisor/);
  assert.equal(x.elements.get('btn-send-ap').disabled,false);
});

test('mismatched national ID blocks the advisor check and Send for Approval button',async()=>{
  const x=app('student');
  x.S.transcript.student.nationalId='99999999999999';
  assert.equal(await x.api.verifyTranscript(),false);
  assert.match(x.elements.get('student-advisor-verification').innerHTML,/14-digit ID/);
  assert.equal(x.elements.get('btn-send-ap').disabled,true);
  assert.ok(!x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_check_transcript_roster'));
  assert.equal(await x.api.submit(request),false);
  assert.ok(!x.calls.some(([kind,name])=>kind==='rpc'&&name==='advisor_submit_verified_plan'));
});

test('a missing official roster blocks request and notification',async()=>{
  const x=app('student',{preflightStatus:'not_found'});
  assert.equal(await x.api.verifyTranscript(),false);
  assert.equal(x.elements.get('btn-send-ap').disabled,true);
  assert.match(x.elements.get('student-advisor-verification').innerHTML,/not found together/);
  assert.equal(await x.api.submit(request),false);
  assert.ok(!x.calls.some(([kind,name])=>kind==='invoke'&&name==='advisor-request-notify'));
});

test('a new transcript clears the old verification and disables the send button',async()=>{
  const x=app('student');
  assert.equal(await x.api.verifyTranscript(),true);
  x.S.transcript.student.number='99988877';
  x.api.renderVerification();
  assert.equal(x.api.isVerified(),false);
  assert.equal(x.elements.get('btn-send-ap').disabled,true);
});

test('administrator-approved exception can be verified without an official roster',async()=>{
  const x=app('student',{preflightStatus:'verified'});
  assert.equal(await x.api.verifyTranscript(),true);
  assert.equal(x.api.isVerified(),true);
});
