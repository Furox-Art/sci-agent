import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OpenRouterAuth,openRouterAuthorization,exchangeOpenRouterCode,OPENROUTER_BASE} from '../packages/core/src/auth/openrouter.js';
import {CopilotProvider,copilotEnvironment,copilotSessionConfig,validateCopilotAccount,parseCopilotReply,filterCopilotModels} from '../packages/core/src/auth/copilot-provider.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const synthetic='sk-or-v1-synthetic-fixture';
test('OpenRouter official headless PKCE link uses a random verifier and explicit credit limit',()=>{
 const a=openRouterAuthorization({limit:5}),b=openRouterAuthorization({limit:5}),u=new URL(a.url);
 assert.equal(u.origin,'https://openrouter.ai');assert.equal(u.pathname,'/auth');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('code_challenge'),createHash('sha256').update(a.verifier).digest('base64url'));
 assert.equal(u.searchParams.get('limit'),'5');assert.ok(!u.searchParams.has('callback_url'));assert.notEqual(a.verifier,b.verifier);assert.ok(!a.url.includes(a.verifier));
 assert.throws(()=>openRouterAuthorization({limit:0}));assert.throws(()=>openRouterAuthorization({limit:1.001}));
});
test('OpenRouter exchanges only a valid unexpired PKCE code on official endpoint',async()=>{
 const a=openRouterAuthorization({limit:1});let calls=0;
 const fake=async(url,opts)=>{calls++;assert.equal(url,OPENROUTER_BASE+'/auth/keys');assert.equal(opts.redirect,'error');assert.deepEqual(JSON.parse(opts.body),{code:'fixture',code_verifier:a.verifier,code_challenge_method:'S256'});return json({key:synthetic});};
 assert.equal(await exchangeOpenRouterCode({...a,code:'fixture'},fake),synthetic);
 await assert.rejects(exchangeOpenRouterCode({...a,expiresAt:0,code:'fixture'},fake),/expired/);assert.equal(calls,1);
});
test('OpenRouter keeps key out of public provider, filters tool-capable models, and distinguishes local removal',async()=>{
 const vault={state:{},save:async()=>{}};
 const f=async(url,opts)=>{
  if(url.endsWith('/auth/keys'))return json({key:synthetic});
  assert.equal(opts.headers.authorization,'Bearer '+synthetic);
  if(url.endsWith('/key'))return json({data:{label:'fixture',limit:5,limit_remaining:4}});
  if(url.endsWith('/models'))return json({data:[{id:'with-tools',name:'Fixture',supported_parameters:['tools']},{id:'without-tools',supported_parameters:[]}]});
  throw Error('Unexpected route');
 };
 const auth=new OpenRouterAuth(vault,{fetchImpl:f});await auth.connect(openRouterAuthorization({limit:5}),'code');
 assert.equal((await auth.status()).limitRemaining,4);assert.deepEqual((await auth.models()).map(m=>m.id),['with-tools']);assert.ok(!JSON.stringify(auth.provider('with-tools')).includes(synthetic));
 const out=await auth.logout();assert.equal(out.remoteRevoked,false);assert.equal(auth.connected(),false);
});
test('OpenRouter failed verification does not replace an existing key',async()=>{
 const vault={state:{openrouter:{key:'sk-or-existing'}},save:async()=>{throw Error('must not save')}};
 const auth=new OpenRouterAuth(vault,{fetchImpl:async url=>url.endsWith('/auth/keys')?json({key:synthetic}):json({error:{message:synthetic}},401)});
 await assert.rejects(auth.connect(openRouterAuthorization({limit:1}),'code'),e=>/401/.test(e.message)&&!e.message.includes(synthetic));assert.equal(vault.state.openrouter.key,'sk-or-existing');
});
test('Copilot rejects environment, gh and BYOK auth and strips ambient token configuration',()=>{
 const e=copilotEnvironment({HOME:'/tmp/home',PATH:'/bin',GH_TOKEN:'secret',GITHUB_TOKEN:'secret',COPILOT_PROVIDER_API_KEY:'secret',COPILOT_API_URL:'https://example.com'});
 assert.deepEqual(e,{HOME:'/tmp/home',PATH:'/bin'});
 for(const authType of ['env','gh-cli','api-key','copilot-api-token'])assert.throws(()=>validateCopilotAccount({isAuthenticated:true,authType,login:'fixture'}));
 assert.equal(validateCopilotAccount({isAuthenticated:true,authType:'user',login:'fixture',host:'https://github.com'}).login,'fixture');
});
test('Copilot sessions disable built-in tools, hooks, config discovery, memory and permission requests',async()=>{
 const c=copilotSessionConfig({model:'fixture',system:'test',workspace:'/tmp/fixture'});
 assert.deepEqual(c.tools.availableTools,[]);assert.deepEqual(c.tools.excludedTools,['builtin:*','mcp:*','custom:*']);
 assert.equal(c.enableConfigDiscovery,false);assert.equal(c.skills.enabled,false);assert.equal(c.hooks.enableRepositoryHooks,false);assert.equal(c.state.enableCrossSessionStore,false);
 assert.equal((await c.permissions.onRequest()).kind,'denied-by-rules');
});
test('Copilot JSON bridge validates tool names and argument objects and rejects mixed output',()=>{
 const tools=[{name:'list_dir'}];
 assert.equal(parseCopilotReply('{"content":"","toolCalls":[{"name":"list_dir","arguments":{"path":"."}}]}',tools).toolCalls[0].name,'list_dir');
 for(const s of ['not json','{"content":"","toolCalls":[{"name":"shell","arguments":{}}]}','{"content":"final","toolCalls":[{"name":"list_dir","arguments":{}}]}','{"content":"","toolCalls":[{"name":"list_dir","arguments":[]}]}'])assert.throws(()=>parseCopilotReply(s,tools));
 assert.equal(parseCopilotReply('answer',[]).content,'answer');
});
test('Copilot adapter validates the signed-in account and deletes its temporary SDK session',async()=>{
 const lifecycle=[],account={isAuthenticated:true,authType:'user',login:'fixture'};
 const client={getAuthStatus:async()=>account,createSession:async c=>{assert.equal(c.model,'m');lifecycle.push('create');return{sessionId:'s',sendAndWait:async ({prompt})=>{assert.ok(JSON.parse(prompt).availableSciAgentTools.some(t=>t.name==='list_dir'));return{data:{content:'{"content":"","toolCalls":[{"name":"list_dir","arguments":{"path":"."}}]}'}};},disconnect:async()=>lifecycle.push('disconnect'),abort:async()=>{}};},deleteSession:async id=>{assert.equal(id,'s');lifecycle.push('delete');}};
 const p=new CopilotProvider({client,model:'m',workspace:'/tmp/fixture',account});
 assert.equal((await p.chat({messages:[{role:'user',content:'list'}],tools:[{name:'list_dir'}]})).toolCalls[0].name,'list_dir');
 assert.deepEqual(lifecycle,['create','disconnect','delete']);
 account.login='different';await assert.rejects(p.chat({messages:[]}),/account changed/);
});

test('Copilot catalog excludes BYOK and unattributed model entries',()=>{
  assert.deepEqual(filterCopilotModels([{id:'a',name:'A',provider:{kind:'copilot'}},{id:'b'},{id:'c',provider:{kind:'loki'}},{id:'d',provider:{kind:'copilot'},policy:{state:'disabled'}}]),[{id:'a',name:'A'}]);
});
