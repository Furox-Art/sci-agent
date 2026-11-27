import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ResearchState,MockProvider,createRegistry,DEFAULT_CONFIG,runAgentLoop,analyzeNaturalLanguage,auditCausalModels,reproduceEvidence,routeTools} from '@sci/core';
const hash=s=>createHash('sha256').update(s).digest('hex');
const json=o=>({content:JSON.stringify(o)});
const source1='Drug A caused a reduction in systolic blood pressure in adults at week 8.';
const source2='Among adults at week 8, Drug A elevated systolic blood pressure.';
function sources(){
  const r=new ResearchState();
  for(const [i,s] of [[1,source1],[2,source2]])r.record('E'+i,'lit_fulltext',{}, {ok:true,output:'--- Full text (section: paragraph text) ---\n'+s+'\nNote: paragraph ids'});
  return r;
}
const claims=[
  {evidenceId:'E1',quote:source1,proposition:'Drug A lowers systolic blood pressure',context:'Adults, week 8',modality:'asserted'},
  {evidenceId:'E2',quote:source2,proposition:'Drug A raises systolic blood pressure',context:'Adults, week 8',modality:'asserted'}
];
const pair={a:'C1',b:'C2',relation:'contradiction',sameContext:true,rationale:'Opposite directional effects with the same stated context'};
test('NLI extracts real source spans, detects paraphrased candidate conflict, and uses no tools',async()=>{
  const r=sources(),p=new MockProvider([json({claims}),json({pairs:[pair]})]);
  const out=await analyzeNaturalLanguage({evidenceIds:['E1','E2']},r,p);
  assert.equal(out.conflicts.length,1);
  assert.equal(out.claims[0].sourceHash,r.snapshot().evidence[0].sha256);
  assert.equal(out.claims[0].end,source1.length);
  assert.equal(out.claims[0].sourceType,'retrieved_fulltext');
  assert.ok(p.calls.every(c=>c.tools.length===0));
});
test('NLI handles arbitrary supplied natural language but never registers it as evidence',async()=>{
  const r=new ResearchState(),p=new MockProvider([json({claims:claims.map((c,i)=>({...c,evidenceId:'S'+(i+1)}))}),json({pairs:[pair]})]);
  const out=await analyzeNaturalLanguage({texts:[{label:'A',text:source1},{label:'B',text:source2}]},r,p);
  assert.equal(out.conflicts.length,1);
  assert.equal(out.claims[0].sourceType,'supplied_text_not_verified');
  assert.equal(out.claims[0].sourceHash,hash(source1));
  assert.equal(r.snapshot().evidence.length,0);
});
test('NLI refuses fabricated quotations, unselected IDs and invalid pair verdicts',async()=>{
  const r=sources();
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1','E2']},r,new MockProvider([json({claims:[{...claims[0],quote:'fabricated'}]})])),/does not match/);
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1']},r,new MockProvider([json({claims:[claims[1]]})])),/unselected/);
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1','E2']},r,new MockProvider([json({claims}),json({pairs:[]})])),/Incomplete pairwise/);
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1','E2']},r,new MockProvider([json({claims}),json({pairs:[{...pair,a:'C9'}]})])),/Invalid or duplicate/);
});
test('NLI abstains on uncertain modality or different context and empty extraction',async()=>{
  const r=sources();
  for(const [c,p] of [[claims,{...pair,sameContext:false}],[[claims[0],{...claims[1],modality:'uncertain'}],pair]]){
    const out=await analyzeNaturalLanguage({evidenceIds:['E1','E2']},r,new MockProvider([json({claims:c}),json({pairs:[p]})]));
    assert.equal(out.conflicts.length,0);assert.equal(out.judgments[0].relation,'uncertain');
  }
  assert.equal((await analyzeNaturalLanguage({evidenceIds:['E1']},r,new MockProvider([json({claims:[]})]))).status,'no_extracted_claims');
});
test('NLI rejects malformed JSON, injected tool calls and cancellation',async()=>{
  const r=sources();
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1']},r,new MockProvider([{content:'not JSON'}])),/valid JSON/);
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1']},r,new MockProvider([{toolCalls:[{name:'run_command',arguments:{}}]}])),/Unexpected tool call/);
  const ac=new AbortController();ac.abort();
  await assert.rejects(()=>analyzeNaturalLanguage({evidenceIds:['E1']},r,new MockProvider([]),ac.signal),/aborted/);
});

