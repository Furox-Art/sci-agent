import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';

export const ISSUER='https://auth.openai.com';
export const RESOURCE='https://api.openai.com/v1';
export const USAGE_URL='https://chatgpt.com/settings/usage';
const AUTHORIZE=ISSUER+'/api/accounts/authorize';
const TOKEN=ISSUER+'/api/accounts/oauth/token';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const hasPlan=p=>p?.scopes?.includes('chatgpt.tokens.use.direct')&&p.scopes.includes('resource.invoke');
const issued=id=>typeof id==='string'&&/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(id);
const random=()=>randomBytes(32).toString('base64url');
const need=(x,m)=>{if(!x)throw new Error(m);};
const endpoint=(value)=>{const u=new URL(value);need(u.origin===ISSUER&&!u.username&&!u.password&&!u.hash,'Unexpected OpenAI discovery endpoint');return u.href;};
async function request(fetcher,url,opts={}){
  const signal=opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  try{return await fetcher(url,{...opts,signal,redirect:'error'});}catch{throw new Error('OpenAI connection failed or was cancelled');}
}
async function jsonResponse(res,what){
  if(!res.ok)throw new Error(what+' failed (HTTP '+res.status+'). Check ChatGPT eligibility, permission and usage settings.');
  try{return await res.json();}catch{throw new Error('Invalid '+what+' response');}
}
export async function verifyIdentity(token,clientId,nonce,fetcher=fetch){
  const discovery=await jsonResponse(await request(fetcher,ISSUER+'/.well-known/openid-configuration'),'OpenID discovery');
  need(discovery.issuer===ISSUER,'Unexpected OpenID issuer');
  const keys=await jsonResponse(await request(fetcher,endpoint(discovery.jwks_uri)),'OpenID signing keys');
  let p;
  try{
    ({payload:p}=await jwtVerify(token,createLocalJWKSet(keys),{issuer:ISSUER,audience:clientId,algorithms:['RS256','PS256','ES256'],requiredClaims:['iss','aud','exp','sub'],clockTolerance:10}));
  }catch{throw new Error('ChatGPT ID token signature or claims validation failed');}
  need(typeof p.sub==='string'&&p.sub.length>0,'Missing validated account identity');
  need(!Array.isArray(p.aud)||p.aud.length===1||p.azp===clientId,'Invalid authorized party');
  if(nonce!==undefined)need(p.nonce===nonce,'ChatGPT ID token nonce mismatch');
  return {subject:p.sub,email:typeof p.email==='string'?p.email:''};
}
export function makeAuthorization({hostId,clientId,redirectUri,state,nonce,verifier,reconsent=false}){
  const u=new URL(AUTHORIZE);
  for(const [k,v] of Object.entries({client_id:clientId??'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}))u.searchParams.set(k,v);
  if(!clientId)u.searchParams.set('agent_name_hint','SciAgent');
  if(reconsent)u.searchParams.set('prompt','consent');
  return u.href;
}
export function parseCallback(url,expectedState,clientId){
  const u=new URL(url,'http://127.0.0.1');
  need(u.pathname==='/auth/callback','Invalid callback path');
  for(const k of ['state','code','client_id','error'])need(u.searchParams.getAll(k).length<=1,'Duplicate OAuth callback parameter');
  need(u.searchParams.get('state')===expectedState,'OAuth state mismatch');
  need(!u.searchParams.has('error'),'ChatGPT authorization was denied or failed');
  const id=u.searchParams.get('client_id')??clientId,code=u.searchParams.get('code');
  need(issued(id)&&(!clientId||id===clientId)&&typeof code==='string'&&code.length>0&&code.length<=8192,'Invalid or incomplete OAuth callback');
  return {clientId:id,code};
}
export async function loopback(state,clientId,signal){
  let done,fail;
  const result=new Promise((resolve,reject)=>{done=resolve;fail=reject;});
  result.catch(()=>{});
  let finished=false, timer;
  const finish=(e,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);server.close();e?fail(e):done(value);};
  const cancel=()=>finish(new Error('ChatGPT sign-in cancelled'));
  const server=createServer((req,res)=>{
    const headers={'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"};
    if(req.method!=='GET'||req.headers.host!=='127.0.0.1:'+server.address()?.port||!req.url?.startsWith('/auth/callback?')){res.writeHead(404,headers);res.end('Not found');return;}
    try{
      const value=parseCallback(req.url,state,clientId);
      res.writeHead(200,headers);res.end('Authorization received. Return to SciAgent to complete sign-in.');
      finish(null,value);
    }catch(e){
      res.writeHead(400,headers);res.end('Authorization could not be accepted. Return to SciAgent.');
      // Unrelated or forged callbacks must not terminate the legitimate attempt.
      if(e.message!=='OAuth state mismatch'&&new URL(req.url,'http://127.0.0.1').searchParams.get('state')===state)finish(e);
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  server.on('error',e=>finish(new Error('Local callback listener failed')));
  const redirectUri='http://127.0.0.1:'+server.address().port+'/auth/callback';
  timer=setTimeout(()=>finish(new Error('ChatGPT sign-in timed out')),5*60_000);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  return {redirectUri,result,close:cancel};
}
async function tokenGrant(fetcher,params,signal){
  return jsonResponse(await request(fetcher,TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,resource:RESOURCE}),signal}),'ChatGPT token exchange');
}
function tokenFields(data,old){
  need(typeof data.access_token==='string'&&data.access_token.length>0&&String(data.token_type).toLowerCase()==='bearer'&&Number.isFinite(data.expires_in)&&data.expires_in>0&&data.expires_in<=86400,'Invalid ChatGPT token response');
  need(typeof data.scope==='string'||old,'Missing granted scopes');
  const scopes=typeof data.scope==='string'?data.scope.split(/\s+/).filter(Boolean):old.scopes;
  const refresh=data.refresh_token;
  need(!scopes.includes('offline_access')||(typeof refresh==='string'&&refresh.length>0),'Missing renewable session token');
  const earliest=data.earliest_refresh_at;
  return {access:data.access_token,refresh:refresh??null,idToken:data.id_token??old?.idToken??null,expiresAt:Date.now()+1000*data.expires_in,earliestRefreshAt:typeof earliest==='number'?earliest*1000:typeof earliest==='string'?Date.parse(earliest):0,scopes};
}

export class ChatGPTAuth {
  #vault;#fetch;#refreshing=null;
  constructor(vault,{fetchImpl=fetch}={}){this.#vault=vault;this.#fetch=fetchImpl;}
  #active(){return this.#vault.state.profiles.find(p=>p.id===this.#vault.state.active);}
  status(){return this.#vault.state.profiles.map(p=>({id:p.id,label:p.label,email:p.email??'',active:p.id===this.#vault.state.active,status:p.access?'connected':p.subject?'disconnected':'pending',sharing:!!p.access&&hasPlan(p)}));}
  active(){return this.status().find(p=>p.active)??null;}
  async select(id){
    need(this.#vault.state.profiles.some(p=>p.id===id&&p.subject),'Unknown validated ChatGPT profile');
    this.#vault.state.active=id;await this.#vault.save();return this.active();
  }
  async signIn({profileId,openBrowser,signal,reconsent=false}={}){
    need(typeof openBrowser==='function','Browser opener required');
    const v=this.#vault.state;
    let p=profileId?v.profiles.find(x=>x.id===profileId):null;
    if(profileId)need(p,'Unknown ChatGPT registration');
    if(signal?.aborted)throw new Error('ChatGPT sign-in cancelled');
    const state=random(),nonce=random(),verifier=random(),cb=await loopback(state,p?.clientId,signal);
    try{
      // No id_token_hint: avoids leaking an identity token in terminal/browser opener logs.
      const url=makeAuthorization({hostId:v.hostId,clientId:p?.clientId,redirectUri:cb.redirectUri,state,nonce,verifier,reconsent});
      await this.#vault.save(); // persist host identity before registration
      await openBrowser(url);
      const result=await cb.result;
      if(!p){
        need(!v.profiles.some(x=>x.clientId===result.clientId),'Registration already exists; reconnect its saved profile instead');
        p={id:randomUUID(),label:'Connection '+randomUUID().slice(0,8),clientId:result.clientId};
        v.profiles.push(p);await this.#vault.save(); // pending registration, not active
      }
      const data=await tokenGrant(this.#fetch,{grant_type:'authorization_code',client_id:p.clientId,code:result.code,code_verifier:verifier,redirect_uri:cb.redirectUri},signal);
      need(typeof data.id_token==='string','Missing ChatGPT ID token');
      const identity=await verifyIdentity(data.id_token,p.clientId,nonce,this.#fetch);
      need(!p.subject||identity.subject===p.subject,'ChatGPT account mismatch');
      const credentials=tokenFields(data);
      Object.assign(p,identity,credentials);
      v.active=p.id;await this.#vault.save();return this.active();
    }finally{cb.close();}
  }
  async #refresh(p){
    if(this.#refreshing)return this.#refreshing;
    this.#refreshing=(async()=>{
      need(p.refresh,'ChatGPT session expired; sign in again');
      need(!Number.isFinite(p.earliestRefreshAt)||Date.now()>=p.earliestRefreshAt,'ChatGPT session cannot refresh yet; try later');
      const data=await tokenGrant(this.#fetch,{grant_type:'refresh_token',client_id:p.clientId,refresh_token:p.refresh});
      const next=tokenFields(data,p);
      if(data.id_token){
        // Persist rotating token only after identity validation; on failure require reauthorization.
        try{const identity=await verifyIdentity(data.id_token,p.clientId,undefined,this.#fetch);need(identity.subject===p.subject,'ChatGPT account mismatch');}
        catch(e){delete p.access;delete p.refresh;delete p.idToken;p.scopes=[];await this.#vault.save();throw e;}
      }
      Object.assign(p,next);await this.#vault.save();
    })();
    try{await this.#refreshing;}finally{this.#refreshing=null;}
  }
  // Token remains private to the auth instance; callers never receive it.
  async api(route,options={}){
    need((route==='/models'&&(!options.method||options.method==='GET'))||(route==='/responses'&&options.method==='POST'),'Unsupported ChatGPT plan endpoint or method');
    const p=this.#active();
    need(p?.subject&&p.access&&hasPlan(p),'Sign in with ChatGPT and grant plan usage first');
    if(p.expiresAt<=Date.now()+60000&&(!Number.isFinite(p.earliestRefreshAt)||p.earliestRefreshAt<=Date.now()||p.expiresAt<=Date.now()))await this.#refresh(p);
    need(p.access&&hasPlan(p)&&p.expiresAt>Date.now(),'ChatGPT session unavailable; sign in again');
    const res=await request(this.#fetch,RESOURCE+route,{...options,headers:{'content-type':'application/json','authorization':'Bearer '+p.access}});
    if(!res.ok)throw new Error('ChatGPT request failed (HTTP '+res.status+'). Check account permission, model availability and '+USAGE_URL);
    return res;
  }
  async models(signal){
    const data=await jsonResponse(await this.api('/models',{signal}),'ChatGPT model catalog');
    need(Array.isArray(data.models),'Unexpected ChatGPT model catalog');
    return data.models.filter(m=>m?.visibility==='list'&&typeof m.slug==='string'&&m.slug&&typeof m.display_name==='string').map(m=>({slug:m.slug,displayName:m.display_name}));
  }
  async logout(){
    const p=this.#active();if(!p)return {revoked:true};
    let revoked=!p.refresh;
    try{
      if(p.refresh){
        const discovery=await jsonResponse(await request(this.#fetch,ISSUER+'/.well-known/openid-configuration'),'OpenID discovery');
        need(discovery.issuer===ISSUER,'Unexpected OpenID issuer');
        const url=endpoint(discovery.revocation_endpoint);
        for(let i=0;i<2;i++){
          try{
            const res=await request(this.#fetch,url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:p.refresh,token_type_hint:'refresh_token',client_id:p.clientId})});
            if(res.ok){revoked=true;break;}
            if(res.status<500)break;
          }catch{}
          if(i===0)await new Promise(r=>setTimeout(r,500));
        }
      }
    }catch{revoked=false;}finally{
      for(const k of ['access','refresh','idToken','expiresAt','earliestRefreshAt'])delete p[k];
      p.scopes=[];await this.#vault.save();
    }
    return {revoked};
  }
}
