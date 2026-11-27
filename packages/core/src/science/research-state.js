import { createHash } from 'node:crypto';

// Deliberately conservative: a tool invocation or arbitrary printed text is not proof.
// Only these built-in results are candidates for literal claim linkage.
const COMPUTE = new Set(['math_eval', 'unit_convert', 'physical_constants', 'stats_calc', 'matrix_ops', 'molar_mass', 'csv_stats']);
const LITERATURE = new Set(['lit_search', 'lit_fulltext']);
const failure = /^(?:\s*(?:error\b|failed\b|unknown tool|user denied|no results|no numeric data)|.*\b(?:column not found|no numeric data|no results found)\b)/im;
const hash = s => createHash('sha256').update(s).digest('hex');
const normalized = s => String(s).normalize('NFC').replace(/\s+/g, ' ').trim();
const canonical = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const identity = s => String(s ?? '').trim().toLowerCase();
export function distinctModels(a, b) {
  // Endpoint aliases or a new context alone do not establish model independence.
  return Boolean(identity(a) && identity(b) && identity(a) !== identity(b));
}
function includesLiteral(output, quote) {
  const s = normalized(output), q = normalized(quote);
  if (!q) return false;
  const isWord = c => Boolean(c && /[\p{L}\p{N}_]/u.test(c));
  let at = s.indexOf(q);
  while (at >= 0) {
    const before = s[at - 1], after = s[at + q.length];
    const numericContinuation = /\d$/.test(q) && /[.,]/.test(after ?? '') && /\d/.test(s[at + q.length + 1] ?? '');
    const numericPrefix = /^\d/.test(q) && (/[+-]/.test(before ?? '') || (/[.,]/.test(before ?? '') && /\d/.test(s[at - 2] ?? '')));
    if (!numericContinuation && !numericPrefix && !(isWord(q[0]) && isWord(before)) && !(isWord(q.at(-1)) && isWord(after))) return true;
    at = s.indexOf(q, at + 1);
  }
  return false;
}

