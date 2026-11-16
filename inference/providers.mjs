// Provider credentials never leave this server. No automatic provider fallback.
export const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL='qwen/qwen3.8-27b';
export function providerConfig({provider='local',upstream,model,upstreamKey='',allowRemote=false}){
  if(!['local','groq'].includes(provider))throw new Error('Unknown INFERENCE_PROVIDER');
  const url=new URL(upstream||(provider==='groq'?GROQ_URL:'http://127.0.0.1:8080/v1/chat/completions'));
  if(provider==='groq'){
    if(!allowRemote||url.href!==GROQ_URL)throw new Error('Groq requires explicit remote opt-in and the exact approved HTTPS endpoint');
    if(!upstreamKey||/REPLACE|CHANGE_ME|[\r\n]/i.test(upstreamKey))throw new Error('Configure a real server-side INFERENCE_API_KEY');
  }else{
    const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/v1/chat/completions'||(!local&&(!allowRemote||url.protocol!=='https:'))||!['http:','https:'].includes(url.protocol))throw new Error('Use a loopback endpoint or explicitly approved remote HTTPS endpoint');
  }
  return {url,model:model||(provider==='groq'?GROQ_MODEL:'Qwen3-8B'),body(payload){
    const {messages,tools,tool_choice}=payload;
    return {model:this.model,messages,...(tools?{tools,tool_choice}:{}),temperature:0.2,stream:false,
      ...(provider==='groq'?{max_completion_tokens:1200,reasoning_effort:'none'}:{max_tokens:1200,chat_template_kwargs:{enable_thinking:false}})};
  }};
}
export function validCompletion(data){
  if(!Array.isArray(data?.choices)||data.choices.length!==1)return false;
  const c=data.choices[0],m=c?.message;
  if(!m||!['stop','tool_calls'].includes(c.finish_reason))return false;
  if(m.tool_calls?.length)return c.finish_reason==='tool_calls'&&Array.isArray(m.tool_calls)&&m.tool_calls.length<=4&&m.tool_calls.every(t=>t.type==='function'&&typeof t.function?.name==='string'&&typeof t.function?.arguments==='string');
  return c.finish_reason==='stop'&&typeof m.content==='string'&&!!m.content.trim()&&m.content.length<=10000;
}
