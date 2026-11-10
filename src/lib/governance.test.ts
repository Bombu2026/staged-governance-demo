import { describe, expect, it } from "vitest";
import {
  type Action,
  type State,
  etaOf,
  initialState,
  meetsQuorum,
  reduce,
  TIMELOCK_HOURS,
  TOTAL_POINTS,
} from "./governance";

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

describe("advisory contributor vote", () => {
  it("treats exactly 40% of Points as quorum", () => {
    expect(TOTAL_POINTS).toBe(1_100);
    expect(meetsQuorum(440, 1_100)).toBe(true);
    expect(meetsQuorum(439, 1_100)).toBe(false);
    const s = run([
      { type: "castVote", handle: "contributor-b", choice: "for" },
      { type: "castVote", handle: "contributor-d", choice: "against" },
      { type: "castVote", handle: "contributor-f", choice: "abstain" },
      { type: "closeVote" },
    ]);
    expect(s.vote.outcome).toBe("passed");
  });

  it("reports no quorum below 40%", () => {
    const s = run([{ type: "castVote", handle: "contributor-a", choice: "for" }, { type: "closeVote" }]);
    expect(s.vote.outcome).toBe("no-quorum");
  });

  it("rejects when against wins or ties", () => {
    const against = run([
      { type: "castVote", handle: "contributor-a", choice: "against" },
      { type: "castVote", handle: "contributor-b", choice: "for" },
      { type: "closeVote" },
    ]);
    expect(against.vote.outcome).toBe("rejected");
    const tie = run([
      { type: "castVote", handle: "contributor-c", choice: "for" },
      { type: "castVote", handle: "contributor-d", choice: "against" },
      { type: "castVote", handle: "contributor-e", choice: "against" },
      { type: "castVote", handle: "contributor-f", choice: "against" },
      { type: "castVote", handle: "contributor-b", choice: "abstain" },
      { type: "closeVote" },
    ]);
    expect(tie.vote.outcome).toBe("rejected");
  });

  it("freezes votes once closed and reopens to a clean slate", () => {
    const closed = run([{ type: "castVote", handle: "contributor-a", choice: "for" }, { type: "closeVote" }]);
    expectRefused(closed, { type: "castVote", handle: "contributor-b", choice: "for" });
    expectRefused(closed, { type: "closeVote" });
    const reopened = run([{ type: "reopenVote" }], closed);
    expect(reopened.vote).toEqual(initialState.vote);
    expectRefused(reopened, { type: "reopenVote" });
  });

  const passed = run([
    { type: "castVote", handle: "contributor-a", choice: "for" },
    { type: "castVote", handle: "contributor-b", choice: "against" },
    { type: "castVote", handle: "contributor-c", choice: "for" },
    { type: "closeVote" },
  ]);

  it("allows adopt or veto only after a passed vote, once", () => {
    expect(passed.vote.outcome).toBe("passed");
    const adopted = run([{ type: "decide", decision: "adopted" }], passed);
    expect(adopted.vote.decision).toBe("adopted");
    expectRefused(adopted, { type: "decide", decision: "vetoed" });
    const vetoed = run([{ type: "decide", decision: "vetoed" }], passed);
    expect(vetoed.vote.decision).toBe("vetoed");
  });

  it("refuses adopt or veto while open, after a rejection or without quorum", () => {
    expectRefused(initialState, { type: "decide", decision: "adopted" });
    const rejected = run([
      { type: "castVote", handle: "contributor-a", choice: "against" },
      { type: "closeVote" },
      { type: "reopenVote" },
      { type: "castVote", handle: "contributor-a", choice: "against" },
      { type: "castVote", handle: "contributor-b", choice: "for" },
      { type: "closeVote" },
    ]);
    expect(rejected.vote.outcome).toBe("rejected");
    expectRefused(rejected, { type: "decide", decision: "vetoed" });
    const noQuorum = run([{ type: "closeVote" }]);
    expect(noQuorum.vote.outcome).toBe("no-quorum");
    expectRefused(noQuorum, { type: "decide", decision: "adopted" });
  });
});

describe("reset", () => {
  it("returns to the sample data with a single log line", () => {
    const s = run([{ type: "ownerUpgrade" }, { type: "advanceClock", hours: 24 }, { type: "reset" }]);
    expect(withoutLog(s)).toEqual(withoutLog(initialState));
    expect(s.log).toHaveLength(1);
  });
});
