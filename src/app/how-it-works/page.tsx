import type { Metadata } from "next";
import { HowItWorks } from "@/components/pools/how-it-works";

export const metadata: Metadata = {
  title: "How pooled funding works: a concept demo for Slop",
  description:
    "The rules of the pooled funding concept: a company request or a contributor proposal, a Proof of Love listing vote, an all-or-nothing pool, a payout by Points or a refund in full. Not affiliated with or endorsed by slop.cash.",
};

export default function HowItWorksPage() {
  return <HowItWorks />;
}
