import { describe, expect, it } from "vitest";
import { feeOf, usdc } from "./math";
import {
  type Action,
  type Pool,
  type State,
  CONTRIBUTORS,
  FUNDERS,
  VOTING_DAYS,
  heldBy,
  initialState,
  nextWork,
  payoutPreview,
  poolOf,
  powerIn,
  reduce,
  refusal,
  statusOf,
  totalPowerIn,
} from "./sim";

const play = (actions: Action[], from: State = initialState) => actions.reduce(reduce, from);
const pool = (state: State, id: number): Pool => {
  const found = poolOf(state, id);
  if (!found) throw new Error(`no pool ${id}`);
  return found;
};
const last = (state: State) => state.log[state.log.length - 1];
const code = (state: State, action: Action) => refusal(state, action)?.code ?? null;
const wealth = (state: State) =>
  FUNDERS.reduce((sum, f) => sum + state.wallets[f.id], 0n) +
  CONTRIBUTORS.reduce((sum, c) => sum + state.earned[c.handle], 0n) +
  state.fees +
  state.pools.reduce((sum, p) => sum + (p.status === "paid" ? 0n : heldBy(p)), 0n);

const FILL_POOL_1: Action[] = [
  { type: "pledge", pool: 1, funder: "company-b", amount: usdc(20_000) },
  { type: "pledge", pool: 1, funder: "company-c", amount: usdc(15_000) },
  { type: "pledge", pool: 1, funder: "company-d", amount: usdc(5_000) },
];

const LIST_POOL_2: Action[] = [
  { type: "vote", pool: 2, handle: "contributor-b", choice: "for" },
  { type: "vote", pool: 2, handle: "contributor-d", choice: "for" },
  { type: "vote", pool: 2, handle: "contributor-a", choice: "for" },
  { type: "vote", pool: 2, handle: "contributor-f", choice: "for" },
  { type: "finalize", pool: 2 },
];

describe("sample pools", () => {
  it("starts with one pool per direction and an empty log", () => {
    expect(initialState.log).toEqual([]);
    expect(initialState.day).toBe(0);
    const request = pool(initialState, 1);
    const proposal = pool(initialState, 2);
    expect([request.kind, request.status, request.pledged, request.deadline]).toEqual(["request", "funding", usdc(10_000), 30]);
    expect([proposal.kind, proposal.status, proposal.pledged, proposal.deadline]).toEqual(["proposal", "voting", 0n, null]);
    expect(proposal.listing.end).toBe(VOTING_DAYS);
    expect(initialState.wallets["company-a"]).toBe(usdc(30_000));
  });

  it("snapshots the power available on the pool's domain when the vote opens", () => {
    expect(pool(initialState, 1).listing.total).toBe(totalPowerIn(initialState, "apps"));
    expect(pool(initialState, 2).listing.total).toBe(totalPowerIn(initialState, "infra"));
  });
});

