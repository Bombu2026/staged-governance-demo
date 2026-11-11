// Drives the real contracts on a local chain with the same client code the page uses, then replays one
// story in the simulation and on-chain and compares every number.

import { type Address, type Hex, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type PoolView,
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
  poolIdFrom,
  proposeTx,
  readDeployment,
  readPool,
  readSnapshot,
  refundTx,
  setPointsTx,
  spaceIdFrom,
  voteTx,
} from "./chain/actions";
import { POOLS_ADDRESS, USDC_ADDRESS } from "./chain/addresses";
import { CHAIN_ID, CREATE2_DEPLOYER, DEPLOY_SALT } from "./chain/constants";
import { type Eip1193Provider, type Sender, type SendResult, type TxRequest, keySender, run, walletSender } from "./chain/core";
import { GuardError, decodeError } from "./chain/errors";
import { demoUsdcAbi, pooledFundingAbi } from "./generated/contracts";
import { type Choice, type Points, feeOf, powerOf, usdc } from "./math";
import * as sim from "./sim";
import { type LocalChain, startLocalChain } from "./testing/anvil";

const VOTING = 100;
const FUNDING = 1_000;

let chain: LocalChain;
let steward: Sender;
let contributors: Record<sim.Handle, Sender>;
let funders: Record<sim.FunderId, Sender>;
let outsider: Sender;
let fees: Address;

const send = (sender: Sender, tx: TxRequest, evidence = false): Promise<SendResult> => run(chain.client, sender, tx, { evidence });

async function ok(sender: Sender, tx: TxRequest): Promise<SendResult> {
  const result = await send(sender, tx);
  expect(result.error).toBeNull();
  return result;
}

async function refused(sender: Sender, tx: TxRequest, name: string): Promise<void> {
  const result = await send(sender, tx);
  expect(result.error?.name).toBe(name);
  expect(result.hash).toBeNull();
}

const balance = (who: Address) => chain.client.readContract({ address: USDC_ADDRESS, abi: demoUsdcAbi, functionName: "balanceOf", args: [who] });
const pool = (id: bigint): Promise<PoolView> => readPool(chain.client, id);

const SAMPLE_POINTS: Partial<Record<sim.Handle, Points>> = Object.fromEntries(sim.CONTRIBUTORS.map((c) => [c.handle, c.points]));

async function newSpace(points: Partial<Record<sim.Handle, Points>> = SAMPLE_POINTS) {
  const created = await ok(steward, createSpaceTx(VOTING, fees));
  if (!created.receipt) throw new Error("no receipt");
  const spaceId = spaceIdFrom(created.receipt);
  for (const [handle, memberPoints] of Object.entries(points)) {
    await ok(steward, setPointsTx(spaceId, contributors[handle as sim.Handle].address, memberPoints));
  }
  return spaceId;
}

async function request(spaceId: bigint, by: Sender, target: bigint, opening: bigint, domain = 0, title = "A build"): Promise<bigint> {
  await ok(by, approveTx(opening));
  const result = await ok(by, proposeTx({ spaceId, kind: "request", domain, target, fundingSeconds: FUNDING, title, openingPledge: opening }));
  if (!result.receipt) throw new Error("no receipt");
  return poolIdFrom(result.receipt);
}

async function pledge(poolId: bigint, by: Sender, amount: bigint) {
  await ok(by, approveTx(amount));
  return ok(by, pledgeTx(poolId, amount));
}

async function votes(poolId: bigint, ballots: Partial<Record<sim.Handle, Choice>>) {
  for (const [handle, choice] of Object.entries(ballots)) await ok(contributors[handle as sim.Handle], voteTx(poolId, choice));
}

// A listed request of 50,000 opened by company-a with 10,000, in a fresh space.
async function listedRequest(): Promise<{ spaceId: bigint; poolId: bigint }> {
  const spaceId = await newSpace();
  const poolId = await request(spaceId, funders["company-a"], usdc(50_000), usdc(10_000));
  await votes(poolId, { "contributor-e": "for", "contributor-d": "for", "contributor-a": "for", "contributor-f": "for" });
  await ok(outsider, finalizeTx(poolId));
  return { spaceId, poolId };
}

