"use client";

// The contract on Base Sepolia as an engine. The visitor's wallet is one company and one contributor;
// throwaway keys generated in the tab play the steward, three contributors and two other companies.
// Everything the visitor signs goes through the wallet guard; the demo keys only hold testnet gas.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Address, getAddress, isAddressEqual } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  type Deployment,
  type PayoutLine,
  type PoolView,
  type SpaceSnapshot,
  type TallyView,
  approveTx,
  createSpaceTx,
  deployPoolsTx,
  deployUsdcTx,
  finalizeTx,
  launchTx,
  mintTx,
  openClosureTx,
  openVoteOf,
  payOutTx,
  payoutsFrom,
  pledgeTx,
  pledgedFrom,
  poolIdFrom,
  proposeTx,
  readDeployment,
  readPool,
  readSpaceSnapshot,
  refundTx,
  setPointsTx,
  spaceIdFrom,
  voteTx,
} from "@/lib/pools/chain/actions";
import { POOLS_ADDRESS, USDC_ADDRESS } from "@/lib/pools/chain/addresses";
import { gasBudgets } from "@/lib/pools/chain/budget";
import { CHAIN_NAME, DEFAULT_FUNDING_WINDOW, DEMO_MINT_USDC, DEMO_PLEDGE_USDC, FUNDING_WINDOWS, SAMPLE_WINDOW_SECONDS, SESSION_STORAGE_KEY, VOTING_SECONDS } from "@/lib/pools/chain/constants";
import { type Sender, type SendResult, type TxRequest, createChainClient, ensureWalletChain, keySender, run, walletSender } from "@/lib/pools/chain/core";
import { type DecodedError, GuardError, decodeError } from "@/lib/pools/chain/errors";
import { explorerTxUrl, formatEth, shortenAddress } from "@/lib/pools/chain/format";
import { type DemoRole, type StoredDemo, DEMO_ROLES, parseDemo, serializeDemo } from "@/lib/pools/chain/session";
import { type WalletOption, discoverWallets } from "@/lib/pools/chain/wallet";
import { pooledFundingAbi } from "@/lib/pools/generated/contracts";
import { type Choice, type Points, type Tally, MAX_TITLE_BYTES, earlyVerdict, feeOf, formatPower, formatUsdc, powerOf, splitByPoints, titleBytes, usdc } from "@/lib/pools/math";
import { DOMAINS } from "@/lib/pools/sim";
import type { LogItem } from "../../event-log";
import { type CastGroup, type Cmd, type Engine, type Hints, type Person, type PoolCmds, type PoolVM, type ProposeInput, type Toast, refundable } from "./engine";

const YOU = "You";
const ANYONE = "Anyone (demo key)";
// Every action re-reads the chain itself and countdowns tick locally, so the background re-read can be
// slow. The public endpoint limits how often it is asked.
const REFRESH_MS = 15_000;

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
type Voter = (typeof VOTERS)[number];

// Sample Points: an apps specialist, a generalist and an infrastructure specialist. The visitor gets
// Points too, so the connected wallet can propose a build and vote as a contributor.
const DEMO_POINTS: Record<Voter, Points> = {
  contributorA: [380, 40, 20, 120],
  contributorB: [60, 240, 200, 240],
  contributorC: [10, 20, 380, 30],
};
const VISITOR_POINTS: Points = [120, 60, 60, 60];
const PROFILE: Record<Voter, string> = { contributorA: "Apps specialist", contributorB: "Generalist", contributorC: "Infrastructure specialist" };
// Sample record of accepted work posted at payout.
const DEMO_WORK: Record<Voter, bigint> = { contributorA: 160n, contributorB: 60n, contributorC: 120n };
const VISITOR_WORK = 100n;

const PLEDGE = usdc(DEMO_PLEDGE_USDC);
const MINT = usdc(DEMO_MINT_USDC);
const SAMPLE_REQUEST = { title: "Open-source e-invoicing engine for the EU formats", domain: 0, target: usdc(50_000), opening: usdc(10_000) };
const SAMPLE_PROPOSAL = { title: "Open-source rebuild of a hosted feature-flag service", domain: 2, target: usdc(30_000) };

// Pools that wait for someone come first, finished ones last; newest first within a group.
const ORDER: Record<PoolView["status"], number> = { funding: 0, voting: 1, building: 2, paid: 3, expired: 4, closed: 4, "not-listed": 4 };