describe("a request that fills", () => {
  it("launches only once the pool holds its full target", () => {
    let s = play(FILL_POOL_1.slice(0, 2));
    expect(pool(s, 1).pledged).toBe(usdc(45_000));
    expect(code(s, { type: "launch", pool: 1 })).toBe("TargetNotReached");
    s = reduce(s, { type: "launch", pool: 1 });
    expect(last(s).refusal).toContain("TargetNotReached");
    expect(pool(s, 1).status).toBe("funding");

    s = reduce(s, FILL_POOL_1[2]);
    expect(code(s, { type: "launch", pool: 1 })).toBeNull();
    s = reduce(s, { type: "launch", pool: 1 });
    expect(pool(s, 1).status).toBe("building");
    expect(pool(s, 1).launchedAt).toBe(0);
  });

  it("takes only what is still missing", () => {
    let s = play(FILL_POOL_1.slice(0, 2));
    s = reduce(s, { type: "pledge", pool: 1, funder: "company-d", amount: usdc(20_000) });
    expect(pool(s, 1).pledged).toBe(usdc(50_000));
    expect(pool(s, 1).pledges["company-d"]).toBe(usdc(5_000));
    expect(s.wallets["company-d"]).toBe(usdc(15_000));
    expect(code(s, { type: "pledge", pool: 1, funder: "company-d", amount: usdc(1) })).toBe("PoolFull");
  });

  it("locks pledges while the pool is open or building", () => {
    const open = play(FILL_POOL_1.slice(0, 1));
    expect(code(open, { type: "refund", pool: 1, funder: "company-b" })).toBe("RefundNotAvailable");
    const building = play([...FILL_POOL_1, { type: "launch", pool: 1 }]);
    expect(code(building, { type: "refund", pool: 1, funder: "company-b" })).toBe("RefundNotAvailable");
  });

  it("refuses a pledge larger than the funder's wallet", () => {
    expect(code(initialState, { type: "pledge", pool: 1, funder: "company-d", amount: usdc(25_000) })).toBe("InsufficientBalance");
    expect(code(initialState, { type: "pledge", pool: 1, funder: "company-d", amount: 0n })).toBe("BadParameters");
  });

  it("pays by share of project Points, less a 2% fee, to the last unit", () => {
    let s = play([...FILL_POOL_1, { type: "launch", pool: 1 }]);
    expect(code(s, { type: "payOut", pool: 1 })).toBe("NoAcceptedWork");
    const before = { ...s.points };
    const first = nextWork(s, pool(s, 1));
    s = play([{ type: "acceptWork", pool: 1 }, { type: "acceptWork", pool: 1 }], s);
    expect(pool(s, 1).batches).toBe(2);
    // Accepted work also counts toward voting power in the pool's domain.
    const [handle, earned] = first[0];
    expect(s.points[handle][0]).toBeGreaterThanOrEqual(before[handle][0] + earned);
    expect(powerIn(s, handle, "apps")).toBeGreaterThan(powerIn(initialState, handle, "apps"));

    const preview = payoutPreview(pool(s, 1));
    expect(preview.fee).toBe(usdc(1_000));
    expect(preview.net).toBe(usdc(49_000));
    expect(preview.shares.reduce((sum, x) => sum + x.amount, 0n)).toBe(preview.net);

    s = reduce(s, { type: "payOut", pool: 1 });
    const paid = pool(s, 1);
    expect(paid.status).toBe("paid");
    expect(paid.payouts).toEqual(preview.shares);
    expect(s.fees).toBe(feeOf(usdc(50_000)));
    for (const share of preview.shares) expect(s.earned[share.handle]).toBe(share.amount);
    expect(code(s, { type: "payOut", pool: 1 })).toBe("NotBuilding");
    expect(code(s, { type: "refund", pool: 1, funder: "company-a" })).toBe("RefundNotAvailable");
  });
});

describe("a pool that misses its target", () => {
  const missed = play([...FILL_POOL_1.slice(0, 2), { type: "advance", days: 30 }]);

  it("turns refundable at the deadline, not before", () => {
    const early = play([...FILL_POOL_1.slice(0, 2), { type: "advance", days: 29 }]);
    expect(statusOf(pool(early, 1), early.day)).toBe("funding");
    expect(statusOf(pool(missed, 1), missed.day)).toBe("expired");
    expect(last(missed).text).toContain("Pool #1 missed its target");
  });

  it("stops pledges and launch", () => {
    expect(code(missed, { type: "pledge", pool: 1, funder: "company-d", amount: usdc(5_000) })).toBe("FundingClosed");
    expect(code(missed, { type: "launch", pool: 1 })).toBe("TargetNotReached");
  });

  it("returns every pledge in full, once", () => {
    let s = missed;
    for (const funder of ["company-a", "company-b", "company-c"] as const) s = reduce(s, { type: "refund", pool: 1, funder });
    expect(FUNDERS.map((f) => s.wallets[f.id])).toEqual(FUNDERS.map((f) => usdc(f.wallet)));
    expect(heldBy(pool(s, 1))).toBe(0n);
    expect(pool(s, 1).status).toBe("expired");
    expect(code(s, { type: "refund", pool: 1, funder: "company-a" })).toBe("NothingToRefund");
    expect(code(s, { type: "refund", pool: 1, funder: "company-d" })).toBe("NothingToRefund");
  });

  it("does not expire a full pool that nobody launched yet", () => {
    const s = play([...FILL_POOL_1, { type: "advance", days: 45 }]);
    expect(statusOf(pool(s, 1), s.day)).toBe("funding");
    expect(code(s, { type: "launch", pool: 1 })).toBeNull();
    expect(code(s, { type: "refund", pool: 1, funder: "company-a" })).toBe("RefundNotAvailable");
  });
});

