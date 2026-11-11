// Test helper: a local chain (anvil, from the @foundry-rs/anvil dev dependency) that answers with the
// Base Sepolia chain id, so the tests drive the same client code as the page. Never imported by the app.

import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Hex, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { CHAIN_ID, CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE } from "../chain/constants";
import { type ChainClient, createChainClient } from "../chain/core";

const ANVIL = join(dirname(fileURLToPath(import.meta.url)), "../../../../node_modules/.bin/anvil");
// Anvil's well-known development mnemonic. Its accounts only ever exist on a local chain.
const MNEMONIC = "test test test test test test test test test test test junk";

export interface LocalChain {
  url: string;
  client: ChainClient;
  // Private keys of accounts that anvil funded at genesis.
  keys: Hex[];
  rpc(method: string, params?: unknown[]): Promise<unknown>;
  // Moves block time forward and mines a block.
  warp(seconds: number): Promise<void>;
  now(): Promise<number>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function startLocalChain(options: { port?: number; accounts?: number; blockTime?: number } = {}): Promise<LocalChain> {
  const port = options.port ?? (await freePort());
  const accounts = options.accounts ?? 16;
  const args = ["--port", String(port), "--chain-id", String(CHAIN_ID), "--accounts", String(accounts), "--silent"];
  if (options.blockTime) args.push("--block-time", String(options.blockTime));
  const child: ChildProcess = spawn(ANVIL, args, { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;

  async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await response.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await rpc("eth_chainId");
      break;
    } catch (err) {
      if (attempt > 100 || child.exitCode !== null) throw new Error(`anvil did not start: ${String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await rpc("anvil_setCode", [CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE]);

  const keys = Array.from({ length: accounts }, (_, addressIndex) => {
    const key = mnemonicToAccount(MNEMONIC, { addressIndex }).getHdKey().privateKey;
    if (!key) throw new Error("No private key for a development account");
    return toHex(key);
  });
  const client = createChainClient(url, 25);
  const now = async () => Number((await client.getBlock({ blockTag: "latest" })).timestamp);

  return {
    url,
    client,
    keys,
    rpc,
    now,
    async warp(seconds) {
      await rpc("evm_increaseTime", [seconds]);
      await rpc("evm_mine");
    },
    stop() {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      });
    },
  };
}
