// Only exact, unambiguous question templates bypass model planning. No calculations.
const planCache=new Map(); // At most 6 public routing plans; never questions/records/answers.
export function directPlan(body){
  if(body.history?.length)return null;
  const q=body.question.toLowerCase().trim().replace(/[?؟.!]+$/g,'').replace(/\s+/g,' ');
  const en=/^(?:what is my (?:maximum )?(?:(spring|fall|summer) )?credit limit|how many credit hours can i (?:take|register)(?: in (spring|fall|summer))?)$/;
  const ar=/^(?:كم ساعة (?:يمكنني|أستطيع|استطيع) تسجيلها(?: في (الربيع|الخريف|الصيف))?|ما (?:هو )?الحد الأقصى لساعات التسجيل(?: في (الربيع|الخريف|الصيف))?)$/;
  const match=en.exec(q)||ar.exec(q);if(!match)return null;
  const term={spring:'Spring',fall:'Fall',summer:'Summer','الربيع':'Spring','الخريف':'Fall','الصيف':'Summer'}[match[1]||match[2]]||body.context.term;
  const key=term+':'+body.context.hasTranscript;
  if(!planCache.has(key))planCache.set(key,body.context.hasTranscript?
    [{name:'credit_limit',input:{semester:term}},{name:'get_student_record',input:{}}]:
    [{name:'lookup_rule',input:{topic:'registration'}}]);
  return structuredClone(planCache.get(key));
}
export function explanationOnly(body){
  if(body.final)return true;
  const successful=body.evidence.filter(e=>!e.error);
  if(successful.some(e=>e.name==='find_course')&&!successful.some(e=>e.name==='check_course'))return false;
  return successful.some(e=>e.name!=='find_course');
}
export function compactEvidence(body){
  // Only the narrow credit-limit route can omit irrelevant record fields.
  // Preserve full deterministic evidence in the UI; retain version caveats for inference.
  const direct=directPlan(body);
  const unique=new Map();
  for(const item of body.evidence){
    const key=item.name+JSON.stringify(item.input);if(unique.has(key))continue;
    if(direct&&item.name==='get_student_record'&&!item.error){
      const r=item.result||{};unique.set(key,{...item,result:{program:r.program,bylaw_version:r.bylaw_version}});
    }else unique.set(key,item);
  }
  return [...unique.values()];
}
export function articleIds(value){
  const text=String(value).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const ids=[];
  for(const m of text.matchAll(/(?:\bArt(?:icle)?\.?\s*|المادة\s*)(\d+)(?:\s*[-–]\s*([a-zأابجدهو]))?/gi)){
    const suffix=({'أ':'a','ا':'a','ب':'b','ج':'c','د':'d','ه':'e','و':'f'})[m[2]]||m[2]?.toLowerCase();
    ids.push(m[1]+(suffix?'-'+suffix:''));
  }
  return [...new Set(ids)];
}
