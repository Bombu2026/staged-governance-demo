import { type Hex, BaseError, decodeErrorResult } from "viem";
import { demoUsdcAbi, pooledFundingAbi } from "../generated/contracts";
import { formatUsdc } from "../math";

export type ErrorKind = "declined" | "contract" | "insufficient-funds" | "rate-limited" | "network" | "guard" | "unknown";

export interface DecodedError {
  kind: ErrorKind;
  name: string;
  message: string;
}

export class GuardError extends Error {
  readonly kind = "guard" as const;

  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

const ERROR_ABI = [...pooledFundingAbi, ...demoUsdcAbi].filter((item) => item.type === "error");

// What each refusal of the contract means, in the words the simulation uses.
const CONTRACT_ERRORS: Record<string, string> = {
  UnknownSpace: "This sandbox does not exist on the contract.",
  UnknownPool: "This pool does not exist on the contract.",
  BadParameters: "The contract rejected these parameters.",
  NotSteward: "Only the steward of this space can do this.",
  NoVoters: "No contributor has Points yet, so nobody could vote.",
  NotAContributor: "A community proposal comes from a contributor with Points from accepted work.",
  OpeningPledgeRequired: "A request opens with a first pledge from the funder who needs it.",
  NoOpenVote: "No vote is open on this pool.",
  VotingEnded: "The voting period is over. Anyone can close the vote now.",
  NoVotingPower: "This account has no Points, so no voting power.",
  VoteStillOpen: "The voting period is not over and the result can still change.",
  FundingClosed: "This pool is not taking pledges: it is not listed, or its deadline has passed.",
  PoolFull: "The pool already holds its full target. It can launch.",
  NotFunding: "This pool is not in its funding window.",
  TargetNotReached: "All or nothing: the pool has not reached its target.",
  RefundNotAvailable: "Pledges are locked while the pool is still open, and stay with a pool that launched.",
  NothingToRefund: "This funder has no pledge left in the pool.",
  NotBuilding: "This only works on a launched pool that has not been paid yet.",
  ClosureVoteOpen: "A closure vote is open on this pool.",
  ClosureCooldown: "A closure vote just failed. Another one has to wait one voting period, so the pool can be paid meanwhile.",
  NotAParticipant: "Only a funder of this pool or a contributor with Points can ask for a closure vote.",
  NoAcceptedWork: "No accepted work was posted, so there is nobody to pay.",
  TransferFailed: "The token transfer failed.",
  InsufficientBalance: "Not enough demo USDC in this account.",
  InsufficientAllowance: "The pool is not approved to take this amount of demo USDC.",
  MintTooLarge: "The demo faucet mints at most 1,000,000 demo USDC per call.",
  ZeroAddress: "The zero address cannot hold demo USDC.",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof BaseError) return `${err.shortMessage}\n${err.details ?? ""}`;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  return "";
}

export function describeContractError(name: string, args: readonly unknown[] = []): string {
  if (name === "TargetNotReached" && typeof args[0] === "bigint" && typeof args[1] === "bigint") {
    return `All or nothing: ${formatUsdc(args[0])} of ${formatUsdc(args[1])} demo USDC pledged so far.`;
  }
  return CONTRACT_ERRORS[name] ?? `The contract reverted with ${name}.`;
}

export function decodeRevertData(data: Hex): DecodedError | null {
  if (data.length < 10) return null;
  try {
    const { errorName, args } = decodeErrorResult({ abi: ERROR_ABI, data });
    return { kind: "contract", name: errorName, message: describeContractError(errorName, args ?? []) };
  } catch {
    return null;
  }
}

// Finds the revert data wherever the RPC, viem or the wallet put it in the error chain.
function revertDataOf(err: unknown, depth = 0): Hex | null {
  if (!isRecord(err) || depth > 6) return null;
  const data = err.data;
  if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(data)) return data as Hex;
  if (isRecord(data)) {
    const inner = revertDataOf(data, depth + 1);
    if (inner) return inner;
  }
  return revertDataOf(err.cause, depth + 1) ?? revertDataOf(err.error, depth + 1);
}

function codeOf(err: unknown, depth = 0): number | null {
  if (!isRecord(err) || depth > 6) return null;
  if (typeof err.code === "number") return err.code;
  return codeOf(err.cause, depth + 1);
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

export function decodeError(err: unknown): DecodedError {
  if (err instanceof GuardError) return { kind: "guard", name: err.name, message: err.message };

  const message = messageOf(err);
  if (codeOf(err) === 4001 || /user rejected|user denied|rejected the request/i.test(message)) {
    return { kind: "declined", name: "UserRejected", message: "You declined the request in your wallet. Nothing was signed or sent." };
  }

  const data = revertDataOf(err);
  const reverted = data ? decodeRevertData(data) : null;
  if (reverted) return reverted;

  if (/insufficient funds|exceeds the balance|gas required exceeds allowance/i.test(message)) {
    return { kind: "insufficient-funds", name: "InsufficientFunds", message: "Not enough Base Sepolia ETH to pay for this transaction" };
  }
  if (/\b429\b|too many requests|rate.?limit|over rate/i.test(message)) {
    return { kind: "rate-limited", name: "RateLimited", message: "The Base Sepolia RPC is rate-limiting requests. Wait a few seconds and try again." };
  }
  if (/failed to fetch|networkerror|network request failed|fetch failed|http request failed|timed out|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return { kind: "network", name: "NetworkError", message: "Could not reach the Base Sepolia RPC. Check your connection and try again." };
  }
  if (/revert/i.test(message)) return { kind: "contract", name: "Reverted", message: firstLine(message) || "The contract reverted." };
  return { kind: "unknown", name: "Error", message: firstLine(message) || "Unexpected error" };
}
