/* Official Ibn Al-Haytham academic advisor rosters.
   Browser extracts only student numbers and names; no grades/phones/emails leave the upload.
   Supabase RPCs authorize and approve batches; Postgres independently enforces matching. */
(() => {
  'use strict';
  let preview = null, batches = [], adminEmails = {}, expanded = null, batchMembers = [];
  let previewFilter = '';
  let busy = false, message = '', error = '', started = false;
  const $r = id => document.getElementById(id);
  const html = s => String(s == null ? '' : s).replace(/[&<>"']/g, x =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const ar = () => typeof LANG !== 'undefined' && LANG === 'ar';
  const lbl = (en,arabic) => ar() ? arabic : en;
  const advisor = () => !!S.session && ['advisor','admin'].includes(S.session.role) &&
    ['advisor','admin'].includes(S.session.actualRole);
  const admin = () => !!S.session && S.session.role==='admin' && S.session.actualRole==='admin';
  const api = () => client();
  const formatTime = x => { try { return new Date(x).toLocaleString(ar()?'ar-EG':'en-GB'); } catch {return x||'';} };
  function rowsOf(table) {
    return [...(table?.querySelectorAll('tr')||[])].map(tr =>
      [...tr.children].filter(c=>['TH','TD'].includes(c.tagName))
        .map(c=>(c.textContent||'').replace(/\s+/g,' ').trim()));
  }
  function fromTable(rows, heading) {
    const hdr=rows.findIndex(r=>r.some(c=>c.includes('اسم الطالب')) && r.some(c=>c.includes('كود الطالب')));
    if(hdr<0) throw new Error('Missing Ibn Al-Haytham student-name/student-code table headers.');
    const headers=rows[hdr];
    const nc=headers.findIndex(c=>c.includes('اسم الطالب')), idc=headers.findIndex(c=>c.includes('كود الطالب'));
    const found=[], seen=new Set();
    for(const r of rows.slice(hdr+1)) {
      const name=String(r[nc]||'').replace(/\s+/g,' ').trim(), num=String(r[idc]||'').replace(/\s/g,'').trim();
      if(!name&&!num)continue;
      if(!/^\d{5,20}$/.test(num)||name.length<5||name.length>180)
        throw new Error('A student row has an invalid university code or full name. No roster was submitted.');
      if(seen.has(num)) throw new Error('Duplicate student number '+num+'. No roster was submitted.');
      seen.add(num);found.push({studentNumber:num,studentName:name});
    }
    if(!found.length||found.length>1000)throw new Error('Roster must contain between 1 and 1,000 students.');
    const match=heading.match(/(?:الاستاذ|الأستاذ)\s+(?:الدكتور|الدكتورة)\s+(.+?)(?=\s+كلية|\s+معهد|\s+جامعة|$)/);
    if(!heading.includes('المرشد الاكاديمي')||!match)
      throw new Error('The export must show the official academic advisor name in its heading.');
    const faculty=(heading.match(/كلية\s+(.+?)(?=\s*-\s*|$)/)||[])[1]||'';
    const program=(heading.match(/-\s*(.+)$/)||[])[1]||'';
    return {
      advisorName:match[1].trim(),facultyName:faculty.trim(),programName:program.trim(),
      students:found
    };
  }
  async function parseFile(file) {
    if(!file || file.size>10*1024*1024)throw new Error('Choose a roster export smaller than 10 MB.');
    const text=await file.text();
    let data;
    if(/<table\b/i.test(text.slice(0,50000))) {
      const doc=new DOMParser().parseFromString(text,'text/html');
      const official=doc.getElementById('ReportTbl');
      const heading=doc.getElementById('headerTbl');
      if(!official||!heading)throw new Error('Expected Ibn Al-Haytham ReportTbl and headerTbl were not found.');
      const title=rowsOf(heading)[0]?.join(' ')||'';
      const extra=heading.textContent||'';
      data=fromTable(rowsOf(official),title);
      data.exportDate=(extra.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/)||[])[0]||'';
    } else {
      if(!window.XLSX)throw new Error('Excel reader unavailable. Refresh and try again.');
      const book=XLSX.read(new Uint8Array(await file.arrayBuffer()),{type:'array'});
      let parsed=null;
      for(const name of book.SheetNames) {
        const rows=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,raw:false,defval:''});
        const heading=rows.slice(0,5).flat().map(String).join(' ').replace(/\s+/g,' ').trim();
        try {
          parsed=fromTable(rows.map(r=>r.map(x=>String(x||'').trim())),heading);
          parsed.exportDate=(heading.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/)||[])[0]||'';
          break;
        } catch (_) {}
      }
      if(!parsed)throw new Error('No official advisor roster found in this Excel workbook.');
      data=parsed;
    }
    data.filename=file.name;
    return data;
  }
  // The right-hand preview is local to the signed-in advisor's browser;
  // filtering does not send names or university codes to the database.
  const normalizedSearch = value => String(value || '').normalize('NFKC')
    .replace(/[ًٌٍَُِّْٰـ]/g,'').replace(/[أإآٱ]/g,'ا')
    .replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().trim();
  function matchingPreviewStudents() {
    if (!preview) return [];
    const term=normalizedSearch(previewFilter);
    if (!term) return preview.students;
    return preview.students.filter(student =>
      normalizedSearch(student.studentNumber).includes(term) ||
      normalizedSearch(student.studentName).includes(term));
  }
  function previewStudentRows(students) {
    if (!students.length)
      return '<tr><td colspan="3" class="small muted">'+
        lbl('No matching students found.','لا توجد أسماء مطابقة للبحث.')+'</td></tr>';
    return students.map((student,i) =>
      '<tr><td class="small muted">'+(i+1)+'</td><td class="code" dir="ltr">'+
      html(student.studentNumber)+'</td><td dir="auto">'+
      html(student.studentName)+'</td></tr>').join('');
  }
  function render() {
    const el=$r('advisor-official-roster');
    if(!el||!advisor())return;
    let out='<section class="panel panel-pad space-y-3"><h3>'+
      lbl('Official Ibn Al-Haytham advisor roster','قائمة طلاب المرشد الأكاديمي الرسمية من ابن الهيثم')+
      '</h3><p class="small muted">'+
      lbl('Upload the export from YOUR advisor page. Only university student number and full name are retained. An administrator must approve the list before any new student can be matched.','ارفع كشف طلابك من صفحة الإرشاد الأكاديمي في ابن الهيثم. سيتم الاحتفاظ بكود الطالب واسمه فقط. يجب اعتماد الكشف من مدير النظام قبل المطابقة.')+
      '</p><div class="field"><label class="small" for="advisor-official-file">'+
      lbl('Official roster (.xls/.xlsx)','كشف طلاب المرشد (.xls/.xlsx)')+
      '</label><input class="input" type="file" id="advisor-official-file" accept=".xls,.xlsx,.html,.htm"></div>';
    if(preview) {
      const matching=matchingPreviewStudents();
      out+='<div class="panel panel-pad space-y-3"><strong>'+
        lbl('Report preview — review before uploading','معاينة الكشف قبل الرفع')+
        '</strong><div class="grid md:grid-cols-2 gap-4 items-start">'+
        '<div class="space-y-3"><div class="small">'+lbl('Advisor','المرشد')+
        ': <b dir="auto">'+html(preview.advisorName)+'</b></div>'+
        '<div class="small">'+lbl('Faculty','الكلية')+': '+html(preview.facultyName)+'</div>'+
        '<div class="small">'+lbl('Program','البرنامج')+': '+html(preview.programName)+'</div>'+
        '<div class="small">'+lbl('Export date','تاريخ التصدير')+': '+html(preview.exportDate)+'</div>'+
        '<div class="small"><b>'+html(preview.students.length)+'</b> '+
        lbl('unique students detected','طالباً بكود جامعي فريد')+'</div>'+
        '<p class="small muted">'+
        lbl('Check the advisor name and students on the right. This report will be held for administrator verification.','راجع اسم المرشد وأسماء الطلاب في الجدول المجاور. يُرسل الكشف إلى مدير النظام للتحقق والاعتماد.')+
        '</p></div>'+
        '<div class="panel panel-pad space-y-2">'+
        '<div class="flex flex-wrap gap-2 items-center justify-between"><strong class="small">'+
        lbl('Students in this roster','الطلاب في هذا الكشف')+
        '</strong><span class="small muted" id="advisor-roster-preview-count" aria-live="polite">'+
        html(matching.length)+' / '+html(preview.students.length)+'</span></div>'+
        '<label class="small" for="advisor-roster-preview-search">'+
        lbl('Search by student name or university code','البحث باسم الطالب أو الكود الجامعي')+'</label>'+
        '<input class="input" type="search" id="advisor-roster-preview-search" '+
        'autocomplete="off" placeholder="'+lbl('Search students…','ابحث عن طالب…')+'" value="'+
        html(previewFilter)+'" aria-controls="advisor-roster-preview-list">'+
        '<div class="tbl-wrap" style="max-height:340px;overflow:auto" id="advisor-roster-preview-list">'+
        '<table class="tbl" style="width:100%"><thead><tr><th>#</th><th>'+
        lbl('University code','الكود الجامعي')+'</th><th>'+
        lbl('Student name','اسم الطالب')+'</th></tr></thead>'+
        '<tbody id="advisor-roster-preview-rows">'+previewStudentRows(matching)+
        '</tbody></table></div><p class="small muted">'+
        lbl('All names are visible here for checking. Searching stays on this device.','جميع الأسماء متاحة للمراجعة هنا. البحث يتم على جهازك فقط.')+
        '</p></div></div>'+
        '<div><button class="btn btn-primary btn-sm" type="button" data-official-roster="upload" '+
        (busy?'disabled':'')+'>'+
        lbl('Submit roster for administrator approval','إرسال الكشف لاعتماد المدير')+
        '</button></div></div>';
    }
    if(message)out+='<p class="alert alert-em small" role="status">'+html(message)+'</p>';
    if(error)out+='<p class="alert alert-ro small" role="alert">'+html(error)+'</p>';
    out+='<div class="flex items-center justify-between gap-2"><h4>'+
      lbl('Uploaded roster batches','الكشوف المرفوعة')+
      '</h4><button type="button" class="btn btn-ghost btn-sm" data-official-roster="refresh">'+
      lbl('Refresh','تحديث')+'</button></div>';
    if(!batches.length)out+='<p class="small muted">'+lbl('No roster uploaded yet.','لا توجد كشوف مرفوعة حتى الآن.')+'</p>';
    else {
      out+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>'+lbl('Advisor','المرشد')+
        '</th><th>'+lbl('Registered account','الحساب المسجل')+'</th><th>'+lbl('Students','عدد الطلاب')+
        '</th><th>'+lbl('Status','الحالة')+'</th><th>'+lbl('Actions','إجراءات')+'</th></tr></thead><tbody>';
      for(const b of batches) {
        const own=S.session.authUserId===b.advisor_id;
        out+='<tr><td dir="auto">'+html(b.advisor_name)+'<div class="small muted">'+html(b.program_name)+' · '+html(b.export_date)+'</div></td>'+
          '<td class="small">'+html(adminEmails[b.advisor_id]||(own?S.session.email:b.advisor_id.slice(0,8)+'…'))+
          '</td><td>'+html(b.student_count)+'</td><td>'+html(b.status)+
          '</td><td><button class="btn btn-ghost btn-sm" data-official-roster="view" data-roster-id="'+html(b.id)+'">'+
          lbl('Inspect','معاينة')+'</button> '+
          (admin()&&b.status==='pending'?
             '<button class="btn btn-primary btn-sm" data-official-roster="approve" data-roster-id="'+html(b.id)+'">'+lbl('Approve','اعتماد')+
             '</button> <button class="btn btn-ghost btn-sm" data-official-roster="reject" data-roster-id="'+html(b.id)+'">'+lbl('Reject','رفض')+'</button>':'')+
          '</td></tr>';
      }
      out+='</tbody></table></div>';
    }
    if(expanded) {
      out+='<div class="panel panel-pad space-y-2"><strong>'+lbl('Students in selected report','الطلاب في الكشف المحدد')+
        '</strong><p class="small muted">'+html(batchMembers.length)+' '+lbl('student codes loaded for private review.','كود طالب للمعاينة الخاصة.')+'</p>'+
        '<div class="tbl-wrap" style="max-height:240px;overflow:auto"><table class="tbl"><thead><tr><th>'+
        lbl('University code','الكود الجامعي')+'</th><th>'+lbl('Student name','اسم الطالب')+'</th></tr></thead><tbody>'+
        batchMembers.map(x=>'<tr><td>'+html(x.student_number)+'</td><td dir="auto">'+html(x.student_name)+'</td></tr>').join('')+
        '</tbody></table></div></div>';
    }
    out+='</section>';el.innerHTML=out;
  }
  async function refresh() {
    if(!advisor())return;
    try {
      const res=await api().from('advisor_roster_batches')
        .select('id,advisor_id,advisor_name,faculty_name,program_name,export_date,student_count,status,created_at')
        .order('created_at',{ascending:false}).limit(100);
      if(res.error)throw res.error;
      batches=res.data||[];
      adminEmails={};
      if(admin()&&batches.length) {
        const ids=[...new Set(batches.map(x=>x.advisor_id))];
        const profiles=await api().from('advisor_profiles').select('id,email').in('id',ids);
        if(!profiles.error) for(const p of profiles.data||[])adminEmails[p.id]=p.email;
      }
      error='';
    }catch(e){error=e.message||String(e);}
    render();
  }
  async function upload() {
    if(!preview||busy||!advisor())return;
    busy=true;message='';error='';render();
    try {
      const {error:e}=await api().rpc('advisor_upload_official_roster',{
        p_advisor_name:preview.advisorName,p_faculty_name:preview.facultyName,
        p_program_name:preview.programName,p_export_date:preview.exportDate,
        p_students:preview.students
      });
      if(e)throw e;
      preview=null;message=lbl('Roster uploaded privately. Administrator approval is required before students can be assigned.','تم رفع الكشف بشكل خاص. يجب اعتماده من المدير قبل ربط الطلاب.');
      await refresh();
    }catch(e){error=e.message||String(e);}
    finally{busy=false;render();}
  }
  async function review(id,approve) {
    if(!admin()||busy)return;
    if(!window.confirm(approve?lbl('Approve this complete advisor roster as official? It will replace any previously approved roster for this advisor.','هل تريد اعتماد الكشف رسمياً واستبدال أي كشف سابق للمرشد؟'):lbl('Reject this unverified roster?','هل تريد رفض هذا الكشف؟')))return;
    busy=true;message='';error='';
    try {
      const {error:e}=await api().rpc('advisor_review_official_roster',{p_batch_id:id,p_approve:approve});
      if(e)throw e;
      message=approve?lbl('Official roster approved. Students will now be matched automatically.','تم اعتماد الكشف، وسيتم ربط الطلاب تلقائياً.'):lbl('Roster rejected.','تم رفض الكشف.');
      await refresh();
    }catch(e){error=e.message||String(e);}
    finally{busy=false;render();}
  }
  async function view(id) {
    if(!advisor()||busy)return;
    busy=true;error='';
    try {
      const {data,error:e}=await api().from('advisor_roster_students')
        .select('student_number,student_name').eq('batch_id',id)
        .order('student_number',{ascending:true}).limit(1000);
      if(e)throw e;
      batchMembers=data||[];expanded=id;
    }catch(e){error=e.message||String(e);}
    finally{busy=false;render();}
  }
  function onWorkspace(on) {
    if(on&&advisor())void refresh();
    if(!on){preview=null;previewFilter='';expanded=null;batchMembers=[];}
    render();
  }
  function bind() {
    if(started)return;started=true;
    document.addEventListener('input',e=>{
      if(e.target?.id!=='advisor-roster-preview-search'||!advisor()||!preview)return;
      previewFilter=String(e.target.value||'');
      const filtered=matchingPreviewStudents();
      const rows=$r('advisor-roster-preview-rows');
      const count=$r('advisor-roster-preview-count');
      if(rows)rows.innerHTML=previewStudentRows(filtered);
      if(count)count.textContent=filtered.length+' / '+preview.students.length;
    });
    document.addEventListener('change',async e=>{
      if(e.target?.id!=='advisor-official-file'||!advisor())return;
      error='';message='';preview=null;previewFilter='';
      try{preview=await parseFile(e.target.files?.[0]);}
      catch(x){error=x.message||String(x);}
      render();
    });
    document.addEventListener('click',e=>{
      const btn=e.target.closest('[data-official-roster]');
      if(!btn||!advisor())return;
      const act=btn.dataset.officialRoster,id=btn.dataset.rosterId;
      if(act==='refresh')void refresh();
      if(act==='upload')void upload();
      if(act==='approve')void review(id,true);
      if(act==='reject')void review(id,false);
      if(act==='view')void view(id);
    });
  }
  window.AdvisorRoster={bind,onWorkspace,refresh,parseOfficialRoster:parseFile};
})();