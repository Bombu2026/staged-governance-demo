import {
  type AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import {
  AIRDROP_LAMPORTS,
  DEMO_KEY_BUDGET_LAMPORTS,
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
  SQUADS_PROGRAM_ID,
  THRESHOLD,
  TIME_LOCK_SECONDS,
  VAULT_FUNDING_LAMPORTS,
} from "./constants";
import { type DecodedTransfer, decodeSystemTransfer } from "./decode";
import { type DecodedError, DevnetError, decodeError } from "./errors";
import type { PhantomProvider } from "./phantom";
import type { StoredDemo } from "./session";
import { clockSkewSeconds, parseClockUnixTimestamp } from "./timelock";

export { Keypair, PublicKey };

const PROGRAM_ID = new PublicKey(SQUADS_PROGRAM_ID);
const MIN_FEE_BALANCE = 10_000;

export function createDevnetConnection(): Connection {
  return new Connection(DEVNET_RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true });
}

const verified = new WeakMap<Connection, Promise<void>>();

// Runs before the first transaction on a connection: refuses anything that is not devnet running Squads v4.
export function assertDevnet(connection: Connection): Promise<void> {
  let check = verified.get(connection);
  if (!check) {
    check = (async () => {
      if (!multisig.PROGRAM_ID.equals(PROGRAM_ID)) {
        throw new DevnetError("guard", "UnexpectedProgramId", "The Squads SDK targets an unexpected program id.");
      }
      const genesis = await connection.getGenesisHash();
      if (genesis !== DEVNET_GENESIS_HASH) {
        throw new DevnetError("guard", "NotDevnet", "The RPC did not answer with the Solana devnet genesis hash, so nothing was sent.");
      }
      const program = await connection.getAccountInfo(PROGRAM_ID);
      if (!program?.executable) {
        throw new DevnetError("guard", "SquadsMissing", "The Squads v4 program was not found on devnet, so nothing was sent.");
      }
    })();
    verified.set(connection, check);
    check.catch(() => verified.delete(connection));
  }
  return check;
}

export interface TxSigner {
  publicKey: PublicKey;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

export function keypairSigner(keypair: Keypair): TxSigner {
  return {
    publicKey: keypair.publicKey,
    async signTransaction(tx) {
      tx.sign([keypair]);
      return tx;
    },
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Phantom only signs. The page checks that the signed message is byte-for-byte the one it built and showed,
// then sends it to the devnet RPC itself.
export function phantomSigner(provider: PhantomProvider, publicKey: PublicKey): TxSigner {
  return {
    publicKey,
    async signTransaction(tx) {
      const shown = tx.message.serialize();
      const returned = await provider.signTransaction(tx);
      const signed = VersionedTransaction.deserialize(returned.serialize());
      if (!sameBytes(signed.message.serialize(), shown)) {
        throw new DevnetError("guard", "ModifiedByWallet", "The wallet returned a different transaction from the one shown here, so it was not sent.");
      }
      return signed;
    },
  };
}

export interface DemoKeys {
  b: Keypair;
  c: Keypair;
}

export const generateDemoKeys = (): DemoKeys => ({ b: Keypair.generate(), c: Keypair.generate() });
export const restoreDemoKeys = (stored: StoredDemo): DemoKeys => ({
  b: Keypair.fromSecretKey(stored.keyB),
  c: Keypair.fromSecretKey(stored.keyC),
});
export const storableDemoKeys = (keys: DemoKeys): StoredDemo => ({ keyB: keys.b.secretKey, keyC: keys.c.secretKey });

// Demo key B doubles as the Squads createKey, so the multisig (and its vault) can be re-derived after a reload.
export function demoAddresses(keyB: PublicKey) {
  const [multisigPda] = multisig.getMultisigPda({ createKey: keyB });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  return { multisigPda, vaultPda };
}

export interface SendResult {
  signature: string;
  error: DecodedError | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirm(
  connection: Connection,
  signature: string,
  raw: Uint8Array | null,
  lastValidBlockHeight: number,
): Promise<DecodedError | null> {
  let failures = 0;
  for (let attempt = 1; ; attempt++) {
    await sleep(1000);
    try {
      const status = (await connection.getSignatureStatuses([signature])).value[0];
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return status.err ? decodeError(status.err) : null;
      }
      if (attempt % 4 === 0) {
        if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
          return { kind: "expired", name: "TransactionExpired", message: "The transaction expired before it was confirmed. Try again." };
        }
        if (raw) await connection.sendRawTransaction(raw, { skipPreflight: true });
      }
      failures = 0;
    } catch (err) {
      if (++failures >= 10) throw err;
    }
  }
}

interface RunOptions {
  // Sends without simulation so that a refusal by the program lands on-chain with a signature.
  skipPreflight?: boolean;
  lookupTables?: AddressLookupTableAccount[];
}

async function run(connection: Connection, signer: TxSigner, instructions: TransactionInstruction[], options: RunOptions = {}): Promise<SendResult> {
  await assertDevnet(connection);
  if (options.skipPreflight && (await connection.getBalance(signer.publicKey)) < MIN_FEE_BALANCE) {
    throw new DevnetError("insufficient-funds", "InsufficientFundsForFee", "This key has no devnet SOL left to pay the fee.");
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(
    options.lookupTables,
  );
  const signed = await signer.signTransaction(new VersionedTransaction(message));
  const raw = signed.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: options.skipPreflight ?? false, preflightCommitment: "confirmed" });
  return { signature, error: await confirm(connection, signature, raw, lastValidBlockHeight) };
}

export async function requestAirdrop(connection: Connection, to: PublicKey): Promise<SendResult> {
  await assertDevnet(connection);
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const signature = await connection.requestAirdrop(to, AIRDROP_LAMPORTS);
  return { signature, error: await confirm(connection, signature, null, lastValidBlockHeight) };
}

export interface SetupPlan {
  vault: PublicKey;
  keyB: PublicKey;
  keyC: PublicKey;
  vaultLamports: number;
  keyBLamports: number;
  keyCLamports: number;
  creationFee: number;
  treasury: PublicKey;
}

export async function planSetup(connection: Connection, keys: DemoKeys): Promise<SetupPlan> {
  await assertDevnet(connection);
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const config = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);
  const creationFee = Number(config.multisigCreationFee.toString());
  return {
    vault: demoAddresses(keys.b.publicKey).vaultPda,
    keyB: keys.b.publicKey,
    keyC: keys.c.publicKey,
    vaultLamports: VAULT_FUNDING_LAMPORTS,
    keyBLamports: DEMO_KEY_BUDGET_LAMPORTS + creationFee,
    keyCLamports: DEMO_KEY_BUDGET_LAMPORTS,
    creationFee,
    treasury: config.treasury,
  };
}

