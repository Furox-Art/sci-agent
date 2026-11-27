import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,link,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRegistry,DEFAULT_CONFIG} from '@sci/core';

async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'sci-guard-'));
 t.after(()=>rm(parent,{recursive:true,force:true}));
 const root=path.join(parent,'project'),outside=path.join(parent,'outside');
 await mkdir(root);await mkdir(outside);
 await writeFile(path.join(outside,'private.csv'),'value\n10\n20\n');
 const cfg=structuredClone(DEFAULT_CONFIG);cfg.agent.workspaceRoot=root;
 return {root,outside,r:createRegistry({cfg,approve:async()=>true})};
}
test('path guard rejects file symlink reads/writes/edits and statistics',async t=>{
 const {root,outside,r}=await fixture(t);
 const source=path.join(outside,'private.csv');
 try{await symlink(source,path.join(root,'link.csv'),'file');}
 catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('Windows symlink permission unavailable');return;}throw e;}
 for(const [tool,args] of [
 ['read_file',{path:'link.csv'}],['write_file',{path:'link.csv',content:'changed'}],
 ['edit_file',{path:'link.csv',oldText:'10',newText:'90'}],
 ['csv_stats',{path:'link.csv'}],['stats_calc',{path:'link.csv',columns:['value']}]
 ])assert.equal((await r.invoke(tool,args)).ok,false,tool);
 assert.equal(await readFile(source,'utf8'),'value\n10\n20\n');
 assert.doesNotMatch((await r.invoke('search_files',{pattern:'value'})).output,/link.csv/);
});
test('path guard blocks directory symlinks and new writes through linked parents',async t=>{
 const {root,outside,r}=await fixture(t);
 try{await symlink(outside,path.join(root,'escape'),'dir');}catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('Windows symlink permission unavailable');return;}throw e;}
 for(const [tool,args] of [
 ['read_file',{path:'escape/private.csv'}],['write_file',{path:'escape/new.txt',content:'x'}],
 ['list_dir',{path:'escape'}],['search_files',{path:'escape',pattern:'value'}],
 ['run_command',{cwd:'escape',command:'echo should-not-run'}]
 ])assert.equal((await r.invoke(tool,args)).ok,false,tool);
 await assert.rejects(readFile(path.join(outside,'new.txt')));
});
test('hardlinks cannot be used to read or overwrite external files; ordinary new paths work',async t=>{
 const {root,outside,r}=await fixture(t);
 await link(path.join(outside,'private.csv'),path.join(root,'hard.csv'));
 for(const name of ['read_file','write_file','csv_stats'])assert.equal((await r.invoke(name,{path:'hard.csv',content:'x'})).ok,false,name);
 assert.equal((await r.invoke('write_file',{path:'nested/new.txt',content:'ok'})).ok,true);
 assert.equal((await r.invoke('read_file',{path:'nested/new.txt'})).output,'ok');
});
