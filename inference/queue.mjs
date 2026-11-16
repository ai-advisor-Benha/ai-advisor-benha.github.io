import {setTimeout as delay} from 'node:timers/promises';
export function retrySeconds(value,now=Date.now()){
  if(value===null||value===undefined||String(value).trim()==='')return 60;
  const n=Number(value),seconds=Number.isFinite(n)?n:(Date.parse(value)-now)/1000;
  return Number.isFinite(seconds)&&seconds>=0?Math.max(1,Math.min(86400,Math.ceil(seconds))):60;
}
const busy=seconds=>Object.assign(new Error('rate_limited'),{code:'rate_limited',status:429,retryAfter:Math.max(1,Math.ceil(seconds))});
// One FIFO shared by all subjects using this provider process. No prompts persisted.
export function createQueue({concurrency=1,maxPending=4,maxWaitMs=12000,requestTimeoutMs=45000,maxRetries=1,now=Date.now,sleep=(ms,signal)=>delay(ms,undefined,{signal})}={}){
  let active=0,cooldownUntil=0;const pending=[];
  function pump(){
    while(active<concurrency&&pending.length){
      const job=pending.shift();clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.cancel);
      if(job.signal?.aborted){job.reject(job.signal.reason);continue;}
      active++;job.resolve(()=>{active--;pump();});
    }
  }
  function acquire(signal){
    signal?.throwIfAborted();
    if(active>=concurrency&&pending.length>=maxPending)return Promise.reject(busy(5));
    return new Promise((resolve,reject)=>{
      const job={resolve,reject,signal};
      job.cancel=()=>{const i=pending.indexOf(job);if(i>=0)pending.splice(i,1);clearTimeout(job.timer);signal?.removeEventListener('abort',job.cancel);reject(signal?.aborted?signal.reason:busy(5));};
      job.timer=setTimeout(job.cancel,maxWaitMs);signal?.addEventListener('abort',job.cancel,{once:true});pending.push(job);pump();
    });
  }
  return {async run({subject,tokens,quota,signal},attempt){
    const started=now(),deadline=started+requestTimeoutMs;
    const bounded=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(requestTimeoutMs)]);
    const release=await acquire(bounded);
    try{
      for(let tries=0;;tries++){
        const wait=Math.max(0,cooldownUntil-now());
        if(wait>0){if(wait>maxWaitMs||now()+wait>=deadline)throw busy(wait/1000);await sleep(wait,bounded);}
        bounded.throwIfAborted();
        let reservation=quota.reserve?quota.reserve(subject,tokens):{ok:quota.take(subject,tokens),retryAfter:60};
        if(!reservation.ok){
          const waitMs=reservation.retryAfter*1000;
          if(reservation.retryable&&waitMs<=maxWaitMs&&now()+waitMs<deadline){await sleep(waitMs,bounded);reservation=quota.reserve(subject,tokens);}
          if(!reservation.ok)throw busy(reservation.retryAfter||60);
        }
        const result=await attempt(bounded);
        if(result.rateLimited){
          const seconds=retrySeconds(result.retryAfter,now());cooldownUntil=Math.max(cooldownUntil,now()+seconds*1000);
          if(tries>=maxRetries||seconds*1000>maxWaitMs||now()+seconds*1000>=deadline)throw busy(seconds);
          continue;
        }
        // Only validated provider numeric usage can release over-reserved tokens.
        if(Number.isSafeInteger(result.usage)&&result.usage>=0&&result.usage<=1000000)reservation.settle?.(result.usage);
        return result.value;
      }
    }finally{release();}
  },snapshot:()=>({active,pending:pending.length,cooldownUntil})};
}
