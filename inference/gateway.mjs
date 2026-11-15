// Node 24+ self-hosted gateway. SQLite quotas survive restarts; no Supabase writes.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function createQuota(path,{perMinute=12,perDay=80,globalPerDay=240,now=()=>Date.now()}={}){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS quota (subject TEXT, window TEXT, count INTEGER NOT NULL, PRIMARY KEY(subject,window));');
  const read=db.prepare('SELECT count FROM quota WHERE subject=? AND window=?');
  const add=db.prepare('INSERT INTO quota VALUES (?,?,1) ON CONFLICT(subject,window) DO UPDATE SET count=count+1');
  return {take(subject){
    const minute=Math.floor(now()/60000),day=Math.floor(now()/86400000);
    const windows=[[subject,`m:${minute}`,perMinute],[subject,`d:${day}`,perDay],['global',`d:${day}`,globalPerDay]];
    db.exec('BEGIN IMMEDIATE');
    try{
      if(windows.some(([s,w,max])=>(read.get(s,w)?.count||0)>=max)){db.exec('ROLLBACK');return false;}
      for(const [s,w] of windows)add.run(s,w);
      db.prepare("DELETE FROM quota WHERE (window LIKE 'm:%' AND CAST(substr(window,3) AS INTEGER) < ?) OR (window LIKE 'd:%' AND CAST(substr(window,3) AS INTEGER) < ?)").run(minute-2,day-1);
      db.exec('COMMIT');return true;
    }catch(e){db.exec('ROLLBACK');throw e;}
  },close(){db.close();}};
}
export function createGateway({secret,upstream,model,quota,upstreamKey='',maxConcurrent=2,allowRemote=false,fetchImpl=fetch}){
  if(!secret||secret.length<32||/REPLACE_WITH|CHANGE_ME/i.test(secret))throw new Error('GATEWAY_SECRET must be a random secret of at least 32 characters');
  const url=new URL(upstream);
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/v1/chat/completions'||
    (!local&&(!allowRemote||url.protocol!=='https:'))||!['https:','http:'].includes(url.protocol))throw new Error('Use a loopback inference server, or explicitly approve a remote HTTPS endpoint');
  if(!model)throw new Error('INFERENCE_MODEL required');
  let active=0;
  return createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...(status===429?{'retry-after':'60'}:{})});res.end(JSON.stringify(value));};
    if(req.method!=='POST'||req.url!=='/infer')return send(404,{code:'not_found'});
    const got=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+secret);
    if(got.length!==expected.length||!timingSafeEqual(got,expected))return send(401,{code:'unauthorized'});
    let counted=false;
    try{
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>64000)return send(413,{code:'invalid_input'});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(400,{code:'invalid_input'});}
      if(!/^[a-f0-9]{64}$/.test(body.subject||'')||!Array.isArray(body.payload?.messages)||body.payload.messages.length!==2)return send(400,{code:'invalid_input'});
      if(active>=maxConcurrent)return send(429,{code:'rate_limited'});
      if(!quota.take(body.subject))return send(429,{code:'rate_limited'});
      active++;counted=true;
      // Do not forward subject, gateway authorization, Supabase tokens or arbitrary provider fields.
      const {messages,tools,tool_choice}=body.payload;
      const controller=new AbortController();
      const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
      let upstreamResponse;
      try{upstreamResponse=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...(upstreamKey?{Authorization:'Bearer '+upstreamKey}:{})},
        body:JSON.stringify({model,messages,...(tools?{tools,tool_choice}:{}),temperature:0.2,max_tokens:1200,stream:false,chat_template_kwargs:{enable_thinking:false}}),
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(50000)])});
        if(!upstreamResponse.ok)return send(503,{code:'unavailable'});
        const reader=upstreamResponse.body.getReader();let total=0;const output=[];
        while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>64000){await reader.cancel();return send(502,{code:'unavailable'});}output.push(value);}
        const result=JSON.parse(Buffer.concat(output).toString());
        return send(200,result);
      }finally{res.off('close',disconnect);}
    }catch{return send(503,{code:'unavailable'});}
    finally{if(counted)active--;}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const e=process.env;
  const number=(key,fallback)=>{const n=Number(e[key]||fallback);if(!Number.isInteger(n)||n<1)throw new Error(`Invalid ${key}`);return n;};
  const quota=createQuota(e.QUOTA_DB||'/var/lib/bylaw/quota.sqlite',{perMinute:number('USER_CALLS_PER_MINUTE',12),perDay:number('USER_CALLS_PER_DAY',80),globalPerDay:number('GLOBAL_CALLS_PER_DAY',240)});
  const server=createGateway({secret:e.GATEWAY_SECRET,upstream:e.INFERENCE_URL||'http://127.0.0.1:8080/v1/chat/completions',model:e.INFERENCE_MODEL||'Qwen3-8B',quota,upstreamKey:e.INFERENCE_API_KEY||'',allowRemote:e.ALLOW_REMOTE_INFERENCE==='true',maxConcurrent:number('MAX_CONCURRENT',2)});
  server.requestTimeout=15000;server.headersTimeout=10000;
  server.listen(number('PORT',8787),'127.0.0.1',()=>console.log('Bylaw gateway listening on loopback; request bodies and credentials are not logged.'));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>{quota.close();process.exit(0);}));
}
