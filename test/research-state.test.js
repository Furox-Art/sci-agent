import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchState, createRegistry, DEFAULT_CONFIG, MockProvider, runAgentLoop, scanClaims } from '@sci/core';

const ctx = { workspaceRoot: '.' };
const claim = 'determinant = 4.000000000';
const request = { name: 'matrix_ops', arguments: { op: 'det', a: [[2,0],[0,2]] } };
function cfg(extra = {}) {
  return { ...structuredClone(DEFAULT_CONFIG), agent: { ...DEFAULT_CONFIG.agent, workspaceRoot: '.', ...extra } };
}
async function run(script, config = cfg(), maxSteps = 8) {
  const provider = new MockProvider(script);
  const events = [];
  const messages = [{ role: 'system', content: 'test' }, { role: 'user', content: 'test research' }];
  const result = await runAgentLoop({ provider, registry: createRegistry({ cfg: config }), messages, maxSteps, onEvent: e => events.push(e) });
  return { result, messages, events };
}

test('each detected claim needs a matching eligible result and explicit ID', async () => {
  const { result } = await run([{ toolCalls: [request] }, { content: claim + ' [E1]' }]);
  assert.equal(result.done, true);
  assert.equal(result.research.claims[0].evidenceId, 'E1');
  assert.equal(result.research.evidence[0].tool, 'matrix_ops');
  assert.match(result.research.evidence[0].sha256, /^[a-f0-9]{64}$/);
});

test('successful tool cannot justify a different value, and draft is withheld', async () => {
  const { result, messages, events } = await run([{ toolCalls: [request] }, { content: 'determinant = 5 [E1]' }, { content: 'determinant = 5 [E1]' }]);
  assert.equal(result.done, false);
  assert.equal(result.unverified, true);
  assert.equal(result.research.claims[0].evidenceId, null);
  assert.ok(!messages.some(m => m.content === 'determinant = 5 [E1]'));
  assert.ok(!events.some(e => e.type === 'text_delta' || e.type === 'text'));
});

test('failed, truncated, or textual error results cannot provide evidence', () => {
  const state = new ResearchState();
  for (const result of [{ ok: false, output: claim }, { ok: true, output: 'Error: ' + claim }, { ok: true, output: claim, truncated: true }]) {
    assert.equal(state.record('E1', 'matrix_ops', {}, result), null);
  }
  assert.equal(state.snapshot().evidence.length, 0);
});

test('missing references, fake IDs and numeric prefixes fail; all claim occurrences scanned', () => {
  const state = new ResearchState();
  state.record('E1', 'matrix_ops', {}, { ok: true, output: 'determinant = 40' });
  for (const text of [claim, claim + ' [E1]', 'determinant = 40 [E9]']) {
    assert.equal(state.checkClaims(text, scanClaims(text)).length, 1);
  }
  const many = Array.from({length: 8}, (_,i) => 'n=' + (i+1)).join('; ');
  assert.equal(scanClaims(many).length, 8);
});

test('literature query echo is not evidence', () => {
  const state = new ResearchState();
  const fake = '10.1234/fake';
  assert.equal(state.record('E1','lit_search', {}, {ok:true,output:'Literature search: "'+fake+'"\nNo results found (0).'}), null);
  state.record('E2','lit_search', {}, {ok:true,output:'Literature search: "'+fake+'"\n   DOI: 10.1234/real | Source(s): Crossref'});
  assert.equal(state.evidence('E2', fake, 'literature'), null);
  assert.ok(state.evidence('E2','10.1234/real','literature'));
});

test('hypothesis state: no invented evidence; opposing findings remain contested', () => {
  const state = new ResearchState();
  state.addHypothesis({id:'H1',statement:'A mechanism',prediction:'A rises',falsifier:'A falls'});
  assert.throws(() => state.assess({id:'H1',evidenceId:'E99',quote:claim,direction:'supports',rationale:'r'}));
  state.record('E1','matrix_ops',{}, {ok:true,output:claim});
  state.record('E2','matrix_ops',{}, {ok:true,output:'determinant = 0'});
  assert.equal(state.assess({id:'H1',evidenceId:'E1',quote:claim,direction:'supports',rationale:'r'}).status,'supported_candidate');
  assert.equal(state.assess({id:'H1',evidenceId:'E2',quote:'determinant = 0',direction:'refutes',rationale:'r'}).status,'contested');
});

