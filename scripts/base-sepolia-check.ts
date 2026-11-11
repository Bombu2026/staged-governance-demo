#!/usr/bin/env bun
// Proves the pool rules on the real Base Sepolia network, without a browser, with the client code the
// page uses. It deploys the two contracts if they are missing, creates throwaway keys, and plays three
// pools: paid out by Points, refunded after a missed target, and closed by vote. Every transaction is
// printed as a BaseScan link, refusals included, and the run ends with PASS or FAIL.
//
//   CHECK_PRIVATE_KEY=0x... bun run sepolia:check
//
// The key needs about 0.001 Base Sepolia ETH; what the throwaway keys do not spend is sent back to it.
// Use a key that only holds testnet ETH. RPC_URL may point at another Base Sepolia endpoint, or at a
// local chain with the same chain id and a block time (anvil --chain-id 84532 --block-time 1).

import type { Address, Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  approveTx,
  createSpaceTx,
  deployPoolsTx,
  deployUsdcTx,
  finalizeTx,
  launchTx,
  mintTx,
  openClosureTx,
  payOutTx,
  pledgeTx,
  poolIdFrom,
  proposeTx,
  readDeployment,
  readPool,
  refundTx,
  setPointsTx,
  spaceIdFrom,
  voteTx,
} from "../src/lib/pools/chain/actions";
import { POOLS_ADDRESS, USDC_ADDRESS } from "../src/lib/pools/chain/addresses";
import { gasBudgets } from "../src/lib/pools/chain/budget";
import { CHAIN_NAME, RPC_URL } from "../src/lib/pools/chain/constants";
import { type Sender, type SendResult, type TxRequest, createChainClient, keySender, run } from "../src/lib/pools/chain/core";
import { decodeError } from "../src/lib/pools/chain/errors";
import { explorerTxUrl, formatEth } from "../src/lib/pools/chain/format";
import { demoUsdcAbi } from "../src/lib/pools/generated/contracts";
import { type Points, formatUsdc, usdc } from "../src/lib/pools/math";

const VOTING_SECONDS = 60;
const SHORT_WINDOW = 30;
const LONG_WINDOW = 600;
const TARGET = usdc(50_000);

const key = process.env.CHECK_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set CHECK_PRIVATE_KEY to a 0x-prefixed private key that holds about 0.001 Base Sepolia ETH.");
  process.exit(1);
}

const local = process.env.RPC_URL !== undefined && process.env.RPC_URL !== RPC_URL;
const client = createChainClient(process.env.RPC_URL ?? RPC_URL, local ? 200 : 1_000);
const funded = keySender(client, key as Hex);
const fresh = () => keySender(client, generatePrivateKey());

const steward = fresh();
const contributors = { A: fresh(), B: fresh(), C: fresh() };
const companies = { A: fresh(), B: fresh(), C: fresh() };
const fees = fresh().address;
const everyone: [string, Sender][] = [
  ["steward", steward],
  ...Object.entries(contributors).map(([k, s]): [string, Sender] => [`contributor ${k}`, s]),
  ...Object.entries(companies).map(([k, s]): [string, Sender] => [`company ${k}`, s]),
];
const POINTS: Record<keyof typeof contributors, Points> = { A: [380, 40, 20, 120], B: [60, 240, 200, 240], C: [10, 20, 380, 30] };

let transactions = 0;
const link = (hash: Hex | null) => (hash && !local ? `  ${explorerTxUrl(hash)}` : "");

class CheckFailed extends Error {}

function fail(message: string): never {
  throw new CheckFailed(message);
}

async function ok(label: string, sender: Sender, tx: TxRequest): Promise<SendResult> {
  const result = await run(client, sender, tx);
  if (result.error || !result.hash) fail(`${label}: expected success, got ${result.error?.name ?? "no transaction"} (${result.error?.message ?? ""})`);
  transactions++;
  console.log(`  ok       ${label}${link(result.hash)}`);
  return result;
}

// Sends the refused call anyway, so the refusal is on-chain as a reverted transaction.
async function refused(label: string, sender: Sender, tx: TxRequest, name: string): Promise<void> {
  const result = await run(client, sender, tx, { evidence: true });
  if (result.error?.name !== name) fail(`${label}: expected the contract to refuse with ${name}, got ${result.error?.name ?? "success"}`);
  if (result.receipt?.status !== "reverted") fail(`${label}: the refused transaction did not revert on-chain`);
  transactions++;
  console.log(`  refused  ${label}: ${name}${link(result.hash)}`);
}

const balance = (who: Address) => client.readContract({ address: USDC_ADDRESS, abi: demoUsdcAbi, functionName: "balanceOf", args: [who] });

