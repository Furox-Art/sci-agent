import { runAgentLoop } from '../agent.js';
import { createRegistry, createProvider } from '../index.js';
import { distinctModels } from '../science/research-state.js';

const ROLES = {
  researcher: 'Investigate independently; distinguish assumptions, observations and conclusions.',
  reviewer: 'Act as a skeptical scientific referee: try to refute the target and inspect methodology.',
  verifier: 'Independently reproduce the relevant calculation or inspect primary evidence.',
};
const REVIEW_RULE = 'Return ONLY JSON with verdict (support, reject, or unresolved), rationale (string), and evidence (array of objects with id and exact quote from your own eligible tool results). Support or reject only with relevant evidence; otherwise unresolved.';

export const task = {
  name: 'task',
  description: 'Run a sub-agent in a fresh context. Researcher is the default. For scientific review or verification specify reviewer/verifier and exact target; a distinct configured model is mandatory.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Task description' },
      role: { type: 'string', enum: ['researcher', 'reviewer', 'verifier'] },
      target: { type: 'string', description: 'Exact claim to review or verify' },
    },
    required: ['prompt'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ prompt, role = 'researcher', target }, ctx = {}) {
    const { provider, onEvent, workspaceRoot = '.', signal, research } = ctx;
    if (!provider) throw new Error('task requires a provider');
    if (!Object.hasOwn(ROLES, role)) throw new Error('Unknown agent role');
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Task prompt required');
    const review = role !== 'researcher';
    const modelCfg = ctx.cfg?.agent?.roleModels?.[role];
    const parentModel = provider.model ?? ctx.cfg?.model?.name;
    if (review && (typeof target !== 'string' || !target.trim() || !research)) throw new Error('Review requires an exact target and active research state');
    if (review && (!modelCfg?.baseUrl || !distinctModels(modelCfg.name, parentModel) || modelCfg.provider === 'mock')) {
      throw new Error('Independent review requires a distinct configured non-mock model name and baseUrl for ' + role);
    }
    // Each role has its own explicitly configured credentials; never inherit the main model key.
    const childProvider = modelCfg ? createProvider({ ...modelCfg, apiKey: modelCfg.apiKey ?? '' }) : provider;
    if (review && !distinctModels(childProvider.model, parentModel)) throw new Error('Review provider is not a distinct configured model');
    onEvent?.({ type: 'task_start', prompt, role });
    const childMessages = [
      { role: 'system', content: 'You are a sub-agent. Workspace: ' + workspaceRoot + '\n' + ROLES[role] + '\n' +
          (review ? REVIEW_RULE : 'Finish with a concise summary.') },
      { role: 'user', content: review ? JSON.stringify({ target, task: prompt }) : prompt },
    ];
    const childRegistry = createRegistry({ cfg: ctx.cfg, approve: ctx.approve, disableTools: ['task', 'research_hypothesis', 'research_memory', 'research_lesson'] });
    if (review) {
      const allowed = new Set(['read_file','list_dir','search_files','math_eval','unit_convert','physical_constants','stats_calc','matrix_ops','molar_mass','csv_stats','lit_search','lit_fulltext','lit_verify','lit_quote','lit_quote_text','lit_pdf_provenance','lit_stats_check','lit_audit','research_causal','research_causal_audit','research_uncertainty','research_reproduce','research_conflicts','research_semantic']);
      childRegistry.tools = childRegistry.tools.filter(t => allowed.has(t.name) && !t.needsApproval);
    }
    const relay = ev => {
      if (ev.type === 'text_delta' || ev.type === 'reasoning_delta') return;
      onEvent?.({ type: 'sub_event', prompt, role, ev });
    };
    const res = await runAgentLoop({
      provider: childProvider, registry: childRegistry, messages: childMessages,
      maxSteps: Math.min(Number(ctx.maxSteps) || 15, 15), onEvent: relay, signal,
      grounding: !review, requireIndependentReview: false, researchHooks: false,
      systemExtra: review ? 'Eligible tool output carries [Evidence ID: E<number>]. Cite those IDs in the JSON evidence array.' : undefined,
    });
    onEvent?.({ type: 'task_end', prompt, role, done: res.done && !res.unverified });
    const lastText = childMessages.at(-1)?.role === 'assistant' ? childMessages.at(-1).content : '';
    if (review) {
      if (!res.done || res.aborted || !lastText) throw new Error('Review did not finish');
      let parsed;
      try { parsed = JSON.parse(lastText); } catch { throw new Error('Review verdict must be valid JSON'); }
      const model = childProvider.model;
      const verdict = research.recordReview({ role, target, model, parentModel, verdict: parsed.verdict, rationale: parsed.rationale, evidence: parsed.evidence }, res.research.evidence);
      return JSON.stringify({ role, target, model, ...verdict, rationale: parsed.rationale, evidence: parsed.evidence, independence: 'distinct configured model; actual weights not verified' });
    }
    if (lastText) onEvent?.({ type: 'sub_event', prompt, ev: { type: 'text', text: lastText } });
    if (!res.done || res.unverified) throw new Error('Researcher did not finish with a grounded result');
    return `Sub-agent finished (${res.steps} steps).\nSummary:\n${lastText || '(no text)'}`;
  },
};
