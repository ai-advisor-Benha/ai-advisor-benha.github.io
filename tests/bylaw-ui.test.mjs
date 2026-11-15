import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import '../supabase/functions/_shared/bylaw-protocol.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('website assistant opens its own chat without Claude branding or redirects',()=>{
  for(const removed of ['qaLinkMode','CLAUDE_VERSION_URL','Open the Claude version','The AI assistant runs on Claude','qaSigninBtn','qaLinkBtn'])assert.ok(!source.includes(removed),removed);
  const page=ui(async()=>({text:'test'}));
  assert.equal(page.context.I18N.en.qaTitle,'Ask the Bylaw');
  assert.equal(page.context.I18N.ar.qaTitle,'اسأل اللائحة');
  assert.ok(source.includes('src="./bylaw-assistant.js"'));
  assert.ok(!/claude|كلود/i.test(page.context.I18N.en.qaSub+page.context.I18N.ar.qaSub));
});
function ui(ask){
  const elements=new Map();
  const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'',classList:{toggle(){},remove(){}}});return elements.get(id);};
  const context={window:{},BylawProtocol:globalThis.BylawProtocol,AbortController,LANG:'ar',I18N:{en:{},ar:{}},$,
    S:{session:{email:'private@example.edu'},transcript:null,plan:[],term:'Spring'},
    dept:()=>({name:'Scientific Computing'}),t:key=>key,logUsage(){},AGENT_TOOLS:[],unverifiedFigures:()=>[],
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../bylaw-assistant.js',import.meta.url),'utf8'),context);
  context.BylawAssistant=context.window.BylawAssistant;
  context.BylawAssistant.ask=ask;
  vm.runInContext(source.slice(source.indexOf('let qaTurns ='),source.indexOf('/* ---- helpers used by the tools ---- */')),context);
  vm.runInContext(source.slice(source.indexOf('function renderQA()'),source.indexOf('/* ---- Target semester chosen automatically')),context);
  return {context,$,run:code=>vm.runInContext(code,context)};
}
test('actual chat UI escapes model/evidence HTML and answers English in Arabic UI',async()=>{
  let payload;
  const page=ui(async args=>{payload=args;args.onEvidence({name:'credit_limit',result:{max_hours:18,article:'Art. 9-c <script>bad</script>'}});return {text:'<img src=x onerror=bad> 18 hours'};});
  await page.run("askQA('What is my credit limit?')");
  assert.equal(payload.language,'en');
  const html=page.$('qa-log').innerHTML;
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Art. 9-c'));
  assert.ok(html.includes('dir="auto"'));assert.equal(page.$('qa-send').disabled,false);
});
test('actual chat UI gates authentication and renders Arabic service failures',async()=>{
  let calls=0;const page=ui(async()=>{calls++;throw {code:'unavailable'};});
  page.context.S.session=null;await page.run("askQA('ما هو المعدل؟')");assert.equal(calls,0);
  assert.equal(page.$('qa-err').textContent,globalThis.BylawProtocol.message('unauthorized','ar'));
  page.context.S.session={};await page.run("askQA('ما هو المعدل؟')");assert.equal(calls,1);
  assert.ok(page.$('qa-log').innerHTML.includes(globalThis.BylawProtocol.message('unavailable','ar')));
});
test('chat reset cancels in-flight work and clears session conversation',async()=>{
  let release,signal;const page=ui(args=>{signal=args.signal;return new Promise(resolve=>{release=resolve;});});
  const pending=page.run("askQA('My GPA?')");page.run('resetQA()');assert.equal(signal.aborted,true);
  release({text:'old session answer'});await pending;
  assert.equal(page.run('qaTurns.length'),0);assert.equal(page.$('qa-log').textContent,'');
});
