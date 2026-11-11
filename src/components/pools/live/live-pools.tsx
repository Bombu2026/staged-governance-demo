"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { type Address as EvmAddress, getAddress } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  type Deployment,
  type PayoutLine,
  type PoolView,
  type Snapshot,
  type TallyView,
  approveTx,
  createSpaceTx,
  deployPoolsTx,
  deployUsdcTx,
  finalizeTx,
  launchTx,
  mintTx,
  openClosureTx,
  payOutTx,
  payoutsFrom,
  pledgeTx,
  pledgedFrom,
  proposeTx,
  readDeployment,
  readPool,
  readSnapshot,
  refundTx,
  setPointsTx,
  spaceIdFrom,
  voteTx,
} from "@/lib/pools/chain/actions";
import { POOLS_ADDRESS, USDC_ADDRESS } from "@/lib/pools/chain/addresses";
import { gasBudgets } from "@/lib/pools/chain/budget";
import {
  CHAIN_NAME,
  DEMO_MINT_USDC,
  DEMO_OPENING_USDC,
  DEMO_PLEDGE_USDC,
  DEMO_TARGET_USDC,
  FAUCET_URL,
  FUNDING_SECONDS,
  PHANTOM_URL,
  SESSION_STORAGE_KEY,
  VOTING_SECONDS,
  WALLET_HELP_URL,
} from "@/lib/pools/chain/constants";
import { type Sender, type SendResult, type TxRequest, createChainClient, ensureWalletChain, keySender, run, walletSender } from "@/lib/pools/chain/core";
import { type DecodedError, GuardError, decodeError } from "@/lib/pools/chain/errors";
import { explorerTxUrl, formatCountdown, formatEth, shortenAddress } from "@/lib/pools/chain/format";
import { type DemoRole, type StoredDemo, DEMO_ROLES, parseDemo, serializeDemo } from "@/lib/pools/chain/session";
import { type WalletOption, discoverWallets } from "@/lib/pools/chain/wallet";
import { type Choice, type Points, earlyVerdict, formatPower, formatUsdc, formatUsdcRounded, percentText, usdc } from "@/lib/pools/math";
import { ActionButton, Badge, Callout, type Tone } from "../../ui";
import { LABEL, PoolProgress, TallyBar } from "../parts";
import type { LiveEvent } from "./live-panel";
import { Address, External, type PreviewLine, Step, TxLink, TxPreview } from "./parts";

const YOU = "You (Company A)";
const ANYONE = "Any account (demo key)";
const POOLS = `PooledFunding (${shortenAddress(POOLS_ADDRESS)})`;
const USDC = `Demo USDC (${shortenAddress(USDC_ADDRESS)})`;
const REFRESH_MS = 8_000;

const ROLE_LABEL: Record<DemoRole, string> = {
  steward: "Steward (demo key)",
  contributorA: "Contributor A",
  contributorB: "Contributor B",
  contributorC: "Contributor C",
  companyB: "Company B",
  companyC: "Company C",
  fees: "Fee wallet",
};

const VOTERS = ["contributorA", "contributorB", "contributorC"] as const;
const COMPANIES = ["companyB", "companyC"] as const;
// Every key that sends transactions besides the steward.
const GAS_KEYS = [...VOTERS, ...COMPANIES] as const;

// Sample Points of the three demo contributors: a specialist of the pool's domain, a generalist and an outsider.
const DEMO_POINTS: Record<(typeof VOTERS)[number], Points> = {
  contributorA: [380, 40, 20, 120],
  contributorB: [60, 240, 200, 240],
  contributorC: [10, 20, 380, 30],
};
const PROFILE: Record<(typeof VOTERS)[number], string> = {
  contributorA: "Specialist of this domain",
  contributorB: "Generalist",
  contributorC: "Specialist of another domain",
};
// Sample record of accepted work posted at payout.
const DEMO_WORK: Record<(typeof VOTERS)[number], bigint> = { contributorA: 160n, contributorB: 60n, contributorC: 120n };
const workTotal = Object.values(DEMO_WORK).reduce((sum, points) => sum + points, 0n);

const TARGET = usdc(DEMO_TARGET_USDC);
const PLEDGE = usdc(DEMO_PLEDGE_USDC);
const OPENING = usdc(DEMO_OPENING_USDC);
const MINT = usdc(DEMO_MINT_USDC);

interface Notice {
  tone: Tone;
  title: string;
  text: ReactNode;
  hash?: string;
}

interface Connected {
  option: WalletOption;
  address: EvmAddress;
}

