import { OpenAICompatProvider } from './provider.js';
export const LOCAL_RUNTIMES=Object.freeze({
  ollama:{name:'Ollama',port:11434},
  lmstudio:{name:'LM Studio',port:1234},
  llamacpp:{name:'llama.cpp',port:8080},
  vllm:{name:'vLLM',port:8000},
  custom:{name:'Other local OpenAI-compatible server',port:null},
});
const need=(x,m)=>{if(!x)throw Error(m);};
export function localEndpoint(runtime,baseUrl){
  need(Object.hasOwn(LOCAL_RUNTIMES,runtime),'Unknown local runtime');
  const value=baseUrl??(LOCAL_RUNTIMES[runtime].port?'http://127.0.0.1:'+LOCAL_RUNTIMES[runtime].port+'/v1':null);
  need(typeof value==='string','Custom runtime requires --local-url http://127.0.0.1:PORT/v1');
  // Explicit literal loopback only; no DNS, remote hosts, credentials, queries or redirects.
  need(/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}\/v1\/?$/.test(value),'Local mode requires http://127.0.0.1:PORT/v1 (or localhost / [::1])');
  let u;try{u=new URL(value);}catch{throw Error('Invalid local endpoint');}
  if(u.hostname==='localhost')u.hostname='127.0.0.1';
  return u.href.replace(/\/$/,'');
}
const safeId=s=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=512&&!/[\x00-\x1f\x7f]/.test(s);
const cloudName=s=>/(?:^|[-:/])cloud(?:$|[-:/])/i.test(s)||/^https?:/i.test(s);
const remote=m=>Boolean(m?.remote_host||m?.remote_model||m?.details?.remote_host||m?.details?.remote_model);
async function readJson(res,max=8*1024*1024){
  const reader=res.body?.getReader();
  need(reader,'Empty local server response');
  const chunks=[];let n=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max){await reader.cancel();throw Error('Local catalog response too large');}chunks.push(value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid local server JSON');}
}
export class LocalModels {
  #fetch;#key;#catalog=[];
  constructor({runtime,baseUrl,apiKey='',fetchImpl=fetch}={}){
    this.runtime=runtime;this.baseUrl=localEndpoint(runtime,baseUrl);
    this.#fetch=fetchImpl;this.#key=apiKey;
  }
  async #request(url,opts={},timeout=10000){
    const root=this.baseUrl.slice(0,-3);
    need(url.startsWith(root+'/'),'Unexpected local destination');
    const signal=opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
    let res;try{res=await this.#fetch(url,{...opts,signal,redirect:'error',headers:{...opts.headers,...(this.#key?{authorization:'Bearer '+this.#key}:{})}});}
    catch{throw Error('Local model server unavailable or timed out: '+this.baseUrl);}
    if(!res.ok)throw Error('Local model server HTTP '+res.status+' at '+this.baseUrl);
    return res;
  }
  async models(){
    const ollama=this.runtime==='ollama';
    const data=await readJson(await this.#request(ollama?this.baseUrl.slice(0,-3)+'/api/tags':this.baseUrl+'/models'));
    const rows=ollama?data.models:data.data;
    need(Array.isArray(rows),'Unexpected local model catalog');
    const seen=new Set();
    this.#catalog=[];
    for(const m of rows){
      const id=ollama?(m?.model??m?.name):m?.id;
      if(!safeId(id)||seen.has(id)||(ollama&&(cloudName(id)||remote(m))))continue;
      seen.add(id);
      this.#catalog.push({id,bytes:ollama&&Number.isSafeInteger(m.size)&&m.size>0?m.size:null,parameters:ollama&&safeId(m.details?.parameter_size)?m.details.parameter_size:null,quantization:ollama&&safeId(m.details?.quantization_level)?m.details.quantization_level:null});
    }
    return structuredClone(this.#catalog);
  }
  async inspect(model){
    need(this.#catalog.some(m=>m.id===model),'Select a model listed by the local server');
    if(this.runtime!=='ollama')return {tools:'unknown'};
    const m=await readJson(await this.#request(this.baseUrl.slice(0,-3)+'/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model})}));
    need(!remote(m)&&!cloudName(model),'Remote/cloud Ollama models are not allowed in local mode');
    const caps=Array.isArray(m.capabilities)?m.capabilities:null;
    if(caps&&!caps.includes('tools'))throw Error('Selected Ollama model does not advertise tool support');
    return {tools:caps?'advertised':'unknown'};
  }
  async provider(model,{stream=true,timeoutMs=600000}={}){
    await this.inspect(model);
    need(Number.isFinite(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=3600000,'Local timeout must be 1–3600 seconds');
    const base=this.baseUrl;
    const p=new OpenAICompatProvider({baseUrl:base,name:model,stream,fetchImpl:(url,opts)=>{
      need(url===base+'/chat/completions','Unexpected local inference endpoint');
      return this.#request(url,opts,timeoutMs);
    }});
    return {model,baseUrl:base,chat:args=>p.chat(args)};
  }
}
