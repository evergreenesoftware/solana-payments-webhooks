// Exact decimal <-> base-unit conversion with bigint. Never uses floating point.

/** Converts a decimal string such as "10.5" into base units (bigint) for the given decimals. */
export function toBaseUnits(amount: string | number | bigint, decimals: number): bigint {
  if (typeof amount === 'bigint') return amount * 10n ** BigInt(decimals);
  const text = typeof amount === 'number' ? numberToPlain(amount) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RangeError(`Invalid amount "${text}": use a positive decimal string such as "10.5"`);
  const [whole, frac = ''] = text.split('.') as [string, string?];
  if (frac.length > decimals) throw new RangeError(`Amount "${text}" has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Converts base units back into a normalised decimal string ("10500000", 6 -> "10.5"). */
export function fromBaseUnits(units: bigint | string, decimals: number): string {
  const value = BigInt(units);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Invalid amount ${n}`);
  // Avoid exponent notation (1e-7) by using toFixed with enough precision, then trim.
  return n.toFixed(12).replace(/\.?0+$/, '');
}