function loadDemo(): StoredDemo | null {
  try {
    return parseDemo(window.sessionStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveDemo(demo: StoredDemo | null) {
  try {
    if (demo) window.sessionStorage.setItem(SESSION_STORAGE_KEY, serializeDemo(demo));
    else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage blocked: the demo still runs, it just cannot be resumed after a reload.
  }
}

const freshDemo = (): StoredDemo => ({
  keys: Object.fromEntries(DEMO_ROLES.map((role) => [role, generatePrivateKey()])) as StoredDemo["keys"],
  spaceId: null,
});

const stamp = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

function noticeFor(error: DecodedError): Notice {
  switch (error.kind) {
    case "declined":
      return { tone: "neutral", title: "You declined", text: "Nothing was signed or sent. Click again when you are ready." };
    case "insufficient-funds":
      return {
        tone: "warning",
        title: "Not enough testnet ETH",
        text: (
          <>
            {error.message}. Get free {CHAIN_NAME} ETH from a <External href={FAUCET_URL}>faucet</External>, or top up the demo keys below.
          </>
        ),
      };
    case "rate-limited":
      return { tone: "warning", title: "The RPC is rate-limiting", text: error.message };
    case "guard":
      return { tone: "danger", title: "Stopped by a safety check", text: error.message };
    default:
      return { tone: "danger", title: `Failed: ${error.name}`, text: error.message };
  }
}

const isOver = (status: PoolView["status"]) => status === "paid" || status === "not-listed" || status === "expired" || status === "closed";

export function LivePools({ onEvent }: { onEvent: (event: LiveEvent) => void }) {
  const client = useMemo(() => createChainClient(), []);
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [wallet, setWallet] = useState<Connected | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [demo, setDemo] = useState<StoredDemo | null>(loadDemo);
  const [resumed] = useState(() => demo !== null && demo.spaceId !== null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [payout, setPayout] = useState<{ poolId: bigint; lines: PayoutLine[]; net: bigint; fee: bigint } | null>(null);
  const [another, setAnother] = useState(false);
  const [rpcIssue, setRpcIssue] = useState<DecodedError | null>(null);
  const [busy, setBusy] = useState<{ label: string; stage: "wallet" | "network" } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void discoverWallets(window).then((found) => live && setWallets(found));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const { provider } = wallet.option;
    const onAccounts = (accounts: unknown) => {
      const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      setWallet((current) => (current && next ? { ...current, address: getAddress(next) } : null));
      setSnapshot(null);
    };
    const onDisconnect = () => setWallet(null);
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [wallet]);

  useEffect(() => {
    if (wallet && !demo) {
      const fresh = freshDemo();
      saveDemo(fresh);
      setDemo(fresh);
    }
  }, [wallet, demo]);

  // One sender per demo key, kept for the life of the sandbox: each counts its own nonces.
  const keys = useMemo(
    () => (demo ? (Object.fromEntries(DEMO_ROLES.map((role) => [role, keySender(client, demo.keys[role])])) as Record<DemoRole, Sender>) : null),
    [client, demo],
  );
  const visitor = wallet?.address ?? null;
  const spaceId = demo?.spaceId ?? null;

  const refresh = useCallback(async () => {
    try {
      const [deployed, price] = await Promise.all([readDeployment(client), client.getGasPrice()]);
      setDeployment(deployed);
      setGasPrice(price);
      if (visitor && keys && deployed.usdc && deployed.pools) {
        setSnapshot(
          await readSnapshot(client, {
            spaceId,
            accounts: [visitor, keys.steward.address, ...GAS_KEYS.map((role) => keys[role].address)],
            holders: [visitor, ...COMPANIES.map((role) => keys[role].address)],
            funders: [visitor, ...COMPANIES.map((role) => keys[role].address)],
            voters: VOTERS.map((role) => keys[role].address),
          }),
        );
      }
      setRpcIssue(null);
    } catch (err) {
      setRpcIssue(decodeError(err));
    }
  }, [client, visitor, keys, spaceId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const pool = snapshot?.pool ?? null;
  const vote: TallyView | null = pool ? (pool.status === "voting" ? pool.listing : pool.status === "building" && pool.closure.open ? pool.closure : null) : null;
  const chainNow = now / 1000 + (snapshot?.chainSkew ?? 0);
  const voteLeft = vote ? Math.max(0, vote.end - chainNow) : null;
  const fundingLeft = pool?.status === "funding" && pool.pledged < pool.target ? Math.max(0, pool.deadline - chainNow) : null;
  const ticking = (voteLeft ?? 0) > 0 || (fundingLeft ?? 0) > 0;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);

  // The deadline passes without any transaction, so the page re-reads the chain when its countdown ends.
  const deadlineHit = fundingLeft === 0;
  useEffect(() => {
    if (deadlineHit) void refresh();
  }, [deadlineHit, refresh]);

  function emit(actor: string, text: string, refusal: string | null = null, hash: string | null = null) {
    onEvent({ actor, text, refusal, href: hash ? explorerTxUrl(hash) : null, time: stamp() });
  }

  function me(): Sender {
    if (!wallet || !keys) throw new GuardError("NotConnected", "Connect a wallet first.");
    const sender = walletSender(wallet.option.provider, wallet.address, [keys.steward.address]);
    return {
      address: sender.address,
      async send(tx) {
        setBusy((b) => b && { ...b, stage: "wallet" });
        try {
          await ensureWalletChain(wallet.option.provider);
          return await sender.send(tx);
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
      if (error.kind === "declined") emit(actor, `${label}: declined in the wallet. Nothing was signed or sent.`);
      else emit(actor, `${label}: not sent.`, `${error.name}: ${error.message}`);
      setNotice(noticeFor(error));
    } finally {
      // Re-read the chain before the next action is possible, so it never starts from stale numbers.
      await refresh();
      setBusy(null);
    }
  }

  // Logs the outcome. A refusal by the contract is logged with its name, and with a link when it was sent as evidence.
  function record(result: SendResult, actor: string, done: string, attempt: string, explain?: (e: DecodedError) => string): boolean {
    if (result.error) {
      const why = `${result.error.name}: ${result.error.message}`;
      emit(actor, attempt, result.hash ? `Refused on-chain, ${why}` : `Refused by the contract, ${why}`, result.hash);
      setNotice({
        tone: explain ? "warning" : "danger",
        title: `Refused by the contract: ${result.error.name}`,
        text: explain ? explain(result.error) : result.error.message,
        hash: result.hash ?? undefined,
      });
      return false;
    }
    emit(actor, done, null, result.hash);
    setNotice({ tone: "success", title: `Confirmed on ${CHAIN_NAME}`, text: done, hash: result.hash ?? undefined });
    return true;
  }

  const send = (sender: Sender, tx: TxRequest, evidence = false) => run(client, sender, tx, { evidence });

  async function connect(option: WalletOption) {
    if (connecting) return;
    setConnecting(true);
    setNotice(null);
    try {
      const accounts = await option.provider.request({ method: "eth_requestAccounts" });
      const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      if (!first) throw new GuardError("NoAccount", "The wallet did not share an account.");
      await ensureWalletChain(option.provider);
      setWallet({ option, address: getAddress(first) });
    } catch (err) {
      const error = decodeError(err);
      setNotice(
        error.kind === "declined"
          ? { tone: "neutral", title: "Connection declined", text: "You declined the request in your wallet. Nothing was shared." }
          : noticeFor(error),
      );
    } finally {
      setConnecting(false);
    }
  }

  function startOver() {
    if (busy) return;
    saveDemo(null);
    setDemo(null);
    setSnapshot(null);
    setPayout(null);
    setAnother(false);
    setNotice({ tone: "neutral", title: "Started over", text: "The demo keys and their sandbox are forgotten. New demo keys are ready below." });
    emit("Demo", "Started over: forgot the demo keys and their sandbox. What they hold stays on the testnet, unused.");
  }

  const deploy = () =>
    perform("Deploy the contracts", YOU, async () => {
      const current = await readDeployment(client);
      if (!current.deployer) throw new GuardError("NoDeployerProxy", `The deterministic deployment proxy was not found on ${CHAIN_NAME}, so nothing was sent.`);
      if (!current.usdc && !record(await send(me(), deployUsdcTx()), YOU, `Deployed Demo USDC at ${USDC_ADDRESS}.`, "Deploy Demo USDC")) return;
      if (!current.pools) record(await send(me(), deployPoolsTx()), YOU, `Deployed PooledFunding at ${POOLS_ADDRESS}. It has no owner and cannot be upgraded.`, "Deploy PooledFunding");
    });

  // Sends testnet ETH from the wallet to the steward key, which forwards a share to the other demo keys.
  async function fundKeys(k: Record<DemoRole, Sender>) {
    const price = await client.getGasPrice();
    const budget = gasBudgets(price, GAS_KEYS.length);
    const balances = await Promise.all([k.steward, ...GAS_KEYS.map((role) => k[role])].map((s) => client.getBalance({ address: s.address })));
    const short = GAS_KEYS.filter((_, i) => balances[i + 1] < budget.perKey / 2n);
    const needed = budget.steward + budget.perKey * BigInt(short.length);
    if (balances[0] < needed) {
      const hash = await me().send({ to: k.steward.address, value: budget.total });
      await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
      emit(YOU, `Sent ${formatEth(budget.total)} to the steward demo key to pay gas for the demo keys.`, null, hash);
    }
    if (short.length === 0) return;
    const hashes = await Promise.all(short.map((role) => k.steward.send({ to: k[role].address, value: budget.perKey })));
    await Promise.all(hashes.map((hash) => client.waitForTransactionReceipt({ hash, timeout: 90_000 })));
    emit(ROLE_LABEL.steward, `Forwarded ${formatEth(budget.perKey)} for gas to ${short.map((role) => ROLE_LABEL[role]).join(", ")}.`, null, hashes[hashes.length - 1]);
  }

  const setup = () =>
    perform("Set up the sandbox", YOU, async () => {
      if (!visitor || !keys || !demo) return;
      await fundKeys(keys);
      let id = demo.spaceId;
      if (id === null) {
        const created = await send(keys.steward, createSpaceTx(VOTING_SECONDS, keys.fees.address));
        if (!record(created, ROLE_LABEL.steward, `Created a sandbox space: votes last ${VOTING_SECONDS} s and the steward demo key writes Points.`, "Create a sandbox space") || !created.receipt) return;
        id = spaceIdFrom(created.receipt);
        const next = { ...demo, spaceId: id };
        saveDemo(next);
        setDemo(next);
      }
      const space = id;
      const results = await Promise.all([
        ...VOTERS.map((role) => send(keys.steward, setPointsTx(space, keys[role].address, DEMO_POINTS[role]))),
        ...[visitor, ...COMPANIES.map((role) => keys[role].address)].map((to) => send(keys.steward, mintTx(to, MINT))),
      ]);
      const failed = results.find((r) => r.error);
      if (failed) {
        record(failed, ROLE_LABEL.steward, "", "Record Points and mint demo USDC");
        return;
      }
      emit(ROLE_LABEL.steward, "Recorded sample Points for contributors A, B and C. They are soulbound: no function moves them.", null, results[VOTERS.length - 1].hash);
      const last = results[results.length - 1];
      record(last, ROLE_LABEL.steward, `Minted ${formatUsdc(MINT)} demo USDC to you, Company B and Company C from the open faucet.`, "Mint demo USDC");
    });

  const topUp = () =>
    perform("Top up the demo keys", YOU, async () => {
      if (keys) await fundKeys(keys);
    });

  const proposeRequest = () =>
    perform("Open a request", YOU, async () => {
      if (spaceId === null) return;
      if (!record(await send(me(), approveTx(OPENING)), YOU, `Approved the pool contract to take ${formatUsdc(OPENING)} demo USDC, the exact first pledge.`, "Approve the first pledge")) return;
      const tx = proposeTx({ spaceId, kind: "request", domain: 0, target: TARGET, fundingSeconds: FUNDING_SECONDS, title: "Open-source e-invoicing engine", openingPledge: OPENING });
      const made = await send(me(), tx);
      if (record(made, YOU, `Opened a request for ${formatUsdc(TARGET)} demo USDC with a first pledge of ${formatUsdc(OPENING)}. Contributors vote on listing it.`, "Open a request")) {
        setAnother(false);
        setPayout(null);
      }
    });

  const proposeBuild = () =>
    perform("Propose a build", ROLE_LABEL.contributorA, async () => {
      if (spaceId === null || !keys) return;
      const tx = proposeTx({ spaceId, kind: "proposal", domain: 0, target: TARGET, fundingSeconds: FUNDING_SECONDS, title: "Open-source feature-flag service", openingPledge: 0n });
      const made = await send(keys.contributorA, tx);
      if (record(made, ROLE_LABEL.contributorA, `Proposed a build for ${formatUsdc(TARGET)} demo USDC, with no money down. Contributors vote on listing it.`, "Propose a build")) {
        setAnother(false);
        setPayout(null);
      }
    });

  const castVote = (role: (typeof VOTERS)[number], choice: Choice) =>
    perform(`Vote ${choice}`, ROLE_LABEL[role], async () => {
      if (!pool || !keys) return;
      const power = snapshot?.power[keys[role].address] ?? 0n;
      const result = await send(keys[role], voteTx(pool.id, choice));
      record(result, ROLE_LABEL[role], `Voted ${choice} on pool #${pool.id} with power ${formatPower(power)}, computed by the contract from their Points.`, `Vote ${choice} on pool #${pool.id}`);
    });

  const closeVote = () =>
    perform("Close the vote", ANYONE, async () => {
      if (!pool || !keys) return;
      const result = await send(keys.steward, finalizeTx(pool.id), true);
      record(result, ANYONE, `Closed the vote on pool #${pool.id}. The contract counted the ballots and applied the result.`, `Close the vote on pool #${pool.id}`, (e) =>
        e.name === "VoteStillOpen" ? "The voting period is not over and the result can still change, so the contract refuses to close the vote." : e.message,
      );
    });

  const pledgeAs = (role: "you" | (typeof COMPANIES)[number]) =>
    perform("Pledge", role === "you" ? YOU : ROLE_LABEL[role], async () => {
      if (!pool || !keys) return;
      const actor = role === "you" ? YOU : ROLE_LABEL[role];
      const sender = role === "you" ? me() : keys[role];
      const current = await readPool(client, pool.id);
      const room = current.target - current.pledged;
      const amount = room > 0n && room < PLEDGE ? room : PLEDGE;
      if (!record(await send(sender, approveTx(amount)), actor, `Approved the pool contract to take ${formatUsdc(amount)} demo USDC, the exact pledge.`, "Approve the pledge")) return;
      const result = await send(sender, pledgeTx(pool.id, amount));
      const taken = result.receipt && !result.error ? pledgedFrom(result.receipt) : amount;
      record(result, actor, `Pledged ${formatUsdc(taken)} demo USDC to pool #${pool.id}. The money sits in the contract until the pool launches or refunds.`, `Pledge to pool #${pool.id}`);
    });

  const launch = () =>
    perform("Launch", ANYONE, async () => {
      if (!pool || !keys) return;
      const result = await send(keys.steward, launchTx(pool.id), true);
      record(result, ANYONE, `Launched pool #${pool.id}: it held its full ${formatUsdc(pool.target)} demo USDC.`, `Launch pool #${pool.id}`, (e) =>
        e.name === "TargetNotReached" ? `${e.message} The contract will not start a build on a partial pool.` : e.message,
      );
    });

  const tryRefund = () =>
    perform("Refund early", ANYONE, async () => {
      if (!pool || !keys || !visitor) return;
      const funder = (snapshot?.pledges[visitor] ?? 0n) > 0n ? visitor : keys.companyB.address;
      const result = await send(keys.steward, refundTx(pool.id, funder), true);
      record(result, ANYONE, `Refunded a pledge from pool #${pool.id}.`, `Refund a pledge from pool #${pool.id} while it is open`, (e) => e.message);
    });

  const refundAll = () =>
    perform("Refund everyone", ANYONE, async () => {
      if (!pool || !keys || !visitor || !snapshot) return;
      const funders: [string, EvmAddress][] = [
        [YOU, visitor],
        [ROLE_LABEL.companyB, keys.companyB.address],
        [ROLE_LABEL.companyC, keys.companyC.address],
      ];
      for (const [label, address] of funders) {
        const amount = snapshot.pledges[address] ?? 0n;
        if (amount === 0n) continue;
        const result = await send(keys.steward, refundTx(pool.id, address));
        if (!record(result, ANYONE, `Refunded ${formatUsdc(amount)} demo USDC to ${label} from pool #${pool.id}, in full.`, `Refund ${label}`)) return;
      }
    });

  const payOut = () =>
    perform("Pay out", ROLE_LABEL.steward, async () => {
      if (!pool || !keys) return;
      const work = VOTERS.map((role) => [keys[role].address, DEMO_WORK[role]] as const);
      const result = await send(keys.steward, payOutTx(pool.id, work), true);
      const ok = record(result, ROLE_LABEL.steward, `Paid pool #${pool.id} to three contributors by share of project Points, less the 2% fee. The contract computed the split.`, `Pay out pool #${pool.id}`);
      if (ok && result.receipt) setPayout({ poolId: pool.id, ...payoutsFrom(result.receipt) });
    });

  const askClosure = () =>
    perform("Ask for a closure vote", ROLE_LABEL.companyB, async () => {
      if (!pool || !keys) return;
      const result = await send(keys.companyB, openClosureTx(pool.id), true);
      record(result, ROLE_LABEL.companyB, `Asked to close pool #${pool.id} before payout. Contributors vote; if it passes, every pledge is refunded.`, `Ask for a closure vote on pool #${pool.id}`);
    });

  const blocked = busy ? "Wait for the current transaction to finish." : null;
  const guard = (fn: () => void) => () => {
    if (!blocked) fn();
  };

  if (wallets === null) return <p className="text-sm text-muted">Looking for a wallet…</p>;
  if (wallets.length === 0 && !wallet) {
    return (
      <Callout tone="neutral" title="No wallet detected">
        <p>
          The live mode needs a browser wallet that supports {CHAIN_NAME}, such as <External href={PHANTOM_URL}>Phantom</External>. Install
          one, then reload this page.
        </p>
        <p className="mt-2">
          It also needs a little {CHAIN_NAME} ETH, which has no value: see the <External href={FAUCET_URL}>list of faucets</External>.
        </p>
      </Callout>
    );
  }

  const deployed = deployment !== null && deployment.usdc && deployment.pools;
  const ready = spaceId !== null && snapshot?.space !== null && snapshot !== null;
  const budget = gasPrice === null ? null : gasBudgets(gasPrice, GAS_KEYS.length);
  const myEth = visitor && snapshot ? (snapshot.eth[visitor] ?? 0n) : null;
  const myUsdc = visitor && snapshot ? (snapshot.usdc[visitor] ?? 0n) : null;
  const proposing = ready && (pool === null || (another && isOver(pool.status)));
  const owed = pool && snapshot ? Object.values(snapshot.pledges).reduce((sum, x) => sum + x, 0n) : 0n;
  const refundable = pool !== null && (pool.status === "expired" || pool.status === "not-listed" || pool.status === "closed");
  const lowKeys = keys && snapshot && budget ? [...GAS_KEYS, "steward" as const].filter((role) => (snapshot.eth[keys[role].address] ?? 0n) < budget.perKey / 4n) : [];

  return (
    <div className="space-y-5">
      <Callout tone="neutral" title={`Put your wallet on ${CHAIN_NAME} first`}>
        In Phantom, open Settings → Developer Settings → Testnet Mode and turn it on (<External href={WALLET_HELP_URL}>how</External>). You
        also need a little {CHAIN_NAME} ETH for gas, free from a <External href={FAUCET_URL}>faucet</External>. This page checks the network
        before every request and only sends transactions to its own two demo contracts.
      </Callout>

      <Step n={1} title="Connect your wallet" state={wallet ? "done" : "active"}>
        {wallet && visitor ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm text-muted">{wallet.option.name}</span>
            <Address address={visitor} />
            <span className="text-sm text-muted">
              <span className="font-mono text-ink">{myEth === null ? "…" : formatEth(myEth)}</span>
            </span>
            <span className="text-sm text-muted">
              <span className="font-mono text-ink">{myUsdc === null ? "…" : formatUsdc(myUsdc)}</span> demo USDC
            </span>
            <ActionButton why={blocked} onClick={guard(() => void refresh())}>
              Refresh
            </ActionButton>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">The wallet shares your public address only. The page keeps it in memory and never asks you to sign a message.</p>
            <div className="flex flex-wrap items-start gap-2">
              {wallets.map((option, i) => (
                <ActionButton key={option.id} variant={i === 0 ? "primary" : "secondary"} why={connecting ? "Waiting for the wallet…" : null} onClick={() => void connect(option)}>
                  Connect {option.name}
                </ActionButton>
              ))}
            </div>
          </div>
        )}
      </Step>

      {busy && (
        <p role="status" className="rounded-lg bg-accent/12 px-4 py-3 text-[15px] font-bold text-accent">
          {busy.stage === "wallet"
            ? `${busy.label}: waiting for your wallet. Check its popup against the "What your wallet will ask" box below.`
            : `${busy.label}: sending to ${CHAIN_NAME} and waiting for confirmation…`}
        </p>
      )}
      {notice && (
        <Callout tone={notice.tone} title={notice.title}>
          <p>{notice.text}</p>
          {notice.hash && (
            <p className="mt-1">
              <TxLink hash={notice.hash} />
            </p>
          )}
        </Callout>
      )}
      {rpcIssue && (
        <Callout tone="warning" title={`${CHAIN_NAME} RPC problem`}>
          {rpcIssue.message} The page retries every {REFRESH_MS / 1000} s.
        </Callout>
      )}

      {wallet && deployment && (
        <Step n={2} title="The two contracts" state={deployed ? "done" : "active"}>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">PooledFunding (pools, votes, refunds)</dt>
              <dd className="flex items-center gap-2">
                <Address address={POOLS_ADDRESS} />
                {deployment.pools ? <Badge tone="success">Deployed</Badge> : <Badge tone="warning">Not deployed</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Demo USDC (open faucet, no value)</dt>
              <dd className="flex items-center gap-2">
                <Address address={USDC_ADDRESS} />
                {deployment.usdc ? <Badge tone="success">Deployed</Badge> : <Badge tone="warning">Not deployed</Badge>}
              </dd>
            </div>
          </dl>
          <p className="text-sm leading-relaxed text-muted">
            Both addresses are derived from the bytecode in the repository (CREATE2), so a contract found there can only be that code.
            Neither has an owner or an upgrade path.
          </p>
          {!deployed && (
            <>
              <TxPreview
                heading="What your wallet will ask"
                signer={`${YOU}, ${deployment.usdc ? "one prompt" : "two prompts"}`}
                lines={[
                  ...(deployment.usdc ? [] : [{ program: "Deployment proxy", action: "Create", detail: <>Demo USDC at <Address address={USDC_ADDRESS} /></> }]),
                  { program: "Deployment proxy", action: "Create", detail: <>PooledFunding at <Address address={POOLS_ADDRESS} /></> },
                ]}
                note="This happens once for everyone: after it, any visitor finds the contracts already there. It costs a little testnet gas."
              />
              <ActionButton variant="primary" why={blocked} onClick={guard(() => void deploy())}>
                Deploy the contracts
              </ActionButton>
            </>
          )}
        </Step>
      )}

      {wallet && keys && deployed && (
        <Step n={3} title="Set up your sandbox" state={ready ? "done" : "active"}>
          {resumed && ready && <p className="text-sm text-muted">Resumed the sandbox saved in this browser tab.</p>}
          <p className="text-sm leading-relaxed text-muted">
            Six throwaway keys generated by this page play the steward, three contributors and two other companies. They live only in this
            tab (sessionStorage, so a reload does not strand the demo) and only ever hold testnet gas and demo USDC.
          </p>
          {!ready && budget && (
            <>
              <TxPreview
                heading="What your wallet will ask"
                signer={`${YOU}, one prompt`}
                lines={[{ program: "ETH transfer", action: "Send", detail: <>{formatEth(budget.total)} of testnet gas to the steward demo key <Address address={keys.steward.address} /></> }]}
                note={
                  <>
                    Then, with no further prompt, the steward key forwards gas to the five other keys, creates a sandbox space on {POOLS}{" "}
                    (votes last {VOTING_SECONDS} s), records sample Points for contributors A, B and C, and mints {formatUsdc(MINT)} demo USDC
                    to you and to companies B and C.
                  </>
                }
              />
              <ActionButton
                variant="primary"
                why={blocked ?? (myEth !== null && myEth < budget.total ? `Needs about ${formatEth(budget.total)} on ${CHAIN_NAME}; your wallet holds ${formatEth(myEth)}.` : null)}
                onClick={guard(() => void setup())}
              >
                Set up the sandbox
              </ActionButton>
            </>
          )}
          {ready && snapshot.space && (
            <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {VOTERS.map((role) => (
                <li key={role} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold">{ROLE_LABEL[role]}</span>
                  <Address address={keys[role].address} />
                  <span className="font-mono text-[13px] text-muted">{DEMO_POINTS[role].join(" / ")} Points</span>
                </li>
              ))}
              {COMPANIES.map((role) => (
                <li key={role} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold">{ROLE_LABEL[role]}</span>
                  <Address address={keys[role].address} />
                  <span className="font-mono text-[13px] text-muted">{formatUsdc(snapshot.usdc[keys[role].address] ?? 0n)} demo USDC</span>
                </li>
              ))}
            </ul>
          )}
          {ready && lowKeys.length > 0 && (
            <Callout tone="warning" title="Some demo keys are low on gas">
              <p>{lowKeys.map((role) => ROLE_LABEL[role]).join(", ")}. One prompt from your wallet refills them.</p>
              <div className="mt-3">
                <ActionButton why={blocked} onClick={guard(() => void topUp())}>
                  Top up the demo keys
                </ActionButton>
              </div>
            </Callout>
          )}
          <ActionButton variant="danger" why={blocked} onClick={startOver}>
            Start over with new keys
          </ActionButton>
        </Step>
      )}

      {ready && keys && visitor && (
        <>
          <Step n={4} title="Open a pool, from either side" state={proposing ? "active" : "done"}>
            {proposing ? (
              <>
                <div className="grid gap-4 @3xl:grid-cols-2">
                  <div className="space-y-3">
                    <p className="font-bold">As a company with a need</p>
                    <TxPreview
                      heading="What your wallet will ask"
                      signer={`${YOU}, two prompts`}
                      lines={[
                        { program: USDC, action: "approve", detail: <>lets the pool contract take exactly {formatUsdc(OPENING)} demo USDC</> },
                        { program: POOLS, action: "propose", detail: <>a request for {formatUsdc(TARGET)} with a first pledge of {formatUsdc(OPENING)}, open {FUNDING_SECONDS} s once listed</> },
                      ]}
                    />
                    <ActionButton
                      variant="primary"
                      why={blocked ?? ((myUsdc ?? 0n) < OPENING ? `Your wallet holds ${formatUsdc(myUsdc ?? 0n)} demo USDC.` : null)}
                      onClick={guard(() => void proposeRequest())}
                    >
                      Open a request with a first pledge
                    </ActionButton>
                  </div>
                  <div className="space-y-3">
                    <p className="font-bold">As a contributor with an idea</p>
                    <TxPreview
                      heading="What contributor A will sign, in the page"
                      signer="Contributor A (no wallet prompt)"
                      lines={[{ program: POOLS, action: "propose", detail: <>a community proposal for {formatUsdc(TARGET)} demo USDC, with no money down</> }]}
                    />
                    <ActionButton why={blocked} onClick={guard(() => void proposeBuild())}>
                      Propose a build as contributor A
                    </ActionButton>
                  </div>
                </div>
              </>
            ) : (
              pool && (
                <p className="text-sm">
                  Pool <span className="font-mono font-bold">#{pool.id.toString()}</span> &quot;{pool.title}&quot;, a{" "}
                  {pool.kind === "request" ? "request opened by you" : "community proposal by contributor A"} for {formatUsdc(pool.target)} demo USDC.
                </p>
              )
            )}
          </Step>

          {pool && !proposing && (
            <>
              <Step n={5} title="Contributors vote (Proof of Love)" state={vote ? "active" : pool.status === "voting" ? "active" : "done"}>
                {vote ? (
                  <>
                    <p className="text-sm leading-relaxed text-muted">
                      {pool.status === "voting" ? "Listing vote." : "Closure vote."} The contract computes each power from Points it stores.
                      Any two of the three contributors are more than half of all power, which closes the vote early.
                    </p>
                    <ul className="divide-y divide-line border-y border-line">
                      {VOTERS.map((role) => {
                        const address = keys[role].address;
                        const ballot = snapshot.ballots[address];
                        return (
                          <li key={role} className="flex flex-col gap-3 px-1 py-3.5 @2xl:flex-row @2xl:items-center @2xl:justify-between">
                            <div>
                              <p className="font-bold">
                                {ROLE_LABEL[role]} <span className="ml-1 text-sm font-normal text-muted">{PROFILE[role]}</span>
                              </p>
                              <p className="font-mono text-xs text-muted">
                                power {formatPower(snapshot.power[address] ?? 0n)}
                                {ballot?.choice ? ` · voted ${ballot.choice}` : " · not voted"}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-start gap-2">
                              <ActionButton why={blocked} onClick={guard(() => void castVote(role, "for"))}>
                                For
                              </ActionButton>
                              <ActionButton variant="danger" why={blocked} onClick={guard(() => void castVote(role, "against"))}>
                                Against
                              </ActionButton>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <TallyBar tally={vote} />
                    <div className="flex flex-wrap items-start gap-3">
                      <ActionButton variant={earlyVerdict(vote) !== "undecided" || voteLeft === 0 ? "primary" : "secondary"} why={blocked} onClick={guard(() => void closeVote())}>
                        {earlyVerdict(vote) !== "undecided" || voteLeft === 0 ? "Close the vote" : "Try to close the vote now"}
                      </ActionButton>
                      <p className="py-2.5 text-sm text-muted">
                        {voteLeft !== null && voteLeft > 0 ? (
                          <>
                            Voting ends in <span className="font-mono font-bold text-warning">{formatCountdown(voteLeft)}</span>, on block time.
                          </>
                        ) : (
                          "The voting period is over. Anyone can close the vote."
                        )}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm">
                    {pool.status === "not-listed"
                      ? "The listing vote did not pass. The pool never opened for pledges."
                      : pool.status === "closed"
                        ? "The closure vote passed. The pool is closed and refundable."
                        : "The listing vote passed. The pool was listed."}
                  </p>
                )}
              </Step>

              <Step n={6} title="Fill the pool, or let it miss" state={pool.status === "funding" ? "active" : pool.status === "voting" ? "todo" : "done"}>
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-3xl font-bold tabular-nums tracking-tight">{formatUsdc(pool.pledged - pool.refunded)}</span>
                    <span className="text-sm text-muted">of {formatUsdc(pool.target)} demo USDC held by the contract</span>
                  </p>
                  <div className="mt-2">
                    <PoolProgress pledged={pool.pledged} target={pool.target} refunded={pool.refunded} tone={refundable ? "danger" : "accent"} />
                  </div>
                </div>
                {pool.status !== "voting" && (
                  <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    {(
                      [
                        [YOU, visitor],
                        [ROLE_LABEL.companyB, keys.companyB.address],
                        [ROLE_LABEL.companyC, keys.companyC.address],
                      ] as const
                    ).map(([label, address]) => (
                      <li key={address}>
                        <span className={LABEL}>{label}</span>
                        <span className="block font-mono tabular-nums">
                          {formatUsdc(snapshot.pledges[address] ?? 0n)} <span className="text-muted">in the pool</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {pool.status === "funding" && pool.pledged < pool.target && (
                  <>
                    <p className="text-sm text-muted">
                      {fundingLeft !== null && fundingLeft > 0 ? (
                        <>
                          The pool closes in <span className="font-mono font-bold text-warning">{formatCountdown(fundingLeft)}</span>, on block time. Fill
                          it, or wait to see every pledge refunded.
                        </>
                      ) : (
                        "The deadline has passed."
                      )}
                    </p>
                    <TxPreview
                      heading="What your wallet will ask when you pledge"
                      signer={`${YOU}, two prompts`}
                      lines={pledgeLines(pool.target - pool.pledged < PLEDGE ? pool.target - pool.pledged : PLEDGE, pool.id)}
                      note="Companies B and C pledge the same way, signed in the page by their demo keys."
                    />
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionButton variant="primary" why={blocked ?? ((myUsdc ?? 0n) === 0n ? "Your wallet holds no demo USDC." : null)} onClick={guard(() => void pledgeAs("you"))}>
                        Pledge as you
                      </ActionButton>
                      {COMPANIES.map((role) => (
                        <ActionButton key={role} why={blocked} onClick={guard(() => void pledgeAs(role))}>
                          {ROLE_LABEL[role]} pledges
                        </ActionButton>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-start gap-2 border-t border-line pt-4">
                      <ActionButton variant="danger" why={blocked} onClick={guard(() => void launch())}>
                        Try to launch now
                      </ActionButton>
                      <ActionButton variant="danger" why={blocked ?? (owed === 0n ? "Nobody has pledged yet." : null)} onClick={guard(() => owed > 0n && void tryRefund())}>
                        Try to refund now
                      </ActionButton>
                    </div>
                  </>
                )}
                {pool.status === "funding" && pool.pledged >= pool.target && (
                  <>
                    <Callout tone="success" title="The pool is full">
                      It holds its whole target, so the contract will now accept a launch from any account.
                    </Callout>
                    <ActionButton variant="primary" why={blocked} onClick={guard(() => void launch())}>
                      Launch the build
                    </ActionButton>
                  </>
                )}
                {refundable && (
                  <Callout
                    tone="danger"
                    title={pool.status === "expired" ? "Missed its target: every pledge is refundable" : pool.status === "closed" ? "Closed by vote: every pledge is refundable" : "Not listed: the first pledge is refundable"}
                  >
                    <p>Anyone can trigger each refund, and the contract only ever sends the money back to the funder.</p>
                    {owed > 0n ? (
                      <div className="mt-3">
                        <ActionButton variant="primary" why={blocked} onClick={guard(() => void refundAll())}>
                          Refund everyone
                        </ActionButton>
                      </div>
                    ) : (
                      pool.pledged > 0n && <p className="mt-2 font-bold">Everyone has been refunded in full.</p>
                    )}
                  </Callout>
                )}
              </Step>

              <Step n={7} title="Build, then pay by Points" state={pool.status === "building" ? "active" : pool.status === "paid" ? "done" : "todo"}>
                {pool.status === "building" && !pool.closure.open && (
                  <>
                    <p className="text-sm leading-relaxed text-muted">
                      The steward posts a sample record of accepted work: {VOTERS.map((role) => `${ROLE_LABEL[role]} ${DEMO_WORK[role]}`).join(", ")}{" "}
                      project Points. The contract splits the pool by those shares and takes the 2% fee.
                    </p>
                    <div className="flex flex-wrap items-start gap-2">
                      <ActionButton variant="primary" why={blocked} onClick={guard(() => void payOut())}>
                        Pay contributors by Points
                      </ActionButton>
                      <ActionButton variant="danger" why={blocked} onClick={guard(() => void askClosure())}>
                        Company B asks for a closure vote
                      </ActionButton>
                    </div>
                  </>
                )}
                {pool.status === "building" && pool.closure.open && (
                  <p className="text-sm">A closure vote is open in step 5. The contract refuses any payout until it is closed.</p>
                )}
                {(pool.status === "expired" || pool.status === "not-listed") && <p className="text-sm text-muted">Never started: the pool did not launch.</p>}
                {pool.status === "closed" && <p className="text-sm text-muted">Closed by vote before any payout.</p>}
                {pool.status === "paid" && (
                  <Callout tone="success" title="Paid out by share of project Points">
                    {payout && payout.poolId === pool.id ? (
                      <ul className="mt-1 space-y-1 font-mono text-[13px]">
                        {payout.lines.map((line, i) => (
                          <li key={line.contributor}>
                            {ROLE_LABEL[VOTERS[i]] ?? shortenAddress(line.contributor)}: {line.workPoints.toString()} Points ({percentText(line.workPoints, workTotal)}%) → {formatUsdcRounded(line.amount)} demo USDC
                          </li>
                        ))}
                        <li className="text-muted">Fee wallet: {formatUsdc(payout.fee)} demo USDC (2%)</li>
                      </ul>
                    ) : (
                      "The pool was paid to its contributors."
                    )}
                  </Callout>
                )}
              </Step>

              {isOver(pool.status) && (
                <div className="flex flex-wrap items-start gap-3">
                  <ActionButton variant="primary" why={blocked} onClick={guard(() => setAnother(true))}>
                    Open another pool
                  </ActionButton>
                  <p className="max-w-md py-2.5 text-sm text-muted">Same sandbox, same keys. Try the other direction, or the outcome you have not seen yet.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function pledgeLines(amount: bigint, poolId: bigint): PreviewLine[] {
  return [
    { program: USDC, action: "approve", detail: <>lets the pool contract take exactly {formatUsdc(amount)} demo USDC</> },
    { program: POOLS, action: `pledge to #${poolId}`, detail: <>moves {formatUsdc(amount)} demo USDC into the pool, locked until it launches or refunds</> },
  ];
}
