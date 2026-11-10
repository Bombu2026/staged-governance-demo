import { describe, expect, it } from "vitest";
import { type Action, type State, emptyVote, etaOf, initialState, reduce, TIMELOCK_HOURS } from "./governance";
import { type Choice, type Handle, type ProposalId, compareRules, powerTally } from "./vote";

const run = (actions: Action[], from: State = initialState) => actions.reduce(reduce, from);
const proposed = run([{ type: "setMode", mode: "proposed" }]);
const withoutLog = ({ log: _log, ...rest }: State) => rest;
const last = (state: State) => state.log[state.log.length - 1];

function expectRefused(before: State, action: Action) {
  const after = reduce(before, action);
  expect(withoutLog(after)).toEqual(withoutLog(before));
  expect(after.log).toHaveLength(before.log.length + 1);
  expect(last(after).refusal).toEqual(expect.any(String));
  return after;
}

const queued = run(
  [
    { type: "advanceClock", hours: 12 },
    { type: "propose", signer: "A", stolen: false },
    { type: "approve", signer: "B" },
  ],
  proposed,
);

describe("today: single key", () => {
  it("upgrades instantly with the owner key", () => {
    const s = run([{ type: "ownerUpgrade" }, { type: "ownerUpgrade" }]);
    expect(s.vault.version).toBe(3);
    expect(s.clock).toBe(0);
    expect(s.upgrade).toBeNull();
    expect(s.history.map((h) => [h.from, h.to, h.closedAt - (h.queuedAt ?? 0)])).toEqual([
      [1, 2, 0],
      [2, 3, 0],
    ]);
  });

  it("lets a stolen key upgrade instantly and leaves funders no exit", () => {
    const s = run([{ type: "advanceClock", hours: 24 }, { type: "stealOwnerKey" }]);
    expect(s.vault.version).toBe(2);
    expect(s.vault.compromised).toBe(true);
    expect(last(s).actor).toBe("Attacker (stolen owner key)");
    expect(last(s).text).toContain("no window to react");
    expectRefused(s, { type: "withdraw" });
  });

  it("refuses multisig-only actions", () => {
    expectRefused(initialState, { type: "propose", signer: "A", stolen: false });
    expectRefused(initialState, { type: "pause", signer: "A" });
  });
});

describe("proposed: 2-of-3 multisig + 48 h timelock", () => {
  it("refuses single-key upgrades", () => {
    expectRefused(proposed, { type: "ownerUpgrade" });
    expectRefused(proposed, { type: "stealOwnerKey" });
  });

  it("counts the proposer's approval and refuses a duplicate", () => {
    const s = run([{ type: "propose", signer: "A", stolen: false }], proposed);
    expect(s.upgrade?.approvals).toEqual(["A"]);
    expect(s.upgrade?.queuedAt).toBeNull();
    expectRefused(s, { type: "approve", signer: "A" });
  });

  it("queues at 2 approvals with ETA = clock + 48 h", () => {
    expect(queued.upgrade?.queuedAt).toBe(12);
    expect(etaOf(queued.upgrade)).toBe(12 + TIMELOCK_HOURS);
    expectRefused(queued, { type: "approve", signer: "I" });
  });

  it("cannot execute before ETA, can at ETA", () => {
    expectRefused(queued, { type: "execute" });
    const almost = run([{ type: "advanceClock", hours: 24 }, { type: "advanceClock", hours: 23 }], queued);
    expect(almost.clock).toBe(59);
    expectRefused(almost, { type: "execute" });
    const atEta = run([{ type: "advanceClock", hours: 1 }, { type: "execute" }], almost);
    expect(atEta.clock).toBe(60);
    expect(atEta.vault.version).toBe(2);
    expect(atEta.upgrade).toBeNull();
    expect(atEta.history.at(-1)).toMatchObject({ outcome: "executed", queuedAt: 12, closedAt: 60 });
  });

  it("refuses to execute a pending upgrade", () => {
    const s = run([{ type: "propose", signer: "B", stolen: false }, { type: "advanceClock", hours: 24 }], proposed);
    expectRefused(s, { type: "execute" });
  });

  it("keeps only one upgrade in flight", () => {
    const pending = run([{ type: "propose", signer: "A", stolen: false }], proposed);
    expectRefused(pending, { type: "propose", signer: "B", stolen: false });
    expectRefused(queued, { type: "propose", signer: "I", stolen: false });
    expectRefused(pending, { type: "propose", signer: "I", stolen: true });
  });

  it("never queues an upgrade proposed with a single stolen key", () => {
    let s = run([{ type: "propose", signer: "A", stolen: true }], proposed);
    expect(s.upgrade).toMatchObject({ stolen: true, approvals: ["A"], queuedAt: null });
    s = expectRefused(s, { type: "approve", signer: "A" });
    s = run([{ type: "advanceClock", hours: 24 }, { type: "advanceClock", hours: 24 }, { type: "advanceClock", hours: 24 }], s);
    expect(s.upgrade?.queuedAt).toBeNull();
    expectRefused(s, { type: "execute" });
    expect(s.vault.version).toBe(1);
  });

  it("cancels only when 2 signers cancel", () => {
    const one = run([{ type: "cancel", signer: "A" }], queued);
    expect(one.upgrade?.cancels).toEqual(["A"]);
    expectRefused(one, { type: "cancel", signer: "A" });
    const two = run([{ type: "cancel", signer: "I" }], one);
    expect(two.upgrade).toBeNull();
    expect(two.vault.version).toBe(1);
    expect(two.history.at(-1)?.outcome).toBe("cancelled");

    const pending = run(
      [{ type: "propose", signer: "B", stolen: true }, { type: "cancel", signer: "A" }, { type: "cancel", signer: "I" }],
      proposed,
    );
    expect(pending.upgrade).toBeNull();
  });
});

