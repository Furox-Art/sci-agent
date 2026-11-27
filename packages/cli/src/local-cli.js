import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalModels, LOCAL_RUNTIMES } from '@sci/core';
import { question, clean } from './chatgpt-cli.js';

const hints={
 ollama:'Install Ollama from https://ollama.com; start ollama serve and download a tool-capable local model yourself.',
 lmstudio:'Start LM Studio local server (lms server start --bind 127.0.0.1 --port 1234) and load/download a model yourself.',
 llamacpp:'Start llama-server with your local GGUF model, --host 127.0.0.1 --port 8080 and compatible tool chat template.',
 vllm:'Start vllm serve with your downloaded model and model-specific tool calling options, --host 127.0.0.1 --port 8000.',
 custom:'Start your local OpenAI-compatible server with /v1/models and /v1/chat/completions.'
};
export function parseLocalArgs(argv){
 const options={runtime:'ollama'},rest=[],seen=new Set();
 for(let i=0;i<argv.length;i++){
   const a=argv[i];
   if(['--local','--local-model','--local-url','--local-timeout'].includes(a)){
     if(seen.has(a)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing or duplicate '+a);
     seen.add(a);const v=argv[++i];
     if(a==='--local')options.runtime=v;
     if(a==='--local-model')options.model=v;
     if(a==='--local-url')options.baseUrl=v;
     if(a==='--local-timeout')options.timeoutMs=Number(v)*1000;
   }else if(a==='--local-start'){
     if(seen.has(a))throw Error('Duplicate '+a);
     seen.add(a);options.start=true;
   }else if(a==='--prompt'||a==='--workspace'){
     if(!argv[i+1])throw Error('Missing '+a);
     rest.push(a,argv[++i]);
   }else if(a==='--sandbox')rest.push(a);
   else throw Error('Unsupported local option: '+a);
 }
 if(!Object.hasOwn(LOCAL_RUNTIMES,options.runtime))throw Error('Choose ollama, lmstudio, llamacpp, vllm or custom');
 if(options.start&&(options.runtime!=='ollama'||options.baseUrl))throw Error('--local-start supports only the default local Ollama server');
 return {options,rest};
}
async function connect(options){
 const local=new LocalModels({...options,apiKey:process.env.SCI_AGENT_LOCAL_API_KEY??''});
 let child,started=false;
 const close=async()=>{
   if(child&&child.exitCode===null&&child.signalCode===null){
     const exited=new Promise(r=>child.once('close',r));child.kill('SIGTERM');
     await Promise.race([exited,delay(1500)]);
     if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
   }
 };
 try{
   let models;
   try{models=await local.models();}
   catch(e){
     if(!options.start)throw Error(e.message+' '+hints[options.runtime]);
     // Only explicit user request may start an installed runtime. No install, pull or cloud login.
     const env={...process.env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1'};
     delete env.OLLAMA_API_KEY;
     child=spawn('ollama',['serve'],{shell:false,stdio:'ignore',env,windowsHide:true});
     await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error(hints.ollama)));});
     started=true;
     for(let i=0;i<30;i++){
       if(child.exitCode!==null||child.signalCode!==null)throw Error('Ollama server exited before readiness');
       try{models=await local.models();break;}catch{await delay(500);}
     }
     if(!models)throw Error('Ollama server did not become ready');
   }
   return {local,models,started,close};
 }catch(e){await close();throw e;}
}
function display(models){
 models.forEach((m,i)=>console.log((i+1)+'. '+clean(m.id)+(m.parameters?' | '+clean(m.parameters):'')+(m.quantization?' | '+clean(m.quantization):'')+(m.bytes?' | '+(m.bytes/1024**3).toFixed(2)+' GiB on disk':'')));
}
export async function launchLocal(argv,startRepl){
 const {options,rest}=parseLocalArgs(argv);
 const conn=await connect(options);
 try{
   if(!conn.models.length)throw Error('No local models listed. '+hints[options.runtime]);
   let model=options.model;
   if(!model){
     if(!process.stdin.isTTY||!process.stdout.isTTY||rest.includes('--prompt'))throw Error('Non-interactive local mode requires --local-model <listed model>');
     display(conn.models);const choice=(await question('Select local model: ')).trim();
     if(!/^\d+$/.test(choice)||!conn.models[Number(choice)-1])throw Error('Invalid local model selection');
     model=conn.models[Number(choice)-1].id;
   }
   const provider=await conn.local.provider(model,{timeoutMs:options.timeoutMs});
   console.log('Local inference: '+clean(model)+' @ '+provider.baseUrl+' | Uses your own hardware; server/tool privacy depends on configuration.');
   await startRepl(rest,{connection:{kind:'local-model',model,provider,label:'Local '+LOCAL_RUNTIMES[options.runtime].name,usageUrl:null}});
 }finally{await conn.close();}
}
export async function localCommand(argv){
 const action=argv[0];
 if(!['models','status'].includes(action)){console.log('sci-agent local models|status --local <runtime> [--local-url URL]');return;}
 const {options,rest}=parseLocalArgs(argv.slice(1));
 if(rest.length||options.start||options.model||options.timeoutMs!==undefined)throw Error('Only runtime and endpoint options are allowed for local status/models');
 const c=await connect(options);
 try{console.log(LOCAL_RUNTIMES[options.runtime].name+' reachable at '+c.local.baseUrl+' | '+c.models.length+' model(s)');if(action==='models')display(c.models);}
 finally{await c.close();}
}
