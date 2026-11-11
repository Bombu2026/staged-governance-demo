"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { SESSION_STORAGE_KEY } from "@/lib/devnet/constants";
import { ActionButton, Badge, Panel } from "../ui";

export interface DevnetEvent {
  actor: string;
  text: string;
  refusal: string | null;
  signature: string | null;
  time: string;
}

export const SAFETY_LINE =
  "Devnet only. Devnet SOL has no value. This page never asks for a seed phrase or private key, and cannot send a mainnet transaction.";

// The Solana and Squads libraries load only once the visitor opens live mode.
const LiveDevnet = dynamic(() => import("./live-devnet").then((m) => m.LiveDevnet), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">Loading the Solana libraries…</p>,
});

function hasSavedDemo(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function DevnetPanel({ onEvent }: { onEvent: (event: DevnetEvent) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasSavedDemo()) setOpen(true);
  }, []);

  return (
    <Panel
      title="Run it for real on Solana devnet"
      meta={<Badge tone="accent">Live · devnet</Badge>}
      className="ring-1 ring-inset ring-accent/40"
    >
      <p className="rounded-lg bg-canvas px-4 py-3 font-mono text-[13px] leading-relaxed text-warning">{SAFETY_LINE}</p>
      <p className="max-w-prose leading-relaxed">
        The same story as the simulation above, enforced by a real program: a Squads v4 multisig on Solana devnet with
        2-of-3 approval and a 60 s time lock, where you hold one key in Phantom. This page adds no smart contract of its
        own; every refusal you will see comes from the audited Squads program.
      </p>
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        Slop&apos;s vault contracts run on Base, Ethereum, Robinhood Chain and Solana. This live example uses the Solana side; on the
        three EVM networks the same guard is a multisig wallet with a timelock in front of the upgrade key.
      </p>
      {open ? (
        <LiveDevnet onEvent={onEvent} />
      ) : (
        <ActionButton variant="primary" why={null} onClick={() => setOpen(true)}>
          Start the live devnet demo
        </ActionButton>
      )}
    </Panel>
  );
}
