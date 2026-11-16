import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
export function engine(){
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