export class ResearchState {
  #evidence = new Map();
  #hypotheses = new Map();
  #reviews = [];
  #claims = [];
  #rejectedClaims = [];
  record(id, tool, args, result) {
    if (this.#evidence.has(id) || (!COMPUTE.has(tool) && !LITERATURE.has(tool))) return null;
    if (result?.ok !== true || result.truncated || typeof result.output !== 'string' ||
        !result.output.trim() || failure.test(result.output)) return null;
    const output = result.output;
    // Search headers echo the query; only returned paper metadata is evidence.
    let matchText = output;
    if (tool === 'lit_search') {
      matchText = output.split('\n').filter(line => /^\s*DOI:\s*10\.\d{4,9}\//i.test(line)).join('\n');
    }
    if (tool === 'lit_fulltext') {
      matchText = output.split('--- Full text (section: paragraph text) ---\n')[1]?.split('\nNote: paragraph ids')[0] ?? '';
      if (/^Status: (?:ERROR|NOT_FOUND|FAILED|NO_MATCH)/im.test(output)) return null;
    }
    if (!matchText.trim()) return null;
    const entry = { id, tool, args: structuredClone(args ?? {}), output, matchText, sha256: hash(output) };
    this.#evidence.set(id, entry);
    // Execute the predeclared comparison automatically on new matching tool results.
    for (const h of this.#hypotheses.values()) {
      const test = h.test;
      if (!test || test.tool !== tool || canonical(test.args) !== canonical(args ?? {})) continue;
      for (const [direction, quote] of [['supports', test.support], ['refutes', test.refute]]) {
        if (includesLiteral(matchText, quote)) this.#appendAssessment(h, { evidenceId: id, quote, direction, rationale: 'Predeclared literal criterion matched', mode: 'automatic' });
      }
    }
    return id;
  }
  evidence(id, quote, kind) {
    const e = this.#evidence.get(id);
    if (!e || typeof quote !== 'string' || !includesLiteral(e.matchText, quote)) return null;
    if (kind === 'literature' && !LITERATURE.has(e.tool)) return null;
    // A search may establish a DOI, not a paper's substantive conclusions.
    if (kind && kind !== 'literature' && !COMPUTE.has(e.tool) && e.tool !== 'lit_fulltext') return null;
    return e;
  }
  checkClaims(text, claims, requireReview = false) {
    this.#claims = [];
    const unsupported = claims.flatMap(claim => {
      const ref = text.slice(claim.end).match(/^\s*\[(E\d+)\]/)?.[1];
      const linked = this.evidence(ref, claim.snippet, claim.kind);
      this.#claims.push({ ...claim, evidenceId: linked ? ref : null, linkage: linked ? 'literal_match' : 'unsupported', review: this.consensus(claim.snippet) });
      if (!linked) return [{ ...claim, reason: 'missing_or_nonmatching_evidence' }];
      if (this.consensus(claim.snippet) === 'contested') return [{ ...claim, reason: 'review_contested' }];
      if (requireReview && this.consensus(claim.snippet) !== 'supported') {
        return [{ ...claim, reason: 'independent_review_required' }];
      }
      return [];
    });
    this.#rejectedClaims.push(...unsupported);
    return unsupported;
  }
  addHypothesis({ id, statement, prediction, falsifier, test }) {
    if (typeof id !== 'string' || !/^[A-Za-z][\w-]{0,63}$/.test(id) || this.#hypotheses.has(id)) throw new Error('Unique hypothesis id required');
    if (![statement, prediction, falsifier].every(x => typeof x === 'string' && x.trim())) throw new Error('Statement, prediction and falsifier required');
    if (normalized(prediction) === normalized(falsifier)) throw new Error('Prediction and falsifier must differ');
    if ([...this.#hypotheses.values()].some(h => normalized(h.statement) === normalized(statement))) throw new Error('Duplicate hypothesis statement');
    if (test !== undefined && (!test || !COMPUTE.has(test.tool) || !test.args || typeof test.args !== 'object' || Array.isArray(test.args) ||
      typeof test.support !== 'string' || !test.support.trim() || typeof test.refute !== 'string' || !test.refute.trim() ||
      includesLiteral(test.support, test.refute) || includesLiteral(test.refute, test.support))) throw new Error('Predeclared test requires eligible compute tool, args and distinct nonoverlapping support/refute criteria');
    const row = { id, statement, prediction, falsifier, ...(test ? { test: structuredClone(test) } : {}), assessments: [], status: 'active' };
    this.#hypotheses.set(id, row);
    return structuredClone(row);
  }
  assess({ id, evidenceId, quote, direction, rationale }) {
    const h = this.#hypotheses.get(id);
    if (!h) throw new Error('Unknown hypothesis');
    if (!['supports', 'refutes'].includes(direction) || typeof rationale !== 'string' || !rationale.trim()) throw new Error('Direction and rationale required');
    if (h.test) throw new Error('Hypothesis has a predeclared test; execute that tool with those arguments for automatic evaluation');
    if (!this.evidence(evidenceId, quote, 'declared')) throw new Error('Missing or nonmatching eligible evidence');
    return this.#appendAssessment(h, { evidenceId, quote, direction, rationale, mode: 'proposed' });
  }
  #appendAssessment(h, assessment) {
    const { evidenceId, quote, direction } = assessment;
    if (h.assessments.some(a => a.evidenceId === evidenceId && a.quote === quote && a.direction === direction)) throw new Error('Duplicate assessment');
    h.assessments.push(assessment);
    const directions = new Set(h.assessments.map(a => a.direction));
    h.status = directions.size === 2 ? 'contested' : directions.has('refutes') ? 'refuted_candidate' : 'supported_candidate';
    return structuredClone(h);
  }
  recordReview(review, childEvidence) {
    if (!['reviewer','verifier'].includes(review.role) || !distinctModels(review.model, review.parentModel) ||
        typeof review.target !== 'string' || !review.target.trim() || !['support','reject','unresolved'].includes(review.verdict) ||
        typeof review.rationale !== 'string' || !review.rationale.trim()) throw new Error('Invalid review');
    const refs = Array.isArray(review.evidence) ? review.evidence : [];
    const linked = refs.map(ref => {
      const entry = childEvidence.find(e => e.id === ref?.id);
      if (!entry || !includesLiteral(entry.matchText, ref.quote ?? '') || !String(ref.quote ?? '').trim()) throw new Error('Review evidence reference does not match child output');
      return { id: entry.id, tool: entry.tool, args: entry.args, output: entry.output, sha256: entry.sha256, quote: ref.quote };
    });
    if (review.verdict !== 'unresolved' && linked.length === 0) throw new Error('Decisive review requires evidence');
    if (review.verdict === 'support' && !linked.some(e => includesLiteral(e.quote, review.target))) throw new Error('Supporting review must quote the target from its own evidence');
    this.#reviews.push(structuredClone({ ...review, evidence: linked }));
    return { verdict: review.verdict, consensus: this.consensus(review.target) };
  }
  consensus(target) {
    const relevant = this.#reviews.filter(r => r.target === target);
    if (relevant.some(r => r.verdict === 'reject')) return 'contested';
    const reviewers = relevant.filter(r => r.role === 'reviewer' && r.verdict === 'support');
    const verifiers = relevant.filter(r => r.role === 'verifier' && r.verdict === 'support');
    return reviewers.some(a => verifiers.some(b => distinctModels(a.model, b.model))) ? 'supported' : 'unresolved';
  }
  snapshot() {
    return structuredClone({
      evidence: [...this.#evidence.values()].sort((a,b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
      claims: this.#claims,
      rejectedClaims: this.#rejectedClaims,
      hypotheses: [...this.#hypotheses.values()],
      reviews: this.#reviews,
      consensus: [...new Set(this.#reviews.map(r => r.target))].map(target => ({ target, status: this.consensus(target) })),
    });
  }
}

export const research_hypothesis = {
  name: 'research_hypothesis',
  description: 'Run-scoped hypothesis ledger: add a testable hypothesis, optionally predeclare a deterministic compute test, assess with actual evidence, or list. Predeclared criteria are evaluated automatically when that tool runs; manual assessments are proposed interpretations, not proof.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'assess', 'list'] },
      id: { type: 'string' }, statement: { type: 'string' }, prediction: { type: 'string' }, falsifier: { type: 'string' },
      test: { type: 'object', description: 'Optional predeclared compute test. Run the specified tool with exact args after adding; criteria are literal tool output strings.',
        properties: { tool: { type: 'string' }, args: { type: 'object' }, support: { type: 'string' }, refute: { type: 'string' } }, required: ['tool','args','support','refute'] },
      evidenceId: { type: 'string' }, quote: { type: 'string' }, direction: { type: 'string', enum: ['supports', 'refutes'] }, rationale: { type: 'string' },
    },
    required: ['action'],
  },
  needsApproval: false,
  parallel: false,
  async execute(args, { research }) {
    if (!research) throw new Error('Research state unavailable outside agent run');
    if (args.action === 'add') return JSON.stringify(research.addHypothesis(args));
    if (args.action === 'assess') return JSON.stringify(research.assess(args));
    if (args.action === 'list') return JSON.stringify(research.snapshot().hypotheses);
    throw new Error('Unknown hypothesis action');
  },
};