describe("emergency pause", () => {
  const paused = run([{ type: "pause", signer: "I" }], queued);

  it("is triggered by any single signer and changes no logic or balance", () => {
    expect(paused.vault.paused).toBe(true);
    expect(paused.vault.version).toBe(queued.vault.version);
    expect(paused.vault.free).toBe(queued.vault.free);
    expect(paused.vault.reserved).toBe(queued.vault.reserved);
    expect(paused.upgrade).toEqual(queued.upgrade);
    expectRefused(paused, { type: "pause", signer: "A" });
  });

  it("blocks deposits and execution, even past ETA", () => {
    expectRefused(paused, { type: "deposit" });
    const pastEta = run([{ type: "advanceClock", hours: 24 }, { type: "advanceClock", hours: 24 }], paused);
    expectRefused(pastEta, { type: "execute" });
  });

  it("still allows withdrawing free funds", () => {
    const s = run([{ type: "withdraw" }], paused);
    expect(s.vault.free).toBe(0);
    expect(s.vault.withdrawn).toBe(15_000);
    expect(s.vault.reserved).toBe(10_000);
  });

  it("needs 2 distinct signers to unpause", () => {
    const one = run([{ type: "unpause", signer: "I" }], paused);
    expect(one.vault.paused).toBe(true);
    expectRefused(one, { type: "unpause", signer: "I" });
    const two = run([{ type: "unpause", signer: "A" }], one);
    expect(two.vault.paused).toBe(false);
    expect(two.vault.unpauseVotes).toEqual([]);
    const later = run([{ type: "advanceClock", hours: 48 }, { type: "execute" }], two);
    expect(later.vault.version).toBe(2);
  });

  it("refuses unpause when not paused", () => {
    expectRefused(queued, { type: "unpause", signer: "A" });
  });
});

describe("funder actions", () => {
  it("withdraws free funds and keeps reserved funds", () => {
    const s = run([{ type: "withdraw" }]);
    expect(s.vault).toMatchObject({ reserved: 10_000, free: 0, withdrawn: 15_000 });
    expectRefused(s, { type: "withdraw" });
  });

  it("marks a withdrawal during a queued upgrade as using the exit window", () => {
    const s = run([{ type: "withdraw" }], queued);
    expect(last(s).text).toContain("exit window");
  });

  it("deposits 5,000 as free funds", () => {
    const s = run([{ type: "deposit" }]);
    expect(s.vault.free).toBe(20_000);
    expect(s.vault.reserved).toBe(10_000);
  });
});

describe("refused actions", () => {
  it("log the actor, hour and reason without changing state", () => {
    const s = expectRefused(queued, { type: "execute" });
    expect(last(s)).toMatchObject({ hour: 12, actor: "Timelock", refusal: "Timelock: executable at hour 60, 48 h from now." });
  });
});

describe("mode switch", () => {
  it("restarts the vault from the sample data and keeps the clock", () => {
    const s = run([{ type: "pause", signer: "A" }, { type: "withdraw" }, { type: "setMode", mode: "today" }], queued);
    expect(s.upgrade).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.vault).toEqual(initialState.vault);
    expect(s.clock).toBe(12);
    expectRefused(s, { type: "setMode", mode: "today" });
  });
});

