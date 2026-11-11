"use client";

import { POOLS_ADDRESS, USDC_ADDRESS } from "@/lib/pools/chain/addresses";
import { CHAIN_NAME, FAUCET_URL } from "@/lib/pools/chain/constants";
import { explorerAddressUrl, formatEth, shortenAddress } from "@/lib/pools/chain/format";
import { Activity } from "./activity";
import { CmdButton } from "./parts";
import type { Live } from "./use-live";

const LINK = "underline decoration-line-strong underline-offset-[3px] hover:decoration-accent";

const STEPS = [
  "Send a little testnet ETH to throwaway demo keys, for their gas",
  "Create your own space on the demo contract",
  "Record sample Points for you and three sample contributors",
  "Mint 100,000 demo USDC to you and to two sample companies",
  "Open two sample pools, one per direction",
];

// Shown between connecting a wallet and seeing pools: one click sets up a private sandbox on the testnet.
export function SetupView({ live }: { live: Live }) {
  const busy = live.busy !== null;
  const wait = busy ? `${live.busy?.label}: ${live.busy?.stage === "wallet" ? "confirm in your wallet" : `waiting for ${CHAIN_NAME}`}` : null;
  const short = live.eth !== null && live.budget !== null && live.eth < live.budget;

  if (live.phase === "loading") {
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-bold">Reading {CHAIN_NAME}…</p>
        {live.rpcIssue && <p className="mx-auto mt-3 max-w-md text-[15px] text-warning">{live.rpcIssue} The page retries every few seconds.</p>}
      </div>
    );
  }

  return (
    <div className="pb-16 pt-12 sm:pb-24 sm:pt-[72px]">
      <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-success">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        Wallet connected on {CHAIN_NAME}
      </p>
      <h1 className="display mt-4 text-[clamp(2.25rem,5.4vw,4.5rem)] leading-[0.88]">{live.phase === "contracts" ? "Deploy the contracts" : "Set up your sandbox"}</h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          {live.phase === "contracts" ? (
            <>
              <p className="max-w-[40rem] text-lg leading-relaxed text-muted">
                The two demo contracts are not on this network yet. Two transactions deploy them once, for everyone, at addresses derived from their bytecode.
              </p>
              <div className="mt-6">
                <CmdButton cmd={{ why: wait, run: live.deploy }} variant="primary">
                  Deploy the contracts
                </CmdButton>
              </div>
            </>
          ) : (
            <>
              <p className="max-w-[40rem] text-lg leading-relaxed text-muted">
                One confirmation in your wallet. It sends {live.budget === null ? "a little" : `about ${formatEth(live.budget)}`} of testnet gas to throwaway keys generated in this tab. They play the other
                people of the demo, so you can see the whole story on a real network.
              </p>
              <ol className="mt-6 max-w-[40rem] divide-y divide-line rounded-xl bg-surface">
                {STEPS.map((step, i) => (
                  <li key={step} className="flex items-baseline gap-4 px-5 py-3.5 text-[15px]">
                    <span className="font-mono text-xs font-bold text-accent">{String(i + 1).padStart(2, "0")}</span>
                    {step}
                  </li>
                ))}
              </ol>
              <div className="mt-6">
                <CmdButton cmd={{ why: wait ?? (short ? `Your wallet holds ${formatEth(live.eth ?? 0n)}, less than the ${formatEth(live.budget ?? 0n)} this needs.` : null), run: live.setup }} variant="primary">
                  Set up the sandbox
                </CmdButton>
              </div>
              {short && (
                <p className="mt-3 text-[15px] text-muted">
                  Get free {CHAIN_NAME} ETH from a{" "}
                  <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                    faucet
                  </a>
                  .
                </p>
              )}
              <p className="mt-6 max-w-[40rem] text-sm leading-relaxed text-muted">
                It takes about a minute: around twenty transactions, all visible on the right. Your wallet signs only the first one. The page talks to two contracts only,{" "}
                <a href={explorerAddressUrl(POOLS_ADDRESS)} target="_blank" rel="noopener noreferrer" className={LINK}>
                  PooledFunding ({shortenAddress(POOLS_ADDRESS)})
                </a>{" "}
                and{" "}
                <a href={explorerAddressUrl(USDC_ADDRESS)} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Demo USDC ({shortenAddress(USDC_ADDRESS)})
                </a>
                , whose source is verified.
              </p>
            </>
          )}
          {live.rpcIssue && <p className="mt-4 text-[15px] text-warning">{live.rpcIssue} The page retries every few seconds.</p>}
        </div>
        <aside className="min-w-0">
          <p className="mb-2 text-sm font-bold text-muted">{busy ? "In progress" : "Activity"}</p>
          <Activity items={live.log} limit={8} compact empty="Transactions will show here, each with a link to the block explorer." />
        </aside>
      </div>
    </div>
  );
}