test('predeclared hypothesis evaluates only exact matching tool arguments after registration', async () => {
  const { result } = await run([
    {toolCalls:[{name:'research_hypothesis',arguments:{action:'add',id:'H1',statement:'matrix is singular',prediction:'zero determinant',falsifier:'nonzero determinant',test:{tool:'matrix_ops',args:request.arguments,support:'determinant = 0',refute:claim}}}]},
    {toolCalls:[request]},
    {content:'Hypothesis assessment completed.'},
  ]);
  assert.equal(result.research.hypotheses[0].status,'refuted_candidate');
  assert.equal(result.research.hypotheses[0].assessments[0].mode,'automatic');
  assert.equal(result.research.hypotheses[0].assessments[0].evidenceId,'E2');
});

test('strict review gate with no reviewers withholds an otherwise linked claim', async () => {
  const { result } = await run([{toolCalls:[request]},{content:claim+' [E1]'},{content:claim+' [E1]'}], cfg({requireIndependentReview:true}));
  assert.equal(result.done,false);
  assert.equal(result.unverifiedClaims[0].reason,'independent_review_required');
});

function roleFetch(model, verdict = 'support') {
  let count = 0;
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.model, model);
    assert.ok(!body.tools.some(t => ['task','write_file','run_command','python_eval'].includes(t.function.name)));
    count++;
    const message = count === 1 ? {content:'',tool_calls:[{id:'c1',function:{name:request.name,arguments:JSON.stringify(request.arguments)}}]} :
      {content:JSON.stringify({verdict,rationale:'Checked the determinant independently',evidence:[{id:'E1',quote:claim}]})};
    return {ok:true,json:async()=>({choices:[{message}]})};
  };
}
function roleConfig(reviewer='review-model', verifier='verify-model', verdict='support') {
  return cfg({requireIndependentReview:true,roleModels:{
    reviewer:{name:reviewer,baseUrl:'http://review.invalid/v1',stream:false,fetchImpl:roleFetch(reviewer)},
    verifier:{name:verifier,baseUrl:'http://verify.invalid/v1',stream:false,fetchImpl:roleFetch(verifier,verdict)},
  }});
}
const reviewTasks = ['reviewer','verifier'].map(role=>({name:'task',arguments:{role,prompt:'Check determinant using the supplied matrix',target:claim}}));

test('independent role providers must agree; actual separate provider requests and evidence validated', async () => {
  const {result} = await run([{toolCalls:[request]},{toolCalls:reviewTasks},{content:claim+' [E1]'}],roleConfig());
  assert.equal(result.done,true);
  assert.equal(result.research.reviews.length,2);
  assert.equal(result.research.consensus[0].status,'supported');
});

test('same reviewer and verifier model name does not count as independent consensus', async () => {
  const {result} = await run([{toolCalls:[request]},{toolCalls:reviewTasks},{content:claim+' [E1]'},{content:claim+' [E1]'}],roleConfig('same','same'));
  assert.equal(result.done,false);
  assert.equal(result.research.consensus[0].status,'unresolved');
});

test('conflicting independent verdicts block strict gate', async () => {
  const {result} = await run([{toolCalls:[request]},{toolCalls:reviewTasks},{content:claim+' [E1]'},{content:claim+' [E1]'}],roleConfig('review-model','verify-model','reject'));
  assert.equal(result.done,false);
  assert.equal(result.research.consensus[0].status,'contested');
});

test('reviewer model matching parent is rejected before calling provider', async () => {
  const {result,messages} = await run([{toolCalls:[reviewTasks[0]]},{content:'No review available.'}],roleConfig(DEFAULT_CONFIG.model.name,'verify-model'));
  assert.equal(result.research.reviews.length,0);
  assert.ok(messages.some(m=>m.role==='tool' && /distinct configured/.test(m.content)));
});

test('no evidence or nonmatching support in structured review is rejected', () => {
  const state = new ResearchState();
  const child = new ResearchState();
  child.record('E1','matrix_ops',{}, {ok:true,output:'determinant = 40'});
  const review = {role:'reviewer',model:'R',parentModel:'P',target:claim,verdict:'support',rationale:'r'};
  assert.throws(()=>state.recordReview({...review,evidence:[]},child.snapshot().evidence));
  assert.throws(()=>state.recordReview({...review,evidence:[{id:'E1',quote:'determinant = 40'}]},child.snapshot().evidence));
  assert.equal(state.snapshot().reviews.length,0);
});
