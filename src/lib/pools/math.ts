// Integer rules shared by the simulation, the live mode and the tests. Every function mirrors a line of
// contracts/PooledFunding.sol, so the simulation and the contract give the same numbers to the last unit.

export const DOMAIN_COUNT = 4;
export const QUORUM_BPS = 4_000n;
export const FEE_BPS = 200n;
export const BPS = 10_000n;
export const POWER_SCALE = 1_000_000n;
export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;
export const MAX_TITLE_BYTES = 120;

export type Points = readonly [number, number, number, number];
export type Choice = "for" | "against" | "abstain";

// Integer square root, rounded down: the same Babylonian loop as the contract's `_sqrt`.
export function isqrt(x: bigint): bigint {
  if (x < 0n) throw new RangeError("isqrt of a negative number");
  if (x <= 3n) return x === 0n ? 0n : 1n;
  let r = x;
  let k = x / 2n + 1n;
  while (k < r) {
    r = k;
    k = (x / k + k) / 2n;
  }
  return r;
}

// Points in the pool's domain count in full, Points in the three other domains count a quarter.
export function effectivePointsTimes4(points: Points, domain: number): bigint {
  const on = BigInt(points[domain]);
  const all = points.reduce((sum, p) => sum + BigInt(p), 0n);
  return 4n * on + (all - on);
}

// Voting power, scaled by 1e6: sqrt(effective Points).
export function powerOf(points: Points, domain: number): bigint {
  return isqrt(effectivePointsTimes4(points, domain) * 250_000_000_000n);
}

export interface Tally {
  end: number;
  open: boolean;
  for: bigint;
  against: bigint;
  abstain: bigint;
  total: bigint;
}

export const castPower = (t: Pick<Tally, "for" | "against" | "abstain">) => t.for + t.against + t.abstain;
export const quorumPower = (total: bigint) => (total * QUORUM_BPS + BPS - 1n) / BPS;
export const quorumMet = (t: Pick<Tally, "for" | "against" | "abstain" | "total">) => castPower(t) * BPS >= t.total * QUORUM_BPS;

export type Verdict = "passed" | "failed" | "undecided";

// Before the end, a vote can only be closed when its result can no longer change.
export function earlyVerdict(t: Pick<Tally, "for" | "against" | "total">): Verdict {
  if (t.for * 2n > t.total) return "passed";
  if (t.against * 2n >= t.total) return "failed";
  return "undecided";
}

export function finalVerdict(t: Pick<Tally, "for" | "against" | "abstain" | "total">): "passed" | "failed" {
  return quorumMet(t) && t.for > t.against ? "passed" : "failed";
}

export const feeOf = (amount: bigint) => (amount * FEE_BPS) / BPS;

export interface Share<K> {
  who: K;
  points: bigint;
  amount: bigint;
}

// Splits `net` by share of project Points, rounding down; the last payee takes the remainder.
export function splitByPoints<K>(net: bigint, work: readonly (readonly [K, bigint])[]): Share<K>[] {
  const total = work.reduce((sum, [, points]) => sum + points, 0n);
  if (total === 0n) return [];
  let sent = 0n;
  return work.map(([who, points], i) => {
    const amount = i === work.length - 1 ? net - sent : (net * points) / total;
    sent += amount;
    return { who, points, amount };
  });
}

export const usdc = (whole: number) => BigInt(whole) * USDC_UNIT;

const grouped = new Intl.NumberFormat("en-US");

// 12_500_000_000n -> "12,500"; fractions only when there are any.
export function formatUsdc(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = grouped.format(abs / USDC_UNIT);
  const fraction = (abs % USDC_UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction.padEnd(2, "0")}` : ""}`;
}

// For tables: rounded to the cent, "12,970.59". Logs and tests keep `formatUsdc`, exact to the last unit.
export function formatUsdcRounded(minor: bigint): string {
  const cents = (minor + 5_000n) / 10_000n;
  const fraction = cents % 100n;
  return `${grouped.format(cents / 100n)}${fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0")}`}`;
}

export const formatPower = (power: bigint) => (Number(power) / Number(POWER_SCALE)).toFixed(2);

// For bar widths: a percentage as a number, cut to two decimals.
export const percentOf = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 10_000n) / whole) / 100);

// For text: rounded half up in integers, so 160 of 340 reads "47.1" and never "47.0".
export function percentText(part: bigint, whole: bigint, digits = 1): string {
  if (whole === 0n) return (0).toFixed(digits);
  const scale = 10n ** BigInt(digits);
  const rounded = (part * 100n * scale * 2n + whole) / (whole * 2n);
  const fraction = digits === 0 ? "" : `.${(rounded % scale).toString().padStart(digits, "0")}`;
  return `${rounded / scale}${fraction}`;
}

export const titleBytes = (title: string) => new TextEncoder().encode(title).length;
