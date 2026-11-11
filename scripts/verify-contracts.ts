#!/usr/bin/env bun
// Publishes the source of the two deployed contracts so explorers can show it as verified: Sourcify,
// which Blockscout and others read, and Blockscout's own verifier for Base Sepolia. Neither needs an
// API key. Both recompile contracts/*.sol with the committed settings and compare with what is on-chain.
//
//   bun run contracts:verify

import { readDeployment } from "../src/lib/pools/chain/actions";
import { POOLS_ADDRESS, USDC_ADDRESS } from "../src/lib/pools/chain/addresses";
import { CHAIN_ID } from "../src/lib/pools/chain/constants";
import { createChainClient } from "../src/lib/pools/chain/core";
import { compilerVersion, standardInput } from "./contracts-input.mjs";

const SOURCIFY = "https://sourcify.dev/server";
const BLOCKSCOUT = "https://base-sepolia.blockscout.com";
const CONTRACTS = [
  { name: "DemoUSDC", file: "DemoUSDC.sol", address: USDC_ADDRESS },
  { name: "PooledFunding", file: "PooledFunding.sol", address: POOLS_ADDRESS },
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const input = standardInput();
const version = compilerVersion();

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

async function sourcify(contract: (typeof CONTRACTS)[number]): Promise<string> {
  const lookup = `${SOURCIFY}/v2/contract/${CHAIN_ID}/${contract.address}`;
  const existing = await json(await fetch(lookup));
  if (existing.match) return `already verified (${String(existing.match)})`;

  const submitted = await fetch(`${SOURCIFY}/v2/verify/${CHAIN_ID}/${contract.address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stdJsonInput: input, compilerVersion: version, contractIdentifier: `${contract.file}:${contract.name}` }),
  });
  const job = await json(submitted);
  if (typeof job.verificationId !== "string") throw new Error(`Sourcify refused the submission (${submitted.status}): ${JSON.stringify(job).slice(0, 300)}`);

  for (let i = 0; i < 40; i++) {
    await sleep(3_000);
    const status = await json(await fetch(`${SOURCIFY}/v2/verify/${job.verificationId}`));
    if (!status.isJobCompleted) continue;
    const result = status.contract as { match?: string | null } | undefined;
    if (result?.match) return `verified (${result.match})`;
    throw new Error(`Sourcify could not match the bytecode: ${JSON.stringify(status.error ?? status).slice(0, 300)}`);
  }
  throw new Error("Sourcify did not finish in two minutes");
}

async function blockscout(contract: (typeof CONTRACTS)[number]): Promise<string> {
  const lookup = `${BLOCKSCOUT}/api/v2/smart-contracts/${contract.address}`;
  const verified = async () => (await json(await fetch(lookup))).is_verified === true;
  if (await verified()) return "already verified";

  const form = new FormData();
  form.set("compiler_version", `v${version}`);
  form.set("contract_name", contract.name);
  form.set("license_type", "mit");
  form.set("autodetect_constructor_args", "true");
  form.set("files[0]", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  const submitted = await fetch(`${lookup}/verification/via/standard-input`, { method: "POST", body: form });
  if (!submitted.ok) throw new Error(`Blockscout refused the submission (${submitted.status}): ${JSON.stringify(await json(submitted)).slice(0, 300)}`);

  for (let i = 0; i < 40; i++) {
    await sleep(3_000);
    if (await verified()) return "verified";
  }
  throw new Error("Blockscout did not confirm the verification in two minutes");
}

const deployed = await readDeployment(createChainClient());
if (!deployed.usdc || !deployed.pools) {
  console.error("The contracts are not deployed on Base Sepolia yet. Run `bun run contracts:deploy` first.");
  process.exit(1);
}

let failures = 0;
console.log(`Compiler ${version}, chain ${CHAIN_ID}`);
for (const contract of CONTRACTS) {
  console.log(`\n${contract.name} at ${contract.address}`);
  for (const [service, verify, page] of [
    ["Sourcify", sourcify, `https://repo.sourcify.dev/${CHAIN_ID}/${contract.address}`],
    ["Blockscout", blockscout, `${BLOCKSCOUT}/address/${contract.address}?tab=contract`],
  ] as const) {
    try {
      console.log(`  ${service}: ${await verify(contract)}  ${page}`);
    } catch (err) {
      failures++;
      console.log(`  ${service}: FAILED, ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
process.exit(failures ? 1 : 0);
