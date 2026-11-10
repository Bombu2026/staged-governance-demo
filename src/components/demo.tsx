"use client";

import { type KeyboardEvent, useReducer, useState } from "react";
import { initialState, reduce } from "@/lib/governance";
import { EventLog } from "./event-log";
import { StageToken } from "./stage-token";
import { StageUpgrade } from "./stage-upgrade";
import { StageVote } from "./stage-vote";
import { useVault, VaultHeaderButton, VaultHeroButton, VaultHost } from "./vault/vault-launcher";

const NOTICE =
  "Independent concept demo made for the Slop team. Everything is simulated in your browser: no wallet, no chain, no funds. Not affiliated with or endorsed by slop.cash.";

const STAGES = [
  { id: "upgrade", n: 1, title: "Guard the upgrade key", note: "Simulated" },
  { id: "vote", n: 2, title: "Advisory contributor vote", note: "Simulated" },
  { id: "token", n: 3, title: "Token governance", note: "Design question" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

const SHELL = "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-12 xl:px-16";

export function Demo() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [stage, setStage] = useState<StageId>("upgrade");
  const vault = useVault();

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = STAGES.findIndex((s) => s.id === stage);
    const next = STAGES[(i + (e.key === "ArrowRight" ? 1 : STAGES.length - 1)) % STAGES.length];
    setStage(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <>
      <div className="sticky top-0 z-30">
        <div className="bg-raised text-ink">
          <p role="note" className={`${SHELL} py-2 text-xs leading-snug sm:text-[13px]`}>
            <span className="mr-2 inline-block rounded-full bg-accent px-2 py-[3px] align-[1px] font-mono text-[10px] font-bold uppercase leading-none tracking-wider text-on-accent">
              Simulation
            </span>
            {NOTICE}
          </p>
        </div>
        <header className="border-b border-line bg-[rgba(15,14,12,0.88)] backdrop-blur-md">
          <div className={`${SHELL} flex h-14 items-center justify-between gap-4 sm:h-[88px]`}>
            <p className="whitespace-nowrap text-lg font-extrabold leading-none tracking-[-0.03em] sm:text-[22px]">
              Governance concept
            </p>
            <div className="flex min-w-0 items-center gap-3 sm:gap-6">
              <p className="min-w-0 text-right text-xs leading-tight text-muted sm:whitespace-nowrap sm:text-[13px]">
                by Bombu2026 · unofficial
              </p>
              <VaultHeaderButton vault={vault} />
            </div>
          </div>
        </header>
      </div>

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
                  {s.id === "upgrade" && <StageUpgrade state={state} dispatch={dispatch} />}
                  {s.id === "vote" && <StageVote state={state} dispatch={dispatch} />}
                  {s.id === "token" && <StageToken />}
                </div>
              ))}
            </div>
            <EventLog log={state.log} />
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