export function setupFundingInstructions(payer: PublicKey, plan: SetupPlan): TransactionInstruction[] {
  return [
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: plan.vault, lamports: plan.vaultLamports }),
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: plan.keyB, lamports: plan.keyBLamports }),
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: plan.keyC, lamports: plan.keyCLamports }),
  ];
}

export const fundSetup = (connection: Connection, payer: TxSigner, plan: SetupPlan) =>
  run(connection, payer, setupFundingInstructions(payer.publicKey, plan));

export function createDemoMultisig(
  connection: Connection,
  keyB: Keypair,
  members: PublicKey[],
  treasury: PublicKey,
  timeLock = TIME_LOCK_SECONDS,
): Promise<SendResult> {
  const { multisigPda } = demoAddresses(keyB.publicKey);
  const instruction = multisig.instructions.multisigCreateV2({
    treasury,
    creator: keyB.publicKey,
    createKey: keyB.publicKey,
    multisigPda,
    configAuthority: null,
    threshold: THRESHOLD,
    members: members.map((key) => ({ key, permissions: multisig.types.Permissions.all() })),
    timeLock,
    rentCollector: null,
  });
  return run(connection, keypairSigner(keyB), [instruction]);
}

// Squads does not store the inner message's blockhash; any valid value works here.
const UNUSED_BLOCKHASH = PublicKey.default.toBase58();

export async function proposeTransfer(
  connection: Connection,
  proposer: TxSigner,
  multisigPda: PublicKey,
  vaultPda: PublicKey,
  to: PublicKey,
  lamports: number,
): Promise<SendResult & { transactionIndex: bigint }> {
  await assertDevnet(connection);
  const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(account.transactionIndex.toString()) + 1n;
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: UNUSED_BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: vaultPda, toPubkey: to, lamports })],
  });
  const creator = proposer.publicKey;
  const result = await run(connection, proposer, [
    multisig.instructions.vaultTransactionCreate({ multisigPda, transactionIndex, creator, vaultIndex: 0, ephemeralSigners: 0, transactionMessage }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator }),
    multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: creator }),
  ]);
  return { ...result, transactionIndex };
}

