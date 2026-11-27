// User-controlled local encrypted store, independent of the workspace and agent tools.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const MAX=2*1024*1024;
const key=(pass,salt)=>scryptSync(pass,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
const format='SciAgent ChatGPT vault v1';
export function sealVault(value,pass){
  const salt=randomBytes(16),iv=randomBytes(12),k=key(pass,salt);
  try{
    const cipher=createCipheriv('aes-256-gcm',k,iv);
    cipher.setAAD(Buffer.from(format));
    const payload=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return JSON.stringify({version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:payload.toString('base64')});
  }finally{k.fill(0);}
}
export function unsealVault(raw,pass){
  try{
    if(Buffer.byteLength(raw)>MAX)throw new Error('size');
    const v=JSON.parse(raw),salt=Buffer.from(v.salt,'base64'),iv=Buffer.from(v.iv,'base64'),tag=Buffer.from(v.tag,'base64');
    if(v.version!==1||salt.length!==16||iv.length!==12||tag.length!==16)throw new Error('format');
    const k=key(pass,salt);
    try{
      const d=createDecipheriv('aes-256-gcm',k,iv);d.setAAD(Buffer.from(format));d.setAuthTag(tag);
      const state=JSON.parse(Buffer.concat([d.update(Buffer.from(v.payload,'base64')),d.final()]).toString('utf8'));
      if(state.version!==1||typeof state.hostId!=='string'||!Array.isArray(state.profiles))throw new Error('state');
      return state;
    }finally{k.fill(0);}
  }catch{throw new Error('Cannot unlock ChatGPT vault: incorrect passphrase or damaged record');}
}
export function vaultPath(){
  return path.join(homedir(),'.sci-agent-auth');
}
async function validateDir(dir){
  await fs.mkdir(dir,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await fs.lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error('ChatGPT vault must be a real local directory');
  if(process.platform!=='win32'&&(st.uid!==process.getuid()||(st.mode&0o077)!==0))throw new Error('ChatGPT vault directory must be owned by you and mode 0700');
}
export async function vaultExists(dir=vaultPath()){
  try{const s=await fs.lstat(path.join(dir,'chatgpt.enc'));if(!s.isFile()||s.isSymbolicLink())throw new Error('Unsafe ChatGPT vault file');return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
export async function openVault(pass,{dir=vaultPath()}={}){
  if(typeof pass!=='string'||pass.length<12||pass.length>1024)throw new Error('Use a local vault passphrase of 12–1024 characters');
  await validateDir(dir);
  const lock=path.join(dir,'active.lock'),file=path.join(dir,'chatgpt.enc');
  let handle;
  try{handle=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('ChatGPT vault already in use; close the other Sci-Agent process. If it crashed, inspect the lock before removing it.');throw e;}
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;await handle.close();await fs.unlink(lock);};
  try{
    await handle.writeFile(String(process.pid));
    let state={version:1,hostId:'urn:uuid:'+randomUUID(),profiles:[],active:null};
    if(await vaultExists(dir)){
      const fh=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{
        const st=await fh.stat();
        if(!st.isFile()||st.size>MAX||(process.platform!=='win32'&&(st.uid!==process.getuid()||(st.mode&0o077)!==0)))throw new Error('Unsafe ChatGPT vault file permissions or size');
        state=unsealVault(await fh.readFile('utf8'),pass);
      }finally{await fh.close();}
    }
    const save=async()=>{
      if(closed)throw new Error('ChatGPT vault closed');
      const raw=sealVault(state,pass);
      if(Buffer.byteLength(raw)>MAX)throw new Error('ChatGPT vault exceeds size limit');
      const tmp=path.join(dir,'.'+randomUUID()+'.tmp'),fh=await fs.open(tmp,'wx',0o600);
      try{await fh.writeFile(raw);await fh.sync();await fh.close();await fs.rename(tmp,file);}
      finally{await fh.close().catch(()=>{});await fs.unlink(tmp).catch(()=>{});}
    };
    return {state,save,close};
  }catch(e){await close();throw e;}
}
