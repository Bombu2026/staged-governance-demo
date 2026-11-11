"use client";

import { CHAIN_NAME, FAUCET_URL, PHANTOM_URL, WALLET_HELP_URL } from "@/lib/pools/chain/constants";
import { explorerAddressUrl, formatEth, shortenAddress } from "@/lib/pools/chain/format";
import type { WalletOption } from "@/lib/pools/chain/wallet";
import { formatUsdc } from "@/lib/pools/math";
import { Chevron, LABEL, Menu } from "./parts";
import { type Persona, PERSONAS } from "./use-demo-engine";
import type { Live } from "./use-live";

const CHIP = "inline-flex h-10 min-w-0 items-center gap-2 whitespace-nowrap rounded-md border border-line-strong px-3 text-[15px] font-bold transition-colors hover:bg-raised motion-reduce:transition-none";
const CONNECT = "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-md bg-ink px-4 text-[15px] font-bold text-canvas transition-colors hover:bg-ink/85 motion-reduce:transition-none sm:px-[18px]";
const ROW = "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[15px] transition-colors hover:bg-raised motion-reduce:transition-none";
const LINK = "underline decoration-line-strong underline-offset-[3px] hover:decoration-accent";

function WalletIcon({ icon, name }: { icon: string | null; name: string }) {
  // The icon is an inline image announced by the wallet itself, so nothing is fetched.
  // eslint-disable-next-line @next/next/no-img-element
  if (icon) return <img src={icon} alt="" className="size-5 shrink-0 rounded-[5px]" />;
  return (
    <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-accent text-[11px] font-extrabold text-on-accent">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function TestnetHelp() {
  return (
    <p className="text-[13px] leading-relaxed text-muted">
      In Phantom: Settings → Developer Settings, turn on Testnet Mode and choose {CHAIN_NAME} (
      <a href={WALLET_HELP_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
        how
      </a>
      ). You need a little {CHAIN_NAME} ETH for gas, free from a{" "}
      <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
        faucet
      </a>
      . This page never asks for a seed phrase, a private key or a message signature.
    </p>
  );
}

function PersonaMenu({
  persona,
  onPick,
  balanceOf,
  onReset,
  others,
  onConnect,
}: {
  persona: Persona;
  onPick: (id: Persona) => void;
  balanceOf: (id: Persona) => string;
  onReset: () => void;
  others: WalletOption[];
  onConnect: (option: WalletOption) => void;
}) {
  return (
    <Menu
      label={`Acting as ${persona}. Change sample person`}
      buttonClass={CHIP}
      button={
        <>
          <span className="hidden text-muted lg:inline">Acting as</span>
          <span className="font-mono text-[13px]">{persona}</span>
          <Chevron />
        </>
      }
    >
      {(close) => (
        <div className="max-h-[70dvh] space-y-3 overflow-y-auto">
          <p className="text-[13px] leading-relaxed text-muted">Sample people, sample money. Act as a company to request a build and pledge, or as a contributor to propose a build and vote.</p>
          {(["company", "contributor"] as const).map((side) => (
            <div key={side}>
              <p className={LABEL}>{side === "company" ? "Companies" : "Contributors"}</p>
              <ul className="mt-1">
                {PERSONAS.filter((p) => p.side === side).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={p.id === persona}
                      onClick={() => {
                        onPick(p.id);
                        close();
                      }}
                      className={`${ROW} ${p.id === persona ? "bg-raised" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-[13px] font-bold">{p.id}</span>
                        <span className="block truncate text-[13px] text-muted">{p.profile}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{balanceOf(p.id)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="border-t border-line pt-3">
            <button
              type="button"
              onClick={() => {
                onReset();
                close();
              }}
              className={`${ROW} font-bold`}
            >
              Reset the sample data
            </button>
            {others.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onConnect(option);
                  close();
                }}
                className={`${ROW} font-bold`}
              >
                <span className="flex items-center gap-2">
                  <WalletIcon icon={option.icon} name={option.name} />
                  Connect {option.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Menu>
  );
}

export function WalletMenu({
  live,
  persona,
  onPersona,
  balanceOf,
  onReset,
}: {
  live: Live;
  persona: Persona;
  onPersona: (id: Persona) => void;
  balanceOf: (id: Persona) => string;
  onReset: () => void;
}) {
  if (live.wallet) {
    const { wallet } = live;
    const points = live.points;
    return (
      <Menu
        label={`Wallet ${shortenAddress(wallet.address)} on ${CHAIN_NAME}`}
        buttonClass={CHIP}
        button={
          <>
            <WalletIcon icon={wallet.icon} name={wallet.name} />
            <span className="font-mono text-[13px]">{shortenAddress(wallet.address)}</span>
            <Chevron />
          </>
        }
      >
        {(close) => (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <WalletIcon icon={wallet.icon} name={wallet.name} />
                {wallet.name}
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-success">
                <span aria-hidden="true" className="size-2 rounded-full bg-success" />
                {CHAIN_NAME}
              </p>
            </div>
            <a href={explorerAddressUrl(wallet.address)} target="_blank" rel="noopener noreferrer" className={`block break-all font-mono text-[13px] ${LINK}`}>
              {wallet.address}
            </a>
            <dl className="divide-y divide-line border-y border-line text-[15px]">
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Testnet ETH</dt>
                <dd className="font-mono tabular-nums">{live.eth === null ? "…" : formatEth(live.eth)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Demo USDC</dt>
                <dd className="font-mono tabular-nums">{live.usdc === null ? "…" : formatUsdc(live.usdc)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Points (apps, data, infra, security)</dt>
                <dd className="font-mono tabular-nums">{points ? points.join(" · ") : "…"}</dd>
              </div>
            </dl>
            <p className="text-[13px] leading-relaxed text-muted">
              {live.spaceId === null ? "No sandbox yet." : `Your sandbox is space #${live.spaceId} of the demo contract.`} Testnet ETH and demo USDC have no value.
            </p>
            {live.lowKeys && live.phase === "ready" && (
              <button
                type="button"
                onClick={() => {
                  live.topUp();
                  close();
                }}
                className={`${ROW} bg-warning/12 font-bold text-warning`}
              >
                Top up the demo keys (they are low on gas)
              </button>
            )}
            <div className="border-t border-line pt-2">
              <button
                type="button"
                onClick={() => {
                  live.startOver();
                  close();
                }}
                className={`${ROW} font-bold`}
              >
                Start over with a new sandbox
              </button>
              <button
                type="button"
                onClick={() => {
                  live.disconnect();
                  close();
                }}
                className={`${ROW} font-bold`}
              >
                Disconnect and go back to sample data
              </button>
            </div>
          </div>
        )}
      </Menu>
    );
  }

  const phantom = live.wallets?.find((w) => /phantom/i.test(w.name)) ?? null;
  const others = (live.wallets ?? []).filter((w) => w !== phantom);
  return (
    <>
      <PersonaMenu persona={persona} onPick={onPersona} balanceOf={balanceOf} onReset={onReset} others={phantom ? others : []} onConnect={live.connect} />
      {phantom ? (
        <button type="button" onClick={() => live.connect(phantom)} aria-busy={live.connecting} className={CONNECT}>
          <WalletIcon icon={phantom.icon} name={phantom.name} />
          <span>
            {live.connecting ? "Connecting…" : "Connect"}
            <span className="hidden sm:inline"> Phantom</span>
          </span>
        </button>
      ) : (
        <Menu
          label="Connect a wallet"
          buttonClass={CONNECT}
          button={
            <span>
              Connect<span className="hidden sm:inline"> wallet</span>
            </span>
          }
        >
          {(close) => (
            <div className="space-y-3">
              <p className="text-[15px] font-bold">Run it for real on {CHAIN_NAME}</p>
              {others.length === 0 ? (
                <p className="text-[15px] leading-relaxed">
                  {live.wallets === null ? "Looking for a wallet…" : "No wallet found in this browser. "}
                  {live.wallets !== null && (
                    <a href={PHANTOM_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                      Get Phantom
                    </a>
                  )}
                </p>
              ) : (
                <ul>
                  {others.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => {
                          live.connect(option);
                          close();
                        }}
                        className={`${ROW} font-bold`}
                      >
                        <span className="flex items-center gap-2">
                          <WalletIcon icon={option.icon} name={option.name} />
                          Connect {option.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <TestnetHelp />
            </div>
          )}
        </Menu>
      )}
    </>
  );
}

export { TestnetHelp };
