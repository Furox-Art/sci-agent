// Structured semantic assertions: normalized subject, relation, context and quantity.
// No free-text entailment claim. Relations with different context are not compared.
const aliases = new Map(Object.entries({
  'increase':'increase','increases':'increase','raises':'increase',
  'decrease':'decrease','decreases':'decrease','reduces':'decrease',
  'no_change':'no_change','no change':'no_change',
  'equals':'equals','equal':'equals','is':'is',
  'causes':'causes','associated with':'associated_with','associated_with':'associated_with'
}));
const normalize = s => String(s).normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g,' ');
const finite = x => typeof x==='number'&&Number.isFinite(x);
const units = new Map(Object.entries({'g':['mass',1],'kg':['mass',1000],'mg':['mass',0.001],'m':['length',1],'cm':['length',0.01],'mm':['length',0.001],'s':['time',1],'min':['time',60],'h':['time',3600],'fraction':['fraction',1],'%':['fraction',0.01],'1':['dimensionless',1]}));
const direction = new Set(['increase','decrease','no_change']);
function assertion(a) {
  if(!a||!['id','subject','relation','object','context','evidenceId','quote'].every(k=>typeof a[k]==='string'&&a[k].trim())||typeof a.negated!=='boolean')throw new Error('Assertion requires id, subject, relation, object, context, evidenceId, quote and explicit negated boolean');
  const rel=normalize(a.relation);
  if(!aliases.has(rel))throw new Error('Unsupported semantic relation; use documented controlled vocabulary');
  let quantity=null;
  if(a.quantity!==undefined){
    const q=a.quantity, unit=units.get(q?.unit);
    if(!unit||!finite(q.min)||!finite(q.max)||q.min>q.max)throw new Error('Quantity requires supported unit and finite ordered min/max');
    quantity={dimension:unit[0],min:q.min*unit[1],max:q.max*unit[1]};
    if(!finite(quantity.min)||!finite(quantity.max))throw new Error('Quantity overflow');
  }
  return {...a,subject:normalize(a.subject),relation:aliases.get(rel),object:normalize(a.object),context:normalize(a.context),quantity};
}
export function semanticConflicts(assertions, research) {
  if(!Array.isArray(assertions)||assertions.length<2||assertions.length>100)throw new Error('Provide 2–100 assertions');
  const rows=assertions.map(assertion);
  if(new Set(rows.map(a=>a.id)).size!==rows.length)throw new Error('Unique assertion IDs required');
  for(const a of rows)if(!research?.evidence(a.evidenceId,a.quote,'declared'))throw new Error('Assertion '+a.id+' has no matching eligible evidence');
  const conflicts=[], incomparable=[];
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j];
    if(a.subject!==b.subject||a.object!==b.object||a.context!==b.context)continue;
    let reason;
    if(a.relation===b.relation&&a.negated!==b.negated&&!a.quantity&&!b.quantity)reason='opposite_polarity';
    else if(!a.negated&&!b.negated&&direction.has(a.relation)&&direction.has(b.relation)&&a.relation!==b.relation)reason='opposing_direction';
    else if(!a.negated&&!b.negated&&a.relation===b.relation&&a.quantity&&b.quantity){
      if(a.quantity.dimension!==b.quantity.dimension){incomparable.push({a:a.id,b:b.id,reason:'incompatible_units'});continue;}
      const tol=1e-12*Math.max(Math.abs(a.quantity.min),Math.abs(a.quantity.max),Math.abs(b.quantity.min),Math.abs(b.quantity.max),Number.MIN_VALUE);
      if(a.quantity.max+tol<b.quantity.min||b.quantity.max+tol<a.quantity.min)reason='disjoint_intervals';
    }
    if(reason)conflicts.push({a:a.id,b:b.id,reason,evidenceIds:[a.evidenceId,b.evidenceId]});
  }
  return {status:conflicts.length?'candidate_conflicts':'no_conflicts_in_compared_assertions',conflicts,incomparable,assertions:rows,limitation:'Controlled semantic relations with exact normalized entities/context; model-supplied extraction and context equivalence are not independently proven. Conflict candidates need scientific review.'};
}
