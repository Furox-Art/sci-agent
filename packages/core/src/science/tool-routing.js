// Intent-based deterministic ranking. Unknown or ambiguous requests keep the full catalog.
const routes=[
  [/nedensel|nedensellik|causal|confound|backdoor|karıştırıcı|\bdag\b/i,['research_causal','research_hypothesis','research_conflicts','lit_search','stats_calc']],
  [/deney tasar|randomi[sz]|experiment design|clinical trial|sample size|örneklem|power analysis|güç analizi/i,['research_experiment','research_causal','research_uncertainty','research_hypothesis','stats_calc','lit_search']],
  [/belirsizlik|uncertaint|covariance|correlation matrix|hata yayılımı|error propagation/i,['research_uncertainty','stats_calc','matrix_ops','axiomize_cli','research_reproduce']],
  [/reproduc|replicat|tekrarlanabilir|yeniden hesap|determinant|matri[ksx]/i,['research_reproduce','matrix_ops','stats_calc','math_eval','research_hypothesis']],
  [/çelişki|contradict|inconsisten|semantic|semantik/i,['research_conflicts','lit_fulltext','lit_search','research_hypothesis','task']],
  [/literatür|literature|\bdoi\b|makale|paper|citation|atıf|systematic review/i,['lit_search','lit_verify','lit_fulltext','lit_quote','lit_audit','lit_screen','research_conflicts','task']],
  [/bellek|memory|önceki araştırma|prior research/i,['research_memory','research_hypothesis']],
  [/lesson.gate|geçmiş hata|mistake ledger|regresyon testi/i,['research_lesson','read_file','list_dir','plan_audit']],
  [/istatistik|statistic|regress|korelasyon|correlation|\bcsv\b/i,['stats_calc','csv_stats','research_uncertainty','research_reproduce','research_causal']],
  [/kod|code|debug|dosya|file|implement|test suite/i,['read_file','list_dir','search_files','edit_file','write_file','run_command','plan_audit']],
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
