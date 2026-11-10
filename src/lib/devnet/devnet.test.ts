import { describe, expect, it } from "vitest";
import { SQUADS_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "./constants";
import { decodeSystemTransfer } from "./decode";
import { DevnetError, decodeError, nameForCustomCode } from "./errors";
import { explorerAddressUrl, explorerTxUrl, formatSol, shortenAddress } from "./format";
import { getPhantom } from "./phantom";
import { parseDemo, serializeDemo } from "./session";
import { chainNowSeconds, clockSkewSeconds, formatCountdown, parseClockUnixTimestamp, releaseAt, secondsRemaining } from "./timelock";

const SIG = "5zf5DwEuWPCxK1Eu2aBax9bgJd3Vc8ts7FGoQiBiaYTXespyKX8jyB5mwzpsNg8PeoX4FnTUer9SVDcWavbi8KJ6";

describe("format", () => {
  it("shortens addresses and leaves short strings alone", () => {
    expect(shortenAddress(SQUADS_PROGRAM_ID)).toBe("SQDS…2pCf");
    expect(shortenAddress(SQUADS_PROGRAM_ID, 6)).toBe("SQDS4e…j52pCf");
    expect(shortenAddress("abcdefghi")).toBe("abcdefghi");
  });

  it("builds devnet-only explorer URLs", () => {
    expect(explorerTxUrl(SIG)).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
    expect(explorerAddressUrl(SQUADS_PROGRAM_ID)).toBe(`https://explorer.solana.com/address/${SQUADS_PROGRAM_ID}?cluster=devnet`);
  });

  it("refuses anything that is not base58, so no query string can be injected", () => {
    expect(() => explorerTxUrl(`${SIG}?cluster=mainnet-beta`)).toThrow();
    expect(() => explorerAddressUrl("../evil")).toThrow();
    expect(() => explorerTxUrl("")).toThrow();
  });

  it("formats lamports as SOL", () => {
    expect(formatSol(10_000_000)).toBe("0.01 SOL");
    expect(formatSol(1_000_000_000n)).toBe("1 SOL");
    expect(formatSol(5_000)).toBe("0.000005 SOL");
    expect(formatSol(0)).toBe("0 SOL");
  });
});

describe("decodeError", () => {
  it("names Squads program errors from a confirmed transaction error", () => {
    expect(decodeError({ InstructionError: [0, { Custom: 6008 }] })).toMatchObject({ kind: "program", name: "InvalidProposalStatus" });
    expect(decodeError({ InstructionError: [0, { Custom: 6021 }] })).toMatchObject({ kind: "program", name: "TimeLockNotReleased" });
    expect(decodeError({ InstructionError: [2, { Custom: 6010 }] })).toMatchObject({ name: "AlreadyApproved" });
  });

  it("maps every Squads code in range and nothing past it", () => {
    expect(nameForCustomCode(6000)?.[0]).toBe("DuplicateMember");
    expect(nameForCustomCode(6044)?.[0]).toBe("MultisigCreateDeprecated");
    expect(nameForCustomCode(6045)).toBeNull();
    expect(decodeError({ InstructionError: [0, { Custom: 7777 }] })).toMatchObject({ kind: "program", name: "Custom(7777)" });
  });

  it("reads codes from preflight messages and Anchor logs", () => {
    const preflight = new Error("Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1785.");
    expect(decodeError(preflight).name).toBe("TimeLockNotReleased");
    const withLogs = Object.assign(new Error("Simulation failed."), {
      logs: ["Program log: AnchorError occurred. Error Code: NotAMember. Error Number: 6005. Error Message: Provided pubkey is not a member."],
    });
    expect(decodeError(withLogs).name).toBe("NotAMember");
  });

  it("treats a declined wallet prompt as declined, not as a failure", () => {
    expect(decodeError({ code: 4001, message: "User rejected the request." }).kind).toBe("declined");
    expect(decodeError(new Error("User rejected the request.")).kind).toBe("declined");
  });

  it("recognises funds, faucet, rate-limit, expiry and network problems", () => {
    expect(decodeError("InsufficientFundsForFee").kind).toBe("insufficient-funds");
    expect(decodeError({ InstructionError: [0, { Custom: 1 }] })).toMatchObject({ kind: "insufficient-funds", name: "ResultWithNegativeLamports" });
    expect(decodeError(new Error("Attempt to debit an account but found no record of a prior credit.")).kind).toBe("insufficient-funds");
    expect(decodeError(new Error('410 Gone: {"error":{"code":410,"message":"The RPC faucet is closed on this cluster."}}')).kind).toBe("faucet");
    expect(decodeError(new Error("429 Too Many Requests: rate limit exceeded")).kind).toBe("rate-limited");
    expect(decodeError(new Error("Signature abc has expired: block height exceeded.")).kind).toBe("expired");
    expect(decodeError(new TypeError("Failed to fetch")).kind).toBe("network");
  });

  it("passes our own guard errors through and never returns a stack trace", () => {
    expect(decodeError(new DevnetError("guard", "NotDevnet", "Not devnet."))).toEqual({ kind: "guard", name: "NotDevnet", message: "Not devnet." });
    const odd = new Error("first line\n    at someFunction (file.js:1:1)\n    at other (file.js:2:2)");
    expect(decodeError(odd)).toEqual({ kind: "unknown", name: "Error", message: "first line" });
    expect(decodeError(undefined).message).toBe("Unexpected error");
  });
});

describe("time lock countdown", () => {
  it("counts down on chain time, never below zero", () => {
    expect(releaseAt(1_000, 60)).toBe(1_060);
    expect(secondsRemaining(1_000, 60, 1_000)).toBe(60);
    expect(secondsRemaining(1_000, 60, 1_059.2)).toBe(1);
    expect(secondsRemaining(1_000, 60, 1_060)).toBe(0);
    expect(secondsRemaining(1_000, 60, 2_000)).toBe(0);
  });

  it("corrects the local clock with the measured chain skew", () => {
    const skew = clockSkewSeconds(1_000, 1_003_500);
    expect(skew).toBe(-3.5);
    expect(chainNowSeconds(1_013_500, skew)).toBe(1_010);
    expect(secondsRemaining(1_000, 60, chainNowSeconds(1_013_500, skew))).toBe(50);
  });

  it("formats m:ss", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0.2)).toBe("0:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("reads unix_timestamp from Clock sysvar data", () => {
    const data = new Uint8Array(40);
    new DataView(data.buffer).setBigInt64(32, 1_794_352_473n, true);
    expect(parseClockUnixTimestamp(data)).toBe(1_794_352_473);
    expect(() => parseClockUnixTimestamp(new Uint8Array(39))).toThrow();
  });
});

