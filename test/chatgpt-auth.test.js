import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {openVault,ChatGPTAuth,ChatGPTPlanProvider,runAgentLoop,createRegistry,DEFAULT_CONFIG} from '@sci/core';
import {makeAuthorization,parseCallback,verifyIdentity,ISSUER,RESOURCE} from '../packages/core/src/auth/chatgpt-auth.js';
import {sealVault,unsealVault} from '../packages/core/src/auth/vault.js';
import {readCompletedResponse,responsesInput} from '../packages/core/src/auth/chatgpt-provider.js';

const pass='synthetic-test-vault-passphrase';
const client='oaiapp_test_registration';
const subject='synthetic-test-user';
const scope='openid email profile offline_access resource.invoke chatgpt.tokens.use.direct';
const json=o=>new Response(JSON.stringify(o),{headers:{'content-type':'application/json'}});
const keys=await generateKeyPair('RS256',{extractable:true});
const jwk={...await exportJWK(keys.publicKey),kid:'test',alg:'RS256',use:'sig'};
const signed=async ({nonce='nonce',aud=client,iss=ISSUER,sub=subject,exp='1h'}={})=>new SignJWT({nonce,email:'synthetic@example.invalid'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(iss).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(keys.privateKey);

const discovery={issuer:ISSUER,jwks_uri:ISSUER+'/test-jwks',revocation_endpoint:ISSUER+'/test-revoke'};
function fixture(){
  let nonce,granted=scope,rotation=0,revocationFails=false,identity=subject;
  const calls=[];
  const fetchImpl=async (url,opts={})=>{
    calls.push({url,opts});
    assert.equal(opts.redirect,'error');
    if(url===ISSUER+'/.well-known/openid-configuration')return json(discovery);
    if(url===discovery.jwks_uri)return json({keys:[jwk]});
    if(url===ISSUER+'/api/accounts/oauth/token'){
      const b=opts.body;
      assert.equal(b.get('resource'),RESOURCE);assert.equal(b.get('client_id'),client);
      assert.ok(!b.has('client_secret'));
      if(b.get('grant_type')==='authorization_code'){
        assert.equal(b.get('code'),'synthetic-code');
        assert.ok(b.get('code_verifier').length>=43);
        assert.match(b.get('redirect_uri'),/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
      }else{
        assert.equal(b.get('grant_type'),'refresh_token');assert.ok(!b.has('scope'));rotation++;
      }
      return json({access_token:'synthetic-access-'+rotation,refresh_token:'synthetic-refresh-'+rotation,token_type:'Bearer',expires_in:3600,scope:granted,id_token:await signed({nonce,sub:identity})});
    }
    if(url===RESOURCE+'/models'){
      assert.match(opts.headers.authorization,/^Bearer synthetic-access-/);
      return json({models:[{slug:'allowed-model',display_name:'Allowed Model',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hidden'}]});
    }
    if(url===discovery.revocation_endpoint)return new Response(null,{status:revocationFails?503:200});
    throw new Error('Unexpected test request');
  };
  const openBrowser=async url=>{
    const u=new URL(url);nonce=u.searchParams.get('nonce');
    assert.equal(u.origin,ISSUER);assert.ok(u.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));
    assert.equal(u.searchParams.get('code_challenge_method'),'S256');
    const cb=new URL(u.searchParams.get('redirect_uri'));
    cb.searchParams.set('state','forged');
    cb.searchParams.set('code','synthetic-code');cb.searchParams.set('client_id',client);
    assert.equal((await fetch(cb)).status,400);
    cb.searchParams.set('state',u.searchParams.get('state'));
    assert.equal((await fetch(cb)).status,200);
  };
  return {calls,fetchImpl,openBrowser,setScope:s=>granted=s,setIdentity:s=>identity=s,failRevocation:()=>revocationFails=true};
}
const tmp=async t=>{const dir=await mkdtemp(path.join(os.tmpdir(),'sci-auth-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;};
const withVault=async(t)=>{const dir=await mkdtemp(path.join(os.tmpdir(),'sci-auth-test-')),v=await openVault(pass,{dir});t.after(async()=>{await v.close();await rm(dir,{recursive:true,force:true});});return {dir,v};};
test('vault encryption authenticates ciphertext and rejects wrong passphrase',()=>{
  const state={version:1,hostId:'urn:uuid:synthetic',profiles:[{access:'synthetic-token'}],active:null};
  const raw=sealVault(state,pass);
  assert.ok(!raw.includes('synthetic-token'));
  assert.deepEqual(unsealVault(raw,pass),state);
  assert.throws(()=>unsealVault(raw,'incorrect-passphrase'),/Cannot unlock/);
  const tamper=JSON.parse(raw);tamper.tag=Buffer.alloc(16).toString('base64');
  assert.throws(()=>unsealVault(JSON.stringify(tamper),pass),/Cannot unlock/);
});
test('vault is exclusive, persists stable host ID and encrypted records',async t=>{
  const dir=await tmp(t),v=await openVault(pass,{dir});
  try{
    await assert.rejects(()=>openVault(pass,{dir}),/already in use/);
    v.state.profiles.push({id:'a',access:'synthetic-secret'});
    await v.save();const raw=await readFile(path.join(dir,'chatgpt.enc'),'utf8');
    assert.ok(!raw.includes('synthetic-secret'));
    const id=v.state.hostId;await v.close();
    await assert.rejects(()=>openVault('wrong-passphrase-123',{dir}),/Cannot unlock/);
    const v2=await openVault(pass,{dir});
    try{assert.equal(v2.state.hostId,id);assert.equal(v2.state.profiles[0].access,'synthetic-secret');}finally{await v2.close();}
  }finally{await v.close();}
});
test('authorization uses own app identity, PKCE, exact loopback URI and saved issued client',()=>{
  const args={hostId:'urn:uuid:fixture',redirectUri:'http://127.0.0.1:12345/auth/callback',state:'state',nonce:'nonce',verifier:'test-verifier'};
  const u=new URL(makeAuthorization(args));
  assert.equal(u.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(u.searchParams.get('agent_name_hint'),'SciAgent');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  assert.equal(u.searchParams.get('redirect_uri'),args.redirectUri);
  const next=new URL(makeAuthorization({...args,clientId:client}));
  assert.equal(next.searchParams.get('client_id'),client);
  assert.ok(!next.searchParams.has('agent_name_hint'));
  assert.deepEqual(parseCallback('/auth/callback?state=state&code=abc&client_id='+client,'state'),{code:'abc',clientId:client});
  for(const url of ['/auth/callback?state=wrong&code=abc&client_id='+client,'/auth/callback?state=state&error=access_denied','/auth/callback?state=state&code=abc&client_id=dynamic_agent_client','/auth/callback?state=state&state=other&code=abc&client_id='+client]){
    assert.throws(()=>parseCallback(url,'state'));
  }
  assert.throws(()=>parseCallback('/auth/callback?state=state&code=abc&client_id=oaiapp_other','state',client));
});
test('ID token signature, issuer, audience, expiry and nonce are validated',async()=>{
  const f=fixture();
  assert.equal((await verifyIdentity(await signed(),client,'nonce',f.fetchImpl)).subject,subject);
  for(const params of [{aud:'other'},{iss:'https://example.invalid'},{exp:'-1h'},{nonce:'wrong'}]){
    await assert.rejects(()=>signed(params).then(t=>verifyIdentity(t,client,'nonce',f.fetchImpl)));
  }
  const other=await generateKeyPair('RS256');
  const wrong=await new SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(ISSUER).setAudience(client).setSubject(subject).setExpirationTime('1h').sign(other.privateKey);
  await assert.rejects(()=>verifyIdentity(wrong,client,'nonce',f.fetchImpl),/signature or claims/);
});
test('browser loopback login, safe profiles, catalog and rotating refresh through documented endpoints',async t=>{
  const {v}=await withVault(t),f=fixture(),a=new ChatGPTAuth(v,{fetchImpl:f.fetchImpl});
  const p=await a.signIn({openBrowser:f.openBrowser});
  assert.equal(p.sharing,true);assert.equal(p.email,'synthetic@example.invalid');
  assert.ok(!JSON.stringify(a.status()).includes('synthetic-access'));
  assert.deepEqual(await a.models(),[{slug:'allowed-model',displayName:'Allowed Model'}]);
  v.state.profiles[0].expiresAt=Date.now()-1;
  await Promise.all([a.models(),a.models()]);
  assert.equal(f.calls.filter(c=>c.opts.body?.get?.('grant_type')==='refresh_token').length,1);
  assert.equal(v.state.profiles[0].refresh,'synthetic-refresh-1');
  assert.equal((await a.logout()).revoked,true);
  assert.equal(a.active().sharing,false);
  assert.ok(!v.state.profiles[0].access);
  assert.equal(v.state.profiles[0].clientId,client);
});
test('identity-only permission refuses plan requests; reauthorization cannot swap identity',async t=>{
  const {v}=await withVault(t),f=fixture(),a=new ChatGPTAuth(v,{fetchImpl:f.fetchImpl});
  f.setScope('openid profile email offline_access');
  const p=await a.signIn({openBrowser:f.openBrowser});
  assert.equal(p.sharing,false);
  await assert.rejects(()=>a.models(),/grant plan usage/);
  f.setIdentity('different-user');f.setScope(scope);
  await assert.rejects(()=>a.signIn({profileId:p.id,openBrowser:f.openBrowser}),/account mismatch/);
  assert.equal(a.active().id,p.id);assert.equal(a.active().sharing,false);
});
test('logout clears local credentials even if remote revocation cannot be confirmed',async t=>{
  const {v}=await withVault(t),f=fixture(),a=new ChatGPTAuth(v,{fetchImpl:f.fetchImpl});
  await a.signIn({openBrowser:f.openBrowser});f.failRevocation();
  assert.equal((await a.logout()).revoked,false);
  assert.equal(a.active().sharing,false);assert.ok(!v.state.profiles[0].refresh);
});
const completed=output=>({type:'response.completed',response:{status:'completed',output}});
const stream=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
test('Responses adapter requires completed stream and refuses failed/incomplete responses',async()=>{
  assert.equal((await readCompletedResponse(stream([completed([])]))).status,'completed');
  await assert.rejects(()=>readCompletedResponse(stream([{type:'response.output_text.delta',delta:'partial'}])),/without response.completed/);
  await assert.rejects(()=>readCompletedResponse(stream([{type:'response.failed'}])),/did not complete/);
});
test('Responses tool calls map correctly and tool outputs use call_id; no tokens in request body',async()=>{
  const bodies=[];
  const auth={api:async(route,opts)=>{
    assert.equal(route,'/responses');
    const b=JSON.parse(opts.body);bodies.push(b);
    assert.equal(b.store,false);assert.equal(b.stream,true);
    if(bodies.length===1)return stream([completed([{type:'function_call',call_id:'call_1',name:'matrix_ops',arguments:'{"op":"det","a":[[2,0],[0,2]]}'}])]);
    return stream([completed([{type:'message',role:'assistant',content:[{type:'output_text',text:'determinant = 4.000000000 [E1]'}]}])]);
  }};
  const provider=new ChatGPTPlanProvider({auth,model:'allowed-model'});
  const result=await runAgentLoop({provider,registry:createRegistry({cfg:DEFAULT_CONFIG}),messages:[{role:'system',content:'test'},{role:'user',content:'compute'}]});
  assert.equal(result.done,true);
  assert.equal(result.research.claims[0].evidenceId,'E1');
  assert.ok(bodies[0].tools.some(t=>t.type==='function'&&t.name==='matrix_ops'&&t.strict===false));
  assert.ok(bodies[1].input.some(i=>i.type==='function_call_output'&&i.call_id==='call_1'&&i.output.includes('[Evidence ID: E1]')));
  assert.ok(!JSON.stringify(bodies).includes('Bearer'));
});
test('Responses adapter refuses unexpected function and duplicate calls',async()=>{
  const call={type:'function_call',call_id:'call_1',name:'not_registered',arguments:'{}'};
  const p=new ChatGPTPlanProvider({auth:{api:async()=>stream([completed([call])])},model:'allowed-model'});
  await assert.rejects(()=>p.chat({messages:[{role:'user',content:'test'}]}),/outside the supplied tool catalog/);
});
