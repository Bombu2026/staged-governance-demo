"use client";

import { type ReactNode, useState } from "react";
import { type Choice, FEE_BPS, castPower, finalVerdict, formatPower, formatUsdc, percentText, usdc } from "@/lib/pools/math";
import { DOMAIN_LABEL } from "@/lib/pools/sim";
import { Lifecycle, PoolProgress, STATUS_TONE, StatusBadge, TallyBar } from "../parts";
import { Activity } from "./activity";
import { type Engine, type PayoutVM, type PoolCmds, type PoolVM, refundable } from "./engine";
import { CmdButton, KindTag, LABEL, YouTag } from "./parts";

const CHOICES: { value: Choice; label: string; variant: "for" | "against" | "abstain" }[] = [
  { value: "for", label: "For", variant: "for" },
  { value: "against", label: "Against", variant: "against" },
  { value: "abstain", label: "Abstain", variant: "abstain" },
];

const FEE_PERCENT = `${Number(FEE_BPS) / 100}%`;

function Stat({ label, children, dot }: { label: string; children: ReactNode; dot?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-muted">
        {dot && <span aria-hidden="true" className="size-2 rounded-full bg-accent" />}
        {label}
      </p>
      <p className="mt-1.5 truncate font-mono text-xl font-bold tabular-nums sm:text-2xl">{children}</p>
    </div>
  );
}

