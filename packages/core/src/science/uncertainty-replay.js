import { extraReplay } from './replay-extra.js';
import { createHash } from 'node:crypto';
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const sq = x => x*x;
const hash = s => createHash('sha256').update(s).digest('hex');

// First-order GUM uncertainty propagation: Var(f) = g^T C g.
export function propagateUncertainty({ estimate, gradient, standardUncertainties, correlation, coverageFactor = 2, unit } = {}) {
  fail(finite(estimate) && typeof unit === 'string' && unit.trim(), 'Finite estimate and output unit required');
  fail(Array.isArray(gradient) && gradient.length > 0 && gradient.length <= 50 && gradient.every(finite), 'Finite gradient required (1–50 inputs)');
  const n=gradient.length;
  fail(Array.isArray(standardUncertainties)&&standardUncertainties.length===n&&standardUncertainties.every(x=>finite(x)&&x>=0),'Nonnegative standard uncertainties required');
  fail(finite(coverageFactor)&&coverageFactor>0,'Positive coverage factor required');
  const r=correlation===undefined?Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0)):correlation;
  fail(Array.isArray(r)&&r.length===n&&r.every(row=>Array.isArray(row)&&row.length===n&&row.every(x=>finite(x)&&Math.abs(x)<=1)), 'Invalid correlation matrix');
  for(let i=0;i<n;i++) for(let j=0;j<n;j++) fail(Math.abs(r[i][j]-r[j][i])<=1e-12&&(i!==j||r[i][i]===1),'Correlation must be symmetric with unit diagonal');
  // PSD test via Cholesky with zero-pivot support.
  const l=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++) for(let j=0;j<=i;j++){
    let x=r[i][j]; for(let k=0;k<j;k++)x-=l[i][k]*l[j][k];
    if(i===j){fail(x>=-1e-12,'Correlation matrix is not positive semidefinite');l[i][j]=Math.sqrt(Math.max(0,x));}
    else if(l[j][j]>1e-12)l[i][j]=x/l[j][j];
    else fail(Math.abs(x)<=1e-12,'Correlation matrix is not positive semidefinite');
  }
  const w=gradient.map((g,i)=>g*standardUncertainties[i]);
  const variance=l[0].reduce((sum,_,k)=>sum+sq(w.reduce((a,v,i)=>a+v*l[i][k],0)),0);
  const standard=Math.sqrt(variance), expanded=coverageFactor*standard, interval=[estimate-expanded,estimate+expanded];
  fail([variance,standard,expanded,...interval].every(finite),'Uncertainty computation overflow');
  return {estimate,unit,standardUncertainty:standard,variance,coverageFactor,expandedUncertainty:expanded,interval,dependence:correlation===undefined?'independence_assumed':'supplied_correlation',method:'first-order linear propagation',limitation:'Coverage factor is not a guaranteed confidence level; gradient, input uncertainties and linearization must be scientifically justified.'};
}

// Independent algorithms, not another invocation of the original implementation.
// No files or arbitrary code are replayed. Only immutable inline inputs are supported.
function determinant(a) {
  if(a.length===1)return a[0][0];
  let result=0;
  for(let j=0;j<a.length;j++)result+=(j%2?-1:1)*a[0][j]*determinant(a.slice(1).map(row=>row.filter((_,k)=>k!==j)));
  return result;
}
function stats(numbers) {
  const ordered=[...numbers].sort((a,b)=>a<b?-1:a>b?1:0), n=numbers.length, mid=Math.floor(n/2);
  const min=ordered[0], max=ordered[n-1];
  // Independent floating-point implementation: shift close same-sign
  // values before scaling; use compensated mean and Welford variance.
  const largest=Math.max(Math.abs(min),Math.abs(max));
  const center=min>=0&&max-min<=largest/2||max<=0&&max-min<=largest/2?min:0;
  const scale=Math.max(Math.abs(min-center),Math.abs(max-center))||1;
  let count=0, online=0, m2=0, sum=0, correction=0;
  for(const x of numbers){
    const z=(x-center)/scale;
    const next=sum+z;
    correction+=Math.abs(sum)>=Math.abs(z)?(sum-next)+z:(z-next)+sum;
    sum=next;
    count++;const delta=z-online;online+=delta/count;m2+=delta*(z-online);
  }
  const mean=center+((sum+correction)/n)*scale;
  const sd=Math.sqrt(Math.max(0,m2)/(n-1))*scale;
  const lo=ordered[mid-1], hi=ordered[mid], middleSum=lo+hi;
  const median=n%2?hi:finite(middleSum)?middleSum/2:lo/2+hi/2;
  return {n,mean,median,sd,variance:sd*sd,min,max};
}
function numericOutput(output,key) {
  const escaped=key.replace(/[.*+?^${ }()|[\]\\]/g,'\\$&');
  const m=output.match(new RegExp('(?:^|[, :])'+escaped+'\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)(?=,|\\s|$)','i'));
  return m?Number(m[1]):NaN;
}
export function reproduceEvidence(entry) {
  fail(entry && typeof entry.output==='string' && hash(entry.output)===entry.sha256,'Evidence hash mismatch or missing evidence');
  const {tool,args,output}=entry;
  let values, algorithm, digits;
  if(tool==='matrix_ops'&&args?.op==='det'){
    const a=args.a;
    fail(Array.isArray(a)&&a.length>=1&&a.length<=7&&a.every(row=>Array.isArray(row)&&row.length===a.length&&row.every(finite)),'Independent determinant supports 1–7 square numeric matrices');
    values={determinant:determinant(a)};algorithm='Laplace cofactor expansion (independent of Gaussian elimination)';digits=10;
  } else if(tool==='stats_calc'&&Array.isArray(args?.numbers)){
    fail(args.numbers.length>=2&&args.numbers.length<=100000&&args.numbers.every(finite),'Independent statistics require 2–100000 finite inline values');
    values=stats(args.numbers);algorithm='Shifted/scaled Welford variance and compensated mean (independent of exact integer moments)';digits=6;
  } else {
    const replay=extraReplay(entry);
    if(!replay)return {status:'unsupported',evidenceId:entry.id,reason:'No independent implementation for this input; arbitrary code and mutable file replay are excluded'};
    return {status:replay.comparisons.every(c=>c.pass)?'reproduced':'mismatch',evidenceId:entry.id,sourceHash:entry.sha256,...replay,limitation:'Independent numerical implementation, not independent dataset, software environment or physical experiment.'};
  }
  const comparisons=Object.entries(values).map(([metric,value])=>{
    const original=numericOutput(output,metric);
    // Match the original formatter precision; no model-supplied tolerances.
    const rounded=Number(value.toPrecision(digits));
    const pass=finite(original)&&finite(rounded)&&original===rounded;
    return {metric,original:finite(original)?original:null,reproduced:finite(value)?value:null,rounded:finite(rounded)?rounded:null,pass};
  });
  return {status:comparisons.every(c=>c.pass)?'reproduced':'mismatch',evidenceId:entry.id,sourceHash:entry.sha256,algorithm,comparisons,limitation:'Independent numerical implementation, not independent dataset, software environment or physical experiment.'};
}
