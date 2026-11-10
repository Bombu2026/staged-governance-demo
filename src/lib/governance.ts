import {
  type Ballots,
  type Choice,
  type Handle,
  type Outcome,
  type ProposalId,
  CONTRIBUTORS,
  DOMAIN_LABEL,
  OUTCOME_LABEL,
  PROPOSALS,
  compareRules,
  contributorOf,
  effectivePoints,
  formatPower,
  proposalOf,
  votingPower,
} from "./vote";

export type Mode = "today" | "proposed";
export type SignerId = "A" | "B" | "I";
export type Decision = "adopted" | "vetoed";

export const SIGNERS: readonly { id: SignerId; label: string }[] = [
  { id: "A", label: "Founder key A" },
  { id: "B", label: "Founder key B" },
  { id: "I", label: "Independent signer" },
];
export const THRESHOLD = 2;
export const TIMELOCK_HOURS = 48;
export const DEPOSIT_AMOUNT = 5_000;
export const SAMPLE_RESERVED = 10_000;
export const SAMPLE_FREE = 15_000;

export const MODE_LABEL: Record<Mode, string> = {
  today: "Today: single key",
  proposed: "Proposed: 2-of-3 multisig + 48 h timelock",
};

export interface Upgrade {
  to: number;
  proposer: SignerId;
  stolen: boolean;
  approvals: SignerId[];
  cancels: SignerId[];
  proposedAt: number;
  queuedAt: number | null;
}

export interface UpgradeRecord {
  from: number;
  to: number;
  by: "owner" | SignerId;
  stolen: boolean;
  mode: Mode;
  queuedAt: number | null;
  closedAt: number;
  outcome: "executed" | "cancelled";
}

export interface Vault {
  reserved: number;
  free: number;
  withdrawn: number;
  version: number;
  compromised: boolean;
  paused: boolean;
  pausedBy: SignerId | null;
  unpauseVotes: SignerId[];
}

// One ballot box per sample proposal; switching proposals in the UI keeps each one's votes and state.
export interface Vote {
  choices: Ballots;
  closed: boolean;
  outcome: Outcome | null;
  decision: Decision | null;
}

export interface LogEntry {
  seq: number;
  hour: number;
  actor: string;
  text: string;
  refusal: string | null;
  // Present only on entries from the live devnet panel: wall-clock time and the transaction signature, if any.
  devnet?: { time: string; signature: string | null };
}

export interface State {
  clock: number;
  mode: Mode;
  vault: Vault;
  upgrade: Upgrade | null;
  history: UpgradeRecord[];
  votes: Record<ProposalId, Vote>;
  log: LogEntry[];
}

export type Action =
  | { type: "setMode"; mode: Mode }
  | { type: "advanceClock"; hours: number }
  | { type: "ownerUpgrade" }
  | { type: "stealOwnerKey" }
  | { type: "propose"; signer: SignerId; stolen: boolean }
  | { type: "approve"; signer: SignerId }
  | { type: "cancel"; signer: SignerId }
  | { type: "execute" }
  | { type: "pause"; signer: SignerId }
  | { type: "unpause"; signer: SignerId }
  | { type: "withdraw" }
  | { type: "deposit" }
  | { type: "castVote"; proposal: ProposalId; handle: Handle; choice: Choice }
  | { type: "closeVote"; proposal: ProposalId }
  | { type: "decide"; proposal: ProposalId; decision: Decision }
  | { type: "reopenVote"; proposal: ProposalId }
  | { type: "reset" };

const emptyChoices = Object.fromEntries(CONTRIBUTORS.map((c) => [c.handle, "none"])) as Record<Handle, Choice>;
export const emptyVote: Vote = { choices: emptyChoices, closed: false, outcome: null, decision: null };
const emptyVotes = Object.fromEntries(PROPOSALS.map((p) => [p.id, emptyVote])) as Record<ProposalId, Vote>;