function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="display text-2xl leading-none">{title}</h2>
        {meta && <p className="text-sm text-muted">{meta}</p>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Who({ name, you, note }: { name: string; you: boolean; note?: string }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold">{name}</span>
        {you && name !== "You" && <YouTag />}
      </span>
      {note && <span className="block truncate text-[13px] text-muted">{note}</span>}
    </span>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-surface p-5 sm:p-6">
      <h2 className="text-[15px] font-bold">{title}</h2>
      {hint && <p className="mt-1 text-[13px] leading-snug text-muted">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const Hint = ({ children }: { children: string }) => (children ? <p className="text-[13px] leading-snug text-muted">{children}</p> : null);

function story(pool: PoolVM): { title: string; text: string } {
  const held = pool.pledged - pool.refunded;
  switch (pool.status) {
    case "voting":
      return { title: "Listing vote open", text: "Contributors decide whether this pool is listed. Power comes from Points earned on accepted work, never from money. If it is listed, the funding window opens." };
    case "not-listed":
      return { title: "Not listed", text: `Contributors did not list this pool, so it never opened for pledges.${held > 0n ? " The first pledge is refundable." : ""}` };
    case "funding":
      return pool.pledged >= pool.target
        ? { title: "Full: ready to launch", text: "The pool holds its whole target. Anyone can launch the build." }
        : { title: "Open for pledges", text: "Any company can add to the pool until its deadline. Pledges are locked meanwhile, so the total everyone sees is real. One unit short at the deadline and every pledge goes back." };
    case "expired":
      return { title: "Missed its target", text: `The pool held ${formatUsdc(pool.pledged)} of ${formatUsdc(pool.target)} USDC at its deadline, so nothing was spent. Each funder gets back exactly what they put in, with no fee.` };
    case "building":
      return pool.vote
        ? { title: "Closure vote open", text: "A participant asked to close this build before payout. If the vote passes, the whole pool is refunded. No payout while it is open." }
        : { title: "Building", text: `The money is locked for the build. Accepted work earns project Points; the pool is then paid by share of those Points, less a ${FEE_PERCENT} fee.` };
    case "paid":
      return { title: "Paid by Points", text: `The pool went to contributors by share of project Points from accepted work. The fee is the ${FEE_PERCENT} Slop publishes for payouts.` };
    case "closed":
      return { title: "Closed by vote", text: "Contributors voted to close the build before it was paid. The whole pool goes back to the funders, with no fee." };
  }
}

function PayoutTable({ rows, fee, net }: { rows: PayoutVM[]; fee: bigint | null; net: bigint }) {
  const total = rows.reduce((sum, r) => sum + r.points, 0n);
  return (
    <div className="overflow-x-auto rounded-xl bg-surface">
      <table className="w-full min-w-[26rem] text-left text-[15px]">
        <thead>
          <tr className={`border-b border-line ${LABEL}`}>
            <th className="px-5 py-3 font-bold">Contributor</th>
            <th className="px-3 py-3 text-right font-bold">Project Points</th>
            <th className="px-3 py-3 text-right font-bold">Share</th>
            <th className="px-5 py-3 text-right font-bold">USDC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-5 py-3">
                <Who name={r.name} you={r.you} />
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">{r.points.toString()}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-muted">{percentText(r.points, total)}%</td>
              <td className="px-5 py-3 text-right font-mono font-bold tabular-nums">{formatUsdc(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line text-muted">
            <td className="px-5 py-3" colSpan={3}>
              To contributors{fee !== null ? `, after the ${FEE_PERCENT} fee of ${formatUsdc(fee)} USDC` : ""}
            </td>
            <td className="px-5 py-3 text-right font-mono font-bold tabular-nums text-ink">{formatUsdc(net)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function VoteBlock({ pool, cmds, engine }: { pool: PoolVM; cmds: PoolCmds; engine: Engine }) {
  if (!pool.vote) return null;
  return (
    <Card title={pool.vote.kind === "listing" ? "Your vote: list this pool?" : "Your vote: close this build?"} hint={cmds.myPower > 0n ? `Your voting power here is ${formatPower(cmds.myPower)}, the square root of your effective Points on ${DOMAIN_LABEL[pool.domain].toLowerCase()}.` : undefined}>
      <div role="group" aria-label="Your vote" className="grid grid-cols-3 gap-2">
        {CHOICES.map((c) => (
          <CmdButton key={c.value} cmd={cmds.vote(c.value)} variant={c.variant} pressed={cmds.myChoice === c.value} small full>
            {c.label}
          </CmdButton>
        ))}
      </div>
      <Hint>{engine.hints.vote}</Hint>
      <div className="border-t border-line pt-3">
        <CmdButton cmd={cmds.closeVote} full variant={cmds.closeVote.why === null ? "ink" : "secondary"}>
          Close the vote
        </CmdButton>
        <div className="mt-2">
          <Hint>{engine.hints.anyone}</Hint>
        </div>
      </div>
    </Card>
  );
}

function PledgeBlock({ pool, cmds, engine }: { pool: PoolVM; cmds: PoolCmds; engine: Engine }) {
  const room = pool.target - pool.pledged;
  const [text, setText] = useState("10000");
  const whole = Number(text.replace(/[^0-9]/g, ""));
  const amount = Number.isSafeInteger(whole) && whole > 0 ? usdc(whole) : 0n;
  const full = room <= 0n;
  const presets = [5_000, 10_000, 20_000].filter((n) => usdc(n) <= room);
  return (
    <Card title={full ? "The pool is full" : "Pledge to this pool"} hint={cmds.myPledge > 0n ? `You have ${formatUsdc(cmds.myPledge)} USDC in this pool.` : undefined}>
      {!full && (
        <>
          <label className="block">
            <span className={LABEL}>Amount in USDC</span>
            <input
              inputMode="numeric"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Amount to pledge, in USDC"
              className="mt-1.5 h-[52px] w-full rounded-md border border-input-border bg-canvas px-4 font-mono text-lg font-bold tabular-nums outline-none focus:border-accent"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {presets.map((n) => (
              <button key={n} type="button" onClick={() => setText(String(n))} className="min-h-9 rounded-full bg-raised px-3 font-mono text-xs font-bold tabular-nums hover:bg-line-strong">
                {n.toLocaleString("en-US")}
              </button>
            ))}
            <button type="button" onClick={() => setText((room / 1_000_000n).toString())} className="min-h-9 rounded-full bg-raised px-3 text-xs font-bold hover:bg-line-strong">
              What is missing
            </button>
          </div>
          <CmdButton cmd={cmds.pledge(amount)} variant="primary" full>
            Pledge {amount > 0n ? `${formatUsdc(amount)} USDC` : ""}
          </CmdButton>
          <Hint>{engine.hints.pledge}</Hint>
        </>
      )}
      <div className={full ? "" : "border-t border-line pt-3"}>
        <CmdButton cmd={cmds.launch} full variant={full ? "primary" : "secondary"}>
          Launch the build
        </CmdButton>
        <div className="mt-2">
          <Hint>{engine.hints.anyone}</Hint>
        </div>
      </div>
    </Card>
  );
}

export function PoolView({ engine, pool }: { engine: Engine; pool: PoolVM }) {
  const cmds = engine.cmds(pool);
  const held = pool.pledged - pool.refunded;
  const { title, text } = story(pool);
  const tone = STATUS_TONE[pool.status];
  const listed = !pool.listing.open ? finalVerdict(pool.listing) : null;
  const funders = pool.funders.filter((f) => f.amount > 0n);

  return (
    <div className="pb-16 pt-8 sm:pb-24 sm:pt-12">
      <a href="#/" className="inline-flex items-center gap-2 text-[15px] font-bold text-muted hover:text-ink">
        <span aria-hidden="true">←</span> All pools
      </a>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <KindTag kind={pool.kind} />
          <span className={LABEL}>{DOMAIN_LABEL[pool.domain]}</span>
          <StatusBadge status={pool.status} />
          <span className={LABEL}>Pool #{pool.id}</span>
        </div>
        <h1 className="display mt-4 max-w-[60rem] text-[clamp(1.875rem,4.2vw,3.5rem)] leading-[0.92]">{pool.title}</h1>
        <p className="mt-4 text-[17px] text-muted">
          {pool.kind === "request" ? "Requested by" : "Proposed by"} <span className="font-mono text-[15px] font-bold text-ink">{pool.proposer.you ? `${pool.proposer.name === "You" ? "you" : pool.proposer.name}` : pool.proposer.name}</span>
          {pool.proposer.you && pool.proposer.name !== "You" && (
            <>
              {" "}
              <YouTag />
            </>
          )}
          {pool.kind === "request" ? ", a company that needs it, with a first pledge." : ", a contributor, with no money down."}
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="vault-title">
            <h2 id="vault-title" className="display text-[clamp(1.5rem,2.6vw,2rem)] leading-none">
              Pool vault
            </h2>
            <div className="mt-5">
              <PoolProgress pledged={pool.pledged} target={pool.target} refunded={pool.refunded} tone={tone === "danger" ? "danger" : "accent"} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Stat label={pool.status === "paid" ? "Paid out" : "In the pool"} dot>
                {formatUsdc(held)} <span className="text-sm text-muted">USDC</span>
              </Stat>
              <Stat label="Target">
                {formatUsdc(pool.target)} <span className="text-sm text-muted">USDC</span>
              </Stat>
              <Stat label="Funders">{funders.length}</Stat>
              <Stat label="Clock">
                <span className="font-sans text-base sm:text-lg">{pool.clock}</span>
              </Stat>
            </div>
            <div className="mt-6">
              <Lifecycle status={pool.status} />
            </div>
            <div className={`mt-6 rounded-lg px-4 py-4 text-[15px] leading-relaxed sm:px-5 ${tone === "danger" ? "bg-danger/12" : tone === "success" ? "bg-success/12" : "bg-raised"}`}>
              <p className={`font-bold ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"}`}>{title}</p>
              <p className="mt-1">{text}</p>
            </div>
          </section>

          <Section title="Funders" meta={pool.refunded > 0n ? `${formatUsdc(pool.refunded)} USDC already refunded` : undefined}>
            {funders.length === 0 ? (
              <p className="rounded-xl bg-surface p-5 text-[15px] text-muted">{pool.refunded > 0n ? "Every pledge has been refunded." : pool.kind === "proposal" ? "Nobody has pledged yet. A proposal opens with no money down." : "Nobody has a pledge in this pool."}</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl bg-surface">
                {funders.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <Who name={f.name} you={f.you} note={f.note} />
                    <span className="shrink-0 font-mono font-bold tabular-nums">
                      {formatUsdc(f.amount)} <span className="text-sm font-medium text-muted">USDC</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={pool.vote?.kind === "closure" ? "Closure vote" : "Listing vote"} meta={pool.vote ? pool.vote.ends : listed ? (listed === "passed" ? "Listed by contributors" : "Not listed") : undefined}>
            <TallyBar tally={pool.vote?.tally ?? pool.listing} />
            {pool.vote ? (
              <ul className="mt-5 divide-y divide-line rounded-xl bg-surface">
                {pool.vote.voters.map((v) => (
                  <li key={v.name} className="flex items-center justify-between gap-4 px-5 py-3">
                    <Who name={v.name} you={v.you} note={v.note} />
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[13px] tabular-nums text-muted">power {formatPower(v.power)}</span>
                      <span className={`w-[4.5rem] text-right font-mono text-xs font-bold uppercase tracking-wider ${v.choice === "for" ? "text-success" : v.choice === "against" ? "text-danger" : "text-muted"}`}>
                        {v.choice ?? "not yet"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted">
                Final tally of the listing vote: {percentText(castPower(pool.listing), pool.listing.total)}% of contributor power was cast. A vote passes with a 40% quorum and more For than Against.
              </p>
            )}
          </Section>

          {(pool.payouts || pool.preview) && (
            <Section title={pool.payouts ? "Payout" : "If paid now"} meta={pool.payouts ? "Computed by the rules, not by hand" : "From the record of accepted work so far"}>
              {pool.payouts ? (
                <PayoutTable rows={pool.payouts} fee={pool.fee} net={pool.payouts.reduce((sum, p) => sum + p.amount, 0n)} />
              ) : (
                pool.preview && <PayoutTable rows={pool.preview.shares} fee={pool.preview.fee} net={pool.preview.net} />
              )}
            </Section>
          )}
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-36 lg:self-start">
          <p className="text-sm text-muted">
            You are <span className="font-mono font-bold text-ink">{engine.me.name}</span>. {engine.me.role}.
          </p>
          <VoteBlock pool={pool} cmds={cmds} engine={engine} />
          {pool.status === "funding" && <PledgeBlock pool={pool} cmds={cmds} engine={engine} />}
          {refundable(pool.status) && (
            <Card title="Refunds" hint="Anyone can trigger a refund. It can only go back to the funder who pledged, in full.">
              <CmdButton cmd={cmds.refund} variant="primary" full>
                Refund every pledge
              </CmdButton>
              <Hint>{engine.hints.anyone}</Hint>
            </Card>
          )}
          {pool.status === "building" && (
            <Card title="Pay the build" hint={pool.preview ? undefined : "Work has to be accepted first: it is what earns project Points."}>
              <CmdButton cmd={cmds.payOut} variant="primary" full>
                Pay contributors by Points
              </CmdButton>
              <Hint>{engine.hints.steward}</Hint>
              {!pool.vote && (
                <div className="border-t border-line pt-3">
                  <CmdButton cmd={cmds.askClosure} variant="danger" full>
                    Ask for a closure vote
                  </CmdButton>
                  <div className="mt-2">
                    <Hint>{engine.hints.closure}</Hint>
                  </div>
                </div>
              )}
            </Card>
          )}
          {pool.status === "paid" && (
            <Card title="Done">
              <p className="text-[15px] leading-relaxed text-muted">This pool was built and paid. Nothing is left in the contract for it.</p>
            </Card>
          )}

          {cmds.cast.length > 0 && (
            <section className="rounded-xl border border-dashed border-line-strong p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-[15px] font-bold">
                The rest of the cast <span className="rounded-full border border-dashed border-line-strong px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">Demo</span>
              </h2>
              <p className="mt-1 text-[13px] leading-snug text-muted">Other people would act on their own. Here you play them with one click.</p>
              <div className="mt-4 space-y-4">
                {cmds.cast.map((group) => (
                  <div key={group.title}>
                    <p className="text-sm font-bold">{group.title}</p>
                    <p className="text-[13px] leading-snug text-muted">{group.hint}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.items.map((item) => (
                        <CmdButton key={item.label} cmd={item.cmd} small>
                          {item.label}
                        </CmdButton>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div>
            <p className="mb-2 text-sm font-bold text-muted">Latest activity</p>
            <Activity items={engine.log} limit={4} compact empty="Nothing yet." />
          </div>
        </aside>
      </div>
    </div>
  );
}
