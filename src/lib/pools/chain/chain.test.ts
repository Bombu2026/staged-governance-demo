import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeErrorResult, getContractAddress, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { demoUsdcAbi, demoUsdcBytecode, pooledFundingAbi } from "../generated/contracts";
import { usdc } from "../math";
import { POOLS_ADDRESS, POOLS_INIT_CODE, USDC_ADDRESS, USDC_INIT_CODE, deployCalldata } from "./addresses";
import { gasBudgets } from "./budget";
import { CHAIN_ID, CHAIN_ID_HEX, CREATE2_DEPLOYER, DEPLOY_SALT, MIN_KEY_BUDGET_WEI, RPC_URL } from "./constants";
import { type Eip1193Provider, ensureWalletChain } from "./core";
import { GuardError, decodeError, decodeRevertData, describeContractError } from "./errors";
import { explorerAddressUrl, explorerTxUrl, formatCountdown, formatEth, shortenAddress } from "./format";
import { DEMO_ROLES, parseDemo, serializeDemo } from "./session";
import { discoverWallets } from "./wallet";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("network constants", () => {
  it("point at Base Sepolia and nowhere else", () => {
    expect(CHAIN_ID).toBe(84532);
    expect(Number(CHAIN_ID_HEX)).toBe(CHAIN_ID);
    expect(RPC_URL).toBe("https://sepolia.base.org");
  });
});

