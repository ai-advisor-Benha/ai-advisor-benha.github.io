/* Shared browser/Edge privacy boundary. No accounts, transcripts, or arbitrary tools. */
(() => {
  'use strict';
  const LIMITS = Object.freeze({ question: 1200, body: 48000, evidence: 12, rounds: 3, calls: 4 });
  const topics = ['registration','grading','retake','improvement','standing','levels','attendance','training','requirements','notes'];
  const semester = { type:'string', enum:['Fall','Spring','Summer'] };
  const interest = { type:'string', enum:['any','ai','data','net','health','soft'] };
  const code = { type:'string', pattern:'^[A-Za-z]{2,4}[A-Za-z0-9]{2,8}$', maxLength:12 };
  const definitions = [
    ['lookup_rule','Read the selected program bylaw and its article. Translate Arabic topic requests.',{topic:{type:'string',enum:topics}},['topic']],
    ['check_course','Check course eligibility using the existing engine. Course code required; use find_course for a name.',{course_code:code,semester,count_in_progress_as_passed:{type:'boolean'}},['course_code']],
    ['credit_limit','Read the engine credit limit. Do not infer a graduation exception.',{semester,hypothetical_cgpa:{type:'number',minimum:0,maximum:4},graduation_exception:{type:'boolean'}}],
    ['get_student_record','Read aggregate GPA, hours, standing and bylaw version; no transcript or identity.',{}],
    ['suggest_plan','Suggest courses through the deterministic engine.',{semester,interest}],
    ['what_if_gpa','Simulate explicitly requested grades using the engine.',{grades:{type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{course_code:code,grade:{type:'string',pattern:'^(?:[ABCD][+-]?|F|P|(?:100|[0-9]{1,2})(?:\\.[0-9]{1,2})?)$'}},required:['course_code','grade']}},next_semester:semester},['grades']],
    ['graduation_status','Read graduation requirements and progress.',{}],
    ['graduation_roadmap','Read a hypothetical roadmap, never a guaranteed graduation date.',{interest}],
    ['improvement_options','Read grade improvement options.',{}],
    ['find_course','Find course codes by English name. Translate Arabic course names to an English search query.',{query:{type:'string',minLength:1,maxLength:100}},['query']]
  ];
  const tools = definitions.map(([name,description,properties,required=[]]) => ({type:'function',function:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}}}));
  function fail(code='invalid_input') { throw Object.assign(new Error(code),{code}); }
  function redact(value, privateValues=[]) {
    let s=String(value ?? '');
    for(const v of privateValues.filter(v=>typeof v==='string' && v.length>=3).sort((a,b)=>b.length-a.length)) s=s.split(v).join('[private]');
    s=s.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    return s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[private]')
      .replace(/(?:\+?\d[\s().-]*){7,}/g,'[private]')
      .replace(/https?:\/\/\S+/gi,'[link removed]')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
  }
  function validate(value,schema) {
    if(schema.type==='object') {
      if(!value || typeof value!=='object' || Array.isArray(value)) fail();
      if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k))) fail();
      for(const key of schema.required||[]) if(!Object.hasOwn(value,key)) fail();
      for(const [key,v] of Object.entries(value)) validate(v,schema.properties[key]);
    } else if(schema.type==='array') {
      if(!Array.isArray(value)||value.length<(schema.minItems||0)||value.length>(schema.maxItems||100)) fail();
      value.forEach(v=>validate(v,schema.items));
    } else {
      if(typeof value!==schema.type) fail();
      if(schema.enum&&!schema.enum.includes(value)) fail();
      if(typeof value==='string'&&(value.length>(schema.maxLength||120)||value.length<(schema.minLength||0)||(schema.pattern&&!new RegExp(schema.pattern).test(value)))) fail();
      if(typeof value==='number'&&(!Number.isFinite(value)||value<schema.minimum||value>schema.maximum)) fail();
    }
    return value;
  }
  function call(name,input={}) {
    const tool=tools.find(t=>t.function.name===name); if(!tool) fail('invalid_tool');
    validate(input,tool.function.parameters); return {name,input};
  }
  // Explicit output keys, including nested bylaw fields; unknown fields are discarded.
  const keys=new Set(('program bylaw cgpa general_grade standing earned_hours total_required_hours remaining_hours level in_progress_hours articles bylaw_version warning effective_from status consecutive_regular_semesters_below_2 dismissal_after term_gpa_needed_next_semester_at_max_load credit_limits prerequisites grading retake improvement levels attendance program_structure code name credits semester_checked counted_in_progress_as_passed category priority offered_in blocking_reasons student_status min_earned_hours student_earned_hours note article semester cgpa_used graduation_exception max_hours min_hours rule all_brackets graduation_exception_max summer_max cgpa_before cgpa_after earned_hours_before earned_hours_after remaining_hours_after standing_after general_grade_after simulated grade points result retake_caps_applied next_semester next_credit_limit next_credit_rule total_hours credit_limit courses reason below_minimum minimum_hours training_excluded total_required earned_toward_graduation requirements requirement done_hours required_hours still_missing training_completed expected_graduation assumed_grade_for_planned_courses field_training_still_needed semesters hours limit offered_in_one_semester_only blocking allowed explanation max_courses used remaining candidates current_grade cgpa_gain_if_B topic rules regular summer min minWaiver brackets label minGpa max newStudentMax graduationMax graduationMinGpa prereqArticle passPercent finalExamMinPercent maxMark scale symbol gpaFormula maxGradeSymbol maxPoints maxPercent failedCountedOnce electiveSubstitution bestCounts maxCourses warningBelow dismissal honors minLevelGpa maxYears noFailures generalGrades thresholds minHours minPercent passFail inGpa').split(' '));
  function clean(value,privateValues=[],depth=0) {
    if(depth>9) fail();
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(typeof value==='string')return redact(value,privateValues).slice(0,1200);
    if(Array.isArray(value))return value.slice(0,80).map(v=>clean(v,privateValues,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>keys.has(k)).map(([k,v])=>[k,clean(v,privateValues,depth+1)]));
    return null;
  }
  function evidence(items,privateValues=[]) {
    if(!Array.isArray(items)||items.length>LIMITS.evidence)fail();
    return items.map(item=>{
      const c=call(item.name,item.input||{});
      // Inputs are also redacted; no arbitrary error text (may contain uploaded PII) leaves the client.
      return {...c,input:JSON.parse(redact(JSON.stringify(c.input),privateValues)),
        ...(item.error?{error:'Academic information unavailable. Select a program, upload your own transcript, or specify a valid course.'}:{result:clean(item.result,privateValues)})};
    });
  }
  function request(body) {
    if(!body||typeof body!=='object'||Array.isArray(body))fail();
    if(Object.keys(body).some(k=>!['question','language','context','evidence','final','history'].includes(k)))fail();
    if(typeof body.question!=='string'||!body.question.trim()||body.question.length>LIMITS.question)fail();
    if(!['en','ar'].includes(body.language))fail();
    const c=body.context;
    if(!c||!['program','term','hasTranscript'].every(k=>Object.hasOwn(c,k))||Object.keys(c).some(k=>!['program','term','hasTranscript'].includes(k)))fail();
    if(typeof c.program!=='string'||c.program.length>120||typeof c.hasTranscript!=='boolean')fail();
    validate(c.term,semester);
    if(body.final!==undefined&&typeof body.final!=='boolean')fail();
    if(body.history!==undefined&&(!Array.isArray(body.history)||body.history.length>2||body.history.some(x=>typeof x!=='string'||x.length>LIMITS.question)))fail();
    const out={question:redact(body.question),language:body.language,history:(body.history||[]).map(x=>redact(x)),context:{program:redact(c.program),term:c.term,hasTranscript:c.hasTranscript},evidence:evidence(body.evidence||[]),final:body.final===true};
    if(JSON.stringify(out).length>LIMITS.body)fail();
    return out;
  }
  const messages={
    en:{unauthorized:'Please sign in again to use Ask the Bylaw.',forbidden:'This account cannot use the assistant.',unavailable:'The AI service is not configured or is unavailable. Your academic analysis and approval workflow remain available.',rate_limited:'The assistant is busy or your request limit has been reached. Please try again later.',invalid_input:'Please enter a shorter academic question (maximum 1,200 characters), without personal details.',invalid_tool:'The model requested an unsupported academic operation. Please rephrase your question.',timeout:'The model took too long. Please try a shorter question.',context_changed:'Your account, program or transcript changed. Ask again using the current record.',no_evidence:'I could not verify an answer using the academic engine. Please specify a course code or bylaw topic; select your program and upload your transcript for personal questions.',other:'The assistant could not complete this question. Please try again.'},
    ar:{unauthorized:'يرجى تسجيل الدخول مجددًا لاستخدام اسأل اللائحة.',forbidden:'لا يمكن لهذا الحساب استخدام المساعد.',unavailable:'خدمة الذكاء الاصطناعي غير مهيأة أو غير متاحة. يمكنك متابعة التحليل الأكاديمي وطلبات الاعتماد.',rate_limited:'المساعد مشغول أو وصلت إلى حد الطلبات. حاول مرة أخرى لاحقًا.',invalid_input:'اكتب سؤالًا أكاديميًا أقصر (بحد أقصى ١٢٠٠ حرف) دون بيانات شخصية.',invalid_tool:'طلب النموذج عملية غير مدعومة. يرجى إعادة صياغة السؤال.',timeout:'استغرق النموذج وقتًا طويلًا. حاول بسؤال أقصر.',context_changed:'تغير الحساب أو البرنامج أو بيان الحالة. اسأل مجددًا باستخدام البيانات الحالية.',no_evidence:'لم أتمكن من التحقق من الإجابة بمحرك القواعد. حدد كود المقرر أو موضوع اللائحة، واختر برنامجك وارفع بيان حالتك للأسئلة الشخصية.',other:'تعذر إكمال الإجابة. يرجى المحاولة مرة أخرى.'}
  };
  globalThis.BylawProtocol=Object.freeze({LIMITS,tools,redact,clean,call,evidence,request,message:(code,lang)=>messages[lang==='ar'?'ar':'en'][code]||messages[lang==='ar'?'ar':'en'].other});
})();
