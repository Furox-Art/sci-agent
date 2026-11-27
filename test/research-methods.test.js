import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { causalAnalysis, experimentDesign, propagateUncertainty, reproduceEvidence, semanticConflicts, ResearchState, routeTools, createRegistry, DEFAULT_CONFIG, MockProvider, runAgentLoop, saveResearch, getResearch, searchResearch, lessonGate } from '@sci/core';
const close=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const tmp=async t=>{const root=await mkdtemp(path.join(os.tmpdir(),'sci-method-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;};
const cfg=(root,extra={})=>({...structuredClone(DEFAULT_CONFIG),agent:{...structuredClone(DEFAULT_CONFIG.agent),workspaceRoot:root,...extra}});
const digest=s=>createHash('sha256').update(s).digest('hex');
const gateGraph={nodes:['Z','X','Y'],edges:[['Z','X'],['Z','Y'],['X','Y']],treatment:'X',outcome:'Y'};

test('causal DAG selects observed confounder and rejects unadjusted backdoor',()=>{
  assert.deepEqual(causalAnalysis(gateGraph).minimalAdjustmentSets,[['Z']]);
  assert.equal(causalAnalysis({...gateGraph,adjustment:[]}).status,'backdoor_open');
  assert.equal(causalAnalysis({...gateGraph,observed:['X','Y']}).status,'no_observed_backdoor_set');
});
test('causal DAG does not condition on a collider or its descendants; detects cycles',()=>{
  const g={nodes:['A','B','X','Y','C','D'],edges:[['A','X'],['A','C'],['B','C'],['B','Y'],['C','D']],treatment:'X',outcome:'Y'};
  assert.deepEqual(causalAnalysis(g).minimalAdjustmentSets,[[]]);
  assert.equal(causalAnalysis({...g,adjustment:['C']}).status,'backdoor_open');
  assert.equal(causalAnalysis({...g,adjustment:['D']}).status,'backdoor_open');
  assert.throws(()=>causalAnalysis({...gateGraph,edges:[...gateGraph.edges,['Y','X']]}),/acyclic/);
});
test('causal adjustment rejects treatment descendants, including mediators',()=>{
  assert.throws(()=>causalAnalysis({nodes:['X','M','Y'],edges:[['X','M'],['M','Y']],treatment:'X',outcome:'Y',adjustment:['M']}),/non-descendants/);
});

const plan={arms:['control','treatment'],participants:Array.from({length:200},(_,i)=>'P'+i),seed:'predeclared-seed',outcome:'primary',hypothesis:'difference',controls:'same conditions',analysisPlan:'two-sample comparison',standardizedEffect:0.5};
test('experiment randomization is deterministic, balanced and independent of input ordering; power planning',()=>{
  const a=experimentDesign(plan), b=experimentDesign({...plan,participants:[...plan.participants].reverse()});
  assert.deepEqual(a.allocation,b.allocation);
  assert.deepEqual(a.counts,{control:100,treatment:100});
  assert.equal(a.planning.perArm,63);
  assert.equal(a.planning.adequate,true);
  assert.equal(new Set(a.allocation.map(x=>x.id)).size,200);
  assert.notDeepEqual(a.allocation,experimentDesign({...plan,seed:'another'}).allocation);
});
test('experiment rejects duplicate subjects and missing protocol, flags underpowered design',()=>{
  assert.throws(()=>experimentDesign({...plan,participants:['a','a']}),/Unique participant/);
  assert.throws(()=>experimentDesign({...plan,analysisPlan:''}),/analysis plan/);
  assert.equal(experimentDesign({...plan,participants:['a','b']}).planning.adequate,false);
});

const unc={estimate:10,unit:'m',gradient:[1,1],standardUncertainties:[3,4]};
test('uncertainty independent, correlated and singular cases',()=>{
  close(propagateUncertainty(unc).standardUncertainty,5);
  close(propagateUncertainty({...unc,correlation:[[1,.5],[.5,1]]}).variance,37);
  close(propagateUncertainty({...unc,correlation:[[1,1],[1,1]]}).variance,49);
  close(propagateUncertainty({...unc,gradient:[1,-1],correlation:[[1,1],[1,1]]}).variance,1);
});
test('uncertainty rejects non-PSD correlations, asymmetric matrices and invalid inputs',()=>{
  assert.throws(()=>propagateUncertainty({...unc,correlation:[[1,.5],[.2,1]]}),/symmetric/);
  assert.throws(()=>propagateUncertainty({...unc,gradient:[1,1,1],standardUncertainties:[1,1,1],correlation:[[1,.9,.9],[.9,1,-.9],[.9,-.9,1]]}),/semidefinite/);
  assert.throws(()=>propagateUncertainty({...unc,standardUncertainties:[-1,1]}),/Nonnegative/);
});

test('reproduction uses independent determinant and Welford algorithms',async t=>{
  const root=await tmp(t), registry=createRegistry({cfg:cfg(root)}), state=new ResearchState();
  for(const [i,tool,args] of [[1,'matrix_ops',{op:'det',a:[[2,1],[3,4]]}],[2,'stats_calc',{numbers:[1,2,3,4,5]}]]){
    state.record('E'+i,tool,args,await registry.invoke(tool,args));
  }
  for(const e of state.snapshot().evidence)assert.equal(reproduceEvidence(e).status,'reproduced');
});
test('reproduction catches mismatching values, corrupt output, and unsupported operations',()=>{
  const output='determinant = 9';
  const e={id:'E1',tool:'matrix_ops',args:{op:'det',a:[[2,0],[0,2]]},output,sha256:digest(output)};
  assert.equal(reproduceEvidence(e).status,'mismatch');
  assert.throws(()=>reproduceEvidence({...e,output:'determinant = 4'}),/hash mismatch/);
  assert.equal(reproduceEvidence({...e,tool:'csv_stats'}).status,'unsupported');
});

function assertions(){
  const state=new ResearchState();
  state.record('E1','lit_fulltext',{}, {ok:true,output:'--- Full text (section: paragraph text) ---\nIntervention increases survival. Mass is one gram.\nNote: paragraph ids'});
  state.record('E2','lit_fulltext',{}, {ok:true,output:'--- Full text (section: paragraph text) ---\nIntervention reduces survival. Mass is two grams.\nNote: paragraph ids'});
  const base={subject:'Intervention',object:'Survival',context:'Population A; 6 weeks',negated:false};
  return {state,a:{...base,id:'A',relation:'raises',evidenceId:'E1',quote:'Intervention increases survival.'},b:{...base,id:'B',relation:'azaltır',evidenceId:'E2',quote:'Intervention reduces survival.'}};
}
test('semantic conflict recognizes controlled synonyms and opposite polarity, respects context',()=>{
  const {state,a,b}=assertions();
  assert.equal(semanticConflicts([a,b],state).conflicts[0].reason,'opposing_direction');
  assert.equal(semanticConflicts([a,{...b,relation:'increase',negated:true}],state).conflicts[0].reason,'opposite_polarity');
  assert.equal(semanticConflicts([a,{...b,context:'Population B'}],state).conflicts.length,0);
  assert.throws(()=>semanticConflicts([a,{...b,quote:'invented'}],state),/no matching eligible evidence/);
});
test('semantic conflict compares normalized units and flags disjoint intervals',()=>{
  const {state,a,b}=assertions(), common={subject:'Sample',relation:'equals',object:'mass'};
  const x={...a,...common,quote:'Mass is one gram.',quantity:{min:1,max:1,unit:'g'}};
  const y={...b,...common,quote:'Mass is two grams.',quantity:{min:2000,max:2000,unit:'mg'}};
  assert.equal(semanticConflicts([x,y],state).conflicts[0].reason,'disjoint_intervals');
  assert.equal(semanticConflicts([x,{...y,quantity:{min:1000,max:1000,unit:'mg'}}],state).conflicts.length,0);
  assert.equal(semanticConflicts([x,{...y,quantity:{min:1,max:1,unit:'s'}}],state).incomparable.length,1);
});
test('memory persistence, deduplication, scoped retrieval and integrity',async t=>{
  const root=await tmp(t), other=await tmp(t), state=new ResearchState();
  state.addHypothesis({id:'H1',statement:'glucose changes',prediction:'rise',falsifier:'fall'});
  const snapshot=state.snapshot();
  const [a,b]=await Promise.all([saveResearch(root,snapshot,{label:'glucose'}),saveResearch(root,snapshot,{label:'glucose'})]);
  assert.equal(a.id,b.id);
  assert.equal((await searchResearch(root,'glucose')).length,1);
  assert.equal((await searchResearch(other,'glucose')).length,0);
  assert.deepEqual((await getResearch(root,a.id)).payload.snapshot.hypotheses,snapshot.hypotheses);
  await assert.rejects(()=>getResearch(root,'../escape'),/Invalid memory ID/);
  const file=path.join(root,'.sci-agent-research','memory',a.id+'.json');
  const record=JSON.parse(await readFile(file,'utf8'));record.payload.label='tampered';
  await writeFile(file,JSON.stringify(record));
  await assert.rejects(()=>getResearch(root,a.id),/integrity check/);
});
test('memory rejects symbolic-link stores', {skip:process.platform==='win32'},async t=>{
  const root=await tmp(t), other=await tmp(t);
  await symlink(other,path.join(root,'.sci-agent-research'),'dir');
  await assert.rejects(()=>searchResearch(root),/real directory/);
});

test('router ranks relevant tools, restores full catalog and never changes registry approvals',()=>{
  const registry=createRegistry({cfg:DEFAULT_CONFIG}), schemas=registry.schemas();
  const result=routeTools(schemas,'nedensellik ve belirsizlik',{shortlist:true});
  assert.equal(result.mode,'shortlist');
  assert.ok(result.schemas.some(s=>s.name==='research_causal'));
  assert.ok(result.schemas.some(s=>s.name==='research_uncertainty'));
  assert.ok(result.schemas.some(s=>s.name==='research_route'));
  assert.ok(result.schemas.length<schemas.length);
  assert.equal(routeTools(schemas,'unknown request',{shortlist:true}).schemas.length,schemas.length);
  assert.equal(registry.list().find(x=>x.name==='research_memory').needsApproval,true);
});
test('actual agent loop routes first step and expands full catalog after tool call',async t=>{
  const root=await tmp(t), provider=new MockProvider([{toolCalls:[{name:'research_route',arguments:{}}]},{content:'Catalog retrieved.'}]);
  const registry=createRegistry({cfg:cfg(root,{toolRouting:{enabled:true,shortlist:true}})});
  const result=await runAgentLoop({provider,registry,messages:[{role:'user',content:'causal DAG analysis'}]});
  assert.equal(result.done,true);
  assert.ok(provider.calls[0].tools.length<registry.tools.length);
  assert.equal(provider.calls[1].tools.length,registry.tools.length);
});
test('actual agent persists analysis and binds computed uncertainty evidence',async t=>{
  const root=await tmp(t), provider=new MockProvider([{toolCalls:[{name:'research_uncertainty',arguments:unc}]},{content:'standardUncertainty = 5 [E1]'}]);
  const result=await runAgentLoop({provider,registry:createRegistry({cfg:cfg(root,{researchMemory:{autoSave:true}})}),messages:[{role:'user',content:'uncertainty'}]});
  assert.equal(result.done,true);
  assert.equal(result.research.analyses[0].tool,'research_uncertainty');
  assert.equal(result.research.claims[0].evidenceId,'E1');
  assert.equal((await getResearch(root,result.memory.id)).payload.status,'completed');
});
test('actual upstream lesson gate detects open debt, blocks model call and captures withheld claims',async t=>{
  const root=await tmp(t), registry=createRegistry({cfg:cfg(root,{lessonGate:{enabled:true}})});
  const provider=new MockProvider([{content:'p = 0.03'},{content:'p = 0.03'}]);
  const result=await runAgentLoop({provider,registry,messages:[{role:'user',content:'scientific result'}]});
  assert.equal(result.unverified,true);
  assert.equal(result.lessonCapture.code,0);
  const stats=await lessonGate(root,'stats');
  assert.equal(JSON.parse(stats.output).by_status.open,1);
  const next=new MockProvider([{content:'must not run'}]);
  const blocked=await runAgentLoop({provider:next,registry,messages:[{role:'user',content:'new task'}]});
  assert.equal(blocked.lessonBlocked,true);
  assert.equal(next.calls.length,0);
  assert.equal((await lessonGate(root,'preflight')).code,1);
});
test('lesson gate rejects corrupt ledger and unknown bridge action',async t=>{
  const root=await tmp(t);
  await lessonGate(root,'stats');
  await writeFile(path.join(root,'.sci-agent-research','lessons','events.jsonl'),'not json\n');
  assert.equal((await lessonGate(root,'preflight')).code,2);
  await assert.rejects(()=>lessonGate(root,'unsupported'),/Unsupported bridge action/);
});

test('scientific notation is fully matched by the evidence gate',async t=>{
  const root=await tmp(t);
  const provider=new MockProvider([{toolCalls:[{name:'research_uncertainty',arguments:{estimate:1,unit:'m',gradient:[1],standardUncertainties:[1e-8]}}]},{content:'standardUncertainty = 1e-8 [E1]'}]);
  const result=await runAgentLoop({provider,registry:createRegistry({cfg:cfg(root)}),messages:[{role:'user',content:'uncertainty'}]});
  assert.equal(result.done,true);
  assert.equal(result.research.claims[0].snippet,'standardUncertainty = 1e-8');
});
test('known independent reproduction mismatch blocks related final claims',()=>{
  const state=new ResearchState(), output='determinant = 9';
  state.record('E1','matrix_ops',{op:'det',a:[[2,0],[0,2]]},{ok:true,output});
  state.recordAnalysis('research_reproduce',{evidenceId:'E1'},reproduceEvidence(state.snapshot().evidence[0]));
  const claim={kind:'equation',snippet:output,start:0,end:output.length};
  assert.equal(state.checkClaims(output+' [E1]',[claim])[0].reason,'independent_reproduction_mismatch');
});
