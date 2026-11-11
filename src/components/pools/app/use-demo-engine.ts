"use client";

// The simulation as an engine: sample companies and contributors, simulated days, nothing leaves the tab.
// The visitor acts as one sample person at a time and can switch at will.

import { useMemo, useReducer, useState } from "react";
import { type Choice, formatUsdc } from "@/lib/pools/math";
import {
  type Action,
  type FunderId,
  type Handle,
  type Pool,
  type State,
  type Status,
  CONTRIBUTORS,
  FUNDERS,
  ballotsOf,
  contributorOf,
  funderOf,
  isContributor,
  isFunder,
  openTally,
  payoutPreview,
  powerIn,
  reduce,
  refusal,
  statusOf,
  workTotal,
} from "@/lib/pools/sim";
import { demoState } from "@/lib/pools/demo-seed";
import type { LogItem } from "../../event-log";
import { type CastGroup, type Cmd, type Engine, type PoolCmds, type PoolVM, type ProposeInput, type Toast, NO_HINTS } from "./engine";

export type Persona = FunderId | Handle;

export const PERSONAS: { id: Persona; side: "company" | "contributor"; profile: string }[] = [
  ...FUNDERS.map((f) => ({ id: f.id, side: "company" as const, profile: f.profile })),
  ...CONTRIBUTORS.map((c) => ({ id: c.handle, side: "contributor" as const, profile: c.profile })),
];

const WINDOWS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
] as const;

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function clockOf(pool: Pool, day: number): string {
  const status = statusOf(pool, day);
  const vote = openTally(pool);
  if (vote) return day < vote.end ? `Vote: ${days(vote.end - day)} left` : "Vote: period over";
  switch (status) {
    case "funding":
      return pool.pledged >= pool.target ? "Full, ready to launch" : pool.deadline !== null && day < pool.deadline ? `${days(pool.deadline - day)} left` : "Deadline passed";
    case "building":
      return workTotal(pool) > 0 ? "Building, work accepted" : "Building";
    case "paid":
      return "Paid by Points";
    case "expired":
      return "Refunds open";
    case "closed":
      return "Refunds open";
    case "not-listed":
      return pool.pledged > pool.refunded ? "Refund open" : "Not listed";
    default:
      return "";
  }
}

function toVM(state: State, pool: Pool, persona: Persona): PoolVM {
  const status = statusOf(pool, state.day);
  const open = openTally(pool);
  const ballots = ballotsOf(pool);
  const person = (name: string) => ({ name, you: name === persona });
  const preview = status === "building" && workTotal(pool) > 0 ? payoutPreview(pool) : null;
  return {
    id: pool.id,
    kind: pool.kind,
    domain: pool.domain,
    title: pool.title,
    proposer: person(pool.proposer),
    status,
    target: pool.target,
    pledged: pool.pledged,
    refunded: pool.refunded,
    funders: FUNDERS.filter((f) => pool.pledges[f.id] !== undefined).map((f) => ({ ...person(f.id), note: f.profile, amount: pool.pledges[f.id] ?? 0n })),
    clock: clockOf(pool, state.day),
    listing: pool.listing,
    vote: open && {
      kind: status === "voting" ? "listing" : "closure",
      tally: open,
      ends: state.day < open.end ? `${days(open.end - state.day)} left` : "voting period over",
      voters: CONTRIBUTORS.filter((c) => powerIn(state, c.handle, pool.domain) > 0n).map((c) => ({
        ...person(c.handle),
        note: c.profile,
        power: ballots[c.handle]?.power ?? powerIn(state, c.handle, pool.domain),
        choice: ballots[c.handle]?.choice ?? null,
      })),
    },
    payouts: pool.payouts && pool.payouts.map((p) => ({ ...person(p.handle), points: p.points, amount: p.amount })),
    fee: pool.fee,
    preview: preview && { net: preview.net, fee: preview.fee, shares: preview.shares.map((s) => ({ ...person(s.handle), points: s.points, amount: s.amount })) },
  };
}

// Resetting goes back to the five sample pools, not to an empty board.
const reduceDemo = (state: State, action: Action): State => (action.type === "reset" ? demoState : reduce(state, action));

// Pools that wait for someone come first, finished ones last; newest first within a group.
const ORDER: Record<Status, number> = { funding: 0, voting: 1, building: 2, paid: 3, expired: 4, closed: 4, "not-listed": 4 };