const HINTS: Hints = {
  vote: "One prompt in your wallet.",
  pledge: "Two prompts in your wallet: an approval for the exact amount, then the pledge.",
  request: "Two prompts in your wallet: an approval for the exact first pledge, then the request.",
  proposal: "One prompt in your wallet. No money moves.",
  anyone: "Sent by a demo key with no prompt: anyone may do this.",
  steward: "Signed by the sandbox's steward key, which stands in for Slop's scoring.",
  closure: "One prompt in your wallet.",
};

export type LivePhase = "disconnected" | "loading" | "contracts" | "sandbox" | "ready";

export interface LiveWallet {
  name: string;
  icon: string | null;
  address: Address;
}

interface Connected {
  option: WalletOption;
  address: Address;
}

interface StoredPayout {
  lines: PayoutLine[];
  net: bigint;
  fee: bigint;
}

const PAYOUTS_KEY = `${SESSION_STORAGE_KEY}:payouts`;

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
    else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.sessionStorage.removeItem(PAYOUTS_KEY);
    }
  } catch {
    // Storage blocked: the demo still runs, it just cannot be resumed after a reload.
  }
}

function loadPayouts(): Record<string, StoredPayout> {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(PAYOUTS_KEY) ?? "{}") as Record<string, { lines: [string, string, string][]; net: string; fee: string }>;
    return Object.fromEntries(
      Object.entries(raw).map(([id, p]) => [
        id,
        { lines: p.lines.map(([contributor, workPoints, amount]) => ({ contributor: getAddress(contributor), workPoints: BigInt(workPoints), amount: BigInt(amount) })), net: BigInt(p.net), fee: BigInt(p.fee) },
      ]),
    );
  } catch {
    return {};
  }
}

function savePayouts(payouts: Record<string, StoredPayout>) {
  try {
    const raw = Object.fromEntries(
      Object.entries(payouts).map(([id, p]) => [id, { lines: p.lines.map((l) => [l.contributor, l.workPoints.toString(), l.amount.toString()]), net: p.net.toString(), fee: p.fee.toString() }]),
    );
    window.sessionStorage.setItem(PAYOUTS_KEY, JSON.stringify(raw));
  } catch {
    // Not resumable, nothing else lost.
  }
}

const freshDemo = (): StoredDemo => ({
  keys: Object.fromEntries(DEMO_ROLES.map((role) => [role, generatePrivateKey()])) as StoredDemo["keys"],
  spaceId: null,
  ready: false,
});

const stamp = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

