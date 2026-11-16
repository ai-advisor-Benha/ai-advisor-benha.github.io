/* Only read-only academic tools are exposed. No model credentials or transcript upload. */
(() => {
  'use strict';
  const P=globalThis.BylawProtocol;
  async function ask({question,language,context,history=[],privateValues=[],tools,invoke,signal,isCurrent=()=>true,onEvidence=()=>{},timeoutMs=110000}){
    if(question.length>P.LIMITS.question)throw {code:'invalid_input'};
    const safeQuestion=P.redact(question,privateValues);
    signal=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(timeoutMs)]);
    const records=[],publicRuleCache=new Map(); // Request-scoped, public rules only; never student results.
    const check=()=>{if(signal?.aborted){if(signal.reason?.name==='TimeoutError')throw {code:'timeout'};throw new DOMException('Aborted','AbortError');}if(!isCurrent())throw {code:'context_changed'};};
    for(let round=0;round<=P.LIMITS.rounds;round++){
      check();
      const body=P.request({question:safeQuestion,language,history:history.slice(-2).map(x=>P.redact(x,privateValues)),
        context:{...context,program:P.redact(context.program,privateValues)},evidence:P.evidence(records,privateValues),final:round===P.LIMITS.rounds});
      const response=await new Promise((resolve,reject)=>{
        const abort=()=>reject(signal.reason?.name==='TimeoutError'?{code:'timeout'}:signal.reason);
        signal.addEventListener('abort',abort,{once:true});
        Promise.resolve().then(()=>invoke(body,signal)).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
      });check();
      if(response.calls){
        if(round===P.LIMITS.rounds||!Array.isArray(response.calls)||response.calls.length>P.LIMITS.calls)throw {code:'invalid_tool'};
        for(const item of response.calls){
          const c=P.call(item.name,item.input),tool=tools.find(t=>t.name===c.name);
          if(!tool||records.length>=P.LIMITS.evidence)throw {code:'invalid_tool'};
          const record={...c};
          try{
            if(c.name==='credit_limit'&&!context.hasTranscript&&c.input.hypothetical_cgpa===undefined)throw new Error('Transcript required');
            const cacheKey=JSON.stringify(c.input);
            if(c.name==='lookup_rule'&&publicRuleCache.has(cacheKey))record.result=JSON.parse(publicRuleCache.get(cacheKey));
            else {record.result=tool.execute(c.input);if(c.name==='lookup_rule')publicRuleCache.set(cacheKey,JSON.stringify(record.result));}
          }catch{record.error=true;}
          check();records.push(record);onEvidence(P.evidence([record],privateValues)[0]);
        }
      }else if(typeof response.text==='string')return {text:P.redact(response.text,privateValues),records:P.evidence(records,privateValues)};
      else throw {code:'unavailable'};
    }
    throw {code:'unavailable'};
  }
  async function invoke(body,signal){
    const sb=client();const {data,error}=await sb.auth.getSession();
    if(error||!data.session?.access_token)throw {code:'unauthorized'};
    const cfg=window.ADVISOR_SUPABASE_CONFIG;
    let response;
    try{response=await fetch(cfg.url.replace(/\/$/,'')+'/functions/v1/bylaw-assistant',{
      method:'POST',headers:{'content-type':'application/json',apikey:cfg.publishableKey||cfg.anonKey,Authorization:'Bearer '+data.session.access_token},
      body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(65000)])});}
    catch(e){if(signal.aborted)throw e;throw {code:e.name==='TimeoutError'?'timeout':'unavailable'};}
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw {code:result.code||(response.status===401?'unauthorized':response.status===429?'rate_limited':'unavailable'),retryAfter:Math.min(86400,Math.max(1,Number(response.headers.get('retry-after'))||Number(result.retryAfter)||60))};
    return result;
  }
  const labels={
    program:'البرنامج',bylaw:'اللائحة',cgpa:'المعدل التراكمي',general_grade:'التقدير العام',standing:'الحالة الأكاديمية',earned_hours:'الساعات المكتسبة',total_required_hours:'إجمالي الساعات المطلوبة',remaining_hours:'الساعات المتبقية',level:'المستوى',in_progress_hours:'ساعات قيد الدراسة',articles:'مواد اللائحة',bylaw_version:'نسخة اللائحة',effective_from:'تاريخ السريان',status:'الحالة',warning:'الإنذار الأكاديمي',credit_limits:'حدود الساعات',prerequisites:'المتطلبات السابقة',grading:'التقديرات',retake:'إعادة المقرر',improvement:'تحسين التقدير',levels:'المستويات',attendance:'الحضور',program_structure:'متطلبات البرنامج',code:'كود المقرر',name:'المقرر',credits:'الساعات',semester_checked:'الفصل المفحوص',counted_in_progress_as_passed:'افتراض النجاح في المقررات الحالية',category:'الفئة',priority:'الأولوية',offered_in:'فصل الطرح',blocking_reasons:'أسباب عدم الأهلية',student_status:'حالة المقرر',min_earned_hours:'الحد الأدنى للساعات المكتسبة',student_earned_hours:'ساعات الطالب المكتسبة',note:'ملاحظة',article:'مادة اللائحة',semester:'الفصل',cgpa_used:'المعدل المستخدم',graduation_exception:'استثناء التخرج',max_hours:'الحد الأقصى للساعات',min_hours:'الحد الأدنى للساعات',rule:'القاعدة',all_brackets:'شرائح الساعات',graduation_exception_max:'حد استثناء التخرج',summer_max:'الحد الصيفي',cgpa_before:'المعدل قبل المحاكاة',cgpa_after:'المعدل بعد المحاكاة',earned_hours_before:'الساعات المكتسبة قبل المحاكاة',earned_hours_after:'الساعات المكتسبة بعد المحاكاة',remaining_hours_after:'الساعات المتبقية بعد المحاكاة',standing_after:'الحالة بعد المحاكاة',general_grade_after:'التقدير بعد المحاكاة',simulated:'المقررات المفترضة',grade:'التقدير',points:'النقاط',result:'النتيجة',retake_caps_applied:'حدود الإعادة المطبقة',next_semester:'الفصل التالي',next_credit_limit:'حد الساعات التالي',next_credit_rule:'قاعدة الساعات التالية',total_hours:'إجمالي الساعات',credit_limit:'حد الساعات',courses:'المقررات',reason:'السبب',below_minimum:'أقل من الحد الأدنى',minimum_hours:'الحد الأدنى للساعات',training_excluded:'التدريب خارج الخطة المقترحة',total_required:'الإجمالي المطلوب',earned_toward_graduation:'الساعات المحتسبة للتخرج',requirements:'متطلبات التخرج',requirement:'المتطلب',done_hours:'الساعات المنجزة',required_hours:'الساعات المطلوبة',still_missing:'المقررات المتبقية',training_completed:'اكتمال التدريب',expected_graduation:'التخرج المتوقع افتراضيًا',assumed_grade_for_planned_courses:'التقدير المفترض',field_training_still_needed:'التدريب ما زال مطلوبًا',semesters:'الفصول',hours:'الساعات',limit:'الحد',offered_in_one_semester_only:'مقررات مطروحة في فصل واحد',blocking:'العوائق',allowed:'مسموح',explanation:'التوضيح',max_courses:'الحد الأقصى للمقررات',used:'المستخدم',remaining:'المتبقي',candidates:'المقررات المرشحة',current_grade:'التقدير الحالي',cgpa_gain_if_B:'زيادة المعدل عند الحصول على B',topic:'الموضوع',rules:'القواعد',regular:'الفصول النظامية',summer:'الصيف',min:'الحد الأدنى',max:'الحد الأقصى',minWaiver:'استثناء الحد الأدنى',brackets:'الشرائح',label:'الوصف',minGpa:'أدنى معدل',newStudentMax:'حد الطالب المستجد',graduationMax:'حد التخرج',graduationMinGpa:'أدنى معدل لاستثناء التخرج',prereqArticle:'مادة المتطلبات السابقة',passPercent:'نسبة النجاح',finalExamMinPercent:'أدنى نسبة للامتحان النهائي',maxMark:'الدرجة النهائية',scale:'سلم التقديرات',symbol:'الرمز',gpaFormula:'معادلة المعدل',maxGradeSymbol:'أعلى تقدير',maxPoints:'أعلى نقاط',maxPercent:'أعلى نسبة',failedCountedOnce:'احتساب الرسوب مرة واحدة',electiveSubstitution:'استبدال الاختياري',bestCounts:'احتساب الأعلى',maxCourses:'أقصى عدد مقررات',warningBelow:'حد الإنذار',dismissal:'قواعد الفصل',honors:'مرتبة الشرف',minLevelGpa:'أدنى معدل للمستوى',maxYears:'أقصى سنوات',noFailures:'عدم الرسوب',generalGrades:'التقديرات العامة',thresholds:'الحدود',minHours:'أدنى ساعات',minPercent:'أدنى نسبة',passFail:'نجاح أو رسوب',inGpa:'ضمن المعدل',consecutive_regular_semesters_below_2:'فصول الإنذار المتتالية',dismissal_after:'حد فصول الإنذار',term_gpa_needed_next_semester_at_max_load:'المعدل الفصلي المطلوب عند أقصى حمل'
  };
  const toolNames={lookup_rule:['Bylaw rule','قاعدة اللائحة'],check_course:['Course eligibility','أهلية المقرر'],credit_limit:['Credit limit','حد الساعات'],get_student_record:['Academic summary','ملخص الحالة الأكاديمية'],suggest_plan:['Suggested plan','الخطة المقترحة'],what_if_gpa:['GPA simulation','محاكاة المعدل'],graduation_status:['Graduation progress','التقدم نحو التخرج'],graduation_roadmap:['Hypothetical roadmap','مسار التخرج الافتراضي'],improvement_options:['Grade improvement','تحسين التقدير'],find_course:['Course search','البحث عن مقرر']};
  function evidenceText(value,language,depth=0){
    const ar=language==='ar';
    const primitive=v=>v===null?(ar?'غير متاح':'Unavailable'):typeof v==='boolean'?(v?(ar?'نعم':'Yes'):(ar?'لا':'No')):String(v);
    if(!value||typeof value!=='object')return primitive(value);
    if(Array.isArray(value))return value.map(v=>evidenceText(v,language,depth+1)).join('\n');
    return Object.entries(value).map(([key,v])=>{
      const label=ar&&labels[key]?labels[key]:key.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');
      return '  '.repeat(Math.min(depth,4))+label+': '+(v&&typeof v==='object'?'\n'+evidenceText(v,language,depth+1):primitive(v));
    }).join('\n');
  }
  window.BylawAssistant={ask,invoke,evidenceText,toolName:(name,lang)=>toolNames[name]?.[lang==='ar'?1:0]||name};
})();
