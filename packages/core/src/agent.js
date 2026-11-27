import { lessonGate, captureGroundingLesson } from './science/lesson-bridge.js';
import { saveResearch } from './science/research-memory.js';
import { routeTools } from './science/tool-routing.js';
import { ResearchState } from './science/research-state.js';
/**
 * Ajan döngüsü: modeli çağırır, araç çağrılarını çalıştırır, sonuçları modele geri verir.
 * onEvent ile akış olayları yayınlanır: reasoning | text | tool_call | tool_result | error
 * systemExtra verilirse bu turun model çağrılarında sistem mesajına eklenir
 * (kalıcı messages dizisi değişmez; örn. eq-layer yönlendirmesi için kullanılır).
 *
 * Sağlamlık: araç/kayıt hataları döngüyü çökertmez (modele temiz hata gözlemi döner),
 * abort sinyali düzenli biçimde durdurulur ve nedeni bildirilir; bozuk araç çağrıları
 * (eksik/bilinmeyen ad, geçersiz JSON) gözlemlenir, 3 ardışık bozuk çağrıda döngü durur.
 * Paralel araç batch'leri sınırlı eşzamanlılıkla yürütülür (DEFAULT_MAX_CONCURRENT = 4;
 * runAgentLoop'un isteğe bağlı maxConcurrent seçeneğiyle geçilebilir).
 */

// Argümanları güvenle dizgeleştirir; döngüsel yapı gibi sorunlu değerlerde '{}' döner.
const stringifyArgs = (args) => {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return '{}';
  }
};

// Maximum number of tool calls executed at the same time within one step. A model can
// emit many tool calls in a single turn; each one may spawn child processes
// (python/shell), which can exhaust CPU and memory on small machines. Bounding parallel
// batches at 4 keeps runaway turns safe; callers can override it with the optional
// `maxConcurrent` option of runAgentLoop (positive integer).
const DEFAULT_MAX_CONCURRENT = 4;

// Bounded-concurrency worker pool: runs `worker` over `items` with at most `limit`
// workers in flight; each queued item starts only when a running one finishes, so the
// pool never exceeds `limit` simultaneous executions. Mirrors Promise.all semantics:
// resolves when every item is processed and rejects as soon as a worker rejects.
const runWithConcurrency = async (items, worker, limit) => {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
};

/**
 * Deterministic grounding gate ("no fabrication"): patterns that mark a *verifiable*
 * claim — a statistic, a measurement with a unit, an equality to a concrete number, or a
 * literature reference. They are intentionally conservative and dependency-free: the
 * gate requires literal, run-local evidence linkage for each detected claim.
 */
