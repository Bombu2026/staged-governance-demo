// Headless proof, on Solana devnet only, that a Squads v4 multisig enforces a 2-of-3 threshold and a time lock.
// Keys are generated in memory and never written anywhere; no wallet, keypair file or env secret is read.
// Usage: node scripts/devnet-check.mjs
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

const RPC_URL = "https://api.devnet.solana.com";
// docs.anza.xyz/clusters/available: `--expected-genesis-hash` for devnet.
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const SQUADS_PROGRAM_ID = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
const TIME_LOCK_SECONDS = 30;
const NEEDED_LAMPORTS = 0.1 * LAMPORTS_PER_SOL;
const FEE_BUDGET_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
const VAULT_FUNDING_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
const TRANSFER_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
const MANUAL_FUNDING_WAIT_MS = (Number(process.env.FUNDING_WAIT_MINUTES) || 3) * 60_000;

const connection = new Connection(RPC_URL, "confirmed");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const short = (key) => key.toBase58();
const explorer = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const firstLine = (err) => String(err?.message ?? err).split("\n")[0].slice(0, 200);
const signatures = [];

class Fail extends Error {}

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}

function record(label, signature, outcome) {
  signatures.push({ label, signature, outcome });
  console.log(`    ${outcome === "ok" ? "confirmed" : `refused on-chain: ${outcome}`}  ${label}`);
  console.log(`    ${explorer(signature)}`);
}

function errorName(err) {
  const custom = err?.InstructionError?.[1]?.Custom;
  if (typeof custom === "number") return multisig.generated.errorFromCode(custom)?.name ?? `Custom(${custom})`;
  return JSON.stringify(err);
}

async function confirm(signature, raw, lastValidBlockHeight) {
  for (let attempt = 1; ; attempt++) {
    await sleep(1000);
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status.err;
    if (attempt % 4 === 0) {
      if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Fail(`transaction ${signature} expired`);
      if (raw) await connection.sendRawTransaction(raw, { skipPreflight: true }).catch(() => undefined);
    }
  }
}

// Sends a v0 transaction. With expectError, it skips preflight so the refusal is recorded on-chain.
async function send(label, payer, signers, instructions, { expectError, lookupTables } = {}) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(message);
  tx.sign([payer, ...signers]);
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: Boolean(expectError) });
  const err = await confirm(signature, raw, lastValidBlockHeight);
  const outcome = err ? errorName(err) : "ok";
  record(label, signature, outcome);
  if (expectError ? outcome !== expectError : err) {
    throw new Fail(`${label}: expected ${expectError ?? "success"}, got ${outcome}`);
  }
  return signature;
}

async function chainNow() {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  return Number(info.data.readBigInt64LE(32));
}

async function fundFromFaucet(a) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const signature = await connection.requestAirdrop(a.publicKey, LAMPORTS_PER_SOL);
      const err = await confirm(signature, null, lastValidBlockHeight);
      if (!err) {
        record("airdrop 1 SOL to A", signature, "ok");
        return;
      }
      console.log(`    airdrop ${signature} failed on-chain: ${JSON.stringify(err)}`);
    } catch (err) {
      const message = firstLine(err);
      if (/\b410\b|faucet is closed/i.test(message)) {
        console.log(`    airdrop refused, the RPC faucet is closed: ${message}`);
        break;
      }
      const wait = 2000 * 2 ** (attempt - 1);
      console.log(`    airdrop attempt ${attempt} refused (${message}); retrying in ${wait / 1000} s`);
      await sleep(wait);
    }
  }

  console.log(`\n    The devnet faucet refused the airdrop (closed or rate-limited).`);
  console.log(`    To continue, send at least ${NEEDED_LAMPORTS / LAMPORTS_PER_SOL} devnet SOL to this throwaway key from https://faucet.solana.com :`);
  console.log(`\n        ${short(a.publicKey)}\n`);
  console.log(`    Waiting up to ${MANUAL_FUNDING_WAIT_MS / 60_000} minutes for the balance to arrive…`);
  const deadline = Date.now() + MANUAL_FUNDING_WAIT_MS;
  while (Date.now() < deadline) {
    const balance = await connection.getBalance(a.publicKey).catch(() => 0);
    if (balance >= NEEDED_LAMPORTS) {
      console.log(`    received ${balance / LAMPORTS_PER_SOL} SOL`);
      return;
    }
    await sleep(5000);
  }
  throw new Fail("the devnet faucet is closed or rate-limited and no manual funding arrived in time");
}