export const initialState: State = {
  clock: 0,
  mode: "today",
  vault: {
    reserved: SAMPLE_RESERVED,
    free: SAMPLE_FREE,
    withdrawn: 0,
    version: 1,
    compromised: false,
    paused: false,
    pausedBy: null,
    unpauseVotes: [],
  },
  upgrade: null,
  history: [],
  votes: emptyVotes,
  log: [],
};

const usd = new Intl.NumberFormat("en-US");
export const formatAmount = (n: number) => usd.format(n);

export const signerLabel = (id: SignerId) => SIGNERS.find((s) => s.id === id)?.label ?? id;

export const etaOf = (upgrade: Upgrade | null) =>
  upgrade && upgrade.queuedAt !== null ? upgrade.queuedAt + TIMELOCK_HOURS : null;

export const statusOf = (upgrade: Upgrade) => (upgrade.queuedAt === null ? "pending" : "queued");

const proposalTag = (id: ProposalId) => {
  const p = proposalOf(id);
  return `proposal ${p.n} (${DOMAIN_LABEL[p.domain]})`;
};

const CHOICE_LABEL: Record<Choice, string> = {
  for: "For",
  against: "Against",
  abstain: "Abstain",
  none: "not voted",
};

export function refusal(state: State, action: Action): string | null {
  const { vault, upgrade, mode, votes } = state;
  switch (action.type) {
    case "setMode":
      return action.mode === mode ? "Already in this mode." : null;
    case "advanceClock":
      return action.hours > 0 ? null : "The clock only moves forward.";
    case "ownerUpgrade":
    case "stealOwnerKey":
      return mode === "today" ? null : "No single key can upgrade the vault in the proposed setup.";
    case "propose":
      if (mode !== "proposed") return "Today's setup has no proposals: the owner key upgrades directly.";
      if (upgrade) return `Only one upgrade in flight at a time: v${upgrade.to} is ${statusOf(upgrade)}.`;
      return null;
    case "approve":
      if (!upgrade) return "There is no upgrade to approve.";
      if (upgrade.queuedAt !== null) return "Already queued: approvals are complete.";
      if (upgrade.approvals.includes(action.signer)) return "This key already approved.";
      return null;
    case "cancel":
      if (!upgrade) return "There is no upgrade to cancel.";
      if (upgrade.cancels.includes(action.signer)) return "This key already voted to cancel.";
      return null;
    case "execute": {
      if (!upgrade) return "There is no upgrade to execute.";
      if (upgrade.queuedAt === null)
        return `Needs ${THRESHOLD} approvals to queue (has ${upgrade.approvals.length}).`;
      if (vault.paused) return "The vault is paused: upgrades cannot execute until 2 signers unpause.";
      const eta = upgrade.queuedAt + TIMELOCK_HOURS;
      if (state.clock < eta) return `Timelock: executable at hour ${eta}, ${eta - state.clock} h from now.`;
      return null;
    }
    case "pause":
      if (mode !== "proposed") return "Today's setup has no pause.";
      if (vault.paused) return "Already paused.";
      return null;
    case "unpause":
      if (!vault.paused) return "The vault is not paused.";
      if (vault.unpauseVotes.includes(action.signer)) return "This key already voted to unpause.";
      return null;
    case "withdraw":
      if (vault.compromised) return "Too late: the live escrow logic is attacker-written, so withdrawals run their code.";
      return vault.free > 0 ? null : "No free funds left to withdraw.";
    case "deposit":
      if (vault.paused) return "Deposits are blocked while the vault is paused.";
      if (vault.compromised) return "The live escrow logic is attacker-written: this demo refuses new deposits into it.";
      return null;
    case "castVote": {
      const vote = votes[action.proposal];
      if (vote.closed) return `The vote on proposal ${proposalOf(action.proposal).n} is closed. Reopen it to change votes.`;
      if (vote.choices[action.handle] === action.choice) return "No change: this vote is already recorded.";
      return null;
    }
    case "closeVote":
      return votes[action.proposal].closed ? `The vote on proposal ${proposalOf(action.proposal).n} is already closed.` : null;
    case "decide": {
      const vote = votes[action.proposal];
      if (!vote.closed) return "Close the vote first.";
      if (vote.outcome !== "passed") return "Moderators adopt or veto only after a passed vote.";
      if (vote.decision) return `Moderators already ${vote.decision} this proposal.`;
      return null;
    }
    case "reopenVote":
      return votes[action.proposal].closed ? null : `The vote on proposal ${proposalOf(action.proposal).n} is already open.`;
    case "reset":
      return null;
  }
}