const CLAIM_PATTERNS = [
  { kind: 'statistics', re: /\bp\s*[=<>≤≥]\s*(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/i },
  { kind: 'statistics', re: /\b(?:95\s*%\s*CI|confidence interval|standard deviation|\bSD\b|\bSEM\b)/ },
  { kind: 'statistics', re: /\b(?:n|N)\s*=\s*\d+/ },
  { kind: 'statistics', re: /\b(?:odds ratio|hazard ratio|relative risk|effect size|R²|R2|χ²|chi-square)\b/i },
  {
    kind: 'measurement',
    re: /[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?\s?(?:mg|kg|µg|ug|ng|pg|mL|ml|L|µL|uL|nL|mmol|mol|µmol|umol|nmol|nM|µM|uM|mM|M|K|°C|°F|Pa|kPa|MPa|J|kJ|W|kW|Hz|kHz|MHz|GHz|eV|keV|MeV|nm|µm|um|pm|mm|cm|km|m\/s|m\/s²|rpm|Da|kDa|ppm|ppb|mol\/L)(?:\/(?:kg|g|L|mL|m|s|min|h))?(?![\w-])/,
  },
  { kind: 'measurement', re: /[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?\s?%|%\s?[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?/ },
  { kind: 'equation', re: /[A-Za-zα-ωΑ-Ω][\w]*\s*=\s*[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+-]?\d+)?/ },
  { kind: 'literature', re: /\b10\.\d{4,9}\/[^\s)]+/ },
  { kind: 'literature', re: /\b(?:et al\.|PMID:?\s*\d+|arXiv:\s*\d{4}\.\d{4,5})/i },
];

// Preserve the public helper; the gate scans every occurrence, including repeated claims.
export function scanClaims(text) {
  const s = typeof text === 'string' ? text : '';
  const found = [];
  for (const { kind, re } of CLAIM_PATTERNS) {
    for (const m of s.matchAll(new RegExp(re.source, re.flags + 'g'))) {
      const snippet = kind === 'literature' ? m[0].replace(/[.,;:]+$/, '') : m[0];
      if (!snippet) continue;
      found.push({ kind, snippet, start: m.index, end: m.index + snippet.length });
    }
  }
  // Explicit qualitative claims can be declared as CLAIM: exact source passage [E1].
  for (const m of s.matchAll(/^CLAIM:\s*([^\n]+)$/gm)) {
    const raw = m[1].replace(/\s*\[E\d+\]\s*$/, '').trim();
    if (raw) {
      const start = m.index + m[0].indexOf(raw);
      found.push({ kind: 'declared', snippet: raw, start, end: start + raw.length });
    }
  }
  // Avoid double-counting overlapping patterns (e.g. n=30, DOI marker + DOI).
  const merged = [];
  for (const c of found.sort((a,b) => a.start-b.start || b.end-a.end)) {
    const last = merged.at(-1);
    if (last && c.start < last.end) {
      last.end = Math.max(last.end, c.end);
      last.snippet = s.slice(last.start, last.end);
      if (c.kind === 'literature') last.kind = 'literature';
    } else merged.push({ ...c });
  }
  return merged;
}
export function findUngroundedClaims(text, max = 5) {
  return scanClaims(text).slice(0, max).map(({kind,snippet}) => ({kind,snippet}));
}
const GROUNDING_RULE = 'Grounding check: attach [E<number>] immediately after every detected scientific claim; use the exact text from a successful eligible tool result. Never invent evidence IDs. Use CLAIM: exact passage [E<number>] on its own line for qualitative source claims. Literal linkage is not semantic proof. If no evidence is available, explain that without repeating unsupported figures. For complex research, register alternatives and falsifiers with research_hypothesis; predeclare compute tests (tool, args, support/refute output criteria) where possible, then execute the tools; assess each with evidence, and use reviewer/verifier roles when configured. For relevant tasks use research_causal (DAG), research_causal_audit (observational conditional-independence and candidate DAG sensitivity), research_experiment (design), research_uncertainty (propagation), research_reproduce (independent replay), and research_conflicts (structured contradictions), and research_semantic (model-assisted extraction and semantic comparison of full-text evidence; candidate judgments only). Use research_memory only with approval; stored evidence is historical, not current verification. If a shortlist lacks a needed tool call research_route to recover the full catalog.';
export async function runAgentLoop({ provider, registry, messages, onEvent = () => {}, maxSteps = 25, signal, systemExtra, maxConcurrent, grounding = true, requireIndependentReview = registry?.cfg?.agent?.requireIndependentReview === true, researchHooks = true } = {}) {
  // Effective tool-concurrency limit for this run: caller-provided `maxConcurrent` when
  // it is a positive integer, otherwise DEFAULT_MAX_CONCURRENT (4).
  const concurrency = Number.isInteger(maxConcurrent) && maxConcurrent >= 1 ? maxConcurrent : DEFAULT_MAX_CONCURRENT;
  // Ardışık bozuk araç çağrısı sayacı: 3'e ulaşınca döngü sonlanır (sonsuz döngü koruması).
  let malformedStreak = 0;
  // Run-local evidence graph and one repair attempt.
  const research = new ResearchState();
  const agentCfg = registry?.cfg?.agent;
  const root = registry?.workspaceRoot;
  const lessonEnabled = researchHooks && agentCfg?.lessonGate?.enabled === true;
  const autoMemory = researchHooks && agentCfg?.researchMemory?.autoSave === true;
  const query = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const finish = async result => {
    const snapshot = result.research;
    if (lessonEnabled && result.unverified) {
      try {
        const capture = await captureGroundingLesson(root);
        if(capture.code!==0)throw new Error(capture.diagnostic || capture.output || 'Lesson capture failed');
        result.lessonCapture = capture;
      } catch(e) { result.lessonError = e.message; onEvent({type:'warning',text:'Lesson capture failed: '+e.message}); }
    }
    if (autoMemory && snapshot && ['evidence','hypotheses','reviews','analyses','rejectedClaims'].some(k=>snapshot[k]?.length)) {
      try {
        result.memory = await saveResearch(root,snapshot,{status:result.unverified?'withheld':result.done?'completed':'partial'});
        onEvent({type:'info',text:'Research memory saved: '+result.memory.id});
      } catch(e) { result.memoryError=e.message;onEvent({type:'warning',text:'Research memory save failed: '+e.message}); }
    }
    return result;
  };
  const checkLessons = async () => {
    try {
      const result = await lessonGate(root,'preflight');
      if(result.code===0)return null;
      return result;
    } catch(e){return {code:2,output:'',diagnostic:e.message};}
  };
  const blockedLessons = (steps,lesson) => {
    onEvent({type:'error',reason:'lesson_gate_blocked',text:'Lesson-gate blocked completion: '+(lesson.output || lesson.diagnostic || 'unknown failure')});
    return finish({done:false,steps,lessonBlocked:true,lesson,research:research.snapshot()});
  };
  if (lessonEnabled) {
    const failure=await checkLessons();
    if(failure)return blockedLessons(0,failure);
  }
  let sequence = 0;
  let groundingNudge = false;
  const rejectedDrafts = new Set();
  const cleanDrafts = () => { for (let i = messages.length - 1; i >= 0; i--) if (rejectedDrafts.has(messages[i])) messages.splice(i, 1); };
  // Abort: nedeni olay olarak bildir ve düzenli sonuçla dön (hata fırlatma).
  const abortRun = (steps) => {
    cleanDrafts();
    onEvent({ type: 'error', text: 'Run aborted before completion.', reason: 'aborted' });
    return finish({ done: false, aborted: true, steps, research: research.snapshot() });
  };
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return abortRun(step);
    onEvent({ type: 'step', step: step + 1, maxSteps });
    // systemExtra yalnızca model çağrılarına eklenir; kalıcı geçmiş kopya üzerinden korunur.
    // Kanıt kapısı uyarısı da sistem istemine eklenir (kalıcı messages dizisine yazılmaz).
    const effectiveSystemExtra = [systemExtra, grounding && GROUNDING_RULE, groundingNudge && 'Previous answer had unsupported claims; repair or withdraw them.', requireIndependentReview && 'Independent reviewer AND verifier must support each exact claim; use task with role and target.'].filter(Boolean).join('\n\n');
    const chatMessages =
      effectiveSystemExtra
        ? messages[0]?.role === 'system' && typeof messages[0].content === 'string'
          ? messages.map((m, i) => (i === 0 ? { ...m, content: `${m.content}\n\n${effectiveSystemExtra}` } : m))
          : [{ role: 'system', content: effectiveSystemExtra }, ...messages]
        : messages;
    const schemas = registry.schemas();
    const routed = agentCfg?.toolRouting?.enabled === true
      ? routeTools(schemas,query,{shortlist:agentCfg.toolRouting.shortlist===true && step===0 && maxSteps>1})
      : {schemas,prioritized:[],mode:'full'};
    if(step===0 && routed.prioritized.length)onEvent({type:'info',text:'Research tool routing ('+routed.mode+'): '+routed.prioritized.join(', ')});
    let res;
    const textChunks = [];
    try {
      res = await provider.chat({
        messages: chatMessages,
        tools: routed.schemas,
        signal,
        onChunk: (c) => {
          if (c.type === 'text_delta') { if (grounding || lessonEnabled) textChunks.push(c.text); else onEvent({ type: 'text_delta', text: c.text }); }
          else if (c.type === 'reasoning_delta') onEvent({ type: 'reasoning_delta', text: c.text });
          else if (c.type === 'info') onEvent({ type: 'info', text: c.text });
        },
      });
    } catch (e) {
      // Abort hatası döngüyü çökertmez: nedeni bildirip çık; diğer sağlayıcı hataları aynen yayılır.
      if (signal?.aborted || e?.name === 'AbortError' || /abort/i.test(String(e?.message ?? ''))) return abortRun(step);
      cleanDrafts();
      throw e;
    }

    const toolCalls = res.toolCalls ?? [];
    const assistant = { role: 'assistant', content: res.content ?? '' };
    if (toolCalls.length) {
      assistant.tool_calls = toolCalls.map((tc) => ({
        id: tc?.id,
        type: 'function',
        function: { name: typeof tc?.name === 'string' ? tc.name : String(tc?.name ?? ''), arguments: stringifyArgs(tc?.arguments) },
      }));
    }
    messages.push(assistant);

    // Grounding buffers final text until validation; ungrounded mode preserves live streaming.
    if (res.reasoning && !res.streamed) onEvent({ type: 'reasoning', text: res.reasoning });
    const publishText = () => {
      if ((grounding || lessonEnabled) && res.streamed) for (const text of textChunks) onEvent({ type: 'text_delta', text });
      else if (res.content && !res.streamed) onEvent({ type: 'text', text: res.content });
    };
    if (!toolCalls.length) {
      // Every detected claim must link to its own eligible evidence.
      const claims = grounding ? research.checkClaims(res.content ?? '', scanClaims(res.content), requireIndependentReview) : [];
      if (claims.length) {
        rejectedDrafts.add(assistant);
        const detail = claims.map((c) => `${c.kind}: ${JSON.stringify(c.snippet)}`).join('; ');
        if (!groundingNudge && step + 1 < maxSteps) {
          groundingNudge = true;
          onEvent({
            type: 'warning',
            reason: 'ungrounded_claims',
            text: `Ungrounded claims without matching evidence or required review (${detail}). Asking the model to verify them with a tool.`,
            claims,
          });
          continue;
        }
        onEvent({
          type: 'warning',
          reason: 'ungrounded_claims',
          text: `Answer marked unverified: still unsupported after the grounding check (${detail}).`,
          claims,
        });
        cleanDrafts();
        messages.push({ role: 'assistant', content: 'Scientific result withheld: evidence or review was insufficient.' });
        return finish({ done: false, steps: step + 1, unverified: true, unverifiedClaims: claims, research: research.snapshot() });
      }
      cleanDrafts();
      if (lessonEnabled) {
        const failure=await checkLessons();
        if(failure){
          const index=messages.indexOf(assistant);
          if(index>=0)messages.splice(index,1);
          return blockedLessons(step+1,failure);
        }
      }
      publishText();
      return finish({ done: true, steps: step + 1, research: research.snapshot() });
    }

    if (!grounding && !lessonEnabled) publishText();
    // Bozuk çağrı: adı eksik/bilinmiyor veya argümanlar geçersiz JSON. Çalıştırılmaz;
    // o çağrı için temiz hata gözlemi modele döner ve döngü sürer.
    const isMalformed = (tc) => {
      if (!tc || typeof tc !== 'object') return true;
      if (typeof tc.name !== 'string' || !tc.name.trim()) return true;
      if (!registry.get(tc.name)) return true;
      const args = tc.arguments;
      if (args == null) return false;
      if (typeof args !== 'object' || Array.isArray(args)) return true;
      const keys = Object.keys(args);
      return keys.length === 1 && keys[0] === '_raw'; // sağlayıcının JSON ayrıştırma hatası işareti
    };
    const malformedMessage = (tc) => {
      if (typeof tc?.name !== 'string' || !tc.name.trim()) return 'Malformed tool call: missing or empty tool name.';
      if (!registry.get(tc.name)) return `Malformed tool call: unknown tool "${tc.name}".`;
      return 'Malformed tool call: tool arguments are not valid JSON.';
    };
    // Her yardımcı, modele gidecek araç yanıtını (output dizgesi) döndürür; messages'a
    // yazma çağrı yerine yapılır (sıralı akışta hemen, havuzda asistan sırasına göre).
    const runMalformed = (tc) => {
      onEvent({ type: 'tool_call', id: tc?.id, name: tc?.name, args: tc?.arguments });
      const output = JSON.stringify({ error: malformedMessage(tc) });
      onEvent({ type: 'tool_result', id: tc?.id, name: tc?.name, ok: false, output });
      return output;
    };
    const runOne = async (tc) => {
      onEvent({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments });
      // Kayıt çoğu araç hatasını {ok:false} ile döndürür; invoke'un kendisi fırlarsa veya
      // geçersiz sonuç dönerse de döngü ölmesin: temiz hata gözlemi modele geri beslenir.
      let result;
      const evidenceId = `E${++sequence}`;
      try {
        result = await registry.invoke(tc.name, tc.arguments, { provider, onEvent, maxSteps, signal, research });
        if (!result || typeof result !== 'object' || typeof result.output !== 'string') {
          result = { ok: false, output: JSON.stringify({ error: 'Tool returned an invalid result.' }) };
        }
      } catch (e) {
        result = { ok: false, output: JSON.stringify({ error: String(e?.message ?? e) }) };
      }
      const id = research.record(evidenceId, tc.name, tc.arguments, result);
      onEvent({ type: 'tool_result', id: tc.id, name: tc.name, ok: result.ok, output: result.output, ...(id ? { evidenceId: id } : {}) });
      return id ? `${result.output}\n[Evidence ID: ${id}]` : result.output;
    };
    // Abort arada tetiklendiyse kalan çağrılar çalıştırılmaz; geçmiş tutarlı kalsın diye
    // her biri için 'aborted' gözlemi yazılır.
    const runAborted = (tc) => {
      const output = JSON.stringify({ error: 'Aborted before execution.' });
      onEvent({ type: 'tool_call', id: tc?.id, name: tc?.name, args: tc?.arguments });
      onEvent({ type: 'tool_result', id: tc?.id, name: tc?.name, ok: false, output });
      return output;
    };

    // Tüm çağrılar paralel-güvenli araçlara aitse aynı adımda sınırlı eşzamanlılıkla yürüt.
    const parallel = toolCalls.length > 1 && toolCalls.every((tc) => registry.get(tc?.name)?.parallel);
    let malformedThisStep = 0;
    if (parallel) {
      // Bounded-concurrency pool: at most `concurrency` tool calls run at once; each
      // queued call starts only when a running one finishes, so a turn with many calls
      // cannot exhaust CPU by spawning every child process simultaneously. tool_call /
      // tool_result events stream as calls start and complete, but the resulting tool
      // messages are appended afterwards in the assistant message's tool_calls order, so
      // every result stays paired with its own tool_call id. If abort fires mid-batch,
      // not-yet-started calls are never executed and each gets an 'Aborted before
      // execution.' observation; malformed calls likewise never execute.
      const outputs = new Array(toolCalls.length);
      let abortedMidBatch = false;
      await runWithConcurrency(toolCalls, async (tc, i) => {
        if (signal?.aborted) {
          abortedMidBatch = true;
          outputs[i] = runAborted(tc);
        } else if (isMalformed(tc)) {
          malformedThisStep++;
          outputs[i] = runMalformed(tc);
        } else {
          outputs[i] = await runOne(tc);
        }
      }, concurrency);
      for (let i = 0; i < toolCalls.length; i++) {
        if (outputs[i] !== undefined) {
          messages.push({ role: 'tool', tool_call_id: toolCalls[i]?.id, content: outputs[i] });
        }
      }
      if (abortedMidBatch) return abortRun(step);
    } else {
      let abortedMidBatch = false;
      for (const tc of toolCalls) {
        if (signal?.aborted) {
          abortedMidBatch = true;
          messages.push({ role: 'tool', tool_call_id: tc?.id, content: runAborted(tc) });
        } else if (isMalformed(tc)) {
          malformedThisStep++;
          messages.push({ role: 'tool', tool_call_id: tc?.id, content: runMalformed(tc) });
        } else {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: await runOne(tc) });
        }
      }
      if (abortedMidBatch) return abortRun(step);
    }
    malformedStreak = malformedThisStep > 0 ? malformedStreak + malformedThisStep : 0;
    if (malformedStreak >= 3) {
      cleanDrafts();
      onEvent({ type: 'error', text: 'Stopped after 3 consecutive malformed tool calls.', reason: 'malformed_tool_calls' });
      return finish({ done: false, steps: step + 1, research: research.snapshot() });
    }
  }
  cleanDrafts();
  onEvent({ type: 'error', text: `Step limit exceeded (${maxSteps}); loop stopped.` });
  return finish({ done: false, steps: maxSteps, research: research.snapshot() });
}

export function buildSystemPrompt(cfg) {
  const os = `${process.platform} / ${process.arch}`;
  return [
    'You are SciAgent, a scientific coding agent.',
    'Your job: complete the user\u2019s scientific and software tasks step by step using tools when needed.',
    `Workspace root: ${cfg.agent.workspaceRoot}`,
    `System: ${os}, date: ${new Date().toISOString().slice(0, 10)}`,
    'Rules: briefly explain before changing files; keep commands within the workspace; never invent — check files first; follow existing code style; respond in English.',
  ].join('\n');
}
