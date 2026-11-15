// Execute the real, unchanged academic code with synthetic transcript data.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../supabase/functions/_shared/bylaw-protocol.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function engine(){
  const context={console,Date,t:(key)=>key,bracketLabel:x=>x,catLabel:x=>x,LANG:'en',norm:x=>String(x||'').trim().toUpperCase().replace(/\s/g,'')};vm.createContext(context);
  vm.runInContext(section('const BFCAI_COURSES','const store =')+section('/* ENGINE-START */','/* ENGINE-END */')+
    section('function heavyReasons(','/* ---- Program transfer check ---- */')+
    section('const INTEREST_KEYWORDS','function renderImprovement(')+
    section('function agentNeedProgram(','// Model access is exclusively'),context);
  vm.runInContext(`
    const UNIVERSITIES=[buildBenha()];const u=UNIVERSITIES[0],f=u.faculties[0],d=f.departments.find(x=>x.id==='cs');
    const uni=()=>u,fac=()=>f,rawFac=()=>f,dept=()=>d;
    const tr=parseTranscriptAOA([['Semester','Course Code','Course Name','Credit Hours','Degree','Grade'],['Fall 2024-2025','CS101','Computer Science Fundamentals',3,'','A'],['Fall 2024-2025','CS141','Structured Programming',3,'','B']]);
    tr.student={name:'Private Student',nationalId:'12345678901234',number:'99912345',enrollYear:'2024-2025'};
    const S={term:'Spring',interest:'any',assumeIP:false,gradException:false,transcript:tr,analysis:analyzeTranscript(tr,f,d)};
    const termYearFor=()=>'',autoTarget=()=>null;
    globalThis.run=(name,input={})=>AGENT_TOOLS.find(t=>t.name===name).run(input);
  `,context);
  return context;
}
test('actual engine supplies GPA, eligibility, credits, suggestions, simulations and graduation evidence',()=>{
  const e=engine(),P=BylawProtocol;
  const cases=[['lookup_rule',{topic:'registration'}],['check_course',{course_code:'CS142',semester:'Spring'}],['credit_limit',{}],['get_student_record',{}],['suggest_plan',{semester:'Spring'}],['what_if_gpa',{grades:[{course_code:'CS142',grade:'A'}]}],['graduation_status',{}],['graduation_roadmap',{}]];
  for(const [name,input] of cases){
    P.call(name,input);const result=e.run(name,input);assert.ok(result);
    const safe=P.evidence([{name,input,result}]);const text=JSON.stringify(safe);
    assert.ok(!text.includes('Private Student'));assert.ok(!text.includes('12345678901234'));assert.ok(!text.includes('99912345'));assert.ok(!text.includes('attempts'));
  }
  assert.equal(e.run('get_student_record').cgpa,3.35);
  assert.equal(e.run('check_course',{course_code:'CS142'}).status,'eligible');
  assert.equal(e.run('credit_limit').max_hours,18);
  assert.equal(e.run('what_if_gpa',{grades:[{course_code:'CS142',grade:'A'}]}).cgpa_after,3.47);
  assert.match(e.run('lookup_rule',{topic:'registration'}).rules.article,/9-c/);
});
