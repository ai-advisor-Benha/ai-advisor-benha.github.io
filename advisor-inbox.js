/* Online advising inbox — optional until 20261115_advisor_online_inbox.sql is installed.
   Loaded before the main inline script; invoked only after login and UI initialization.
   Keep all privileges in Postgres RLS/SECURITY DEFINER, never in browser role toggles. */
(() => {
  'use strict';
  let inbox = [], requests = [], assignments = [], inboxPage = 0, inboxCount = 0;
  let advisorError = '', studentError = '', adminError = '', assignmentMessage = '';
  let busySubmit = false, refreshTimer = null, bound = false;
  let pendingCodeRequest = null, advisorCode = '', advisorCodeError = '', noticeWarning = '';
  let advisorFilter = 'all';
  const pageSize = 50;
  const dict = {
    en: {
      title: 'Requests sent to your academic advisor', refresh:'Refresh status',
      studentEmpty:'No online approval requests yet.',
      needCode:'Your academic advisor has not been linked yet. Enter the unique code provided by the advisor to send this plan.',
      codeLabel:'Academic advisor code',codePlaceholder:'ADV-XXXXXXXXXXXXXXXXXXXXXXXX',
      codeButton:'Assign my advisor & submit',codeChanged:'Your plan changed. Click Send for approval again.',
      codeIncorrect:'Please enter an advisor code in the format ADV- followed by 24 letters/numbers (A–F and 0–9).',
      notificationsFailed:'Request saved, but the advisor email notification was not sent: ',
      pendingTitle:'Pending approval',myAdvisorCode:'Your unique academic advisor code',
      myAdvisorCodeHint:'Share this code only with students assigned to you. They enter it once when submitting their first request.',
      copyCode:'Copy code',codeUnavailable:'Advisor code could not be loaded: ',
      filterLabel:'Filter requests',allFilter:'All requests', 
      sending:'Submitting to your assigned advisor…',
      sent:'Request saved in your advisor’s online inbox. Keep the downloaded JSON as backup.',
      backup:'The JSON was downloaded, but online submission did not succeed: ',
      demo:'Student Demo Mode uses the existing JSON exchange; no sample record is uploaded.',
      unavailable:'Online inbox not configured. An administrator must apply the Supabase migration first.',
      advisorTitle:'Assigned students — online approval inbox',
      advisorSub:'Only students assigned to your verified advisor account appear here. Refresh or log in again to check new requests.',
      advisorEmpty:'No requests assigned to you yet.',
      open:'Review request', next:'Next', prev:'Previous', recent:'Showing {start}–{end} of {total}',
      pending:'Pending approval', approved:'Approved', changes:'Changes requested',
      columns:['Student','Semester','Status','Submitted','Action'],
      reviewed:'This request has already been reviewed. It cannot be decided twice.',
      adminTitle:'Assign students to academic advisors',
      adminSub:'Assign a registered student to a verified advisor first. New plans are then delivered automatically to that advisor only.',
      studentEmail:'Student email', advisorEmail:'Academic advisor email', assign:'Save assignment',
      assignmentSaved:'Assignment saved. Future submissions will reach the selected advisor.',
      adminEmpty:'No assignments created yet.',
      assignmentColumns:['Student','Assigned advisor','Assigned on'],
      manual:'If the online service is unavailable, the downloadable JSON remains available for manual review.',
      onlineSaved:'The decision has been saved to the student’s online account.',
      onlineFail:'Could not save online decision (JSON backup downloaded): '
    },
    ar: {
      title:'الطلبات المرسلة إلى المرشد الأكاديمي', refresh:'تحديث الحالة',
      studentEmpty:'لا توجد طلبات اعتماد إلكترونية حتى الآن.',
      needCode:'لم يتم ربطك بمرشد أكاديمي. أدخل الكود الفريد الذي حصلت عليه من المرشد لإرسال خطتك.',
      codeLabel:'كود المرشد الأكاديمي',codePlaceholder:'ADV-XXXXXXXXXXXXXXXXXXXXXXXX',
      codeButton:'تعيين المرشد وإرسال الطلب',codeChanged:'تم تعديل الخطة. اضغط إرسال للاعتماد مرة أخرى.',
      codeIncorrect:'أدخل كود المرشد بصيغة ADV- متبوعًا بـ24 حرفًا/رقمًا (A–F و0–9).',
      notificationsFailed:'تم حفظ الطلب، لكن تعذّر إرسال إشعار البريد للمرشد: ',
      pendingTitle:'في انتظار الموافقة',myAdvisorCode:'الكود الفريد للمرشد الأكاديمي',
      myAdvisorCodeHint:'شارك الكود فقط مع الطلاب المسندين إليك. يدخل الطالب الكود مرة واحدة عند إرسال أول طلب.',
      copyCode:'نسخ الكود',codeUnavailable:'تعذّر تحميل كود المرشد: ',
      filterLabel:'تصفية الطلبات',allFilter:'كل الطلبات',
      sending:'جارٍ إرسال الطلب إلى المرشد المكلف…',
      sent:'تم حفظ الطلب في صندوق المرشد الأكاديمي. احتفظ بملف JSON كنسخة احتياطية.',
      backup:'تم تنزيل ملف JSON ولكن تعذر الإرسال الإلكتروني: ',
      demo:'وضع العرض التجريبي يستخدم تبادل JSON دون رفع بيانات العينة.',
      unavailable:'الصندوق الإلكتروني غير مُهيأ. يجب تطبيق ترحيل قاعدة البيانات أولًا.',
      advisorTitle:'طلبات الطلاب المكلف بهم — صندوق الاعتماد',
      advisorSub:'تظهر هنا طلبات الطلاب المسندين إلى حساب المرشد فقط. حدّث أو سجّل الدخول لعرض الجديد.',
      advisorEmpty:'لا توجد طلبات مكلف بها حتى الآن.',
      open:'مراجعة الطلب', next:'التالي', prev:'السابق', recent:'عرض {start}–{end} من {total}',
      pending:'في انتظار الموافقة', approved:'تمت الموافقة', changes:'مطلوب تعديل',
      columns:['الطالب','الفصل','الحالة','تاريخ الإرسال','إجراء'],
      reviewed:'تمت مراجعة الطلب بالفعل ولا يمكن اعتماده مرتين.',
      adminTitle:'إسناد الطلاب إلى المرشدين الأكاديميين',
      adminSub:'أسند الطالب المسجل إلى مرشد أكاديمي معتمد أولًا؛ ثم تصل خططه تلقائيًا إلى هذا المرشد فقط.',
      studentEmail:'البريد الإلكتروني للطالب', advisorEmail:'بريد المرشد الأكاديمي', assign:'حفظ الإسناد',
      assignmentSaved:'تم حفظ الإسناد وستصل الطلبات الجديدة إلى المرشد المحدد.',
      adminEmpty:'لا توجد تعيينات حتى الآن.',
      assignmentColumns:['الطالب','المرشد المكلف','تاريخ الإسناد'],
      manual:'عند تعذّر الخدمة الإلكترونية، يظل ملف JSON متاحًا للإرسال اليدوي.',
      onlineSaved:'تم حفظ القرار في حساب الطالب الإلكتروني.',
      onlineFail:'تعذر حفظ القرار الإلكتروني (تم تنزيل نسخة JSON): '
    }
  };
  const w = () => dict[LANG === 'ar' ? 'ar' : 'en'];
  const safe = v => esc(String(v == null ? '' : v));
  const fmt = date => date ? new Date(date).toLocaleString(LANG === 'ar' ? 'ar-EG' : 'en-GB',
    {dateStyle:'medium',timeStyle:'short'}) : '—';
  const status = s => safe(w()[s] || s);
  const errorText = e => {
    const message = String(e?.message || e || 'Unknown error');
    if (/PGRST202|42P01|does not exist|could not find the function|schema cache/i.test(message)) return w().unavailable;
    return message;
  };
  const signedStudent = () => !!S.session && S.session.role === 'student' && S.session.actualRole === 'student';
  const signedAdvisor = () => !!S.session && ['advisor','admin'].includes(S.session.role)
    && ['advisor','admin'].includes(S.session.actualRole);
  const signedAdmin = () => !!S.session && S.session.role === 'admin' && S.session.actualRole === 'admin';
  const c = () => client();

  function renderStudent() {
    const el = $('student-online-requests');
    if (!el) return;
    if (!signedStudent()) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="panel panel-pad space-y-3">
      <div class="flex flex-wrap justify-between items-center gap-2">
        <h3>${safe(w().title)}</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-inbox-action="student-refresh">${safe(w().refresh)}</button>
      </div>
      ${studentError ? `<div class="alert alert-am small" role="status">${safe(studentError)}</div>` : ''}
      ${pendingCodeRequest ? `<form id="student-advisor-code-form" class="panel panel-pad space-y-3" autocomplete="off">
        <p class="small">${safe(w().needCode)}</p>
        <div class="flex flex-wrap gap-2 items-end">
          <div class="field" style="flex:1;min-width:230px">
            <label for="student-advisor-code" class="small">${safe(w().codeLabel)}</label>
            <input id="student-advisor-code" class="input" type="text" maxlength="28" placeholder="${safe(w().codePlaceholder)}" required
              autocapitalize="characters" autocomplete="off" spellcheck="false" style="width:100%">
          </div>
          <button type="submit" class="btn btn-primary btn-sm">${safe(w().codeButton)}</button>
        </div>
      </form>` : ''}
      ${noticeWarning ? `<p class="alert alert-am small" role="status">${safe(noticeWarning)}</p>` : ''}
      <div class="small muted">${safe(w().manual)}</div>
      ${requests.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${safe(w().columns[1])}</th><th>${safe(w().columns[2])}</th><th>${safe(w().columns[3])}</th></tr></thead><tbody>
        ${requests.map(r => `<tr><td>${safe(r.term)} · ${safe(r.program)}</td><td>${status(r.status)}${r.decision?.comment ? `<div class="small muted" dir="auto">${safe(r.decision.comment)}</div>` : ''}</td><td class="small">${safe(fmt(r.created_at))}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="small muted">${safe(w().studentEmpty)}</p>`}
      <p class="small" id="student-online-status" aria-live="polite"></p>
    </div>`;
  }

  async function refreshStudent() {
    if (!signedStudent()) return;
    try {
      const {data,error} = await c().from('advisor_plan_requests')
        .select('id,term,program,fingerprint,status,decision,created_at')
        .eq('student_id', S.session.authUserId).order('created_at',{ascending:false}).limit(20);
      if (error) throw error;
      requests = data || []; studentError = '';
      if (S.analysis && S.plan.length && S.depId) {
        const fp = await planFingerprint({
          studentId:activeStudentId(), term:S.term, plan:S.plan,
          program:S.depId, university:S.uniId
        });
        const match = requests.find(r => r.fingerprint === fp && r.decision
          && ['approved','changes'].includes(r.status));
        if (match && match.decision?.type === 'ai-academic-advisor/decision') {
          S.decision = {...match.decision,matches:true};
          renderDecision();
        }
      }
    } catch(e) {
      studentError = errorText(e);
    }
    renderStudent();
  }

  async function submit(r,enteredCode='') {
    if (busySubmit) return false;
    if (!signedStudent() || r.demo) {
      studentError = w().demo; renderStudent(); return false;
    }
    busySubmit=true;
    studentError=w().sending;noticeWarning='';renderStudent();
    try {
      const selection=await c().from('advisor_student_assignments')
        .select('advisor_id').eq('student_id',S.session.authUserId).maybeSingle();
      if(selection.error)throw selection.error;
      const code=String(enteredCode||'').trim().toUpperCase();
      if(!selection.data && !code) {
        pendingCodeRequest=r;
        studentError=w().needCode;
        renderStudent();
        $('student-advisor-code')?.focus?.();
        return false;
      }
      if(code && !/^ADV-[A-F0-9]{24}$/.test(code))
        throw new Error(w().codeIncorrect);
      const {data:requestId,error}=await c().rpc('advisor_submit_plan',
        {p_request:r,p_advisor_code:code||null});
      if(error)throw error;
      pendingCodeRequest=null;
      await refreshStudent();
      studentError=w().sent;
      // Email is a secondary alert. The Supabase inbox is authoritative.
      try {
        const invoke=c().functions?.invoke;
        if(typeof invoke==='function') {
          const notice=await c().functions.invoke('advisor-request-notify',
            {body:{requestId}});
          if(notice.error || notice.data?.ok!==true) {
            let message=notice.error?.message||notice.data?.error||'Notification not confirmed';
            try {
              const details=await notice.error?.context?.json?.();
              if(details?.error)message=details.error;
            }catch(_){}
            noticeWarning=w().notificationsFailed+message;
          }
        }
      }catch(mailError) {
        noticeWarning=w().notificationsFailed+errorText(mailError);
      }
      renderStudent();
      return true;
    } catch(e) {
      studentError=w().backup+errorText(e);
      renderStudent();return false;
    } finally {busySubmit=false;}
  }
  async function submitCodeForm(code) {
    if(!pendingCodeRequest || busySubmit)return;
    const current=await buildRequest();
    if(current.fingerprint!==pendingCodeRequest.fingerprint) {
      pendingCodeRequest=null;studentError=w().codeChanged;renderStudent();return;
    }
    await submit(pendingCodeRequest,code);
  }

  function renderAdvisor() {
    const el = $('advisor-online-inbox');
    if (!el) return;
    if (!signedAdvisor()) { el.innerHTML = ''; return; }
    const start = inboxPage*pageSize+1;
    const canNext = inboxPage*pageSize+inbox.length < inboxCount;
    el.innerHTML = `<div class="panel panel-pad space-y-3">
      <div class="flex flex-wrap justify-between items-center gap-2">
        <div><h3>${safe(w().advisorTitle)}</h3><p class="small muted">${safe(w().advisorSub)}</p></div>
        <button type="button" class="btn btn-ghost btn-sm" data-inbox-action="advisor-refresh">${safe(w().refresh)}</button>
      </div>
      ${advisorCode ? `<div class="panel panel-pad space-y-2" style="background:var(--bg-subtle,transparent)">
        <strong>${safe(w().myAdvisorCode)}</strong>
        <p class="small muted">${safe(w().myAdvisorCodeHint)}</p>
        <div class="flex flex-wrap items-center gap-2">
          <code class="code" dir="ltr" style="overflow-wrap:anywhere">${safe(advisorCode)}</code>
          <button type="button" class="btn btn-ghost btn-sm" data-inbox-action="copy-advisor-code">${safe(w().copyCode)}</button>
        </div>
      </div>` : ''}
      ${advisorCodeError ? `<p class="alert alert-am small" role="alert">${safe(advisorCodeError)}</p>` : ''}
      <div class="flex flex-wrap gap-2 items-center">
        <label for="advisor-inbox-filter" class="small">${safe(w().filterLabel)}</label>
        <select id="advisor-inbox-filter" class="select" style="width:auto">
          <option value="all" ${advisorFilter==='all'?'selected':''}>${safe(w().allFilter)}</option>
          ${['pending','approved','changes'].map(x=>`<option value="${x}" ${advisorFilter===x?'selected':''}>${status(x)}</option>`).join('')}
        </select>
      </div>
      ${advisorError ? `<div class="alert alert-am small" role="alert">${safe(advisorError)}</div>` : ''}
      ${inbox.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>
        ${w().columns.map(label => `<th>${safe(label)}</th>`).join('')}
      </tr></thead><tbody>${inbox.map(r => `<tr>
        <td>${safe(r.student_name || r.student_email)}<div class="small muted">${safe(r.student_email)}</div></td>
        <td>${safe(r.term)} · ${safe(r.program)}</td>
        <td><span class="badge ${r.status==='pending'?'b-am':r.status==='approved'?'b-em':'b-mu'}">${status(r.status)}</span></td>
        <td class="small">${safe(fmt(r.created_at))}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-inbox-open="${safe(r.id)}">${safe(w().open)}</button></td>
      </tr>`).join('')}</tbody></table></div>` : `<p class="small muted">${safe(w().advisorEmpty)}</p>`}
      ${inboxCount > pageSize ? `<div class="flex flex-wrap gap-2 justify-end items-center">
        <span class="small muted">${safe(w().recent.replace('{start}',inbox.length?start:0).replace('{end}',inboxPage*pageSize+inbox.length).replace('{total}',inboxCount))}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-inbox-action="advisor-prev" ${inboxPage===0?'disabled':''}>${safe(w().prev)}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-inbox-action="advisor-next" ${!canNext?'disabled':''}>${safe(w().next)}</button>
      </div>` : ''}
    </div>`;
  }

  async function refreshAdvisor() {
    if (!signedAdvisor()) return;
    try {
      let query=c().from('advisor_plan_requests')
        .select('id,student_name,student_email,term,program,status,created_at',
          {count:'exact'})
        .eq('advisor_id',S.session.authUserId);
      if(advisorFilter!=='all')query=query.eq('status',advisorFilter);
      const {data,error,count}=await query.order('created_at',{ascending:false})
        .range(inboxPage*pageSize,inboxPage*pageSize+pageSize-1);
      if (error) throw error;
      inbox = data || []; inboxCount = count || 0; advisorError = '';
      if (inboxPage && !inbox.length) { inboxPage = 0; return refreshAdvisor(); }
    } catch(e) { advisorError = errorText(e); inbox=[]; inboxCount=0; }
    renderAdvisor();
  }

  async function refreshAdvisorCode() {
    if(!signedAdvisor())return;
    try {
      const {data,error}=await c().rpc('advisor_get_my_code');
      if(error)throw error;
      advisorCode=String(data||'');advisorCodeError='';
    }catch(e){advisorCodeError=w().codeUnavailable+errorText(e);}
    renderAdvisor();
  }

  async function openRequest(id) {
    if (!signedAdvisor()) return;
    try {
      const {data,error} = await c().from('advisor_plan_requests')
        .select('id,request,status').eq('id',id).eq('advisor_id',S.session.authUserId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Request not found or access denied.');
      const r = data.request;
      if (r.type !== 'ai-academic-advisor/request') throw new Error('Unexpected request type.');
      const fp = await planFingerprint(r);
      advReview = {r,X:requestToState(r),tampered:fp!==r.fingerprint,
        onlineId:data.id,onlineStatus:data.status};
      renderAdvisorWS();
      if (data.status !== 'pending') {
        $('adv-review').querySelectorAll('[data-decide]').forEach(b => b.disabled = true);
        const message = $('adv-mail-status');
        if (message) message.textContent = w().reviewed;
      }
      $('adv-review').scrollIntoView({behavior:'smooth',block:'start'});
    } catch(e) {
      advisorError = errorText(e); renderAdvisor();
    }
  }

  async function saveDecision(id,decision) {
    if (!signedAdvisor()) throw new Error('Advisor login required.');
    const {error} = await c().rpc('advisor_save_plan_decision',
      {p_request_id:id,p_decision:decision});
    if (error) throw new Error(errorText(error));
    if (advReview && advReview.onlineId === id) advReview.onlineStatus = decision.decision;
    await refreshAdvisor();
    return true;
  }

  const emailForId = id => {
    const entries = Object.values(typeof adminAccountsCache === 'object' ? adminAccountsCache : {});
    return entries.find(a => a.user_id === id)?.email || id?.slice(0,8) || '';
  };
  function renderAdminAssignments() {
    const el = $('admin-advisor-assignments');
    if (!el || !signedAdmin()) return;
    el.innerHTML = `<div class="panel panel-pad space-y-3">
      <h3>${safe(w().adminTitle)}</h3>
      <p class="small muted">${safe(w().adminSub)}</p>
      <form id="advisor-assign-form" class="grid md:grid-cols-3 gap-3 items-end">
        <div class="field"><label class="small" for="assign-student-email">${safe(w().studentEmail)}</label>
          <input id="assign-student-email" class="input" type="email" required maxlength="254" autocomplete="off"></div>
        <div class="field"><label class="small" for="assign-advisor-email">${safe(w().advisorEmail)}</label>
          <input id="assign-advisor-email" class="input" type="email" required maxlength="254" autocomplete="off"></div>
        <button type="submit" class="btn btn-primary btn-sm">${safe(w().assign)}</button>
      </form>
      ${adminError ? `<p class="alert alert-ro small" role="alert">${safe(adminError)}</p>` : ''}
      ${assignmentMessage ? `<p class="alert alert-em small" role="status">${safe(assignmentMessage)}</p>` : ''}
      ${assignments.length ? `<div class="tbl-wrap" style="max-height:350px;overflow:auto"><table class="tbl">
        <thead><tr>${w().assignmentColumns.map(l => `<th>${safe(l)}</th>`).join('')}</tr></thead>
        <tbody>${assignments.slice(0,100).map(a => `<tr><td>${safe(emailForId(a.student_id))}</td>
          <td>${safe(emailForId(a.advisor_id))}</td><td class="small">${safe(fmt(a.assigned_at))}</td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="small muted">${safe(w().adminEmpty)}</p>`}
    </div>`;
  }
  async function refreshAdminAssignments() {
    if (!signedAdmin()) return;
    try {
      const {data,error} = await c().from('advisor_student_assignments')
        .select('student_id,advisor_id,assigned_at')
        .order('assigned_at',{ascending:false}).limit(100);
      if(error) throw error;
      assignments=data||[];adminError='';
    }catch(e){adminError=errorText(e);assignments=[];}
    renderAdminAssignments();
  }
  async function assign(studentEmail,advisorEmail) {
    if (!signedAdmin()) return;
    assignmentMessage='';adminError='';
    try {
      const {error} = await c().rpc('advisor_assign_student',
        {p_student_email:studentEmail,p_advisor_email:advisorEmail});
      if(error) throw error;
      assignmentMessage=w().assignmentSaved;
      await refreshAdminAssignments();
    } catch(e) {adminError=errorText(e);renderAdminAssignments();}
  }

  function onWorkspace(on) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer=null;
    if (on && signedAdvisor()) {
      inboxPage=0; void refreshAdvisor(); void refreshAdvisorCode();
      if (signedAdmin()) void refreshAdminAssignments();
      refreshTimer=setInterval(() => {if(signedAdvisor() && S.advisorView) void refreshAdvisor();},60000);
    } else if (signedStudent()) {
      void refreshStudent();
      refreshTimer=setInterval(() => {if(signedStudent() && !S.advisorView) void refreshStudent();},60000);
    }
  }
  function onLogout() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer=null; inbox=[];requests=[];assignments=[];advisorError='';studentError='';adminError='';
    assignmentMessage='';inboxPage=0;inboxCount=0;advisorCode='';advisorCodeError='';
    pendingCodeRequest=null;noticeWarning='';advisorFilter='all';
  }

  function bind() {
    if(bound)return;bound=true;
    document.addEventListener('click',e=>{
      const a=e.target.closest('[data-inbox-action]');
      if(a){
        if(a.dataset.inboxAction==='student-refresh') void refreshStudent();
        else if(a.dataset.inboxAction==='advisor-refresh') void refreshAdvisor();
        else if(a.dataset.inboxAction==='advisor-next'){inboxPage++;void refreshAdvisor();}
        else if(a.dataset.inboxAction==='advisor-prev'){inboxPage=Math.max(0,inboxPage-1);void refreshAdvisor();}
        else if(a.dataset.inboxAction==='copy-advisor-code' && advisorCode) {
          if(navigator?.clipboard?.writeText)void navigator.clipboard.writeText(advisorCode)
            .catch(()=>alertToast(advisorCode));
          else alertToast(advisorCode,'em');
        }
      }
      const open=e.target.closest('[data-inbox-open]');
      if(open) void openRequest(open.dataset.inboxOpen);
    });
    document.addEventListener('change',e=>{
      if(e.target.id==='advisor-inbox-filter' && signedAdvisor()){
        advisorFilter=e.target.value||'all';inboxPage=0;void refreshAdvisor();
      }
    });
    document.addEventListener('submit',e=>{
      if(e.target.id==='student-advisor-code-form'){
        e.preventDefault();
        const input=$('student-advisor-code');
        if(input)void submitCodeForm(input.value);
        return;
      }
      if(e.target.id!=='advisor-assign-form')return;
      e.preventDefault();
      const a=$('assign-student-email'),b=$('assign-advisor-email');
      if(a&&b) void assign(a.value.trim().toLowerCase(),b.value.trim().toLowerCase());
    });
  }
  window.AdvisorInbox = {
    bind,submit,refreshStudent,refreshAdvisor,refreshAdminAssignments,renderAdminAssignments,
    saveDecision,onWorkspace,onLogout,renderStudent,renderAdvisor,refreshAdvisorCode
  };
})();
