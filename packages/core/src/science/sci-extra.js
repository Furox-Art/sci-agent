/** Math-physics tool pack: safe expression evaluator, unit converter, physical constants. */

// ---- shared number formatting: round to `sig` significant digits, trim trailing zeros ----
function trimNum(x, sig) {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  return String(Number(x.toPrecision(sig)));
}

// ============================== math_eval ==============================
// No eval/Function: hand-written tokenizer + recursive descent parser.

const MATH_FUNCS = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

const MATH_CONSTS = { pi: Math.PI, e: Math.E };

function tokenizeMath(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === '.') {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      // scientific notation only when the exponent is well-formed (e.g. 1.6e-19; '2e' is not a number)
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (/[0-9]/.test(src[k] ?? '')) {
          while (k < src.length && /[0-9]/.test(src[k])) k++;
          j = k;
        }
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (Number.isNaN(value)) throw new Error(`Geçersiz sayı: '${text}' (konum ${i + 1})`);
      tokens.push({ type: 'num', value, text, pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      tokens.push({ type: 'ident', text: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if ('+-*/%^()'.includes(ch)) {
      tokens.push({ type: ch, text: ch, pos: i });
      i++;
      continue;
    }
    throw new Error(`Geçersiz karakter: '${ch}' (konum ${i + 1})`);
  }
  return tokens;
}

function parseMath(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];

  function expr() {
    let v = term();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = take().type;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function term() {
    let v = unary();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const op = take().type;
      const r = unary();
      if ((op === '/' || op === '%') && r === 0) throw new Error('Sıfıra bölme tanımsız');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }

  function unary() {
    const t = peek();
    if (t && (t.type === '-' || t.type === '+')) {
      take();
      const v = unary();
      return t.type === '-' ? -v : v;
    }
    return power();
  }

  function power() {
    const base = atom();
    if (peek() && peek().type === '^') {
      take();
      return Math.pow(base, unary()); // right-associative; exponent may carry unary sign
    }
    return base;
  }

  function atom() {
    const t = take();
    if (!t) throw new Error('Geçersiz ifade: beklenmedik son');
    if (t.type === 'num') return t.value;
    if (t.type === '(') {
      const v = expr();
      const close = take();
      if (!close || close.type !== ')') throw new Error('Kapanış parantezi eksik');
      return v;
    }
    if (t.type === 'ident') {
      const fn = MATH_FUNCS[t.text.toLowerCase()];
      if (fn) {
        const open = take();
        if (!open || open.type !== '(') throw new Error(`Fonksiyon parantezle çağrılmalı: ${t.text}(...)`);
        const arg = expr();
        const close = take();
        if (!close || close.type !== ')') throw new Error('Kapanış parantezi eksik');
        return fn(arg);
      }
      const c = MATH_CONSTS[t.text.toLowerCase()];
      if (c !== undefined) return c;
      throw new Error(`Bilinmeyen ad: '${t.text}' (değişkenler desteklenmiyor; sabitler: pi, e)`);
    }
    throw new Error(`Geçersiz ifade: beklenmeyen simge '${t.text}' (konum ${t.pos + 1})`);
  }

  const v = expr();
  if (p < tokens.length) {
    throw new Error(`Geçersiz ifade: '${tokens[p].text}' beklenmeyen konumda (konum ${tokens[p].pos + 1})`);
  }
  return v;
}

export const math_eval = {
  name: 'math_eval',
  description:
    'Matematik ifadesini güvenli değerlendirir (eval/Function kullanmaz, kendi ayrıştırıcısıyla). Desteklenenler: + - * / % ^, parantez, unary -, sabitler pi ve e, fonksiyonlar sqrt sin cos tan asin acos atan ln log(10 taban) exp abs floor ceil round; trig fonksiyonları radyan alır. Sonuç 12 anlamlı basamağa yuvarlanır.',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Değerlendirilecek ifade (ör. 2*(3+4)^2, sin(pi/2), sqrt(2))',
      },
    },
    required: ['expression'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ expression }) {
    const src = String(expression ?? '').trim();
    if (!src) throw new Error('İfade boş olamaz');
    if (src.length > 500) throw new Error('İfade çok uzun (en fazla 500 karakter)');
    const value = parseMath(tokenizeMath(src));
    if (!Number.isFinite(value)) throw new Error('Sonuç tanımsız veya sonsuz (ör. 0/0, taşma, tanım kümesi dışı)');
    return `${src} = ${trimNum(value, 12)}`;
  },
};

