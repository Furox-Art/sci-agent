// Adapter from Sci-Agent's chat-completions-style history to the public Responses API.
const need=(ok,m)=>{if(!ok)throw new Error(m);};
function parseArgs(raw){
  try{const a=JSON.parse(raw);return a&&typeof a==='object'&&!Array.isArray(a)?a:{_raw:raw};}catch{return {_raw:String(raw??'')};}
}
export function responsesInput(messages,replay=new Map()){
  const input=[];
  for(const m of messages){
    if(m.role==='tool'){
      need(typeof m.tool_call_id==='string'&&m.tool_call_id,'Missing tool call ID');
      input.push({type:'function_call_output',call_id:m.tool_call_id,output:String(m.content??'')});
      continue;
    }
    need(['system','developer','user','assistant'].includes(m.role),'Unsupported message role');
    const content=typeof m.content==='string'?m.content:'';
    const calls=m.role==='assistant'?(m.tool_calls??[]):[];
    if(calls.length){
      const previous=replay.get(calls[0].id);
      // Replay the exact completed output (including encrypted reasoning items)
      // when it corresponds to this assistant tool-call message.
      if(previous&&previous.calls.length===calls.length&&previous.content===content&&calls.every((c,i)=>c.id===previous.calls[i].call_id&&c.function?.name===previous.calls[i].name&&c.function?.arguments===previous.calls[i].arguments)){
        input.push(...previous.items);continue;
      }
    }
    if(content||!calls.length)input.push({role:m.role==='system'?'developer':m.role,content});
    for(const c of calls){
      need(typeof c.id==='string'&&typeof c.function?.name==='string'&&typeof c.function?.arguments==='string','Malformed history function call');
      input.push({type:'function_call',call_id:c.id,name:c.function.name,arguments:c.function.arguments});
    }
  }
  return input;
}
export async function readCompletedResponse(res,signal){
  need(res.body&&typeof res.body.getReader==='function','Missing ChatGPT response stream');
  const reader=res.body.getReader(),decoder=new TextDecoder();
  let buffer='',eventData=[],completed=null,total=0;
  const processEvent=()=>{
    if(!eventData.length)return;
    const raw=eventData.join('\n');eventData=[];
    if(raw==='[DONE]')return;
    let event;try{event=JSON.parse(raw);}catch{throw new Error('Invalid ChatGPT stream event');}
    if(['response.failed','response.incomplete','error'].includes(event.type))throw new Error('ChatGPT inference did not complete: '+event.type);
    if(event.type==='response.completed'){
      need(!completed&&event.response?.status==='completed'&&Array.isArray(event.response.output),'Invalid completed ChatGPT response');
      completed=event.response;
    }
  };
  const line=l=>{
    if(l.endsWith('\r'))l=l.slice(0,-1);
    if(!l){processEvent();return;}
    if(l.startsWith('data:'))eventData.push(l.slice(5).replace(/^ /,''));
  };
  try{
    while(true){
      signal?.throwIfAborted();
      const {value,done}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      need(total<=32*1024*1024,'ChatGPT response stream exceeds limit');
      buffer+=decoder.decode(value,{stream:true});
      let n;while((n=buffer.indexOf('\n'))>=0){line(buffer.slice(0,n));buffer=buffer.slice(n+1);}
      // Do not execute anything until an explicit completed event arrives.
      if(completed)break;
    }
    buffer+=decoder.decode();
    if(!completed&&buffer)line(buffer);
    if(!completed)processEvent();
    need(completed,'ChatGPT stream ended without response.completed');
    return completed;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export class ChatGPTPlanProvider {
  #auth;#replay=new Map();
  constructor({auth,model}={}){
    need(auth&&typeof auth.api==='function'&&typeof model==='string'&&model.trim(),'ChatGPT connection and selected model required');
    this.#auth=auth;this.model=model;this.baseUrl='https://api.openai.com/v1';this.stream=true;
  }
  async chat({messages,tools=[],signal}={}){
    const body={model:this.model,input:responsesInput(messages,this.#replay),store:false,stream:true,include:['reasoning.encrypted_content']};
    if(tools.length)body.tools=tools.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.parameters,strict:false}));
    if(signal?.aborted)signal.throwIfAborted();
    const response=await readCompletedResponse(await this.#auth.api('/responses',{method:'POST',body:JSON.stringify(body),signal}),signal);
    let content='';
    const calls=[],items=[];
    for(const item of response.output){
      if(item.type==='message'){
        need(item.role==='assistant'&&Array.isArray(item.content),'Malformed assistant output');
        for(const p of item.content){
          if(p.type==='output_text'){need(typeof p.text==='string','Malformed text output');content+=p.text;}
          else if(p.type==='refusal'){need(typeof p.refusal==='string','Malformed refusal');content+=p.refusal;}
          else throw new Error('Unsupported ChatGPT message content');
        }
        // Do not retain optional response annotations that are unnecessary for replay.
        items.push({type:'message',role:'assistant',content:item.content.map(p=>p.type==='output_text'?{type:'output_text',text:p.text,annotations:[]}:{type:'refusal',refusal:p.refusal}),...(item.id?{id:item.id}:{})});
      }else if(item.type==='function_call'){
        need(typeof item.call_id==='string'&&item.call_id&&typeof item.name==='string'&&typeof item.arguments==='string'&&!calls.some(c=>c.id===item.call_id),'Malformed or duplicate ChatGPT function call');
        need(tools.some(t=>t.name===item.name),'ChatGPT returned a function outside the supplied tool catalog');
        const args=parseArgs(item.arguments);
        calls.push({id:item.call_id,name:item.name,arguments:args});
        items.push({type:'function_call',call_id:item.call_id,name:item.name,arguments:JSON.stringify(args),...(item.id?{id:item.id}:{})});
      }else if(item.type==='reasoning'){
        // Only server-provided opaque encrypted reasoning and summary; never
        // print or write it to chat history.
        if(typeof item.encrypted_content==='string')items.push({type:'reasoning',id:item.id,summary:[],encrypted_content:item.encrypted_content});
      }else throw new Error('Unsupported ChatGPT response item: '+String(item.type).slice(0,40));
    }
    if(calls.length){
      const entry={content,calls:calls.map(c=>({call_id:c.id,name:c.name,arguments:JSON.stringify(c.arguments)})),items};
      // Cache is bounded and local to the current provider instance.
      this.#replay.set(calls[0].id,entry);
      if(this.#replay.size>100)this.#replay.delete(this.#replay.keys().next().value);
    }
    // Existing grounding gate renders final content only after verification.
    return {content,reasoning:null,toolCalls:calls,streamed:false};
  }
}