describe("Proof of Love vote", () => {
  const P1: ProposalId = "upgrade-delay";
  const P2: ProposalId = "spam-penalty";
  const cast = (proposal: ProposalId, votes: [Handle, Choice][]): Action[] =>
    votes.map(([handle, choice]) => ({ type: "castVote", proposal, handle, choice }));
  const close = (proposal: ProposalId): Action => ({ type: "closeVote", proposal });

  it("tips quorum on power, not on Points", () => {
    const below = run([...cast(P1, [["contributor-a", "for"], ["contributor-b", "against"]]), close(P1)]);
    expect(below.votes[P1].outcome).toBe("no-quorum");
    const t = powerTally(below.votes[P1].choices, "security");
    expect(t.cast).toBeLessThan(t.quorum);
    const newcomerTips = run([
      ...cast(P1, [["contributor-a", "for"], ["contributor-b", "against"], ["contributor-g", "abstain"]]),
      close(P1),
    ]);
    expect(newcomerTips.votes[P1].outcome).toBe("passed");
    expect(powerTally(newcomerTips.votes[P1].choices, "security").quorumMet).toBe(true);
  });

  it("passes when For outweighs Against and rejects otherwise", () => {
    const passed = run([...cast(P1, [["contributor-a", "for"], ["contributor-d", "against"]]), close(P1)]);
    expect(passed.votes[P1].outcome).toBe("passed");
    const rejected = run([...cast(P1, [["contributor-a", "against"], ["contributor-d", "for"]]), close(P1)]);
    expect(rejected.votes[P1].outcome).toBe("rejected");
    const noQuorum = run([close(P1)]);
    expect(noQuorum.votes[P1].outcome).toBe("no-quorum");
  });

  it("keeps each proposal's votes and state separate", () => {
    const s = run([...cast(P1, [["contributor-a", "for"], ["contributor-d", "for"]]), close(P1), ...cast(P2, [["contributor-e", "against"]])]);
    expect(s.votes[P1]).toMatchObject({ closed: true, outcome: "passed" });
    expect(s.votes[P2]).toMatchObject({ closed: false, outcome: null });
    expect(s.votes[P2].choices["contributor-e"]).toBe("against");
    expect(s.votes[P2].choices["contributor-a"]).toBe("none");
    expect(s.votes["review-cap"]).toEqual(emptyVote);
    expectRefused(s, { type: "castVote", proposal: P1, handle: "contributor-b", choice: "for" });

    const reopened = run([{ type: "reopenVote", proposal: P1 }], s);
    expect(reopened.votes[P1]).toEqual(emptyVote);
    expect(reopened.votes[P2]).toEqual(s.votes[P2]);
    expectRefused(reopened, { type: "reopenVote", proposal: P1 });
    expect(run([close(P1), close(P1)], reopened).log.at(-1)?.refusal).toEqual(expect.any(String));
  });

  it("allows adopt or veto only after a pass, once, and only on that proposal", () => {
    const passed = run([...cast(P1, [["contributor-a", "for"], ["contributor-d", "for"]]), close(P1)]);
    expectRefused(initialState, { type: "decide", proposal: P1, decision: "adopted" });
    expectRefused(passed, { type: "decide", proposal: P2, decision: "adopted" });
    const adopted = run([{ type: "decide", proposal: P1, decision: "adopted" }], passed);
    expect(adopted.votes[P1].decision).toBe("adopted");
    expectRefused(adopted, { type: "decide", proposal: P1, decision: "vetoed" });
    const vetoed = run([{ type: "decide", proposal: P1, decision: "vetoed" }], passed);
    expect(vetoed.votes[P1].decision).toBe("vetoed");

    const rejected = run([...cast(P1, [["contributor-a", "against"], ["contributor-d", "for"]]), close(P1)]);
    expectRefused(rejected, { type: "decide", proposal: P1, decision: "adopted" });
    const noQuorum = run([close(P1)]);
    expectRefused(noQuorum, { type: "decide", proposal: P1, decision: "vetoed" });
  });

  it("logs the power used and the 1 Point = 1 vote outcome at close", () => {
    const s = run([
      ...cast(P1, [["contributor-a", "for"], ["contributor-e", "against"], ["contributor-f", "abstain"]]),
      close(P1),
    ]);
    expect(s.log[0].text).toContain("power 20.62 (√425 effective Points)");
    expect(s.votes[P1].outcome).toBe("passed");
    expect(compareRules(s.votes[P1].choices, "security").pointsOutcome).toBe("rejected");
    expect(last(s).text).toContain("Passed (advisory). The same ballots under 1 Point = 1 vote: Rejected (advisory).");
  });
});

describe("reset", () => {
  it("returns to the sample data with a single log line", () => {
    const s = run([{ type: "ownerUpgrade" }, { type: "advanceClock", hours: 24 }, { type: "reset" }]);
    expect(withoutLog(s)).toEqual(withoutLog(initialState));
    expect(s.log).toHaveLength(1);
  });
});
