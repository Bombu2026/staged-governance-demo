// What the pools interface needs, whichever engine feeds it: the browser simulation (sample people,
// simulated days) or the contract on Base Sepolia (the visitor's wallet, real time).

import type { Choice, Points, Tally } from "@/lib/pools/math";
import type { Domain, Kind, Status } from "@/lib/pools/sim";
import type { LogItem } from "../../event-log";
import type { Tone } from "../../ui";

export type Mode = "demo" | "live";

// A button. `why` is set when the action would be refused right now; running it anyway records the refusal.
export interface Cmd {
  why: string | null;
  run: () => void;
}

export interface Person {
  name: string;
  you: boolean;
  note?: string;
}

export interface FunderVM extends Person {
  // What the pool holds for them: their pledge, or zero once refunded.
  amount: bigint;
}

export interface VoterVM extends Person {
  power: bigint;
  choice: Choice | null;
}

export interface PayoutVM extends Person {
  points: bigint;
  amount: bigint;
}

export interface VoteVM {
  kind: "listing" | "closure";
  tally: Tally;
  // "2 days left", "ends in 58:12", "voting period over".
  ends: string;
  voters: VoterVM[];
}

export interface PoolVM {
  id: number;
  kind: Kind;
  domain: Domain;
  title: string;
  proposer: Person;
  status: Status;
  target: bigint;
  pledged: bigint;
  refunded: bigint;
  funders: FunderVM[];
  // One short line for cards: "30 days left", "4:12 left", "Full, ready to launch".
  clock: string;
  listing: Tally;
  // The vote open right now, if any.
  vote: VoteVM | null;
  payouts: PayoutVM[] | null;
  fee: bigint | null;
  // While building: the record of accepted work so far and what a payout would send.
  preview: { net: bigint; fee: bigint; shares: PayoutVM[] } | null;
}

export interface MeVM {
  name: string;
  // "Sample company", "Sample contributor", "Phantom on Base Sepolia".
  role: string;
  usdc: bigint | null;
  points: Points | null;
}

export interface CastCmd {
  label: string;
  cmd: Cmd;
}

export interface CastGroup {
  title: string;
  hint: string;
  items: CastCmd[];
}

export interface PoolCmds {
  myPower: bigint;
  myChoice: Choice | null;
  myPledge: bigint;
  vote(choice: Choice): Cmd;
  closeVote: Cmd;
  pledge(amount: bigint): Cmd;
  launch: Cmd;
  refund: Cmd;
  askClosure: Cmd;
  payOut: Cmd;
  // The other people of the demo, one click each.
  cast: CastGroup[];
}

export interface ProposeInput {
  kind: Kind;
  title: string;
  domain: Domain;
  target: bigint;
  window: string;
  openingPledge: bigint;
}

export interface Toast {
  id: number;
  tone: Tone;
  title: string;
  text: string;
  href?: string | null;
}

// Who signs what, said next to the buttons. Empty in the simulation.
export interface Hints {
  vote: string;
  pledge: string;
  request: string;
  proposal: string;
  anyone: string;
  steward: string;
  closure: string;
}

export interface Engine {
  mode: Mode;
  me: MeVM;
  pools: PoolVM[];
  log: LogItem[];
  cmds(pool: PoolVM): PoolCmds;
  windows: readonly { id: string; label: string }[];
  defaultWindow: string;
  proposeWhy(input: ProposeInput): string | null;
  // Resolves to the new pool's id, or null when nothing was opened.
  propose(input: ProposeInput): Promise<number | null>;
  hints: Hints;
  // Label of the action in flight, while buttons wait.
  busy: string | null;
  toast: Toast | null;
  dismissToast(): void;
  // Controls that belong to the demo as a whole, such as the simulated clock.
  controls: CastGroup | null;
}

export const NO_HINTS: Hints = { vote: "", pledge: "", request: "", proposal: "", anyone: "", steward: "", closure: "" };

export const refundable = (status: Status) => status === "not-listed" || status === "expired" || status === "closed";
