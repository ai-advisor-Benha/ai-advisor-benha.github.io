// Synthetic parsing tests. No real student names/IDs/phones are checked into GitHub.
// Run: node --test tests/advisor-roster.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../advisor-roster.js',import.meta.url),'utf8');

function cellRows(matrix) {
  return {querySelectorAll:()=>matrix.map(row=>({
    children:row.map(text=>({tagName:'TD',textContent:text}))
  }))};
}
function makeParser(heading,body) {
  const table=cellRows(body);
  const header=cellRows([['',heading,'']]);
  header.textContent=heading+' نظام ابن الهيثم 15/11/2026';
  return class {
    parseFromString(){
      return {getElementById:id=>id==='headerTbl'?header:id==='ReportTbl'?table:null};
    }
  };
}
function app({title='تقرير طلاب المرشد الاكاديمي الاستاذ الدكتور مرشد الجامعة التحقق كلية الحاسبات والذكاء الاصطناعي - حسابات علمية',rows}={}) {
  const body=rows||[
    ['م','اسم الطالب','كود الطالب','برنامج الطالب','بريد النظام','البريد الالكترونى','الموبايل','تاريخ بداية الارشاد','المعدل التراكمي','المستوى'],
    ['1','طالب تجربة جامعي الاول','99100465','حسابات علمية','private@example.invalid','','01099999999','22/09/2026','2.9','الرابع'],
    ['2','طالب تجربة جامعي الثاني','99100466','حسابات علمية','','','01199999999','22/09/2026','3','الرابع']
  ];
  const context={window:{},document:{addEventListener(){},getElementById(){return null}},
    DOMParser:makeParser(title,body),S:{session:{role:'advisor',actualRole:'advisor'}},LANG:'en'};
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'advisor-roster.js'});
  return context.window.AdvisorRoster;
}
const upload={size:1024,name:'StudentsData.xls',async text(){return '<table id="headerTbl"></table><table id="ReportTbl"></table>';}};

test('correctly reads official advisor header, student codes and name from HTML disguised as xls', async()=>{
  const parsed=await app().parseOfficialRoster(upload);
  assert.equal(parsed.advisorName,'مرشد الجامعة التحقق');
  assert.equal(parsed.facultyName,'الحاسبات والذكاء الاصطناعي');
  assert.equal(parsed.programName,'حسابات علمية');
  assert.equal(parsed.exportDate,'15/11/2026');
  assert.equal(parsed.students.length,2);
  assert.equal(parsed.students[0].studentNumber,'99100465');
});
test('does not retain mobile, GPA, grades, email or national ID',async()=>{
  const parsed=await app().parseOfficialRoster(upload);
  assert.deepEqual(Object.keys(parsed.students[0]),['studentNumber','studentName']);
  const dump=JSON.stringify(parsed);
  assert.ok(!dump.includes('01099999999'));
  assert.ok(!dump.includes('private@example.invalid'));
});
test('rejects duplicate student codes in the official roster',async()=>{
  const rows=[
    ['م','اسم الطالب','كود الطالب'],
    ['1','طالب تجريبي اول واحد','99100465'],
    ['2','طالب تجريبي ثاني واحد','99100465']
  ];
  await assert.rejects(()=>app({rows}).parseOfficialRoster(upload),/Duplicate student number/);
});
test('rejects spreadsheets without an explicit academic advisor title',async()=>{
  await assert.rejects(()=>app({title:'تقرير الطلاب - حسابات علمية'}).parseOfficialRoster(upload),
    /official academic advisor name/);
});
test('rejects rows without university codes',async()=>{
  const rows=[
    ['م','اسم الطالب','كود الطالب'],
    ['1','طالب تجربة جامعي الاول',''],
  ];
  await assert.rejects(()=>app({rows}).parseOfficialRoster(upload),/invalid university code/);
});