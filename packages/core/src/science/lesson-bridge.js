import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolvePython } from './pybridge.js';
import { researchDir } from './research-memory.js';
const exec=promisify(execFile);
const script=fileURLToPath(new URL('./vendor/lesson-gate/lesson_gate.py',import.meta.url));
const scope='project:sci-agent';
const categories=new Set(['unverified_claim','overwrite','guessed_value','ignored_instruction','broken_output','missing_test','scope_creep','other']);
const triggers=new Set(['correction','command_failure','ci_failure','self_audit']);
const required=(x,name,max=2000)=>{if(typeof x!=='string'||!x.trim()||x.length>max||x.includes('\0'))throw new Error('Invalid '+name);return x;};
export async function lessonGate(root,action,args={}) {
  const python=resolvePython();
  if(!python)throw new Error('Lesson-gate requires Python 3.11+');
  const store=await researchDir(root,'lessons');
  const ledger=path.join(store,'events.jsonl');
  try{const st=await fs.lstat(ledger);if(!st.isFile()||st.isSymbolicLink()||st.size>16*1024*1024)throw new Error('Unsafe or oversized lesson ledger');}catch(e){if(e.code!=='ENOENT')throw e;}
  let tail=[];
  switch(action){
    case 'preflight': tail=['--scope',scope,'--limit','0'];break;
    case 'stats':tail=['--json'];break;
    case 'export':tail=[];break;
    case 'add':{
      if(!categories.has(args.category)||!triggers.has(args.trigger))throw new Error('Invalid lesson category/trigger');
      tail=['--scope',scope,'--trigger',args.trigger,'--category',args.category,'--expected='+required(args.expected,'expected'),'--actual='+required(args.actual,'actual')];
      if(args.keywords!==undefined)tail.push('--keywords='+required(args.keywords,'keywords',300));
      break;
    }
    default:throw new Error('Unsupported bridge action; use the upstream CLI for fixture registration and verification');
  }
  try{
    const {stdout,stderr}=await exec(python,['-I','-X','utf8',script,action,'--store',store,...tail],{cwd:root,timeout:30000,maxBuffer:1024*1024,windowsHide:true});
    return {code:0,output:stdout.trim(),diagnostic:stderr.trim()};
  }catch(e){
    if(typeof e.code==='number'&&[1,2].includes(e.code))return {code:e.code,output:String(e.stdout??'').trim(),diagnostic:String(e.stderr??'').trim()};
    throw new Error('Lesson-gate could not complete: '+(e.killed?'timeout':String(e.code??e.message)));
  }
}
export async function captureGroundingLesson(root) {
  return lessonGate(root,'add',{trigger:'self_audit',category:'unverified_claim',expected:'Every detected scientific claim must link to relevant verified evidence before release',actual:'A generated final answer failed the claim-evidence or independent review gate',keywords:'evidence,grounding,review'});
}
