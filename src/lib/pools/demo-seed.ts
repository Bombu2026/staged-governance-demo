// The sample pools the pools page starts with: one at each stage of the lifecycle, built by replaying
// real actions so every one of them obeys the rules. A test checks that none of the actions is refused.

import { usdc } from "./math";
import { type Action, type State, emptyState, reduce } from "./sim";

export const DEMO_SEED: Action[] = [
  // #1, a request that filled, was built and paid by Points.
  { type: "propose", kind: "request", by: "company-b", title: "Self-hosted status page with incident history", domain: "infra", target: usdc(15_000), fundingDays: 7, openingPledge: usdc(6_000) },
  { type: "vote", pool: 1, handle: "contributor-b", choice: "for" },
  { type: "vote", pool: 1, handle: "contributor-d", choice: "for" },
  { type: "vote", pool: 1, handle: "contributor-c", choice: "for" },
  { type: "finalize", pool: 1 },
  { type: "pledge", pool: 1, funder: "company-d", amount: usdc(9_000) },
  { type: "launch", pool: 1 },
  { type: "acceptWork", pool: 1 },
  { type: "acceptWork", pool: 1 },
  { type: "payOut", pool: 1 },
  // #2, a contributor proposal that missed its target: its only pledge went back in full.
  { type: "propose", kind: "proposal", by: "contributor-c", title: "Open-source catalog connector for Parquet data lakes", domain: "data", target: usdc(20_000), fundingDays: 7 },
  { type: "vote", pool: 2, handle: "contributor-c", choice: "for" },
  { type: "vote", pool: 2, handle: "contributor-d", choice: "for" },
  { type: "vote", pool: 2, handle: "contributor-e", choice: "for" },
  { type: "vote", pool: 2, handle: "contributor-a", choice: "against" },
  { type: "finalize", pool: 2 },
  { type: "pledge", pool: 2, funder: "company-c", amount: usdc(5_000) },
  { type: "advance", days: 8 },
  { type: "refund", pool: 2, funder: "company-c" },
  // #3, a company request that is listed and open for pledges.
  { type: "propose", kind: "request", by: "company-a", title: "Open-source e-invoicing engine for the EU formats", domain: "apps", target: usdc(50_000), fundingDays: 30, openingPledge: usdc(10_000) },
  { type: "vote", pool: 3, handle: "contributor-e", choice: "for" },
  { type: "vote", pool: 3, handle: "contributor-d", choice: "for" },
  { type: "vote", pool: 3, handle: "contributor-a", choice: "for" },
  { type: "vote", pool: 3, handle: "contributor-f", choice: "for" },
  { type: "vote", pool: 3, handle: "contributor-c", choice: "against" },
  { type: "finalize", pool: 3 },
  // #4, a contributor proposal whose listing vote is open.
  { type: "propose", kind: "proposal", by: "contributor-b", title: "Open-source rebuild of a hosted feature-flag service", domain: "infra", target: usdc(30_000), fundingDays: 30 },
  // #5, a request that filled and launched: work has been accepted, it is ready to be paid.
  { type: "propose", kind: "request", by: "company-c", title: "Open-source SSO bridge for SAML and OIDC", domain: "security", target: usdc(24_000), fundingDays: 30, openingPledge: usdc(8_000) },
  { type: "vote", pool: 5, handle: "contributor-a", choice: "for" },
  { type: "vote", pool: 5, handle: "contributor-d", choice: "for" },
  { type: "vote", pool: 5, handle: "contributor-b", choice: "for" },
  { type: "finalize", pool: 5 },
  { type: "pledge", pool: 5, funder: "company-b", amount: usdc(8_000) },
  { type: "pledge", pool: 5, funder: "company-d", amount: usdc(8_000) },
  { type: "launch", pool: 5 },
  { type: "acceptWork", pool: 5 },
];

export const seededState: State = DEMO_SEED.reduce(reduce, emptyState);
export const demoState: State = { ...seededState, log: [] };
