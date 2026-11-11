"use client";

import Link from "next/link";
import { VOTING_DAYS } from "@/lib/pools/sim";
import { SHELL, SiteFooter, SiteHeader } from "../site-header";
import { Badge, Panel, SampleTag } from "../ui";
import { useVault, VaultHeaderButton, VaultHeroButton, VaultHost } from "../vault/vault-launcher";

const WAYS = [
  {
    tag: "Company request",
    dot: "bg-accent",
    title: "A company needs it built",
    text: "It posts the need and a budget, and puts in the first pledge. Other companies with the same need add theirs.",
    sample: "Sample: e-invoicing engine, 50,000 USDC, opened by company-a with 10,000.",
  },
  {
    tag: "Contributor proposal",
    dot: "bg-ink",
    title: "Contributors offer to build it",
    text: "A contributor with Points proposes a build and a budget, with no money down. Funders who want it fill the pool.",
    sample: "Sample: rebuild of a hosted feature-flag service, 30,000 USDC.",
  },
];

const STEPS = [
  { n: "01", title: "Propose", text: "A request with a first pledge, or a contributor proposal with none." },
  { n: "02", title: "Contributors vote", text: "A Proof of Love vote lists the pool, or not. Power comes from Points, never from money." },
  { n: "03", title: "The pool fills, or not", text: "Funders pledge until the deadline. Pledges are locked, so the total is real." },
  { n: "04", title: "Paid by Points, or refunded", text: "Full: the build launches and accepted work is paid. Not full: every pledge goes back." },
];

const RULES = [
  { rule: "All or nothing", text: "A pool launches only when it holds its full target. One unit short and the launch is refused.", error: "TargetNotReached" },
  { rule: "Refund in full", text: "Not listed, missed its target or closed by vote: each funder gets back exactly what they put in, with no fee. Anyone can trigger a refund and it can only go to the funder.", error: "RefundNotAvailable" },
  { rule: "Pledges are locked while the pool is open", text: "Nobody can pull out before the deadline, so funders can trust the total they see. A pledge larger than what is missing is cut down to it.", error: "PoolFull" },
  { rule: "Contributors list the pool", text: "Only accounts with Points vote. Power is the square root of effective Points on the pool's domain, with a 40% quorum. Money has no vote.", error: "NoVotingPower" },
  { rule: "A stalled build can be closed", text: "Before payout, a funder or a contributor can ask for a closure vote. If it passes, the whole pool is refunded. No payout while it is open, and a failed vote cannot be asked again right away.", error: "ClosureVoteOpen" },
  { rule: "Paid by share of project Points", text: "The record of accepted work comes from the steward, as Slop's scoring does today. The split, the 2% fee and the rounding are computed by the contract.", error: "NoAcceptedWork" },
  { rule: "No admin key", text: "The contract has no owner, no pause and no upgrade path. Its address is derived from its bytecode, so what is deployed is what is in the repository.", error: "immutable" },
];

const QUESTIONS = [
  { q: "Who accepts the work on a pooled build?", detail: "Maintainers named in the proposal, the funders, or a contributor vote. The demo takes the record as given, like a monthly allocation today." },
  { q: "One payout, or monthly cycles?", detail: "The demo pays the pool once. Paying in cycles with a cap, as Slop's monthly pools do, would let a closure vote return only what is unspent." },
  { q: "Should Points be snapshotted per vote?", detail: "Here a ballot uses the voter's Points at the moment it is cast, and the quorum uses the power available when the vote opened." },
  { q: "What if a launched build is never paid or closed?", detail: "The pool stays locked. A production version needs a rule for that, such as a build deadline after which funders can leave." },
  { q: "What are pledges, legally?", detail: "Pooled money from companies raises invoicing, tax and custody questions that a testnet demo does not answer." },
];

const SOURCES = {
  filing: "https://blockworks.com/token-transparency/filing/slop-cash",
  projects: "https://slop.cash/api/v1/projects",
  auction: "https://cryptobriefing.com/slop-cash-from-elizaos-creator-shaw-walters-opens-public-bidding-on-umia-after-passing-its-400k-minimum/",
};

const LINK = "underline decoration-line-strong underline-offset-[3px] hover:decoration-accent";

