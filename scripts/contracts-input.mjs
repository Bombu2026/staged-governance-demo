// The exact compiler input for contracts/*.sol, shared by the compile script and the verification
// script: explorers must recompile with the same sources and settings to match the deployed bytecode.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const solc = require("solc");
export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCES = ["DemoUSDC.sol", "PooledFunding.sol"];

// "paris" keeps the bytecode free of newer opcodes, so the same build runs on Base, Ethereum and Robinhood Chain.
export const SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: "paris",
  metadata: { bytecodeHash: "none", appendCBOR: false },
  outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
};

export function standardInput() {
  return {
    language: "Solidity",
    sources: Object.fromEntries(SOURCES.map((name) => [name, { content: readFileSync(join(root, "contracts", name), "utf8") }])),
    settings: SETTINGS,
  };
}

// "0.8.38+commit.1835d247", without the build suffix of the JavaScript compiler.
export const compilerVersion = () => solc.version().replace(/\.Emscripten.*$/, "");
