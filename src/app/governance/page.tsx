import type { Metadata } from "next";
import { Demo } from "@/components/demo";

export const metadata: Metadata = {
  title: "Staged governance: a concept demo for Slop",
  description:
    "Independent concept demo of a staged governance path: multisig and timelock on upgrades, an advisory Proof of Love vote, token governance later. The simulation runs in your browser; an optional live mode uses Solana devnet only. Not affiliated with or endorsed by slop.cash.",
};

export default function GovernancePage() {
  return <Demo />;
}