const observedData=Array.from({length:240},(_,i)=>({X:Math.sin(i*2.13),Z:Math.cos(i*1.77),Y:2*Math.sin(i*2.13)+.2*Math.cos(i*2.17)}));
const base={nodes:['X','Y','Z'],treatment:'X',outcome:'Y',data:observedData};
test('causal audit rejects a graph predicting false independence and retains compatible candidate',()=>{
  const r=auditCausalModels({...base,models:[{id:'empty',edges:[]},{id:'direct',edges:[['X','Y']]}],adjustment:[]});
  assert.equal(r.models[0].status,'incompatible_with_assumptions');
  assert.equal(r.models[1].status,'not_rejected');
  assert.equal(r.adjustmentRobustness,'valid_in_all_nonrejected_candidates');
  assert.ok(r.models[0].checks.some(c=>c.a==='X'&&c.b==='Y'&&c.rejected&&c.adjustedP<=r.alpha));
  assert.ok(r.testedCount<=r.uniqueTests);
});
test('causal audit cannot distinguish Markov-equivalent orientations; explicit time constraints can reject',()=>{
  const models=[{id:'forward',edges:[['X','Y']]},{id:'reverse',edges:[['Y','X']]}];
  const r=auditCausalModels({...base,models,adjustment:[]});
  assert.equal(r.models[0].status,'not_rejected');assert.equal(r.models[1].status,'not_rejected');
  assert.equal(r.adjustmentRobustness,'not_robust_across_candidates');
  const t=auditCausalModels({...base,models,adjustment:[],temporalOrder:{X:0,Y:1}});
  assert.equal(t.models[1].status,'incompatible_with_assumptions');
  assert.deepEqual(t.models[1].temporalViolations,[['Y','X']]);
});
test('causal audit tests local Markov conditional independence of a chain',()=>{
  const rows=Array.from({length:500},(_,i)=>{
    const x=Math.sin(i*1.11),z=x+Math.cos(i*1.43),y=2*z+Math.sin(i*2.31);return {X:x,Z:z,Y:y};
  });
  const result=auditCausalModels({...base,data:rows,models:[{id:'chain',edges:[['X','Z'],['Z','Y']]}]});
  const check=result.models[0].checks.find(c=>c.a==='X'&&c.b==='Y'&&c.conditionedOn.includes('Z'));
  assert.ok(check);assert.ok(Math.abs(check.partialCorrelation)<.05);assert.equal(check.rejected,false);
});
test('causal audit marks constant variables and latent-parent tests untestable; rejects invalid input',()=>{
  const a=auditCausalModels({...base,data:observedData.map(x=>({...x,Z:0})),models:[{id:'direct',edges:[['X','Y']]}]});
  assert.ok(a.models[0].checks.some(c=>c.status==='untestable'));
  const b=auditCausalModels({...base,nodes:['X','Y','Z','U'],observed:['X','Y','Z'],models:[{id:'latent',edges:[['U','X'],['U','Y']]}],adjustment:[]});
  assert.ok(b.models[0].skippedLatent>0);assert.equal(b.adjustmentRobustness,'not_robust_across_candidates');
  assert.throws(()=>auditCausalModels({...base,models:[{id:'bad',edges:[['X','Y'],['Y','X']]}]}),/acyclic/);
  assert.throws(()=>auditCausalModels({...base,data:[{X:1,Y:2}],models:[{id:'bad',edges:[]}]}),/complete numeric rows/);
});

