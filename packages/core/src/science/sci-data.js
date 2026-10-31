import { promises as fs } from 'node:fs';
import { resolveSafe } from '../tools/fs-tools.js';

/** Scientific data analysis tools: descriptive statistics + small matrix ops (Node built-ins only). */

const MAX_MATRIX = 10;
const EPS = 1e-12; // singularity threshold for pivots

// 6 significant digits; -0 normalized to 0.
const f6 = (v) => (v === 0 ? 0 : v).toPrecision(6);
// 10 significant digits (matrix output).
const f10 = (v) => (v === 0 ? 0 : v).toPrecision(10);
// Remove float noise for the [[..],[..]] literal.
const clean = (v) => {
  const c = Number(v.toPrecision(12));
  return Math.abs(c) < EPS ? 0 : c;
};

// Parse a CSV cell: empty or non-numeric -> null.
function parseCell(cell) {
  const t = String(cell ?? '').trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// Descriptive stats line for one numeric series (sample sd, n-1).
function describe(name, nums) {
  const n = nums.length;
  if (n < 2) throw new Error(`'${name}': en az 2 sayısal veri gerekli (bulunan: ${n})`);
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const line = `${name}: n=${n}, ortalama=${f6(mean)}, medyan=${f6(median)}, ss=${f6(sd)}, varyans=${f6(variance)}, min=${f6(Math.min(...nums))}, maks=${f6(Math.max(...nums))}`;
  return { mean, line };
}

// Read a simple CSV and extract up to 2 requested columns (simple split(','), no quoting).
async function readCsvColumns(workspaceRoot, p, columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('columns gerekli: 1 veya 2 sütun adı ver');
  }
  if (columns.length > 2) throw new Error('en fazla 2 sütun verilebilir');
  const abs = resolveSafe(workspaceRoot, p);
  const text = (await fs.readFile(abs, 'utf8')).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error(`ikili dosya okunamaz: ${p}`);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error('CSV en az başlık + 1 satır içermeli');
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(','));
  const idx = columns.map((c) => {
    const i = header.indexOf(String(c).trim());
    if (i === -1) throw new Error(`sütun bulunamadı: ${c}`);
    return i;
  });
  const cols = idx.map((i) => rows.map((r) => parseCell(r[i])).filter((v) => v !== null));
  // Rows where both columns are numeric (pairwise complete).
  const pairs =
    columns.length === 2
      ? rows
          .map((r) => [parseCell(r[idx[0]]), parseCell(r[idx[1]])])
          .filter(([x, y]) => x !== null && y !== null)
      : null;
  return { cols, pairs, rowCount: rows.length };
}

export const stats_calc = {
  name: 'stats_calc',
  description:
    'Betimsel istatistik ve doğrusal analiz hesaplar. numbers verilirse doğrudan o liste kullanılır; yoksa path ile çalışma alanındaki CSV okunur (basit CSV: hücreler virgülle bölünür, tırnaklı alanlar desteklenmez). columns tek sütun ise n, ortalama, medyan, örneklem standart sapma (n-1), varyans, min, maks; iki sütun ise ayrıca Pearson korelasyonu r ve en küçük kareler doğrusal regresyonu (eğim a, kesişim b, r²) verilir. Sayısal olmayan hücreler o sütunda atlanır; yeterli veri yoksa hata verir (n≥2; regresyon için n≥3).',
  parameters: {
    type: 'object',
    properties: {
      numbers: {
        type: 'array',
        items: { type: 'number' },
        description: 'Doğrudan sayı listesi (verilirse path ve columns yok sayılır)',
      },
      path: { type: 'string', description: 'Çalışma alanına göre CSV dosyası' },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: '1 veya 2 sütun adı (CSV kipinde zorunlu)',
      },
    },
  },
  needsApproval: false,
  parallel: true,
  async execute({ numbers, path: p, columns }, { workspaceRoot }) {
    if (Array.isArray(numbers) && numbers.length) {
      const nums = numbers.map(Number).filter((v) => Number.isFinite(v));
      const { line } = describe('veri', nums);
      return line;
    }
    if (!p) throw new Error('numbers ya da path gerekli');
    const { cols, pairs, rowCount } = await readCsvColumns(workspaceRoot, p, columns);
    const out = [`dosya: ${p} (${rowCount} satır)`];
    out.push(describe(columns[0], cols[0]).line);
    if (cols.length === 1) return out.join('\n');
    out.push(describe(columns[1], cols[1]).line);

    // Correlation + OLS regression on pairwise-complete rows.
    if (pairs.length < 2) throw new Error('korelasyon için en az 2 eşleşen veri çifti gerekli');
    const xs = pairs.map(([x]) => x);
    const ys = pairs.map(([, y]) => y);
    const n = pairs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const syy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
    const sxy = pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
    if (sxx === 0 || syy === 0) throw new Error('korelasyon tanımsız: sabit sütun');
    const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
    out.push(`Pearson korelasyonu r = ${f6(r)}`);
    if (n < 3) throw new Error('doğrusal regresyon için en az 3 veri çifti gerekli');
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    out.push(`regresyon: y = ${f6(slope)}·x + ${f6(intercept)} (eğim a=${f6(slope)}, kesişim b=${f6(intercept)})`);
    out.push(`r² = ${f6(r * r)}`);
    return out.join('\n');
  },
};

