import { causalAnalysis, experimentDesign } from './causal-design.js';
import { propagateUncertainty, reproduceEvidence } from './uncertainty-replay.js';
import { semanticConflicts } from './semantic-check.js';
import { saveResearch,getResearch,searchResearch } from './research-memory.js';
import { lessonGate } from './lesson-bridge.js';
import { routeTools } from './tool-routing.js';
const string={type:'string'}, number={type:'number'}, boolean={type:'boolean'}, object={type:'object'};
const array=items=>({type:'array',items});
function tool(name,description,properties,required,fn,needsApproval=false){
  return {name,description,parameters:{type:'object',properties,required},needsApproval,parallel:false,async execute(args,ctx){
    const result=await fn(args,ctx);
    if(name==='research_uncertainty'){
      const fields=['standardUncertainty','variance','expandedUncertainty'];
      return fields.map(k=>k+' = '+result[k]).join('\n')+'\n'+JSON.stringify(result);
    }
    return JSON.stringify(result);
  }};
}
function analysis(name,description,props,required,fn) {
  return tool(name,description,props,required,(args,ctx)=>{
    if(!ctx.research)throw new Error('Active research run required');
    const result=fn(args,ctx);
    ctx.research.recordAnalysis(name,args,result);
    if(name==='research_conflicts'&&result.conflicts.length)ctx.onEvent?.({type:'warning',text:'Structured scientific conflict candidates detected; compare context and source evidence before drawing conclusions.'});
    if(name==='research_reproduce'&&result.status==='mismatch')ctx.onEvent?.({type:'warning',text:'Independent numerical reproduction disagreed; claims linked to this evidence cannot pass the grounding gate.'});
    if(name==='research_experiment'&&result.allocation.length>100) {
      return {...result,allocation:result.allocation.slice(0,100),allocationPreview:true,notice:'Full allocation is in /research; only first 100 shown here.'};
    }
    return result;
  });
}
export const researchTools=[
  analysis('research_causal','Test backdoor identification on a supplied causal DAG; returns observed minimal adjustment sets or checks a proposed set. Does not estimate causal effects.',{
    nodes:array(string),edges:array(array(string)),treatment:string,outcome:string,observed:array(string),adjustment:array(string)
  },['nodes','edges','treatment','outcome'],a=>causalAnalysis(a)),
  analysis('research_experiment','Draft a randomized experimental protocol with deterministic balanced allocation and optional approximate two-arm power planning. Use pseudonymous participant IDs.',{
    arms:array(string),participants:array(string),seed:string,outcome:string,hypothesis:string,controls:string,analysisPlan:string,alpha:number,power:number,standardizedEffect:number
  },['arms','participants','seed','outcome','hypothesis','controls','analysisPlan'],a=>experimentDesign(a)),
  analysis('research_uncertainty','First-order uncertainty propagation from input standard uncertainties, gradient and optional correlation matrix. Coverage factor is not a confidence guarantee.',{
    estimate:number,unit:string,gradient:array(number),standardUncertainties:array(number),correlation:array(array(number)),coverageFactor:number
  },['estimate','unit','gradient','standardUncertainties'],a=>propagateUncertainty(a)),
  analysis('research_reproduce','Independently recompute a prior in-run eligible evidence result by its ID using a different numerical algorithm. Currently inline determinant and descriptive statistics only.',{evidenceId:string},['evidenceId'],(a,c)=>reproduceEvidence(c.research.snapshot().evidence.find(e=>e.id===a.evidenceId))),
  analysis('research_conflicts','Compare structured semantic assertions linked to exact eligible evidence quotes; detect opposing polarity, directions and disjoint numerical intervals within the same context. Not general natural-language entailment.',{
    assertions:array({type:'object',properties:{id:string,subject:string,relation:{type:'string',description:'increase/decrease/no_change/equals/is/causes/associated_with (or documented aliases)'},object:string,context:string,negated:boolean,evidenceId:string,quote:string,quantity:{type:'object',properties:{min:number,max:number,unit:string},required:['min','max','unit']}},required:['id','subject','relation','object','context','negated','evidenceId','quote']})
  },['assertions'],(a,c)=>semanticConflicts(a.assertions,c.research)),
  tool('research_memory','Save the current partial research snapshot, search workspace-local prior records, or retrieve a record by hash. Historical data is not live evidence. Requires approval; may contain sensitive research data.',{
    action:{type:'string',enum:['save','search','get']},label:string,query:string,limit:{type:'integer'},id:string
  },['action'],async(a,c)=>{
    if(a.action==='save'){if(!c.research)throw new Error('Active research run required');return saveResearch(c.workspaceRoot,c.research.snapshot(),{label:a.label??'',status:'partial'});}
    if(a.action==='search')return searchResearch(c.workspaceRoot,a.query??'',a.limit??10);
    if(a.action==='get')return getResearch(c.workspaceRoot,a.id);
    throw new Error('Invalid memory action');
  },true),
  tool('research_lesson','Inspect or add a lesson in the real bundled Lesson-gate ledger. Executable fixture registration and verification are user-controlled upstream CLI operations.',{
    action:{type:'string',enum:['stats','preflight','export','add']},category:string,trigger:string,expected:string,actual:string,keywords:string
  },['action'],(a,c)=>lessonGate(c.workspaceRoot,a.action,a),true),
  tool('research_route','Request the full active tool catalog or rank tools for a new subproblem. No tool execution or approval policy changes.',{query:string},[],(a,c)=>{
    const r=routeTools(c.registry.schemas(),a.query??'');
    return {mode:r.mode,prioritized:r.prioritized,available:r.schemas.map(s=>({name:s.name,description:s.description}))};
  }),
];
