import { readSafeText } from '../tools/fs-tools.js';
import { parseCsv, parseNumericCell as parseCell } from './csv-parser.js';
import { describeNumbers, linearFit, finiteNumber } from './numeric-stats.js';

/** Scientific data analysis tools: descriptive statistics + small matrix ops (Node built-ins only). */

const MAX_MATRIX = 10;
// Use exact zero pivots, not an absolute threshold; near-singular matrices remain numerically sensitive.

// 6 significant digits; -0 normalized to 0.
const f6 = (v) => (v === 0 ? 0 : v).toPrecision(6);
// 10 significant digits (matrix output).
const f10 = (v) => (v === 0 ? 0 : v).toPrecision(10);
// Preserve small nonzero values; normalize negative zero.
const clean = (v) => Number(v.toPrecision(12)) || 0;
const finiteResult = (v) => {
  if (!Number.isFinite(v)) throw new Error('Non-finite matrix result (overflow)');
  return v;
};

// Descriptive stats line for one numeric series (sample sd, n-1).
function describe(name, nums) {
  const n = nums.length;
  if (n < 2) throw new Error(`'${name}': at least 2 numeric data points required (found: ${n})`);
  const { mean, median, variance, sd, min, max } = describeNumbers(nums);
  const line = `${name}: n=${n}, mean=${f6(mean)}, median=${f6(median)}, sd=${f6(sd)}, variance=${f6(variance)}, min=${f6(min)}, max=${f6(max)}`;
  return { mean, line };
}

// Read CSV records and extract up to two requested columns.
async function readCsvColumns(workspaceRoot, p, columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('columns required: give 1 or 2 column names');
  }
  if (columns.length > 2) throw new Error('at most 2 columns allowed');
  const text = (await readSafeText(workspaceRoot,p)).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error(`binary file cannot be read: ${p}`);
  const { header, rows } = parseCsv(text);
  const idx = columns.map((c) => {
    const i = header.indexOf(String(c).trim());
    if (i === -1) throw new Error(`column not found: ${c}`);
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
    'Computes descriptive statistics and linear analysis. If numbers is given, that list is used directly; otherwise the CSV at path is read from the workspace (CSV with quoted fields, escaped quotes and multiline records). With a single column: n, mean, median, sample standard deviation (n-1), variance, min, max; with two columns: also Pearson correlation r and least-squares linear regression (slope a, intercept b, r²). Non-numeric cells are skipped in that column; errors if there is not enough data (n≥2; n≥3 for regression).',
  parameters: {
    type: 'object',
    properties: {
      numbers: {
        type: 'array',
        items: { type: 'number' },
        description: 'Direct list of at most 100000 finite numbers (if given, path and columns are ignored)',
      },
      path: { type: 'string', description: 'CSV file relative to the workspace' },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: '1 or 2 column names (required in CSV mode)',
      },
    },
  },
  needsApproval: false,
  parallel: true,
  async execute({ numbers, path: p, columns }, { workspaceRoot }) {
    if (numbers !== undefined) {
      if (!Array.isArray(numbers) || numbers.length > 100000 || !Array.from(numbers).every(finiteNumber)) {
        throw new Error('numbers must contain only finite numeric values (maximum 100000)');
      }
      const nums = numbers;
      const { line } = describe('data', nums);
      return line;
    }
    if (!p) throw new Error('numbers or path required');
    const { cols, pairs, rowCount } = await readCsvColumns(workspaceRoot, p, columns);
    const out = [`file: ${p} (${rowCount} rows)`];
    out.push(describe(columns[0], cols[0]).line);
    if (cols.length === 1) return out.join('\n');
    out.push(describe(columns[1], cols[1]).line);

    // Correlation + OLS regression on pairwise-complete rows.
    if (pairs.length < 2) throw new Error('at least 2 matched data pairs required for correlation');
    if (pairs.length < 3) throw new Error('at least 3 data pairs required for linear regression');
    const { r, slope, intercept, r2 } = linearFit(pairs);
    out.push(`Pearson correlation r = ${f6(r)}`);
    out.push(`regression: y = ${f6(slope)}·x + ${f6(intercept)} (slope a=${f6(slope)}, intercept b=${f6(intercept)})`);
    out.push(`r² = ${f6(r2)}`);
    return out.join('\n');
  },
};

// Validate and normalize a matrix argument (rows of numbers, max 10x10).
function asMatrix(m, label) {
  if (!Array.isArray(m) || m.length === 0) throw new Error(`${label}: matrix cannot be empty`);
  if (m.length > MAX_MATRIX) {
    throw new Error(`${label}: size limit exceeded, at most ${MAX_MATRIX}x${MAX_MATRIX}`);
  }
  const rows = m.map((row, i) => {
    if (!Array.isArray(row) || row.length === 0) throw new Error(`${label}: row ${i + 1} cannot be empty`);
    if (row.length > MAX_MATRIX) {
      throw new Error(`${label}: size limit exceeded, at most ${MAX_MATRIX}x${MAX_MATRIX}`);
    }
    return row.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${label}: non-numeric value (row ${i + 1})`);
      return n;
    });
  });
  const w = rows[0].length;
  if (rows.some((r) => r.length !== w)) throw new Error(`${label}: rows have different lengths`);
  return rows;
}

function requireSquare(m, label, opName) {
  if (m.length !== m[0].length) {
    throw new Error(`${opName} requires a square matrix (${label}: ${m.length}x${m[0].length})`);
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
    if (a[p][i] === 0) return 0;
    if (p !== i) {
      [a[i], a[p]] = [a[p], a[i]];
      det = -det;
    }
    det = finiteResult(det * a[i][i]);
    if (det === 0) throw new Error('Determinant underflow: nonzero pivot product is not representable');
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
    if (a[p][i] === 0) throw new Error('matrix is singular');
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
  return a.map((row) => row.slice(n).map(finiteResult));
}

const matrixLines = (m) => m.map((row) => `[${row.map(f10).join(', ')}]`).join('\n');
const matrixLiteral = (m) => `[[${m.map((row) => row.map((v) => String(clean(v))).join(',')).join('],[')}]]`;

export const matrix_ops = {
  name: 'matrix_ops',
  description:
    'Small matrix operations (at most 10x10). op=det: determinant (Gaussian elimination with partial pivoting); op=inverse: matrix inverse (Gauss-Jordan; singular matrices error); op=multiply: matrix product (errors on dimension mismatch). Matrices are given as arrays of rows, e.g. [[1,2],[3,4]].',
  parameters: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['det', 'inverse', 'multiply'], description: 'Operation to perform' },
      a: {
        type: 'array',
        items: { type: 'array', items: { type: 'number' } },
        description: 'First matrix (array of rows)',
      },
      b: {
        type: 'array',
        items: { type: 'array', items: { type: 'number' } },
        description: 'Second matrix (multiply only)',
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
      return `inverse matrix:\n${matrixLines(inv)}\nmatrix = ${matrixLiteral(inv)}`;
    }
    if (op === 'multiply') {
      const B = asMatrix(b, 'b');
      if (B.length !== A[0].length) {
        throw new Error(`dimension mismatch: (${A.length}x${A[0].length}) · (${B.length}x${B[0].length})`);
      }
      const C = A.map((row) =>
        Array.from({ length: B[0].length }, (_, j) => finiteResult(row.reduce((s, v, i) => s + v * B[i][j], 0))),
      );
      return `product:\n${matrixLines(C)}\nmatrix = ${matrixLiteral(C)}`;
    }
    throw new Error(`unknown op: ${op} (det | inverse | multiply)`);
  },
};
