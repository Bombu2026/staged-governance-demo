"use client";

import { type Dispatch, useId, useState } from "react";
import { type Action, type State, type Vote, formatAmount, refusal } from "@/lib/governance";
import {
  type Choice,
  type Contributor,
  type Domain,
  type Outcome,
  type ProposalId,
  DOMAINS,
  DOMAIN_LABEL,
  OFF_DOMAIN_WEIGHT,
  ON_DOMAIN_WEIGHT,
  OUTCOME_LABEL,
  PROPOSALS,
  QUORUM_PERCENT,
  compareRules,
  domainWeight,
  effectivePoints,
  formatPower,
  powerRanking,
  proposalOf,
  rankOf,
  rawRanking,
  totalPoints,
  votingPower,
} from "@/lib/vote";
import { ActionButton, Badge, Callout, Panel, SampleTag, type Tone, bind } from "./ui";

const CHOICES: { value: Choice; label: string; on: string }[] = [
  { value: "for", label: "For", on: "bg-success text-on-accent" },
  { value: "against", label: "Against", on: "bg-danger text-on-accent" },
  { value: "abstain", label: "Abstain", on: "bg-muted text-on-accent" },
  { value: "none", label: "Not voted", on: "bg-ink/20 text-ink" },
];

const DOMAIN_FILL: Record<Domain, string> = {
  security: "pat-solid",
  vaults: "pat-hatch",
  scoring: "pat-dots",
  moderation: "pat-lines",
};

const RAW = rawRanking();
const MAX_TOTAL = totalPoints(RAW[0]);

const OUTCOME_TONE: Record<Outcome, Tone> = { "no-quorum": "warning", passed: "success", rejected: "danger" };
const OUTCOME_VERB: Record<Outcome, string> = { "no-quorum": "misses quorum", passed: "passes", rejected: "is rejected" };

const weight = (w: number) => `× ${w.toFixed(w % 1 === 0 ? 1 : 2)}`;

function statusOf(vote: Vote): string {
  if (vote.decision) return vote.decision === "adopted" ? "Passed, adopted by moderators" : "Passed, vetoed by moderators";
  if (vote.outcome) return `Closed: ${OUTCOME_LABEL[vote.outcome]}`;
  const n = Object.values(vote.choices).filter((c) => c !== "none").length;
  return n === 0 ? "Open, no votes yet" : `Open, ${n} ${n === 1 ? "vote" : "votes"} cast`;
}

// The row whose rank moves most against the raw-Points ranking: the most telling worked example.
function exampleOf(order: Contributor[]): Contributor {
  let best = order[0];
  let bestShift = -1;
  for (const c of order) {
    const shift = Math.abs(rankOf(RAW, c.handle) - rankOf(order, c.handle));
    if (shift > bestShift) {
      best = c;
      bestShift = shift;
    }
  }
  return best;
}

