#!/usr/bin/env bun
// Deploys the two demo contracts through the deterministic deployment proxy, to the addresses the page
// expects. Anyone can do this once; the page offers the same two transactions from a browser wallet.
//
//   DEPLOYER_PRIVATE_KEY=0x... bun run contracts:deploy
//
// Use a throwaway key that only holds testnet ETH. RPC_URL may point at another Base Sepolia endpoint
// (or a local chain with the same chain id); any other network is refused.

import type { Hex } from "viem";
import { deployPoolsTx, deployUsdcTx, readDeployment } from "../src/lib/pools/chain/actions";
import { POOLS_ADDRESS, USDC_ADDRESS } from "../src/lib/pools/chain/addresses";
import { CHAIN_NAME, RPC_URL } from "../src/lib/pools/chain/constants";
import { createChainClient, keySender, run } from "../src/lib/pools/chain/core";
import { decodeError } from "../src/lib/pools/chain/errors";
import { explorerAddressUrl, explorerTxUrl } from "../src/lib/pools/chain/format";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set DEPLOYER_PRIVATE_KEY to a 0x-prefixed private key that holds a little Base Sepolia ETH.");
  process.exit(1);
}

const local = process.env.RPC_URL !== undefined && process.env.RPC_URL !== RPC_URL;
const client = createChainClient(process.env.RPC_URL ?? RPC_URL);
const deployer = keySender(client, key as Hex);
const link = (url: string) => (local ? "" : `  ${url}`);

try {
  const before = await readDeployment(client);
  if (!before.deployer) throw new Error(`The deterministic deployment proxy was not found on this ${CHAIN_NAME} endpoint.`);
  console.log(`Deployer ${deployer.address} on ${CHAIN_NAME}${local ? ` (${process.env.RPC_URL})` : ""}`);

  for (const [name, address, present, tx] of [
    ["Demo USDC", USDC_ADDRESS, before.usdc, deployUsdcTx()],
    ["PooledFunding", POOLS_ADDRESS, before.pools, deployPoolsTx()],
  ] as const) {
    if (present) {
      console.log(`${name}: already at ${address}${link(explorerAddressUrl(address))}`);
      continue;
    }
    const result = await run(client, deployer, tx);
    if (result.error || !result.hash) throw new Error(`${name} was not deployed: ${result.error?.message ?? "no transaction"}`);
    console.log(`${name}: deployed at ${address}${link(explorerTxUrl(result.hash))}`);
  }

  const after = await readDeployment(client);
  if (!after.usdc || !after.pools) throw new Error("The contracts are not at the expected addresses after deployment.");
  console.log("Done. Both contracts are at the addresses derived from the committed bytecode.");
} catch (err) {
  console.error(`FAIL: ${decodeError(err).message || String(err)}`);
  process.exit(1);
}