describe("the listing vote", () => {
  it("keeps pledges closed until contributors list the pool", () => {
    expect(code(initialState, { type: "pledge", pool: 2, funder: "company-b", amount: usdc(5_000) })).toBe("FundingClosed");
    expect(code(initialState, { type: "launch", pool: 2 })).toBe("NotFunding");
  });

  it("cannot be closed while the result can still change", () => {
    const s = play(LIST_POOL_2.slice(0, 1));
    expect(code(s, { type: "finalize", pool: 2 })).toBe("VoteStillOpen");
  });

  it("closes early once For holds more than half of all power, and opens the funding window", () => {
    const s = play(LIST_POOL_2);
    const listed = pool(s, 2);
    expect(listed.status).toBe("funding");
    expect(listed.listing.open).toBe(false);
    expect(listed.listing.for * 2n).toBeGreaterThan(listed.listing.total);
    expect(listed.deadline).toBe(30);
    expect(last(s).text).toContain("Closed early");
  });

  it("lets a contributor change their vote until it closes", () => {
    let s = play([{ type: "vote", pool: 2, handle: "contributor-b", choice: "for" }]);
    const power = powerIn(s, "contributor-b", "infra");
    expect(pool(s, 2).listing.for).toBe(power);
    s = reduce(s, { type: "vote", pool: 2, handle: "contributor-b", choice: "against" });
    expect(pool(s, 2).listing.for).toBe(0n);
    expect(pool(s, 2).listing.against).toBe(power);
  });

  it("fails below quorum even when nobody voted against", () => {
    const s = play([
      { type: "vote", pool: 2, handle: "contributor-g", choice: "for" },
      { type: "advance", days: VOTING_DAYS },
      { type: "finalize", pool: 2 },
    ]);
    expect(pool(s, 2).status).toBe("not-listed");
    expect(last(s).text).toContain("below quorum");
  });

  it("passes after the period on quorum and more For than Against", () => {
    const s = play([
      { type: "vote", pool: 2, handle: "contributor-b", choice: "for" },
      { type: "vote", pool: 2, handle: "contributor-a", choice: "for" },
      { type: "vote", pool: 2, handle: "contributor-c", choice: "against" },
      { type: "advance", days: VOTING_DAYS },
    ]);
    expect(code(s, { type: "vote", pool: 2, handle: "contributor-d", choice: "for" })).toBe("VotingEnded");
    const closed = reduce(s, { type: "finalize", pool: 2 });
    expect(pool(closed, 2).status).toBe("funding");
    expect(pool(closed, 2).deadline).toBe(VOTING_DAYS + 30);
  });

  it("refunds the first pledge of a request that is not listed", () => {
    const propose: Action = {
      type: "propose",
      kind: "request",
      by: "company-c",
      title: "Self-hosted status page",
      domain: "infra",
      target: usdc(12_000),
      fundingDays: 14,
      openingPledge: usdc(4_000),
    };
    let s = reduce(initialState, propose);
    expect(pool(s, 3).pledged).toBe(usdc(4_000));
    expect(s.wallets["company-c"]).toBe(usdc(21_000));
    s = play(
      [
        { type: "vote", pool: 3, handle: "contributor-b", choice: "against" },
        { type: "vote", pool: 3, handle: "contributor-d", choice: "against" },
        { type: "vote", pool: 3, handle: "contributor-a", choice: "against" },
        { type: "vote", pool: 3, handle: "contributor-f", choice: "against" },
        { type: "finalize", pool: 3 },
      ],
      s,
    );
    expect(pool(s, 3).status).toBe("not-listed");
    expect(code(s, { type: "pledge", pool: 3, funder: "company-b", amount: usdc(1_000) })).toBe("FundingClosed");
    s = reduce(s, { type: "refund", pool: 3, funder: "company-c" });
    expect(s.wallets["company-c"]).toBe(usdc(25_000));
  });
});

