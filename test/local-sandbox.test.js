import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createRegistry,DEFAULT_CONFIG,probeSandbox,runSandboxed} from '@sci/core';
import {sandboxSpec} from '../packages/core/src/sandbox/local.js';

async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'sci-sandbox-'));
 t.after(()=>rm(parent,{recursive:true,force:true}));
 const root=path.join(parent,'project');
 await (await import('node:fs/promises')).mkdir(root);
 await writeFile(path.join(root,'data.txt'),'fixture data');
 await writeFile(path.join(parent,'private.txt'),'outside fixture');
 return {root,parent};
}
async function actual(t,root){
 try{await probeSandbox(root);return true;}catch(e){
   if(process.env.SCI_AGENT_REQUIRE_SANDBOX_TESTS==='1')throw e;
   t.skip('Local Bubblewrap unavailable: '+e.message.slice(0,160));return false;
 }
}
test('sandbox is disabled by default; only unisolated arbitrary CLI bridges are hidden when enabled',()=>{
 const cfg=structuredClone(DEFAULT_CONFIG);
 assert.equal(cfg.agent.sandbox.enabled,false);
 const normal=createRegistry({cfg});
 assert.ok(normal.get('axiomize_cli'));
 cfg.agent.sandbox.enabled=true;
 const isolated=createRegistry({cfg});
 for(const n of ['axiomize_cli','plan_audit','polyguard_cli','eq_route'])assert.equal(isolated.get(n),null);
 for(const n of ['run_command','python_eval','scientific_compute','stats_calc','lit_search'])assert.ok(isolated.get(n));
});
test('sandbox validates code and refuses a home-directory mount and escaping working directory',async t=>{
 const {root,parent}=await fixture(t);if(!await actual(t,root))return;
 await assert.rejects(sandboxSpec({workspaceRoot:os.homedir(),kind:'shell',code:'true'}),/dedicated project/);
 await assert.rejects(sandboxSpec({workspaceRoot:root,cwd:'..',kind:'shell',code:'true'}),/outside project/);
 await symlink(parent,path.join(root,'escape'),'dir');
 await assert.rejects(sandboxSpec({workspaceRoot:root,cwd:'escape',kind:'shell',code:'true'}),/outside project/);
 await assert.rejects(sandboxSpec({workspaceRoot:root,kind:'shell',code:'x'.repeat(100001)}),/Invalid sandbox code/);
});
test('real local isolation: project read-only, host files and credentials invisible, temporary files writable',async t=>{
 const {root,parent}=await fixture(t);if(!await actual(t,root))return;
 const old=process.env.SCI_SANDBOX_TEST_SECRET;process.env.SCI_SANDBOX_TEST_SECRET='fixture-only';
 t.after(()=>{if(old===undefined)delete process.env.SCI_SANDBOX_TEST_SECRET;else process.env.SCI_SANDBOX_TEST_SECRET=old;});
 const code=[
 'import os, pathlib',
 'assert pathlib.Path("data.txt").read_text()=="fixture data"',
 'assert not pathlib.Path('+JSON.stringify(path.join(parent,'private.txt'))+').exists()',
 'assert os.getenv("SCI_SANDBOX_TEST_SECRET") is None',
 'try: pathlib.Path("data.txt").write_text("changed")',
 'except OSError: pass',
 'else: raise RuntimeError("project was writable")',
 'pathlib.Path("/tmp/result").write_text("computed")',
 'print(pathlib.Path("/tmp/result").read_text())'
 ].join('\n');
 const result=await runSandboxed({workspaceRoot:root,kind:'python',code});
 assert.equal(result.output.trim(),'computed');
 assert.equal(await readFile(path.join(root,'data.txt'),'utf8'),'fixture data');
 const second=await runSandboxed({workspaceRoot:root,kind:'python',code:'import os; print(os.path.exists("/tmp/result"))'});
 assert.equal(second.output.trim(),'False');
});
test('real network namespace cannot reach host loopback service',async t=>{
 const {root}=await fixture(t);if(!await actual(t,root))return;
 const server=net.createServer(s=>s.end('host'));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(r=>server.close(r)));
 const port=server.address().port;
 const result=await runSandboxed({workspaceRoot:root,kind:'python',code:'import socket\ns=socket.socket();s.settimeout(2)\ntry: s.connect(("127.0.0.1",'+port+'))\nexcept OSError: print("isolated")\nelse: raise RuntimeError("network leak")'});
 assert.equal(result.output.trim(),'isolated');
});
test('real runner stops timed out, cancelled, excessive-output and failed processes without fallback',async t=>{
 const {root}=await fixture(t);if(!await actual(t,root))return;
 await assert.rejects(runSandboxed({workspaceRoot:root,kind:'python',code:'import time;time.sleep(10)',timeoutMs:300}),/time limit/);
 await assert.rejects(runSandboxed({workspaceRoot:root,kind:'python',code:'print("x"*100000)'}),/output limit/);
 await assert.rejects(runSandboxed({workspaceRoot:root,kind:'shell',code:'exit 7'}),/exit 7/);
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),300);
 try{await assert.rejects(runSandboxed({workspaceRoot:root,kind:'python',code:'import time;time.sleep(10)',signal:c.signal}),/cancel|abort/i);}finally{clearTimeout(timer);}
});
test('registry applies sandbox to approved shell and Python, and reports failure as a failed tool',async t=>{
 const {root}=await fixture(t);if(!await actual(t,root))return;
 const cfg=structuredClone(DEFAULT_CONFIG);cfg.agent.workspaceRoot=root;cfg.agent.sandbox.enabled=true;
 const r=createRegistry({cfg,approve:async()=>true});
 const shell=await r.invoke('run_command',{command:'pwd'});
 assert.equal(shell.ok,true);assert.match(shell.output,/sandbox: bubblewrap/);assert.match(shell.output,/\/workspace/);
 const py=await r.invoke('python_eval',{code:'print(sum(range(5)))'});
 assert.equal(py.ok,true);assert.match(py.output,/10/);
 const f=await r.invoke('scientific_compute',{code:'print("isolated scientific computation")'});
 assert.equal(f.ok,true);assert.match(f.output,/sandbox: bubblewrap/);
 const fail=await r.invoke('run_command',{command:'exit 9'});
 assert.equal(fail.ok,false);
 const deny=createRegistry({cfg,approve:async()=>false});
 assert.equal((await deny.invoke('python_eval',{code:'raise RuntimeError()'})).ok,false);
});
