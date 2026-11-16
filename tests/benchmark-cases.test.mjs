import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkCases,verifyBenchmark} from '../inference/benchmark-cases.mjs';
import {engine} from './fixtures/academic-engine.mjs';
test('six bilingual benchmark cases require actual tools, correct values and relevant articles',()=>{
  const e=engine();assert.equal(benchmarkCases.length,6);
  for(const item of benchmarkCases){
    const name=item.topic==='credits'?'credit_limit':item.topic==='course'?'check_course':'get_student_record';
    const input=name==='check_course'?{course_code:'CS142',semester:'Spring'}:{};
    const text=item.topic==='credits'?'18 hours Art. 9-c':item.topic==='course'?'CS142 is eligible; prerequisite CS141. Art. 9-e':'CGPA 3.35, Art. 14, Art. 15';
    const answer={text,records:[{name,input,result:e.run(name,input)}]};
    assert.ok(verifyBenchmark(item,answer,e));
    assert.throws(()=>verifyBenchmark(item,{...answer,records:[]},e));
    assert.throws(()=>verifyBenchmark(item,{...answer,text:'Invented: Art. 999'},e));
    if(item.topic==='cgpa')assert.throws(()=>verifyBenchmark(item,{...answer,text:'3.35 (ممتاز جداً). Art. 14, Art. 15'},e));
  }
});
