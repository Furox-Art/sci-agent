// Exact integer accumulation of finite IEEE-754 binary64 inputs.
// Every input is an integer multiple of 2^-1074. Accumulate first and
// round only at the output boundary, avoiding cancellation and overflow.
const bits = new DataView(new ArrayBuffer(8));
const FRACTION = (1n << 52n) - 1n;
const UNIT = -1074;
export const finiteNumber = x => typeof x === 'number' && Number.isFinite(x);

function units(x) {
  if (!finiteNumber(x)) throw new Error('Expected a finite numeric value');
  bits.setFloat64(0, x);
  const raw = bits.getBigUint64(0);
  const exponent = Number((raw >> 52n) & 2047n);
  const significand = (raw & FRACTION) | (exponent ? 1n << 52n : 0n);
  const magnitude = significand << BigInt(exponent ? exponent - 1 : 0);
  return raw >> 63n ? -magnitude : magnitude;
}
function floorLog2(n, d) {
  let e = n.toString(2).length - d.toString(2).length;
  if (e >= 0 ? n < (d << BigInt(e)) : (n << BigInt(-e)) < d) e--;
  return e;
}
// Round a signed exact rational times a power of two to nearest binary64,
// ties to even, including the subnormal range.
function rational(n, d, scale = 0) {
  if (n === 0n) return 0;
  const sign = n < 0n ? -1 : 1;
  if (n < 0n) n = -n;
  const exponent = floorLog2(n, d) + scale;
  if (exponent > 1023) return sign * Infinity;
  const quantum = Math.max(UNIT, exponent - 52);
  const shift = scale - quantum;
  if (shift >= 0) n <<= BigInt(shift);
  else d <<= BigInt(-shift);
  let q = n / d;
  const twice = 2n * (n % d);
  if (twice > d || (twice === d && (q & 1n))) q++;
  return sign * Number(q) * 2 ** quantum;
}
function representable(value, nonzero, label) {
  if (!Number.isFinite(value)) throw new Error(label + ' overflow: not representable as a finite number');
  if (value === 0 && nonzero) throw new Error(label + ' underflow: nonzero result is not representable');
  return value;
}
function sqrtRatio(n, d, scale) {
  if (!n) return 0;
  const exponent = Math.floor((floorLog2(n, d) + scale) / 2);
  if (exponent > 1023) return Infinity;
  if (exponent < -1075) return 0;
  const normal = Math.sqrt(rational(n, d, scale - 2 * exponent));
  // Avoid evaluating 2^-1075 directly before the final subnormal rounding.
  return exponent === -1075 ? (normal / 2) * Number.MIN_VALUE : normal * 2 ** exponent;
}
function moments(values) {
  let sum = 0n, squares = 0n;
  let min = Infinity, max = -Infinity;
  for (const value of values) {
    const x = units(value);
    sum += x;
    squares += x * x;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const n = BigInt(values.length);
  return { n, sum, spread: n * squares - sum * sum, min, max };
}
export function describeNumbers(values, { includeVariance = true, includeMedian = true } = {}) {
  if (!Array.isArray(values) || !values.length) throw new Error('At least one numeric value required');
  const { n, sum, spread, min, max } = moments(values);
  const mean = representable(rational(sum, n, UNIT), sum !== 0n, 'Mean');
  const result = { n: values.length, mean, min, max, sd: null };
  if (includeMedian) {
    const sorted = [...values].sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
    const mid = Math.floor(values.length / 2);
    if (values.length % 2) result.median = sorted[mid];
    else {
      const total = units(sorted[mid - 1]) + units(sorted[mid]);
      result.median = representable(rational(total, 2n, UNIT), total !== 0n, 'Median');
    }
  }
  if (n > 1n) {
    const d = n * (n - 1n);
    result.sd = representable(sqrtRatio(spread, d, 2 * UNIT), spread !== 0n, 'Standard deviation');
    if (includeVariance) result.variance = representable(rational(spread, d, 2 * UNIT), spread !== 0n, 'Variance');
  }
  return result;
}
export function linearFit(pairs) {
  const xs = pairs.map(([x]) => x), ys = pairs.map(([,y]) => y);
  const x = moments(xs), y = moments(ys), n = x.n;
  if (!x.spread || !y.spread) throw new Error('correlation undefined: constant column');
  let cross = 0n;
  for (const [a,b] of pairs) cross += units(a) * units(b);
  const cov = n * cross - x.sum * y.sum;
  const r = representable((cov < 0n ? -1 : 1) * sqrtRatio(cov * cov, x.spread * y.spread, 0), cov !== 0n, 'Correlation');
  const slope = representable(rational(cov, x.spread), cov !== 0n, 'Regression slope');
  const numerator = y.sum * x.spread - cov * x.sum;
  const intercept = representable(rational(numerator, n * x.spread, UNIT), numerator !== 0n, 'Regression intercept');
  const r2 = representable(rational(cov * cov, x.spread * y.spread), cov !== 0n, 'R squared');
  return { r, slope, intercept, r2 };
}