export const approveProposal = (connection: Connection, member: TxSigner, multisigPda: PublicKey, transactionIndex: bigint) =>
  run(connection, member, [multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: member.publicKey })], {
    skipPreflight: true,
  });

export async function executeProposal(
  connection: Connection,
  member: TxSigner,
  multisigPda: PublicKey,
  transactionIndex: bigint,
): Promise<SendResult> {
  await assertDevnet(connection);
  const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({
    connection,
    multisigPda,
    transactionIndex,
    member: member.publicKey,
  });
  return run(connection, member, [instruction], { skipPreflight: true, lookupTables: lookupTableAccounts });
}

export type ProposalStatusName = multisig.generated.ProposalStatus["__kind"];

export interface ProposalView {
  index: bigint;
  creator: string;
  status: ProposalStatusName | null;
  statusAt: number | null;
  approvals: string[];
  transfer: DecodedTransfer | null;
}

export interface MultisigView {
  members: string[];
  threshold: number;
  timeLock: number;
  transactionIndex: bigint;
}

export interface DemoSnapshot {
  multisig: MultisigView | null;
  proposals: ProposalView[];
  lamports: { visitor: number | null; vault: number; keyB: number; keyC: number };
  chainSkew: number;
}

const RECENT_PROPOSALS = 10n;

export async function readSnapshot(connection: Connection, visitor: PublicKey | null, keys: DemoKeys | null): Promise<DemoSnapshot> {
  await assertDevnet(connection);
  const addresses = keys ? demoAddresses(keys.b.publicKey) : null;
  const wanted = [SYSVAR_CLOCK_PUBKEY, visitor ?? SYSVAR_CLOCK_PUBKEY];
  if (keys && addresses) wanted.push(addresses.multisigPda, addresses.vaultPda, keys.b.publicKey, keys.c.publicKey);
  const infos = await connection.getMultipleAccountsInfo(wanted);
  const clock = infos[0];
  if (!clock) throw new Error("Clock sysvar not returned by the RPC");
  const chainSkew = clockSkewSeconds(parseClockUnixTimestamp(clock.data), Date.now());
  const lamports = {
    visitor: visitor ? (infos[1]?.lamports ?? 0) : null,
    vault: infos[3]?.lamports ?? 0,
    keyB: infos[4]?.lamports ?? 0,
    keyC: infos[5]?.lamports ?? 0,
  };
  const msInfo = infos[2];
  if (!addresses || !msInfo) return { multisig: null, proposals: [], lamports, chainSkew };

  const [ms] = multisig.accounts.Multisig.fromAccountInfo(msInfo);
  const view: MultisigView = {
    members: ms.members.map((m) => m.key.toBase58()),
    threshold: ms.threshold,
    timeLock: ms.timeLock,
    transactionIndex: BigInt(ms.transactionIndex.toString()),
  };
  const indexes: bigint[] = [];
  for (let i = view.transactionIndex > RECENT_PROPOSALS ? view.transactionIndex - RECENT_PROPOSALS + 1n : 1n; i <= view.transactionIndex; i++) {
    indexes.push(i);
  }
  const { multisigPda } = addresses;
  const pdas = indexes.flatMap((index) => [
    multisig.getTransactionPda({ multisigPda, index })[0],
    multisig.getProposalPda({ multisigPda, transactionIndex: index })[0],
  ]);
  const accounts = pdas.length ? await connection.getMultipleAccountsInfo(pdas) : [];
  const proposals: ProposalView[] = [];
  indexes.forEach((index, k) => {
    const txInfo = accounts[2 * k];
    const proposalInfo = accounts[2 * k + 1];
    if (!txInfo) return;
    const [vt] = multisig.accounts.VaultTransaction.fromAccountInfo(txInfo);
    const accountKeys = vt.message.accountKeys.map((key) => key.toBase58());
    const [first] = vt.message.instructions;
    const proposal = proposalInfo ? multisig.accounts.Proposal.fromAccountInfo(proposalInfo)[0] : null;
    const status = proposal?.status ?? null;
    proposals.push({
      index,
      creator: vt.creator.toBase58(),
      status: status?.__kind ?? null,
      statusAt: status && status.__kind !== "Executing" ? Number(status.timestamp.toString()) : null,
      approvals: proposal?.approved.map((key) => key.toBase58()) ?? [],
      transfer: vt.message.instructions.length === 1 && first ? decodeSystemTransfer(accountKeys, first) : null,
    });
  });
  return { multisig: view, proposals, lamports, chainSkew };
}
