export type ErrorKind =
  | "declined"
  | "program"
  | "rate-limited"
  | "faucet"
  | "insufficient-funds"
  | "expired"
  | "network"
  | "guard"
  | "unknown";

export interface DecodedError {
  kind: ErrorKind;
  name: string;
  message: string;
}

export class DevnetError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, name: string, message: string) {
    super(message);
    this.kind = kind;
    this.name = name;
  }
}

// Squads v4 program errors, in IDL order from code 6000 (node_modules/@sqds/multisig/idl/squads_multisig_program.json).
const SQUADS_ERRORS: readonly (readonly [string, string])[] = [
  ["DuplicateMember", "Found multiple members with the same pubkey"],
  ["EmptyMembers", "Members array is empty"],
  ["TooManyMembers", "Too many members"],
  ["InvalidThreshold", "Invalid threshold"],
  ["Unauthorized", "Attempted to perform an unauthorized action"],
  ["NotAMember", "Provided pubkey is not a member of the multisig"],
  ["InvalidTransactionMessage", "Transaction message is malformed"],
  ["StaleProposal", "Proposal is stale"],
  ["InvalidProposalStatus", "Invalid proposal status: the proposal has not reached its approval threshold"],
  ["InvalidTransactionIndex", "Invalid transaction index"],
  ["AlreadyApproved", "Member already approved the transaction"],
  ["AlreadyRejected", "Member already rejected the transaction"],
  ["AlreadyCancelled", "Member already cancelled the transaction"],
  ["InvalidNumberOfAccounts", "Wrong number of accounts provided"],
  ["InvalidAccount", "Invalid account provided"],
  ["RemoveLastMember", "Cannot remove last member"],
  ["NoVoters", "Members don't include any voters"],
  ["NoProposers", "Members don't include any proposers"],
  ["NoExecutors", "Members don't include any executors"],
  ["InvalidStaleTransactionIndex", "Stale transaction index must be at most the transaction index"],
  ["NotSupportedForControlled", "Instruction not supported for controlled multisig"],
  ["TimeLockNotReleased", "Proposal time lock has not been released"],
  ["NoActions", "Config transaction must have at least one action"],
  ["MissingAccount", "Missing account"],
  ["InvalidMint", "Invalid mint"],
  ["InvalidDestination", "Invalid destination"],
  ["SpendingLimitExceeded", "Spending limit exceeded"],
  ["DecimalsMismatch", "Decimals don't match the mint"],
  ["UnknownPermission", "Member has unknown permission"],
  ["ProtectedAccount", "Account is protected, it cannot be passed into a CPI as writable"],
  ["TimeLockExceedsMaxAllowed", "Time lock exceeds the maximum allowed (90 days)"],
  ["IllegalAccountOwner", "Account is not owned by the multisig program"],
  ["RentReclamationDisabled", "Rent reclamation is disabled for this multisig"],
  ["InvalidRentCollector", "Invalid rent collector address"],
  ["ProposalForAnotherMultisig", "Proposal is for another multisig"],
  ["TransactionForAnotherMultisig", "Transaction is for another multisig"],
  ["TransactionNotMatchingProposal", "Transaction doesn't match proposal"],
  ["TransactionNotLastInBatch", "Transaction is not last in batch"],
  ["BatchNotEmpty", "Batch is not empty"],
  ["SpendingLimitInvalidAmount", "Invalid spending limit amount"],
  ["InvalidInstructionArgs", "Invalid instruction arguments"],
  ["FinalBufferHashMismatch", "Final message buffer hash doesn't match the expected hash"],
  ["FinalBufferSizeExceeded", "Final buffer size cannot exceed 4000 bytes"],
  ["FinalBufferSizeMismatch", "Final buffer size mismatch"],
  ["MultisigCreateDeprecated", "multisig_create is deprecated, use multisig_create_v2"],
];

const OTHER_CODES: Record<number, readonly [string, string]> = {
  0: ["AccountAlreadyInUse", "System program: the account already exists"],
  1: ["ResultWithNegativeLamports", "System program: insufficient lamports for the transfer"],
  2006: ["ConstraintSeeds", "Anchor: a seeds constraint was violated"],
  3007: ["AccountOwnedByWrongProgram", "Anchor: account owned by a different program"],
  3012: ["AccountNotInitialized", "Anchor: the account does not exist yet"],
};