async function launchedRequest() {
  const made = await listedRequest();
  await pledge(made.poolId, funders["company-b"], usdc(20_000));
  await pledge(made.poolId, funders["company-c"], usdc(15_000));
  await pledge(made.poolId, funders["company-d"], usdc(5_000));
  await ok(outsider, launchTx(made.poolId));
  return made;
}

beforeAll(async () => {
  chain = await startLocalChain();
  const key = (i: number) => keySender(chain.client, chain.keys[i]);
  steward = key(0);
  contributors = Object.fromEntries(sim.CONTRIBUTORS.map((c, i) => [c.handle, key(1 + i)])) as Record<sim.Handle, Sender>;
  funders = Object.fromEntries(sim.FUNDERS.map((f, i) => [f.id, key(8 + i)])) as Record<sim.FunderId, Sender>;
  outsider = key(12);
  fees = privateKeyToAccount(chain.keys[13]).address;
  await ok(steward, deployUsdcTx());
  await ok(steward, deployPoolsTx());
  for (const f of sim.FUNDERS) await ok(steward, mintTx(funders[f.id].address, usdc(1_000_000)));
}, 60_000);

afterAll(() => chain?.stop());

describe("deployment", () => {
  it("lands at the addresses derived from the committed bytecode", async () => {
    expect(DEPLOY_SALT).toBe(stringToHex("pooled-funding-demo:v1", { size: 32 }));
    expect(await readDeployment(chain.client)).toEqual({ deployer: true, usdc: true, pools: true });
    const token = await chain.client.readContract({ address: POOLS_ADDRESS, abi: pooledFundingAbi, functionName: "token" });
    expect(token).toBe(USDC_ADDRESS);
  });

  it("cannot be deployed twice", async () => {
    const result = await send(steward, deployPoolsTx());
    expect(result.error?.kind).toBe("contract");
  });

  it("has the sample parameters the simulation uses", async () => {
    const read = (functionName: "QUORUM_BPS" | "FEE_BPS") => chain.client.readContract({ address: POOLS_ADDRESS, abi: pooledFundingAbi, functionName });
    expect(await read("QUORUM_BPS")).toBe(4_000n);
    expect(await read("FEE_BPS")).toBe(200n);
  });
});

describe("Points and power", () => {
  it("computes the same power as the simulation for every contributor and domain", async () => {
    const spaceId = await newSpace();
    for (const c of sim.CONTRIBUTORS) {
      for (let domain = 0; domain < 4; domain++) {
        const onChain = await chain.client.readContract({
          address: POOLS_ADDRESS,
          abi: pooledFundingAbi,
          functionName: "powerOf",
          args: [spaceId, contributors[c.handle].address, domain],
        });
        expect(onChain).toBe(powerOf(c.points, domain));
      }
    }
    const space = await chain.client.readContract({ address: POOLS_ADDRESS, abi: pooledFundingAbi, functionName: "getSpace", args: [spaceId] });
    expect([...space.totalPower]).toEqual(sim.DOMAINS.map((d) => sim.totalPowerIn(sim.initialState, d)));
  });

  it("lets only the steward write Points, and keeps the totals right when they change", async () => {
    const spaceId = await newSpace({ "contributor-a": [100, 0, 0, 0] });
    const member = contributors["contributor-a"].address;
    await refused(outsider, setPointsTx(spaceId, member, [9_999, 0, 0, 0]), "NotSteward");
    await refused(contributors["contributor-a"], setPointsTx(spaceId, member, [9_999, 0, 0, 0]), "NotSteward");
    await ok(steward, setPointsTx(spaceId, member, [400, 0, 0, 0]));
    const space = await chain.client.readContract({ address: POOLS_ADDRESS, abi: pooledFundingAbi, functionName: "getSpace", args: [spaceId] });
    expect(space.totalPower[0]).toBe(powerOf([400, 0, 0, 0], 0));
    expect(space.totalPower[1]).toBe(powerOf([400, 0, 0, 0], 1));
  });
});

