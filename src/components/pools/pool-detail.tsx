"use client";

import { type Dispatch, type ReactNode, useState } from "react";
import { type Choice, type Tally, castPower, formatPower, formatUsdc, percentText, usdc } from "@/lib/pools/math";
import {
  type Action,
  type FunderId,
  type Handle,
  type Pool,
  type State,
  type Status,
  CONTRIBUTORS,
  DOMAIN_LABEL,
  FUNDERS,
  VOTING_DAYS,
  ballotsOf,
  domainIndex,
  heldBy,
  isFunder,
  openTally,
  payoutPreview,
  powerIn,
  statusOf,
  workList,
  workTotal,
} from "@/lib/pools/sim";
import { ActionButton, Badge, Callout, SampleTag } from "../ui";
import { type Bound, KindTag, LABEL, Lifecycle, Money, PoolProgress, RowButton, STATUS_TONE, StatusBadge, TallyBar, bindPools } from "./parts";

const CHOICES: { value: Choice; label: string; tone: "for" | "against" | "abstain" }[] = [
  { value: "for", label: "For", tone: "for" },
  { value: "against", label: "Against", tone: "against" },
  { value: "abstain", label: "Abstain", tone: "abstain" },
];

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function deadlineLine(pool: Pool, status: Status, day: number): string {
  if (status === "voting") return `Listing vote open until day ${pool.listing.end}. The ${days(pool.fundingDays)} funding window starts if it is listed.`;
  if (pool.deadline === null) return "Never listed, so its funding window never opened.";
  if (status === "funding") {
    return pool.pledged >= pool.target
      ? "Full. Anyone can launch it."
      : day < pool.deadline
        ? `Closes on day ${pool.deadline}: ${days(pool.deadline - day)} left.`
        : "Deadline passed.";
  }
  if (status === "expired") return `Closed on day ${pool.deadline} below its target.`;
  return `Reached its target${pool.launchedAt !== null ? ` and launched on day ${pool.launchedAt}` : ""}.`;
}

export function PoolDetail({ state, pool, dispatch }: { state: State; pool: Pool; dispatch: Dispatch<Action> }) {
  const act = bindPools(state, dispatch);
  const status = statusOf(pool, state.day);
  const funders = Object.values(pool.pledges).filter((amount) => (amount ?? 0n) > 0n).length;
  const refundable = status === "not-listed" || status === "expired" || status === "closed";
  const owed = FUNDERS.filter((f) => (pool.pledges[f.id] ?? 0n) > 0n);

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-surface p-5 sm:p-8" aria-labelledby={`pool-${pool.id}-title`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-muted">#{pool.id}</span>
          <KindTag kind={pool.kind} />
          <Badge>{DOMAIN_LABEL[pool.domain]}</Badge>
          <StatusBadge status={status} />
          <SampleTag />
        </div>
        <h3 id={`pool-${pool.id}-title`} className="mt-4 text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">
          {pool.title}
        </h3>
        <p className="mt-2 text-[15px] text-muted">
          {pool.kind === "request" ? "Requested by" : "Proposed by"} <span className="font-mono font-bold text-ink">{pool.proposer}</span> on day{" "}
          {pool.proposedAt}
          {pool.kind === "request" ? ", with a first pledge." : ", with no money down."}
        </p>

        <div className="mt-6">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">{formatUsdc(heldBy(pool))}</span>
            <span className="text-base text-muted">
              of {formatUsdc(pool.target)} USDC{status === "paid" ? ", paid out" : " in the pool"}
            </span>
          </p>
          <div className="mt-3">
            <PoolProgress pledged={pool.pledged} target={pool.target} refunded={pool.refunded} tone={STATUS_TONE[status] === "danger" ? "danger" : "accent"} />
          </div>
          <p className="mt-3 text-sm text-muted">
            {funders} {funders === 1 ? "funder" : "funders"} · {deadlineLine(pool, status, state.day)}
            {pool.refunded > 0n && ` ${formatUsdc(pool.refunded)} USDC already refunded.`}
          </p>
        </div>

        <div className="mt-6">
          <Lifecycle status={status} />
        </div>

        {refundable && (
          <div className="mt-6">
            <Callout
              tone="danger"
              title={status === "expired" ? "Missed its target: every pledge is refundable" : status === "closed" ? "Closed by vote: every pledge is refundable" : "Not listed: the first pledge is refundable"}
            >
              <p>
                {status === "expired"
                  ? `The pool held ${formatUsdc(pool.pledged)} of ${formatUsdc(pool.target)} USDC at its deadline, so nothing was spent. Each funder gets back exactly what they put in, with no fee.`
                  : status === "closed"
                    ? "Contributors voted to close the build before it was paid. The whole pool goes back to the funders, with no fee."
                    : "Contributors did not list this pool, so it never opened for pledges."}
              </p>
              {owed.length > 0 ? (
                <div className="mt-3">
                  <ActionButton variant="primary" why={null} onClick={() => owed.forEach((f) => dispatch({ type: "refund", pool: pool.id, funder: f.id }))}>
                    Refund {owed.length === 1 ? owed[0].id : `all ${owed.length} funders`}
                  </ActionButton>
                </div>
              ) : (
                pool.pledged > 0n && <p className="mt-2 font-bold">Everyone has been refunded.</p>
              )}
            </Callout>
          </div>
        )}
        {status === "paid" && pool.payouts && pool.fee !== null && (
          <div className="mt-6">
            <Callout tone="success" title={`Paid out: ${formatUsdc(pool.pledged - pool.fee)} USDC to ${pool.payouts.length} contributors`}>
              Split by share of project Points from accepted work. The {formatUsdc(pool.fee)} USDC fee is the 2% Slop publishes for payouts.
            </Callout>
          </div>
        )}
      </section>

      <ListingVote key={`vote-${status}`} state={state} pool={pool} act={act} dispatch={dispatch} />
      <Funding key={`pool-${status}`} state={state} pool={pool} status={status} act={act} />
      <Build key={`build-${status}`} state={state} pool={pool} status={status} act={act} dispatch={dispatch} />
    </div>
  );
}

