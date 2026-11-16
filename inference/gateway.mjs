// Node 24+ self-hosted gateway. SQLite quotas survive restarts; no Supabase writes.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {providerConfig,validCompletion} from './providers.mjs';
import {createQueue} from './queue.mjs';

export function createQuota(path,{perMinute=12,perDay=80,globalPerDay=240,tokensPerMinute=Infinity,tokensPerDay=Infinity,now=()=>Date.now()}={}){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS quota (subject TEXT, window TEXT, count INTEGER NOT NULL, PRIMARY KEY(subject,window));');
  const read=db.prepare('SELECT count FROM quota WHERE subject=? AND window=?');
  const add=db.prepare('INSERT INTO quota VALUES (?,?,?) ON CONFLICT(subject,window) DO UPDATE SET count=count+excluded.count');
  const api={reserve(subject,tokens=0){
    if(!Number.isSafeInteger(tokens)||tokens<0)throw new Error('Invalid token reservation');
    const minute=Math.floor(now()/60000),day=Math.floor(now()/86400000);
    const windows=[[subject,`m:${minute}`,perMinute,1],[subject,`d:${day}`,perDay,1],['global',`d:${day}`,globalPerDay,1],['tokens',`m:${minute}`,tokensPerMinute,tokens],['tokens',`d:${day}`,tokensPerDay,tokens]];
    db.exec('BEGIN IMMEDIATE');
    try{
      const blocked=windows.filter(([s,w,max,n])=>(read.get(s,w)?.count||0)+n>max);
      if(blocked.length){
        db.exec('ROLLBACK');
        const daily=blocked.some(([,w])=>w.startsWith('d:')),oversize=blocked.some(([, ,max,n])=>n>max);
        return {ok:false,retryable:!daily&&!oversize,retryAfter:daily?Math.ceil((86400000-now()%86400000)/1000):Math.ceil((60000-now()%60000)/1000)};
      }
      for(const [s,w,,n] of windows)add.run(s,w,n);
      db.prepare("DELETE FROM quota WHERE (window LIKE 'm:%' AND CAST(substr(window,3) AS INTEGER) < ?) OR (window LIKE 'd:%' AND CAST(substr(window,3) AS INTEGER) < ?)").run(minute-2,day-1);
      db.exec('COMMIT');let settled=false;
      return {ok:true,settle(actual){
        if(settled||!Number.isSafeInteger(actual)||actual<0)return;settled=true;
        db.exec('BEGIN IMMEDIATE');
        try{
          const update=db.prepare('UPDATE quota SET count=max(0,count+?) WHERE subject=? AND window=?');
          update.run(actual-tokens,'tokens',`m:${minute}`);update.run(actual-tokens,'tokens',`d:${day}`);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
      }};
    }catch(e){db.exec('ROLLBACK');throw e;}
  },take(subject,tokens=0){return api.reserve(subject,tokens).ok;},close(){db.close();}};
  return api;
}
export function createGateway({secret,upstream,model,quota,upstreamKey='',provider='local',maxConcurrent=2,maxPending=4,maxWaitMs=12000,requestTimeoutMs=45000,allowRemote=false,fetchImpl=fetch}){
  if(!secret||secret.length<32||/REPLACE_WITH|CHANGE_ME/i.test(secret))throw new Error('GATEWAY_SECRET must be a random secret of at least 32 characters');
  const adapter=providerConfig({provider,upstream,model,upstreamKey,allowRemote});
  const queue=createQueue({concurrency:maxConcurrent,maxPending,maxWaitMs,requestTimeoutMs});
  return createServer(async(req,res)=>{
    const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...(status===429?{'retry-after':String(value.retryAfter||60)}:{})});res.end(JSON.stringify(value));};
    if(req.method!=='POST'||req.url!=='/infer')return send(404,{code:'not_found'});
    const got=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+secret);
    if(got.length!==expected.length||!timingSafeEqual(got,expected))return send(401,{code:'unauthorized'});
    const controller=new AbortController();
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try{
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>64000)return send(413,{code:'invalid_input'});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(400,{code:'invalid_input'});}
      if(!/^[a-f0-9]{64}$/.test(body.subject||'')||!Array.isArray(body.payload?.messages)||body.payload.messages.length!==2)return send(400,{code:'invalid_input'});
      const providerBody=adapter.body(body.payload);
      // Planning estimate, not Groq's tokenizer; upstream remains authoritative.
      // Reserve maximum output too and never refund failed calls.
      const tokenReservation=Math.ceil(Buffer.byteLength(JSON.stringify(providerBody),'utf8')/3)+1200+256;
      let providerAttempts=0;const requestStarted=performance.now();
      const value=await queue.run({subject:body.subject,tokens:tokenReservation,quota,signal:controller.signal},async signal=>{
        providerAttempts++;
        const upstreamResponse=await fetchImpl(adapter.url,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(upstreamKey?{Authorization:'Bearer '+upstreamKey}:{})},
        body:JSON.stringify(providerBody),
        signal});
        if(!upstreamResponse.ok){await upstreamResponse.body?.cancel();if(upstreamResponse.status===429)return {rateLimited:true,retryAfter:upstreamResponse.headers.get('retry-after')};throw {code:'unavailable',status:503};}
        const reader=upstreamResponse.body.getReader();let total=0;const output=[];
        while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>64000){await reader.cancel();throw {code:'unavailable',status:502};}output.push(value);}
        const result=JSON.parse(Buffer.concat(output).toString());
        if(!validCompletion(result))throw {code:'unavailable',status:502};
        return {value:result,usage:result.usage?.total_tokens};
      });
      return send(200,{...value,gateway_meta:{provider_attempts:providerAttempts,elapsed_ms:Math.round(performance.now()-requestStarted)}});
    }catch(e){const code=['rate_limited','unavailable','invalid_input'].includes(e?.code)?e.code:e?.name==='TimeoutError'?'timeout':'unavailable';return send(e?.status||(code==='timeout'?504:503),{code,...(code==='rate_limited'&&e?.retryAfter?{retryAfter:e.retryAfter}:{})});}
    finally{res.off('close',disconnect);}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const e=process.env;
  const number=(key,fallback)=>{const n=Number(e[key]||fallback);if(!Number.isInteger(n)||n<1)throw new Error(`Invalid ${key}`);return n;};
  const provider=e.INFERENCE_PROVIDER||'local';
  const quota=createQuota(e.QUOTA_DB||'/var/lib/bylaw/quota.sqlite',{perMinute:number('USER_CALLS_PER_MINUTE',12),perDay:number('USER_CALLS_PER_DAY',80),globalPerDay:number('GLOBAL_CALLS_PER_DAY',240),tokensPerMinute:provider==='groq'?number('GLOBAL_TOKENS_PER_MINUTE',8000):Infinity,tokensPerDay:provider==='groq'?number('GLOBAL_TOKENS_PER_DAY',200000):Infinity});
  const server=createGateway({secret:e.GATEWAY_SECRET,provider,upstream:e.INFERENCE_URL||undefined,model:e.INFERENCE_MODEL||undefined,quota,upstreamKey:e.INFERENCE_API_KEY||'',allowRemote:e.ALLOW_REMOTE_INFERENCE==='true',maxConcurrent:number('MAX_CONCURRENT',1),maxPending:number('MAX_PENDING',4)});
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.listen(number('PORT',8787),'127.0.0.1',()=>console.log('Bylaw gateway listening on loopback; request bodies and credentials are not logged.'));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>{quota.close();process.exit(0);}));
}