const calculations=[
  ['matrix_ops',{op:'multiply',a:[[2,3],[1,2]],b:[[4,5],[6,7]]}],
  ['matrix_ops',{op:'inverse',a:[[2,1],[3,4]]}],
  ['matrix_ops',{op:'inverse',a:[[4]]}],
  ['math_eval',{expression:'-2*(3+4)+1e-2/2'}],
  ['unit_convert',{value:100,from:'C',to:'F'}],
  ['unit_convert',{value:2,from:'mi',to:'km'}],
  ['research_uncertainty',{estimate:10,unit:'m',gradient:[1,1],standardUncertainties:[3,4],correlation:[[1,.5],[.5,1]]}],
];
test('expanded independent replay exercises all supported new operations against actual tool outputs',async()=>{
  const r=new ResearchState(),registry=createRegistry({cfg:DEFAULT_CONFIG});
  for(const [i,[tool,args]] of calculations.entries()){
    const result=await registry.invoke(tool,args,{research:r});
    assert.equal(result.ok,true,result.output);
    assert.ok(r.record('E'+(i+1),tool,args,result));
    const replay=reproduceEvidence(r.snapshot().evidence.at(-1));
    assert.equal(replay.status,'reproduced',JSON.stringify(replay));
  }
});
test('replay detects altered matrix output, arithmetic prefix and unit input even with fresh hashes',()=>{
  for(const [tool,args,output] of [
    ['matrix_ops',{op:'multiply',a:[[2]],b:[[3]]},'product:\n[6.000000000]\nmatrix = [[7]]'],
    ['math_eval',{expression:'2+3'},'1+4 = 5'],
    ['unit_convert',{value:100,from:'C',to:'F'},'99 C = 212 F'],
  ]){
    assert.equal(reproduceEvidence({id:'E1',tool,args,output,sha256:hash(output)}).status,'mismatch');
  }
});
test('unsupported replay does not run arbitrary code or pretend to reproduce unimplemented expressions',()=>{
  const output='sqrt(4) = 2';
  assert.equal(reproduceEvidence({id:'E1',tool:'math_eval',args:{expression:'sqrt(4)'},output,sha256:hash(output)}).status,'unsupported');
});
test('new tool routing and actual agent loop record semantic analyses without promoting model output to evidence',async()=>{
  const registry=createRegistry({cfg:DEFAULT_CONFIG});
  assert.ok(routeTools(registry.schemas(),'semantic contradiction').prioritized.includes('research_semantic'));
  assert.ok(routeTools(registry.schemas(),'causal DAG').prioritized.includes('research_causal_audit'));
  const args={texts:[{label:'A',text:source1},{label:'B',text:source2}]};
  const p=new MockProvider([
    {toolCalls:[{name:'research_semantic',arguments:args}]},
    json({claims:claims.map((c,i)=>({...c,evidenceId:'S'+(i+1)}))}),json({pairs:[pair]}),
    {content:'Candidate conflict found; manual review is necessary.'}
  ]);
  const res=await runAgentLoop({provider:p,registry,messages:[{role:'user',content:'semantic contradiction'}]});
  assert.equal(res.done,true);
  assert.equal(res.research.analyses[0].result.conflicts.length,1);
  assert.equal(res.research.evidence.length,0);
  assert.equal(p.calls.length,4);
});
test('causal audit tool integrates numerical evidence and full analysis snapshot into agent loop',async()=>{
  const args={...base,models:[{id:'empty',edges:[]},{id:'direct',edges:[['X','Y']]}]};
  const expected=auditCausalModels(args);
  const provider=new MockProvider([{toolCalls:[{name:'research_causal_audit',arguments:args}]},{content:'testedCount = '+expected.testedCount+' [E1]'}]);
  const result=await runAgentLoop({provider,registry:createRegistry({cfg:DEFAULT_CONFIG}),messages:[{role:'user',content:'causal model audit'}]});
  assert.equal(result.done,true);
  assert.equal(result.research.claims[0].evidenceId,'E1');
  assert.equal(result.research.analyses[0].result.models[0].status,'incompatible_with_assumptions');
});
