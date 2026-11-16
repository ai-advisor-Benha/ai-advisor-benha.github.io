import assert from 'node:assert/strict';
import {articleIds} from '../supabase/functions/bylaw-assistant/planning.mjs';
export const benchmarkCases=[
  {id:'credits-en',topic:'credits',language:'en',question:'What is my maximum Spring credit limit?'},
  {id:'credits-ar',topic:'credits',language:'ar',question:'كم ساعة يمكنني تسجيلها في الربيع؟'},
  {id:'course-en',topic:'course',language:'en',question:'Can I register for CS142 in Spring with my current record? State its prerequisites and cite the bylaw article.'},
  {id:'course-ar',topic:'course',language:'ar',question:'هل يمكنني تسجيل CS142 في الربيع حسب سجلي الحالي؟ اذكر المتطلبات السابقة ومادة اللائحة.'},
  {id:'cgpa-en',topic:'cgpa',language:'en',question:'What is my current cumulative GPA from my uploaded record? Cite the relevant grading article.'},
  {id:'cgpa-ar',topic:'cgpa',language:'ar',question:'ما هو معدلي التراكمي الحالي من السجل المرفوع؟ اذكر مادة اللائحة الخاصة بالتقديرات.'}
];
export function verifyBenchmark(item,answer,engine){
  const text=answer.text.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g,'.');
  const used=name=>answer.records.some(r=>r.name===name&&!r.error);
  const cited=articleIds(text);let expected;
  if(item.topic==='credits'){
    const r=engine.run('credit_limit',{semester:'Spring'});assert.ok(used('credit_limit'),'Missing deterministic credit_limit execution');
    assert.match(text,new RegExp('\\b'+r.max_hours+'\\b'),'Expected maximum omitted');assert.ok(cited.includes(articleIds(r.article)[0]),'Wrong or missing credit-limit article');
    expected={max_hours:r.max_hours,min_hours:r.min_hours,article:r.article};
  }else if(item.topic==='course'){
    const r=engine.run('check_course',{course_code:'CS142',semester:'Spring'});assert.ok(used('check_course'),'Missing deterministic course eligibility execution');
    const toolResult=answer.records.find(x=>x.name==='check_course'&&x.input.course_code==='CS142'&&!x.error)?.result;
    assert.equal(toolResult?.status,r.status,'Tool eligibility differs from the engine');
    assert.ok(text.includes('CS142'));for(const p of r.prerequisites)assert.ok(text.includes(p.code),'Missing prerequisite '+p.code);
    assert.ok(cited.includes(articleIds(r.article)[0]),'Wrong or missing prerequisite article');
    if(r.status==='eligible'){assert.match(text,/eligible|can register|يمكنك|مؤهل|يمكن تسجيل|يمكنني|يحق|يمكن.*تسجيل/i);assert.doesNotMatch(text,/not eligible|cannot register|غير مؤهل|لا يمكنك التسجيل/i);}
    expected={course:r.code,status:r.status,prerequisites:r.prerequisites.map(p=>p.code),article:r.article};
  }else{
    const r=engine.run('get_student_record');assert.ok(used('get_student_record'),'Missing deterministic record execution');assert.ok(text.includes(String(r.cgpa)),'Incorrect or missing CGPA');
    assert.ok(articleIds(r.articles.grading).some(id=>cited.includes(id)),'Missing grading article');
    if(r.general_grade==='Very Good')assert.doesNotMatch(text,/excellent|ممتاز/i,'Incorrect qualitative grade classification');
    expected={cgpa:r.cgpa,general_grade:r.general_grade,articles:r.articles.grading};
  }
  return expected;
}