describe("session storage of the demo keys", () => {
  const keyB = Uint8Array.from({ length: 64 }, (_, i) => i);
  const keyC = Uint8Array.from({ length: 64 }, (_, i) => 255 - i);

  it("round-trips the two demo keys and nothing else", () => {
    const raw = serializeDemo({ keyB, keyC });
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["b", "c", "v"]);
    expect(parseDemo(raw)).toEqual({ keyB, keyC });
  });

  it("rejects missing, malformed or tampered data", () => {
    expect(parseDemo(null)).toBeNull();
    expect(parseDemo("")).toBeNull();
    expect(parseDemo("not json")).toBeNull();
    expect(parseDemo(JSON.stringify({ v: 2, b: "", c: "" }))).toBeNull();
    const ok = JSON.parse(serializeDemo({ keyB, keyC }));
    expect(parseDemo(JSON.stringify({ ...ok, b: ok.c }))).toBeNull();
    expect(parseDemo(JSON.stringify({ ...ok, b: btoa("short") }))).toBeNull();
    expect(parseDemo(JSON.stringify({ ...ok, c: "%%%" }))).toBeNull();
  });
});

describe("decodeSystemTransfer", () => {
  const keys = ["Vault111111111111111111111111111111111111111", "Dest1111111111111111111111111111111111111111", SYSTEM_PROGRAM_ID];
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, 10_000_000n, true);

  it("reads destination and amount from a compiled transfer", () => {
    expect(decodeSystemTransfer(keys, { programIdIndex: 2, accountIndexes: [0, 1], data })).toEqual({
      from: keys[0],
      to: keys[1],
      lamports: 10_000_000n,
    });
  });

  it("ignores other programs and other instructions", () => {
    expect(decodeSystemTransfer(keys, { programIdIndex: 0, accountIndexes: [0, 1], data })).toBeNull();
    const other = data.slice();
    other[0] = 3;
    expect(decodeSystemTransfer(keys, { programIdIndex: 2, accountIndexes: [0, 1], data: other })).toBeNull();
  });
});

describe("getPhantom", () => {
  it("returns the provider only when it identifies as Phantom", () => {
    const solana = { isPhantom: true };
    expect(getPhantom({ phantom: { solana } })).toBe(solana);
    expect(getPhantom({ phantom: { solana: { isPhantom: false } } })).toBeNull();
    expect(getPhantom({ solana: { isPhantom: true } })).toBeNull();
    expect(getPhantom(undefined)).toBeNull();
  });
});
