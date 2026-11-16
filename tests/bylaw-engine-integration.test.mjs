// Execute the real, unchanged academic code with synthetic transcript data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {engine} from "./fixtures/academic-engine.mjs";
import "../supabase/functions/_shared/bylaw-protocol.js";

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