// ============================== unit_convert ==============================

const TEMP_CAT = 'sıcaklık';

// SI-base conversion factors; temperature is offset-based and handled separately
const UNIT_TABLES = {
  uzunluk: { base: 'm', units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 } },
  kütle: { base: 'kg', units: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, lb: 0.45359237, oz: 0.028349523125 } },
  zaman: { base: 's', units: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400 } },
  enerji: { base: 'J', units: { J: 1, kJ: 1000, cal: 4.184, kcal: 4184, eV: 1.602176634e-19, Wh: 3600, kWh: 3.6e6 } },
  basınç: { base: 'Pa', units: { Pa: 1, kPa: 1000, bar: 1e5, atm: 101325, mmHg: 133.322387415 } },
  açı: { base: 'rad', units: { deg: Math.PI / 180, rad: 1, grad: Math.PI / 200 } },
};

const UNIT_ALIASES = {
  mm: ['milimetre', 'millimeter'],
  cm: ['santimetre', 'centimetre', 'centimeter'],
  m: ['metre', 'meter'],
  km: ['kilometre', 'kilometer'],
  in: ['inch', 'inç'],
  ft: ['foot', 'feet', 'ayak'],
  yd: ['yard', 'yards'],
  mi: ['mile', 'mil'],
  mg: ['miligram', 'milligram'],
  g: ['gram', 'grams', 'gr'],
  kg: ['kilogram', 'kilograms'],
  t: ['ton', 'tonne'],
  lb: ['pound', 'pounds', 'lbs'],
  oz: ['ounce', 'ounces'],
  ms: ['milisaniye', 'millisecond', 'milliseconds'],
  s: ['second', 'seconds', 'sec', 'sn', 'saniye'],
  min: ['minute', 'minutes', 'dakika', 'dk'],
  h: ['hour', 'hours', 'saat', 'sa'],
  d: ['day', 'days', 'gün', 'gun'],
  J: ['joule', 'joules', 'jul'],
  kJ: ['kilojoule', 'kilojoules'],
  cal: ['calorie', 'calories', 'kalori'],
  kcal: ['kilocalorie', 'kilocalories', 'kilokalori'],
  eV: ['electronvolt', 'elektronvolt'],
  Wh: ['watthour', 'watt-hour'],
  kWh: ['kilowatthour', 'kilowatt-hour'],
  Pa: ['pascal', 'pascals'],
  kPa: ['kilopascal', 'kilopascals'],
  bar: ['bars'],
  atm: ['atmosphere', 'atmospheres', 'atmosfer'],
  mmHg: ['milimetreciva'],
  deg: ['degree', 'degrees', 'derece', '°'],
  rad: ['radian', 'radians', 'radyan'],
  grad: ['gradian', 'gradyan', 'gon'],
};

const TEMP_UNITS = ['C', 'K', 'F'];
const TEMP_ALIASES = { C: ['celsius', 'celcius', 'santigrat', '°c'], K: ['kelvin', '°k'], F: ['fahrenheit', '°f'] };
const TEMP_TO_C = { C: (v) => v, K: (v) => v - 273.15, F: (v) => ((v - 32) * 5) / 9 };
const TEMP_FROM_C = { C: (c) => c, K: (c) => c + 273.15, F: (c) => (c * 9) / 5 + 32 };

const normUnit = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_\-]/g, '');

const UNIT_LOOKUP = new Map();
for (const [cat, table] of Object.entries(UNIT_TABLES)) {
  for (const u of Object.keys(table.units)) UNIT_LOOKUP.set(normUnit(u), { cat, unit: u });
}
for (const [canon, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const [cat, table] of Object.entries(UNIT_TABLES)) {
    if (table.units[canon] === undefined) continue;
    for (const a of aliases) UNIT_LOOKUP.set(normUnit(a), { cat, unit: canon });
  }
}
const TEMP_LOOKUP = new Map(TEMP_UNITS.map((u) => [normUnit(u), u]));
for (const [canon, aliases] of Object.entries(TEMP_ALIASES)) {
  for (const a of aliases) TEMP_LOOKUP.set(normUnit(a), canon);
}

