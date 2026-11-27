import { launchLocal } from './local-cli.js';
import { launchClaude, launchGemini } from './native-agent-cli.js';
import {spawn} from 'node:child_process';
import {OpenRouterAuth,openRouterAuthorization,OPENROUTER_KEYS,CopilotProvider,createCopilotConnection,COPILOT_USAGE,copilotEnvironment,filterCopilotModels} from '@sci/core';
import {question,clean,browser,unlock,launchChatGPT} from './chatgpt-cli.js';

async function chooseModel(models){
  if(!models.length)throw new Error('No supported models available');
  // Search first so large OpenRouter catalogs remain usable.
  const query=models.length>30?(await question('Filter model name/id (blank = all): ')).trim().toLowerCase():'';
  const filtered=models.filter(m=>(m.id+' '+m.name).toLowerCase().includes(query));
  if(!filtered.length)throw new Error('No matching models; restart and choose another filter');
  filtered.forEach((m,i)=>console.log((i+1)+'. '+clean(m.name)+' ('+clean(m.id)+')'+(m.pricing?' | USD/token input '+clean(m.pricing.prompt)+' output '+clean(m.pricing.completion):'')));
  const value=(await question('Select model: ')).trim();
  if(!/^\d+$/.test(value)||!filtered[Number(value)-1])throw new Error('Invalid model selection');
  return filtered[Number(value)-1].id;
}
async function loginRouter(auth){
  console.log('OpenRouter — your own account and credits. API requests may incur charges. The key limit and expiration are confirmed on OpenRouter.');
  if((await question('Continue with OpenRouter (yes/no): ')).trim().toLowerCase()!=='yes')throw new Error('Cancelled');
  const value=(await question('Prefill maximum key spending in USD (e.g. 5.00): ')).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('Invalid USD limit');
  const attempt=openRouterAuthorization({limit:Number(value)});
  await browser(attempt.url,'https://openrouter.ai');
  console.log('Authorize in OpenRouter and paste its one-time code below (expires in 10 minutes).');
  const code=(await question('Authorization code: ',{secret:true})).trim();
  const status=await auth.connect(attempt,code);
  console.log('OpenRouter connected. Manage key: '+status.keySettings);
  if(status.previousKeySettings)console.log('Previous key was replaced locally. Revoke it manually if no longer needed: '+status.previousKeySettings);
}
export async function openRouterCommand(args){
  const action=args[0]??'help';
  if(action==='usage'){console.log('https://openrouter.ai/activity');return;}
  if(!['login','status','models','logout'].includes(action)){console.log('sci-agent auth openrouter login | status | models | logout | usage');return;}
  const v=await unlock({create:action==='login'});
  try{
    const a=new OpenRouterAuth(v);
    if(action==='login')await loginRouter(a);
    else if(action==='status'){if(!a.connected())console.log('Not connected');else console.log(JSON.stringify(await a.status(),null,2));}
    else if(action==='models')for(const m of await a.models())console.log(clean(m.id)+' — '+clean(m.name));
    else if(action==='logout'){
      if(!a.connected()){console.log('Not connected');return;}
      const r=await a.logout();
      console.log('Local key removed. Remote key remains valid until you revoke it: '+r.keySettings);
    }
  }finally{await v.close();}
}
export async function launchOpenRouter(argv,startRepl){
  if(argv.includes('--prompt'))throw new Error('OpenRouter account mode is interactive only');
  const v=await unlock({create:true});
  try{
    const a=new OpenRouterAuth(v);
    if(!a.connected())await loginRouter(a);
    const status=await a.status();
    console.log('OpenRouter: '+clean(status.label)+' | Remaining key limit (USD): '+(status.limitRemaining??'not set'));
    console.log('Requests use your OpenRouter credits. '+status.keySettings);
    if((await question('Send prompts and selected tool results to OpenRouter and its model providers (yes/no): ')).trim().toLowerCase()!=='yes')throw new Error('Cancelled');
    const model=await chooseModel(await a.models());
    await startRepl(argv,{connection:{kind:'openrouter-account',model,provider:a.provider(model),label:'OpenRouter: '+clean(status.label),usageUrl:'https://openrouter.ai/activity'}});
  }finally{await v.close();}
}
async function officialCopilotLogin(){
  console.log('Sign in through the official GitHub Copilot CLI; no GitHub password or token is collected by SciAgent.');
  if((await question('Run copilot login (yes/no): ')).trim().toLowerCase()!=='yes')throw new Error('Cancelled');
  if(process.platform==='win32')throw new Error('Run copilot login in your terminal, then restart SciAgent with --copilot.');
  await new Promise((resolve,reject)=>{
    const p=spawn('copilot',['login'],{stdio:'inherit',env:copilotEnvironment(),shell:false});
    p.once('error',()=>reject(new Error('Install the official GitHub Copilot CLI and run copilot login: https://docs.github.com/copilot/how-tos/copilot-cli')));
    p.once('exit',code=>code===0?resolve():reject(new Error('Copilot login did not complete')));
  });
}
export async function copilotCommand(args){
  const action=args[0]??'help';
  if(action==='usage'){console.log(COPILOT_USAGE);return;}
  if(action==='login'){await officialCopilotLogin();return;}
  if(action==='logout'){console.log('Run the official Copilot CLI and use /logout to remove its stored login; SciAgent does not own that credential. Revoke the OAuth authorization separately in GitHub Settings if needed.');return;}
  if(action==='switch'){console.log('Exit SciAgent, run the official Copilot CLI, then /user switch and restart SciAgent.');return;}
  if(!['status','models'].includes(action)){console.log('sci-agent auth copilot login | status | models | switch | logout | usage');return;}
  const c=await createCopilotConnection();
  try{
    console.log('GitHub Copilot: '+clean(c.account.login));
    if(action==='models')for(const m of filterCopilotModels(await c.client.listModels()))console.log(clean(m.id)+' — '+clean(m.name??m.id));
  }finally{await c.close();}
}
export async function launchCopilot(argv,startRepl){
  if(argv.includes('--prompt'))throw new Error('Copilot account mode is interactive only');
  let c;
  try{c=await createCopilotConnection();}catch(e){
    if(!e.message.startsWith('Sign in with the official Copilot CLI first'))throw e;
    await officialCopilotLogin();
    c=await createCopilotConnection();
  }
  try{
    console.log('GitHub Copilot: '+clean(c.account.login)+' — requests use this account’s eligible Copilot usage. '+COPILOT_USAGE);
    if((await question('Use this account and send research prompts/tool results to Copilot (yes/no): ')).trim().toLowerCase()!=='yes')throw new Error('Cancelled');
    const models=filterCopilotModels(await c.client.listModels());
    if(!models.length)throw new Error('No catalog entries explicitly attributed to Copilot; unattributed/BYOK models are excluded.');
    const model=await chooseModel(models);
    await startRepl(argv,{connection:{kind:'copilot-plan',model,provider:new CopilotProvider({...c,model}),label:'GitHub Copilot: '+clean(c.account.login),usageUrl:COPILOT_USAGE}});
  }finally{await c.close();}
}
export async function providerMenu(argv,startRepl){
  console.log('SciAgent — Select provider\n[1] ChatGPT\n[2] GitHub Copilot\n[3] OpenRouter\n[4] Existing API key / local model configuration\n[5] Claude Code (native agent)\n[6] Gemini / Antigravity (native ACP agent)\n[7] Ollama (local)\n[8] LM Studio (local)\n[9] llama.cpp (local)\n[10] vLLM (local)');
  const choice=(await question('Select: ')).trim();
  if(choice==='1')return launchChatGPT(argv,startRepl);
  if(choice==='2')return launchCopilot(argv,startRepl);
  if(choice==='3')return launchOpenRouter(argv,startRepl);
  if(choice==='4')return startRepl(argv);
  if(choice==='5')return launchClaude(argv);
  if(choice==='6')return launchGemini(argv);
  const localRuntime={'7':'ollama','8':'lmstudio','9':'llamacpp','10':'vllm'}[choice];
  if(localRuntime)return launchLocal(['--local',localRuntime,...argv],startRepl);
  throw new Error('Invalid provider selection');
}
