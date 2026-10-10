// Compare decimal representations exactly; never introduce a cap tolerance.
export function decimalRatio(value) {
  const raw = String(value);
  if (raw.length > 80 || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d{1,3})?$/.test(raw)) throw new Error('DECIMAL_INVALID');
  const [mantissa, exponent = '0'] = raw.split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const units = BigInt(whole + fraction), scale = fraction.length - Number(exponent);
  if (Math.abs(scale) > 100) throw new Error('DECIMAL_INVALID');
  return scale >= 0 ? [units, 10n ** BigInt(scale)] : [units * 10n ** BigInt(-scale), 1n];
}
export const withinCap = ([n, d], cap) => {
  const [cn, cd] = decimalRatio(cap);
  return n * cd <= cn * d;
};
export const add = ([a, b], [c, d]) => [a * d + c * b, b * d];
export const multiply = ([a, b], [c, d]) => [a * c, b * d];
export const compare = ([a, b], [c, d]) => a * d < c * b ? -1 : a * d > c * b ? 1 : 0;
export function decimalText([n, d]) {
  if (d <= 0n || n < 0n) throw new Error('DECIMAL_INVALID');
  let out = String(n / d), rest = n % d;
  if (rest) out += '.';
  for (let digits = 0; rest; digits++) {
    if (digits === 100) throw new Error('DECIMAL_NON_TERMINATING');
    rest *= 10n; out += String(rest / d); rest %= d;
  }
  return out;
}
export function ceilToTick([n, d], tick) {
  const [tn, td] = decimalRatio(tick);
  if (n < 0n || d <= 0n || tn <= 0n) throw new Error('DECIMAL_INVALID');
  const ticks = (n * td + d * tn - 1n) / (d * tn);
  return decimalText([ticks * tn, td]);
}
