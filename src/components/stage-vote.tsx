"use client";

import { type Dispatch, useId } from "react";
import {
  type Action,
  type Choice,
  type State,
  CONTRIBUTORS,
  OUTCOME_LABEL,
  PROPOSAL_TITLE,
  QUORUM_PERCENT,
  formatAmount,
  refusal,
  tally,
} from "@/lib/governance";
import { ActionButton, Badge, Callout, Panel, SampleTag, bind } from "./ui";

const CHOICES: { value: Choice; label: string; on: string }[] = [
  { value: "for", label: "For", on: "bg-success text-on-accent" },
  { value: "against", label: "Against", on: "bg-danger text-on-accent" },
  { value: "abstain", label: "Abstain", on: "bg-muted text-on-accent" },
  { value: "none", label: "Not voted", on: "bg-ink/20 text-ink" },
];

export function StageVote({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const act = bind(state, dispatch);
  const { vote } = state;
  const t = tally(vote.choices);
  const share = (n: number) => `${(n / t.total) * 100}%`;
  const closedId = useId();

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-lg leading-relaxed">
        Contributors whose work has been accepted vote on rule changes, weighted by the Points that work earned. At this
        stage the vote is advisory: it gives moderators a measured signal, and moderators keep the final word.
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
        <h3 className="text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">{PROPOSAL_TITLE}</h3>
        <p className="text-[15px] leading-relaxed text-muted">
          Weight is accepted-work Points. Quorum is {QUORUM_PERCENT}% of all Points cast as For, Against or Abstain. The
          proposal passes when For outweighs Against.
        </p>
      </Panel>

      <Panel title="Contributors" meta={<SampleTag />}>
        {vote.closed && (
          <p id={closedId} className="text-sm text-muted">
            The vote is closed. Reopen it to change votes.
          </p>
        )}
        <ul className="divide-y divide-line border-y border-line">
          {CONTRIBUTORS.map((c) => (
            <li
              key={c.handle}
              className="flex flex-col gap-3 px-2 py-[18px] @2xl:flex-row @2xl:items-center @2xl:justify-between"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-sm font-bold">{c.handle}</span>
                <span className="font-mono text-sm tabular-nums text-muted">{formatAmount(c.points)} Points</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-4" role="group" aria-label={`Vote of ${c.handle}`}>
                {CHOICES.map((choice) => {
                  const selected = vote.choices[c.handle] === choice.value;
                  const action: Action = { type: "castVote", handle: c.handle, choice: choice.value };
                  const blocked = !selected && refusal(state, action) !== null;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={blocked || undefined}
                      aria-describedby={blocked ? closedId : undefined}
                      onClick={() => !selected && dispatch(action)}
                      className={`min-h-11 rounded-md border px-3 text-sm font-bold transition-colors motion-reduce:transition-none ${
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
          ))}
        </ul>
      </Panel>

      <Panel
        title="Live tally"
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
            Cast {formatAmount(t.cast)} of {formatAmount(t.total)} Points ({((t.cast / t.total) * 100).toFixed(1)}%).
            Quorum needs {formatAmount(t.quorum)}.
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2 border-t border-line pt-5">
          <ActionButton variant="primary" {...act({ type: "closeVote" })}>
            Close vote
          </ActionButton>
          <ActionButton {...act({ type: "reopenVote" })}>Reopen</ActionButton>
        </div>

        {vote.outcome && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Outcome</span>
            <Badge tone={vote.outcome === "passed" ? "success" : vote.outcome === "rejected" ? "danger" : "warning"}>
              {OUTCOME_LABEL[vote.outcome]}
            </Badge>
          </div>
        )}
      </Panel>

      <Panel title="Moderators" meta={<Badge tone="warning">Final word</Badge>}>
        <p className="text-[15px] leading-relaxed text-muted">
          A passed vote goes to moderators, who adopt or veto it. A veto needs no other input: it is simply recorded next
          to the advisory result, and both stay visible.
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <ActionButton variant="primary" {...act({ type: "decide", decision: "adopted" })}>
            Adopt
          </ActionButton>
          <ActionButton variant="danger" {...act({ type: "decide", decision: "vetoed" })}>
            Veto
          </ActionButton>
        </div>
        {vote.decision && (
          <Callout
            tone={vote.decision === "adopted" ? "success" : "danger"}
            title={vote.decision === "adopted" ? "Adopted by moderators" : "Vetoed by moderators"}
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

function Stat({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-muted">
        <span className={`inline-block size-3 shrink-0 rounded-[3px] ${swatch}`} />
        {label}
      </dt>
      <dd className="mt-0.5 font-mono tabular-nums">{formatAmount(value)}</dd>
    </div>
  );
}
