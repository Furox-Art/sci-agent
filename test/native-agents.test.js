import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agent,methods,PROTOCOL_VERSION} from '@agentclientprotocol/sdk';
import {NativeAcpSession,decidePermission,modelChoices,terminalText} from '../packages/cli/src/acp-client.js';
import {nativeLaunchSpec,nativeWorkspace} from '../packages/cli/src/native-agent-cli.js';
const opts=[
 {optionId:'one',kind:'allow_once',name:'Allow once'},
 {optionId:'always',kind:'allow_always',name:'Always allow'},
 {optionId:'no',kind:'reject_once',name:'Deny'}
];
const request={sessionId:'s',toolCall:{toolCallId:'t',title:'Read local file',kind:'read',rawInput:{path:'/tmp/sample'}},options:opts};
const context={sessionId:'s',active:()=>true,ask:async()=> 'yes',write:()=>{}};
test('native command specs use unmodified CLI and no headless prompt or credential flags',async()=>{
 assert.deepEqual(nativeLaunchSpec('claude'),{command:'claude',args:[]});
 assert.deepEqual(nativeLaunchSpec('claude','login'),{command:'claude',args:['auth','login']});
 assert.deepEqual(nativeLaunchSpec('gemini'),{command:'agy',args:['acp']});
 assert.deepEqual(nativeLaunchSpec('gemini','login'),{command:'agy',args:['acp','--login']});
 assert.throws(()=>nativeLaunchSpec('gemini','headless'));
 await assert.rejects(nativeWorkspace(['--prompt','hello']),/headless/);
 await assert.rejects(nativeWorkspace(['--workspace','/tmp','--dangerously-skip-permissions']),/headless/);
});
test('permissions are explicitly one-time; permanent grants are never returned',async()=>{
 assert.deepEqual(await decidePermission(request,context),{outcome:{outcome:'selected',optionId:'one'}});
 assert.equal((await decidePermission(request,{...context,ask:async()=>''})).outcome.optionId,'no');
 assert.equal((await decidePermission({...request,options:opts.slice(1)},context)).outcome.optionId,'no');
 assert.equal((await decidePermission({...request,toolCall:{...request.toolCall,rawInput:null}},context)).outcome.optionId,'no');
 assert.equal((await decidePermission({...request,sessionId:'other'},context)).outcome.outcome,'cancelled');
 assert.equal((await decidePermission(request,{...context,active:()=>false})).outcome.outcome,'cancelled');
});
test('permission cancellation after prompt cannot approve a tool',async()=>{
 const controller=new AbortController();
 const res=await decidePermission(request,{...context,signal:controller.signal,ask:async()=>{controller.abort();return 'yes';}});
 assert.equal(res.outcome.optionId,'no');
});
test('terminal rendering removes ANSI and bidi controls; grouped native model list is supported',()=>{
 assert.equal(terminalText('A\x1b[31mB\u202e\nC'),'A[31mB\nC');
 const m=modelChoices([{id:'model',category:'model',type:'select',currentValue:'a',options:[{group:'g',name:'G',options:[{value:'a',name:'A'}]}]}]);
 assert.equal(m.currentValue,'a');assert.deepEqual(m.choices,[{value:'a',name:'A'}]);
});
const model=value=>[{type:'select',id:'model',category:'model',name:'Model',currentValue:value,options:[{value:'a',name:'Model A'},{value:'b',name:'Model B'}]}];
function fakeAgent({version=PROTOCOL_VERSION,permission=true}={}){
 const A=methods.agent,C=methods.client;let prompts=0,selected='a';
 const app=agent({name:'fixture'});
 app.onRequest(A.initialize,({params:p})=>{assert.equal(p.protocolVersion,PROTOCOL_VERSION);assert.equal(p.clientCapabilities.terminal,false);assert.equal(p.clientCapabilities.fs.readTextFile,false);return {protocolVersion:version,agentInfo:{name:'fixture',version:'1'},agentCapabilities:{},authMethods:[]};});
 app.onRequest(A.session.new,({params:p})=>{assert.deepEqual(p.mcpServers,[]);return {sessionId:'s',configOptions:model(selected)};});
 app.onRequest(A.session.setConfigOption,({params:p})=>{assert.equal(p.sessionId,'s');selected=p.value;return {configOptions:model(selected)};});
 app.onRequest(A.session.prompt,async({params:p,client})=>{
  prompts++;assert.equal(p.sessionId,'s');
  assert.equal(p.prompt[0].text,'human prompt');
  if(permission){const res=await client.request(C.session.requestPermission,request);assert.equal(res.outcome.optionId,'no');}
  await client.notify(C.session.update,{sessionId:'other',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'do not display'}}});
  await client.notify(C.session.update,{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'native answer'}}});
  return {stopReason:'end_turn'};
 });
 return {app,count:()=>prompts};
}
test('actual ACP SDK client initializes, selects advertised model, denies native permission, and renders only matching session',async()=>{
 const f=fakeAgent(),updates=[];
 const s=new NativeAcpSession(f.app,{ask:async()=> 'no',write:()=>{},onUpdate:e=>updates.push(e)});
 try{
  const info=await s.initialize('/tmp');assert.equal(info.agentInfo.name,'fixture');
  assert.equal(s.models.currentValue,'a');await assert.rejects(s.selectModel('not-in-catalog'),/catalog/);
  await s.selectModel('b');assert.equal(s.models.currentValue,'b');
  assert.equal((await s.prompt('human prompt')).stopReason,'end_turn');
  assert.equal(f.count(),1);assert.deepEqual(updates,[{type:'text',text:'native answer'}]);
 }finally{s.close();}
});
test('ACP protocol incompatibility fails before creating a session or sending a prompt',async()=>{
 const f=fakeAgent({version:999});
 const s=new NativeAcpSession(f.app,{ask:async()=> 'no'});
 try{await assert.rejects(s.initialize('/tmp'),/Unsupported ACP protocol version/);assert.equal(f.count(),0);}
 finally{s.close();}
});
test('client-side file execution requests are not enabled by the ACP client',async()=>{
 const A=methods.agent,C=methods.client;
 const app=agent({name:'fixture'});
 app.onRequest(A.initialize,()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{},authMethods:[]}));
 app.onRequest(A.session.new,()=>({sessionId:'s'}));
 app.onRequest(A.session.prompt,async({client})=>{
  await assert.rejects(client.request(C.fs.writeTextFile,{sessionId:'s',path:'/tmp/sci-never-write.txt',content:'should not write'}));
  await assert.rejects(client.request(C.terminal.create,{sessionId:'s',command:'never-run'}));
  return {stopReason:'end_turn'};
 });
 const s=new NativeAcpSession(app,{ask:async()=>{throw Error('unexpected permission')}});
 try{await s.initialize('/tmp');assert.equal((await s.prompt('hello')).stopReason,'end_turn');}
 finally{s.close();}
});
test('native cancellation is sent to the agent and closes the current prompt',async()=>{
 const A=methods.agent;
 let started,finish;
 const began=new Promise(r=>started=r);
 const app=agent({name:'cancel fixture'});
 app.onRequest(A.initialize,()=>({protocolVersion:PROTOCOL_VERSION,agentCapabilities:{},authMethods:[]}));
 app.onRequest(A.session.new,()=>({sessionId:'s'}));
 app.onRequest(A.session.prompt,()=>new Promise(resolve=>{finish=resolve;started();}));
 app.onNotification(A.session.cancel,({params})=>{assert.equal(params.sessionId,'s');finish({stopReason:'cancelled'});});
 const s=new NativeAcpSession(app,{ask:async()=> 'no'});
 try{await s.initialize('/tmp');const p=s.prompt('human prompt');await began;await s.cancel();assert.equal((await p).stopReason,'cancelled');}
 finally{s.close();}
});
