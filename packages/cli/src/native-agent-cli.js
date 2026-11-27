import {spawn} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import {NativeAcpSession,acpStream,terminalText} from './acp-client.js';
import {question} from './chatgpt-cli.js';

const DOCS={
  claude:'https://code.claude.com/docs/en/legal-and-compliance',
  gemini:'https://antigravity.google/docs/cli/acp'
};
export function nativeLaunchSpec(kind,action='session'){
  if(kind==='claude'){
    if(action==='session')return {command:'claude',args:[]};
    if(['login','status','logout'].includes(action))return {command:'claude',args:['auth',action]};
  }
  if(kind==='gemini'){
    if(action==='session')return {command:'agy',args:['acp']};
    if(action==='login')return {command:'agy',args:['acp','--login']};
    if(action==='version')return {command:'agy',args:['--version']};
    if(action==='native')return {command:'agy',args:[]};
  }
  throw new Error('Unsupported native agent action');
}
export async function nativeWorkspace(argv){
  if(argv.length===0)return realpath(process.cwd());
  if(argv.length!==2||argv[0]!=='--workspace'||!argv[1])throw new Error('Native agent modes accept only --workspace <directory>; headless prompts and arbitrary agent flags are not supported');
  const root=await realpath(path.resolve(argv[1]));
  if(!(await stat(root)).isDirectory())throw new Error('Workspace must be a directory');
  return root;
}
function requireTty(){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Native agent sessions require an interactive terminal');
}
async function runNative(kind,action,cwd){
  requireTty();
  const {command,args}=nativeLaunchSpec(kind,action);
  // No shell, no captured authentication output, no credential inspection,
  // no changes to the official executable or authentication methods.
  await new Promise((resolve,reject)=>{
    const proc=spawn(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:false});
    // Let the native program handle terminal Ctrl+C instead of terminating
    // Sci-Agent while it is still running.
    const onSigint=()=>{};
    process.on('SIGINT',onSigint);
    const cleanup=()=>process.removeListener('SIGINT',onSigint);
    proc.once('error',()=>{cleanup();reject(new Error('Install the official '+command+' CLI and ensure its executable is on PATH: '+DOCS[kind]));});
    proc.once('close',(code,signal)=>{cleanup();if(code===0||signal==='SIGINT')resolve();else reject(new Error(command+' exited ('+(code??signal??'unknown')+')'));});
  });
}
async function consent(kind,cwd){
  const name=kind==='claude'?'Claude Code':'Google Antigravity';
  console.log(name+' — native local agent session in '+terminalText(cwd));
  console.log('Your own official agent controls its authentication, billing, tools, permissions, model choice and data retention. Sci-Agent does not take your subscription token. Native output is not certified by the Sci-Agent scientific evidence gate. Review all changes and native tool permissions.');
  if(kind==='claude')console.log('Hosting Claude Code in a product requires compliance with Anthropic commercial terms: '+DOCS.claude);
  else console.log('Use only as an interactive ACP client to the official agent, not as a model backend or an automated account rotator. '+DOCS.gemini);
  if((await question('Continue on your own account and accept the provider terms (yes/no): ')).trim().toLowerCase()!=='yes')throw new Error('Cancelled');
}
export async function launchClaude(argv){
  requireTty();const cwd=await nativeWorkspace(argv);await consent('claude',cwd);
  await runNative('claude','session',cwd);
}
async function chooseNativeModel(session,ask){
  const m=session.models;
  if(!m?.choices.length){console.log('The native agent did not advertise a model selector; its default remains active.');return;}
  m.choices.forEach((o,i)=>console.log((i+1)+'. '+terminalText(o.name)+(o.value===m.currentValue?' [current]':'')));
  const value=(await ask('Select model (blank keeps current): ')).trim();
  if(!value)return;
  if(!/^\d+$/.test(value)||!m.choices[Number(value)-1])throw new Error('Invalid model selection');
  const chosen=m.choices[Number(value)-1];await session.selectModel(chosen.value);
  console.log('Native model: '+terminalText(chosen.name));
}
export async function launchGemini(argv){
  requireTty();const cwd=await nativeWorkspace(argv);await consent('gemini',cwd);
  const {command,args}=nativeLaunchSpec('gemini');
  const proc=spawn(command,args,{cwd,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});
  // Native agent logs can contain sensitive data. Drain stderr without forwarding it.
  proc.stderr.resume();proc.stdin.on('error',()=>{});
  let spawnError;
  const exited=new Promise(resolve=>{proc.once('close',resolve);});
  const started=new Promise((resolve,reject)=>{
    proc.once('spawn',resolve);proc.once('error',()=>{spawnError=true;reject(new Error('Install official Antigravity CLI with ACP support: '+DOCS.gemini));});
  });
  let rl,session,active=false,closing=false,cancelling=false,questionAbort=new AbortController();
  const cancel=()=>{
    if(closing)return;
    if(active&&!cancelling){cancelling=true;console.log('\nCancelling native turn… Press Ctrl+C again to close the agent.');session?.cancel().catch(()=>{});}
    else{closing=true;questionAbort.abort();rl?.close();}
  };
  try{
    await started;
    rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true,historySize:0});
    const ask=(q,{signal}={})=>rl.question(q,{signal:signal?AbortSignal.any([signal,questionAbort.signal]):questionAbort.signal});
    rl.on('SIGINT',cancel);
    const closeInput=()=>{closing=true;questionAbort.abort();session?.close();};
    rl.once('close',closeInput);
    session=new NativeAcpSession(acpStream(proc),{ask,onUpdate:e=>{
      if(e.type==='text')process.stdout.write(e.text);
      else if(e.type==='tool'&&e.text)console.log('\n[Native tool] '+e.text);
    }});
    const connectionEnded=()=>{closing=true;questionAbort.abort();rl.close();};
    session.signal.addEventListener('abort',connectionEnded,{once:true});
    try{
      const info=await session.initialize(cwd);
      console.log('Connected native ACP agent: '+terminalText(info.agentInfo?.title??info.agentInfo?.name??'Antigravity'));
      console.log('/model — native model selection | /exit — close | Ctrl+C — cancel turn');
      while(!closing&&!session.signal.aborted){
        let input;
        try{input=(await ask('agy> ')).trim();}catch(e){if(closing||session.signal.aborted)break;throw e;}
        if(!input)continue;
        if(input==='/exit')break;
        if(input==='/model'){await chooseNativeModel(session,ask);continue;}
        active=true;
        try{const result=await session.prompt(input);console.log('\n[Native turn: '+terminalText(result.stopReason)+']');}
        catch(e){if(!closing&&!session.signal.aborted)console.log('\nNative turn did not complete; retry in the agent or sign in again.');}
        finally{active=false;cancelling=false;}
      }
    }finally{session.signal.removeEventListener('abort',connectionEnded);}
  }finally{
    closing=true;questionAbort.abort();session?.close();rl?.close();
    if(!spawnError&&proc.exitCode===null&&proc.signalCode===null){
      proc.stdin.end();proc.kill('SIGTERM');
      let timer;try{await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);}finally{clearTimeout(timer);}
      if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');
      await exited;
    }
  }
}
export async function nativeAuthCommand(kind,args){
  if(args.length>1)throw new Error('Native account commands do not accept extra flags');
  const action=args[0]??'help';
  if(action==='usage'){console.log(kind==='claude'?'https://claude.ai/settings/usage':'https://antigravity.google/docs/plans');return;}
  if(kind==='claude'&&['login','status','logout'].includes(action))return runNative(kind,action,process.cwd());
  if(kind==='gemini'&&['login','version','native'].includes(action))return runNative(kind,action,process.cwd());
  if(kind==='gemini'&&action==='logout'){console.log('Run the official agy CLI and use /logout. Sci-Agent does not store the Google account token.');return;}
  if(kind==='gemini'&&action==='status'){console.log('For account and usage status, open the official agy CLI; this is not an authentication check.');return;}
  console.log('sci-agent auth '+kind+' '+(kind==='claude'?'login | status | logout | usage':'login | status | logout | version | native | usage'));
}