function lookupUnit(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Birim adı boş olamaz');
  const n = normUnit(raw);
  const hit = UNIT_LOOKUP.get(n);
  if (hit) return { ...hit, raw };
  const t = TEMP_LOOKUP.get(n);
  if (t) return { cat: TEMP_CAT, unit: t, raw };
  throw new Error(
    `Bilinmeyen birim: '${raw}'. Desteklenen birimler: uzunluk (mm cm m km in ft yd mi), kütle (mg g kg t lb oz), ` +
      `zaman (ms s min h d), enerji (J kJ cal kcal eV Wh kWh), basınç (Pa kPa bar atm mmHg), sıcaklık (C K F), açı (deg rad grad)`,
  );
}

export const unit_convert = {
  name: 'unit_convert',
  description:
    'Birim dönüştürür: uzunluk, kütle, zaman, enerji, basınç, sıcaklık, açı. Harf duyarsızdır, takma adları anlar (ör. metre/meter/m, mil/mile/mi, santigrat/C). Farklı kategoriler arası dönüşüm (ör. m → kg) reddedilir.',
  parameters: {
    type: 'object',
    properties: {
      value: { type: 'number', description: 'Dönüştürülecek sayısal değer' },
      from: { type: 'string', description: 'Kaynak birim (ör. mi, kg, C)' },
      to: { type: 'string', description: 'Hedef birim (ör. km, lb, F)' },
    },
    required: ['value', 'from', 'to'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ value, from, to }) {
    const v = Number(value);
    if (!Number.isFinite(v)) throw new Error('Geçerli bir sayısal değer gerekli (value)');
    const a = lookupUnit(from);
    const b = lookupUnit(to);
    if (a.cat !== b.cat) {
      throw new Error(`Birim kategorileri uyuşmuyor: '${a.raw}' (${a.cat}) → '${b.raw}' (${b.cat})`);
    }
    let out;
    if (a.cat === TEMP_CAT) {
      out = TEMP_FROM_C[b.unit](TEMP_TO_C[a.unit](v));
    } else {
      out = (v * UNIT_TABLES[a.cat].units[a.unit]) / UNIT_TABLES[b.cat].units[b.unit];
    }
    return `${trimNum(v, 10)} ${a.raw} = ${trimNum(out, 10)} ${b.raw}`;
  },
};

// ============================== physical_constants ==============================
// Approximate CODATA values; c, h, e, kB, Na are exact by the 2019 SI.

const CONSTANTS = [
  { name: 'c', symbol: 'c', desc: 'vacuumda ışık hızı', value: 299792458, unit: 'm/s' },
  { name: 'h', symbol: 'h', desc: 'Planck sabiti', value: 6.62607015e-34, unit: 'J·s' },
  { name: 'hbar', symbol: 'ħ', desc: 'indirgenmiş Planck sabiti (h/2π)', value: 1.054571817e-34, unit: 'J·s' },
  { name: 'G', symbol: 'G', desc: 'Newton kütleçekim sabiti', value: 6.6743e-11, unit: 'm^3/(kg·s^2)' },
  { name: 'g', symbol: 'g', desc: 'standart yerçekimi ivmesi', value: 9.80665, unit: 'm/s^2' },
  { name: 'Na', symbol: 'N_A', desc: 'Avogadro sabiti', value: 6.02214076e23, unit: '1/mol' },
  { name: 'R', symbol: 'R', desc: 'ideal gaz sabiti', value: 8.314462618, unit: 'J/(mol·K)' },
  { name: 'kB', symbol: 'k_B', desc: 'Boltzmann sabiti', value: 1.380649e-23, unit: 'J/K' },
  { name: 'e', symbol: 'e', desc: 'elementel elektrik yükü', value: 1.602176634e-19, unit: 'C' },
  { name: 'me', symbol: 'mₑ', desc: 'elektron kütlesi', value: 9.1093837015e-31, unit: 'kg' },
  { name: 'mp', symbol: 'mₚ', desc: 'proton kütlesi', value: 1.67262192369e-27, unit: 'kg' },
  { name: 'mn', symbol: 'mₙ', desc: 'nötron kütlesi', value: 1.67492749804e-27, unit: 'kg' },
  { name: 'epsilon0', symbol: 'ε₀', desc: 'vacuum elektrik geçirgenliği', value: 8.8541878128e-12, unit: 'F/m' },
  { name: 'mu0', symbol: 'μ₀', desc: 'vacuum manyetik geçirgenliği', value: 1.25663706212e-6, unit: 'N/A^2' },
  { name: 'sigma', symbol: 'σ', desc: 'Stefan-Boltzmann sabiti', value: 5.670374419e-8, unit: 'W/(m^2·K^4)' },
  { name: 'alpha', symbol: 'α', desc: 'ince yapı sabiti (boyutsuz)', value: 7.2973525693e-3, unit: 'boyutsuz' },
  { name: 'atm', symbol: 'atm', desc: 'standart atmosfer basıncı', value: 101325, unit: 'Pa' },
  { name: 'T0', symbol: 'T₀', desc: 'standart sıcaklık (0 °C)', value: 273.15, unit: 'K' },
  { name: 'u', symbol: 'u', desc: 'atomik kütle birimi (dalton)', value: 1.6605390666e-27, unit: 'kg' },
  { name: 'eV', symbol: 'eV', desc: 'elektronvolt (enerji birimi)', value: 1.602176634e-19, unit: 'J' },
  { name: 'Ry', symbol: 'Ry', desc: 'Rydberg enerjisi', value: 2.1798723611035e-18, unit: 'J' },
  { name: 'Rinf', symbol: 'R∞', desc: 'Rydberg sabiti (sonsuz çekirdek kütlesi)', value: 10973731.56816, unit: '1/m' },
];

