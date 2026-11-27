import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stats_calc } from '../packages/core/src/science/sci-data.js';
import { csv_stats } from '../packages/core/src/science/sci-tools.js';
import { describeNumbers, linearFit } from '../packages/core/src/science/numeric-stats.js';
import { reproduceEvidence } from '../packages/core/src/science/uncertainty-replay.js';

const run = numbers => stats_calc.execute({numbers},{});
const verify = (numbers,output) => reproduceEvidence({id:'E',tool:'stats_calc',args:{numbers},output,sha256:createHash('sha256').update(output).digest('hex')});

test('statistics preserve small residuals after cancellation in every input order', async () => {
  for(const numbers of [[1e16,1,-1e16],[1e16,-1e16,1],[1,-1e16,1e16]]) {
    const result=describeNumbers(numbers);
    assert.equal(result.mean,1/3);
    assert.equal(result.variance,1e32);
    const output=await run(numbers);
    assert.match(output,/mean=0\.333333/);
    assert.equal(verify(numbers,output).status,'reproduced');
  }
});
test('sample variance is correct near large offsets', async () => {
  const numbers=[1e16,1e16+2];
  const result=describeNumbers(numbers);
  assert.equal(result.variance,2);
  assert.equal(result.sd,Math.sqrt(2));
  const output=await run(numbers);
  assert.match(output,/variance=2\.00000/);
  assert.equal(verify(numbers,output).status,'reproduced');
});
test('constant huge finite values do not create false overflow', async () => {
  const numbers=[1e308,1e308];
  const result=describeNumbers(numbers);
  assert.equal(result.mean,1e308);
  assert.equal(result.median,1e308);
  assert.equal(result.variance,0);
  const output=await run(numbers);
  assert.doesNotMatch(output,/Infinity|NaN/);
  assert.equal(verify(numbers,output).status,'reproduced');
});
test('genuine overflow and underflow are explicit rather than false finite results', async () => {
  await assert.rejects(run([-1e308,1e308]),/overflow/);
  await assert.rejects(run([0,1e-200]),/underflow/);
  const result=describeNumbers([-1e200,1e200],{includeVariance:false});
  assert.equal(result.sd,Math.SQRT2*1e200);
  assert.equal(describeNumbers([Number.MIN_VALUE,Number.MIN_VALUE]).mean,Number.MIN_VALUE);
});
test('inline numbers are validated instead of coercing or dropping observations', async () => {
  for(const numbers of [[null,2,4],['2',4],[true,2],[NaN,2],[Infinity,2],Array(2),null]) {
    await assert.rejects(run(numbers),/finite numeric values/);
  }
});
test('correlation and regression remain stable across large and tiny scales', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'sci-stable-stats-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const scale of [1e100,1e-100]){
    const pairs=[[scale,2*scale],[2*scale,4*scale],[3*scale,6*scale]];
    const fit=linearFit(pairs);
    assert.equal(fit.r,1);
    assert.equal(fit.slope,2);
    assert.equal(fit.intercept,0);
    assert.equal(fit.r2,1);
    await writeFile(path.join(root,'data.csv'),'x,y\n'+pairs.map(r=>r.join(',')).join('\n'));
    const output=await stats_calc.execute({path:'data.csv',columns:['x','y']},{workspaceRoot:root});
    assert.match(output,/Pearson correlation r = 1\.00000/);
    assert.match(output,/slope a=2\.00000/);
  }
  const fit=linearFit([[1,3],[2,2],[3,1]]);
  assert.deepEqual(fit,{r:-1,slope:-1,intercept:4,r2:1});
});
test('CSV statistics do not claim sample standard deviation for a single observation',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'sci-single-stat-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'data.csv'),'x\n3\n');
  const output=await csv_stats.execute({path:'data.csv'},{workspaceRoot:root});
  assert.match(output,/n=1, mean=3\.00000, sd=undefined/);
});
test('large inline datasets do not use spread-argument calls or lose variance',()=>{
  const values=Array.from({length:100000},(_,i)=>i%2?1:3);
  const result=describeNumbers(values);
  assert.equal(result.mean,2);
  assert.equal(result.min,1);
  assert.equal(result.max,3);
  assert.equal(result.variance,100000/99999);
});