// Validate and normalize a matrix argument (rows of numbers, max 10x10).
function asMatrix(m, label) {
  if (!Array.isArray(m) || m.length === 0) throw new Error(`${label}: matris boş olamaz`);
  if (m.length > MAX_MATRIX) {
    throw new Error(`${label}: boyut sınırı aşıldı, en fazla ${MAX_MATRIX}x${MAX_MATRIX}`);
  }
  const rows = m.map((row, i) => {
    if (!Array.isArray(row) || row.length === 0) throw new Error(`${label}: ${i + 1}. satır boş olamaz`);
    if (row.length > MAX_MATRIX) {
      throw new Error(`${label}: boyut sınırı aşıldı, en fazla ${MAX_MATRIX}x${MAX_MATRIX}`);
    }
    return row.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${label}: sayısal olmayan değer (${i + 1}. satır)`);
      return n;
    });
  });
  const w = rows[0].length;
  if (rows.some((r) => r.length !== w)) throw new Error(`${label}: satır uzunlukları farklı`);
  return rows;
}

function requireSquare(m, label, opName) {
  if (m.length !== m[0].length) {
    throw new Error(`${opName} için kare matris gerekli (${label}: ${m.length}x${m[0].length})`);
  }
}

// Determinant via Gaussian elimination with partial pivoting.
function determinant(m) {
  const n = m.length;
  const a = m.map((row) => [...row]);
  let det = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    }
    if (Math.abs(a[p][i]) < EPS) return 0;
    if (p !== i) {
      [a[i], a[p]] = [a[p], a[i]];
      det = -det;
    }
    det *= a[i][i];
    for (let k = i + 1; k < n; k++) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j < n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return det;
}

// Inverse via Gauss-Jordan elimination with partial pivoting.
function invert(m) {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    }
    if (Math.abs(a[p][i]) < EPS) throw new Error('matris tekil');
    if (p !== i) [a[i], a[p]] = [a[p], a[i]];
    const piv = a[i][i];
    for (let j = 0; j < 2 * n; j++) a[i][j] /= piv;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = a[k][i];
      if (f !== 0) {
        for (let j = 0; j < 2 * n; j++) a[k][j] -= f * a[i][j];
      }
    }
  }
  return a.map((row) => row.slice(n));
}

const matrixLines = (m) => m.map((row) => `[${row.map(f10).join(', ')}]`).join('\n');
const matrixLiteral = (m) => `[[${m.map((row) => row.map((v) => String(clean(v))).join(',')).join('],[')}]]`;

export const matrix_ops = {
  name: 'matrix_ops',
  description:
    'Küçük matris işlemleri (en fazla 10x10). op=det: determinant (Gauss eliminasyonu, kısmi pivotlu); op=inverse: ters matris (Gauss-Jordan; tekil matris hata verir); op=multiply: matris çarpımı (boyut uyumsuzsa hata verir). Matrisler satır dizileri hâlinde verilir, örn. [[1,2],[3,4]].',
  parameters: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['det', 'inverse', 'multiply'], description: 'Yapılacak işlem' },
      a: {
        type: 'array',
        items: { type: 'array', items: { type: 'number' } },
        description: 'İlk matris (satırların dizisi)',
      },
      b: {
        type: 'array',
        items: { type: 'array', items: { type: 'number' } },
        description: 'İkinci matris (yalnız multiply için)',
      },
    },
    required: ['op', 'a'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ op, a, b }) {
    const A = asMatrix(a, 'a');
    if (op === 'det') {
      requireSquare(A, 'a', 'det');
      return `determinant = ${f10(determinant(A))}`;
    }
    if (op === 'inverse') {
      requireSquare(A, 'a', 'inverse');
      const inv = invert(A);
      return `ters matris:\n${matrixLines(inv)}\nmatris = ${matrixLiteral(inv)}`;
    }
    if (op === 'multiply') {
      const B = asMatrix(b, 'b');
      if (B.length !== A[0].length) {
        throw new Error(`boyut uyumsuz: (${A.length}x${A[0].length}) · (${B.length}x${B[0].length})`);
      }
      const C = A.map((row) =>
        Array.from({ length: B[0].length }, (_, j) => row.reduce((s, v, i) => s + v * B[i][j], 0)),
      );
      return `çarpım:\n${matrixLines(C)}\nmatris = ${matrixLiteral(C)}`;
    }
    throw new Error(`bilinmeyen op: ${op} (det | inverse | multiply)`);
  },
};
