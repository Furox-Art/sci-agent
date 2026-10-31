/**
 * Kimya bilimsel aracı: molar kütle (mol kütlesi) hesaplama.
 *
 * Dış bağımlılık yoktur; gömülü element tablosu ve saf JavaScript ayrıştırıcı
 * kullanır (yalnız Node built-in'leri, Node ESM).
 *
 * Atom kütleleri: IUPAC CIAAW standart atom kütleleri, ~5 anlamlı basamak
 * (kısaltılmış/abridged değerler). Standart aralığı olan (köşeli parantezle
 * verilen) elementlerde kullanılan geleneksel değer; radyoaktif elementlerde
 * (yalnız kütle numarası bilinen) en uzun ömürlü izotopun kütle numarası
 * kullanılır. Tablo atom numarası (Z) sırasıyla dizilidir.
 */

/** Sembol → standart atom kütlesi (g/mol). 118 element, Z sırasıyla. */
export const ATOMIC_MASSES = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
  Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996,
  Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63,
  As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
  Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41,
  In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33,
  La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25,
  Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05, Lu: 174.97, Hf: 178.49,
  Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
  Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226,
  Ac: 227, Th: 232.04, Pa: 231.04, U: 238.03, Np: 237, Pu: 244, Am: 243, Cm: 247,
  Bk: 247, Cf: 251, Es: 252, Fm: 257, Md: 258, No: 259, Lr: 266, Rf: 267,
  Db: 268, Sg: 269, Bh: 270, Hs: 269, Mt: 278, Ds: 281, Rg: 282, Cn: 285,
  Nh: 286, Fl: 289, Mc: 290, Lv: 293, Ts: 294, Og: 294,
};

/** Hidrat/ayırıcı nokta karakterleri: '·', '*' veya '.' */
const HYDRATE_SEP = /[·*.]/;

/** En fazla 6 anlamlı basamak, sondaki sıfırlar temizlenmiş sayı metni. */
const fmt = (x) => String(Number(x.toPrecision(6)));

/**
 * src[i..] içindeki sayısal alt simgeyi/katsayıyı okur; rakam yoksa 1 döner.
 * off: hata mesajlarındaki konum için, tam formül içindeki başlangıç kayması.
 */
function readCount(src, i, off) {
  let j = i;
  while (j < src.length && src[j] >= '0' && src[j] <= '9') j++;
  if (j === i) return { n: 1, next: i };
  const raw = src.slice(i, j);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`Geçersiz sayısal değer: '${raw}' (konum ${off + i + 1})`);
  }
  return { n, next: j };
}

/**
 * src[i..] üzerinde bir formül parçasını ayrıştırır; ')' karakterinde veya
 * dizge sonunda durur. openIdx: bu parçayı açan '(' konumu (0 tabanlı,
 * src içi; en üst seviyede -1).
 */
function parseSegment(src, i, openIdx, off) {
  const counts = new Map();
  const add = (sym, n) => counts.set(sym, (counts.get(sym) ?? 0) + n);
  while (i < src.length) {
    const ch = src[i];
    if (ch === ')') {
      if (openIdx === -1) {
        throw new Error(`Dengesiz parantez: konum ${off + i + 1}'de eşleşmeyen ')' var`);
      }
      return { counts, end: i };
    }
    if (ch === '(') {
      const inner = parseSegment(src, i + 1, i, off);
      if (inner.counts.size === 0) {
        throw new Error(`Boş parantez grubu (konum ${off + i + 1})`);
      }
      i = inner.end + 1;
      const { n, next } = readCount(src, i, off);
      i = next;
      for (const [sym, m] of inner.counts) add(sym, m * n);
      continue;
    }
    if (ch >= 'A' && ch <= 'Z') {
      let j = i + 1;
      while (j < src.length && src[j] >= 'a' && src[j] <= 'z') j++;
      const sym = src.slice(i, j);
      if (!Object.hasOwn(ATOMIC_MASSES, sym)) {
        throw new Error(`Bilinmeyen element sembolü: '${sym}' (konum ${off + i + 1})`);
      }
      i = j;
      const { n, next } = readCount(src, i, off);
      i = next;
      add(sym, n);
      continue;
    }
    if (ch >= 'a' && ch <= 'z') {
      throw new Error(
        `Geçersiz karakter: '${ch}' (konum ${off + i + 1}); element sembolü büyük harfle başlamalı`,
      );
    }
    throw new Error(`Geçersiz karakter: '${ch}' (konum ${off + i + 1})`);
  }
  if (openIdx !== -1) {
    throw new Error(`Dengesiz parantez: konum ${off + openIdx + 1}'daki '(' kapatılmamış`);
  }
  return { counts, end: i };
}

