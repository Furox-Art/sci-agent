// Observed DAG backdoor analysis. Graph assumptions are supplied by the researcher.
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
function nodesOf(nodes) {
  assert(Array.isArray(nodes) && nodes.length >= 2 && nodes.length <= 50 &&
    nodes.every(n => typeof n === 'string' && n.trim() && n.length <= 100) &&
    new Set(nodes).size === nodes.length, 'Provide 2–50 unique node names');
  return new Set(nodes);
}
function closure(start, edges, reverse = false) {
  const seen = new Set(start), todo = [...start];
  while (todo.length) {
    const x = todo.pop();
    for (const [a,b] of edges) {
      const from = reverse ? b : a, to = reverse ? a : b;
      if (from === x && !seen.has(to)) { seen.add(to); todo.push(to); }
    }
  }
  return seen;
}
function separated(x, y, z, edges) {
  // Ancestral moral graph criterion for d-separation (including collider descendants).
  const anc = closure([x,y,...z], edges, true), adj = new Map([...anc].map(n => [n,new Set()]));
  const connect = (a,b) => { adj.get(a).add(b); adj.get(b).add(a); };
  const relevant = edges.filter(([a,b]) => anc.has(a) && anc.has(b));
  for (const [a,b] of relevant) connect(a,b);
  for (const n of anc) {
    const p = relevant.filter(([,b]) => b === n).map(([a]) => a);
    for (let i=0;i<p.length;i++) for (let j=i+1;j<p.length;j++) connect(p[i],p[j]);
  }
  const blocked = new Set(z), visited = new Set([x]), todo = [x];
  while (todo.length) {
    const a = todo.pop();
    if (a === y) return false;
    for (const b of adj.get(a)) if (!blocked.has(b) && !visited.has(b)) { visited.add(b); todo.push(b); }
  }
  return true;
}
export function causalAnalysis({ nodes, edges, treatment, outcome, observed = nodes, adjustment } = {}) {
  const names = nodesOf(nodes);
  assert(names.has(treatment) && names.has(outcome) && treatment !== outcome, 'Treatment and outcome must be distinct DAG nodes');
  assert(Array.isArray(edges) && edges.length <= 500 && edges.every(e => Array.isArray(e) && e.length === 2 && names.has(e[0]) && names.has(e[1]) && e[0] !== e[1]), 'Invalid directed edges');
  assert(Array.isArray(observed) && observed.every(n => names.has(n)) && observed.includes(treatment) && observed.includes(outcome), 'Observed nodes must include treatment and outcome');
  const indegree = new Map(nodes.map(n => [n,0]));
  for (const [,b] of edges) indegree.set(b,indegree.get(b)+1);
  const queue = nodes.filter(n => indegree.get(n) === 0);
  for(let i=0;i<queue.length;i++) for(const [a,b] of edges) if(a===queue[i]) { indegree.set(b,indegree.get(b)-1); if(!indegree.get(b)) queue.push(b); }
  assert(queue.length === nodes.length, 'DAG must be acyclic');
  const descendants = closure([treatment],edges);
  const candidates = [...new Set(observed)].filter(n => n !== outcome && !descendants.has(n)).sort();
  const backdoor = edges.filter(([a]) => a !== treatment);
  const check = z => separated(treatment,outcome,z,backdoor);
  const limitation = 'Identification is conditional on the supplied DAG, consistency, positivity and no omitted relevant confounding; no empirical causal effect is estimated.';
  if (adjustment !== undefined) {
    assert(Array.isArray(adjustment) && new Set(adjustment).size===adjustment.length && adjustment.every(n => candidates.includes(n)), 'Adjustment must contain only observed non-descendants of treatment, excluding outcome');
    return { status: check(adjustment) ? 'backdoor_satisfied' : 'backdoor_open', adjustment, limitation };
  }
  assert(candidates.length <= 12, 'Supply a candidate adjustment set when more than 12 eligible nodes exist');
  const sets = [];
  // Enumerate all inclusion-minimal sets; supersets of a valid set need not be valid.
  for (let size=0;size<=candidates.length;size++) for(let mask=0;mask<2**candidates.length;mask++) {
    const z = candidates.filter((_,i)=>mask & (1<<i));
    if(z.length!==size || sets.some(s=>s.every(n=>z.includes(n)))) continue;
    if(check(z)) sets.push(z);
  }
  return {status:sets.length?'backdoor_satisfied':'no_observed_backdoor_set', minimalAdjustmentSets:sets, limitation};
}

// Reproducible balanced randomization, not allocation concealment. SHA-256 keyed
// by a user seed provides deterministic random ordering without modulo bias.
import { createHash } from 'node:crypto';
export function experimentDesign({ arms, participants, seed, outcome, hypothesis, controls, analysisPlan, alpha=0.05, power=0.8, standardizedEffect } = {}) {
  assert(Array.isArray(arms) && arms.length>=2 && arms.length<=10 && arms.every(a=>typeof a==='string'&&a.trim()) && new Set(arms).size===arms.length,'Provide 2–10 unique arms');
  assert(Array.isArray(participants) && participants.length>=arms.length && participants.length<=10000 &&
    participants.every(p=>typeof p==='string'&&p.trim()) && new Set(participants).size===participants.length,'Unique participant IDs required, at least one per arm');
  assert(typeof seed==='string' && seed.trim() && seed.length<=256,'Explicit reproducibility seed required');
  assert([outcome,hypothesis,controls,analysisPlan].every(s=>typeof s==='string'&&s.trim()),'Specify primary outcome, hypothesis, controls and analysis plan');
  assert(finite(alpha)&&alpha>0&&alpha<0.5&&finite(power)&&power>0.5&&power<1,'Invalid alpha/power');
  const key = id => createHash('sha256').update(JSON.stringify([seed,id])).digest('hex');
  const ordered = participants.map(id=>({id,key:key(id)})).sort((a,b)=>a.key.localeCompare(b.key)||a.id.localeCompare(b.id));
  const allocation = ordered.map(({id},i)=>({id,arm:arms[i%arms.length]}));
  const counts = Object.fromEntries(arms.map(a=>[a,allocation.filter(p=>p.arm===a).length]));
  let planning = null;
  if (standardizedEffect !== undefined) {
    assert(arms.length===2 && finite(standardizedEffect)&&standardizedEffect>0,'Normal approximation supports two arms and positive standardized effect only');
    // Inverse normal CDF via bisection of a standard normal CDF approximation.
    function quantile(p) {
      let lo=-9,hi=9;
      for(let i=0;i<70;i++){
        const x=(lo+hi)/2, t=1/(1+0.2316419*Math.abs(x));
        const tail=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(0.31938153+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
        const cdf=x>=0?1-tail:tail;
        if(cdf<p)lo=x;else hi=x;
      }
      return (lo+hi)/2;
    }
    assert(alpha>=1e-6&&power<=0.999999,'Power approximation is bounded away from extreme tails');
    const perArm=Math.ceil(2*((quantile(1-alpha/2)+quantile(power))/standardizedEffect)**2);
    assert(Number.isSafeInteger(perArm)&&Number.isSafeInteger(2*perArm),'Required sample too large');
    planning={perArm,total:2*perArm,adequate:arms.every(a=>counts[a]>=perArm),method:'two-sided equal-allocation normal approximation; continuous outcome, common variance, independent observations, no attrition'};
  }
  return {status:'draft_protocol', hypothesis,outcome,controls,analysisPlan,alpha,power,seed,counts,allocation,planning,
    limitation:'Randomization is reproducible, not concealed or blinded. Ethics, inclusion/exclusion, attrition and preregistration need separate review.'};
}
