export type Domain = "security" | "vaults" | "scoring" | "moderation";
export type Choice = "for" | "against" | "abstain" | "none";
export type Outcome = "no-quorum" | "passed" | "rejected";

export const DOMAINS: readonly Domain[] = ["security", "vaults", "scoring", "moderation"];

export const DOMAIN_LABEL: Record<Domain, string> = {
  security: "Security",
  vaults: "Vaults & settlement",
  scoring: "Scoring & Points",
  moderation: "Rules & moderation",
};

// Sample parameters of this demo.
export const ON_DOMAIN_WEIGHT = 1;
export const OFF_DOMAIN_WEIGHT = 0.25;
export const QUORUM_PERCENT = 40;

type DomainPoints = Readonly<Record<Domain, number>>;

export const CONTRIBUTORS = [
  {
    handle: "contributor-a",
    profile: "Security specialist",
    points: { security: 380, vaults: 40, scoring: 20, moderation: 120 },
  },
  {
    handle: "contributor-b",
    profile: "Vaults & settlement specialist",
    points: { security: 140, vaults: 300, scoring: 10, moderation: 10 },
  },
  {
    handle: "contributor-c",
    profile: "Scoring specialist",
    points: { security: 10, vaults: 20, scoring: 380, moderation: 30 },
  },
  {
    handle: "contributor-d",
    profile: "Generalist",
    points: { security: 220, vaults: 240, scoring: 200, moderation: 240 },
  },
  {
    handle: "contributor-e",
    profile: "Prolific, almost all in vaults",
    points: { security: 0, vaults: 740, scoring: 10, moderation: 10 },
  },
  {
    handle: "contributor-f",
    profile: "Reviewer",
    points: { security: 50, vaults: 40, scoring: 60, moderation: 50 },
  },
  {
    handle: "contributor-g",
    profile: "Newcomer",
    points: { security: 0, vaults: 0, scoring: 10, moderation: 30 },
  },
] as const satisfies readonly { handle: string; profile: string; points: DomainPoints }[];

export type Contributor = (typeof CONTRIBUTORS)[number];
export type Handle = Contributor["handle"];
export type Ballots = Readonly<Record<Handle, Choice>>;

export const PROPOSALS = [
  {
    id: "upgrade-delay",
    n: 1,
    domain: "security",
    title: "Require two approvals and a 48 h delay for vault logic upgrades",
  },
  { id: "spam-penalty", n: 2, domain: "moderation", title: "Lower the Spam penalty from 30 to 20 Points" },
  { id: "review-cap", n: 3, domain: "scoring", title: "Cap review credit at the first three reviewers" },
] as const satisfies readonly { id: string; n: number; domain: Domain; title: string }[];

export type Proposal = (typeof PROPOSALS)[number];
export type ProposalId = Proposal["id"];

export const proposalOf = (id: ProposalId): Proposal => PROPOSALS.find((p) => p.id === id) ?? PROPOSALS[0];

export const contributorOf = (handle: Handle): Contributor =>
  CONTRIBUTORS.find((c) => c.handle === handle) ?? CONTRIBUTORS[0];

export const totalPoints = (c: Contributor) => DOMAINS.reduce((sum, d) => sum + c.points[d], 0);

export const domainWeight = (domain: Domain, proposalDomain: Domain) =>
  domain === proposalDomain ? ON_DOMAIN_WEIGHT : OFF_DOMAIN_WEIGHT;

export const effectivePoints = (c: Contributor, domain: Domain) =>
  DOMAINS.reduce((sum, d) => sum + c.points[d] * domainWeight(d, domain), 0);

export const votingPower = (c: Contributor, domain: Domain) => Math.sqrt(effectivePoints(c, domain));

export const formatPower = (n: number) => n.toFixed(2);

// Highest weight first; ties keep the sample order.
export const rankBy = (weight: (c: Contributor) => number): Contributor[] =>
  [...CONTRIBUTORS].sort((x, y) => weight(y) - weight(x));

export const rankOf = (order: readonly Contributor[], handle: Handle) => order.findIndex((c) => c.handle === handle) + 1;

export const rawRanking = () => rankBy(totalPoints);
export const powerRanking = (domain: Domain) => rankBy((c) => votingPower(c, domain));

export const meetsQuorum = (cast: number, total: number) => cast * 100 >= total * QUORUM_PERCENT - 1e-9;

export interface Tally {
  for: number;
  against: number;
  abstain: number;
  cast: number;
  total: number;
  quorum: number;
  quorumMet: boolean;
}

export function tallyWith(ballots: Ballots, weight: (c: Contributor) => number): Tally {
  const sums = { for: 0, against: 0, abstain: 0 };
  let total = 0;
  for (const c of CONTRIBUTORS) {
    const w = weight(c);
    total += w;
    const choice = ballots[c.handle];
    if (choice !== "none") sums[choice] += w;
  }
  const cast = sums.for + sums.against + sums.abstain;
  return { ...sums, cast, total, quorum: (total * QUORUM_PERCENT) / 100, quorumMet: meetsQuorum(cast, total) };
}

export const powerTally = (ballots: Ballots, domain: Domain) => tallyWith(ballots, (c) => votingPower(c, domain));
export const pointsTally = (ballots: Ballots) => tallyWith(ballots, totalPoints);

export function outcomeOf(t: Tally): Outcome {
  if (!t.quorumMet) return "no-quorum";
  return t.for > t.against ? "passed" : "rejected";
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  "no-quorum": "No quorum",
  passed: "Passed (advisory)",
  rejected: "Rejected (advisory)",
};

export interface RuleComparison {
  love: Tally;
  points: Tally;
  loveOutcome: Outcome;
  pointsOutcome: Outcome;
  differs: boolean;
}

// Same ballots counted twice: Proof of Love power on the proposal's domain, and 1 Point = 1 vote on total Points.
export function compareRules(ballots: Ballots, domain: Domain): RuleComparison {
  const love = powerTally(ballots, domain);
  const points = pointsTally(ballots);
  const loveOutcome = outcomeOf(love);
  const pointsOutcome = outcomeOf(points);
  return { love, points, loveOutcome, pointsOutcome, differs: loveOutcome !== pointsOutcome };
}