function same(label: string, actual: unknown, expected: unknown) {
  const show = (v: unknown) => (typeof v === "bigint" ? formatUsdc(v) : String(v));
  if (actual !== expected) fail(`${label}: expected ${show(expected)}, got ${show(actual)}`);
  console.log(`  checked  ${label}: ${show(actual)}`);
}

async function pledge(poolId: bigint, who: string, sender: Sender, amount: bigint) {
  await ok(`${who} approves exactly ${formatUsdc(amount)}`, sender, approveTx(amount));
  await ok(`${who} pledges ${formatUsdc(amount)}`, sender, pledgeTx(poolId, amount));
}

async function list(poolId: bigint) {
  await ok("contributor A votes for", contributors.A, voteTx(poolId, "for"));
  await refused("close the vote with one ballot", steward, finalizeTx(poolId), "VoteStillOpen");
  await ok("contributor B votes for", contributors.B, voteTx(poolId, "for"));
  await ok("close the vote early: For holds more than half of all power", steward, finalizeTx(poolId));
  same("status", (await readPool(client, poolId)).status, "funding");
}

async function waitForChainTime(until: number, what: string) {
  process.stdout.write(`  waiting  for ${what}`);
  for (let i = 0; i < 120; i++) {
    const now = Number((await client.getBlock({ blockTag: "latest" })).timestamp);
    if (now >= until) return console.log(" done");
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  fail(`block time never reached ${what}`);
}

async function main() {
  const started = await client.getBalance({ address: funded.address });
  console.log(`${CHAIN_NAME}${local ? ` (${process.env.RPC_URL})` : ""}, checker ${funded.address} with ${formatEth(started)}`);

  console.log("\nContracts");
  const before = await readDeployment(client);
  if (!before.deployer) fail("the deterministic deployment proxy was not found on this endpoint");
  if (before.usdc) console.log(`  present  Demo USDC at ${USDC_ADDRESS}`);
  else await ok(`deploy Demo USDC at ${USDC_ADDRESS}`, funded, deployUsdcTx());
  if (before.pools) console.log(`  present  PooledFunding at ${POOLS_ADDRESS}`);
  else await ok(`deploy PooledFunding at ${POOLS_ADDRESS}`, funded, deployPoolsTx());
  const after = await readDeployment(client);
  if (!after.usdc || !after.pools) fail("the contracts are not at the derived addresses");

  console.log("\nSandbox");
  const budget = gasBudgets(await client.getGasPrice(), everyone.length - 1);
  if (started < budget.total + budget.perKey) fail(`the checker key needs about ${formatEth(budget.total + budget.perKey)}`);
  for (const [name, sender] of everyone) {
    await ok(`gas for ${name}`, funded, { to: sender.address, value: name === "steward" ? budget.steward : budget.perKey });
  }
  const created = await ok(`create a space with ${VOTING_SECONDS} s votes`, steward, createSpaceTx(VOTING_SECONDS, fees));
  const spaceId = spaceIdFrom(created.receipt!);
  for (const [k, sender] of Object.entries(contributors)) {
    await ok(`record Points of contributor ${k}`, steward, setPointsTx(spaceId, sender.address, POINTS[k as keyof typeof POINTS]));
  }
  for (const [k, sender] of Object.entries(companies)) await ok(`mint 100,000 demo USDC to company ${k}`, steward, mintTx(sender.address, usdc(100_000)));
  await refused("a company writes its own Points", companies.A, setPointsTx(spaceId, companies.A.address, [9_999, 0, 0, 0]), "NotSteward");

  console.log("\nPool 1: a request that fills and is paid by Points");
  await ok("company A approves exactly 10,000", companies.A, approveTx(usdc(10_000)));
  const request = await ok(
    "company A opens a request for 50,000 with a first pledge of 10,000",
    companies.A,
    proposeTx({ spaceId, kind: "request", domain: 0, target: TARGET, fundingSeconds: LONG_WINDOW, title: "Open-source e-invoicing engine", openingPledge: usdc(10_000) }),
  );
  const first = poolIdFrom(request.receipt!);
  await refused("a company votes", companies.B, voteTx(first, "for"), "NoVotingPower");
  await list(first);
  await refused("launch at 10,000 of 50,000", steward, launchTx(first), "TargetNotReached");
  await pledge(first, "company B", companies.B, usdc(20_000));
  await refused("refund company B while the pool is open", steward, refundTx(first, companies.B.address), "RefundNotAvailable");
  await pledge(first, "company C", companies.C, usdc(20_000));
  same("pool holds", (await readPool(client, first)).pledged, TARGET);
  await ok("launch the full pool", steward, launchTx(first));
  const paidBefore = await Promise.all([contributors.A, contributors.B, contributors.C].map((c) => balance(c.address)));
  await refused("a company posts the payout record", companies.A, payOutTx(first, [[companies.A.address, 1n]]), "NotSteward");
  await ok(
    "pay by project Points: A 160, B 60, C 120",
    steward,
    payOutTx(first, [
      [contributors.A.address, 160n],
      [contributors.B.address, 60n],
      [contributors.C.address, 120n],
    ]),
  );
  const paidAfter = await Promise.all([contributors.A, contributors.B, contributors.C].map((c) => balance(c.address)));
  same("contributor A received", paidAfter[0] - paidBefore[0], 23_058_823_529n);
  same("contributor B received", paidAfter[1] - paidBefore[1], 8_647_058_823n);
  same("contributor C received", paidAfter[2] - paidBefore[2], 17_294_117_648n);
  same("fee wallet received (2%)", await balance(fees), usdc(1_000));
  same("status", (await readPool(client, first)).status, "paid");

  console.log("\nPool 2: a community proposal that misses its target and refunds");
  const proposal = await ok(
    `contributor A proposes a build for 50,000 with a ${SHORT_WINDOW} s window`,
    contributors.A,
    proposeTx({ spaceId, kind: "proposal", domain: 0, target: TARGET, fundingSeconds: SHORT_WINDOW, title: "Open-source feature-flag service", openingPledge: 0n }),
  );
  const second = poolIdFrom(proposal.receipt!);
  await list(second);
  const walletBefore = await balance(companies.B.address);
  await pledge(second, "company B", companies.B, usdc(20_000));
  await waitForChainTime((await readPool(client, second)).deadline, "the deadline");
  same("status", (await readPool(client, second)).status, "expired");
  await refused("launch after a missed target", steward, launchTx(second), "TargetNotReached");
  await ok("anyone refunds company B", contributors.C, refundTx(second, companies.B.address));
  same("company B is back to", await balance(companies.B.address), walletBefore);
  await refused("refund company B twice", steward, refundTx(second, companies.B.address), "NothingToRefund");

  console.log("\nPool 3: a launched pool closed by vote before payout");
  const third = poolIdFrom(
    (
      await ok(
        "contributor B proposes a build for 50,000",
        contributors.B,
        proposeTx({ spaceId, kind: "proposal", domain: 0, target: TARGET, fundingSeconds: LONG_WINDOW, title: "Self-hosted status page", openingPledge: 0n }),
      )
    ).receipt!,
  );
  await list(third);
  const held = await Promise.all([companies.A, companies.B].map((c) => balance(c.address)));
  await pledge(third, "company A", companies.A, usdc(30_000));
  await pledge(third, "company B", companies.B, usdc(20_000));
  await ok("launch the full pool", steward, launchTx(third));
  await refused("a stranger asks for a closure vote", steward, openClosureTx(third), "NotAParticipant");
  await ok("company B asks for a closure vote", companies.B, openClosureTx(third));
  await refused("pay out while the closure vote is open", steward, payOutTx(third, [[contributors.A.address, 1n]]), "ClosureVoteOpen");
  await ok("contributor A votes for", contributors.A, voteTx(third, "for"));
  await ok("contributor C votes for", contributors.C, voteTx(third, "for"));
  await ok("close the vote early", steward, finalizeTx(third));
  same("status", (await readPool(client, third)).status, "closed");
  await refused("pay out a closed pool", steward, payOutTx(third, [[contributors.A.address, 1n]]), "NotBuilding");
  await ok("refund company A", steward, refundTx(third, companies.A.address));
  await ok("refund company B", steward, refundTx(third, companies.B.address));
  const back = await Promise.all([companies.A, companies.B].map((c) => balance(c.address)));
  same("company A is back to", back[0], held[0]);
  same("company B is back to", back[1], held[1]);
}

// Returns what the throwaway keys did not spend. Best effort: a failure here does not fail the check.
async function sweep() {
  try {
    const price = await client.getGasPrice();
    const reserve = price * 21_000n * 20n + 2_000_000_000_000n;
    let swept = 0n;
    for (const [, sender] of everyone) {
      const left = await client.getBalance({ address: sender.address });
      if (left <= reserve) continue;
      const hash = await sender.send({ to: funded.address, value: left - reserve });
      await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      swept += left - reserve;
    }
    if (swept > 0n) console.log(`\nReturned ${formatEth(swept)} of unspent gas to the checker key.`);
  } catch (err) {
    console.log(`\nCould not return the unspent gas: ${decodeError(err).message}`);
  }
}

let passed = false;
try {
  await main();
  passed = true;
} catch (err) {
  console.error(`\n  FAILED   ${err instanceof CheckFailed ? err.message : `${decodeError(err).name}: ${decodeError(err).message}`}`);
}
await sweep();
console.log(`\n${passed ? "PASS" : "FAIL"}: ${transactions} transactions on ${CHAIN_NAME}${local ? " (local chain)" : ""}.`);
process.exit(passed ? 0 : 1);