describe("proposing", () => {
  const request = { type: "propose", kind: "request", by: "company-b", title: "A tool", domain: "data", target: usdc(8_000), fundingDays: 10 } as const;

  it("requires a first pledge for a request, and none for a community proposal", () => {
    expect(code(initialState, { ...request, openingPledge: 0n })).toBe("OpeningPledgeRequired");
    expect(code(initialState, { ...request, openingPledge: usdc(9_000) })).toBe("BadParameters");
    expect(code(initialState, { ...request, openingPledge: usdc(31_000), target: usdc(40_000) })).toBe("InsufficientBalance");
    expect(code(initialState, { ...request, openingPledge: usdc(2_000) })).toBeNull();
  });

  it("validates the title, budget and window", () => {
    const ok = { ...request, openingPledge: usdc(2_000) };
    expect(code(initialState, { ...ok, title: "   " })).toBe("BadParameters");
    expect(code(initialState, { ...ok, title: "x".repeat(121) })).toBe("BadParameters");
    expect(code(initialState, { ...ok, target: 0n, openingPledge: 0n })).toBe("BadParameters");
    expect(code(initialState, { ...ok, fundingDays: 0 })).toBe("BadParameters");
    expect(code(initialState, { ...ok, fundingDays: 366 })).toBe("BadParameters");
  });

  it("only lets a contributor with Points make a community proposal", () => {
    const noPoints: State = { ...initialState, points: { ...initialState.points, "contributor-g": [0, 0, 0, 0] } };
    const proposal = { type: "propose", kind: "proposal", by: "contributor-g", title: "A tool", domain: "data", target: usdc(8_000), fundingDays: 10 } as const;
    expect(code(noPoints, proposal)).toBe("NotAContributor");
    expect(code(initialState, proposal)).toBeNull();
    const s = reduce(initialState, proposal);
    expect(pool(s, 3).pledged).toBe(0n);
    expect(pool(s, 3).proposer).toBe("contributor-g");
  });
});