export function useDemoEngine() {
  const [state, dispatch] = useReducer(reduceDemo, demoState);
  const [persona, setPersona] = useState<Persona>("company-a");
  const [dismissed, setDismissed] = useState(0);
  const engine = useMemo<Engine>(() => {
    const bind = (action: Action): Cmd => ({ why: refusal(state, action)?.text ?? null, run: () => dispatch(action) });
    const blocked = (why: string): Cmd => ({ why, run: () => undefined });
    const asCompany = isFunder(persona);
    const asContributor = isContributor(persona);

    const log: LogItem[] = state.log.map((e) => ({ seq: e.seq, stamp: `day ${e.day}`, actor: e.actor, text: e.text, refusal: e.refusal }));
    const last = state.log[state.log.length - 1];
    const toast: Toast | null =
      last && last.seq > dismissed
        ? last.refusal
          ? { id: last.seq, tone: "danger", title: `Refused: ${last.refusal.split(":")[0]}`, text: last.refusal.slice(last.refusal.indexOf(":") + 1).trim() }
          : { id: last.seq, tone: "success", title: last.actor, text: last.text }
        : null;

    const clock: CastGroup = {
      title: `Simulated clock: day ${state.day}`,
      hint: "Deadlines and voting periods follow this clock.",
      items: [
        { label: "+1 day", cmd: bind({ type: "advance", days: 1 }) },
        { label: "+7 days", cmd: bind({ type: "advance", days: 7 }) },
      ],
    };

    function cmds(vm: PoolVM): PoolCmds {
      const pool = state.pools.find((p) => p.id === vm.id);
      if (!pool) throw new Error(`Unknown pool ${vm.id}`);
      const open = openTally(pool);
      const ballots = ballotsOf(pool);
      const room = pool.target - pool.pledged;

      const others = CONTRIBUTORS.filter((c) => c.handle !== persona && !ballots[c.handle] && powerIn(state, c.handle, pool.domain) > 0n);
      const voteAll = (choice: Choice): Cmd =>
        !open
          ? blocked("No vote is open on this pool.")
          : others.length === 0
            ? blocked("Every other contributor has voted.")
            : { why: null, run: () => others.forEach((c) => dispatch({ type: "vote", pool: pool.id, handle: c.handle, choice })) };

      const fill: Cmd =
        vm.status !== "funding" || room <= 0n
          ? blocked(room <= 0n && vm.status === "funding" ? "The pool is already full." : "The pool is not open for pledges.")
          : {
              why: null,
              run: () => {
                let left = room;
                for (const f of FUNDERS) {
                  if (f.id === persona || left <= 0n) continue;
                  const take = state.wallets[f.id] < left ? state.wallets[f.id] : left;
                  if (take <= 0n) continue;
                  dispatch({ type: "pledge", pool: pool.id, funder: f.id, amount: take });
                  left -= take;
                }
              },
            };

      const owed = FUNDERS.filter((f) => (pool.pledges[f.id] ?? 0n) > 0n);
      const cast: CastGroup[] = [];
      if (open) {
        cast.push({
          title: "The other contributors",
          hint: `${others.length} of them have not voted yet.`,
          items: [
            { label: "They vote For", cmd: voteAll("for") },
            { label: "They vote Against", cmd: voteAll("against") },
          ],
        });
      }
      if (vm.status === "funding") {
        cast.push({ title: "The other companies", hint: "They pledge what is missing, as far as their wallets go.", items: [{ label: "They fill the pool", cmd: fill }] });
      }
      if (vm.status === "building") {
        cast.push({
          title: "The maintainers",
          hint: "Each click accepts a batch of pull requests and reviews, which earn project Points.",
          items: [{ label: "Accept a batch of work", cmd: bind({ type: "acceptWork", pool: pool.id }) }],
        });
      }
      cast.push(clock);

      return {
        myPower: asContributor ? powerIn(state, persona, pool.domain) : 0n,
        myChoice: asContributor ? (ballots[persona]?.choice ?? null) : null,
        myPledge: asCompany ? (pool.pledges[persona] ?? 0n) : 0n,
        vote: (choice) =>
          asContributor ? bind({ type: "vote", pool: pool.id, handle: persona, choice }) : blocked(`${persona} is a company. Only contributors with Points vote: switch persona, top right.`),
        closeVote: bind({ type: "finalize", pool: pool.id }),
        pledge: (amount) =>
          asCompany ? bind({ type: "pledge", pool: pool.id, funder: persona, amount }) : blocked(`${persona} is a contributor. Companies pledge: switch persona, top right.`),
        launch: bind({ type: "launch", pool: pool.id }),
        refund: owed.length === 0 ? blocked("Nobody has a pledge left in this pool.") : { why: null, run: () => owed.forEach((f) => dispatch({ type: "refund", pool: pool.id, funder: f.id })) },
        askClosure: bind({ type: "openClosure", pool: pool.id, by: persona }),
        payOut: bind({ type: "payOut", pool: pool.id }),
        cast,
      };
    }

    const toAction = (input: ProposeInput): Action | null => {
      const fundingDays = Number(input.window);
      if (input.kind === "request") {
        return isFunder(persona) ? { type: "propose", kind: "request", by: persona, title: input.title, domain: input.domain, target: input.target, fundingDays, openingPledge: input.openingPledge } : null;
      }
      return isContributor(persona) ? { type: "propose", kind: "proposal", by: persona, title: input.title, domain: input.domain, target: input.target, fundingDays } : null;
    };

    return {
      mode: "demo",
      me: asCompany
        ? { name: persona, role: `Sample company: ${funderOf(persona).profile.toLowerCase()}`, usdc: state.wallets[persona], points: null }
        : { name: persona, role: `Sample contributor: ${contributorOf(persona as Handle).profile.toLowerCase()}`, usdc: state.earned[persona as Handle], points: state.points[persona as Handle] },
      pools: state.pools.map((p) => toVM(state, p, persona)).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.id - a.id),
      log,
      cmds,
      windows: WINDOWS,
      defaultWindow: "30",
      proposeWhy(input) {
        const action = toAction(input);
        if (!action) {
          return input.kind === "request"
            ? `${persona} is a contributor. A request comes from a company: switch persona, top right.`
            : `${persona} is a company. A proposal comes from a contributor with Points: switch persona, top right.`;
        }
        return refusal(state, action)?.text ?? null;
      },
      async propose(input) {
        const action = toAction(input);
        if (!action) return null;
        const ok = refusal(state, action) === null;
        const id = state.pools.length + 1;
        dispatch(action);
        return ok ? id : null;
      },
      hints: NO_HINTS,
      busy: null,
      toast,
      dismissToast: () => setDismissed(last?.seq ?? 0),
      controls: clock,
    };
  }, [state, persona, dismissed]);

  return {
    engine,
    persona,
    setPersona,
    reset: () => {
      dispatch({ type: "reset" });
      setDismissed(0);
    },
    walletOf: (id: Persona) => (isFunder(id) ? `${formatUsdc(state.wallets[id])} USDC` : `${state.points[id as Handle].reduce((a, b) => a + b, 0)} Points`),
  };
}