const CONST_ALIASES = {
  c: ['ışıkhızı'],
  h: ['planck'],
  g: ['yerçekimi', 'gravite'],
  Na: ['avogadro'],
  R: ['gazsabiti'],
  kB: ['boltzmann'],
  e: ['elementelyük', 'elementarycharge'],
  me: ['elektronkütlesi', 'electronmass'],
  mp: ['protonkütlesi'],
  mn: ['nötronkütlesi'],
  epsilon0: ['eps0', 'elektrikgeçirgenliği'],
  mu0: ['mu', 'manyetikgeçirgenlik'],
  sigma: ['stefan', 'stefanboltzmann'],
  atm: ['atmosfer', 'standardatmosfer'],
  T0: ['standartsıcaklık'],
  u: ['amu', 'dalton', 'atomikkutlebirimi'],
  eV: ['elektronvolt', 'electronvolt'],
  Ry: ['rydberg', 'rydbergenerjisi'],
  Rinf: ['rydbergsabiti'],
  alpha: ['inceyapısabiti'],
};

const normConst = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_\-]/g, '');

const CONST_BY_NORM = new Map(CONSTANTS.map((c) => [normConst(c.name), c]));
for (const [canon, aliases] of Object.entries(CONST_ALIASES)) {
  const c = CONSTANTS.find((k) => k.name === canon);
  for (const a of aliases) CONST_BY_NORM.set(normConst(a), c);
}

const fmtConst = (c) => {
  const label = c.symbol === c.name ? c.name : `${c.name} (${c.symbol})`;
  return `${label} — ${c.desc}: ${c.value} ${c.unit}`;
};

const LIST_WORDS = new Set(['', 'liste', 'list', 'all', 'hepsi', 'tumu', 'tümü']);

export const physical_constants = {
  name: 'physical_constants',
  description:
    "Fizik sabitlerini döndürür (yaklaşık CODATA, birimli). name verilirse o sabit aranır (harf duyarsız, ör. c, h, hbar, G, Na, kB, epsilon0); name yoksa veya 'liste' ise tümü listelenir.",
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "Sabit adı veya takma adı (ör. c, hbar, eps0, amu). Boşsa veya 'liste' ise tümü listelenir.",
      },
    },
  },
  needsApproval: false,
  parallel: true,
  async execute({ name } = {}) {
    const raw = name == null ? '' : String(name).trim();
    if (LIST_WORDS.has(normConst(raw))) {
      return `${CONSTANTS.length} fizik sabiti (yaklaşık CODATA):\n${CONSTANTS.map(fmtConst).join('\n')}`;
    }
    const c = CONSTANTS.find((k) => k.name === raw) ?? CONST_BY_NORM.get(normConst(raw));
    if (!c) {
      throw new Error(
        `Bilinmeyen sabit: '${raw}'. Kullanılabilir isimler: ${CONSTANTS.map((k) => k.name).join(', ')}`,
      );
    }
    return fmtConst(c);
  },
};

// Convenience bundle for registry/plugin integration.
export const sciExtraTools = [math_eval, unit_convert, physical_constants];
