// Araç kategorileri: CLI gruplaması.

const SCIENTIFIC = new Set([
  'python_eval',
  'csv_stats',
  'math_eval',
  'unit_convert',
  'physical_constants',
  'stats_calc',
  'matrix_ops',
  'molar_mass',
]);
const BRIDGES = new Set([
  'furox_compute',
  'axiomize_cli',
  'cds2_cli',
  'cds1_cli',
  'cds_cli',
  'repocraft_cli',
  'nomosguard_cli',
  'sra_cli',
  'polyguard_cli',
  'polyglot_cli',
  'eq_route',
]);

export function toolGroup(name) {
  if (name === 'task') return 'AI agents';
  if (name.startsWith('lit_')) return 'Literature (evidence chain)';
  if (name === 'plan_audit') return 'Plan verification';
  if (BRIDGES.has(name)) return 'Scientific package bridges';
  if (SCIENTIFIC.has(name)) return 'Scientific computation';
  return 'File & code';
}

export function groupTools(tools) {
  const g = new Map();
  for (const t of tools) {
    const title = toolGroup(t.name);
    if (!g.has(title)) g.set(title, []);
    g.get(title).push(t);
  }
  return g;
}