function Source({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

export function HowItWorks() {
  const vault = useVault();
  return (
    <>
      <SiteHeader current="how">
        <VaultHeaderButton vault={vault} />
      </SiteHeader>

      <main className={SHELL}>
        <section className="py-14 sm:py-[88px]">
          <h1 className="display text-[clamp(2.5rem,7vw,5.75rem)] leading-[0.86]">
            <span className="block">One pool.</span>
            <span className="block text-accent">Two ways in.</span>
          </h1>
          <p className="mt-8 max-w-[44rem] text-lg leading-relaxed text-muted sm:mt-10 sm:text-xl">
            Several companies need the same open-source software. Each pledges a share of the budget. If the pool is full by its deadline, the
            build starts on Slop and contributors are paid by Points. If it is not, every pledge goes back.
          </p>

          <div className="mt-10 grid gap-5 sm:mt-14 md:grid-cols-2">
            {WAYS.map((way) => (
              <div key={way.tag} className="rounded-xl bg-surface p-6 sm:p-8">
                <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-muted">
                  <span aria-hidden="true" className={`inline-block size-2 rounded-full ${way.dot}`} />
                  {way.tag}
                </p>
                <p className="mt-3 text-2xl font-extrabold leading-tight tracking-[-0.02em]">{way.title}</p>
                <p className="mt-3 max-w-prose leading-relaxed text-muted">{way.text}</p>
                <p className="mt-4 border-t border-line pt-4 text-sm text-muted">{way.sample}</p>
              </div>
            ))}
          </div>

          <ol className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-xl border border-line p-5 sm:p-6">
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-accent">Step {step.n}</p>
                <p className="mt-2 text-lg font-bold leading-snug">{step.title}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href="/"
              className="inline-flex min-h-12 items-center rounded-md bg-accent px-[22px] text-base font-bold text-on-accent transition-colors hover:bg-accent-hover motion-reduce:transition-none"
            >
              Try it on the pools page
            </Link>
            <VaultHeroButton vault={vault} />
            <p className="max-w-[26rem] text-[15px] leading-snug text-muted">
              The vault holds the research notes behind the governance rules. The staged path for the keys that guard the money is on the{" "}
              <Link href="/governance" className={LINK}>
                Governance page
              </Link>
              .
            </p>
          </div>
        </section>

        <section aria-labelledby="rules-title" className="border-t border-line py-14 sm:py-24">
          <h2 id="rules-title" className="display text-[clamp(1.875rem,4vw+0.75rem,3.125rem)] leading-[0.9]">
            The rules
          </h2>
          <p className="mt-4 max-w-[44rem] text-[15px] leading-relaxed text-muted">
            The simulation and the contract follow the same seven rules. A test replays one story on both and compares every vote,
            status, payout and refund. In the contract each refusal has a name, shown here in orange.
          </p>
          <ul className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {RULES.map((r) => (
              <li key={r.rule} className="rounded-xl bg-surface p-5 sm:p-6">
                <p className="text-lg font-bold leading-snug">{r.rule}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{r.text}</p>
                <p className="mt-3 font-mono text-xs font-bold text-accent">{r.error}</p>
              </li>
            ))}
            <li className="rounded-xl border border-dashed border-line-strong p-5 sm:p-6">
              <p className="flex flex-wrap items-center gap-2 text-lg font-bold leading-snug">
                Sample parameters <SampleTag label="Demo values" />
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Quorum 40%. Points in the domain × 1.0, elsewhere × 0.25, then a square root. Votes last {VOTING_DAYS} days, pools
                30 days by default. Fee 2% of the payout. In production each would change only by vote.
              </p>
            </li>
          </ul>
        </section>

        <section aria-labelledby="slop-title" className="border-t border-line py-14 sm:py-24">
          <h2 id="slop-title" className="display text-[clamp(1.875rem,4vw+0.75rem,3.125rem)] leading-[0.9]">
            Where it meets Slop today
          </h2>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <ul className="divide-y divide-line border-y border-line">
              <li className="px-2 py-[18px]">
                <p className="text-lg font-bold leading-snug">Same payout, more funders</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  Today one project owner funds a monthly pool and accepted work is paid by Points, less a 2% fee. A pooled build
                  keeps that payout and only changes who fills the pool and what happens when it is not filled.
                </p>
              </li>
              <li className="px-2 py-[18px]">
                <p className="text-lg font-bold leading-snug">An EVM contract, tried on Base</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  Slop&apos;s vault contracts are deployed on Base, Ethereum, Solana and Robinhood Chain, and most listed pools are in
                  USDC on Base (18 of 33 on 11 November 2026). The demo contract is plain Solidity, so the same bytecode runs on
                  the three EVM networks. The live mode uses Base Sepolia.
                </p>
              </li>
              <li className="px-2 py-[18px]">
                <p className="text-lg font-bold leading-snug">It leaves $SLOP alone</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  $SLOP lives on Robinhood Chain and steers the treasury through decision markets; it has no say over payouts,
                  scores or merges. Proof of Love here is a separate contributor vote with two powers only: list a pool, and
                  close one before it is paid.
                </p>
              </li>
              <li className="px-2 py-[18px]">
                <p className="text-lg font-bold leading-snug">A rule Slop already used once</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  The $SLOP auction had a minimum raise: below it, every bid would have been refunded in full. This applies the
                  same rule to a build.
                </p>
              </li>
            </ul>
            <div>
              <Panel title="Open questions" meta={<Badge tone="warning">Not settled here</Badge>}>
                <ul className="divide-y divide-line border-y border-line">
                  {QUESTIONS.map(({ q, detail }) => (
                    <li key={q} className="px-2 py-4">
                      <p className="font-bold leading-snug">{q}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-muted">{detail}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                Sources: Slop&apos;s <Source href={SOURCES.filing}>token transparency filing</Source> (self-reported, as of 25 October
                2026), the public <Source href={SOURCES.projects}>project list on slop.cash</Source>, and the{" "}
                <Source href={SOURCES.auction}>auction press release</Source> of 7 November 2026.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter>
        <p className="mt-1">Companies, contributors, wallets and Points are sample data. The contracts are not audited.</p>
      </SiteFooter>
      <VaultHost vault={vault} />
    </>
  );
}
