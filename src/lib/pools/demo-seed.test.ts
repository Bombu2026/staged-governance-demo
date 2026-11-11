import { describe, expect, it } from "vitest";
import { demoState, seededState } from "./demo-seed";
import { usdc } from "./math";
import { FUNDERS, statusOf } from "./sim";

describe("the sample pools of the pools page", () => {
  it("are built by actions the rules accept", () => {
    expect(seededState.log.filter((entry) => entry.refusal).map((entry) => `${entry.text}: ${entry.refusal}`)).toEqual([]);
    expect(demoState.log).toEqual([]);
  });

  it("show one pool at each stage, in both directions", () => {
    expect(demoState.pools.map((p) => [p.kind, statusOf(p, demoState.day)])).toEqual([
      ["request", "paid"],
      ["proposal", "expired"],
      ["request", "funding"],
      ["proposal", "voting"],
      ["request", "building"],
    ]);
    const missed = demoState.pools[1];
    expect(missed.refunded).toBe(missed.pledged);
  });

  it("leave the sample companies enough to fill the open pool", () => {
    const open = demoState.pools[2];
    const available = FUNDERS.reduce((sum, f) => sum + demoState.wallets[f.id], 0n);
    expect(open.target - open.pledged).toBe(usdc(40_000));
    expect(available).toBeGreaterThanOrEqual(open.target - open.pledged);
  });
});
