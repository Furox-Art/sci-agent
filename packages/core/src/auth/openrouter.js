import {randomBytes,createHash} from 'node:crypto';
import {OpenAICompatProvider} from '../provider.js';
export const OPENROUTER_BASE='https://openrouter.ai/api/v1';
export const OPENROUTER_KEYS='https://openrouter.ai/settings/keys';
const need=(x,m)=>{if(!x)throw new Error(m);};
const digest=x=>createHash('sha256').update(x).digest('hex');

export function openRouterAuthorization({limit,expiration='30-days'}={}){
  need(typeof limit==='number'&&Number.isFinite(limit)&&limit>0&&limit<1e6&&Math.abs(limit*100-Math.round(limit*100))<1e-6,'Choose a positive USD key limit (up to two decimal places)');
  need(['1-hour','1-day','7-days','30-days','90-days','180-days','1-year','never'].includes(expiration),'Invalid expiration');
  const verifier=randomBytes(32).toString('base64url');
  const u=new URL('https://openrouter.ai/auth');
  // Official headless PKCE flow: provider displays a one-time code, no callback server.
  for(const [k,v] of Object.entries({code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',key_label:'SciAgent',limit:String(limit),expiration}))u.searchParams.set(k,v);
  return {url:u.href,verifier,expiresAt:Date.now()+10*60_000};
}
async function safeRequest(fetchImpl,route,options={}){
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  let res;
  try{res=await fetchImpl(OPENROUTER_BASE+route,{...options,signal,redirect:'error'});}catch{throw new Error('OpenRouter connection failed or was cancelled');}
  if(!res.ok)throw new Error('OpenRouter request failed (HTTP '+res.status+'). Check your key, credits, and model access.');
  return res;
}
async function json(res){try{return await res.json();}catch{throw new Error('Invalid OpenRouter response');}}
export async function exchangeOpenRouterCode({code,verifier,expiresAt},fetchImpl=fetch){
  need(typeof code==='string'&&code.length>0&&code.length<=8192&&!/\s/.test(code),'Invalid authorization code');
  need(typeof verifier==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(verifier)&&expiresAt>Date.now(),'Authorization attempt expired; start again');
  const data=await json(await safeRequest(fetchImpl,'/auth/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,code_verifier:verifier,code_challenge_method:'S256'})}));
  need(typeof data.key==='string'&&data.key.length<=4096&&data.key.startsWith('sk-or-')&&!/\s/.test(data.key),'Invalid OpenRouter key response');
  return data.key;
}
export class OpenRouterAuth{
  #vault;#fetch;
  constructor(vault,{fetchImpl=fetch}={}){this.#vault=vault;this.#fetch=fetchImpl;}
  #key(){const key=this.#vault.state.openrouter?.key;need(typeof key==='string'&&key.startsWith('sk-or-'),'No OpenRouter connection; sign in first');return key;}
  connected(){return Boolean(this.#vault.state.openrouter?.key);}
  async connect(attempt,code){
    const key=await exchangeOpenRouterCode({...attempt,code},this.#fetch);
    // Verify the issued key before replacing the existing connection.
    await json(await safeRequest(this.#fetch,'/key',{headers:{authorization:'Bearer '+key}}));
    const old=this.#vault.state.openrouter;
    this.#vault.state.openrouter={key,createdAt:new Date().toISOString()};
    try{await this.#vault.save();}catch(e){this.#vault.state.openrouter=old;throw e;}
    return {connected:true,keySettings:'https://openrouter.ai/keys/'+digest(key),previousKeySettings:old?.key?'https://openrouter.ai/keys/'+digest(old.key):null};
  }
  async status(){
    const key=this.#key();
    const {data}=await json(await safeRequest(this.#fetch,'/key',{headers:{authorization:'Bearer '+key}}));
    need(data&&typeof data==='object','Unexpected OpenRouter key status');
    return {label:typeof data.label==='string'?data.label:'OpenRouter key',limit:data.limit??null,limitRemaining:data.limit_remaining??null,usage:data.usage??null,expiresAt:data.expires_at??null,keySettings:'https://openrouter.ai/keys/'+digest(key)};
  }
  async models(){
    const {data}=await json(await safeRequest(this.#fetch,'/models',{headers:{authorization:'Bearer '+this.#key()}}));
    need(Array.isArray(data),'Unexpected OpenRouter model catalog');
    return data.filter(m=>typeof m?.id==='string'&&m.id&&Array.isArray(m.supported_parameters)&&m.supported_parameters.includes('tools')).map(m=>({id:m.id,name:typeof m.name==='string'?m.name:m.id,pricing:{prompt:m.pricing?.prompt??null,completion:m.pricing?.completion??null}}));
  }
  provider(model){
    const key=this.#key();
    const provider=new OpenAICompatProvider({baseUrl:OPENROUTER_BASE,apiKey:key,name:model,stream:true,fetchImpl:async(url,opts)=>{
      need(url===OPENROUTER_BASE+'/chat/completions','Unexpected OpenRouter inference destination');
      return safeRequest(this.#fetch,'/chat/completions',{...opts,headers:{...opts.headers,'HTTP-Referer':'https://github.com/Furox-Art/sci-agent','X-Title':'SciAgent'}});
    }});
    // Do not expose the key on the public provider instance passed to SciAgent tools.
    return {model,baseUrl:OPENROUTER_BASE,chat:args=>provider.chat(args)};
  }
  async logout(){
    const key=this.#key(),old=this.#vault.state.openrouter;
    delete this.#vault.state.openrouter;
    try{await this.#vault.save();}catch(e){this.#vault.state.openrouter=old;throw e;}
    // User-owned OAuth key: no management credential is requested. Revoke explicitly in dashboard.
    return {localRemoved:true,remoteRevoked:false,keySettings:'https://openrouter.ai/keys/'+digest(key)};
  }
}
