"use client";

import { type Dispatch, type FormEvent, useId, useState } from "react";
import { formatUsdc, usdc } from "@/lib/pools/math";
import { type Action, type Domain, type FunderId, type Handle, type Kind, type State, CONTRIBUTORS, DEFAULT_FUNDING_DAYS, DOMAINS, DOMAIN_LABEL, FUNDERS, refusal } from "@/lib/pools/sim";
import { Callout } from "../ui";
import { LABEL } from "./parts";

const FIELD = "min-h-11 w-full rounded-md border border-input-border bg-raised px-3 text-ink placeholder:text-faint";

const whole = (text: string): bigint => {
  const n = Number(text.replace(/[,\s]/g, ""));
  return Number.isSafeInteger(n) && n > 0 ? usdc(n) : 0n;
};

const WAYS: { kind: Kind; title: string; text: string }[] = [
  { kind: "request", title: "I need it built", text: "A funder posts a need and puts in the first pledge." },
  { kind: "proposal", title: "I want to build it", text: "A contributor proposes a build and a budget, with no money down." },
];

export function NewPoolForm({ state, dispatch, onCreated }: { state: State; dispatch: Dispatch<Action>; onCreated: (id: number) => void }) {
  const id = useId();
  const [kind, setKind] = useState<Kind>("request");
  const [funder, setFunder] = useState<FunderId>("company-b");
  const [contributor, setContributor] = useState<Handle>("contributor-c");
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState<Domain>("data");
  const [target, setTarget] = useState("20000");
  const [opening, setOpening] = useState("5000");
  const [fundingDays, setFundingDays] = useState(String(DEFAULT_FUNDING_DAYS));
  const [touched, setTouched] = useState(false);

  const common = { title, domain, target: whole(target), fundingDays: Number(fundingDays) };
  const action: Action =
    kind === "request"
      ? { type: "propose", kind: "request", by: funder, ...common, openingPledge: whole(opening) }
      : { type: "propose", kind: "proposal", by: contributor, ...common };
  const why = refusal(state, action);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    dispatch(action);
    if (why) return;
    onCreated(state.pools.length + 1);
    setTitle("");
    setTouched(false);
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl bg-surface p-5 sm:p-8" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-[15px] font-bold text-muted">
        Open a new pool
      </h3>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Direction">
        {WAYS.map((way) => {
          const active = way.kind === kind;
          return (
            <button
              key={way.kind}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(way.kind)}
              className={`rounded-lg p-4 text-left transition-colors motion-reduce:transition-none ${
                active ? "bg-raised ring-2 ring-inset ring-accent" : "ring-1 ring-inset ring-line-strong hover:bg-raised"
              }`}
            >
              <span className="block font-bold">{way.title}</span>
              <span className="mt-1 block text-sm leading-snug text-muted">{way.text}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={LABEL}>What should be built</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Open-source alternative to a tool your team pays for"
            className={`mt-1.5 ${FIELD}`}
          />
        </label>
        <label className="block">
          <span className={LABEL}>{kind === "request" ? "Requested by" : "Proposed by"}</span>
          {kind === "request" ? (
            <select value={funder} onChange={(e) => setFunder(e.target.value as FunderId)} className={`mt-1.5 font-mono ${FIELD}`}>
              {FUNDERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id} · wallet {formatUsdc(state.wallets[f.id])}
                </option>
              ))}
            </select>
          ) : (
            <select value={contributor} onChange={(e) => setContributor(e.target.value as Handle)} className={`mt-1.5 font-mono ${FIELD}`}>
              {CONTRIBUTORS.map((c) => (
                <option key={c.handle} value={c.handle}>
                  {c.handle} · {c.profile}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="block">
          <span className={LABEL}>Domain</span>
          <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)} className={`mt-1.5 ${FIELD}`}>
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {DOMAIN_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>Budget, in USDC</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" className={`mt-1.5 font-mono ${FIELD}`} />
        </label>
        <label className="block">
          <span className={LABEL}>Funding window, in days</span>
          <input value={fundingDays} onChange={(e) => setFundingDays(e.target.value)} inputMode="numeric" className={`mt-1.5 font-mono ${FIELD}`} />
        </label>
        {kind === "request" && (
          <label className="block">
            <span className={LABEL}>First pledge, in USDC</span>
            <input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="numeric" className={`mt-1.5 font-mono ${FIELD}`} />
          </label>
        )}
      </div>

      {touched && why && (
        <Callout tone="danger" title="Not opened">
          {why.text}
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-[22px] py-2 text-base font-bold leading-tight text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed motion-reduce:transition-none"
        >
          {kind === "request" ? "Open the request" : "Propose the build"}
        </button>
        <p className="max-w-md text-sm leading-snug text-muted">Either way, contributors vote on listing it before anyone else can pledge.</p>
      </div>
    </form>
  );
}