const FUNDS_ERRORS = new Set([
  "InsufficientFundsForFee",
  "InsufficientFundsForRent",
  "AccountNotFound",
  "ResultWithNegativeLamports",
  "InsufficientFunds",
]);

export function nameForCustomCode(code: number): readonly [string, string] | null {
  const squads = SQUADS_ERRORS[code - 6000];
  if (code >= 6000 && squads) return squads;
  return OTHER_CODES[code] ?? null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  return "";
}

function fromCode(code: number): DecodedError {
  const known = nameForCustomCode(code);
  if (!known) return { kind: "program", name: `Custom(${code})`, message: `Program error ${code}` };
  const [name, message] = known;
  return { kind: FUNDS_ERRORS.has(name) ? "insufficient-funds" : "program", name, message };
}

function fromTransactionError(err: unknown): DecodedError | null {
  if (typeof err === "string") {
    if (FUNDS_ERRORS.has(err)) return { kind: "insufficient-funds", name: err, message: "Not enough devnet SOL to pay for this transaction" };
    if (err === "BlockhashNotFound") return { kind: "expired", name: err, message: "The transaction's blockhash expired" };
    return /^[A-Z][A-Za-z]+$/.test(err) ? { kind: "unknown", name: err, message: err } : null;
  }
  if (!isRecord(err)) return null;
  const ix = err.InstructionError;
  if (Array.isArray(ix) && ix.length === 2) {
    const inner: unknown = ix[1];
    if (isRecord(inner) && typeof inner.Custom === "number") return fromCode(inner.Custom);
    if (typeof inner === "string") return fromTransactionError(inner) ?? { kind: "unknown", name: inner, message: inner };
  }
  const keys = Object.keys(err);
  if (keys.length === 1 && FUNDS_ERRORS.has(keys[0])) return fromTransactionError(keys[0]);
  return null;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

export function decodeError(err: unknown): DecodedError {
  if (err instanceof DevnetError) return { kind: err.kind, name: err.name, message: err.message };

  const message = messageOf(err);
  if ((isRecord(err) && err.code === 4001) || /user rejected|rejected the request|user denied/i.test(message)) {
    return { kind: "declined", name: "UserRejected", message: "You declined the request in Phantom. Nothing was signed or sent." };
  }

  const tx = fromTransactionError(isRecord(err) && "err" in err ? err.err : err);
  if (tx && (tx.kind !== "unknown" || typeof err !== "string")) return tx;

  const logs = isRecord(err) && Array.isArray(err.logs) ? err.logs.filter((l): l is string => typeof l === "string") : [];
  const haystack = [message, ...logs].join("\n");
  const number = haystack.match(/Error Number: (\d+)/);
  if (number) return fromCode(Number(number[1]));
  const hex = haystack.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) return fromCode(Number.parseInt(hex[1], 16));

  if (/faucet|airdrop/i.test(haystack) || /\b410\b/.test(haystack)) {
    return {
      kind: "faucet",
      name: "AirdropRefused",
      message: "The devnet RPC refused the airdrop (its faucet is closed or rate-limited).",
    };
  }
  if (/\b429\b|too many requests|rate.?limit/i.test(haystack)) {
    return { kind: "rate-limited", name: "RateLimited", message: "The devnet RPC is rate-limiting requests. Wait a few seconds and try again." };
  }
  if (/no record of a prior credit|insufficient (funds|lamports)/i.test(haystack)) {
    return { kind: "insufficient-funds", name: "InsufficientFunds", message: "Not enough devnet SOL to pay for this transaction" };
  }
  if (/block height exceeded|has expired|blockhash not found/i.test(haystack)) {
    return { kind: "expired", name: "TransactionExpired", message: "The transaction expired before it was confirmed. Try again." };
  }
  if (/failed to fetch|networkerror|network request failed|fetch failed|ECONNRESET|ETIMEDOUT/i.test(haystack)) {
    return { kind: "network", name: "NetworkError", message: "Could not reach the devnet RPC. Check your connection and try again." };
  }
  if (tx) return tx;
  return { kind: "unknown", name: "Error", message: firstLine(message) || "Unexpected error" };
}