function actorOf(action: Action): string {
  switch (action.type) {
    case "setMode":
    case "reopenVote":
    case "reset":
      return "Demo";
    case "advanceClock":
      return "Clock";
    case "ownerUpgrade":
      return "Owner key";
    case "stealOwnerKey":
      return "Attacker (stolen owner key)";
    case "propose":
      return action.stolen ? `Attacker (stolen ${signerLabel(action.signer)})` : signerLabel(action.signer);
    case "approve":
    case "cancel":
    case "pause":
    case "unpause":
      return signerLabel(action.signer);
    case "execute":
      return "Timelock";
    case "withdraw":
    case "deposit":
      return "Funder";
    case "castVote":
      return action.handle;
    case "closeVote":
      return "Vote";
    case "decide":
      return "Moderator";
  }
}

function attemptOf(action: Action): string {
  switch (action.type) {
    case "setMode":
      return `Switch to "${MODE_LABEL[action.mode]}"`;
    case "advanceClock":
      return `Advance the clock by ${action.hours} h`;
    case "ownerUpgrade":
    case "stealOwnerKey":
      return "Upgrade escrow logic with a single key";
    case "propose":
      return "Propose an upgrade";
    case "approve":
      return "Approve the upgrade";
    case "cancel":
      return "Vote to cancel the upgrade";
    case "execute":
      return "Execute the upgrade";
    case "pause":
      return "Pause the vault";
    case "unpause":
      return "Vote to unpause the vault";
    case "withdraw":
      return "Withdraw free funds";
    case "deposit":
      return `Deposit ${formatAmount(DEPOSIT_AMOUNT)} USDC`;
    case "castVote":
      return `Vote ${CHOICE_LABEL[action.choice]} on ${proposalTag(action.proposal)}`;
    case "closeVote":
      return `Close the vote on ${proposalTag(action.proposal)}`;
    case "decide":
      return `${action.decision === "adopted" ? "Adopt" : "Veto"} ${proposalTag(action.proposal)}`;
    case "reopenVote":
      return `Reopen the vote on ${proposalTag(action.proposal)}`;
    case "reset":
      return "Reset the demo";
  }
}

function logged(state: State, actor: string, text: string, refused: string | null = null): State {
  const entry: LogEntry = { seq: state.log.length + 1, hour: state.clock, actor, text, refusal: refused };
  return { ...state, log: [...state.log, entry] };
}

