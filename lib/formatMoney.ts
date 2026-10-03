// Money formatting for every price, total and balance (CONTRACTS §2.6).
// en-IN grouping ('₹1,24,999') via Intl.NumberFormat with a manual-grouping fallback for
// runtimes whose Intl is missing or odd (older Hermes builds). 'auto' decimals = 0 dp when
// the amount is whole (|n − round(n)| < 0.005) else 2 dp. NaN / Infinity / undefined → '₹0'.

export type FormatMoneyOptions = { decimals?: 'auto' | 0 | 2; symbol?: boolean /* default true */ };

export type MoneyParts = {
  /** '₹' (or '' when `symbol: false`), prefixed with '-' for negative amounts so `symbol + whole + fraction` always reads right */
  symbol: string;
  /** grouped integer part without sign, e.g. '1,24,999' */
  whole: string;
  /** two digits when 2 dp apply, else null */
  fraction: string | null;
  negative: boolean;
};

const RUPEE = '₹';

type Dp = 0 | 2;

const formatters: Partial<Record<Dp, Intl.NumberFormat | null>> = {};

function getFormatter(dp: Dp): Intl.NumberFormat | null {
  if (dp in formatters) return formatters[dp] ?? null;
  let formatter: Intl.NumberFormat | null = null;
  try {
    formatter = new Intl.NumberFormat('en-IN', {
      style: 'decimal',
      useGrouping: true,
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    });
    // Probe once: some engines construct fine but format with locale-foreign digits.
    if (!/^[\d,]+(\.\d+)?$/.test(formatter.format(1234567.5))) formatter = null;
  } catch {
    formatter = null;
  }
  formatters[dp] = formatter;
  return formatter;
}

/** Indian digit grouping: last three digits, then pairs — '1249999' → '12,49,999'. */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

function formatAbs(abs: number, dp: Dp): { whole: string; fraction: string | null } {
  const formatter = getFormatter(dp);
  if (formatter) {
    try {
      const [whole, fraction] = formatter.format(abs).split('.');
      if (/^[\d,]+$/.test(whole) && (dp === 0 || /^\d{2}$/.test(fraction ?? ''))) {
        return { whole, fraction: dp === 2 ? (fraction ?? '00') : null };
      }
    } catch {
      // fall through to the manual path
    }
  }
  const [whole, fraction] = abs.toFixed(dp).split('.');
  return { whole: groupIndian(whole), fraction: dp === 2 ? (fraction ?? '00') : null };
}

/** `{ symbol, whole, fraction, negative }` for split rendering (big rupees, small paise). Same rounding/sign rules as `formatMoney`. */
export function formatMoneyParts(amount: number, opts?: FormatMoneyOptions): MoneyParts {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const decimals = opts?.decimals ?? 'auto';
  const dp: Dp = decimals === 'auto' ? (Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2) : decimals;
  const { whole, fraction } = formatAbs(Math.abs(n), dp);
  // '-₹0' is never shown: a tiny negative that rounds to zero reads as zero.
  const roundsToZero = /^0+$/.test(whole.replace(/,/g, '')) && (fraction == null || /^0+$/.test(fraction));
  const negative = n < 0 && !roundsToZero;
  const symbol = `${negative ? '-' : ''}${opts?.symbol === false ? '' : RUPEE}`;
  return { symbol, whole, fraction, negative };
}

/** '₹1,249' | '₹28.50' | '-₹12' | '₹0' for NaN. `decimals: 2` forces paise ('₹1,249.00'), `0` rounds to rupees, `symbol: false` drops the ₹. */
export function formatMoney(amount: number, opts?: FormatMoneyOptions): string {
  const p = formatMoneyParts(amount, opts);
  return `${p.symbol}${p.whole}${p.fraction != null ? `.${p.fraction}` : ''}`;
}

/** `Math.round`, with NaN / Infinity treated as 0 — the integer final payable every bill ends on. */
export function roundRupee(amount: number): number {
  return Math.round(typeof amount === 'number' && Number.isFinite(amount) ? amount : 0);
}
