// The simulation: a pure state machine with the same rules, refusal names and rounding as
// contracts/PooledFunding.sol, running on simulated days instead of block time and on sample people.

import {
  type Choice,
  type Points,
  type Tally,
  MAX_TITLE_BYTES,
  castPower,
  earlyVerdict,
  feeOf,
  finalVerdict,
  formatPower,
  formatUsdc,
  percentText,
  powerOf,
  quorumMet,
  splitByPoints,
  titleBytes,
  usdc,
} from "./math";

export const DOMAINS = ["apps", "data", "infra", "security"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABEL: Record<Domain, string> = {
  apps: "Apps & tools",
  data: "Data & AI",
  infra: "Infrastructure",
  security: "Security",
};

// Sample parameters of this demo.
export const VOTING_DAYS = 3;
export const DEFAULT_FUNDING_DAYS = 30;
export const MAX_FUNDING_DAYS = 365;

export const CONTRIBUTORS = [
  { handle: "contributor-a", profile: "Security specialist", points: [40, 20, 120, 380] },
  { handle: "contributor-b", profile: "Infrastructure specialist", points: [10, 10, 300, 140] },
  { handle: "contributor-c", profile: "Data & AI specialist", points: [20, 380, 30, 10] },
  { handle: "contributor-d", profile: "Generalist", points: [240, 200, 240, 220] },
  { handle: "contributor-e", profile: "Prolific in apps & tools", points: [740, 10, 10, 0] },
  { handle: "contributor-f", profile: "Reviewer", points: [40, 60, 50, 50] },
  { handle: "contributor-g", profile: "Newcomer", points: [0, 10, 30, 0] },
] as const satisfies readonly { handle: string; profile: string; points: Points }[];

export type Contributor = (typeof CONTRIBUTORS)[number];
export type Handle = Contributor["handle"];

export const FUNDERS = [
  { id: "company-a", profile: "Logistics software", wallet: 40_000 },
  { id: "company-b", profile: "Accounting firm", wallet: 30_000 },
  { id: "company-c", profile: "Online marketplace", wallet: 25_000 },
  { id: "company-d", profile: "Public agency", wallet: 20_000 },
] as const satisfies readonly { id: string; profile: string; wallet: number }[];

export type Funder = (typeof FUNDERS)[number];
export type FunderId = Funder["id"];

export type Kind = "request" | "proposal";
export type Status = "voting" | "not-listed" | "funding" | "expired" | "building" | "paid" | "closed";

export const KIND_LABEL: Record<Kind, string> = { request: "Request", proposal: "Community proposal" };

export const STATUS_LABEL: Record<Status, string> = {
  voting: "Listing vote",
  "not-listed": "Not listed",
  funding: "Funding",
  expired: "Missed its target",
  building: "Building",
  paid: "Paid out",
  closed: "Closed by vote",
};

export interface Ballot {
  choice: Choice;
  power: bigint;
}

export interface Payout {
  handle: Handle;
  points: bigint;
  amount: bigint;
}

export interface Pool {
  id: number;
  kind: Kind;
  domain: Domain;
  title: string;
  proposer: FunderId | Handle;
  // As stored. Read it through `statusOf`, which also reports a missed deadline.
  status: Status;
  target: bigint;
  pledged: bigint;
  refunded: bigint;
  fundingDays: number;
  proposedAt: number;
  deadline: number | null;
  launchedAt: number | null;
  // After a failed closure vote, the first day another one can be asked.
  closureCooldown: number;
  // 0 is the listing vote; each closure vote adds one.
  round: number;
  listing: Tally;
  closure: Tally | null;
  ballots: Record<number, Partial<Record<Handle, Ballot>>>;
  pledges: Partial<Record<FunderId, bigint>>;
  // Project Points from accepted work on this build.
  work: Partial<Record<Handle, number>>;
  batches: number;
  payouts: Payout[] | null;
  fee: bigint | null;
}

export interface LogEntry {
  seq: number;
  day: number;
  actor: string;
  text: string;
  refusal: string | null;
  // Present only on entries from the live testnet panel: wall-clock time and a link to the transaction.
  live?: { time: string; href: string | null };
}

export interface State {
  day: number;
  points: Record<Handle, Points>;
  wallets: Record<FunderId, bigint>;
  earned: Record<Handle, bigint>;
  fees: bigint;
  pools: Pool[];
  log: LogEntry[];
}

export type Action =
  | { type: "advance"; days: number }
  | {
      type: "propose";
      kind: "request";
      by: FunderId;
      title: string;
      domain: Domain;
      target: bigint;
      fundingDays: number;
      openingPledge: bigint;
    }
  | { type: "propose"; kind: "proposal"; by: Handle; title: string; domain: Domain; target: bigint; fundingDays: number }
  | { type: "vote"; pool: number; handle: Handle; choice: Choice }
  | { type: "finalize"; pool: number }
  | { type: "pledge"; pool: number; funder: FunderId; amount: bigint }
  | { type: "launch"; pool: number }
  | { type: "refund"; pool: number; funder: FunderId }
  | { type: "acceptWork"; pool: number }
  | { type: "payOut"; pool: number }
  | { type: "openClosure"; pool: number; by: FunderId | Handle }
  | { type: "reset" };

// Named like the contract's custom errors, so a refusal reads the same in the simulation and on-chain.
export type RefusalCode =
  | "BadParameters"
  | "UnknownPool"
  | "NoVoters"
  | "NotAContributor"
  | "OpeningPledgeRequired"
  | "InsufficientBalance"
  | "NoOpenVote"
  | "VotingEnded"
  | "NoVotingPower"
  | "VoteStillOpen"
  | "FundingClosed"
  | "PoolFull"
  | "NotFunding"
  | "TargetNotReached"
  | "RefundNotAvailable"
  | "NothingToRefund"
  | "NotBuilding"
  | "ClosureVoteOpen"
  | "ClosureCooldown"
  | "NotAParticipant"
  | "NoAcceptedWork";

export interface Refusal {
  code: RefusalCode;
  text: string;
}

const no = (code: RefusalCode, text: string): Refusal => ({ code, text });

export const domainIndex = (domain: Domain) => DOMAINS.indexOf(domain);
export const contributorOf = (handle: Handle): Contributor => CONTRIBUTORS.find((c) => c.handle === handle) ?? CONTRIBUTORS[0];
export const funderOf = (id: FunderId): Funder => FUNDERS.find((f) => f.id === id) ?? FUNDERS[0];
export const isFunder = (who: string): who is FunderId => FUNDERS.some((f) => f.id === who);
export const isContributor = (who: string): who is Handle => CONTRIBUTORS.some((c) => c.handle === who);

export const poolOf = (state: State, id: number): Pool | undefined => state.pools.find((p) => p.id === id);

export const powerIn = (state: State, handle: Handle, domain: Domain) => powerOf(state.points[handle], domainIndex(domain));

export const totalPowerIn = (state: State, domain: Domain) =>
  CONTRIBUTORS.reduce((sum, c) => sum + powerIn(state, c.handle, domain), 0n);

export function statusOf(pool: Pool, day: number): Status {
  if (pool.status === "funding" && pool.deadline !== null && day >= pool.deadline && pool.pledged < pool.target) return "expired";
  return pool.status;
}

// The vote that is open right now, if any: the listing vote, or a closure vote while building.
export function openTally(pool: Pool): Tally | null {
  if (pool.status === "voting") return pool.listing;
  if (pool.status === "building" && pool.closure?.open) return pool.closure;
  return null;
}

export const ballotsOf = (pool: Pool, round = pool.round) => pool.ballots[round] ?? {};
export const heldBy = (pool: Pool) => pool.pledged - pool.refunded;
export const workTotal = (pool: Pool) => Object.values(pool.work).reduce((sum, p) => sum + (p ?? 0), 0);

// Payees in sample order, which fixes who receives the rounding remainder.
export const workList = (pool: Pool): [Handle, bigint][] =>
  CONTRIBUTORS.filter((c) => (pool.work[c.handle] ?? 0) > 0).map((c) => [c.handle, BigInt(pool.work[c.handle] ?? 0)]);

// What a payout would send right now: the pool less the fee, split by share of project Points.
export function payoutPreview(pool: Pool): { fee: bigint; net: bigint; shares: Payout[] } {
  const fee = feeOf(pool.pledged);
  const net = pool.pledged - fee;
  const shares = splitByPoints(net, workList(pool)).map((s) => ({ handle: s.who, points: s.points, amount: s.amount }));
  return { fee, net, shares };
}

// The sample work the next "accept work" records: the strongest contributors on the pool's domain
// merge pull requests, and reviews that changed an outcome score too.
export function nextWork(state: State, pool: Pool): [Handle, number][] {
  const ranked = [...CONTRIBUTORS].sort((x, y) => {
    const diff = powerIn(state, y.handle, pool.domain) - powerIn(state, x.handle, pool.domain);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });
  const [first, second, third] = ranked.map((c) => c.handle);
  const reviewer: Handle = "contributor-f";
  const newcomer: Handle = "contributor-g";
  const batch: [Handle, number][] =
    pool.batches % 3 === 0
      ? [
          [first, 120],
          [second, 60],
        ]
      : pool.batches % 3 === 1
        ? [
            [third, 90],
            [first, 40],
            [reviewer, 30],
          ]
        : [
            [newcomer, 40],
            [second, 50],
            [reviewer, 30],
          ];
  const merged = new Map<Handle, number>();
  for (const [handle, points] of batch) merged.set(handle, (merged.get(handle) ?? 0) + points);
  return [...merged.entries()];
}

const emptyTally = (end: number, total: bigint): Tally => ({ end, open: true, for: 0n, against: 0n, abstain: 0n, total });

const tag = (pool: Pool) => `pool #${pool.id}`;
const CHOICE_LABEL: Record<Choice, string> = { for: "For", against: "Against", abstain: "Abstain" };

function proposalRefusal(state: State, action: Extract<Action, { type: "propose" }>): Refusal | null {
  const bytes = titleBytes(action.title.trim());
  if (bytes === 0) return no("BadParameters", "Give the build a title.");
  if (bytes > MAX_TITLE_BYTES) return no("BadParameters", `The title is too long (${bytes} of ${MAX_TITLE_BYTES} bytes).`);
  if (action.target <= 0n) return no("BadParameters", "The budget must be more than zero.");
  if (!Number.isInteger(action.fundingDays) || action.fundingDays < 1 || action.fundingDays > MAX_FUNDING_DAYS) {
    return no("BadParameters", `The funding window must be between 1 and ${MAX_FUNDING_DAYS} days.`);
  }
  if (totalPowerIn(state, action.domain) === 0n) return no("NoVoters", "No contributor has Points yet, so nobody could vote on the listing.");
  if (action.kind === "request") {
    if (action.openingPledge <= 0n) return no("OpeningPledgeRequired", "A request opens with a first pledge from the funder who needs it.");
    if (action.openingPledge > action.target) return no("BadParameters", "The first pledge cannot exceed the budget.");
    if (state.wallets[action.by] < action.openingPledge) {
      return no("InsufficientBalance", `${action.by} holds ${formatUsdc(state.wallets[action.by])} USDC, less than this first pledge.`);
    }
    return null;
  }
  if (powerIn(state, action.by, action.domain) === 0n) {
    return no("NotAContributor", "A community proposal comes from a contributor with Points from accepted work.");
  }
  return null;
}

export function refusal(state: State, action: Action): Refusal | null {
  switch (action.type) {
    case "reset":
      return null;
    case "advance":
      return Number.isInteger(action.days) && action.days > 0 ? null : no("BadParameters", "The clock only moves forward.");
    case "propose":
      return proposalRefusal(state, action);
  }

  const pool = poolOf(state, action.pool);
  if (!pool) return no("UnknownPool", `There is no pool #${action.pool}.`);
  const status = statusOf(pool, state.day);

  switch (action.type) {
    case "vote": {
      const tally = openTally(pool);
      if (!tally) return no("NoOpenVote", `No vote is open on ${tag(pool)}.`);
      if (state.day >= tally.end) return no("VotingEnded", `Voting ended on day ${tally.end}. Anyone can close the vote now.`);
      if (powerIn(state, action.handle, pool.domain) === 0n) return no("NoVotingPower", `${action.handle} has no Points, so no voting power.`);
      return null;
    }
    case "finalize": {
      const tally = openTally(pool);
      if (!tally) return no("NoOpenVote", `No vote is open on ${tag(pool)}.`);
      if (state.day < tally.end && earlyVerdict(tally) === "undecided") {
        return no("VoteStillOpen", `Voting runs until day ${tally.end}, and the result can still change. It closes early only once For holds more than half of all power, or Against at least half.`);
      }
      return null;
    }
    case "pledge": {
      if (status !== "funding") {
        return no(
          "FundingClosed",
          status === "voting"
            ? "Pledges open once contributors have voted to list the pool."
            : status === "expired"
              ? `The deadline passed on day ${pool.deadline} below the target. Pledges are refundable.`
              : `This pool no longer takes pledges (${STATUS_LABEL[status].toLowerCase()}).`,
        );
      }
      if (pool.pledged >= pool.target) return no("PoolFull", "The pool already holds its full target. It can launch.");
      if (action.amount <= 0n) return no("BadParameters", "A pledge must be more than zero.");
      const take = action.amount < pool.target - pool.pledged ? action.amount : pool.target - pool.pledged;
      if (state.wallets[action.funder] < take) {
        return no("InsufficientBalance", `${action.funder} holds ${formatUsdc(state.wallets[action.funder])} USDC, less than this pledge.`);
      }
      return null;
    }
    case "launch":
      if (status === "voting") return no("NotFunding", "The pool is not listed yet: contributors are still voting.");
      if (status === "expired") {
        return no("TargetNotReached", `The deadline passed with ${formatUsdc(pool.pledged)} of ${formatUsdc(pool.target)} USDC. This pool can only refund.`);
      }
      if (status !== "funding") return no("NotFunding", `This pool is not in its funding window (${STATUS_LABEL[status].toLowerCase()}).`);
      if (pool.pledged < pool.target) {
        return no("TargetNotReached", `All or nothing: ${formatUsdc(pool.pledged)} of ${formatUsdc(pool.target)} USDC pledged so far.`);
      }
      return null;
    case "refund": {
      if (status !== "not-listed" && status !== "expired" && status !== "closed") {
        return no(
          "RefundNotAvailable",
          status === "funding"
            ? `Pledges stay locked until the deadline on day ${pool.deadline}, so the total every funder sees is real.`
            : status === "voting"
              ? "The listing vote is still open. The first pledge is refunded if the pool is not listed."
              : status === "building"
                ? "The pool reached its target and launched. It is refunded only if a closure vote passes."
                : "This pool was paid out to contributors.",
        );
      }
      if ((pool.pledges[action.funder] ?? 0n) === 0n) return no("NothingToRefund", `${action.funder} has no pledge left in ${tag(pool)}.`);
      return null;
    }
    case "acceptWork":
      return status === "building" ? null : no("NotBuilding", "Work is accepted on a pool only after it has launched.");
    case "payOut":
      if (status !== "building") return no("NotBuilding", "A pool is paid out only after it has launched, and only once.");
      if (pool.closure?.open) return no("ClosureVoteOpen", "No payout while a closure vote is open.");
      if (workTotal(pool) === 0) return no("NoAcceptedWork", "No accepted work yet, so nobody has project Points to be paid on.");
      return null;
    case "openClosure": {
      if (status !== "building") return no("NotBuilding", "Only a launched pool that has not been paid yet can be closed by vote.");
      if (pool.closure?.open) return no("ClosureVoteOpen", "A closure vote is already open on this pool.");
      if (state.day < pool.closureCooldown) {
        return no("ClosureCooldown", `A closure vote just failed. Another one can be asked from day ${pool.closureCooldown}, so the pool can be paid meanwhile.`);
      }
      const funds = isFunder(action.by) && (pool.pledges[action.by] ?? 0n) > 0n;
      const contributes = isContributor(action.by) && powerIn(state, action.by, pool.domain) > 0n;
      if (!funds && !contributes) return no("NotAParticipant", "Only a funder of this pool or a contributor with Points can ask for a closure vote.");
      if (totalPowerIn(state, pool.domain) === 0n) return no("NoVoters", "No contributor has Points, so nobody could vote.");
      return null;
    }
  }
}

function actorOf(action: Action): string {
  switch (action.type) {
    case "reset":
      return "Demo";
    case "advance":
      return "Clock";
    case "propose":
    case "openClosure":
      return action.by;
    case "vote":
      return action.handle;
    case "finalize":
      return "Vote";
    case "pledge":
      return action.funder;
    case "launch":
      return "Pool";
    case "refund":
      return "Refund";
    case "acceptWork":
      return "Maintainers";
    case "payOut":
      return "Settlement";
  }
}

function attemptOf(state: State, action: Action): string {
  const pool = "pool" in action ? poolOf(state, action.pool) : undefined;
  const on = pool ? tag(pool) : "pool" in action ? `pool #${action.pool}` : "";
  switch (action.type) {
    case "reset":
      return "Reset the demo";
    case "advance":
      return `Advance the clock by ${action.days} days`;
    case "propose":
      return action.kind === "request"
        ? `Open a request for ${formatUsdc(action.target)} USDC with a first pledge of ${formatUsdc(action.openingPledge)}`
        : `Propose a build for ${formatUsdc(action.target)} USDC`;
    case "vote":
      return `Vote ${CHOICE_LABEL[action.choice]} on ${on}`;
    case "finalize":
      return `Close the vote on ${on}`;
    case "pledge":
      return `Pledge ${formatUsdc(action.amount)} USDC to ${on}`;
    case "launch":
      return `Launch ${on}`;
    case "refund":
      return `Refund ${action.funder} from ${on}`;
    case "acceptWork":
      return `Accept work on ${on}`;
    case "payOut":
      return `Pay out ${on}`;
    case "openClosure":
      return `Ask for a closure vote on ${on}`;
  }
}

function logged(state: State, actor: string, text: string, refused: string | null = null): State {
  const entry: LogEntry = { seq: state.log.length + 1, day: state.day, actor, text, refusal: refused };
  return { ...state, log: [...state.log, entry] };
}

const replacePool = (state: State, pool: Pool): State => ({ ...state, pools: state.pools.map((p) => (p.id === pool.id ? pool : p)) });

function tallyLine(t: Tally): string {
  const share = percentText(castPower(t), t.total);
  return `For ${formatPower(t.for)}, against ${formatPower(t.against)}, abstain ${formatPower(t.abstain)} of ${formatPower(t.total)} power (${share}% cast, ${quorumMet(t) ? "quorum met" : "below quorum"})`;
}

function apply(state: State, action: Action): [State, string] {
  switch (action.type) {
    case "reset":
      return [initialState, "Reset to the sample pools."];
    case "advance": {
      const day = state.day + action.days;
      const missed = state.pools.filter((p) => statusOf(p, state.day) === "funding" && statusOf(p, day) === "expired");
      const note = missed.map((p) => ` Pool #${p.id} missed its target: its pledges are refundable.`).join("");
      return [{ ...state, day }, `Advanced ${action.days} ${action.days === 1 ? "day" : "days"} to day ${day}.${note}`];
    }
    case "propose": {
      const id = state.pools.length + 1;
      const opening = action.kind === "request" ? action.openingPledge : 0n;
      const pool: Pool = {
        id,
        kind: action.kind,
        domain: action.domain,
        title: action.title.trim(),
        proposer: action.by,
        status: "voting",
        target: action.target,
        pledged: opening,
        refunded: 0n,
        fundingDays: action.fundingDays,
        proposedAt: state.day,
        deadline: null,
        launchedAt: null,
        closureCooldown: 0,
        round: 0,
        listing: emptyTally(state.day + VOTING_DAYS, totalPowerIn(state, action.domain)),
        closure: null,
        ballots: { 0: {} },
        pledges: action.kind === "request" ? { [action.by]: opening } : {},
        work: {},
        batches: 0,
        payouts: null,
        fee: null,
      };
      const wallets = action.kind === "request" ? { ...state.wallets, [action.by]: state.wallets[action.by] - opening } : state.wallets;
      const text =
        action.kind === "request"
          ? `Opened request #${id} "${pool.title}" for ${formatUsdc(pool.target)} USDC with a first pledge of ${formatUsdc(opening)}. Contributors vote on listing it until day ${pool.listing.end}.`
          : `Proposed pool #${id} "${pool.title}" for ${formatUsdc(pool.target)} USDC, with no money down. Contributors vote on listing it until day ${pool.listing.end}.`;
      return [{ ...state, wallets, pools: [...state.pools, pool] }, text];
    }
  }

  const pool = poolOf(state, action.pool);
  if (!pool) return [state, ""];

  switch (action.type) {
    case "vote": {
      const tally = openTally(pool);
      if (!tally) return [state, ""];
      const power = powerIn(state, action.handle, pool.domain);
      const previous = ballotsOf(pool)[action.handle];
      const next: Tally = { ...tally };
      if (previous) next[previous.choice] -= previous.power;
      next[action.choice] += power;
      const ballots = { ...pool.ballots, [pool.round]: { ...ballotsOf(pool), [action.handle]: { choice: action.choice, power } } };
      const updated: Pool = pool.status === "voting" ? { ...pool, listing: next, ballots } : { ...pool, closure: next, ballots };
      const what = pool.status === "voting" ? "the listing" : "the closure";
      return [
        replacePool(state, updated),
        `Voted ${CHOICE_LABEL[action.choice]} on ${what} of ${tag(pool)} with power ${formatPower(power)}${previous ? ` (was ${CHOICE_LABEL[previous.choice]})` : ""}.`,
      ];
    }
    case "finalize": {
      const tally = openTally(pool);
      if (!tally) return [state, ""];
      const early = state.day < tally.end;
      const passed = (early ? earlyVerdict(tally) : finalVerdict(tally)) === "passed";
      const closed: Tally = { ...tally, open: false };
      const how = early ? " Closed early: the result could no longer change." : "";
      if (pool.status === "voting") {
        const deadline = state.day + pool.fundingDays;
        const updated: Pool = passed ? { ...pool, listing: closed, status: "funding", deadline } : { ...pool, listing: closed, status: "not-listed" };
        const result = passed
          ? `Listed: pledges are open until day ${deadline}.`
          : `Not listed.${pool.pledged > 0n ? " The first pledge is refundable." : ""}`;
        return [replacePool(state, updated), `Listing vote on ${tag(pool)}: ${tallyLine(tally)}.${how} ${result}`];
      }
      const updated: Pool = passed ? { ...pool, closure: closed, status: "closed" } : { ...pool, closure: closed, closureCooldown: state.day + VOTING_DAYS };
      const result = passed
        ? "Closed: every pledge is refundable in full."
        : `The build continues. No new closure vote before day ${state.day + VOTING_DAYS}.`;
      return [replacePool(state, updated), `Closure vote on ${tag(pool)}: ${tallyLine(tally)}.${how} ${result}`];
    }
    case "pledge": {
      const room = pool.target - pool.pledged;
      const take = action.amount < room ? action.amount : room;
      const pledged = pool.pledged + take;
      const updated: Pool = { ...pool, pledged, pledges: { ...pool.pledges, [action.funder]: (pool.pledges[action.funder] ?? 0n) + take } };
      const capped = take < action.amount ? " Only what was still missing was taken." : "";
      const full = pledged === pool.target ? " The pool is full and can launch." : "";
      return [
        replacePool({ ...state, wallets: { ...state.wallets, [action.funder]: state.wallets[action.funder] - take } }, updated),
        `Pledged ${formatUsdc(take)} USDC to ${tag(pool)}: ${formatUsdc(pledged)} of ${formatUsdc(pool.target)}.${capped}${full}`,
      ];
    }
    case "launch": {
      const funders = Object.values(pool.pledges).filter((amount) => (amount ?? 0n) > 0n).length;
      return [
        replacePool(state, { ...pool, status: "building", launchedAt: state.day }),
        `Launched ${tag(pool)}: ${formatUsdc(pool.pledged)} USDC from ${funders} ${funders === 1 ? "funder" : "funders"} is now the build's contributor pool.`,
      ];
    }
    case "refund": {
      const amount = pool.pledges[action.funder] ?? 0n;
      const status = statusOf(pool, state.day);
      const why = status === "not-listed" ? "it was not listed" : status === "closed" ? "it was closed by vote" : "it missed its target";
      const updated: Pool = { ...pool, status, refunded: pool.refunded + amount, pledges: { ...pool.pledges, [action.funder]: 0n } };
      return [
        replacePool({ ...state, wallets: { ...state.wallets, [action.funder]: state.wallets[action.funder] + amount } }, updated),
        `Refunded ${formatUsdc(amount)} USDC to ${action.funder} from ${tag(pool)}, because ${why}.`,
      ];
    }
    case "acceptWork": {
      const batch = nextWork(state, pool);
      const d = domainIndex(pool.domain);
      const work = { ...pool.work };
      const points = { ...state.points };
      for (const [handle, earned] of batch) {
        work[handle] = (work[handle] ?? 0) + earned;
        const book = [...points[handle]] as [number, number, number, number];
        book[d] += earned;
        points[handle] = book;
      }
      const list = batch.map(([handle, earned]) => `${handle} +${earned}`).join(", ");
      return [
        replacePool({ ...state, points }, { ...pool, work, batches: pool.batches + 1 }),
        `Accepted work on ${tag(pool)}: ${list} Points. The same Points count toward their voting power in ${DOMAIN_LABEL[pool.domain]}.`,
      ];
    }
    case "payOut": {
      const { fee, net, shares } = payoutPreview(pool);
      const earned = { ...state.earned };
      for (const share of shares) earned[share.handle] += share.amount;
      return [
        replacePool({ ...state, earned, fees: state.fees + fee }, { ...pool, status: "paid", payouts: shares, fee }),
        `Paid ${tag(pool)}: ${formatUsdc(net)} USDC to ${shares.length} ${shares.length === 1 ? "contributor" : "contributors"} by share of project Points, and a ${formatUsdc(fee)} USDC fee (2%).`,
      ];
    }
    case "openClosure": {
      const round = pool.round + 1;
      const closure = emptyTally(state.day + VOTING_DAYS, totalPowerIn(state, pool.domain));
      return [
        replacePool(state, { ...pool, round, closure, ballots: { ...pool.ballots, [round]: {} } }),
        `Asked to close ${tag(pool)} before it is paid. Contributors vote until day ${closure.end}; if it passes, every pledge is refunded.`,
      ];
    }
  }
}

export function reduce(state: State, action: Action): State {
  const why = refusal(state, action);
  if (why) return logged(state, actorOf(action), attemptOf(state, action), `${why.code}: ${why.text}`);
  const [next, text] = apply(state, action);
  return logged(next, actorOf(action), text);
}

// Before any pool exists: the sample people with their starting Points and wallets.
export const emptyState: State = {
  day: 0,
  points: Object.fromEntries(CONTRIBUTORS.map((c) => [c.handle, c.points])) as Record<Handle, Points>,
  wallets: Object.fromEntries(FUNDERS.map((f) => [f.id, usdc(f.wallet)])) as Record<FunderId, bigint>,
  earned: Object.fromEntries(CONTRIBUTORS.map((c) => [c.handle, 0n])) as Record<Handle, bigint>,
  fees: 0n,
  pools: [],
  log: [],
};

// The two sample pools, one per direction, built by replaying real actions so they obey every rule:
// a listed request with its first pledge, and a community proposal whose listing vote has not started.
const SEED: Action[] = [
  {
    type: "propose",
    kind: "request",
    by: "company-a",
    title: "Open-source e-invoicing engine for the EU formats",
    domain: "apps",
    target: usdc(50_000),
    fundingDays: DEFAULT_FUNDING_DAYS,
    openingPledge: usdc(10_000),
  },
  { type: "vote", pool: 1, handle: "contributor-e", choice: "for" },
  { type: "vote", pool: 1, handle: "contributor-d", choice: "for" },
  { type: "vote", pool: 1, handle: "contributor-a", choice: "for" },
  { type: "vote", pool: 1, handle: "contributor-f", choice: "for" },
  { type: "vote", pool: 1, handle: "contributor-c", choice: "against" },
  { type: "finalize", pool: 1 },
  {
    type: "propose",
    kind: "proposal",
    by: "contributor-b",
    title: "Open-source rebuild of a hosted feature-flag service",
    domain: "infra",
    target: usdc(30_000),
    fundingDays: DEFAULT_FUNDING_DAYS,
  },
];

export const initialState: State = { ...SEED.reduce(reduce, emptyState), log: [] };
