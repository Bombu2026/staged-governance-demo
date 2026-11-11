"use client";

import { type KeyboardEvent, useCallback, useReducer, useState } from "react";
import { type Action, type State, initialState, reduce } from "@/lib/governance";
import { explorerTxUrl } from "@/lib/devnet/format";
import { type DevnetEvent, DevnetPanel } from "./devnet/devnet-panel";
import { type LogItem, EventLog } from "./event-log";
import { SHELL, SiteHeader } from "./site-header";
import { StageToken } from "./stage-token";
import { StageUpgrade } from "./stage-upgrade";
import { StageVote } from "./stage-vote";
import { useVault, VaultHeaderButton, VaultHeroButton, VaultHost } from "./vault/vault-launcher";

const NOTICE =
  "Independent concept demo made for the Slop team. The simulation runs in your browser; the optional live mode uses Solana devnet only, where SOL has no value. Not affiliated with or endorsed by slop.cash.";

const STAGES = [
  { id: "upgrade", n: 1, title: "Guard the upgrade key", note: "Simulated" },
  { id: "vote", n: 2, title: "Proof of Love vote", note: "Simulated" },
  { id: "token", n: 3, title: "Token governance", note: "Design question" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

type DemoAction = Action | { type: "devnet"; event: DevnetEvent };

// Live devnet events only append to the shared log; every simulated action still goes through `reduce`.
function reduceDemo(state: State, action: DemoAction): State {
  if (action.type !== "devnet") return reduce(state, action);
  const { time, signature, ...entry } = action.event;
  return { ...state, log: [...state.log, { seq: state.log.length + 1, hour: state.clock, ...entry, devnet: { time, signature } }] };
}

const toLogItem = (e: State["log"][number]): LogItem => ({
  seq: e.seq,
  stamp: `h${String(e.hour).padStart(3, "0")}`,
  actor: e.actor,
  text: e.text,
  refusal: e.refusal,
  live: e.devnet && {
    network: "Devnet",
    time: e.devnet.time,
    href: e.devnet.signature ? explorerTxUrl(e.devnet.signature) : null,
    linkLabel: "View transaction on Solana Explorer (devnet)",
  },
});

export function Demo() {
  const [state, dispatch] = useReducer(reduceDemo, initialState);
  const [stage, setStage] = useState<StageId>("upgrade");
  const vault = useVault();
  const onDevnetEvent = useCallback((event: DevnetEvent) => dispatch({ type: "devnet", event }), []);

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = STAGES.findIndex((s) => s.id === stage);
    const next = STAGES[(i + (e.key === "ArrowRight" ? 1 : STAGES.length - 1)) % STAGES.length];
    setStage(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <>
      <SiteHeader current="governance" notice={NOTICE}>
        <VaultHeaderButton vault={vault} />
      </SiteHeader>

      <main className={SHELL}>
        <section className="py-14 sm:py-24">
          <p className="text-[15px] font-bold text-muted">Companion to a one-page governance proposal</p>
          <h1 className="display mt-5 text-[clamp(2.5rem,6.4vw+0.5rem,4.625rem)] leading-[0.86]">
            <span className="block">Staged governance</span>
            <span className="block text-accent">No single key.</span>
          </h1>
          <p className="mt-8 max-w-[46rem] text-lg leading-relaxed text-muted sm:mt-10 sm:text-xl">
            The proposal suggests three stages of checks on who can change the code and the rules that sit around
            funders&apos; money on an open-source bounty platform. Each tab below lets you try one stage. All people,
            balances and Points are sample data.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-10">
            <VaultHeroButton vault={vault} />
            <p className="max-w-[28rem] text-[15px] leading-snug text-muted">
              The research notes behind the proposal: a read-only snapshot of the author&apos;s vault on DAO governance.
            </p>
          </div>
        </section>

        <section aria-labelledby="stages-title" className="border-t border-line py-14 sm:py-24">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
            <h2 id="stages-title" className="display text-[clamp(1.875rem,4vw+0.75rem,3.125rem)] leading-[0.9]">
              Try each stage
            </h2>
            <button
              type="button"
              onClick={() => dispatch({ type: "reset" })}
              className="min-h-11 shrink-0 rounded-full bg-ink px-[22px] text-base font-bold text-canvas transition-colors hover:bg-ink/85 motion-reduce:transition-none"
            >
              Reset demo
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Stages"
            onKeyDown={onTabKey}
            className="mt-8 grid grid-cols-3 gap-2 sm:mt-10 sm:gap-3"
          >
            {STAGES.map((s) => {
              const active = s.id === stage;
              return (
                <button
                  key={s.id}
                  id={`tab-${s.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${s.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setStage(s.id)}
                  className={`flex min-w-0 flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors motion-reduce:transition-none sm:p-5 ${
                    active ? "border-transparent bg-surface text-ink" : "border-line text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-[3px] w-8 rounded-full ${active ? "bg-accent" : "bg-line-strong"}`}
                  />
                  <span className={`font-mono text-[11px] font-bold uppercase tracking-wider ${active ? "text-accent" : ""}`}>
                    Stage {s.n} <span className="hidden sm:inline">· {s.note}</span>
                  </span>
                  <span className="text-[15px] font-bold leading-tight sm:text-lg">{s.title}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 grid gap-8 sm:mt-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              {STAGES.map((s) => (
                <div key={s.id} id={`panel-${s.id}`} role="tabpanel" aria-labelledby={`tab-${s.id}`} hidden={s.id !== stage}>
                  {s.id === "upgrade" && (
                    <div className="space-y-10">
                      <StageUpgrade state={state} dispatch={dispatch} />
                      <DevnetPanel onEvent={onDevnetEvent} />
                    </div>
                  )}
                  {s.id === "vote" && <StageVote state={state} dispatch={dispatch} />}
                  {s.id === "token" && <StageToken />}
                </div>
              ))}
            </div>
            <EventLog
              items={state.log.map(toLogItem)}
              empty="Nothing yet. Start in stage 1: try an upgrade with the single key, then switch to the proposed setup."
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${SHELL} py-10 text-sm leading-relaxed text-muted sm:py-14`}>
          <p>{NOTICE}</p>
          <p className="mt-1">
            Signers, contributors, balances and Points are sample data. State lives only in this tab and is gone on reload.
          </p>
        </div>
      </footer>
      <VaultHost vault={vault} />
    </>
  );
}
