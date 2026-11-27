import { causalAnalysis, dagSeparated, dagDescendants } from './causal-design.js';
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function centerScale(x){
  const mean=x.reduce((s,v)=>s+v/x.length,0);
  const centered=x.map(v=>v-mean);
  const norm=Math.sqrt(dot(centered,centered));
  return finite(norm)&&norm>0?centered.map(v=>v/norm):null;
}
function residual(v,basis){
  let x=[...v];
  // Reorthogonalization limits numerical error for near-collinear covariates.
  for(let pass=0;pass<2;pass++)for(const q of basis){
    const c=dot(x,q);x=x.map((v,i)=>v-c*q[i]);
  }
  return x;
}
function pTail(z){
  // Two-sided standard-normal tail approximation (Fisher transform asymptotic).
  const x=Math.abs(z),t=1/(1+0.2316419*x);
  return Math.min(1,Math.max(0,2*Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(0.31938153+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))))));
}
function independence(columns,a,b,z,n){
  if(n<=z.length+3)return {status:'untestable',reason:'insufficient_degrees_of_freedom'};
  const basis=[];
  for(const k of z){
    const v=columns.get(k);if(!v)return {status:'untestable',reason:'constant_conditioner'};
    const r=residual(v,basis),norm=Math.sqrt(dot(r,r));
    if(!finite(norm)||norm<1e-10)return {status:'untestable',reason:'collinear_conditioners'};
    basis.push(r.map(v=>v/norm));
  }
  const x=columns.get(a),y=columns.get(b);
  if(!x||!y)return {status:'untestable',reason:'constant_variable'};
  const rx=residual(x,basis),ry=residual(y,basis),nx=Math.sqrt(dot(rx,rx)),ny=Math.sqrt(dot(ry,ry));
  if(nx<1e-10||ny<1e-10||!finite(nx*ny))return {status:'untestable',reason:'zero_residual_variance'};
  const r=Math.max(-1,Math.min(1,dot(rx,ry)/(nx*ny)));
  if(!finite(r))return {status:'untestable',reason:'nonfinite_correlation'};
  const zScore=Math.abs(r)>=1?Infinity:Math.atanh(r)*Math.sqrt(n-z.length-3);
  return {status:'tested',partialCorrelation:r,p:pTail(zScore),sampleSize:n};
}
export function auditCausalModels({nodes,observed=nodes,treatment,outcome,models,data,alpha=0.05,adjustment,temporalOrder}={}){
  check(Array.isArray(nodes)&&nodes.length>=2&&nodes.length<=20,'Causal audit supports 2–20 nodes');
  check(Array.isArray(observed)&&new Set(observed).size===observed.length&&observed.every(n=>nodes.includes(n)),'Invalid observed nodes');
  check(Array.isArray(models)&&models.length>=1&&models.length<=8&&models.every(m=>typeof m?.id==='string'&&m.id.trim()&&Array.isArray(m.edges))&&new Set(models.map(m=>m.id)).size===models.length,'Provide 1–8 uniquely named candidate DAGs');
  check(Array.isArray(data)&&data.length>=10&&data.length<=5000&&data.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&observed.every(n=>Object.hasOwn(row,n)&&finite(row[n]))),'Provide 10–5000 complete numeric rows for all observed variables');
  check(finite(alpha)&&alpha>0&&alpha<1,'Invalid alpha');
  if(temporalOrder!==undefined)check(temporalOrder&&typeof temporalOrder==='object'&&!Array.isArray(temporalOrder)&&Object.keys(temporalOrder).every(n=>nodes.includes(n)&&finite(temporalOrder[n])),'Temporal order must map nodes to numeric time ranks');
  const columns=new Map(observed.map(n=>[n,centerScale(data.map(row=>row[n]))]));
  const tests=new Map(), records=[];
  for(const model of models){
    // Existing engine validates each DAG. Without explicit adjustment, use its
    // bounded enumeration when feasible; audit itself is not an effect estimator.
    causalAnalysis({nodes,edges:model.edges,treatment,outcome,observed,adjustment:[]});
    const desc=dagDescendants([treatment],model.edges);
    const eligible=observed.filter(n=>n!==outcome&&!desc.has(n));
    const base=eligible.length>12?{status:'enumeration_limited',reason:'Supply an adjustment set for explicit evaluation'}:causalAnalysis({nodes,edges:model.edges,treatment,outcome,observed});
    const temporalViolations=model.edges.filter(([a,b])=>temporalOrder&&Object.hasOwn(temporalOrder,a)&&Object.hasOwn(temporalOrder,b)&&temporalOrder[a]>temporalOrder[b]);
    let adjustmentResult=null;
    if(adjustment!==undefined){
      try{adjustmentResult=causalAnalysis({nodes,edges:model.edges,treatment,outcome,observed,adjustment});}
      catch(e){adjustmentResult={status:'invalid_adjustment',reason:e.message};}
    }
    const ids=new Set();let skippedLatent=0;
    // Local Markov: node independent of each non-descendant/non-parent given parents.
    // If a parent is latent, this specific observed-data test is not available.
    for(const x of observed){
      const parents=model.edges.filter(([,b])=>b===x).map(([a])=>a).sort();
      const descendants=dagDescendants([x],model.edges);
      for(const y of observed){
        if(descendants.has(y)||parents.includes(y))continue;
        if(parents.some(p=>!observed.includes(p))){skippedLatent++;continue;}
        if(!dagSeparated(x,y,parents,model.edges))continue;
        const [a,b]=[x,y].sort(),key=JSON.stringify([a,b,parents]);
        if(!tests.has(key)){
          check(tests.size<200,'Causal audit exceeds 200 unique tests; reduce candidate graphs or variables');
          tests.set(key,{a,b,conditionedOn:parents,...independence(columns,a,b,parents,data.length)});
        }
        ids.add(key);
      }
    }
    records.push({id:model.id,base,enumerationLimited:eligible.length>12,adjustment:adjustmentResult,temporalViolations,testIds:[...ids],skippedLatent});
  }
  // Holm family-wise correction over unique tests across all candidates.
  const tested=[...tests].filter(([,r])=>r.status==='tested').sort((a,b)=>a[1].p-b[1].p);
  let previous=0;
  for(let i=0;i<tested.length;i++){const r=tested[i][1];r.adjustedP=Math.min(1,Math.max(previous,(tested.length-i)*r.p));previous=r.adjustedP;r.rejected=r.adjustedP<=alpha;}
  const results=records.map(({testIds,...r})=>{
    const checks=testIds.map(k=>tests.get(k)),rejected=checks.filter(t=>t.rejected);
    const testedCount=checks.filter(t=>t.status==='tested').length;
    const status=r.temporalViolations.length||rejected.length?'incompatible_with_assumptions':testedCount?'not_rejected':'untestable';
    return {...r,status,testedCount,untestableCount:checks.length-testedCount,checks};
  });
  const remaining=results.filter(r=>r.status!=='incompatible_with_assumptions');
  const robustness=adjustment===undefined?'not_requested':remaining.length===0?'no_remaining_models':remaining.every(r=>r.adjustment?.status==='backdoor_satisfied')?'valid_in_all_nonrejected_candidates':'not_robust_across_candidates';
  return {status:'conditional_model_audit',alpha,uniqueTests:tests.size,testedCount:tested.length,models:results,adjustmentRobustness:robustness,limitation:'Gaussian/linear partial-correlation Fisher-z tests assume independent observations and complete numeric data. Holm correction covers the enumerated family only. Failure to reject does not prove a DAG; Markov-equivalent models, latent confounding, selection bias, nonlinearity and untested assumptions remain. No causal effect is estimated.'};
}