async function main() {
  step(0, `Checking ${RPC_URL} is Solana devnet running Squads v4`);
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) throw new Fail(`genesis hash ${genesis} is not devnet (${DEVNET_GENESIS_HASH}); refusing to send anything`);
  console.log(`    genesis hash ${genesis} = devnet`);
  if (multisig.PROGRAM_ID.toBase58() !== SQUADS_PROGRAM_ID) throw new Fail(`SDK program id ${multisig.PROGRAM_ID.toBase58()} is unexpected`);
  const program = await connection.getAccountInfo(multisig.PROGRAM_ID);
  if (!program?.executable) throw new Fail(`${SQUADS_PROGRAM_ID} is not an executable account on devnet`);
  console.log(`    program ${SQUADS_PROGRAM_ID} executable, owner ${program.owner.toBase58()}`);
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);
  const creationFee = Number(programConfig.multisigCreationFee.toString());
  console.log(`    program config ${short(programConfigPda)}: creation fee ${creationFee} lamports, treasury ${short(programConfig.treasury)}`);

  step(1, "Generating throwaway keypairs in memory");
  const [a, b, c, recipient, createKey] = Array.from({ length: 5 }, () => Keypair.generate());
  for (const [name, key] of [["A", a], ["B", b], ["C", c], ["recipient", recipient]]) console.log(`    ${name.padEnd(9)} ${short(key.publicKey)}`);

  step(2, "Funding A from the devnet faucet, then A funds B and C for fees");
  await fundFromFaucet(a);
  await send("A sends 0.01 SOL to B and to C", a, [], [
    SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: b.publicKey, lamports: FEE_BUDGET_LAMPORTS }),
    SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: c.publicKey, lamports: FEE_BUDGET_LAMPORTS }),
  ]);

  step(3, `Creating the Squads multisig: members A, B, C, threshold 2, time lock ${TIME_LOCK_SECONDS} s, no config authority`);
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  await send("multisigCreateV2", a, [createKey], [
    multisig.instructions.multisigCreateV2({
      treasury: programConfig.treasury,
      creator: a.publicKey,
      createKey: createKey.publicKey,
      multisigPda,
      configAuthority: null,
      threshold: 2,
      members: [a, b, c].map((k) => ({ key: k.publicKey, permissions: multisig.types.Permissions.all() })),
      timeLock: TIME_LOCK_SECONDS,
      rentCollector: null,
    }),
  ]);
  const created = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  console.log(`    multisig ${short(multisigPda)}: threshold ${created.threshold}, time lock ${created.timeLock} s, ${created.members.length} members, config authority ${short(created.configAuthority)}`);
  if (created.threshold !== 2 || created.timeLock !== TIME_LOCK_SECONDS || created.members.length !== 3 || !created.configAuthority.equals(PublicKey.default)) {
    throw new Fail("multisig account does not hold the requested configuration");
  }

  step(4, "Funding the vault (index 0) with 0.05 SOL");
  await send("A sends 0.05 SOL to the vault", a, [], [
    SystemProgram.transfer({ fromPubkey: a.publicKey, toPubkey: vaultPda, lamports: VAULT_FUNDING_LAMPORTS }),
  ]);
  console.log(`    vault ${short(vaultPda)} holds ${(await connection.getBalance(vaultPda)) / LAMPORTS_PER_SOL} SOL`);

  step(5, "A creates a vault transaction (0.01 SOL vault -> recipient), its proposal, and approves it");
  const transactionIndex = BigInt(created.transactionIndex.toString()) + 1n;
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: vaultPda, toPubkey: recipient.publicKey, lamports: TRANSFER_LAMPORTS })],
  });
  await send("vaultTransactionCreate + proposalCreate + proposalApprove (A)", a, [], [
    multisig.instructions.vaultTransactionCreate({ multisigPda, transactionIndex, creator: a.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator: a.publicKey }),
    multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: a.publicKey }),
  ]);

  const execute = async (label, member, expectError) => {
    const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({
      connection,
      multisigPda,
      transactionIndex,
      member: member.publicKey,
    });
    return send(label, member, [], [instruction], { expectError, lookupTables: lookupTableAccounts });
  };

  step(6, "Executing with 1 of 2 approvals (must fail)");
  await execute("vaultTransactionExecute at 1 of 2 (A)", a, "InvalidProposalStatus");

  step(7, "B approves, then executes immediately (must fail: time lock)");
  await send("proposalApprove (B)", b, [], [multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: b.publicKey })]);
  await execute("vaultTransactionExecute before the time lock (B)", b, "TimeLockNotReleased");

  step(8, "Waiting for the time lock on the chain clock, then executing");
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex });
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  if (proposal.status.__kind !== "Approved") throw new Fail(`proposal status is ${proposal.status.__kind}, expected Approved`);
  const releaseAt = Number(proposal.status.timestamp.toString()) + TIME_LOCK_SECONDS;
  for (let now = await chainNow(); now < releaseAt; now = await chainNow()) {
    console.log(`    chain clock ${now}, releases at ${releaseAt} (${releaseAt - now} s)`);
    await sleep(Math.min(5000, (releaseAt - now) * 1000 + 500));
  }
  const before = await connection.getBalance(recipient.publicKey);
  await execute("vaultTransactionExecute after the time lock (B)", b);
  const after = await connection.getBalance(recipient.publicKey);
  const executed = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
  console.log(`    recipient ${before / LAMPORTS_PER_SOL} -> ${after / LAMPORTS_PER_SOL} SOL, proposal ${executed.status.__kind}`);
  if (after - before !== TRANSFER_LAMPORTS) throw new Fail(`recipient balance changed by ${after - before} lamports, expected ${TRANSFER_LAMPORTS}`);
  if (executed.status.__kind !== "Executed") throw new Fail(`proposal status is ${executed.status.__kind}, expected Executed`);

  return { multisigPda, vaultPda };
}

let exitCode = 0;
try {
  const { multisigPda, vaultPda } = await main();
  console.log("\nSignatures:");
  for (const s of signatures) console.log(`  ${s.outcome === "ok" ? "ok     " : "refused"}  ${s.label}\n           ${explorer(s.signature)}`);
  console.log(`\nMultisig https://explorer.solana.com/address/${multisigPda.toBase58()}?cluster=devnet`);
  console.log(`Vault    https://explorer.solana.com/address/${vaultPda.toBase58()}?cluster=devnet`);
  console.log("\nPASS: 1 of 2 refused (InvalidProposalStatus), 2 of 2 before the time lock refused (TimeLockNotReleased), executed after it.");
} catch (err) {
  console.log(`\nFAIL: ${err instanceof Fail ? err.message : firstLine(err)}`);
  if (signatures.length) console.log(`Signatures so far:\n${signatures.map((s) => `  ${explorer(s.signature)}`).join("\n")}`);
  exitCode = 1;
}
process.exit(exitCode);