function left(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 172_800) return `${Math.floor(s / 86_400)} days`;
  if (s >= 7_200) return `${Math.floor(s / 3_600)} h`;
  if (s >= 3_600) return `${Math.floor(s / 3_600)} h ${String(Math.floor((s % 3_600) / 60)).padStart(2, "0")} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const toTally = (t: TallyView): Tally => ({ end: t.end, open: t.open, for: t.for, against: t.against, abstain: t.abstain, total: t.total });
const sum = (points: Points | undefined) => (points ? points[0] + points[1] + points[2] + points[3] : 0);

function toastFor(error: DecodedError, id: number): Toast {
  switch (error.kind) {
    case "declined":
      return { id, tone: "neutral", title: "You declined", text: "Nothing was signed or sent." };
    case "insufficient-funds":
      return { id, tone: "warning", title: "Not enough testnet ETH", text: `${error.message}. Get free ${CHAIN_NAME} ETH from a faucet, or top up the demo keys from the wallet menu.` };
    case "rate-limited":
      return { id, tone: "warning", title: "The network is busy", text: error.message };
    case "guard":
      return { id, tone: "danger", title: "Stopped by a safety check", text: error.message };
    default:
      return { id, tone: "danger", title: `Failed: ${error.name}`, text: error.message };
  }
}

export function useLive() {
  const client = useMemo(() => createChainClient(), []);
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [wallet, setWallet] = useState<Connected | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [demo, setDemo] = useState<StoredDemo | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [snapshot, setSnapshot] = useState<SpaceSnapshot | null>(null);
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [payouts, setPayouts] = useState<Record<string, StoredPayout>>({});
  const [rpcIssue, setRpcIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ label: string; stage: "wallet" | "network" } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);
  const deployedOnce = useRef<Deployment | null>(null);

  useEffect(() => {
    let alive = true;
    void discoverWallets(window).then((found) => alive && setWallets(found));
    setDemo(loadDemo());
    setPayouts(loadPayouts());
    return () => {
      alive = false;
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

  const keys = useMemo(
    () => (demo ? (Object.fromEntries(DEMO_ROLES.map((role) => [role, keySender(client, demo.keys[role])])) as Record<DemoRole, Sender>) : null),
    [client, demo],
  );
  const visitor = wallet?.address ?? null;
  const spaceId = demo?.spaceId ?? null;

  const refresh = useCallback(async () => {
    if (!visitor || !keys) return;
    try {
      // Once both contracts are there they stay: their code is not read again.
      const known = deployedOnce.current;
      const [deployed, price] = await Promise.all([known ?? readDeployment(client), client.getGasPrice()]);
      if (deployed.usdc && deployed.pools) deployedOnce.current = deployed;
      setDeployment(deployed);
      setGasPrice(price);
      if (deployed.usdc && deployed.pools) {
        const people = [visitor, ...VOTERS.map((role) => keys[role].address)];
        setSnapshot(
          await readSpaceSnapshot(client, {
            spaceId,
            accounts: [visitor, keys.steward.address, ...GAS_KEYS.map((role) => keys[role].address)],
            holders: [visitor, ...COMPANIES.map((role) => keys[role].address)],
            funders: [visitor, ...COMPANIES.map((role) => keys[role].address)],
            voters: people,
          }),
        );
      }
      setRpcIssue(null);
    } catch (err) {
      setRpcIssue(decodeError(err).message);
    }
  }, [client, visitor, keys, spaceId]);

  useEffect(() => {
    if (!visitor) return;
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, visitor]);

  // An action that started before the sandbox existed must still re-read the chain for the sandbox it
  // created, so the re-read after an action always goes through the latest reader.
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!visitor) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visitor]);

  const chainNow = now / 1000 + (snapshot?.chainSkew ?? 0);

  // A deadline passes without any transaction, so the page re-reads the chain when a countdown ends.
  const nextEnd = useMemo(() => {
    const ends = (snapshot?.pools ?? []).flatMap((p) => {
      const vote = openVoteOf(p);
      return [vote ? vote.end : 0, p.status === "funding" && p.pledged < p.target ? p.deadline : 0];
    });
    return ends.filter((end) => end > 0).sort((a, b) => a - b)[0] ?? null;
  }, [snapshot]);
  const endHit = nextEnd !== null && chainNow >= nextEnd + 1;
  useEffect(() => {
    if (endHit) void refresh();
  }, [endHit, refresh]);

  function emit(actor: string, text: string, refusal: string | null = null, hash: string | null = null) {
    const time = stamp();
    seq.current += 1;
    const item: LogItem = {
      seq: seq.current,
      stamp: time,
      actor,
      text,
      refusal,
      live: { network: CHAIN_NAME, time, href: hash ? explorerTxUrl(hash) : null, linkLabel: "View transaction on BaseScan (Base Sepolia)" },
    };
    setLog((items) => [...items, item]);
  }

  function notify(tone: Toast["tone"], title: string, text: string, hash?: string | null) {
    seq.current += 1;
    setToast({ id: seq.current, tone, title, text, href: hash ? explorerTxUrl(hash) : null });
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
    setToast(null);
    try {
      await task();
    } catch (err) {
      const error = decodeError(err);
      if (error.kind === "declined") emit(actor, `${label}: declined in the wallet. Nothing was signed or sent.`);
      else emit(actor, `${label}: not sent.`, `${error.name}: ${error.message}`);
      seq.current += 1;
      setToast(toastFor(error, seq.current));
    } finally {
      // Re-read the chain before the next action is possible, so it never starts from stale numbers.
      await latestRefresh.current();
      setBusy(null);
    }
  }

  // Logs the outcome. A refusal by the contract is logged with its name, and with a link when it was sent as evidence.
  function record(result: SendResult, actor: string, done: string, attempt: string, quiet = false): boolean {
    if (result.error) {
      const why = `${result.error.name}: ${result.error.message}`;
      emit(actor, attempt, result.hash ? `Refused on-chain, ${why}` : `Refused by the contract, ${why}`, result.hash);
      notify("danger", `Refused by the contract: ${result.error.name}`, result.error.message, result.hash);
      return false;
    }
    emit(actor, done, null, result.hash);
    if (!quiet) notify("success", `Confirmed on ${CHAIN_NAME}`, done, result.hash);
    return true;
  }

  const send = (sender: Sender, tx: TxRequest, evidence = false) => run(client, sender, tx, { evidence });

  async function connect(option: WalletOption) {
    if (connecting) return;
    setConnecting(true);
    setToast(null);
    try {
      const accounts = await option.provider.request({ method: "eth_requestAccounts" });
      const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      if (!first) throw new GuardError("NoAccount", "The wallet did not share an account.");
      await ensureWalletChain(option.provider);
      setWallet({ option, address: getAddress(first) });
    } catch (err) {
      const error = decodeError(err);
      seq.current += 1;
      setToast(error.kind === "declined" ? { id: seq.current, tone: "neutral", title: "Connection declined", text: "You declined the request in your wallet. Nothing was shared." } : toastFor(error, seq.current));
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    if (busy) return;
    setWallet(null);
    setSnapshot(null);
    setToast(null);
  }

  function startOver() {
    if (busy) return;
    saveDemo(null);
    setDemo(null);
    setSnapshot(null);
    setPayouts({});
    setLog([]);
    notify("neutral", "Started over", "The demo keys and their sandbox are forgotten. What they hold stays on the testnet, unused.");
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
        if (!record(created, ROLE_LABEL.steward, "Created your sandbox space. Its steward demo key writes Points and posts payout records.", "Create a sandbox space", true) || !created.receipt) return;
        id = spaceIdFrom(created.receipt);
        const next = { ...demo, spaceId: id };
        saveDemo(next);
        setDemo(next);
      }
      const space = id;
      const members: [Address, Points][] = [[visitor, VISITOR_POINTS], ...VOTERS.map((role): [Address, Points] => [keys[role].address, DEMO_POINTS[role]])];
      const results = await Promise.all([
        ...members.map(([member, points]) => send(keys.steward, setPointsTx(space, member, points))),
        ...[visitor, ...COMPANIES.map((role) => keys[role].address)].map((to) => send(keys.steward, mintTx(to, MINT))),
      ]);
      const failed = results.find((r) => r.error);
      if (failed) {
        record(failed, ROLE_LABEL.steward, "", "Record Points and mint demo USDC");
        return;
      }
      emit(ROLE_LABEL.steward, "Recorded sample Points for you and contributors A, B and C. Points are soulbound: no function moves them.", null, results[members.length - 1].hash);
      emit(ROLE_LABEL.steward, `Minted ${formatUsdc(MINT)} demo USDC to you, Company B and Company C from the open faucet.`, null, results[results.length - 1].hash);

      // Two sample pools, one per direction, unless this sandbox already has pools.
      const existing = await client.readContract({ address: POOLS_ADDRESS, abi: pooledFundingAbi, functionName: "poolIdsOf", args: [space] });
      if (existing.length === 0) {
        if (!record(await send(keys.companyB, approveTx(SAMPLE_REQUEST.opening)), ROLE_LABEL.companyB, `Approved exactly ${formatUsdc(SAMPLE_REQUEST.opening)} demo USDC for a first pledge.`, "Approve a first pledge", true)) return;
        const [request, proposal] = await Promise.all([
          send(keys.companyB, proposeTx({ spaceId: space, kind: "request", domain: SAMPLE_REQUEST.domain, target: SAMPLE_REQUEST.target, fundingSeconds: SAMPLE_WINDOW_SECONDS, title: SAMPLE_REQUEST.title, openingPledge: SAMPLE_REQUEST.opening })),
          send(keys.contributorA, proposeTx({ spaceId: space, kind: "proposal", domain: SAMPLE_PROPOSAL.domain, target: SAMPLE_PROPOSAL.target, fundingSeconds: SAMPLE_WINDOW_SECONDS, title: SAMPLE_PROPOSAL.title, openingPledge: 0n })),
        ]);
        if (!record(request, ROLE_LABEL.companyB, `Opened a request for ${formatUsdc(SAMPLE_REQUEST.target)} demo USDC with a first pledge of ${formatUsdc(SAMPLE_REQUEST.opening)}.`, "Open a sample request", true) || !request.receipt) return;
        if (!record(proposal, ROLE_LABEL.contributorA, `Proposed a build for ${formatUsdc(SAMPLE_PROPOSAL.target)} demo USDC, with no money down. Its listing vote is open.`, "Propose a sample build", true)) return;
        const requestId = poolIdFrom(request.receipt);
        const votes = await Promise.all([send(keys.contributorA, voteTx(requestId, "for")), send(keys.contributorB, voteTx(requestId, "for"))]);
        const lost = votes.find((v) => v.error);
        if (lost) {
          record(lost, "Contributors A and B", "", "Vote on the sample request");
          return;
        }
        emit("Contributors A and B", `Voted For on pool #${requestId}: together they hold a majority of all power.`, null, votes[1].hash);
        if (!record(await send(keys.steward, finalizeTx(requestId)), ANYONE, `Closed the vote on pool #${requestId}: listed, and open for pledges.`, "Close the vote on the sample request", true)) return;
      }
      const ready = { keys: demo.keys, spaceId: space, ready: true };
      saveDemo(ready);
      setDemo(ready);
      notify("success", "Your sandbox is ready", "Two sample pools are open, one per direction. Your wallet holds demo USDC and Points, so you can fund, propose and vote.");
    });

  const topUp = () =>
    perform("Top up the demo keys", YOU, async () => {
      if (keys) await fundKeys(keys);
    });

  const budget = gasPrice === null ? null : gasBudgets(gasPrice, GAS_KEYS.length);
  const lowKeys = keys && snapshot && budget ? [...GAS_KEYS, "steward" as const].some((role) => (snapshot.eth[keys[role].address] ?? 0n) < budget.perKey / 4n) : false;

  const phase: LivePhase = !wallet
    ? "disconnected"
    : !deployment
      ? "loading"
      : !deployment.usdc || !deployment.pools
        ? "contracts"
        : !demo?.ready
          ? "sandbox"
          : snapshot
            ? "ready"
            : "loading";

  const engine = useMemo<Engine | null>(() => {
    if (phase !== "ready" || !snapshot || !visitor || !keys || spaceId === null) return null;
    const wait = busy ? `Wait: "${busy.label}" is in progress.` : null;
    const roleOf = (address: Address) => DEMO_ROLES.find((role) => isAddressEqual(keys[role].address, address));
    const person = (address: Address): Person => {
      if (isAddressEqual(address, visitor)) return { name: YOU, you: true };
      const role = roleOf(address);
      return { name: role ? ROLE_LABEL[role] : shortenAddress(address), you: false };
    };
    const myPoints = snapshot.points[visitor];
    const myUsdc = snapshot.usdc[visitor] ?? 0n;
    const voterList: { address: Address; note: string }[] = [{ address: visitor, note: "Your wallet" }, ...VOTERS.map((role) => ({ address: keys[role].address, note: PROFILE[role] }))];
    const work = (): [Address, bigint][] => [
      ...VOTERS.map((role): [Address, bigint] => [keys[role].address, DEMO_WORK[role]]),
      ...(sum(myPoints) > 0 ? [[visitor, VISITOR_WORK] as [Address, bigint]] : []),
    ];

    function clockOf(pool: PoolView): string {
      const vote = openVoteOf(pool);
      if (vote) return chainNow < vote.end ? `Vote: ${left(vote.end - chainNow)} left` : "Vote: period over";
      switch (pool.status) {
        case "funding":
          return pool.pledged >= pool.target ? "Full, ready to launch" : chainNow < pool.deadline ? `${left(pool.deadline - chainNow)} left` : "Deadline passed";
        case "building":
          return "Building";
        case "paid":
          return "Paid by Points";
        case "not-listed":
          return pool.pledged > pool.refunded ? "Refund open" : "Not listed";
        default:
          return "Refunds open";
      }
    }

    function toVM(pool: PoolView): PoolVM {
      const id = pool.id.toString();
      const vote = openVoteOf(pool);
      const pledges = snapshot!.pledges[id] ?? {};
      const ballots = snapshot!.ballots[id] ?? {};
      const paid = payouts[id];
      const fee = feeOf(pool.pledged);
      return {
        id: Number(pool.id),
        kind: pool.kind,
        domain: DOMAINS[pool.domain] ?? "apps",
        title: pool.title,
        proposer: person(pool.proposer),
        status: pool.status,
        target: pool.target,
        pledged: pool.pledged,
        refunded: pool.refunded,
        funders: (Object.entries(pledges) as [Address, bigint][])
          .filter(([, amount]) => amount > 0n)
          .map(([address, amount]) => ({ ...person(address), amount })),
        clock: clockOf(pool),
        listing: toTally(pool.listing),
        vote: vote && {
          kind: pool.status === "voting" ? "listing" : "closure",
          tally: toTally(vote),
          ends: chainNow < vote.end ? `ends in ${left(vote.end - chainNow)}` : "voting period over",
          voters: voterList
            .map(({ address, note }) => ({
              ...person(address),
              note,
              power: ballots[address]?.choice ? ballots[address].power : powerOf(snapshot!.points[address] ?? [0, 0, 0, 0], pool.domain),
              choice: ballots[address]?.choice ?? null,
            }))
            .filter((v) => v.power > 0n),
        },
        payouts: paid ? paid.lines.map((l) => ({ ...person(l.contributor), points: l.workPoints, amount: l.amount })) : null,
        fee: pool.status === "paid" ? (paid?.fee ?? fee) : null,
        preview:
          pool.status === "building"
            ? { net: pool.pledged - fee, fee, shares: splitByPoints(pool.pledged - fee, work()).map((s) => ({ ...person(s.who), points: s.points, amount: s.amount })) }
            : null,
      };
    }

    const cmd = (why: string | null, go: () => void): Cmd => ({ why: wait ?? why, run: wait ? () => undefined : go });
    // An action the visitor signs: when it would be refused, the reason is logged and the wallet is not asked.
    const mine = (label: string, why: string | null, go: () => void): Cmd =>
      cmd(why, why ? () => (emit(YOU, label, why), notify("danger", "Not sent", why)) : go);

    function cmds(vm: PoolVM): PoolCmds {
      const pool = snapshot!.pools.find((p) => Number(p.id) === vm.id);
      if (!pool) throw new Error(`Unknown pool ${vm.id}`);
      const id = pool.id.toString();
      const tag = `pool #${pool.id}`;
      const vote = openVoteOf(pool);
      const ballots = snapshot!.ballots[id] ?? {};
      const pledges = snapshot!.pledges[id] ?? {};
      const myPledge = pledges[visitor!] ?? 0n;
      const myPower = powerOf(myPoints ?? [0, 0, 0, 0], pool.domain);
      const room = pool.target - pool.pledged;
      const open = pool.status === "funding" && chainNow < pool.deadline;

      const voteWhy = !vote ? "No vote is open on this pool." : chainNow >= vote.end ? "The voting period is over. Close the vote to apply the result." : myPower === 0n ? "Your wallet has no Points in this sandbox, so it has no voting power." : null;
      const closeWhy = !vote ? "No vote is open on this pool." : chainNow < vote.end && earlyVerdict(vote) === "undecided" ? "The voting period is not over and the result can still change." : null;
      const launchWhy = pool.status !== "funding" ? "Only a listed pool that is still funding can launch." : room > 0n ? `The pool holds ${formatUsdc(pool.pledged)} of ${formatUsdc(pool.target)} USDC. It launches only when it is full.` : null;
      const owed = (Object.entries(pledges) as [Address, bigint][]).filter(([, amount]) => amount > 0n);
      const refundWhy = !refundable(pool.status) ? "A pledge goes back only if the pool is not listed, misses its target or is closed by vote." : owed.length === 0 ? "Nobody has a pledge left in this pool." : null;
      const closureWhy =
        pool.status !== "building"
          ? "Only a launched pool that has not been paid yet can be closed by vote."
          : pool.closure.open
            ? "A closure vote is already open on this pool."
            : chainNow < pool.closureCooldown
              ? `A closure vote just failed. Another one can be asked in ${left(pool.closureCooldown - chainNow)}.`
              : null;
      const payWhy = pool.status !== "building" ? "A pool is paid out only after it has launched, and only once." : pool.closure.open ? "No payout while a closure vote is open." : null;

      const pledgeBy = (actor: string, sender: () => Sender, offered: bigint) =>
        perform("Pledge", actor, async () => {
          const current = await readPool(client, pool.id);
          const gap = current.target - current.pledged;
          const amount = gap > 0n && gap < offered ? gap : offered;
          if (!record(await send(sender(), approveTx(amount)), actor, `Approved the pool contract to take ${formatUsdc(amount)} demo USDC, the exact pledge.`, "Approve the pledge", true)) return;
          const result = await send(sender(), pledgeTx(pool.id, amount));
          const taken = result.receipt && !result.error ? pledgedFrom(result.receipt) : amount;
          record(result, actor, `Pledged ${formatUsdc(taken)} demo USDC to ${tag}. The money sits in the contract until the pool launches or refunds.`, `Pledge to ${tag}`);
        });

      const undecided = VOTERS.filter((role) => !ballots[keys![role].address]?.choice && powerOf(DEMO_POINTS[role], pool.domain) > 0n);
      const sampleVote = (choice: Choice): Cmd =>
        cmd(!vote ? "No vote is open on this pool." : undecided.length === 0 ? "The three sample contributors have voted." : null, () =>
          perform(`Sample contributors vote ${choice}`, "Contributors A, B and C", async () => {
            const results = await Promise.all(undecided.map((role) => send(keys![role], voteTx(pool.id, choice))));
            const failed = results.find((r) => r.error);
            if (failed) record(failed, "Sample contributors", "", `Vote ${choice} on ${tag}`);
            else record(results[results.length - 1], undecided.map((role) => ROLE_LABEL[role]).join(", "), `Voted ${choice} on ${tag}. The contract computed each power from the Points it stores.`, `Vote ${choice} on ${tag}`);
          }),
        );

      const cast: CastGroup[] = [];
      if (vote) {
        cast.push({
          title: "The sample contributors",
          hint: "Three demo keys with Points: an apps specialist, a generalist and an infrastructure specialist.",
          items: [
            { label: "They vote For", cmd: sampleVote("for") },
            { label: "They vote Against", cmd: sampleVote("against") },
          ],
        });
      }
      if (pool.status === "funding") {
        cast.push({
          title: "The other companies",
          hint: `Two demo keys holding demo USDC. Each pledges ${formatUsdc(PLEDGE)}, or what is missing.`,
          items: COMPANIES.map((role) => ({
            label: `${ROLE_LABEL[role]} pledges`,
            cmd: cmd(!open ? "The funding window is over." : room <= 0n ? "The pool is already full." : null, () => pledgeBy(ROLE_LABEL[role], () => keys![role], PLEDGE)),
          })),
        });
      }
      if (pool.status === "building" && !pool.closure.open) {
        const hasPledge = (pledges[keys!.companyB.address] ?? 0n) > 0n;
        cast.push({
          title: "A funder who wants out",
          hint: "A funder of this pool can ask contributors to close a stalled build.",
          items: [
            {
              label: "Company B asks for a closure vote",
              cmd: cmd(hasPledge ? closureWhy : "Company B has no pledge in this pool.", () =>
                perform("Ask for a closure vote", ROLE_LABEL.companyB, async () => {
                  record(await send(keys!.companyB, openClosureTx(pool.id), true), ROLE_LABEL.companyB, `Asked to close ${tag} before payout. Contributors vote; if it passes, every pledge is refunded.`, `Ask for a closure vote on ${tag}`);
                }),
              ),
            },
          ],
        });
      }

      return {
        myPower,
        myChoice: ballots[visitor!]?.choice ?? null,
        myPledge,
        vote: (choice) =>
          mine(`Vote ${choice} on ${tag}`, voteWhy, () =>
            perform(`Vote ${choice}`, YOU, async () => {
              record(await send(me(), voteTx(pool.id, choice)), YOU, `Voted ${choice} on ${tag} with power ${formatPower(myPower)}, computed by the contract from your Points.`, `Vote ${choice} on ${tag}`);
            }),
          ),
        closeVote: cmd(closeWhy, () =>
          perform("Close the vote", ANYONE, async () => {
            record(await send(keys!.steward, finalizeTx(pool.id), true), ANYONE, `Closed the vote on ${tag}. The contract counted the ballots and applied the result.`, `Close the vote on ${tag}`);
          }),
        ),
        pledge: (amount) =>
          mine(
            `Pledge ${formatUsdc(amount)} demo USDC to ${tag}`,
            pool.status !== "funding" ? "This pool is not open for pledges." : !open ? "The funding window is over." : room <= 0n ? "The pool is already full." : amount <= 0n ? "Enter an amount to pledge." : myUsdc < amount ? `Your wallet holds ${formatUsdc(myUsdc)} demo USDC, less than this pledge.` : null,
            () => pledgeBy(YOU, me, amount),
          ),
        launch: cmd(launchWhy, () =>
          perform("Launch", ANYONE, async () => {
            record(await send(keys!.steward, launchTx(pool.id), true), ANYONE, `Launched ${tag}: it held its full ${formatUsdc(pool.target)} demo USDC.`, `Launch ${tag}`);
          }),
        ),
        refund: cmd(refundWhy, () =>
          perform("Refund", ANYONE, async () => {
            // When refunds are closed, one refund is still sent so the refusal is on-chain.
            const targets: [Address, bigint][] = owed.length > 0 ? owed : [[visitor!, 0n]];
            for (const [address, amount] of refundable(pool.status) ? targets : targets.slice(0, 1)) {
              const who = person(address).name;
              const result = await send(keys!.steward, refundTx(pool.id, address), true);
              if (!record(result, ANYONE, `Refunded ${formatUsdc(amount)} demo USDC to ${who === YOU ? "you" : who} from ${tag}, in full.`, `Refund ${who === YOU ? "you" : who} from ${tag}`)) return;
            }
          }),
        ),
        askClosure: mine(`Ask for a closure vote on ${tag}`, closureWhy ?? (myPledge === 0n && myPower === 0n ? "Only a funder of this pool or a contributor with Points can ask for a closure vote." : null), () =>
          perform("Ask for a closure vote", YOU, async () => {
            record(await send(me(), openClosureTx(pool.id)), YOU, `Asked to close ${tag} before payout. Contributors vote; if it passes, every pledge is refunded.`, `Ask for a closure vote on ${tag}`);
          }),
        ),
        payOut: cmd(payWhy, () =>
          perform("Pay out", ROLE_LABEL.steward, async () => {
            const result = await send(keys!.steward, payOutTx(pool.id, work()), true);
            const ok = record(result, ROLE_LABEL.steward, `Paid ${tag} to contributors by share of project Points, less the 2% fee. The contract computed the split.`, `Pay out ${tag}`);
            if (ok && result.receipt) {
              const next = { ...payouts, [id]: payoutsFrom(result.receipt) };
              savePayouts(next);
              setPayouts(next);
            }
          }),
        ),
        cast,
      };
    }

    const windowSeconds = (id: string) => FUNDING_WINDOWS.find((w) => w.id === id)?.seconds ?? 600;

    function proposeWhy(input: ProposeInput): string | null {
      if (wait) return wait;
      const bytes = titleBytes(input.title.trim());
      if (bytes === 0) return "Give the build a title.";
      if (bytes > MAX_TITLE_BYTES) return `The title is too long (${bytes} of ${MAX_TITLE_BYTES} bytes).`;
      if (input.target <= 0n) return "The budget must be more than zero.";
      if (input.kind === "request") {
        if (input.openingPledge <= 0n) return "A request opens with a first pledge from the company that needs it.";
        if (input.openingPledge > input.target) return "The first pledge cannot exceed the budget.";
        if (myUsdc < input.openingPledge) return `Your wallet holds ${formatUsdc(myUsdc)} demo USDC, less than this first pledge.`;
        return null;
      }
      return powerOf(myPoints ?? [0, 0, 0, 0], DOMAINS.indexOf(input.domain)) === 0n ? "A proposal comes from a contributor with Points. Your wallet has none in this sandbox." : null;
    }

    return {
      mode: "live",
      me: { name: shortenAddress(visitor), role: `${wallet?.option.name ?? "Wallet"} on ${CHAIN_NAME}`, usdc: myUsdc, points: sum(myPoints) > 0 ? myPoints : null },
      pools: snapshot.pools.map(toVM).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.id - a.id),
      log,
      cmds,
      windows: FUNDING_WINDOWS,
      defaultWindow: DEFAULT_FUNDING_WINDOW,
      proposeWhy,
      propose(input) {
        return new Promise<number | null>((resolve) => {
          if (proposeWhy(input) !== null) return resolve(null);
          let made: number | null = null;
          const title = input.title.trim();
          const args = { spaceId, kind: input.kind, domain: DOMAINS.indexOf(input.domain), target: input.target, fundingSeconds: windowSeconds(input.window), title };
          void perform(input.kind === "request" ? "Open a request" : "Propose a build", YOU, async () => {
            if (input.kind === "request") {
              if (!record(await send(me(), approveTx(input.openingPledge)), YOU, `Approved the pool contract to take ${formatUsdc(input.openingPledge)} demo USDC, the exact first pledge.`, "Approve the first pledge", true)) return;
            }
            const result = await send(me(), proposeTx({ ...args, openingPledge: input.kind === "request" ? input.openingPledge : 0n }));
            const done =
              input.kind === "request"
                ? `Opened a request for ${formatUsdc(input.target)} demo USDC with a first pledge of ${formatUsdc(input.openingPledge)}. Contributors vote on listing it.`
                : `Proposed a build for ${formatUsdc(input.target)} demo USDC, with no money down. Contributors vote on listing it.`;
            if (record(result, YOU, done, input.kind === "request" ? "Open a request" : "Propose a build") && result.receipt) made = Number(poolIdFrom(result.receipt));
          }).then(() => resolve(made));
        });
      },
      hints: HINTS,
      busy: busy ? (busy.stage === "wallet" ? `${busy.label}: confirm in your wallet` : `${busy.label}: waiting for ${CHAIN_NAME}`) : null,
      toast,
      dismissToast: () => setToast(null),
      controls: null,
    };
    // `me`, `perform` and friends close over the same state the memo already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, snapshot, visitor, keys, spaceId, busy, payouts, log, toast, chainNow, wallet]);

  const info: LiveWallet | null = wallet && { name: wallet.option.name, icon: wallet.option.icon, address: wallet.address };

  return {
    wallets,
    wallet: info,
    connecting,
    connect,
    disconnect,
    phase,
    engine,
    eth: visitor && snapshot ? (snapshot.eth[visitor] ?? null) : null,
    usdc: visitor && snapshot ? (snapshot.usdc[visitor] ?? null) : null,
    points: visitor && snapshot ? (snapshot.points[visitor] ?? null) : null,
    spaceId,
    budget: budget?.total ?? null,
    lowKeys,
    busy,
    toast,
    dismissToast: () => setToast(null),
    rpcIssue,
    log,
    setup,
    deploy,
    topUp,
    startOver,
  };
}

export type Live = ReturnType<typeof useLive>;