describe("contract addresses", () => {
  it("derive from the proxy, the salt and the committed bytecode", () => {
    expect(USDC_INIT_CODE).toBe(demoUsdcBytecode);
    expect(USDC_ADDRESS).toBe(getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: DEPLOY_SALT, bytecodeHash: keccak256(demoUsdcBytecode) }));
    // Pinned on purpose: any change to a contract moves these, and the README has to follow.
    expect(USDC_ADDRESS).toBe("0x92CC1185715c0BF1d6248440014B0E674fdD4301");
    expect(POOLS_ADDRESS).toBe("0xf7421ED306bdF20D97918982577b820c1c2e4F71");
    // The pool contract is built for this exact token: its address is the constructor argument.
    expect(POOLS_INIT_CODE.toLowerCase().endsWith(USDC_ADDRESS.slice(2).toLowerCase())).toBe(true);
    expect(deployCalldata("0x6000")).toBe(`${DEPLOY_SALT}6000`);
  });

  it("come from bytecode that matches a fresh compile of contracts/", () => {
    const out = execFileSync("node", [join(root, "scripts/compile-contracts.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("matches a fresh compile");
  }, 60_000);
});

describe("errors", () => {
  it("names the contract's refusals and explains them", () => {
    const data = encodeErrorResult({ abi: pooledFundingAbi, errorName: "TargetNotReached", args: [usdc(30_000), usdc(50_000)] });
    expect(decodeRevertData(data)).toEqual({ kind: "contract", name: "TargetNotReached", message: "All or nothing: 30,000 of 50,000 demo USDC pledged so far." });
    const token = encodeErrorResult({ abi: demoUsdcAbi, errorName: "InsufficientAllowance" });
    expect(decodeRevertData(token)?.name).toBe("InsufficientAllowance");
    expect(decodeRevertData("0x")).toBeNull();
    expect(decodeRevertData("0xdeadbeef")).toBeNull();
    expect(describeContractError("SomethingNew")).toBe("The contract reverted with SomethingNew.");
  });

  it("finds revert data nested in an RPC or wallet error", () => {
    const data = encodeErrorResult({ abi: pooledFundingAbi, errorName: "RefundNotAvailable" });
    expect(decodeError({ message: "execution reverted", cause: { data } }).name).toBe("RefundNotAvailable");
    expect(decodeError({ message: "boom", cause: { cause: { data: { data } } } }).name).toBe("RefundNotAvailable");
  });

  it("covers every custom error of both contracts", () => {
    const names = [...pooledFundingAbi, ...demoUsdcAbi].filter((item) => item.type === "error").map((item) => item.name);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(describeContractError(name), name).not.toContain("reverted with");
  });

  it("classifies wallet, funds, rate-limit and network failures", () => {
    expect(decodeError({ code: 4001, message: "User rejected the request." }).kind).toBe("declined");
    expect(decodeError({ message: "wrapped", cause: { code: 4001 } }).kind).toBe("declined");
    expect(decodeError(new Error("insufficient funds for gas * price + value")).kind).toBe("insufficient-funds");
    expect(decodeError(new Error("HTTP 429 Too Many Requests")).kind).toBe("rate-limited");
    expect(decodeError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(decodeError(new GuardError("WrongNetwork", "nope"))).toEqual({ kind: "guard", name: "WrongNetwork", message: "nope" });
    expect(decodeError("weird")).toEqual({ kind: "unknown", name: "Error", message: "weird" });
    expect(decodeError({}).message).toBe("Unexpected error");
  });
});

describe("format", () => {
  it("shortens addresses and builds BaseScan links only for well-formed ids", () => {
    expect(shortenAddress(USDC_ADDRESS)).toBe(`${USDC_ADDRESS.slice(0, 6)}…${USDC_ADDRESS.slice(-4)}`);
    expect(shortenAddress("0x1234")).toBe("0x1234");
    const hash = `0x${"ab".repeat(32)}`;
    expect(explorerTxUrl(hash)).toBe(`https://sepolia.basescan.org/tx/${hash}`);
    expect(explorerAddressUrl(USDC_ADDRESS)).toBe(`https://sepolia.basescan.org/address/${USDC_ADDRESS}`);
    expect(() => explorerTxUrl("0x12")).toThrow();
    expect(() => explorerTxUrl(`${hash}?x=1`)).toThrow();
    expect(() => explorerAddressUrl("javascript:alert(1)")).toThrow();
  });

  it("formats ETH and countdowns", () => {
    expect(formatEth(1_234_500_000_000_000n)).toBe("0.001235 ETH");
    expect(formatEth(30_000_000_000_000n)).toBe("0.00003 ETH");
    expect(formatEth(0n)).toBe("0 ETH");
    expect(formatCountdown(61.2)).toBe("1:02");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("gas budgets", () => {
  it("never go below the floor and scale with the gas price", () => {
    const cheap = gasBudgets(6_000_000n);
    expect(cheap.perKey).toBeGreaterThanOrEqual(MIN_KEY_BUDGET_WEI);
    expect(cheap.total).toBe(cheap.steward + cheap.perKey * 5n);
    const busy = gasBudgets(2_000_000_000n);
    expect(busy.perKey).toBe(2_000_000_000n * 3_000_000n * 2n);
    expect(busy.steward).toBe(busy.perKey * 2n);
    expect(gasBudgets(0n, 3).total).toBe(MIN_KEY_BUDGET_WEI * 5n);
  });
});

describe("session storage", () => {
  const keys = Object.fromEntries(DEMO_ROLES.map((role, i) => [role, `0x${(i + 1).toString(16).padStart(64, "0")}`])) as Parameters<typeof serializeDemo>[0]["keys"];

  it("round-trips the demo keys and the sandbox id", () => {
    expect(parseDemo(serializeDemo({ keys, spaceId: null }))).toEqual({ keys, spaceId: null });
    expect(parseDemo(serializeDemo({ keys, spaceId: 42n }))).toEqual({ keys, spaceId: 42n });
  });

  it("rejects anything malformed", () => {
    const good = JSON.parse(serializeDemo({ keys, spaceId: 7n }));
    const bad = [
      null,
      "",
      "not json",
      "[]",
      JSON.stringify({ ...good, v: 2 }),
      JSON.stringify({ ...good, keys: { ...good.keys, steward: "0x12" } }),
      JSON.stringify({ ...good, keys: { ...good.keys, steward: good.keys.fees } }),
      JSON.stringify({ ...good, keys: { ...good.keys, fees: undefined } }),
      JSON.stringify({ ...good, spaceId: "0" }),
      JSON.stringify({ ...good, spaceId: 7 }),
      JSON.stringify({ ...good, spaceId: "7; drop" }),
    ];
    for (const raw of bad) expect(parseDemo(raw), String(raw)).toBeNull();
  });
});

describe("wallets", () => {
  function fakeWindow(announced: { name: string; rdns: string; provider: Eip1193Provider }[], extra: { phantom?: Eip1193Provider; ethereum?: Eip1193Provider } = {}) {
    const target = new EventTarget();
    target.addEventListener("eip6963:requestProvider", () => {
      for (const w of announced) {
        const event = new Event("eip6963:announceProvider") as Event & { detail?: unknown };
        event.detail = { info: { uuid: w.rdns, name: w.name, rdns: w.rdns }, provider: w.provider };
        target.dispatchEvent(event);
      }
    });
    return Object.assign(target, { phantom: extra.phantom && { ethereum: extra.phantom }, ethereum: extra.ethereum });
  }
  const provider = (): Eip1193Provider => ({ request: async () => null });

  it("lists announced wallets with Phantom first, without duplicates", async () => {
    const phantom = provider();
    const other = provider();
    const found = await discoverWallets(
      fakeWindow(
        [
          { name: "Other Wallet", rdns: "io.other", provider: other },
          { name: "Phantom", rdns: "app.phantom", provider: phantom },
        ],
        { phantom, ethereum: other },
      ),
      5,
    );
    expect(found.map((w) => w.name)).toEqual(["Phantom", "Other Wallet"]);
  });

  it("falls back to injected providers, and finds none on a bare page", async () => {
    const legacy = provider();
    expect((await discoverWallets(fakeWindow([], { phantom: legacy }), 5)).map((w) => w.name)).toEqual(["Phantom"]);
    expect((await discoverWallets(fakeWindow([], { ethereum: legacy }), 5)).map((w) => w.name)).toEqual(["Browser wallet"]);
    expect(await discoverWallets(fakeWindow([]), 5)).toEqual([]);
  });

  it("asks the wallet to switch to Base Sepolia, adds it when unknown, and refuses to go on otherwise", async () => {
    const calls: string[] = [];
    let chain = 1;
    const wallet = (onSwitch: () => void): Eip1193Provider => ({
      async request({ method }) {
        calls.push(method);
        if (method === "eth_chainId") return `0x${chain.toString(16)}`;
        if (method === "wallet_switchEthereumChain") return onSwitch();
        if (method === "wallet_addEthereumChain") chain = CHAIN_ID;
        return null;
      },
    });

    await ensureWalletChain(wallet(() => void (chain = CHAIN_ID)));
    expect(calls).toEqual(["eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);

    chain = 1;
    calls.length = 0;
    await ensureWalletChain(
      wallet(() => {
        throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      }),
    );
    expect(calls).toContain("wallet_addEthereumChain");

    // A wallet that knows the chain only through its own testnet setting: adding fails, the guard explains.
    chain = 1;
    const stubborn: Eip1193Provider = {
      async request({ method }) {
        if (method === "eth_chainId") return "0x1";
        throw Object.assign(new Error("Unrecognized chain ID"), { code: method === "wallet_switchEthereumChain" ? 4902 : -32603 });
      },
    };
    await expect(ensureWalletChain(stubborn)).rejects.toThrow(/testnet mode/);

    chain = 1;
    await expect(ensureWalletChain(wallet(() => undefined))).rejects.toBeInstanceOf(GuardError);
    await expect(
      ensureWalletChain(
        wallet(() => {
          throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        }),
      ),
    ).rejects.toMatchObject({ code: 4001 });

    chain = CHAIN_ID;
    calls.length = 0;
    await ensureWalletChain(wallet(() => undefined));
    expect(calls).toEqual(["eth_chainId"]);
  });
});
