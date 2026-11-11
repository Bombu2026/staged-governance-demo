import { describe, expect, it } from "vitest";
import {
  type Points,
  earlyVerdict,
  effectivePointsTimes4,
  feeOf,
  finalVerdict,
  formatPower,
  formatUsdc,
  formatUsdcRounded,
  isqrt,
  percentOf,
  percentText,
  powerOf,
  quorumMet,
  quorumPower,
  splitByPoints,
  titleBytes,
  usdc,
} from "./math";

describe("isqrt", () => {
  it("rounds down, like the contract", () => {
    expect([0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n].map(isqrt)).toEqual([0n, 1n, 1n, 1n, 2n, 3n, 4n, 4n]);
    const big = 123_456_789_123_456_789n;
    const root = isqrt(big * big + 5n);
    expect(root).toBe(big);
    expect(isqrt(2n ** 200n)).toBe(2n ** 100n);
  });

  it("refuses negative numbers", () => {
    expect(() => isqrt(-1n)).toThrow();
  });
});

describe("voting power", () => {
  const specialist: Points = [40, 20, 120, 380];

  it("counts Points in the domain in full and the others a quarter", () => {
    expect(effectivePointsTimes4(specialist, 3)).toBe(4n * 380n + 180n);
    expect(effectivePointsTimes4(specialist, 1)).toBe(4n * 20n + 540n);
  });

  it("is the square root of effective Points, scaled by 1e6", () => {
    // 380 + 180 / 4 = 425 effective Points, and sqrt(425) = 20.6155...
    expect(formatPower(powerOf(specialist, 3))).toBe("20.62");
    expect(Number(powerOf(specialist, 3)) / 1e6).toBeCloseTo(Math.sqrt(425), 5);
    expect(powerOf([0, 0, 0, 0], 0)).toBe(0n);
    expect(powerOf([0, 0, 0, 4], 0)).toBe(1_000_000n);
  });

  it("grows slower than Points", () => {
    const one = powerOf([100, 0, 0, 0], 0);
    const four = powerOf([400, 0, 0, 0], 0);
    expect(four).toBe(one * 2n);
  });
});

describe("votes", () => {
  const tally = (f: bigint, a: bigint, ab: bigint, total: bigint) => ({ for: f, against: a, abstain: ab, total });

  it("needs 40% of the power to be cast", () => {
    expect(quorumPower(100n)).toBe(40n);
    expect(quorumPower(101n)).toBe(41n);
    expect(quorumMet(tally(39n, 0n, 0n, 100n))).toBe(false);
    expect(quorumMet(tally(30n, 5n, 5n, 100n))).toBe(true);
  });

  it("passes after the period on quorum and a majority of For over Against", () => {
    expect(finalVerdict(tally(30n, 10n, 0n, 100n))).toBe("passed");
    expect(finalVerdict(tally(30n, 0n, 0n, 100n))).toBe("failed");
    expect(finalVerdict(tally(20n, 20n, 10n, 100n))).toBe("failed");
    expect(finalVerdict(tally(10n, 20n, 20n, 100n))).toBe("failed");
  });

  it("closes early only when the result cannot change", () => {
    expect(earlyVerdict(tally(51n, 0n, 0n, 100n))).toBe("passed");
    expect(earlyVerdict(tally(50n, 0n, 0n, 100n))).toBe("undecided");
    expect(earlyVerdict(tally(49n, 50n, 0n, 100n))).toBe("failed");
    expect(earlyVerdict(tally(40n, 49n, 0n, 100n))).toBe("undecided");
  });
});

describe("money", () => {
  it("takes a 2% fee from the gross amount", () => {
    expect(feeOf(usdc(50_000))).toBe(usdc(1_000));
    expect(feeOf(49n)).toBe(0n);
  });

  it("splits by share of Points and gives the remainder to the last payee", () => {
    const shares = splitByPoints(100n, [
      ["a", 1n],
      ["b", 1n],
      ["c", 1n],
    ]);
    expect(shares.map((s) => s.amount)).toEqual([33n, 33n, 34n]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0n)).toBe(100n);
    expect(splitByPoints(100n, [])).toEqual([]);
    expect(splitByPoints(usdc(49_000), [["x", 160n], ["y", 60n], ["z", 120n]]).map((s) => s.amount)).toEqual([
      23_058_823_529n,
      8_647_058_823n,
      17_294_117_648n,
    ]);
  });

  it("formats minor units", () => {
    expect(formatUsdc(usdc(50_000))).toBe("50,000");
    expect(formatUsdc(12_500_000n)).toBe("12.50");
    expect(formatUsdc(23_058_823_529n)).toBe("23,058.823529");
    expect(formatUsdc(-usdc(3))).toBe("-3");
    expect(formatUsdcRounded(23_058_823_529n)).toBe("23,058.82");
    expect(formatUsdcRounded(12_970_588_235n)).toBe("12,970.59");
    expect(formatUsdcRounded(usdc(1_000))).toBe("1,000");
    expect(formatUsdcRounded(999_995n)).toBe("1");
    expect(percentOf(1n, 3n)).toBe(33.33);
    expect(percentOf(1n, 0n)).toBe(0);
    expect(percentText(160n, 340n)).toBe("47.1");
    expect(percentText(1n, 3n, 2)).toBe("33.33");
    expect(percentText(1n, 2n, 0)).toBe("50");
    expect(percentText(999n, 1000n, 0)).toBe("100");
    expect(percentText(5n, 0n)).toBe("0.0");
  });

  it("counts a title in bytes, as the contract does", () => {
    expect(titleBytes("abc")).toBe(3);
    expect(titleBytes("é")).toBe(2);
  });
});