/**
 * Formülü element → toplam adet haritasına ayrıştırır.
 * Hidrat ayırıcısı (·, *, .) formülü parçalara böler; her parça
 * "[katsayı]segment" biçiminde olabilir. İlk parçanın başındaki katsayı
 * hidratın tamamına çarpılır (ör. 2CuSO4·5H2O = 2 CuSO4 + 10 H2O).
 */
function parseFormula(formula) {
  const cleaned = formula.replace(/\s+/g, '');
  if (!cleaned) throw new Error('Formül boş olamaz');
  const parts = [];
  let off = 0;
  for (const raw of cleaned.split(HYDRATE_SEP)) {
    parts.push({ raw, off });
    off += raw.length + 1; // +1: ayırıcı karakter
  }
  const parsed = parts.map(({ raw, off: pOff }) => {
    const head = readCount(raw, 0, pOff);
    if (head.next >= raw.length) {
      throw new Error(`Konum ${pOff + 1}: ayırıcıdan sonra eksik/boş formül parçası`);
    }
    const seg = parseSegment(raw, head.next, -1, pOff);
    return { coef: head.n, counts: seg.counts };
  });
  const total = new Map();
  for (let p = 0; p < parsed.length; p++) {
    const eff = p === 0 ? parsed[0].coef : parsed[p].coef * parsed[0].coef;
    for (const [sym, n] of parsed[p].counts) {
      total.set(sym, (total.get(sym) ?? 0) + n * eff);
    }
  }
  return total;
}

export const molar_mass = {
  name: 'molar_mass',
  description:
    'Kimyasal formülün mol kütlesini (g/mol) hesaplar. Çoklu harfli semboller (Cl, Cu), ' +
    'alt simgeler (H2O), iç içe parantez (Ca(OH)2, Al2(SO4)3), ağırlıklı ortalama formülleri ' +
    '((NH4)2SO4) ve hidrat gösterimi (CuSO4·5H2O; ayırıcı olarak ·, * veya . kullanılabilir) ' +
    'desteklenir; element dökümünü de verir. Atom kütleleri IUPAC standart atom kütleleridir ' +
    '(~5 anlamlı basamak).',
  parameters: {
    type: 'object',
    properties: {
      formula: { type: 'string', description: 'Kimyasal formül (ör. H2O, Ca(OH)2, CuSO4·5H2O)' },
    },
    required: ['formula'],
  },
  needsApproval: false,
  parallel: true,
  async execute(args = {}, _ctx) {
    const formula = args.formula;
    if (typeof formula !== 'string' || formula.trim() === '') {
      throw new Error("formula parametresi zorunlu: hesaplanacak kimyasal formül (metin)");
    }
    const counts = parseFormula(formula);
    let total = 0;
    const lines = [];
    for (const [sym, n] of counts) {
      const m = ATOMIC_MASSES[sym] * n;
      total += m;
      lines.push(`${sym} ×${n} = ${fmt(m)}`);
    }
    return `${formula.trim()} mol kütlesi: ${fmt(total)} g/mol\n${lines.join('\n')}`;
  },
};
