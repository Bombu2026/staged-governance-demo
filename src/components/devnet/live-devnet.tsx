"use client";

import "@/lib/devnet/buffer-polyfill";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  type DemoKeys,
  type DemoSnapshot,
  type ProposalView,
  type SendResult,
  type SetupPlan,
  type TxSigner,
  PublicKey,
  approveProposal,
  createDemoMultisig,
  createDevnetConnection,
  demoAddresses,
  executeProposal,
  fundSetup,
  generateDemoKeys,
  keypairSigner,
  phantomSigner,
  planSetup,
  proposeTransfer,
  readSnapshot,
  restoreDemoKeys,
  storableDemoKeys,
} from "@/lib/devnet/chain";
import {
  FAUCET_URL,
  MIN_SETUP_BALANCE_LAMPORTS,
  PHANTOM_URL,
  SESSION_STORAGE_KEY,
  SQUADS_PROGRAM_ID,
  THRESHOLD,
  TIME_LOCK_SECONDS,
  TRANSFER_LAMPORTS,
} from "@/lib/devnet/constants";
import { type DecodedError, DevnetError, decodeError } from "@/lib/devnet/errors";
import { formatSol, shortenAddress } from "@/lib/devnet/format";
import { type PhantomProvider, getPhantom } from "@/lib/devnet/phantom";
import { parseDemo, serializeDemo } from "@/lib/devnet/session";
import { chainNowSeconds, formatCountdown, secondsRemaining } from "@/lib/devnet/timelock";
import { ActionButton, Badge, Callout, type Tone } from "../ui";
import type { DevnetEvent } from "./devnet-panel";
import { Address, External, type PreviewLine, Step, TxLink, TxPreview } from "./parts";

const YOU = "Your key (Phantom)";
const KEY_B = "Demo key B";
const ATTACKER = "Attacker (stolen demo key C)";
const SQUADS = `Squads v4 (${shortenAddress(SQUADS_PROGRAM_ID)})`;
const SYSTEM = "System Program";
const PROPOSAL_RENT_NOTE = "about 0.006 devnet SOL of rent for the two new accounts, plus the network fee";
const REFRESH_MS = 15_000;

interface Notice {
  tone: Tone;
  title: string;
  text: ReactNode;
  signature?: string;
}

function loadKeys(): DemoKeys | null {
  try {
    const stored = parseDemo(window.sessionStorage.getItem(SESSION_STORAGE_KEY));
    return stored ? restoreDemoKeys(stored) : null;
  } catch {
    return null;
  }
}

function saveKeys(keys: DemoKeys | null) {
  try {
    if (keys) window.sessionStorage.setItem(SESSION_STORAGE_KEY, serializeDemo(storableDemoKeys(keys)));
    else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage blocked: the demo still runs, it just cannot be resumed after a reload.
  }
}

const stamp = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

const faucetLink = (
  <>
    Get free devnet SOL at <External href={FAUCET_URL}>faucet.solana.com</External> (paste your address), then refresh the
    balance.
  </>
);

function FaucetLink() {
  return <External href={FAUCET_URL}>Get devnet SOL from faucet.solana.com</External>;
}

function noticeFor(error: DecodedError): Notice {
  switch (error.kind) {
    case "declined":
      return { tone: "neutral", title: "You declined", text: "Nothing was signed or sent. Click again when you are ready." };
    case "insufficient-funds":
      return { tone: "warning", title: "Not enough devnet SOL", text: <>{error.message}. {faucetLink}</> };
    case "rate-limited":
      return { tone: "warning", title: "Devnet RPC is rate-limiting", text: error.message };
    case "guard":
      return { tone: "danger", title: "Stopped by a safety check", text: error.message };
    default:
      return { tone: "danger", title: `Failed: ${error.name}`, text: error.message };
  }
}

function lastBy(proposals: ProposalView[], creator: string | undefined): ProposalView | null {
  return proposals.filter((p) => p.creator === creator).at(-1) ?? null;
}

