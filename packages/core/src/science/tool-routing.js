// Intent-based deterministic ranking. Unknown or ambiguous requests keep the full catalog.
const routes=[
  [/causal|confound|backdoor|\bdag\b/i,['research_causal_audit','research_causal','research_hypothesis','research_conflicts','lit_search','stats_calc']],
  [/randomi[sz]|experiment design|clinical trial|sample size|power analysis/i,['research_experiment','research_causal','research_uncertainty','research_hypothesis','stats_calc','lit_search']],
  [/uncertaint|covariance|correlation matrix|error propagation/i,['research_uncertainty','stats_calc','matrix_ops','axiomize_cli','research_reproduce']],
  [/reproduc|replicat|determinant|matri[ksx]/i,['research_reproduce','matrix_ops','stats_calc','math_eval','research_hypothesis']],
  [/contradict|inconsisten|semantic/i,['research_semantic','research_conflicts','lit_fulltext','lit_search','research_hypothesis','task']],
  [/literature|\bdoi\b|paper|citation|systematic review/i,['lit_search','lit_verify','lit_fulltext','lit_quote','lit_audit','lit_screen','research_semantic','research_conflicts','task']],
  [/memory|prior research/i,['research_memory','research_hypothesis']],
  [/lesson.gate|mistake ledger/i,['research_lesson','read_file','list_dir','plan_audit']],
  [/statistic|regress|correlation|\bcsv\b/i,['stats_calc','csv_stats','research_uncertainty','research_reproduce','research_causal']],
  [/code|debug|file|implement|test suite/i,['read_file','list_dir','search_files','edit_file','write_file','run_command','plan_audit']],
];
export function routeTools(schemas,text,{shortlist=false}={}){
  if(!Array.isArray(schemas))throw new Error('Tool schemas required');
  const matches=routes.filter(([re])=>re.test(String(text??'')));
  const available=new Map(schemas.map(s=>[s.name,s]));
  const prioritized=[...new Set(matches.flatMap(([,names])=>names))].filter(n=>available.has(n));
  if(!prioritized.length)return {schemas,prioritized:[],mode:'full'};
  const priority=new Set(prioritized);
  const ordered=[...prioritized.map(n=>available.get(n)),...schemas.filter(s=>!priority.has(s.name))];
  // Opt-in first-step shortlist. A subsequent tool step or an explicit catalog request restores all.
  if(shortlist&&prioritized.length<schemas.length&&available.has('research_route')){
    const names=new Set([...prioritized,'research_route','research_hypothesis','task','read_file','list_dir','search_files']);
    return {schemas:ordered.filter(s=>names.has(s.name)),prioritized,mode:'shortlist'};
  }
  return {schemas:ordered,prioritized,mode:'ranked'};
}