describe("closing a launched pool by vote", () => {
  const building = play([...FILL_POOL_1, { type: "launch", pool: 1 }]);

  it("can be asked by a funder of the pool or a contributor, nobody else", () => {
    expect(code(building, { type: "openClosure", pool: 1, by: "company-b" })).toBeNull();
    expect(code(building, { type: "openClosure", pool: 1, by: "contributor-c" })).toBeNull();
    expect(code(initialState, { type: "openClosure", pool: 1, by: "company-a" })).toBe("NotBuilding");
    const outsider = play(FILL_POOL_1.slice(0, 2).concat([{ type: "pledge", pool: 1, funder: "company-b", amount: usdc(5_000) }, { type: "launch", pool: 1 }]));
    expect(code(outsider, { type: "openClosure", pool: 1, by: "company-d" })).toBe("NotAParticipant");
  });

  it("blocks the payout while it is open, and refunds everyone if it passes", () => {
    let s = play([{ type: "acceptWork", pool: 1 }, { type: "openClosure", pool: 1, by: "company-b" }], building);
    expect(pool(s, 1).round).toBe(1);
    expect(code(s, { type: "payOut", pool: 1 })).toBe("ClosureVoteOpen");
    expect(code(s, { type: "openClosure", pool: 1, by: "company-c" })).toBe("ClosureVoteOpen");
    s = play(
      [
        { type: "vote", pool: 1, handle: "contributor-e", choice: "for" },
        { type: "vote", pool: 1, handle: "contributor-d", choice: "for" },
        { type: "vote", pool: 1, handle: "contributor-a", choice: "for" },
        { type: "vote", pool: 1, handle: "contributor-b", choice: "for" },
        { type: "finalize", pool: 1 },
      ],
      s,
    );
    expect(pool(s, 1).status).toBe("closed");
    expect(code(s, { type: "payOut", pool: 1 })).toBe("NotBuilding");
    for (const f of FUNDERS) s = reduce(s, { type: "refund", pool: 1, funder: f.id });
    expect(FUNDERS.map((f) => s.wallets[f.id])).toEqual(FUNDERS.map((f) => usdc(f.wallet)));
  });

  it("lets the build continue when the vote fails, and can be asked again", () => {
    let s = play(
      [
        { type: "acceptWork", pool: 1 },
        { type: "openClosure", pool: 1, by: "contributor-c" },
        { type: "vote", pool: 1, handle: "contributor-c", choice: "for" },
        { type: "advance", days: VOTING_DAYS },
        { type: "finalize", pool: 1 },
      ],
      building,
    );
    expect(pool(s, 1).status).toBe("building");
    expect(pool(s, 1).closure?.open).toBe(false);
    expect(code(s, { type: "payOut", pool: 1 })).toBeNull();
    // Another closure vote has to wait one voting period, so repeated votes cannot block the payout.
    expect(code(s, { type: "openClosure", pool: 1, by: "company-a" })).toBe("ClosureCooldown");
    expect(pool(s, 1).closureCooldown).toBe(2 * VOTING_DAYS);
    s = play([{ type: "advance", days: VOTING_DAYS }, { type: "openClosure", pool: 1, by: "company-a" }], s);
    expect(pool(s, 1).round).toBe(2);
    expect(pool(s, 1).ballots[2]).toEqual({});
  });
});

describe("bookkeeping", () => {
  it("logs every action, refused ones included, without changing state on a refusal", () => {
    const s = reduce(initialState, { type: "launch", pool: 1 });
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ seq: 1, day: 0, actor: "Pool" });
    expect(s.log[0].refusal).toMatch(/^TargetNotReached: /);
    expect({ ...s, log: [] }).toEqual(initialState);
    expect(code(initialState, { type: "launch", pool: 9 })).toBe("UnknownPool");
    expect(code(initialState, { type: "advance", days: 0 })).toBe("BadParameters");
  });

  it("never creates or loses money", () => {
    const total = wealth(initialState);
    const stories: Action[][] = [
      [...FILL_POOL_1, { type: "launch", pool: 1 }, { type: "acceptWork", pool: 1 }, { type: "acceptWork", pool: 1 }, { type: "acceptWork", pool: 1 }, { type: "payOut", pool: 1 }],
      [...FILL_POOL_1.slice(0, 2), { type: "advance", days: 31 }, { type: "refund", pool: 1, funder: "company-b" }],
      [...LIST_POOL_2, { type: "pledge", pool: 2, funder: "company-b", amount: usdc(30_000) }, { type: "launch", pool: 2 }],
    ];
    for (const story of stories) expect(wealth(play(story))).toBe(total);
    expect(total).toBe(usdc(115_000));
  });

  it("resets to the sample pools", () => {
    const s = reduce(play(FILL_POOL_1), { type: "reset" });
    expect({ ...s, log: [] }).toEqual(initialState);
    expect(last(s).text).toBe("Reset to the sample pools.");
  });
});
