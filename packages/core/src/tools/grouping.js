// Araç kategorileri: CLI ve masaüstü aynı gruplamayı paylaşır.

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
  'eq_route',
]);

export function toolGroup(name) {
  if (name === 'task') return 'Yapay zekâ ajanları';
  if (name.startsWith('lit_')) return 'Literatür (kanıt zinciri)';
  if (name === 'plan_audit') return 'Plan doğrulama';
  if (BRIDGES.has(name)) return 'Bilimsel paket köprüleri';
  if (SCIENTIFIC.has(name)) return 'Bilimsel hesaplama';
  return 'Dosya & kod';
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
