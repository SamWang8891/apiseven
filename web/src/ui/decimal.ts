// How typed decimal text becomes a number, exactly or not at all: the kit NumberInput's rule, shared
// with the schema form's number-or-text fields and numeric tags (final wave D4). A double keeps about
// 17 significant digits, so most integers past 2^53 (9007199254740993) and long fractions are rounded
// by Number(); a field that showed the digits typed but sent the rounded number would send what it
// does not show, so such text is held instead.

/** Decimal number text: digits with an optional point, sign and exponent ("1.5", ".5", "-3e2"). */
export const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

const PARTS = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i;

/**
 * The number a decimal text denotes, written one way: its significant digits and a power of ten
 * ("1.50", "15e-1" and "1.5" are all "15e-1"). Two texts are the same number when these match.
 */
function decimalOf(text: string): string {
  const [, sign = '', int = '', frac = '', exp = '0'] = PARTS.exec(text) ?? [];
  const all = (int + frac).replace(/^0+/, '');
  if (all === '') return '0';
  const digits = all.replace(/0+$/, '');
  return `${sign === '-' ? '-' : ''}${digits}e${Number(exp) - frac.length + (all.length - digits.length)}`;
}

/**
 * Whether decimal text `s` (trimmed, DECIMAL_TEXT) is exactly `n`, the number Number(s) gave: false
 * when that rounded it. Text that reads back as the same number is exact: "1.50", "1e3", ".5", and big
 * integers a double holds exactly (2^53, 1e19).
 */
export const exactly = (s: string, n: number): boolean => decimalOf(s) === decimalOf(String(n));