function apply(state: State, action: Action): [State, string] {
  const { vault, upgrade, clock } = state;
  switch (action.type) {
    case "setMode":
      return [
        { ...state, mode: action.mode, upgrade: null, history: [], vault: initialState.vault },
        `Switched to "${MODE_LABEL[action.mode]}". The vault restarts from the sample balances at v1 so both setups face the same scenario.`,
      ];
    case "advanceClock": {
      const next = clock + action.hours;
      const eta = etaOf(upgrade);
      const ready = eta !== null && clock < eta && next >= eta ? ` Upgrade to v${upgrade?.to} is now executable.` : "";
      return [{ ...state, clock: next }, `Advanced ${action.hours} h to hour ${next}.${ready}`];
    }
    case "ownerUpgrade":
    case "stealOwnerKey": {
      const stolen = action.type === "stealOwnerKey";
      const to = vault.version + 1;
      const record: UpgradeRecord = {
        from: vault.version,
        to,
        by: "owner",
        stolen,
        mode: "today",
        queuedAt: clock,
        closedAt: clock,
        outcome: "executed",
      };
      const text = stolen
        ? `Upgraded escrow logic v${vault.version} → v${to} with the stolen owner key. Live immediately: funders had no window to react.`
        : `Upgraded escrow logic v${vault.version} → v${to}. Live immediately, with 0 h notice to funders.`;
      return [
        { ...state, vault: { ...vault, version: to, compromised: stolen }, history: [...state.history, record] },
        text,
      ];
    }
    case "propose": {
      const to = vault.version + 1;
      const next: Upgrade = {
        to,
        proposer: action.signer,
        stolen: action.stolen,
        approvals: [action.signer],
        cancels: [],
        proposedAt: clock,
        queuedAt: null,
      };
      const text = action.stolen
        ? `Proposed upgrade v${vault.version} → v${to} with one stolen key. Approvals 1 of ${THRESHOLD}: one key cannot queue it.`
        : `Proposed upgrade v${vault.version} → v${to}. Approvals 1 of ${THRESHOLD}.`;
      return [{ ...state, upgrade: next }, text];
    }
    case "approve": {
      if (!upgrade) return [state, ""];
      const approvals = [...upgrade.approvals, action.signer];
      const queues = approvals.length >= THRESHOLD;
      const next: Upgrade = { ...upgrade, approvals, queuedAt: queues ? clock : null };
      const text = queues
        ? `Approved upgrade to v${upgrade.to}. Approvals ${approvals.length} of ${THRESHOLD}: queued, executable at hour ${clock + TIMELOCK_HOURS}.`
        : `Approved upgrade to v${upgrade.to}. Approvals ${approvals.length} of ${THRESHOLD}.`;
      return [{ ...state, upgrade: next }, text];
    }
    case "cancel": {
      if (!upgrade) return [state, ""];
      const cancels = [...upgrade.cancels, action.signer];
      if (cancels.length < THRESHOLD) {
        return [
          { ...state, upgrade: { ...upgrade, cancels } },
          `Voted to cancel upgrade to v${upgrade.to} (${cancels.length} of ${THRESHOLD}).`,
        ];
      }
      const record: UpgradeRecord = {
        from: vault.version,
        to: upgrade.to,
        by: upgrade.proposer,
        stolen: upgrade.stolen,
        mode: "proposed",
        queuedAt: upgrade.queuedAt,
        closedAt: clock,
        outcome: "cancelled",
      };
      return [
        { ...state, upgrade: null, history: [...state.history, record] },
        `Voted to cancel (${cancels.length} of ${THRESHOLD}): upgrade to v${upgrade.to} cancelled.`,
      ];
    }
    case "execute": {
      if (!upgrade) return [state, ""];
      const record: UpgradeRecord = {
        from: vault.version,
        to: upgrade.to,
        by: upgrade.proposer,
        stolen: upgrade.stolen,
        mode: "proposed",
        queuedAt: upgrade.queuedAt,
        closedAt: clock,
        outcome: "executed",
      };
      const notice = clock - (upgrade.queuedAt ?? clock);
      return [
        {
          ...state,
          upgrade: null,
          vault: { ...vault, version: upgrade.to, compromised: upgrade.stolen },
          history: [...state.history, record],
        },
        `Executed upgrade v${vault.version} → v${upgrade.to}, ${notice} h after it was queued.`,
      ];
    }
    case "pause":
      return [
        { ...state, vault: { ...vault, paused: true, pausedBy: action.signer, unpauseVotes: [] } },
        "Paused the vault. Deposits and upgrade execution are blocked; withdrawals of free funds still work.",
      ];
    case "unpause": {
      const votes = [...vault.unpauseVotes, action.signer];
      if (votes.length < THRESHOLD) {
        return [
          { ...state, vault: { ...vault, unpauseVotes: votes } },
          `Voted to unpause (${votes.length} of ${THRESHOLD}). The vault stays paused.`,
        ];
      }
      return [
        { ...state, vault: { ...vault, paused: false, pausedBy: null, unpauseVotes: [] } },
        `Voted to unpause (${votes.length} of ${THRESHOLD}): vault unpaused.`,
      ];
    }
    case "withdraw": {
      const eta = etaOf(upgrade);
      const window = eta !== null ? ` Used the exit window before v${upgrade?.to} (executable at hour ${eta}).` : "";
      return [
        { ...state, vault: { ...vault, free: 0, withdrawn: vault.withdrawn + vault.free } },
        `Withdrew ${formatAmount(vault.free)} USDC of free funds. ${formatAmount(vault.reserved)} USDC stays reserved for approved awards.${window}`,
      ];
    }
    case "deposit":
      return [
        { ...state, vault: { ...vault, free: vault.free + DEPOSIT_AMOUNT } },
        `Deposited ${formatAmount(DEPOSIT_AMOUNT)} USDC as free funds.`,
      ];
    case "castVote": {
      const vote = state.votes[action.proposal];
      const { domain } = proposalOf(action.proposal);
      const c = contributorOf(action.handle);
      const text =
        action.choice === "none"
          ? `Cleared their vote on ${proposalTag(action.proposal)}.`
          : `Voted ${CHOICE_LABEL[action.choice]} on ${proposalTag(action.proposal)} with power ${formatPower(votingPower(c, domain))} (√${formatAmount(effectivePoints(c, domain))} effective Points).`;
      const next: Vote = { ...vote, choices: { ...vote.choices, [action.handle]: action.choice } };
      return [{ ...state, votes: { ...state.votes, [action.proposal]: next } }, text];
    }
    case "closeVote": {
      const vote = state.votes[action.proposal];
      const cmp = compareRules(vote.choices, proposalOf(action.proposal).domain);
      const t = cmp.love;
      const share = ((t.cast / t.total) * 100).toFixed(1);
      const quorum = t.quorumMet ? "quorum met" : `quorum of ${formatPower(t.quorum)} not met`;
      return [
        { ...state, votes: { ...state.votes, [action.proposal]: { ...vote, closed: true, outcome: cmp.loveOutcome } } },
        `Closed ${proposalTag(action.proposal)} with ${formatPower(t.cast)} of ${formatPower(t.total)} power cast (${share}%), ${quorum}. For ${formatPower(t.for)}, against ${formatPower(t.against)}, abstain ${formatPower(t.abstain)}. ${OUTCOME_LABEL[cmp.loveOutcome]}. The same ballots under 1 Point = 1 vote: ${OUTCOME_LABEL[cmp.pointsOutcome]}.`,
      ];
    }
    case "decide": {
      const vote = state.votes[action.proposal];
      return [
        { ...state, votes: { ...state.votes, [action.proposal]: { ...vote, decision: action.decision } } },
        action.decision === "adopted"
          ? `Adopted passed ${proposalTag(action.proposal)}.`
          : `Vetoed passed ${proposalTag(action.proposal)}. The advisory result stays on record.`,
      ];
    }
    case "reopenVote":
      return [
        { ...state, votes: { ...state.votes, [action.proposal]: emptyVote } },
        `Reopened the vote on ${proposalTag(action.proposal)}. Its votes are cleared; the other proposals keep theirs.`,
      ];
    case "reset":
      return [{ ...initialState }, "Reset to the sample data."];
  }
}

export function reduce(state: State, action: Action): State {
  const why = refusal(state, action);
  if (why) return logged(state, actorOf(action), attemptOf(action), why);
  const [next, text] = apply(state, action);
  return logged(next, actorOf(action), text);
}
