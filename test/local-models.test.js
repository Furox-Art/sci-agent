import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {LocalModels,localEndpoint,createRegistry,DEFAULT_CONFIG,runAgentLoop} from '@sci/core';
import {parseLocalArgs} from '../packages/cli/src/local-cli.js';

const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
test('local endpoints allow literal loopback only',()=>{
 assert.equal(localEndpoint('ollama'),'http://127.0.0.1:11434/v1');
 assert.equal(localEndpoint('lmstudio','http://localhost:1234/v1/'),'http://127.0.0.1:1234/v1');
 for(const x of ['https://127.0.0.1:1234/v1','http://192.168.1.1:1234/v1','http://localhost.evil:1234/v1','http://user:pass@127.0.0.1:1234/v1','http://127.0.0.1:1234/v1?x=y','http://127.0.0.1:1234/../v1'])assert.throws(()=>localEndpoint('custom',x));
});
test('Ollama catalog filters known remote models and preserves disk and quantization metadata',async()=>{
 const requests=[];
 const c=new LocalModels({runtime:'ollama',fetchImpl:async(url,opts)=>{
 requests.push([url,opts]);
 if(url.endsWith('/api/tags'))return response({models:[{model:'local:70b',size:40_000_000_000,details:{parameter_size:'70B',quantization_level:'Q4_K_M'}},{model:'x:cloud'},{model:'remote',remote_host:'https://example.invalid'},{model:'local:70b'}]});
 if(url.endsWith('/api/show'))return response({capabilities:['completion','tools']});
 throw Error('Unexpected path');
 }});
 assert.deepEqual(await c.models(),[{id:'local:70b',bytes:40_000_000_000,parameters:'70B',quantization:'Q4_K_M'}]);
 assert.deepEqual(await c.inspect('local:70b'),{tools:'advertised'});
 await assert.rejects(c.provider('remote'),/listed/);
 assert.equal(requests[0][1].redirect,'error');
});
test('Ollama remote metadata or missing tools blocks inference',async()=>{
 for(const meta of [{remote_model:'cloud',capabilities:['tools']},{capabilities:['completion']}]){
 const c=new LocalModels({runtime:'ollama',fetchImpl:async url=>response(url.endsWith('/api/tags')?{models:[{name:'fixture'}]}:meta)});
 await c.models();await assert.rejects(c.provider('fixture'),/cloud|tool support/i);
 }
});
test('local provider connects through actual loopback HTTP and performs scientific tool turn',async t=>{
 let calls=0;
 const s=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return;}
 assert.equal(req.url,'/v1/chat/completions');
 const chunks=[];for await(const c of req)chunks.push(c);
 const b=JSON.parse(Buffer.concat(chunks));assert.equal(b.model,'fixture-model');
 assert.equal(req.headers.authorization,undefined);
 calls++;
 if(calls===1){assert.ok(b.tools.some(t=>t.function.name==='matrix_ops'));res.end(JSON.stringify({choices:[{message:{content:'',tool_calls:[{id:'c1',function:{name:'matrix_ops',arguments:JSON.stringify({op:'det',a:[[2,0],[0,3]]})}}]}}]}));}
 else{assert.ok(b.messages.some(m=>m.role==='tool'&&m.content.includes('6')));res.end(JSON.stringify({choices:[{message:{content:'determinant = 6.000000000 [E1]'}}]}));}
 });
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));
 const c=new LocalModels({runtime:'custom',baseUrl:'http://127.0.0.1:'+s.address().port+'/v1'});
 assert.equal((await c.models())[0].id,'fixture-model');
 const p=await c.provider('fixture-model',{stream:false});
 const cfg=structuredClone(DEFAULT_CONFIG);cfg.agent.workspaceRoot=process.cwd();
 const registry=createRegistry({cfg});
 const messages=[{role:'user',content:'Calculate determinant'}];
 const result=await runAgentLoop({provider:p,registry,messages,maxSteps:3});
 assert.equal(result.done,true);assert.equal(calls,2);
 assert.ok(result.research.evidence.some(e=>e.tool==='matrix_ops'));
});
test('CLI local args preserve workspace/sandbox and reject ambiguous startup options',()=>{
 const r=parseLocalArgs(['--local','ollama','--local-start','--local-model','qwen:32b','--local-timeout','900','--workspace','/tmp','--sandbox']);
 assert.equal(r.options.timeoutMs,900000);assert.deepEqual(r.rest,['--workspace','/tmp','--sandbox']);
 assert.throws(()=>parseLocalArgs(['--local','lmstudio','--local-start']));
 assert.throws(()=>parseLocalArgs(['--local','ollama','--local','custom']));
});
