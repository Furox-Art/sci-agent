import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

const MAX_BYTES=2*1024*1024;
const ID=/^[a-f0-9]{64}$/;
export const canonicalJSON = value => JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest = text => createHash('sha256').update(text).digest('hex');

export async function researchDir(root, leaf) {
  if(!root || !['memory','lessons'].includes(leaf))throw new Error('Invalid research store');
  let current=await fs.realpath(root);
  for(const name of ['.sci-agent-research',leaf]){
    current=path.join(current,name);
    try{await fs.mkdir(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    const st=await fs.lstat(current);
    if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Research store must be a real directory');
  }
  return current;
}
async function readRecord(dir,id) {
  if(typeof id!=='string'||!ID.test(id))throw new Error('Invalid memory ID');
  const file=path.join(dir,id+'.json'), st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw new Error('Unsafe or oversized memory record');
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  let raw;
  try{if((await handle.stat()).size>MAX_BYTES)throw new Error('Oversized memory record');raw=await handle.readFile('utf8');}finally{await handle.close();}
  if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('Oversized memory record');
  const parsed=JSON.parse(raw);
  if(parsed.id!==id||parsed.payload?.schema!==1||digest(canonicalJSON(parsed.payload))!==id)throw new Error('Memory integrity check failed: '+id);
  return parsed;
}
export async function saveResearch(root,snapshot,{label='',status='partial'}={}) {
  if(!snapshot||typeof snapshot!=='object'||!Array.isArray(snapshot.evidence)||!Array.isArray(snapshot.hypotheses)||!['completed','partial','withheld'].includes(status))throw new Error('Invalid research snapshot/status');
  if(typeof label!=='string'||label.length>200)throw new Error('Label must be at most 200 characters');
  const payload=JSON.parse(canonicalJSON({schema:1,label,status,snapshot}));
  const id=digest(canonicalJSON(payload));
  const text=canonicalJSON({id,payload})+'\n';
  if(Buffer.byteLength(text)>MAX_BYTES)throw new Error('Research snapshot exceeds memory record limit');
  const dir=await researchDir(root,'memory'), file=path.join(dir,id+'.json');
  const tmp=path.join(dir,'.'+randomUUID()+'.tmp');
  const handle=await fs.open(tmp,'wx',0o600);
  try{
    await handle.writeFile(text,'utf8');await handle.sync();await handle.close();
    try{await fs.link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;await readRecord(dir,id);}
  }finally{await handle.close().catch(()=>{});await fs.unlink(tmp).catch(()=>{});}
  return {id,status,label};
}
export async function getResearch(root,id){return readRecord(await researchDir(root,'memory'),id);}
export async function searchResearch(root,query='',limit=10) {
  if(typeof query!=='string'||query.length>500||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Invalid query or limit');
  const dir=await researchDir(root,'memory'), ids=(await fs.readdir(dir)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).sort();
  if(ids.length>10000)throw new Error('Memory search exceeds 10000 records; archive explicitly');
  const terms=query.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  const matches=[];
  for(const f of ids){
    const record=await readRecord(dir,f.slice(0,-5)), p=record.payload, corpus=canonicalJSON(p).toLocaleLowerCase('en-US');
    const score=terms.filter(term=>corpus.includes(term)).length;
    if(!terms.length||score===terms.length)matches.push({id:record.id,label:p.label,status:p.status,score,evidence:p.snapshot.evidence.length,hypotheses:p.snapshot.hypotheses.length});
  }
  return matches.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}
