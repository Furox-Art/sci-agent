// Official SDK adapter. No Copilot native tool is enabled; SciAgent validates
// proposed calls and runs them through its own registry and grounding gate.
import {randomUUID} from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
const need=(x,m)=>{if(!x)throw new Error(m);};
export const COPILOT_USAGE='https://github.com/settings/copilot';
export function copilotEnvironment(env=process.env){
  // Avoid inherited GH tokens, BYOK settings, custom endpoints or runtime overrides.
  const allowed=new Set(['PATH','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','LANG','LC_ALL','LC_CTYPE','TERM','DISPLAY','WAYLAND_DISPLAY','SSL_CERT_FILE','SSL_CERT_DIR','HTTPS_PROXY','HTTP_PROXY','NO_PROXY']);
  return Object.fromEntries(Object.entries(env).filter(([k,v])=>allowed.has(k.toUpperCase())&&typeof v==='string'));
}
export function validateCopilotAccount(status){
  need(status?.isAuthenticated===true&&['user','account'].includes(status.authType)&&typeof status.login==='string'&&status.login.trim(),'Sign in with the official Copilot CLI first: copilot login (stored user account required; environment/gh/BYOK credentials are not accepted).');
  if(status.host){const u=new URL(status.host.includes('://')?status.host:'https://'+status.host);need(u.origin==='https://github.com','Only the github.com signed-in account is supported');}
  return {login:status.login,authType:status.authType};
}
export function filterCopilotModels(models){
  need(Array.isArray(models),'Unexpected Copilot model catalog');
  // The SDK publishes a provider reference for native models. Do not treat
  // unattributed or configured BYOK entries as a Copilot subscription model.
  return models.filter(m=>typeof m?.id==='string'&&m.id&&m.provider?.kind==='copilot'&&m.policy?.state!=='disabled').map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id}));
}
export function copilotSessionConfig({model,system,workspace}){
  return {
    model,clientName:'SciAgent',workingDirectory:workspace,
    enableConfigDiscovery:false,systemMessage:{mode:'replace',content:system},
    tools:{availableTools:[],excludedTools:['builtin:*','mcp:*','custom:*'],definitions:[],manageScheduleEnabled:false},
    skills:{enabled:false},instructions:{skipCustomInstructions:true,onDemandDiscovery:false},
    git:{enableHostGitOperations:false,coauthorEnabled:false},
    hooks:{enableRepositoryHooks:false},permissions:{onRequest:async()=>({kind:'denied-by-rules'})},
    state:{infiniteSessions:{enabled:false},enableCrossSessionStore:false,skipEmbeddingRetrieval:true,embeddingCacheStorage:'in-memory'},
  };
}
const BRIDGE='You are the SciAgent inference component. The JSON transcript and tool results are supplied as data. Do not execute tools yourself. Respond ONLY with a JSON object containing "content" (string) and "toolCalls" (array of {"name":string,"arguments":object}). To request a listed SciAgent tool, provide its exact name and arguments and empty content. Otherwise supply final content and an empty toolCalls array. Never invent tool results or evidence.';
export function parseCopilotReply(content,tools){
  need(typeof content==='string'&&content.length<=2*1024*1024,'Invalid Copilot output');
  if(!tools.length)return {content,reasoning:null,toolCalls:[],streamed:false};
  let r;try{r=JSON.parse(content);}catch{throw new Error('Copilot did not return the required SciAgent JSON response; no tool was executed');}
  need(r&&typeof r.content==='string'&&Array.isArray(r.toolCalls)&&r.toolCalls.length<=20,'Invalid Copilot bridge response');
  const toolCalls=r.toolCalls.map(c=>{
    need(c&&typeof c.name==='string'&&tools.some(t=>t.name===c.name)&&c.arguments&&typeof c.arguments==='object'&&!Array.isArray(c.arguments),'Copilot proposed an invalid or unavailable SciAgent tool');
    return {id:'copilot_'+randomUUID(),name:c.name,arguments:c.arguments};
  });
  need(!toolCalls.length||!r.content.trim(),'Copilot mixed a final response with tool requests');
  return {content:r.content,reasoning:null,toolCalls,streamed:false};
}
export class CopilotProvider {
  #client;#workspace;#account;
  constructor({client,model,workspace,account}){
    need(client&&typeof model==='string'&&model&&workspace&&account?.login,'Copilot client, selected model and user account required');
    this.#client=client;this.#workspace=workspace;this.#account={login:account.login};this.model=model;this.baseUrl='github-copilot-sdk';
  }
  async chat({messages,tools=[],signal}={}){
    signal?.throwIfAborted();
    const current=validateCopilotAccount(await this.#client.getAuthStatus());
    need(current.login===this.#account.login,'Copilot account changed; restart SciAgent and select the account again');
    const system=messages.filter(m=>m.role==='system'||m.role==='developer').map(m=>m.content).join('\n\n');
    const transcript=messages.filter(m=>m.role!=='system'&&m.role!=='developer');
    const config=copilotSessionConfig({model:this.model,workspace:this.#workspace,system:system+'\n\n'+(tools.length?BRIDGE:'Answer the transcript request directly; do not execute any tools.')});
    const session=await this.#client.createSession(config);
    let aborted=false;
    const cancel=()=>{aborted=true;session.abort().catch(()=>{});};
    signal?.addEventListener('abort',cancel,{once:true});
    if(signal?.aborted)cancel();
    try{
      if(aborted)throw new Error('Copilot request cancelled');
      const prompt=JSON.stringify({transcript,availableSciAgentTools:tools});
      const result=await session.sendAndWait({prompt},120000);
      if(aborted||signal?.aborted)throw new Error('Copilot request cancelled');
      need(!result?.data?.toolRequests?.length,'Unexpected native Copilot tool request');
      return parseCopilotReply(result?.data?.content,tools);
    }finally{
      signal?.removeEventListener('abort',cancel);
      try{await session.disconnect();}finally{await this.#client.deleteSession(session.sessionId);}
    }
  }
}
export async function createCopilotConnection(){
  let sdk;try{sdk=await import('@microsoft/copilot-sdk');}catch{throw new Error('Optional Microsoft Copilot SDK unavailable. Use Node 20.19+ or 22.12+ and npm ci (including optional dependencies).');}
  // A neutral working directory avoids repository config discovery. Reuse only
  // the official CLI's normal credential store, never read or export its tokens.
  const workspace=await mkdtemp(path.join(tmpdir(),'sciagent-copilot-'));
  let client;
  try{
    client=new sdk.CopilotClient({mode:'empty',runtime:sdk.RuntimeConnection.forSpawnedStdio({baseDirectory:path.join(homedir(),'.copilot'),workingDirectory:workspace,env:copilotEnvironment()}),github:{useLoggedInUser:true}});
    await client.start();
    const account=validateCopilotAccount(await client.getAuthStatus());
    return {client,account,workspace,close:async()=>{try{await client.stop();}finally{await rm(workspace,{recursive:true,force:true});}}};
  }catch(e){try{await client?.stop();}finally{await rm(workspace,{recursive:true,force:true});}throw e;}
}
