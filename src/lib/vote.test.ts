import { describe, expect, it } from "vitest";
import {
  type Ballots,
  type Choice,
  type Handle,
  CONTRIBUTORS,
  compareRules,
  contributorOf,
  effectivePoints,
  meetsQuorum,
  outcomeOf,
  pointsTally,
  powerRanking,
  powerTally,
  rankOf,
  rawRanking,
  totalPoints,
  votingPower,
} from "./vote";

const ballots = (votes: Partial<Record<Handle, Choice>>): Ballots =>
  Object.fromEntries(CONTRIBUTORS.map((c) => [c.handle, votes[c.handle] ?? "none"])) as Ballots;

const handles = (order: readonly { handle: Handle }[]) => order.map((c) => c.handle);

describe("sample contributors", () => {
  it("span roughly 40 to 900 Points, with the generalist on top", () => {
    const totals = CONTRIBUTORS.map(totalPoints);
    expect(Math.min(...totals)).toBe(40);
    expect(Math.max(...totals)).toBe(900);
    expect(rawRanking()[0].handle).toBe("contributor-d");
  });
});

describe("effective Points and power", () => {
  const specialist = contributorOf("contributor-a");

  it("counts the proposal's domain at 1.0 and the others at 0.25", () => {
    expect(effectivePoints(specialist, "security")).toBe(380 + (40 + 20 + 120) * 0.25);
    expect(effectivePoints(specialist, "security")).toBe(425);
    expect(effectivePoints(specialist, "scoring")).toBe(20 + (380 + 40 + 120) * 0.25);
    expect(effectivePoints(specialist, "scoring")).toBe(155);
  });

  it("takes the square root of effective Points", () => {
    expect(votingPower(specialist, "security")).toBeCloseTo(Math.sqrt(425), 12);
    expect(votingPower(specialist, "security")).toBeCloseTo(20.6155, 4);
    expect(votingPower(specialist, "scoring")).toBeCloseTo(12.4499, 4);
    expect(votingPower(specialist, "security")).toBeGreaterThan(votingPower(specialist, "scoring"));
  });

  it("makes four times the effective Points worth twice the power", () => {
    const newcomer = contributorOf("contributor-g");
    expect(effectivePoints(newcomer, "security")).toBe(10);
    expect(votingPower(newcomer, "security") * 2).toBeCloseTo(Math.sqrt(40), 12);
  });
});

describe("ranking by power", () => {
  it("differs between two proposals for the same contributors", () => {
    const security = powerRanking("security");
    const scoring = powerRanking("scoring");
    expect(handles(security)).not.toEqual(handles(scoring));
    expect(rankOf(rawRanking(), "contributor-a")).toBe(3);
    expect(rankOf(security, "contributor-a")).toBe(1);
    expect(rankOf(scoring, "contributor-a")).toBe(4);
    expect(rankOf(rawRanking(), "contributor-c")).toBe(5);
    expect(rankOf(scoring, "contributor-c")).toBe(1);
    expect(rankOf(security, "contributor-e")).toBe(4);
  });
});

describe("quorum on power", () => {
  it("counts exactly 40% as met", () => {
    expect(meetsQuorum(40, 100)).toBe(true);
    expect(meetsQuorum(39.99, 100)).toBe(false);
    const total = powerTally(ballots({}), "security").total;
    expect(meetsQuorum((total * 40) / 100, total)).toBe(true);
    expect(meetsQuorum((total * 40) / 100 - 0.001, total)).toBe(false);
  });

  it("is reached on a proposal's own power total", () => {
    const below = powerTally(ballots({ "contributor-a": "for", "contributor-b": "against" }), "security");
    expect(below.quorum).toBeCloseTo(below.total * 0.4, 12);
    expect(below.cast).toBeCloseTo(35.45, 2);
    expect(below.quorum).toBeCloseTo(36.93, 2);
    expect(below.quorumMet).toBe(false);
    const above = powerTally(
      ballots({ "contributor-a": "for", "contributor-b": "against", "contributor-g": "abstain" }),
      "security",
    );
    expect(above.quorumMet).toBe(true);
  });
});

describe("outcome", () => {
  const met = { cast: 10, total: 10, quorum: 4, quorumMet: true, abstain: 0 };

  it("passes when For outweighs Against", () => {
    expect(outcomeOf({ ...met, for: 6, against: 4 })).toBe("passed");
  });

  it("rejects when Against wins or ties", () => {
    expect(outcomeOf({ ...met, for: 4, against: 6 })).toBe("rejected");
    expect(outcomeOf({ ...met, for: 5, against: 5 })).toBe("rejected");
  });

  it("reports no quorum before anything else", () => {
    expect(outcomeOf({ ...met, for: 3, against: 0, cast: 3, quorumMet: false })).toBe("no-quorum");
  });

  it("rejects a real tie on Points", () => {
    const t = pointsTally(
      ballots({ "contributor-a": "for", "contributor-f": "for", "contributor-e": "against" }),
    );
    expect(t.for).toBe(760);
    expect(t.against).toBe(760);
    expect(t.quorumMet).toBe(true);
    expect(outcomeOf(t)).toBe("rejected");
  });
});

describe("1 Point = 1 vote comparison", () => {
  it("can disagree with Proof of Love on the same ballots", () => {
    const b = ballots({ "contributor-a": "for", "contributor-e": "against", "contributor-f": "abstain" });
    const cmp = compareRules(b, "security");
    expect(cmp.points).toMatchObject({ for: 560, against: 760, abstain: 200, total: 3_360, quorum: 1_344, quorumMet: true });
    expect(cmp.pointsOutcome).toBe("rejected");
    expect(cmp.love.for).toBeCloseTo(20.62, 2);
    expect(cmp.love.against).toBeCloseTo(13.78, 2);
    expect(cmp.love.quorumMet).toBe(true);
    expect(cmp.loveOutcome).toBe("passed");
    expect(cmp.differs).toBe(true);
  });

  it("reports agreement when both rules give the same outcome", () => {
    const cmp = compareRules(ballots({ "contributor-d": "for", "contributor-a": "for" }), "security");
    expect(cmp.loveOutcome).toBe("passed");
    expect(cmp.pointsOutcome).toBe("passed");
    expect(cmp.differs).toBe(false);
  });
});
