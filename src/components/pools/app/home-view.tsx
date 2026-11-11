"use client";

import { useState } from "react";
import { CHAIN_NAME } from "@/lib/pools/chain/constants";
import { formatUsdc, percentOf } from "@/lib/pools/math";
import { type Kind, DOMAIN_LABEL } from "@/lib/pools/sim";
import { PoolProgress, STATUS_TONE, StatusBadge } from "../parts";
import { Activity } from "./activity";
import type { Engine, PoolVM } from "./engine";
import { Arrow, CmdButton, KIND_NAME, KindTag, LABEL, LinkButton } from "./parts";

const FILTERS: { id: "all" | Kind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "request", label: "Company requests" },
  { id: "proposal", label: "Contributor proposals" },
];

function PoolCard({ pool }: { pool: PoolVM }) {
  const held = pool.pledged - pool.refunded;
  return (
    <a
      href={`#/pool/${pool.id}`}
      aria-label={`Pool ${pool.id}: ${pool.title}`}
      className="group flex min-w-0 flex-col rounded-xl bg-surface p-6 transition-colors hover:bg-raised motion-reduce:transition-none sm:p-8"
    >
      <span className="flex items-center justify-between gap-3">
        <KindTag kind={pool.kind} />
        <span className="text-muted transition-colors group-hover:text-ink motion-reduce:transition-none">
          <Arrow />
        </span>
      </span>
      <span className="mt-4 block text-[22px] font-extrabold leading-[1.15] tracking-[-0.02em] sm:text-2xl">{pool.title}</span>
      <span className="mt-2 block text-[15px] text-muted">
        {pool.kind === "request" ? "Requested by" : "Proposed by"} {pool.proposer.you ? "you" : pool.proposer.name} · {DOMAIN_LABEL[pool.domain]}
      </span>
      <span className="mt-auto block pt-8">
        <span className="flex items-baseline gap-2">
          <span className="text-[40px] font-extrabold leading-none tracking-[-0.03em] tabular-nums sm:text-[44px]">{formatUsdc(pool.target)}</span>
          <span className="text-sm font-bold text-muted">USDC</span>
        </span>
        <span className="mt-4 block">
          <PoolProgress pledged={pool.pledged} target={pool.target} refunded={pool.refunded} tone={STATUS_TONE[pool.status] === "danger" ? "danger" : "accent"} />
        </span>
        <span className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="font-mono text-[13px] tabular-nums text-muted">
            <span className="font-bold text-ink">{formatUsdc(held)}</span> in the pool · {Math.floor(percentOf(held, pool.target))}%
          </span>
          <StatusBadge status={pool.status} />
        </span>
        <span className={`mt-3 block ${LABEL}`}>{pool.clock}</span>
      </span>
    </a>
  );
}

export function HomeView({ engine, modeLine }: { engine: Engine; modeLine: string }) {
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const shown = engine.pools.filter((p) => filter === "all" || p.kind === filter);
  const count = (id: "all" | Kind) => engine.pools.filter((p) => id === "all" || p.kind === id).length;

  return (
    <>
      <section className="pb-14 pt-12 sm:pb-20 sm:pt-[88px]">
        <h1 className="display text-[clamp(2.75rem,8.2vw,6.75rem)] leading-[0.84]">
          <span className="block">Fund it together.</span>
          <span className="block text-accent">All or nothing.</span>
        </h1>
        <p className="mt-8 max-w-[42rem] text-lg leading-relaxed text-muted sm:mt-10 sm:text-xl">
          Companies pool a budget for the open-source software they all need. Contributors vote to list it. Full by the deadline: it is built and paid
          by Points. Not full: every pledge goes back.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
          <LinkButton href="#/new/request" variant="primary">
            Request a build
          </LinkButton>
          <LinkButton href="#/new/proposal">Propose a build</LinkButton>
        </div>
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${engine.mode === "live" ? "bg-success" : "bg-warning"}`} />
          {modeLine}
        </p>
      </section>

      <section aria-labelledby="pools-title" className="pb-16 sm:pb-24">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
          <h2 id="pools-title" className="display text-[clamp(2.5rem,6vw,5.4rem)] leading-[0.86]">
            Pools
          </h2>
          <a
            href="#/new"
            className="inline-flex min-h-12 items-center gap-2 whitespace-nowrap rounded-md bg-accent px-[22px] text-base font-bold text-on-accent transition-colors hover:bg-accent-hover motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              +
            </span>
            Open a pool
          </a>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div role="group" aria-label="Filter pools" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`min-h-10 rounded-full px-4 text-[15px] font-bold transition-colors motion-reduce:transition-none ${
                  filter === f.id ? "bg-ink text-canvas" : "bg-surface text-muted hover:text-ink"
                }`}
              >
                {f.label} <span className="font-mono text-xs tabular-nums opacity-70">{count(f.id)}</span>
              </button>
            ))}
          </div>
          {engine.controls && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[13px] font-bold">{engine.controls.title}</p>
              {engine.controls.items.map((item) => (
                <CmdButton key={item.label} cmd={item.cmd} small>
                  {item.label}
                </CmdButton>
              ))}
            </div>
          )}
        </div>

        {shown.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line-strong p-8 text-center sm:p-12">
            <p className="text-xl font-bold">{filter === "all" ? "No pool yet" : `No ${KIND_NAME[filter].toLowerCase()} yet`}</p>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">Open one: a company asks for a build and puts in the first pledge, or a contributor offers to build something with no money down.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((pool) => (
              <PoolCard key={pool.id} pool={pool} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="activity-title" className="border-t border-line py-14 sm:py-20">
        <h2 id="activity-title" className="display text-[clamp(1.75rem,3.4vw,2.75rem)] leading-[0.9]">
          Activity
        </h2>
        <p className="mt-3 max-w-[40rem] text-[15px] leading-relaxed text-muted">
          Every action lands here, refused ones included.{" "}
          {engine.mode === "live" ? `Each line links to its transaction on ${CHAIN_NAME}.` : "Blocked buttons still take a click, so you can read why the rules refuse."}
        </p>
        <div className="mt-6 max-h-[34rem] overflow-y-auto rounded-xl">
          <Activity items={engine.log} limit={80} empty={engine.mode === "live" ? "Nothing yet in this session." : "Nothing yet. Open a pool, pledge, vote, or move the clock."} />
        </div>
      </section>
    </>
  );
}