describe("proposing", () => {
  it("applies the same entry rules as the simulation", async () => {
    const spaceId = await newSpace();
    const base = { spaceId, domain: 1, target: usdc(8_000), fundingSeconds: FUNDING, title: "A tool" };
    const company = funders["company-b"];
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: 0n }), "OpeningPledgeRequired");
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: usdc(9_000) }), "BadParameters");
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: usdc(1_000) }), "InsufficientAllowance");
    await refused(company, proposeTx({ ...base, kind: "proposal", openingPledge: 0n }), "NotAContributor");
    await refused(contributors["contributor-c"], proposeTx({ ...base, kind: "proposal", openingPledge: 1n }), "BadParameters");
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: usdc(1_000), title: "" }), "BadParameters");
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: usdc(1_000), title: "x".repeat(121) }), "BadParameters");
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: usdc(1_000), fundingSeconds: 10 }), "BadParameters");
    await refused(company, proposeTx({ ...base, kind: "request", openingPledge: usdc(1_000), domain: 4 }), "BadParameters");
    await refused(company, proposeTx({ ...base, spaceId: 999_999n, kind: "request", openingPledge: usdc(1_000) }), "UnknownSpace");

    const made = await ok(contributors["contributor-c"], proposeTx({ ...base, kind: "proposal", openingPledge: 0n }));
    const created = await pool(poolIdFrom(made.receipt!));
    expect(created).toMatchObject({ kind: "proposal", status: "voting", domain: 1, pledged: 0n, target: usdc(8_000), title: "A tool", funders: 0 });
    expect(created.proposer).toBe(contributors["contributor-c"].address);
    expect(created.listing.total).toBe(sim.totalPowerIn(sim.initialState, "data"));
  });

  it("refuses a pool in a space where nobody could vote", async () => {
    const created = await ok(steward, createSpaceTx(VOTING, fees));
    const empty = spaceIdFrom(created.receipt!);
    await ok(funders["company-b"], approveTx(usdc(1_000)));
    const tx = proposeTx({ spaceId: empty, kind: "request", domain: 0, target: usdc(5_000), fundingSeconds: FUNDING, title: "x", openingPledge: usdc(1_000) });
    await refused(funders["company-b"], tx, "NoVoters");
  });
});

describe("the listing vote", () => {
  it("counts power, lets a vote change, and refuses accounts without Points", async () => {
    const spaceId = await newSpace();
    const poolId = await request(spaceId, funders["company-a"], usdc(50_000), usdc(10_000));
    await refused(outsider, voteTx(poolId, "for"), "NoVotingPower");
    await refused(funders["company-a"], voteTx(poolId, "for"), "NoVotingPower");
    await votes(poolId, { "contributor-e": "for" });
    const power = powerOf(sim.contributorOf("contributor-e").points, 0);
    expect((await pool(poolId)).listing.for).toBe(power);
    await votes(poolId, { "contributor-e": "against" });
    const tally = (await pool(poolId)).listing;
    expect([tally.for, tally.against]).toEqual([0n, power]);
    // One strong voter against is not half of all power, and the period is not over.
    await refused(outsider, finalizeTx(poolId), "VoteStillOpen");
    await refused(funders["company-b"], pledgeTx(poolId, usdc(1_000)), "FundingClosed");
    await refused(outsider, launchTx(poolId), "NotFunding");
  });

  it("does not list below quorum, and refunds the first pledge", async () => {
    const spaceId = await newSpace();
    const company = funders["company-a"];
    const before = await balance(company.address);
    const poolId = await request(spaceId, company, usdc(50_000), usdc(10_000));
    expect(await balance(company.address)).toBe(before - usdc(10_000));
    await votes(poolId, { "contributor-g": "for" });
    await chain.warp(VOTING);
    await refused(contributors["contributor-d"], voteTx(poolId, "for"), "VotingEnded");
    await ok(outsider, finalizeTx(poolId));
    expect((await pool(poolId)).status).toBe("not-listed");
    await refused(outsider, finalizeTx(poolId), "NoOpenVote");
    await refused(funders["company-b"], pledgeTx(poolId, usdc(1_000)), "FundingClosed");
    await ok(outsider, refundTx(poolId, company.address));
    expect(await balance(company.address)).toBe(before);
    await refused(outsider, refundTx(poolId, company.address), "NothingToRefund");
  });

  it("lists after the period on quorum and more For than Against", async () => {
    const spaceId = await newSpace();
    const poolId = await request(spaceId, funders["company-a"], usdc(50_000), usdc(10_000), 2);
    await votes(poolId, { "contributor-b": "for", "contributor-a": "for", "contributor-c": "against" });
    await refused(outsider, finalizeTx(poolId), "VoteStillOpen");
    await chain.warp(VOTING);
    await ok(outsider, finalizeTx(poolId));
    const listed = await pool(poolId);
    expect(listed.status).toBe("funding");
    expect(listed.deadline).toBe((await chain.now()) + FUNDING);
  });

  it("closes early against a pool once Against holds half of all power", async () => {
    const spaceId = await newSpace({ "contributor-a": [100, 0, 0, 0], "contributor-b": [100, 0, 0, 0] });
    const poolId = await request(spaceId, funders["company-a"], usdc(5_000), usdc(1_000));
    await votes(poolId, { "contributor-a": "against" });
    await ok(outsider, finalizeTx(poolId));
    expect((await pool(poolId)).status).toBe("not-listed");
  });
});

