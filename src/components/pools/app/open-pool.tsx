"use client";

import { useState } from "react";
import { formatUsdc, usdc } from "@/lib/pools/math";
import { type Domain, type Kind, DOMAINS, DOMAIN_LABEL } from "@/lib/pools/sim";
import type { Engine, ProposeInput } from "./engine";
import { CmdButton, LABEL } from "./parts";

const SIDES: { kind: Kind; who: string; title: string; text: string; money: string }[] = [
  {
    kind: "request",
    who: "I am a company",
    title: "Request a build",
    text: "You need a piece of open-source software. You set the budget and put in the first pledge. Other companies with the same need add theirs.",
    money: "First pledge required",
  },
  {
    kind: "proposal",
    who: "I am a contributor",
    title: "Propose a build",
    text: "You offer to build something and name the budget it takes. Companies that want it fill the pool. It needs Points from accepted work.",
    money: "No money down",
  },
];

const SAMPLE: Record<Kind, { title: string; target: string; domain: Domain }> = {
  request: { title: "Open-source PDF signing service for EU e-signatures", target: "40000", domain: "apps" },
  proposal: { title: "Open-source rebuild of a hosted status page", target: "25000", domain: "infra" },
};

const FIELD = "mt-1.5 h-[52px] w-full rounded-md border border-input-border bg-canvas px-4 text-base outline-none focus:border-accent";
const toUsdc = (text: string) => {
  const whole = Number(text.replace(/[^0-9]/g, ""));
  return Number.isSafeInteger(whole) && whole > 0 ? usdc(whole) : 0n;
};

export function OpenPool({ engine, initial, onDone }: { engine: Engine; initial: Kind | null; onDone: (id: number) => void }) {
  // A company persona or a wallet without Points starts on the request side; a contributor on the proposal side.
  const [kind, setKind] = useState<Kind>(initial ?? (engine.me.points && engine.mode === "demo" ? "proposal" : "request"));
  const [title, setTitle] = useState(SAMPLE[kind].title);
  const [domain, setDomain] = useState<Domain>(SAMPLE[kind].domain);
  const [target, setTarget] = useState(SAMPLE[kind].target);
  const [opening, setOpening] = useState("10000");
  const [window, setWindow] = useState(engine.defaultWindow);
  const [sending, setSending] = useState(false);

  function pick(next: Kind) {
    if (next === kind) return;
    // Keep what the visitor typed; only swap the untouched samples.
    if (title === SAMPLE[kind].title) setTitle(SAMPLE[next].title);
    if (target === SAMPLE[kind].target) setTarget(SAMPLE[next].target);
    if (domain === SAMPLE[kind].domain) setDomain(SAMPLE[next].domain);
    setKind(next);
  }

  const input: ProposeInput = { kind, title, domain, target: toUsdc(target), window, openingPledge: kind === "request" ? toUsdc(opening) : 0n };
  const why = sending ? "Sending…" : engine.proposeWhy(input);
  const submit = {
    why,
    run: () => {
      if (sending) return;
      setSending(true);
      void engine
        .propose(input)
        .then((id) => id !== null && onDone(id))
        .finally(() => setSending(false));
    },
  };

  return (
    <div className="pb-16 pt-8 sm:pb-24 sm:pt-12">
      <a href="#/" className="inline-flex items-center gap-2 text-[15px] font-bold text-muted hover:text-ink">
        <span aria-hidden="true">←</span> All pools
      </a>
      <h1 className="display mt-6 text-[clamp(2.25rem,5vw,4.25rem)] leading-[0.88]">Open a pool</h1>
      <p className="mt-4 max-w-[40rem] text-lg leading-relaxed text-muted">It works in both directions. Either way, contributors vote on listing it before any company can pledge.</p>

      <div role="radiogroup" aria-label="Who opens the pool" className="mt-8 grid gap-4 md:grid-cols-2">
        {SIDES.map((side) => {
          const on = side.kind === kind;
          return (
            <button
              key={side.kind}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(side.kind)}
              className={`rounded-xl p-6 text-left transition-colors motion-reduce:transition-none sm:p-8 ${on ? "bg-surface ring-2 ring-inset ring-accent" : "bg-surface/60 ring-1 ring-inset ring-line hover:bg-surface"}`}
            >
              <span className={`flex items-center gap-2 ${LABEL}`}>
                <span aria-hidden="true" className={`size-2 rounded-full ${side.kind === "request" ? "bg-accent" : "bg-ink"}`} />
                {side.who}
              </span>
              <span className="mt-3 block text-2xl font-extrabold tracking-[-0.02em]">{side.title}</span>
              <span className="mt-2 block text-[15px] leading-relaxed text-muted">{side.text}</span>
              <span className="mt-4 block font-mono text-xs font-bold uppercase tracking-wider text-ink">{side.money}</span>
            </button>
          );
        })}
      </div>

      <form
        className="mt-8 max-w-[44rem] space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit.run();
        }}
      >
        <label className="block">
          <span className={LABEL}>What should be built</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} aria-label="Title of the build" className={FIELD} />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Domain</span>
            <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)} aria-label="Domain" className={FIELD}>
              {DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {DOMAIN_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Funding window</span>
            <select value={window} onChange={(e) => setWindow(e.target.value)} aria-label="Funding window" className={FIELD}>
              {engine.windows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Budget in USDC</span>
            <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Budget in USDC" className={`${FIELD} font-mono font-bold tabular-nums`} />
          </label>
          {kind === "request" && (
            <label className="block">
              <span className={LABEL}>Your first pledge in USDC</span>
              <input inputMode="numeric" value={opening} onChange={(e) => setOpening(e.target.value)} aria-label="Your first pledge in USDC" className={`${FIELD} font-mono font-bold tabular-nums`} />
            </label>
          )}
        </div>
        <p className="text-[15px] leading-relaxed text-muted">
          You are <span className="font-mono font-bold text-ink">{engine.me.name}</span>
          {engine.me.usdc !== null && kind === "request" ? `, holding ${formatUsdc(engine.me.usdc)} USDC` : ""}. The domain decides whose vote weighs most: Points earned on it count in full, Points earned elsewhere count a quarter.
        </p>
        <CmdButton cmd={submit} variant="primary">
          {kind === "request" ? "Open the request" : "Propose the build"}
        </CmdButton>
        {(kind === "request" ? engine.hints.request : engine.hints.proposal) && <p className="text-[13px] text-muted">{kind === "request" ? engine.hints.request : engine.hints.proposal}</p>}
      </form>
    </div>
  );
}
