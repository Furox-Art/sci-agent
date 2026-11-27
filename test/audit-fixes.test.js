import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { matrix_ops, stats_calc } from '../packages/core/src/science/sci-data.js';
import { csv_stats } from '../packages/core/src/science/sci-tools.js';
import { parseCsv, parseNumericCell } from '../packages/core/src/science/csv-parser.js';
import { reproduceEvidence } from '../packages/core/src/science/uncertainty-replay.js';
import { ToolRegistry } from '../packages/core/src/tools/index.js';

const matrixResult = output => JSON.parse(output.split('\n').at(-1).slice('matrix = '.length));
const determinant = async a => Number((await matrix_ops.execute({op:'det',a})).split(' = ')[1]);
const replay = (args, output) => reproduceEvidence({id:'E1',tool:'matrix_ops',args,output,sha256:createHash('sha256').update(output).digest('hex')});

test('determinant preserves small nonzero pivots', async () => {
  assert.equal(await determinant([[2,1],[0,2]]),4);
  assert.equal(await determinant([[1,2],[2,4]]),0);
  assert.equal(await determinant([[1e-13]]),1e-13);
  assert.equal(await determinant([[1e-13,0],[0,1e-13]]),1e-26);
  assert.equal(await determinant([[0,2],[3,0]]),-6);
});
test('small inverse and product preserve literal and independent replay', async () => {
  const inverse = {op:'inverse',a:[[1e-13]]};
  const inv = await matrix_ops.execute(inverse);
  assert.deepEqual(matrixResult(inv),[[1e13]]);
  assert.equal(replay(inverse,inv).status,'reproduced');
  const multiply = {op:'multiply',a:[[1e-13]],b:[[1e-13]]};
  const out = await matrix_ops.execute(multiply);
  assert.deepEqual(matrixResult(out),[[1e-26]]);
  assert.equal(replay(multiply,out).status,'reproduced');
  await assert.rejects(matrix_ops.execute({op:'inverse',a:[[1,2],[2,4]]}),/singular/);
});
test('matrix overflow fails instead of publishing infinity', async () => {
  await assert.rejects(matrix_ops.execute({op:'multiply',a:[[1e308]],b:[[1e308]]}),/finite|overflow/i);
});
test('CSV supports BOM, quoted commas, escaped quotes, newlines and CRLF', () => {
  assert.deepEqual(parseCsv('\uFEFF"name","x"\r\n"a,b",1\r\n"c""d\nline",3\r\n'), {header:['name','x'],rows:[['a,b','1'],['c"d\nline','3']]});
  assert.throws(()=>parseCsv('a,b\n"x,1'),/unterminated/);
  assert.throws(()=>parseCsv('a,b\n1,2,3'),/wrong number/);
  assert.throws(()=>parseCsv('a,a\n1,2'),/duplicate/);
  assert.equal(parseNumericCell(''),null);
  assert.equal(parseNumericCell('0'),0);
  assert.equal(parseNumericCell('0x10'),null);
});
test('both CSV tools exclude empty values and agree on valid quoted data', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'sci-audit-'));
  try {
    await writeFile(path.join(root,'data.csv'),'label,x\n"a,b",1\n"c""d",\n"e",3\n');
    const result1=await csv_stats.execute({path:'data.csv',columns:['x']},{workspaceRoot:root});
    const result2=await stats_calc.execute({path:'data.csv',columns:['x']},{workspaceRoot:root});
    for(const output of [result1,result2]) assert.match(output,/n=2, mean=2\.00000/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('programmatic approval fails closed unless explicitly approved', async () => {
  let calls=0;
  const tool={name:'audit_fixture',needsApproval:true,execute:async()=>{calls++;return 'ok';}};
  const invoke = options => new ToolRegistry({tools:[tool],...options}).invoke(tool.name);
  assert.equal((await invoke({})).ok,false);
  assert.equal((await invoke({approve:async()=> 'yes'})).ok,false);
  assert.equal((await invoke({approve:async()=>{throw Error('failure');}})).ok,false);
  assert.equal(calls,0);
  assert.equal((await invoke({approve:async()=>true})).ok,true);
  assert.equal((await invoke({autoApprove:[tool.name]})).ok,true);
  assert.equal(calls,2);
});