describe("all or nothing", () => {
  it("launches only when full, takes only what is missing, and locks pledges meanwhile", async () => {
    const { poolId } = await listedRequest();
    await pledge(poolId, funders["company-b"], usdc(20_000));
    await refused(outsider, launchTx(poolId), "TargetNotReached");
    await refused(outsider, refundTx(poolId, funders["company-b"].address), "RefundNotAvailable");
    await refused(funders["company-c"], pledgeTx(poolId, 0n), "BadParameters");

    const company = funders["company-c"];
    const before = await balance(company.address);
    await ok(company, approveTx(usdc(40_000)));
    await ok(company, pledgeTx(poolId, usdc(40_000)));
    expect(await balance(company.address)).toBe(before - usdc(20_000));
    const full = await pool(poolId);
    expect([full.pledged, full.funders, full.status]).toEqual([usdc(50_000), 3, "funding"]);
    await refused(company, pledgeTx(poolId, usdc(1)), "PoolFull");

    await ok(outsider, launchTx(poolId));
    expect((await pool(poolId)).status).toBe("building");
    await refused(outsider, launchTx(poolId), "NotFunding");
    await refused(outsider, refundTx(poolId, company.address), "RefundNotAvailable");
    await refused(company, pledgeTx(poolId, usdc(1)), "FundingClosed");
  });

  it("refunds every pledge in full when the deadline passes below the target", async () => {
    const { poolId } = await listedRequest();
    const a = funders["company-a"];
    const b = funders["company-b"];
    const before = await balance(b.address);
    const held = await balance(POOLS_ADDRESS);
    await pledge(poolId, b, usdc(20_000));
    await chain.warp(FUNDING - 10);
    expect((await pool(poolId)).status).toBe("funding");
    await refused(outsider, refundTx(poolId, b.address), "RefundNotAvailable");
    await chain.warp(10);
    expect((await pool(poolId)).status).toBe("expired");
    await refused(funders["company-c"], pledgeTx(poolId, usdc(1_000)), "FundingClosed");
    await refused(outsider, launchTx(poolId), "TargetNotReached");

    // Anyone can trigger a refund; the money only goes to the funder.
    const outsiderBefore = await balance(outsider.address);
    await ok(outsider, refundTx(poolId, b.address));
    expect(await balance(b.address)).toBe(before);
    expect(await balance(outsider.address)).toBe(outsiderBefore);
    await ok(a, refundTx(poolId, a.address));
    await refused(outsider, refundTx(poolId, b.address), "NothingToRefund");
    await refused(outsider, refundTx(poolId, outsider.address), "NothingToRefund");
    const done = await pool(poolId);
    expect([done.status, done.pledged, done.refunded]).toEqual(["expired", usdc(30_000), usdc(30_000)]);
    expect(await balance(POOLS_ADDRESS)).toBe(held - usdc(10_000));
  });

  it("keeps a full pool launchable after its deadline, and never refundable", async () => {
    const { poolId } = await listedRequest();
    await pledge(poolId, funders["company-b"], usdc(40_000));
    await chain.warp(FUNDING + 50);
    expect((await pool(poolId)).status).toBe("funding");
    await refused(outsider, refundTx(poolId, funders["company-b"].address), "RefundNotAvailable");
    await ok(outsider, launchTx(poolId));
  });

  it("can record a refusal on-chain as a reverted transaction", async () => {
    const { poolId } = await listedRequest();
    const result = await send(outsider, launchTx(poolId), true);
    expect(result.error?.name).toBe("TargetNotReached");
    expect(result.error?.message).toContain("10,000 of 50,000");
    expect(result.receipt?.status).toBe("reverted");
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("paying a launched pool", () => {
  it("splits the pool by project Points less a 2% fee, exactly once", async () => {
    const { poolId } = await launchedRequest();
    const work: [Address, bigint][] = [
      [contributors["contributor-e"].address, 160n],
      [contributors["contributor-d"].address, 60n],
      [contributors["contributor-f"].address, 120n],
    ];
    await refused(outsider, payOutTx(poolId, work), "NotSteward");
    await refused(funders["company-a"], payOutTx(poolId, work), "NotSteward");
    await refused(steward, payOutTx(poolId, []), "NoAcceptedWork");
    await refused(steward, payOutTx(poolId, [[work[0][0], 0n]]), "BadParameters");

    const before = await Promise.all([...work.map(([who]) => balance(who)), balance(fees), balance(POOLS_ADDRESS)]);
    const result = await ok(steward, payOutTx(poolId, work));
    const after = await Promise.all([...work.map(([who]) => balance(who)), balance(fees), balance(POOLS_ADDRESS)]);
    const paid = after.map((x, i) => x - before[i]);
    expect(paid).toEqual([23_058_823_529n, 8_647_058_823n, 17_294_117_648n, usdc(1_000), -usdc(50_000)]);

    const receipt = payoutsFrom(result.receipt!);
    expect(receipt.fee).toBe(feeOf(usdc(50_000)));
    expect(receipt.net).toBe(usdc(49_000));
    expect(receipt.lines.map((l) => l.amount)).toEqual(paid.slice(0, 3));
    expect((await pool(poolId)).status).toBe("paid");
    await refused(steward, payOutTx(poolId, work), "NotBuilding");
    await refused(outsider, refundTx(poolId, funders["company-a"].address), "RefundNotAvailable");
    await refused(funders["company-a"], openClosureTx(poolId), "NotBuilding");
  });

  it("can be closed by vote before payout, which refunds every funder in full", async () => {
    const { poolId } = await launchedRequest();
    const before = await Promise.all(sim.FUNDERS.map((f) => balance(funders[f.id].address)));
    await refused(outsider, openClosureTx(poolId), "NotAParticipant");
    await ok(funders["company-b"], openClosureTx(poolId));
    await refused(contributors["contributor-c"], openClosureTx(poolId), "ClosureVoteOpen");
    await refused(steward, payOutTx(poolId, [[contributors["contributor-e"].address, 10n]]), "ClosureVoteOpen");
    expect((await pool(poolId)).round).toBe(1);
    await votes(poolId, { "contributor-e": "for", "contributor-d": "for", "contributor-a": "for", "contributor-b": "for" });
    await ok(outsider, finalizeTx(poolId));
    expect((await pool(poolId)).status).toBe("closed");
    await refused(steward, payOutTx(poolId, [[contributors["contributor-e"].address, 10n]]), "NotBuilding");
    for (const f of sim.FUNDERS) await ok(outsider, refundTx(poolId, funders[f.id].address));
    const after = await Promise.all(sim.FUNDERS.map((f) => balance(funders[f.id].address)));
    expect(after.map((x, i) => x - before[i])).toEqual([usdc(10_000), usdc(20_000), usdc(15_000), usdc(5_000)]);
  });

  it("continues when the closure vote fails, and the vote can be asked again", async () => {
    const { poolId } = await launchedRequest();
    await ok(contributors["contributor-c"], openClosureTx(poolId));
    await votes(poolId, { "contributor-c": "for" });
    await chain.warp(VOTING);
    await ok(outsider, finalizeTx(poolId));
    const still = await pool(poolId);
    expect([still.status, still.closure.open]).toEqual(["building", false]);
    // Another closure vote has to wait one voting period, so repeated votes cannot block the payout.
    expect(still.closureCooldown).toBe((await chain.now()) + VOTING);
    await refused(funders["company-a"], openClosureTx(poolId), "ClosureCooldown");
    await chain.warp(VOTING);
    await ok(funders["company-a"], openClosureTx(poolId));
    expect((await pool(poolId)).round).toBe(2);
    // The second vote starts from zero: the first round's ballot does not carry over.
    expect((await pool(poolId)).closure.for).toBe(0n);
    await chain.warp(VOTING);
    await ok(outsider, finalizeTx(poolId));
    await ok(steward, payOutTx(poolId, [[contributors["contributor-e"].address, 10n]]));
  });
});

describe("the wallet guard", () => {
  const me = "0x00000000000000000000000000000000000000aa" as Address;
  const demoKey = "0x00000000000000000000000000000000000000bb" as Address;
  const hash = `0x${"ab".repeat(32)}` as Hex;

  function fakeWallet(chainId: number) {
    const calls: { method: string; params?: readonly unknown[] }[] = [];
    const provider: Eip1193Provider = {
      async request(args) {
        calls.push(args);
        return args.method === "eth_chainId" ? `0x${chainId.toString(16)}` : hash;
      },
    };
    return { provider, calls };
  }

  it("sends nothing when the wallet is on another network", async () => {
    const { provider, calls } = fakeWallet(8453);
    await expect(walletSender(provider, me).send(approveTx(1n))).rejects.toBeInstanceOf(GuardError);
    expect(calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });

  it("only sends to the demo contracts, and plain ETH only to a demo key", async () => {
    const { provider, calls } = fakeWallet(CHAIN_ID);
    const wallet = walletSender(provider, me, [demoKey]);
    await expect(wallet.send({ to: me, data: "0x1234" })).rejects.toThrow(/only sends transactions to its own demo contracts/);
    await expect(wallet.send({ to: USDC_ADDRESS, data: "0x1234", value: 1n })).rejects.toBeInstanceOf(GuardError);
    await expect(wallet.send({ to: me, value: 1n })).rejects.toBeInstanceOf(GuardError);
    await expect(wallet.send({ to: demoKey, value: 1n, data: "0x1234" })).rejects.toBeInstanceOf(GuardError);
    expect(calls.some((c) => c.method === "eth_sendTransaction")).toBe(false);

    expect(await wallet.send(approveTx(5n))).toBe(hash);
    expect(await wallet.send({ to: CREATE2_DEPLOYER, data: "0x00" })).toBe(hash);
    expect(await wallet.send({ to: demoKey, value: 7n })).toBe(hash);
    const sent = calls.filter((c) => c.method === "eth_sendTransaction").map((c) => c.params?.[0]);
    expect(sent[0]).toMatchObject({ from: me, to: USDC_ADDRESS, value: "0x0" });
    expect(sent[2]).toEqual({ from: me, to: demoKey, data: "0x", value: "0x7" });
    expect(calls.every((c) => ["eth_chainId", "eth_sendTransaction"].includes(c.method))).toBe(true);
  });

  it("reads a declined request as declined", () => {
    expect(decodeError({ code: 4001, message: "User rejected the request." }).kind).toBe("declined");
  });
});

describe("the simulation and the contract", () => {
  it("give the same tallies, statuses, payouts and refunds on the same story", async () => {
    const spaceId = await newSpace();
    const address = (who: string): Address => (sim.isFunder(who) ? funders[who].address : contributors[who as sim.Handle].address);
    const ids = new Map<number, bigint>();
    let state = sim.emptyState;

    // Replays the simulation's own seed, then a full story, action by action on both sides.
    const seed: sim.Action[] = [
      { type: "propose", kind: "request", by: "company-a", title: "Open-source e-invoicing engine for the EU formats", domain: "apps", target: usdc(50_000), fundingDays: 30, openingPledge: usdc(10_000) },
      { type: "vote", pool: 1, handle: "contributor-e", choice: "for" },
      { type: "vote", pool: 1, handle: "contributor-d", choice: "for" },
      { type: "vote", pool: 1, handle: "contributor-a", choice: "for" },
      { type: "vote", pool: 1, handle: "contributor-f", choice: "for" },
      { type: "vote", pool: 1, handle: "contributor-c", choice: "against" },
      { type: "finalize", pool: 1 },
      { type: "propose", kind: "proposal", by: "contributor-b", title: "Open-source rebuild of a hosted feature-flag service", domain: "infra", target: usdc(30_000), fundingDays: 30 },
    ];
    const story: sim.Action[] = [
      { type: "launch", pool: 1 },
      { type: "pledge", pool: 1, funder: "company-b", amount: usdc(20_000) },
      { type: "refund", pool: 1, funder: "company-b" },
      { type: "pledge", pool: 1, funder: "company-c", amount: usdc(15_000) },
      { type: "pledge", pool: 1, funder: "company-d", amount: usdc(20_000) },
      { type: "pledge", pool: 1, funder: "company-d", amount: usdc(1_000) },
      { type: "launch", pool: 1 },
      { type: "vote", pool: 2, handle: "contributor-b", choice: "for" },
      { type: "finalize", pool: 2 },
      { type: "vote", pool: 2, handle: "contributor-d", choice: "against" },
      { type: "vote", pool: 2, handle: "contributor-d", choice: "for" },
      { type: "vote", pool: 2, handle: "contributor-a", choice: "abstain" },
      { type: "advance", days: 3 },
      { type: "vote", pool: 2, handle: "contributor-c", choice: "for" },
      { type: "finalize", pool: 2 },
      { type: "pledge", pool: 2, funder: "company-b", amount: usdc(10_000) },
      { type: "advance", days: 30 },
      { type: "pledge", pool: 2, funder: "company-c", amount: usdc(5_000) },
      { type: "launch", pool: 2 },
      { type: "refund", pool: 2, funder: "company-b" },
      { type: "refund", pool: 2, funder: "company-b" },
      { type: "openClosure", pool: 1, by: "company-b" },
      { type: "openClosure", pool: 1, by: "contributor-c" },
      { type: "payOut", pool: 1 },
      { type: "vote", pool: 1, handle: "contributor-c", choice: "for" },
      { type: "finalize", pool: 1 },
      { type: "advance", days: 3 },
      { type: "finalize", pool: 1 },
      { type: "openClosure", pool: 1, by: "contributor-c" },
      { type: "payOut", pool: 1 },
      { type: "acceptWork", pool: 1 },
      { type: "acceptWork", pool: 1 },
      { type: "acceptWork", pool: 1 },
      { type: "payOut", pool: 1 },
      { type: "payOut", pool: 1 },
    ];
    // One simulated day is 100 seconds on the local chain: a 3-day vote lasts VOTING seconds.
    const DAY = VOTING / sim.VOTING_DAYS;

    async function onChain(action: sim.Action): Promise<SendResult | null> {
      const id = "pool" in action ? (ids.get(action.pool) ?? 0n) : 0n;
      switch (action.type) {
        case "reset":
          return null;
        case "advance":
          await chain.warp(Math.round(action.days * DAY));
          return null;
        case "acceptWork":
          return null; // work is recorded off-chain and posted with the payout
        case "propose": {
          const opening = action.kind === "request" ? action.openingPledge : 0n;
          const by = sim.isFunder(action.by) ? funders[action.by] : contributors[action.by as sim.Handle];
          if (opening > 0n) await ok(by, approveTx(opening));
          const tx = proposeTx({
            spaceId,
            kind: action.kind,
            domain: sim.domainIndex(action.domain),
            target: action.target,
            fundingSeconds: Math.round(action.fundingDays * DAY),
            title: action.title,
            openingPledge: opening,
          });
          const result = await send(by, tx);
          if (result.receipt && !result.error) ids.set(ids.size + 1, poolIdFrom(result.receipt));
          return result;
        }
        case "vote":
          return send(contributors[action.handle], voteTx(id, action.choice));
        case "finalize":
          return send(outsider, finalizeTx(id));
        case "pledge":
          await ok(funders[action.funder], approveTx(action.amount));
          return send(funders[action.funder], pledgeTx(id, action.amount));
        case "launch":
          return send(outsider, launchTx(id));
        case "refund":
          return send(outsider, refundTx(id, funders[action.funder].address));
        case "openClosure":
          return send(sim.isFunder(action.by) ? funders[action.by] : contributors[action.by as sim.Handle], openClosureTx(id));
        case "payOut": {
          const p = sim.poolOf(state, action.pool);
          return send(steward, payOutTx(id, p ? sim.workList(p).map(([handle, points]) => [address(handle), points]) : []));
        }
      }
    }

    const watched = [...sim.FUNDERS.map((f) => f.id), ...sim.CONTRIBUTORS.map((c) => c.handle)];
    const balances = () => Promise.all(watched.map((who) => balance(address(who))));
    const money = (who: string, of: sim.State) => (sim.isFunder(who) ? of.wallets[who] : of.earned[who as sim.Handle]);
    const feesBefore = await balance(fees);
    const start = await balances();

    for (const action of [...seed, ...story]) {
      const expected = sim.refusal(state, action);
      const next = sim.reduce(state, action);
      const result = await onChain(action);
      if (result) expect(result.error?.name ?? null, `${action.type} on day ${state.day}`).toBe(expected?.code ?? null);
      state = next;

      for (const [simId, chainId] of ids) {
        const s = sim.poolOf(state, simId)!;
        const c = await pool(chainId);
        expect(c.status, `status of pool ${simId} after ${action.type}`).toBe(sim.statusOf(s, state.day));
        expect([c.pledged, c.refunded, c.round]).toEqual([s.pledged, s.refunded, s.round]);
        const tally = (t: { for: bigint; against: bigint; abstain: bigint; total: bigint; open: boolean }) => [t.for, t.against, t.abstain, t.total, t.open];
        expect(tally(c.listing)).toEqual(tally(s.listing));
        if (s.closure) expect(tally(c.closure), `closure tally of pool ${simId} after ${action.type}`).toEqual(tally(s.closure));
        expect(c.kind).toBe(s.kind);
        expect(c.title).toBe(s.title);
      }
      // Money moved the same way on both sides, for every funder and contributor.
      const moved = (await balances()).map((x, i) => x - start[i]);
      expect(moved, `balances after ${action.type}`).toEqual(watched.map((who) => money(who, state) - money(who, sim.emptyState)));
    }

    expect(await balance(fees)).toBe(feesBefore + state.fees);
    expect(sim.poolOf(state, 1)?.status).toBe("paid");
    expect(sim.statusOf(sim.poolOf(state, 2)!, state.day)).toBe("expired");

    const snapshot = await readSnapshot(chain.client, {
      spaceId,
      accounts: [steward.address],
      holders: [funders["company-b"].address],
      funders: sim.FUNDERS.map((f) => funders[f.id].address),
      voters: sim.CONTRIBUTORS.map((c) => contributors[c.handle].address),
    });
    expect(snapshot.poolIds).toEqual([...ids.values()]);
    expect(snapshot.pool?.id).toBe(ids.get(2));
    // No vote is open on that pool any more, so ballots are not read.
    expect(snapshot.ballots).toEqual({});
    expect(snapshot.usdc[funders["company-b"].address]).toBe(await balance(funders["company-b"].address));
    expect(snapshot.pledges[funders["company-b"].address]).toBe(0n);
    expect(Math.abs(snapshot.chainSkew + Date.now() / 1000 - (await chain.now()))).toBeLessThan(5);
  }, 120_000);
});
