import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { openVault,vaultExists,ChatGPTAuth,ChatGPTPlanProvider,USAGE_URL } from '@sci/core';
const out=process.stdout;
export const clean=s=>String(s??'').replace(/[\x00-\x1f\x7f-\x9f]/g,' ').slice(0,250);
export function question(prompt,{secret=false}={}){
  if(!process.stdin.isTTY||!out.isTTY)throw new Error('Account commands require an interactive local terminal');
  return new Promise((resolve,reject)=>{
    const rl=readline.createInterface({input:process.stdin,output:out,terminal:true,historySize:0});
    let answered=false;
    if(secret){
      out.write(prompt);
      // Do not echo the vault passphrase or record it in readline history.
      rl._writeToOutput=()=>{};
    }
    rl.once('SIGINT',()=>{rl.close();});
    rl.once('close',()=>{if(!answered){if(secret)out.write('\n');reject(new Error('Cancelled'));}});
    rl.question(secret?'':prompt,answer=>{answered=true;rl.close();if(secret)out.write('\n');resolve(answer);});
  });
}
export async function browser(url,origin='https://auth.openai.com'){
  if(new URL(url).origin!==origin)throw new Error('Unexpected sign-in destination');
  const cmd=process.platform==='darwin'?['open',url]:process.platform==='win32'?['rundll32.exe','url.dll,FileProtocolHandler',url]:['xdg-open',url];
  try{
    await new Promise((resolve,reject)=>{const p=spawn(cmd[0],cmd.slice(1),{stdio:'ignore',windowsHide:true});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error('Browser unavailable')));});
  }catch{
    // URL includes state/PKCE challenge, not access/refresh/ID tokens.
    console.log('Open this authorization URL in your local browser:\n'+url);
  }
}
async function confirmEligibility(){
  console.log('Continue with ChatGPT — SciAgent (local CLI)');
  console.log('Your ChatGPT plan usage is optional and subject to account eligibility and limits.\nUse this only for your own local personal project or an eligible/approved distribution. Do not share accounts, pool quota or rotate accounts to bypass limits.\nYour prompts and selected tool outputs are sent to OpenAI for SciAgent inference. Your encrypted credentials stay on this device; no ChatGPT password or API key is requested.\nTerms: https://openai.com/policies/sign-in-with-chatgpt-terms/\nUsage and access: '+USAGE_URL);
  if((await question('Confirm local use, eligibility and consent (yes/no): ')).trim().toLowerCase()!=='yes')throw new Error('ChatGPT sign-in cancelled');
}
export async function unlock({create=false}={}){
  const exists=await vaultExists();
  if(!exists&&!create)throw new Error('No local credential vault. Sign in first.');
  const pass=await question(exists?'Local vault passphrase (not your ChatGPT password): ':'Create local vault passphrase (minimum 12 characters): ',{secret:true});
  if(!exists&&pass!==await question('Confirm local vault passphrase: ',{secret:true}))throw new Error('Vault passphrases differ');
  return openVault(pass);
}
function printProfiles(auth){
  const rows=auth.status();
  if(!rows.length)console.log('No ChatGPT profiles.');
  rows.forEach((p,i)=>console.log((i+1)+'. '+(p.active?'[active] ':'')+clean(p.label)+' '+clean(p.email)+' — '+p.status+'; plan usage '+(p.sharing?'enabled':'disabled')));
  console.log('Manage usage: '+USAGE_URL);
  return rows;
}
async function chooseProfile(auth,{allowNew=false}={}){
  const profiles=printProfiles(auth);
  if(allowNew)console.log('0. Continue with ChatGPT — add an account');
  const val=(await question('Select connection: ')).trim();
  if(allowNew&&val==='0')return null;
  if(!/^\d+$/.test(val)||!profiles[Number(val)-1])throw new Error('Invalid connection selection');
  return profiles[Number(val)-1];
}
async function signIn(auth,profileId){
  await confirmEligibility();
  const controller=new AbortController(),cancel=()=>controller.abort();
  process.once('SIGINT',cancel);
  try{
    console.log('Authorize in your browser, then return to this terminal. Ctrl+C cancels.');
    const p=await auth.signIn({profileId,openBrowser:browser,signal:controller.signal,reconsent:!!profileId});
    console.log(clean(p.label)+' '+clean(p.email)+' — '+(p.sharing?'ChatGPT plan usage enabled':'Signed in; plan usage not granted'));
    return p;
  }finally{process.removeListener('SIGINT',cancel);}
}
export async function authCommand(argv){
  const command=argv[0]??'help';
  if(!['login','status','switch','models','logout','usage'].includes(command)){
    console.log('sci-agent auth login | status | switch | models | logout | usage');
    return;
  }
  if(command==='usage'){console.log(USAGE_URL);return;}
  const vault=await unlock({create:command==='login'});
  try{
    const auth=new ChatGPTAuth(vault);
    if(command==='login'){
      const p=auth.status().length?await chooseProfile(auth,{allowNew:true}):null;
      await signIn(auth,p?.id);
    }else if(command==='status')printProfiles(auth);
    else if(command==='switch'){
      const p=await chooseProfile(auth);
      if(p.status==='pending')throw new Error('Complete this registration via auth login');
      await auth.select(p.id);printProfiles(auth);
    }else if(command==='models'){
      for(const m of await auth.models())console.log(clean(m.slug)+' — '+clean(m.displayName));
    }else if(command==='logout'){
      const p=auth.active();if(!p){console.log('No active account.');return;}
      console.log('Sign out '+clean(p.label)+' '+clean(p.email));
      const r=await auth.logout();
      console.log(r.revoked?'Signed out.':'Local credentials removed; remote revocation not confirmed. Disconnect the app in ChatGPT Settings: '+USAGE_URL);
    }
  }finally{await vault.close();}
}
export async function launchChatGPT(argv,startRepl){
  // Interactive-only to avoid attaching a subscription to an unattended service.
  if(argv.includes('--prompt'))throw new Error('ChatGPT plan mode is interactive only; use --chatgpt without --prompt');
  const vault=await unlock({create:true});
  try{
    const auth=new ChatGPTAuth(vault);
    let p=auth.active();
    if(!p?.sharing){
      const chosen=auth.status().length?await chooseProfile(auth,{allowNew:true}):null;
      if(chosen?.sharing){await auth.select(chosen.id);p=auth.active();}
      else p=await signIn(auth,chosen?.id);
    }
    if(!p?.sharing)throw new Error('ChatGPT plan usage permission is required');
    console.log('Active ChatGPT connection: '+clean(p.label)+' '+clean(p.email));
    console.log('ChatGPT plan usage enabled; limits and credits apply. Manage usage: '+USAGE_URL);
    const models=await auth.models();
    if(!models.length)throw new Error('No ChatGPT models available for this connection');
    models.forEach((m,i)=>console.log((i+1)+'. '+clean(m.displayName)+' ('+clean(m.slug)+')'));
    const selection=(await question('Choose model: ')).trim();
    if(!/^\d+$/.test(selection)||!models[Number(selection)-1])throw new Error('Invalid model selection');
    const model=models[Number(selection)-1].slug;
    const provider=new ChatGPTPlanProvider({auth,model});
    await startRepl(argv.filter(a=>a!=='--chatgpt'),{chatgpt:{model,provider,label:clean(p.label),email:clean(p.email),usageUrl:USAGE_URL}});
  }finally{await vault.close();}
}