type Mode = "now" | "done" | "later";

// One step of the pool's life. The current step is open; finished and future ones fold to one line.
function Phase({ title, meta, mode, summary, children }: { title: string; meta: ReactNode; mode: Mode; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(mode === "now");
  return (
    <section className={`min-w-0 rounded-xl bg-surface p-5 sm:p-8 ${mode === "now" ? "" : "opacity-95"}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className={`text-[15px] font-bold ${mode === "now" ? "text-ink" : "text-muted"}`}>{title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {meta}
          {mode !== "now" && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="min-h-9 rounded-md border border-line-strong px-3 text-sm font-bold transition-colors hover:bg-raised motion-reduce:transition-none"
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
        </div>
      </header>
      {open ? <div className="@container mt-5 space-y-5">{children}</div> : <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">{summary}</p>}
    </section>
  );
}

function Ballots({
  state,
  pool,
  round,
  tally,
  act,
  dispatch,
}: {
  state: State;
  pool: Pool;
  round: number;
  tally: Tally;
  act: Bound;
  dispatch: Dispatch<Action>;
}) {
  const live = openTally(pool) === tally && pool.round === round;
  const cast = ballotsOf(pool, round);
  const d = domainIndex(pool.domain);
  const order = [...CONTRIBUTORS].sort((x, y) => Number(powerIn(state, y.handle, pool.domain) - powerIn(state, x.handle, pool.domain)));

  return (
    <>
      <p className="text-[15px] leading-relaxed text-muted">
        Power is the square root of effective Points: Points earned in <span className="font-bold text-ink">{DOMAIN_LABEL[pool.domain]}</span>{" "}
        count in full, Points in the other three domains count a quarter. Points come from accepted work and cannot be bought or transferred.
      </p>
      <ol className="divide-y divide-line border-y border-line">
        {order.map((c) => {
          const points = state.points[c.handle];
          const here = points[d];
          const elsewhere = points.reduce((sum, p) => sum + p, 0) - here;
          const ballot = cast[c.handle];
          return (
            <li key={c.handle} className="grid gap-3 px-1 py-3.5 @2xl:grid-cols-[minmax(0,1fr)_6rem_auto] @2xl:items-center @2xl:gap-5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-sm font-bold">{c.handle}</span>
                  <span className="text-sm text-muted">{c.profile}</span>
                </p>
                <p className="mt-0.5 font-mono text-xs text-muted">
                  {here} Points here + {elsewhere} elsewhere × 0.25
                </p>
              </div>
              <p className="font-mono text-lg font-bold tabular-nums @2xl:text-right">
                {formatPower(live || !ballot ? powerIn(state, c.handle, pool.domain) : ballot.power)}
                <span className="ml-1.5 text-xs font-medium text-muted @2xl:sr-only">power</span>
              </p>
              <div className="grid grid-cols-3 gap-1.5 @2xl:w-[17rem]" role="group" aria-label={`Vote of ${c.handle}`}>
                {CHOICES.map((choice) => {
                  const pressed = ballot?.choice === choice.value;
                  const bound = act({ type: "vote", pool: pool.id, handle: c.handle, choice: choice.value });
                  return (
                    <RowButton
                      key={choice.value}
                      tone={choice.tone}
                      pressed={pressed}
                      why={live ? bound.why : "This vote is closed."}
                      onClick={() => live && !pressed && dispatch({ type: "vote", pool: pool.id, handle: c.handle, choice: choice.value })}
                    >
                      {choice.label}
                    </RowButton>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <TallyBar tally={tally} />
    </>
  );
}

function ListingVote({ state, pool, act, dispatch }: { state: State; pool: Pool; act: Bound; dispatch: Dispatch<Action> }) {
  const open = pool.status === "voting";
  const listed = pool.status !== "voting" && pool.status !== "not-listed";
  return (
    <Phase
      title="1 · Listing vote (Proof of Love)"
      mode={open ? "now" : "done"}
      summary={`${listed ? "Listed" : "Not listed"}: For ${formatPower(pool.listing.for)}, against ${formatPower(pool.listing.against)}, with ${percentText(castPower(pool.listing), pool.listing.total, 0)}% of contributor power cast.`}
      meta={open ? <Badge tone="warning">Open until day {pool.listing.end}</Badge> : listed ? <Badge tone="success">Listed</Badge> : <Badge tone="danger">Not listed</Badge>}
    >
      <p className="max-w-prose leading-relaxed">
        Contributors decide whether this build is worth doing here at this budget. They are the ones who would build it, so the
        vote is theirs: funders have no vote, they choose with their pledge.
      </p>
      <Ballots state={state} pool={pool} round={0} tally={pool.listing} act={act} dispatch={dispatch} />
      {open ? (
        <div className="flex flex-wrap items-start gap-3 border-t border-line pt-5">
          <ActionButton variant="primary" {...act({ type: "finalize", pool: pool.id })}>
            Close the vote
          </ActionButton>
          <p className="max-w-md py-2.5 text-sm leading-snug text-muted">
            Passes with a 40% quorum and more For than Against. It lasts {VOTING_DAYS} days, or ends early once the result can no longer change.
          </p>
        </div>
      ) : (
        <p className="border-t border-line pt-5 text-[15px]">
          {listed
            ? "The vote passed: the pool was listed and opened for pledges."
            : "The vote did not pass: the pool was not listed and never opened for pledges."}
        </p>
      )}
    </Phase>
  );
}

const STEPS_USDC = [5_000, 10_000] as const;

function Funding({ state, pool, status, act }: { state: State; pool: Pool; status: Status; act: Bound }) {
  const room = pool.target - pool.pledged;
  const funders = Object.values(pool.pledges).filter((amount) => (amount ?? 0n) > 0n).length;
  const mode: Mode = status === "funding" || status === "expired" ? "now" : status === "voting" ? "later" : "done";
  return (
    <Phase
      title="2 · The pool"
      mode={mode}
      summary={
        status === "voting"
          ? "Opens for pledges if contributors list the pool. Until then only the first pledge of a request sits in it."
          : status === "not-listed"
            ? "Never opened for pledges."
            : `${formatUsdc(pool.pledged)} USDC pledged${funders > 0 ? ` by ${funders} ${funders === 1 ? "funder" : "funders"}` : ""}${pool.refunded > 0n ? `, ${formatUsdc(pool.refunded)} refunded` : ""}.`
      }
      meta={
        status === "funding" ? (
          <Badge tone="accent">{room === 0n ? "Full" : `${formatUsdc(room)} USDC to go`}</Badge>
        ) : status === "voting" ? (
          <Badge>Waiting for the vote</Badge>
        ) : (
          <StatusBadge status={status} />
        )
      }
    >
      <p className="max-w-prose leading-relaxed">
        Any funder can add to the pool until its deadline. Pledges are locked meanwhile, so the total everyone sees is real. Full by the
        deadline: the build launches. Not full: every pledge goes back.
      </p>
      <div className={`hidden grid-cols-[minmax(0,1fr)_7rem_7rem_auto] gap-4 px-1 @2xl:grid ${LABEL}`}>
        <span>Funder</span>
        <span className="text-right">Wallet</span>
        <span className="text-right">In this pool</span>
        <span className="w-[15.5rem]">Pledge or refund</span>
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {FUNDERS.map((f) => {
          const pledged = pool.pledges[f.id] ?? 0n;
          return (
            <li key={f.id} className="grid gap-3 px-1 py-3.5 @2xl:grid-cols-[minmax(0,1fr)_7rem_7rem_auto] @2xl:items-center @2xl:gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-sm font-bold">{f.id}</span>
                  <span className="text-sm text-muted">{f.profile}</span>
                </p>
                {pool.proposer === f.id && <p className="mt-0.5 font-mono text-xs text-accent">Opened this request</p>}
              </div>
              <p className="flex justify-between gap-2 text-sm @2xl:block @2xl:text-right">
                <span className="text-muted @2xl:hidden">Wallet</span>
                <span className="font-mono tabular-nums">{formatUsdc(state.wallets[f.id])}</span>
              </p>
              <p className="flex justify-between gap-2 text-sm @2xl:block @2xl:text-right">
                <span className="text-muted @2xl:hidden">In this pool</span>
                <span className={`font-mono font-bold tabular-nums ${pledged > 0n ? "text-accent" : "text-muted"}`}>{formatUsdc(pledged)}</span>
              </p>
              <div className="flex flex-wrap gap-1.5 @2xl:w-[15.5rem]">
                {STEPS_USDC.map((step) => (
                  <RowButton
                    key={step}
                    label={`${f.id} pledges ${formatUsdc(usdc(step))} USDC`}
                    {...act({ type: "pledge", pool: pool.id, funder: f.id, amount: usdc(step) })}
                  >
                    +{formatUsdc(usdc(step))}
                  </RowButton>
                ))}
                <RowButton label={`Refund ${f.id}`} {...act({ type: "refund", pool: pool.id, funder: f.id })}>
                  Refund
                </RowButton>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-start gap-3">
        <ActionButton variant="primary" {...act({ type: "launch", pool: pool.id })}>
          Launch the build
        </ActionButton>
        <p className="max-w-md py-2.5 text-sm leading-snug text-muted">
          Anyone can press it. It only works once the pool holds its full target; a pledge larger than what is missing is cut down to it.
        </p>
      </div>
    </Phase>
  );
}

function Build({ state, pool, status, act, dispatch }: { state: State; pool: Pool; status: Status; act: Bound; dispatch: Dispatch<Action> }) {
  const askers: (FunderId | Handle)[] = [...FUNDERS.filter((f) => (pool.pledges[f.id] ?? 0n) > 0n).map((f) => f.id), ...CONTRIBUTORS.map((c) => c.handle)];
  const [asker, setAsker] = useState<FunderId | Handle>("company-a");
  const by = askers.includes(asker) ? asker : (askers[0] ?? "contributor-a");
  const preview = payoutPreview(pool);
  const rows = pool.payouts ?? preview.shares;
  const total = BigInt(workTotal(pool));

  return (
    <Phase
      title="3 · Build and payout"
      mode={status === "building" || status === "paid" || status === "closed" ? "now" : "later"}
      summary={
        status === "expired" || status === "not-listed"
          ? "Never started: the pool did not launch."
          : "Starts when the pool is full and launched. Accepted work earns project Points, and the pool is paid by share of those Points."
      }
      meta={status === "building" ? <Badge tone="success">Building</Badge> : status === "paid" ? <Badge tone="success">Paid out</Badge> : status === "closed" ? <Badge tone="danger">Closed</Badge> : <Badge>After launch</Badge>}
    >
      <p className="max-w-prose leading-relaxed">
        Once launched, the pool is the build&apos;s contributor pool. Work is accepted the way it is on any Slop project: merged pull
        requests and reviews that changed an outcome earn project Points. The pool is paid by share of those Points, less the 2% fee.
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <ActionButton {...act({ type: "acceptWork", pool: pool.id })}>Accept sample work</ActionButton>
        <ActionButton variant="primary" {...act({ type: "payOut", pool: pool.id })}>
          Pay out by Points
        </ActionButton>
      </div>

      {workList(pool).length === 0 ? (
        <p className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">No accepted work yet. Nothing can be paid until someone has project Points.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-canvas">
          <table className="w-full min-w-[26rem] text-left text-sm">
            <thead>
              <tr className={LABEL}>
                <th scope="col" className="px-4 py-3 font-bold">Contributor</th>
                <th scope="col" className="px-4 py-3 text-right font-bold">Project Points</th>
                <th scope="col" className="px-4 py-3 text-right font-bold">Share</th>
                <th scope="col" className="px-4 py-3 text-right font-bold">{pool.payouts ? "Paid" : "Would receive"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {rows.map((row) => (
                <tr key={row.handle}>
                  <td className="px-4 py-3 font-mono font-bold">{row.handle}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{row.points.toString()}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{percentText(row.points, total)}%</td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={row.amount} />
                  </td>
                </tr>
              ))}
              <tr className="text-muted">
                <td className="px-4 py-3">Slop fee (2%)</td>
                <td />
                <td />
                <td className="px-4 py-3 text-right">
                  <Money amount={pool.fee ?? preview.fee} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-4 rounded-lg bg-canvas p-4 sm:p-5">
        <div>
          <p className="font-bold">What if the build stalls?</p>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
            Until the pool is paid, a funder of this pool or a contributor can ask for a closure vote. Contributors decide with the same
            Proof of Love rule. If it passes, the whole pool goes back to the funders. No payout can happen while the vote is open, and
            after a failed vote the next one waits {VOTING_DAYS} days.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <span className="text-muted">Asked by</span>
            <select
              value={by}
              onChange={(e) => setAsker(e.target.value as FunderId | Handle)}
              className="min-h-11 rounded-md border border-input-border bg-raised px-3 font-mono text-ink"
            >
              {askers.map((who) => (
                <option key={who} value={who}>
                  {who}
                  {isFunder(who) ? " (funder)" : ""}
                </option>
              ))}
            </select>
          </label>
          <ActionButton variant="danger" {...act({ type: "openClosure", pool: pool.id, by })}>
            Ask for a closure vote
          </ActionButton>
        </div>
        {pool.closure && (
          <div className="@container space-y-5 border-t border-line pt-5">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-bold">Closure vote {pool.round > 1 ? `(round ${pool.round})` : ""}</span>
              {pool.closure.open ? (
                <Badge tone="warning">Open until day {pool.closure.end}</Badge>
              ) : status === "closed" ? (
                <Badge tone="danger">Passed: pool closed</Badge>
              ) : (
                <Badge tone="success">Failed: build continues</Badge>
              )}
            </p>
            <Ballots state={state} pool={pool} round={pool.round} tally={pool.closure} act={act} dispatch={dispatch} />
            {pool.closure.open && (
              <ActionButton variant="primary" {...act({ type: "finalize", pool: pool.id })}>
                Close the vote
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </Phase>
  );
}
