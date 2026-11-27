// Interactive native ACP client. This is deliberately NOT a Sci-Agent model
// provider: no chat() adapter, automatic subagents, credential extraction,
// headless inference, or forwarding native-agent output into the evidence gate.
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

const need=(x,message)=>{if(!x)throw new Error(message);};
const A=methods.agent,C=methods.client;
// Preserve ordinary Unicode and newlines; remove terminal escape/control bytes,
// C1 controls and bidi overrides from untrusted agent-rendered text.
export const terminalText=value=>String(value??'').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,'');
const cancelled=()=>({outcome:{outcome:'cancelled'}});
export async function decidePermission(request,{sessionId,active,ask,write=console.log,signal}){
  if(!active()||signal?.aborted||request?.sessionId!==sessionId||!request.toolCall||!Array.isArray(request.options))return cancelled();
  const options=request.options.filter(o=>o&&typeof o.optionId==='string'&&typeof o.name==='string');
  const reject=options.find(o=>o.kind==='reject_once');
  const deny=()=>reject?{outcome:{outcome:'selected',optionId:reject.optionId}}:cancelled();
  const approve=options.filter(o=>o.kind==='allow_once');
  const call=request.toolCall;
  // Never persist an allow-always decision. Do not grant a permission for
  // which the agent has supplied no concrete action details.
  if(approve.length!==1||!reject||call.rawInput==null)return deny();
  let details;
  try{details=JSON.stringify({title:call.title,kind:call.kind,locations:call.locations,rawInput:call.rawInput,content:call.content},null,2);}catch{return deny();}
  if(!details||details.length>24000)return deny();
  write('\nNative agent permission request:\n'+terminalText(details));
  try{
    const answer=await ask('Allow this action once? Type yes to approve: ',{signal});
    if(answer.trim().toLowerCase()==='yes'&&active()&&!signal?.aborted)return {outcome:{outcome:'selected',optionId:approve[0].optionId}};
  }catch{}
  return deny();
}
export function modelChoices(configOptions){
  const option=Array.isArray(configOptions)?configOptions.find(c=>c.category==='model'&&c.type==='select'&&typeof c.id==='string'):null;
  if(!option||!Array.isArray(option.options))return null;
  const choices=option.options.flatMap(o=>Array.isArray(o?.options)?o.options:[o]).filter(o=>o&&typeof o.value==='string'&&typeof o.name==='string');
  return {id:option.id,currentValue:option.currentValue,choices:choices.map(({value,name})=>({value,name}))};
}

export class NativeAcpSession{
  #connection;#sessionId;#active=false;#turnAbort;#permissionQueue=Promise.resolve();#onUpdate;#ask;#write;#options=[];#closed=false;
  constructor(target,{ask,write=console.log,onUpdate}={}){
    this.#ask=ask;this.#write=write;this.#onUpdate=onUpdate;
    const app=client({name:'Sci-Agent native ACP client'});
    app.onRequest(C.session.requestPermission,({params,signal})=>{
      const turn=this.#active?this.#turnAbort:null;
      if(!turn)return cancelled();
      const queued=this.#permissionQueue.then(()=>decidePermission(params,{sessionId:this.#sessionId,active:()=>this.#active&&!this.#closed&&this.#turnAbort===turn,ask:this.#ask,write:this.#write,signal:AbortSignal.any([turn.signal,signal])}));
      this.#permissionQueue=queued.catch(()=>{});
      return queued;
    });
    // Do not offer client-side file/terminal/MCP capabilities. Unknown requests
    // are rejected by the SDK rather than run as arbitrary local operations.
    app.onNotification(C.session.update,({params})=>{
      if(this.#closed||params?.sessionId!==this.#sessionId)return;
      const u=params.update;
      if(!u)return;
      if(u.sessionUpdate==='config_option_update'&&Array.isArray(u.configOptions))this.#options=u.configOptions;
      if(!this.#active)return;
      // No hidden thought stream; display only ordinary messages and tool status.
      if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text')this.#onUpdate?.({type:'text',text:terminalText(u.content.text)});
      else if(u.sessionUpdate==='tool_call'||u.sessionUpdate==='tool_call_update')this.#onUpdate?.({type:'tool',text:terminalText([u.title,u.status].filter(Boolean).join(' — '))});
    });
    this.#connection=app.connect(target);
  }
  get signal(){return this.#connection.signal;}
  get models(){return modelChoices(this.#options);}
  async initialize(cwd){
    need(!this.#closed&&!this.#sessionId,'ACP session already initialized or closed');
    const timeout=()=>({cancellationSignal:AbortSignal.timeout(30000),stopWaitingOnCancel:true});
    const init=await this.#connection.agent.request(A.initialize,{protocolVersion:PROTOCOL_VERSION,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'sci-agent',title:'Sci-Agent',version:'0.10.7'}},timeout());
    need(init.protocolVersion===PROTOCOL_VERSION,'Unsupported ACP protocol version');
    let session;
    try{session=await this.#connection.agent.request(A.session.new,{cwd,mcpServers:[]},timeout());}
    catch(e){
      if(e?.code===-32000)throw new Error('Native agent authentication required; run sci-agent auth gemini login and retry');
      throw e;
    }
    need(typeof session.sessionId==='string'&&session.sessionId,'Agent returned no ACP session ID');
    this.#sessionId=session.sessionId;
    this.#options=Array.isArray(session.configOptions)?session.configOptions:[];
    return {agentInfo:init.agentInfo??null,models:this.models};
  }
  async selectModel(value){
    need(this.#sessionId&&!this.#active&&!this.#closed,'ACP session is busy or unavailable');
    const m=this.models;
    need(m&&m.choices.some(o=>o.value===value),'Model is not in the native agent catalog');
    const result=await this.#connection.agent.request(A.session.setConfigOption,{sessionId:this.#sessionId,configId:m.id,value},{cancellationSignal:AbortSignal.timeout(30000),stopWaitingOnCancel:true});
    need(Array.isArray(result.configOptions),'Agent did not confirm configuration');
    this.#options=result.configOptions;
    need(this.models?.currentValue===value,'Agent did not confirm selected model');
    return this.models;
  }
  async prompt(text){
    need(typeof text==='string'&&text.trim()&&text.length<=100000,'Enter a non-empty prompt (max 100000 characters)');
    need(this.#sessionId&&!this.#active&&!this.#closed,'ACP session is busy or unavailable');
    this.#active=true;this.#turnAbort=new AbortController();
    try{
      const result=await this.#connection.agent.request(A.session.prompt,{sessionId:this.#sessionId,prompt:[{type:'text',text}]});
      return {stopReason:result.stopReason};
    }finally{
      this.#active=false;this.#turnAbort.abort();await this.#permissionQueue;
    }
  }
  async cancel(){
    if(!this.#active||this.#closed)return;
    this.#turnAbort?.abort();
    await this.#connection.agent.notify(A.session.cancel,{sessionId:this.#sessionId});
  }
  close(){
    if(this.#closed)return;
    this.#closed=true;this.#active=false;this.#turnAbort?.abort();this.#connection.close();
  }
}
export function acpStream(child){
  return ndJsonStream(Writable.toWeb(child.stdin),Readable.toWeb(child.stdout),{maxMessageBytes:8*1024*1024});
}
