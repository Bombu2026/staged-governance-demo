"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { CHAIN_NAME, SESSION_STORAGE_KEY } from "@/lib/pools/chain/constants";
import { ActionButton, Badge, Panel } from "../../ui";

export interface LiveEvent {
  actor: string;
  text: string;
  refusal: string | null;
  // Link to the transaction on the block explorer, when one was sent.
  href: string | null;
  time: string;
}

export const SAFETY_LINE =
  "Base Sepolia testnet only. Testnet ETH and demo USDC have no value. This page never asks for a seed phrase, a private key or a message signature, and sends nothing while your wallet is on another network.";

// viem and the contract ABIs load only once the visitor opens live mode.
const LivePools = dynamic(() => import("./live-pools").then((m) => m.LivePools), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">Loading the wallet and contract code…</p>,
});

function hasSavedDemo(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function LivePanel({ onEvent }: { onEvent: (event: LiveEvent) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasSavedDemo()) setOpen(true);
  }, []);

  return (
    <Panel title={`Run it for real on ${CHAIN_NAME}`} meta={<Badge tone="accent">Live · testnet</Badge>} className="ring-1 ring-inset ring-accent/40">
      <p className="rounded-lg bg-canvas px-4 py-3 font-mono text-[13px] leading-relaxed text-warning">{SAFETY_LINE}</p>
      <p className="max-w-prose leading-relaxed">
        The same rules, enforced by a contract instead of this page. You connect a wallet such as Phantom and play one funder; throwaway
        keys generated in this tab play the other companies and the contributors. Every confirmed or refused transaction lands in the
        event log with a link to the block explorer.
      </p>
      {open ? (
        <LivePools onEvent={onEvent} />
      ) : (
        <ActionButton variant="primary" why={null} onClick={() => setOpen(true)}>
          Start the live testnet demo
        </ActionButton>
      )}
    </Panel>
  );
}