export function StageVote({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const [selected, setSelected] = useState<ProposalId>(PROPOSALS[0].id);
  const act = bind(state, dispatch);
  const proposal = proposalOf(selected);
  const { domain } = proposal;
  const vote = state.votes[selected];
  const cmp = compareRules(vote.choices, domain);
  const t = cmp.love;
  const order = powerRanking(domain);
  const example = exampleOf(order);
  const share = (n: number) => `${(n / t.total) * 100}%`;
  const closedId = useId();
  const closedWhy = vote.closed
    ? refusal(state, { type: "castVote", proposal: selected, handle: order[0].handle, choice: "abstain" })
    : null;

  return (
    <div className="space-y-6">
      <div className="max-w-prose space-y-4 text-lg leading-relaxed">
        <p>
          <strong className="font-extrabold">Proof of Love:</strong> voting power comes from soulbound, non-transferable
          points earned through real contribution, so the quality and impact of contributions are rewarded, not capital.
        </p>
        <p className="text-muted">
          Here that power derives from accepted-work Points and depends on the proposal&apos;s domain, so the people who did
          the work in a domain weigh more on decisions about it. At this stage the result is advisory: moderators keep the
          final word.
        </p>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-[3px] border-accent pl-3 text-[15px] leading-snug">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-accent">Soulbound</span>
        <span>Points cannot be delegated, transferred or bought: this vote has no such action.</span>
      </p>

      <Panel
        title="Proposal"
        meta={
          <>
            <SampleTag />
            <Badge tone="warning">Advisory</Badge>
            {vote.closed ? <Badge>Closed</Badge> : <Badge tone="accent">Open</Badge>}
          </>
        }
      >
        <div role="group" aria-label="Sample proposals" className="grid gap-2 @3xl:grid-cols-3">
          {PROPOSALS.map((p) => {
            const active = p.id === selected;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(p.id)}
                className={`flex min-w-0 flex-col items-start gap-2 rounded-lg p-3 text-left transition-colors motion-reduce:transition-none sm:p-4 ${
                  active ? "bg-raised ring-2 ring-inset ring-accent" : "ring-1 ring-inset ring-line hover:bg-raised"
                }`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`font-mono text-[11px] font-bold uppercase tracking-wider ${active ? "text-accent" : "text-muted"}`}>
                    Proposal {p.n}
                  </span>
                  <DomainTag domain={p.domain} />
                </span>
                <span className="text-[15px] font-bold leading-snug sm:text-base">{p.title}</span>
                <span className="text-[13px] text-muted">
                  {active && <span className="font-bold text-ink">Showing · </span>}
                  {statusOf(state.votes[p.id])}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[15px] leading-relaxed text-muted">
          Proposal {proposal.n} sits in <span className="font-bold text-ink">{DOMAIN_LABEL[domain]}</span>: Points earned
          there count {weight(ON_DOMAIN_WEIGHT)}, Points in the three other domains count {weight(OFF_DOMAIN_WEIGHT)}. Each
          proposal keeps its own votes when you switch.
        </p>
        <p className="sr-only" aria-live="polite">
          Showing proposal {proposal.n}, {DOMAIN_LABEL[domain]}. Contributors are sorted by power on this proposal.
        </p>
      </Panel>

      <Panel title="How power is computed" meta={<SampleTag label="Sample parameters" />}>
        <dl className="space-y-3 font-mono text-[13px] leading-relaxed sm:text-sm">
          <div>
            <dt className="text-muted">Effective Points</dt>
            <dd>
              = Points in the proposal&apos;s domain {weight(ON_DOMAIN_WEIGHT)} + Points in all other domains{" "}
              {weight(OFF_DOMAIN_WEIGHT)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Voting power</dt>
            <dd>= √ effective Points</dd>
          </div>
        </dl>
        <p className="text-[15px] leading-relaxed">
          Power grows slower than Points: four times the effective Points gives only twice the power, so volume alone does
          not decide.
        </p>
        <WorkedExample c={example} domain={domain} n={proposal.n} />
        <p className="text-sm text-muted">
          The weights {ON_DOMAIN_WEIGHT.toFixed(1)} and {OFF_DOMAIN_WEIGHT}, the square root and the {QUORUM_PERCENT}%
          quorum are sample parameters chosen for this demo.
        </p>
      </Panel>

      <Panel title={`Contributors, by power on proposal ${proposal.n}`} meta={<SampleTag />}>
        <Legend domain={domain} />
        {closedWhy && (
          <p id={closedId} className="text-sm text-muted">
            {closedWhy}
          </p>
        )}
        <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_auto] gap-5 px-1 font-mono text-[11px] font-bold uppercase tracking-wider text-muted @3xl:grid">
          <span>Contributor · Points by domain</span>
          <span className="text-right">Power</span>
          <span className="w-[24rem]">Vote</span>
        </div>
        <ol className="divide-y divide-line border-y border-line">
          {order.map((c) => (
            <ContributorRow
              key={c.handle}
              c={c}
              domain={domain}
              rank={rankOf(order, c.handle)}
              proposal={selected}
              n={proposal.n}
              state={state}
              dispatch={dispatch}
              closedId={closedWhy ? closedId : undefined}
            />
          ))}
        </ol>
      </Panel>

      <Panel
        title={`Live tally, proposal ${proposal.n}`}
        meta={t.quorumMet ? <Badge tone="success">Quorum met</Badge> : <Badge tone="warning">Below quorum</Badge>}
      >
        <div>
          <div className="relative pt-6">
            <span
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-wider text-muted"
              style={{ left: `${QUORUM_PERCENT}%` }}
            >
              Quorum {QUORUM_PERCENT}%
            </span>
            <div className="flex h-6 overflow-hidden rounded-md bg-raised" aria-hidden="true">
              <div className="bg-success transition-[width] motion-reduce:transition-none" style={{ width: share(t.for) }} />
              <div className="bg-danger transition-[width] motion-reduce:transition-none" style={{ width: share(t.against) }} />
              <div className="hatch text-muted transition-[width] motion-reduce:transition-none" style={{ width: share(t.abstain) }} />
            </div>
            <div className="absolute bottom-[-4px] top-5 w-0.5 bg-ink" style={{ left: `${QUORUM_PERCENT}%` }} aria-hidden="true" />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <Stat swatch="bg-success" label="For" value={t.for} />
            <Stat swatch="bg-danger" label="Against" value={t.against} />
            <Stat swatch="hatch text-muted ring-1 ring-inset ring-line-strong" label="Abstain" value={t.abstain} />
            <Stat swatch="bg-raised ring-1 ring-inset ring-line-strong" label="Not voted" value={t.total - t.cast} />
          </dl>
          <p className="mt-4 text-sm text-muted">
            Cast {formatPower(t.cast)} of {formatPower(t.total)} power ({((t.cast / t.total) * 100).toFixed(1)}%). Quorum
            needs {formatPower(t.quorum)}, which is {QUORUM_PERCENT}% of the power available on this proposal.
          </p>
        </div>

        <div className="rounded-lg bg-canvas px-4 py-4 text-[15px] leading-relaxed sm:px-5">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted">
              {vote.closed ? "Same ballots counted as 1 Point = 1 vote" : "If closed now, counted as 1 Point = 1 vote"}
            </span>
            <Badge tone={OUTCOME_TONE[cmp.pointsOutcome]}>{OUTCOME_LABEL[cmp.pointsOutcome]}</Badge>
          </p>
          <p className="mt-1 font-mono text-[13px] text-muted">
            For {formatAmount(cmp.points.for)} · Against {formatAmount(cmp.points.against)} · Abstain{" "}
            {formatAmount(cmp.points.abstain)} of {formatAmount(cmp.points.total)} Points, quorum{" "}
            {formatAmount(cmp.points.quorum)}
          </p>
          <p className="mt-2">
            {cmp.differs
              ? `The two rules disagree here: with Proof of Love the proposal ${OUTCOME_VERB[cmp.loveOutcome]}, with 1 Point = 1 vote it ${OUTCOME_VERB[cmp.pointsOutcome]}.`
              : `Both rules agree on these ballots: the proposal ${OUTCOME_VERB[cmp.loveOutcome]} either way.`}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2 border-t border-line pt-5">
          <ActionButton variant="primary" {...act({ type: "closeVote", proposal: selected })}>
            Close vote
          </ActionButton>
          <ActionButton {...act({ type: "reopenVote", proposal: selected })}>Reopen</ActionButton>
        </div>

        {vote.outcome && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Outcome</span>
            <Badge tone={OUTCOME_TONE[vote.outcome]}>{OUTCOME_LABEL[vote.outcome]}</Badge>
          </div>
        )}
      </Panel>

      <Panel title="Moderators" meta={<Badge tone="warning">Final word</Badge>}>
        <p className="text-[15px] leading-relaxed text-muted">
          A passed vote goes to moderators, who adopt or veto it. A veto needs no other input: it is simply recorded next
          to the advisory result, and both stay visible.
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <ActionButton variant="primary" {...act({ type: "decide", proposal: selected, decision: "adopted" })}>
            Adopt
          </ActionButton>
          <ActionButton variant="danger" {...act({ type: "decide", proposal: selected, decision: "vetoed" })}>
            Veto
          </ActionButton>
        </div>
        {vote.decision && (
          <Callout
            tone={vote.decision === "adopted" ? "success" : "danger"}
            title={vote.decision === "adopted" ? `Proposal ${proposal.n} adopted by moderators` : `Proposal ${proposal.n} vetoed by moderators`}
          >
            {vote.decision === "adopted"
              ? "The advisory result becomes the rule change. Contributors advised, moderators decided."
              : "The proposal passed the advisory vote and was vetoed. The record shows both, so the disagreement is visible rather than silent."}
          </Callout>
        )}
      </Panel>
    </div>
  );
}

function ContributorRow({
  c,
  domain,
  rank,
  proposal,
  n,
  state,
  dispatch,
  closedId,
}: {
  c: Contributor;
  domain: Domain;
  rank: number;
  proposal: ProposalId;
  n: number;
  state: State;
  dispatch: Dispatch<Action>;
  closedId: string | undefined;
}) {
  const raw = rankOf(RAW, c.handle);
  const on = c.points[domain];
  const off = totalPoints(c) - on;
  const shift = rank < raw ? "text-success" : rank > raw ? "text-warning" : "text-muted";
  const current = state.votes[proposal].choices[c.handle];

  return (
    <li className="grid gap-3 px-1 py-4 @3xl:grid-cols-[minmax(0,1fr)_8.5rem_auto] @3xl:items-center @3xl:gap-5">
      <div className="min-w-0 space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-mono text-sm font-bold">{c.handle}</span>
          <span className="text-sm text-muted">{c.profile}</span>
        </p>
        <div className="flex items-center gap-3">
          <PointsBar c={c} domain={domain} />
          <span className="w-[4.5rem] shrink-0 text-right font-mono text-xs tabular-nums text-muted">
            {formatAmount(totalPoints(c))} pts
          </span>
        </div>
        <p className="font-mono text-xs leading-snug text-muted">
          {formatAmount(on)} {DOMAIN_LABEL[domain]} {weight(ON_DOMAIN_WEIGHT)} + {formatAmount(off)} other{" "}
          {weight(OFF_DOMAIN_WEIGHT)} = <span className="text-ink">{formatAmount(effectivePoints(c, domain))} effective</span>
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 @3xl:flex-col @3xl:items-end">
        <p className="font-mono text-xl font-bold tabular-nums">
          {formatPower(votingPower(c, domain))}
          <span className="ml-1.5 text-xs font-medium text-muted @3xl:sr-only">power</span>
        </p>
        <p className={`font-mono text-xs tabular-nums ${shift}`}>
          raw #{raw} → here #{rank}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-4 @3xl:w-[24rem]" role="group" aria-label={`Vote of ${c.handle} on proposal ${n}`}>
        {CHOICES.map((choice) => {
          const selected = current === choice.value;
          const action: Action = { type: "castVote", proposal, handle: c.handle, choice: choice.value };
          const blocked = !selected && refusal(state, action) !== null;
          return (
            <button
              key={choice.value}
              type="button"
              aria-pressed={selected}
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? closedId : undefined}
              onClick={() => !selected && dispatch(action)}
              className={`min-h-11 whitespace-nowrap rounded-md border px-2 text-sm font-bold transition-colors motion-reduce:transition-none ${
                selected
                  ? `border-transparent ${choice.on}`
                  : blocked
                    ? "cursor-not-allowed border-transparent bg-raised text-muted"
                    : "border-line-strong text-ink hover:bg-raised"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}

function PointsBar({ c, domain }: { c: Contributor; domain: Domain }) {
  const label = DOMAINS.map((d) => `${DOMAIN_LABEL[d]} ${c.points[d]}`).join(", ");
  return (
    <div
      role="img"
      aria-label={`Points by domain: ${label}`}
      title={label}
      className="flex h-4 min-w-0 flex-1 gap-px overflow-hidden rounded-[3px] bg-canvas"
    >
      {DOMAINS.filter((d) => c.points[d] > 0).map((d) => (
        <span
          key={d}
          className={`h-full shrink-0 ${DOMAIN_FILL[d]} ${d === domain ? "text-accent" : "text-muted"}`}
          style={{ width: `${(c.points[d] / MAX_TOTAL) * 100}%` }}
        />
      ))}
    </div>
  );
}

function Legend({ domain }: { domain: Domain }) {
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Domains, in bar order">
        {DOMAINS.map((d) => (
          <li key={d} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-7 shrink-0 rounded-[3px] ${DOMAIN_FILL[d]} ${d === domain ? "text-accent" : "text-muted"}`}
            />
            <span className={d === domain ? "font-bold text-ink" : "text-muted"}>{DOMAIN_LABEL[d]}</span>
            <span className="font-mono text-xs text-muted">{weight(domainWeight(d, domain))}</span>
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-snug text-muted">
        Bar length is a contributor&apos;s total Points (the longest is {formatAmount(MAX_TOTAL)}). Segments follow the
        order above, and the proposal&apos;s domain is drawn in orange.
      </p>
    </div>
  );
}

function DomainTag({ domain }: { domain: Domain }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] font-bold uppercase leading-none tracking-wider text-ink">
      <span aria-hidden="true" className={`inline-block size-2.5 rounded-[2px] text-ink ${DOMAIN_FILL[domain]}`} />
      {DOMAIN_LABEL[domain]}
    </span>
  );
}

function WorkedExample({ c, domain, n }: { c: Contributor; domain: Domain; n: number }) {
  const on = c.points[domain];
  const others: number[] = DOMAINS.filter((d) => d !== domain).map((d) => c.points[d]);
  const offEffective = others.reduce((a, b) => a + b, 0) * OFF_DOMAIN_WEIGHT;
  const eff = effectivePoints(c, domain);
  return (
    <p className="rounded-lg bg-canvas px-4 py-3 font-mono text-[13px] leading-relaxed">
      <span className="text-muted">
        Example, {c.handle} on proposal {n} ({DOMAIN_LABEL[domain]}):
      </span>{" "}
      {formatAmount(on)} {weight(ON_DOMAIN_WEIGHT)} + ({others.map(formatAmount).join(" + ")}) {weight(OFF_DOMAIN_WEIGHT)} ={" "}
      {formatAmount(on)} + {formatAmount(offEffective)} = {formatAmount(eff)} effective Points, and √{formatAmount(eff)} ={" "}
      <span className="font-bold text-accent">{formatPower(votingPower(c, domain))}</span> power.
    </p>
  );
}

function Stat({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-muted">
        <span className={`inline-block size-3 shrink-0 rounded-[3px] ${swatch}`} />
        {label}
      </dt>
      <dd className="mt-0.5 font-mono tabular-nums">{formatPower(value)}</dd>
    </div>
  );
}
