import { python_eval, csv_stats } from './science/sci-tools.js';
import { sciExtraTools } from './science/sci-extra.js';
import { stats_calc, matrix_ops } from './science/sci-data.js';
import { molar_mass } from './science/sci-chem.js';
import { sciFuroxTools } from './science/sci-furox.js';
import { lit_search, lit_verify, lit_quote } from './science/sci-lit.js';
import { plan_audit } from './science/sci-audit.js';

/**
 * Eklenti kancası: özel bilimsel model geldiğinde yeni bir eklenti tanımlanarak
 * modele özgü araçlar ve sistem istemi eklemeleri yüklenir (kod değişikliği gerekmez).
 * Her eklenti, modelin bilimsel işlerdeki yeteneğini araç desteğiyle artırır.
 */
const BUILTINS = {
  'sci-tools': {
    name: 'sci-tools',
    description: 'Basic scientific tool set: Python execution, CSV statistics',
    tools: [python_eval, csv_stats],
    systemPrompt:
      'Scientific mode: verify numerical computations with python_eval when possible; use csv_stats for tabular data; report results with units and significant digits; do not fabricate — let the tool do the computation.',
  },
  'sci-extra': {
    name: 'sci-extra',
    description: 'Math and physics tools: expression evaluation, unit conversion, physical constants',
    tools: sciExtraTools,
    systemPrompt:
      'Math/physics mode: compute numerical expressions with math_eval, not mentally; use unit_convert for every conversion involving units; get physical constants from the physical_constants table when needed; never invent values.',
  },
  'sci-data': {
    name: 'sci-data',
    description: 'Data analysis tools: descriptive statistics, correlation/regression, matrix operations',
    tools: [stats_calc, matrix_ops],
    systemPrompt:
      'Data analysis mode: compute statistics and regression on datasets with stats_calc; do matrix operations with matrix_ops; when interpreting results, do not go beyond the numbers you computed.',
  },
  'sci-chem': {
    name: 'sci-chem',
    description: 'Chemistry tools: molar mass computed from a formula (118 elements)',
    tools: [molar_mass],
    systemPrompt:
      'Chemistry mode: use the molar_mass tool for every computation that needs a molar mass; do not recite atomic masses from memory.',
  },
  'sci-furox': {
    name: 'sci-furox',
    description:
      'The user\u2019s open scientific packages (Furox-Art): axiomize (modeling/unit validation/uncertainty/SBML) and cds2 (scientific-computing-system-2.0: linear algebra, ODE/PDE, Monte Carlo, statistics, signal, quantum simulation) bridge tools',
    tools: sciFuroxTools,
    systemPrompt:
      'Scientific stack mode: numpy/scipy/pandas and the user packages are installed. Do numerical computations with furox_compute (the stack is auto-imported). For modeling, unit/dimension validation, calibration, uncertainty analysis and SBML/CellML/Modelica export use axiomize_cli (explore: ["capabilities"]). For linear algebra, ODE/PDE, quadrature, Monte Carlo, signal and quantum simulation use cds2_cli (explore: ["--help"]). Do not fabricate answers; verify with these tools.',
  },
  'sci-quantum': {
    name: 'sci-quantum',
    description:
      'Reasoning protocol (Furox-Art/quantum-reasoning-skill v1.2.0, MIT): keep multiple hypotheses open, refute with evidence, collapse to the strongest',
    tools: [],
    systemPrompt:
      'On hard/ambiguous/high-risk scientific problems apply this protocol (do not use it for simple questions): (1) Frame the situation: goal, verified facts, assumptions, tools; separate facts from hypotheses. (2) Open genuinely different candidate paths — do not count cosmetic variants; orthogonal classes: direct derivation, refutation/counterexample, decomposition, alternative mechanism, numerical/executable test, independent reconstruction, critique of rivals. (3) Track branches as active/dormant/rejected; do not permanently reject a branch just because another is ahead. (4) Evaluate each branch with evidence, not rhetoric; the model\u2019s own confidence is weak evidence. (5) Use tools to refute, not to confirm: look for evidence that overturns the leading branch (furox_compute/python_eval/axiomize_cli numerical tests are ideal). (6) When comparing branches, do not double-count those that share a common assumption; reinforce independently verified results; propagate a newly verified fact to every branch it constrains. (7) Adapt the budget to uncertainty: narrow and deepen at low uncertainty; broaden at high uncertainty. (8) If new evidence invalidates the leading assumption, revive a dormant branch. (9) When the marginal value of search drops, collapse to the best-supported answer; if genuinely unresolved branches remain, report the alternatives and the discriminating evidence explicitly.',
  },
  'sci-lit': {
    name: 'sci-lit',
    description:
      'Literature evidence tools (literature-evidence-mcp): OpenAlex/Europe PMC/Crossref search, citation matching, retraction checking, full-text quote verification',
    tools: [lit_search, lit_verify, lit_quote],
    systemPrompt:
      'Literature mode: never fabricate literature claims from memory; search with lit_search, run DOI/retraction checks with lit_verify when citing, verify the full-text match with lit_quote when showing a quote. If an external API fails, state that explicitly.',
  },
  'sci-audit': {
    name: 'sci-audit',
    description:
      'Plan verification (plan-auditor): sealed plans, SHA-256 evidence chain, STRIPS reachability, fail-closed completion gate',
    tools: [plan_audit],
    systemPrompt:
      'Verification mode: produce evidence before saying "done" — on multi-step jobs audit the plan with plan_audit and show command output as evidence.',
  },
};

export function getPlugin(name) {
  return BUILTINS[name] ?? null;
}

export function listPlugins() {
  return Object.values(BUILTINS).map(({ name, description }) => ({ name, description }));
}
