// Opt-in process isolation, not an OS sandbox for the entire SciAgent application.
// A failed or unsupported setup never falls back to native execution.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access,realpath,stat } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const BWRAP='/usr/bin/bwrap', PRLIMIT='/usr/bin/prlimit';
const PYTHON='/usr/bin/python3', SHELL='/bin/sh';
const MAX_OUTPUT=50000;
const within=(root,p)=>{const rel=path.relative(root,p);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
export const sandboxEnabled=cfg=>cfg?.agent?.sandbox?.enabled===true;
export const sandboxBlockedTool=name=>name.endsWith('_cli')||name==='plan_audit'||name==='eq_route';

async function workspacePaths(root,cwd='.'){
  const base=await realpath(root);
  const home=await realpath(homedir());
  // Do not accidentally mount an entire home directory, system tree or drive.
  if(within(base,home)||['/usr','/bin','/sbin','/lib','/lib64','/etc','/proc','/sys','/dev','/run','/boot','/var'].some(p=>within(p,base)))throw Error('Sandbox requires a dedicated project directory, not a home or system directory');
  const dest=await realpath(path.resolve(base,cwd));
  if(!within(base,dest)||!(await stat(base)).isDirectory()||!(await stat(dest)).isDirectory())throw Error('Sandbox working directory outside project or not a directory');
  return {base,inside:path.posix.join('/workspace',path.relative(base,dest))};
}

export async function sandboxSpec({workspaceRoot,cwd='.',kind,code,timeoutMs=120000}={}){
  if(process.platform!=='linux')throw Error('Local sandbox requires Linux (including WSL2); no unsandboxed fallback');
  if(process.getuid?.()===0)throw Error('Local sandbox must run as an unprivileged user');
  if(!['shell','python'].includes(kind)||typeof code!=='string'||!code.trim()||code.includes('\0')||Buffer.byteLength(code)>100000)throw Error('Invalid sandbox code or command (max 100000 bytes)');
  const timeout=Number(timeoutMs);
  if(!Number.isFinite(timeout)||timeout<1)throw Error('Invalid sandbox timeout');
  const limit=Math.min(Math.ceil(timeout),600000);
  try{for(const p of [BWRAP,PRLIMIT,kind==='python'?PYTHON:SHELL])await access(p,constants.X_OK);}
  catch{throw Error('Local sandbox requires /usr/bin/bwrap, /usr/bin/prlimit and the system shell/Python; install them locally (no fallback)');}
  const {base,inside}=await workspacePaths(workspaceRoot,cwd);
  const args=[
    '--unshare-all','--unshare-user','--disable-userns','--cap-drop','ALL','--die-with-parent','--new-session',
    '--ro-bind','/usr','/usr','--ro-bind-try','/bin','/bin','--ro-bind-try','/lib','/lib','--ro-bind-try','/lib64','/lib64',
    '--proc','/proc','--dev','/dev','--size','67108864','--tmpfs','/tmp',
    '--dir','/home','--dir','/home/sci','--ro-bind',base,'/workspace','--chdir',inside,
    '--remount-ro','/','--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','HOME','/home/sci','--setenv','TMPDIR','/tmp',
    '--setenv','LANG','C.UTF-8','--setenv','OPENBLAS_NUM_THREADS','1','--setenv','OMP_NUM_THREADS','1',
    '--',PRLIMIT,'--as=1073741824','--cpu='+Math.max(1,Math.ceil(limit/1000)),
    '--fsize=67108864','--nofile=128','--nproc=256','--core=0','--',
    ...(kind==='python'?[PYTHON,'-I','-X','utf8','-c',code]:[SHELL,'-c',code])
  ];
  return {command:BWRAP,args,timeoutMs:limit};
}

export async function runSandboxed(options){
  options.signal?.throwIfAborted();
  const spec=await sandboxSpec(options);
  options.signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    // Do not inherit model credentials, proxies, loader or Python overrides.
    const child=spawn(spec.command,spec.args,{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
    const buffers=[];let bytes=0,reason=null,settled=false;
    const stop=r=>{if(!reason)reason=r;try{child.kill('SIGKILL');}catch{}};
    const cancel=()=>stop('Sandbox execution cancelled');
    const timer=setTimeout(()=>stop('Sandbox time limit exceeded'),spec.timeoutMs);
    const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);};
    const finish=(e,result)=>{if(settled)return;settled=true;cleanup();e?reject(e):resolve(result);};
    const grab=d=>{
      if(reason)return;
      bytes+=d.length;
      if(bytes>MAX_OUTPUT){stop('Sandbox output limit exceeded');return;}
      buffers.push(d);
    };
    child.stdout.on('data',grab);child.stderr.on('data',grab);
    child.once('error',()=>finish(Error('Could not start local sandbox; no fallback')));
    child.once('close',(code,signal)=>{
      const output=Buffer.concat(buffers).toString('utf8');
      if(reason)return finish(Error(reason));
      if(code!==0)return finish(Error('Sandbox execution failed (exit '+String(code??signal)+'): '+output.slice(0,8000)));
      finish(null,{output:output||'(no output)',code:0,sandbox:'bubblewrap'});
    });
    options.signal?.addEventListener('abort',cancel,{once:true});
    if(options.signal?.aborted)cancel();
  });
}

export async function probeSandbox(workspaceRoot){
  const result=await runSandboxed({workspaceRoot,kind:'shell',code:'printf SCIAGENT_LOCAL_SANDBOX_OK',timeoutMs:10000});
  if(result.output!=='SCIAGENT_LOCAL_SANDBOX_OK')throw Error('Sandbox self-check failed');
  return {enabled:true,backend:'bubblewrap',workspace:'read-only',network:'isolated',temporaryStorage:'64 MiB',python:PYTHON};
}
export async function sandboxOutput(options){
  const result=await runSandboxed(options);
  return 'exit code: 0\n[sandbox: bubblewrap; read-only workspace]\n'+result.output;
}