export function LiveDevnet({ onEvent }: { onEvent: (event: DevnetEvent) => void }) {
  const connection = useMemo(createDevnetConnection, []);
  const [provider, setProvider] = useState<PhantomProvider | null | undefined>(undefined);
  const [visitor, setVisitor] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [keys, setKeys] = useState<DemoKeys | null>(loadKeys);
  const [resumed] = useState(() => keys !== null);
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [rpcIssue, setRpcIssue] = useState<DecodedError | null>(null);
  const [busy, setBusy] = useState<{ label: string; stage: "wallet" | "network" } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const found = getPhantom(window);
    if (found) return setProvider(found);
    const timer = setTimeout(() => setProvider(getPhantom(window)), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!provider) return;
    const onAccount = (key: { toBase58(): string } | null) => {
      setVisitor((current) => (current && key ? new PublicKey(key.toBase58()) : null));
      setSnapshot(null);
    };
    const onDisconnect = () => setVisitor(null);
    provider.on("accountChanged", onAccount);
    provider.on("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("accountChanged", onAccount);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [provider]);

  useEffect(() => {
    if (visitor && !keys) {
      const fresh = generateDemoKeys();
      saveKeys(fresh);
      setKeys(fresh);
    }
  }, [visitor, keys]);

  const refresh = useCallback(async () => {
    if (!visitor) return;
    try {
      setSnapshot(await readSnapshot(connection, visitor, keys));
      setRpcIssue(null);
    } catch (err) {
      setRpcIssue(decodeError(err));
    }
  }, [connection, visitor, keys]);

  useEffect(() => {
    if (!visitor) return;
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [visitor, refresh]);

  useEffect(() => {
    if (!visitor || !keys) return;
    let live = true;
    setPlan(null);
    planSetup(connection, keys).then(
      (p) => live && setPlan(p),
      (err: unknown) => live && setRpcIssue(decodeError(err)),
    );
    return () => {
      live = false;
    };
  }, [connection, visitor, keys]);

  const visitorKey = visitor?.toBase58();
  const ms = snapshot?.multisig ?? null;
  const addresses = useMemo(() => (keys ? demoAddresses(keys.b.publicKey) : null), [keys]);
  const keyBAddress = keys?.b.publicKey.toBase58();
  const keyCAddress = keys?.c.publicKey.toBase58();
  const mine = snapshot ? lastBy(snapshot.proposals, visitorKey) : null;
  const stolen = snapshot ? lastBy(snapshot.proposals, keyCAddress) : null;
  const remaining =
    mine?.status === "Approved" && mine.statusAt !== null && ms && snapshot
      ? secondsRemaining(mine.statusAt, ms.timeLock, chainNowSeconds(now, snapshot.chainSkew))
      : null;
  const ticking = remaining !== null && remaining > 0;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);

  function emit(actor: string, text: string, refusal: string | null = null, signature: string | null = null) {
    onEvent({ actor, text, refusal, signature, time: stamp() });
  }

  function wallet(): TxSigner {
    if (!provider || !visitor) throw new DevnetError("guard", "NotConnected", "Connect Phantom first.");
    const signer = phantomSigner(provider, visitor);
    return {
      publicKey: visitor,
      async signTransaction(tx) {
        setBusy((b) => b && { ...b, stage: "wallet" });
        try {
          return await signer.signTransaction(tx);
        } finally {
          setBusy((b) => b && { ...b, stage: "network" });
        }
      },
    };
  }

  async function perform(label: string, actor: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy({ label, stage: "network" });
    setNotice(null);
    try {
      await task();
    } catch (err) {
      const error = decodeError(err);
      if (error.kind === "declined") emit(actor, `${label}: declined in Phantom. Nothing was signed or sent.`);
      else emit(actor, `${label}: not sent.`, `${error.name}: ${error.message}`);
      setNotice(noticeFor(error));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  // Logs the outcome. An on-chain refusal is logged with its signature, like a success.
  function record(result: SendResult, actor: string, done: string, attempt: string, refused?: (e: DecodedError) => string): boolean {
    if (result.error) {
      const why = `${result.error.name}: ${result.error.message}.`;
      emit(actor, attempt, result.error.kind === "program" ? `On-chain refusal, ${why}` : why, result.signature);
      setNotice({
        tone: refused ? "warning" : "danger",
        title: result.error.kind === "program" ? `Refused on-chain: ${result.error.name}` : `Not confirmed: ${result.error.name}`,
        text: refused ? refused(result.error) : result.error.message,
        signature: result.signature,
      });
      return false;
    }
    emit(actor, done, null, result.signature);
    setNotice({ tone: "success", title: "Confirmed on devnet", text: done, signature: result.signature });
    return true;
  }

  async function connect() {
    if (!provider || connecting) return;
    setConnecting(true);
    setNotice(null);
    try {
      const { publicKey } = await provider.connect();
      setVisitor(new PublicKey(publicKey.toBase58()));
    } catch (err) {
      const error = decodeError(err);
      setNotice(
        error.kind === "declined"
          ? { tone: "neutral", title: "Connection declined", text: "You declined the connection request in Phantom. Nothing was shared." }
          : noticeFor(error),
      );
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setVisitor(null);
    setSnapshot(null);
    setNotice(null);
    await provider?.disconnect().catch(() => undefined);
  }

  function startOver() {
    if (busy) return;
    saveKeys(null);
    setKeys(null);
    setPlan(null);
    setSnapshot(null);
    setNotice({ tone: "neutral", title: "Started over", text: "Demo keys B and C and their multisig are forgotten. New demo keys are ready below." });
    emit("Demo", "Started over: forgot demo keys B and C and their multisig. Their leftover devnet SOL stays on-chain, unused.");
  }

  const setup = () =>
    perform("Set up the multisig", YOU, async () => {
      if (!visitor || !keys || !plan) return;
      const fresh = await readSnapshot(connection, visitor, keys);
      if (fresh.lamports.keyB === 0) {
        if ((fresh.lamports.visitor ?? 0) < MIN_SETUP_BALANCE_LAMPORTS) {
          throw new DevnetError(
            "insufficient-funds",
            "InsufficientFunds",
            `The setup needs about ${formatSol(MIN_SETUP_BALANCE_LAMPORTS)} and your wallet holds ${formatSol(fresh.lamports.visitor ?? 0)}`,
          );
        }
        const funded = await fundSetup(connection, wallet(), plan);
        const text = `Funded the demo: ${formatSol(plan.vaultLamports)} to the multisig vault, ${formatSol(plan.keyBLamports)} to demo key B and ${formatSol(plan.keyCLamports)} to demo key C.`;
        if (!record(funded, YOU, text, "Fund the demo")) return;
      }
      if (fresh.multisig) return;
      const created = await createDemoMultisig(connection, keys.b, [visitor, keys.b.publicKey, keys.c.publicKey], plan.treasury);
      record(
        created,
        KEY_B,
        `Created the Squads multisig: you, demo key B and demo key C as members, any ${THRESHOLD} of 3 approve, ${TIME_LOCK_SECONDS} s time lock, no config authority.`,
        "Create the Squads multisig",
      );
    });

  const propose = () =>
    perform("Propose a transfer", YOU, async () => {
      if (!visitor || !addresses) return;
      const r = await proposeTransfer(connection, wallet(), addresses.multisigPda, addresses.vaultPda, visitor, TRANSFER_LAMPORTS);
      record(
        r,
        YOU,
        `Proposed #${r.transactionIndex}: move ${formatSol(TRANSFER_LAMPORTS)} from the vault to your wallet, and approved it (1 of ${THRESHOLD}).`,
        `Propose #${r.transactionIndex}`,
      );
    });

  const approveWithB = (p: ProposalView) =>
    perform(`Approve #${p.index}`, KEY_B, async () => {
      if (!keys || !addresses) return;
      const r = await approveProposal(connection, keypairSigner(keys.b), addresses.multisigPda, p.index);
      record(r, KEY_B, `Approved #${p.index} (2 of ${THRESHOLD}). The ${TIME_LOCK_SECONDS} s time lock starts now.`, `Approve #${p.index}`);
    });

  const execute = (p: ProposalView, by: "B" | "C") =>
    perform(`Execute #${p.index}`, by === "B" ? KEY_B : ATTACKER, async () => {
      if (!keys || !addresses) return;
      const actor = by === "B" ? KEY_B : ATTACKER;
      const r = await executeProposal(connection, keypairSigner(by === "B" ? keys.b : keys.c), addresses.multisigPda, p.index);
      const amount = p.transfer ? formatSol(p.transfer.lamports) : "the transfer";
      record(r, actor, `Executed #${p.index}: ${amount} left the vault, after ${THRESHOLD} approvals and the time lock.`, `Execute proposal #${p.index}`, (e) =>
        e.name === "TimeLockNotReleased"
          ? "Both approvals are in, but the program still refuses until the time lock has run out on the chain clock. That delay is the funders' exit window."
          : e.name === "InvalidProposalStatus"
            ? `The proposal is still Active with ${p.approvals.length} of ${THRESHOLD} approvals, so the program refuses to execute it.`
            : e.message,
      );
    });

  const stealWithC = () =>
    perform("Stolen key proposal", ATTACKER, async () => {
      if (!keys || !addresses || !snapshot) return;
      const amount = Math.max(snapshot.lamports.vault, TRANSFER_LAMPORTS);
      const r = await proposeTransfer(connection, keypairSigner(keys.c), addresses.multisigPda, addresses.vaultPda, keys.c.publicKey, amount);
      record(
        r,
        ATTACKER,
        `Proposed #${r.transactionIndex}: move ${formatSol(amount)} from the vault to demo key C, and approved it with the one key it holds (1 of ${THRESHOLD}).`,
        `Propose #${r.transactionIndex} with a stolen key`,
      );
    });

  const approveAgainWithC = (p: ProposalView) =>
    perform(`Approve #${p.index} again`, ATTACKER, async () => {
      if (!keys || !addresses) return;
      const r = await approveProposal(connection, keypairSigner(keys.c), addresses.multisigPda, p.index);
      record(r, ATTACKER, `Approved #${p.index} again.`, `Approve #${p.index} a second time with the same key`, () =>
        "A member's approval counts once. With a single key the attacker can never reach the threshold.",
      );
    });

  const blocked = busy ? "Wait for the current transaction to finish." : null;

  if (provider === undefined) return <p className="text-sm text-muted">Looking for Phantom…</p>;
  if (provider === null) {
    return (
      <Callout tone="neutral" title="Phantom not detected">
        <p>
          The live mode needs the Phantom browser extension. <External href={PHANTOM_URL}>Install Phantom</External>, then
          reload this page.
        </p>
        <p className="mt-2">
          It also needs a little devnet SOL, which has no value: <FaucetLink />.
        </p>
      </Callout>
    );
  }

  const balance = snapshot?.lamports.visitor ?? null;
  const memberMismatch = ms !== null && visitorKey !== undefined && !ms.members.includes(visitorKey);
  const setupDone = ms !== null && !memberMismatch;
  const vaultLow = (snapshot?.lamports.vault ?? 0) < TRANSFER_LAMPORTS;

  return (
    <div className="space-y-5">
      <Callout tone="neutral" title="Switch Phantom to devnet first">
        In Phantom, open Settings → Developer Settings → Testnet Mode, turn it on and choose Solana Devnet, so the wallet&apos;s
        own previews and balance match this page. This page builds every transaction against devnet, has Phantom sign it
        with signTransaction only, and sends it to the devnet RPC itself.
      </Callout>

      <Step n={1} title="Connect your wallet" state={visitor ? "done" : "active"}>
        {visitor ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-mono text-[15px]" title={visitorKey}>
              {shortenAddress(visitorKey ?? "")}
            </span>
            <span className="text-sm text-muted">
              Balance{" "}
              <span className="font-mono text-ink">{balance === null ? "…" : formatSol(balance)}</span>
            </span>
            <ActionButton why={null} onClick={() => void navigator.clipboard?.writeText(visitorKey ?? "").catch(() => undefined)}>
              Copy address
            </ActionButton>
            <ActionButton why={null} onClick={() => void disconnect()}>
              Disconnect
            </ActionButton>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Phantom shares your public key only. The page keeps it in memory and never asks you to sign a message.
            </p>
            <ActionButton variant="primary" why={connecting ? "Waiting for Phantom…" : null} onClick={() => void connect()}>
              Connect Phantom
            </ActionButton>
          </div>
        )}
        {visitor && (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <ActionButton why={blocked} onClick={() => !blocked && void refresh()}>
              Refresh balance
            </ActionButton>
            <p className="max-w-80 py-2.5 text-[15px] leading-snug">
              <FaucetLink />
              <span className="mt-0.5 block text-[13px] text-muted">Paste your address there, then refresh the balance.</span>
            </p>
          </div>
        )}
      </Step>

      {busy && (
        <p role="status" className="rounded-lg bg-accent/12 px-4 py-3 text-[15px] font-bold text-accent">
          {busy.stage === "wallet"
            ? `${busy.label}: waiting for Phantom. Check its popup against the "What Phantom will ask you to sign" box below.`
            : `${busy.label}: sending to devnet and waiting for confirmation…`}
        </p>
      )}
      {notice && (
        <Callout tone={notice.tone} title={notice.title}>
          <p>{notice.text}</p>
          {notice.signature && (
            <p className="mt-1">
              <TxLink signature={notice.signature} />
            </p>
          )}
        </Callout>
      )}
      {rpcIssue && (
        <Callout tone="warning" title="Devnet RPC problem">
          {rpcIssue.message} The page retries every {REFRESH_MS / 1000} s.
        </Callout>
      )}

      {visitor && keys && addresses && (
        <Step n={2} title="Create the 2-of-3 multisig" state={setupDone ? "done" : "active"}>
          {resumed && setupDone && <p className="text-sm text-muted">Resumed the demo saved in this browser tab.</p>}
          <p className="text-sm leading-relaxed text-muted">
            Demo keys B and C are throwaway devnet keys generated by this page and held only in this browser tab
            (sessionStorage, so a reload does not strand the demo); they exist so one visitor can play all three signers.
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Multisig (Squads account)</dt>
              <dd>
                <Address address={addresses.multisigPda.toBase58()} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Vault (holds the SOL)</dt>
              <dd className="flex items-center gap-2">
                <Address address={addresses.vaultPda.toBase58()} />
                <span className="font-mono text-[13px]">{snapshot ? formatSol(snapshot.lamports.vault) : "…"}</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Demo key B</dt>
              <dd className="flex items-center gap-2">
                <Address address={keyBAddress ?? ""} />
                <span className="font-mono text-[13px]">{snapshot ? formatSol(snapshot.lamports.keyB) : "…"}</span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Demo key C</dt>
              <dd className="flex items-center gap-2">
                <Address address={keyCAddress ?? ""} />
                <span className="font-mono text-[13px]">{snapshot ? formatSol(snapshot.lamports.keyC) : "…"}</span>
              </dd>
            </div>
          </dl>

          {memberMismatch && (
            <Callout tone="warning" title="Different wallet">
              The multisig saved in this tab was created with another wallet. Switch back to it in Phantom, or start over.
            </Callout>
          )}

          {!ms && snapshot && plan && (
            <>
              {snapshot.lamports.keyB === 0 ? (
                <TxPreview
                  heading="What Phantom will ask you to sign"
                  signer="Your key (Phantom), one prompt"
                  lines={[
                    { program: SYSTEM, action: "Transfer", detail: <>{formatSol(plan.vaultLamports)} to the multisig vault <Address address={plan.vault.toBase58()} /></> },
                    { program: SYSTEM, action: "Transfer", detail: <>{formatSol(plan.keyBLamports)} to demo key B <Address address={plan.keyB.toBase58()} /> for fees and the multisig rent</> },
                    { program: SYSTEM, action: "Transfer", detail: <>{formatSol(plan.keyCLamports)} to demo key C <Address address={plan.keyC.toBase58()} /> for fees and rent</> },
                  ]}
                  note={
                    <>
                      Then, with no further prompt, demo key B sends {SQUADS} multisigCreateV2: members you, B and C, threshold{" "}
                      {THRESHOLD}, time lock {TIME_LOCK_SECONDS} s, no config authority
                      {plan.creationFee > 0 ? `, creation fee ${formatSol(plan.creationFee)}` : ", no creation fee on devnet"}.
                    </>
                  }
                />
              ) : (
                <p className="text-sm text-muted">
                  Funding is done. Demo key B still has to create the multisig; this needs no Phantom prompt.
                </p>
              )}
              <ActionButton
                variant="primary"
                why={
                  blocked ??
                  (snapshot.lamports.keyB === 0 && (balance ?? 0) < MIN_SETUP_BALANCE_LAMPORTS
                    ? `Needs about ${formatSol(MIN_SETUP_BALANCE_LAMPORTS)} on devnet; your wallet holds ${formatSol(balance ?? 0)}.`
                    : null)
                }
                onClick={() => !blocked && void setup()}
              >
                {snapshot.lamports.keyB === 0 ? "Fund and create the multisig" : "Create the multisig"}
              </ActionButton>
            </>
          )}
          {!ms && (!snapshot || !plan) && <p className="text-sm text-muted">Reading devnet…</p>}

          {setupDone && ms && (
            <p className="text-sm">
              Members: you, demo key B, demo key C · threshold{" "}
              <span className="font-mono">
                {ms.threshold} of {ms.members.length}
              </span>{" "}
              · time lock <span className="font-mono">{ms.timeLock} s</span>, read from the account on devnet.
            </p>
          )}
          <ActionButton variant="danger" why={blocked} onClick={startOver}>
            Start over
          </ActionButton>
        </Step>
      )}

      {setupDone && ms && addresses && visitorKey && snapshot && (
        <>
          <Step n={3} title="Propose, approve, wait, execute" state={mine?.status === "Executed" ? "done" : "active"}>
            {mine && (
              <ProposalCard proposal={mine} visitorKey={visitorKey} keyB={keyBAddress} keyC={keyCAddress}>
                {mine.status === "Active" && (
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionButton why={blocked} onClick={() => !blocked && void execute(mine, "B")}>
                      Try to execute now
                    </ActionButton>
                    <ActionButton variant="primary" why={blocked} onClick={() => !blocked && void approveWithB(mine)}>
                      Approve with demo key B
                    </ActionButton>
                  </div>
                )}
                {mine.status === "Approved" && remaining !== null && (
                  <>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-3xl font-bold tabular-nums tracking-tight text-warning">
                        {remaining > 0 ? formatCountdown(remaining) : "Released"}
                      </span>
                      <span className="text-sm text-muted">
                        {remaining > 0 ? "until the time lock releases, on the chain clock" : "the time lock has run out on the chain clock"}
                      </span>
                    </div>
                    <ActionButton variant={remaining > 0 ? "secondary" : "primary"} why={blocked} onClick={() => !blocked && void execute(mine, "B")}>
                      {remaining > 0 ? "Try to execute before the time lock" : "Execute"}
                    </ActionButton>
                  </>
                )}
                {mine.status === "Executed" && (
                  <Callout tone="success" title={`Executed #${mine.index}`}>
                    {mine.transfer ? formatSol(mine.transfer.lamports) : "The transfer"} moved from the vault to your wallet only
                    after {THRESHOLD} of 3 keys approved and the {ms.timeLock} s time lock ran out.
                  </Callout>
                )}
              </ProposalCard>
            )}
            {(!mine || mine.status === "Executed") && (
              <>
                <TxPreview
                  heading="What Phantom will ask you to sign"
                  signer="Your key (Phantom), one prompt"
                  lines={proposeLines(ms.transactionIndex + 1n, addresses.vaultPda.toBase58(), visitorKey, TRANSFER_LAMPORTS, "your wallet")}
                  note={<>Nothing moves yet: the transfer is only stored for a vote. You pay {PROPOSAL_RENT_NOTE}. Executions are later sent by demo key B, so they need no prompt.</>}
                />
                <ActionButton
                  variant="primary"
                  why={blocked ?? (vaultLow ? `The vault holds less than ${formatSol(TRANSFER_LAMPORTS)}. Start over to fund a new one.` : null)}
                  onClick={() => !blocked && !vaultLow && void propose()}
                >
                  {mine ? "Propose another transfer" : "Propose and approve with your key"}
                </ActionButton>
              </>
            )}
          </Step>

          <Step n={4} title="Stolen key: demo key C acts alone" state={stolen ? "done" : "active"}>
            <p className="text-sm leading-relaxed text-muted">
              Pretend an attacker stole demo key C. It can propose and approve, but one approval is all a single key can give.
            </p>
            {stolen ? (
              <ProposalCard proposal={stolen} visitorKey={visitorKey} keyB={keyBAddress} keyC={keyCAddress}>
                {stolen.status === "Active" && (
                  <>
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionButton variant="danger" why={blocked} onClick={() => !blocked && void execute(stolen, "C")}>
                        Try to execute with key C
                      </ActionButton>
                      <ActionButton variant="danger" why={blocked} onClick={() => !blocked && void approveAgainWithC(stolen)}>
                        Approve again with key C
                      </ActionButton>
                    </div>
                    <Callout tone="danger" title="One stolen key is not enough">
                      This proposal sits at 1 of {THRESHOLD} approvals. Unless you or demo key B approve it, the program will
                      never execute it, and no SOL has moved.
                    </Callout>
                  </>
                )}
              </ProposalCard>
            ) : (
              <>
                <TxPreview
                  heading="What demo key C will sign, in the page"
                  signer="Demo key C (no Phantom prompt)"
                  lines={proposeLines(ms.transactionIndex + 1n, addresses.vaultPda.toBase58(), keyCAddress ?? "", Math.max(snapshot.lamports.vault, TRANSFER_LAMPORTS), "demo key C")}
                />
                <ActionButton variant="danger" why={blocked} onClick={() => !blocked && void stealWithC()}>
                  Propose a vault drain with key C
                </ActionButton>
              </>
            )}
          </Step>
        </>
      )}
    </div>
  );
}

function proposeLines(index: bigint, vault: string, to: string, lamports: number, toLabel: string): PreviewLine[] {
  return [
    {
      program: SQUADS,
      action: `vaultTransactionCreate #${index}`,
      detail: (
        <>
          stores a transfer of {formatSol(lamports)} from the vault <Address address={vault} /> to {toLabel}{" "}
          <Address address={to} />
        </>
      ),
    },
    { program: SQUADS, action: `proposalCreate #${index}`, detail: "opens the vote on it" },
    { program: SQUADS, action: `proposalApprove #${index}`, detail: `the signer's own approval (1 of ${THRESHOLD})` },
  ];
}

const STATUS_TONE: Record<string, Tone> = { Active: "warning", Approved: "accent", Executed: "success", Cancelled: "neutral", Rejected: "danger" };

function ProposalCard({
  proposal,
  visitorKey,
  keyB,
  keyC,
  children,
}: {
  proposal: ProposalView;
  visitorKey: string;
  keyB: string | undefined;
  keyC: string | undefined;
  children: ReactNode;
}) {
  const signers = [
    { id: "You", key: visitorKey },
    { id: "B", key: keyB },
    { id: "C", key: keyC },
  ];
  const creator = signers.find((s) => s.key === proposal.creator)?.id ?? shortenAddress(proposal.creator);
  return (
    <div className="space-y-4 rounded-lg border border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-lg font-bold">#{proposal.index.toString()}</p>
        <Badge tone={STATUS_TONE[proposal.status ?? ""] ?? "neutral"}>{proposal.status ?? "No proposal"}</Badge>
        {creator === "C" && <Badge tone="danger">Stolen key</Badge>}
      </div>
      <p className="text-sm text-muted">
        Created by {creator === "You" ? "your key" : `demo key ${creator}`}:{" "}
        {proposal.transfer ? (
          <>
            transfer {formatSol(proposal.transfer.lamports)} from the vault to <Address address={proposal.transfer.to} />
          </>
        ) : (
          "a vault transaction"
        )}
      </p>
      <div className="flex items-center gap-1.5 font-mono text-sm">
        {signers.map((s) => (
          <span
            key={s.id}
            title={s.key}
            className={`grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs font-bold ${
              s.key && proposal.approvals.includes(s.key) ? "bg-accent text-on-accent" : "text-muted ring-1 ring-inset ring-line-strong"
            }`}
          >
            {s.id}
          </span>
        ))}
        <span className="ml-1 whitespace-nowrap">
          {proposal.approvals.length} of {THRESHOLD} approvals
        </span>
      </div>
      {children}
    </div>
  );
}
