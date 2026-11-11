import { type Address, type Hex, type TransactionReceipt, encodeFunctionData, parseEventLogs } from "viem";
import { demoUsdcAbi, pooledFundingAbi } from "../generated/contracts";
import type { Choice, Points } from "../math";
import { POOLS_ADDRESS, POOLS_INIT_CODE, USDC_ADDRESS, USDC_INIT_CODE, deployCalldata } from "./addresses";
import { CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE } from "./constants";
import { type ChainClient, type TxRequest, assertChain } from "./core";

export type Kind = "request" | "proposal";
export type Status = "voting" | "not-listed" | "funding" | "expired" | "building" | "paid" | "closed";

// Same order as the contract's enums.
const KINDS: readonly Kind[] = ["request", "proposal"];
const STATUSES: readonly Status[] = ["voting", "not-listed", "funding", "expired", "building", "paid", "closed"];
const CHOICES: readonly (Choice | null)[] = [null, "for", "against", "abstain"];

const encode = encodeFunctionData;
const abi = pooledFundingAbi;
const toPools = (data: Hex): TxRequest => ({ to: POOLS_ADDRESS, data });

export const deployUsdcTx = (): TxRequest => ({ to: CREATE2_DEPLOYER, data: deployCalldata(USDC_INIT_CODE) });
export const deployPoolsTx = (): TxRequest => ({ to: CREATE2_DEPLOYER, data: deployCalldata(POOLS_INIT_CODE) });

export const mintTx = (to: Address, amount: bigint): TxRequest => ({
  to: USDC_ADDRESS,
  data: encode({ abi: demoUsdcAbi, functionName: "mint", args: [to, amount] }),
});

// Always for the exact amount about to be pledged, never an unlimited allowance.
export const approveTx = (amount: bigint): TxRequest => ({
  to: USDC_ADDRESS,
  data: encode({ abi: demoUsdcAbi, functionName: "approve", args: [POOLS_ADDRESS, amount] }),
});

export const createSpaceTx = (votingSeconds: number, feeRecipient: Address) =>
  toPools(encode({ abi, functionName: "createSpace", args: [votingSeconds, feeRecipient] }));

export const setPointsTx = (spaceId: bigint, member: Address, points: Points) =>
  toPools(encode({ abi, functionName: "setPoints", args: [spaceId, member, points] }));

export interface ProposeArgs {
  spaceId: bigint;
  kind: Kind;
  domain: number;
  target: bigint;
  fundingSeconds: number;
  title: string;
  openingPledge: bigint;
}

export const proposeTx = (a: ProposeArgs) =>
  toPools(
    encode({
      abi,
      functionName: "propose",
      args: [a.spaceId, KINDS.indexOf(a.kind), a.domain, a.target, a.fundingSeconds, a.title, a.openingPledge],
    }),
  );

export const voteTx = (poolId: bigint, choice: Choice) => toPools(encode({ abi, functionName: "vote", args: [poolId, CHOICES.indexOf(choice)] }));
export const finalizeTx = (poolId: bigint) => toPools(encode({ abi, functionName: "finalize", args: [poolId] }));
export const openClosureTx = (poolId: bigint) => toPools(encode({ abi, functionName: "openClosure", args: [poolId] }));
export const pledgeTx = (poolId: bigint, amount: bigint) => toPools(encode({ abi, functionName: "pledge", args: [poolId, amount] }));
export const launchTx = (poolId: bigint) => toPools(encode({ abi, functionName: "launch", args: [poolId] }));
export const refundTx = (poolId: bigint, funder: Address) => toPools(encode({ abi, functionName: "refund", args: [poolId, funder] }));

export const payOutTx = (poolId: bigint, work: readonly (readonly [Address, bigint])[]) =>
  toPools(encode({ abi, functionName: "payOut", args: [poolId, work.map(([who]) => who), work.map(([, points]) => points)] }));

export function spaceIdFrom(receipt: TransactionReceipt): bigint {
  const [log] = parseEventLogs({ abi: pooledFundingAbi, eventName: "SpaceCreated", logs: receipt.logs });
  if (!log) throw new Error("The receipt holds no SpaceCreated event");
  return log.args.spaceId;
}

export function poolIdFrom(receipt: TransactionReceipt): bigint {
  const [log] = parseEventLogs({ abi: pooledFundingAbi, eventName: "PoolProposed", logs: receipt.logs });
  if (!log) throw new Error("The receipt holds no PoolProposed event");
  return log.args.poolId;
}

// What the contract actually took for a pledge, which can be less than what was offered.
export function pledgedFrom(receipt: TransactionReceipt): bigint {
  const [log] = parseEventLogs({ abi: pooledFundingAbi, eventName: "Pledged", logs: receipt.logs });
  if (!log) throw new Error("The receipt holds no Pledged event");
  return log.args.amount;
}

export interface PayoutLine {
  contributor: Address;
  workPoints: bigint;
  amount: bigint;
}

export function payoutsFrom(receipt: TransactionReceipt): { lines: PayoutLine[]; net: bigint; fee: bigint } {
  const lines = parseEventLogs({ abi: pooledFundingAbi, eventName: "Payout", logs: receipt.logs }).map((l) => ({
    contributor: l.args.contributor,
    workPoints: l.args.workPoints,
    amount: l.args.amount,
  }));
  const [total] = parseEventLogs({ abi: pooledFundingAbi, eventName: "PaidOut", logs: receipt.logs });
  return { lines, net: total?.args.net ?? 0n, fee: total?.args.fee ?? 0n };
}

export interface Deployment {
  deployer: boolean;
  usdc: boolean;
  pools: boolean;
}

const hasCode = (code: string | undefined) => code !== undefined && code !== "0x";

// A contract found at one of the two addresses can only be this repository's bytecode: the address is
// derived from it. The proxy itself is compared byte for byte with its published runtime code.
export async function readDeployment(client: ChainClient): Promise<Deployment> {
  await assertChain(client);
  const [deployer, usdc, poolsCode] = await Promise.all([
    client.getCode({ address: CREATE2_DEPLOYER }),
    client.getCode({ address: USDC_ADDRESS }),
    client.getCode({ address: POOLS_ADDRESS }),
  ]);
  return { deployer: deployer?.toLowerCase() === CREATE2_DEPLOYER_CODE, usdc: hasCode(usdc), pools: hasCode(poolsCode) };
}

export interface TallyView {
  end: number;
  open: boolean;
  for: bigint;
  against: bigint;
  abstain: bigint;
  total: bigint;
}

export interface PoolView {
  id: bigint;
  spaceId: bigint;
  proposer: Address;
  kind: Kind;
  domain: number;
  status: Status;
  funders: number;
  round: number;
  fundingSeconds: number;
  deadline: number;
  closureCooldown: number;
  target: bigint;
  pledged: bigint;
  refunded: bigint;
  listing: TallyView;
  closure: TallyView;
  title: string;
}

type RawTally = { end: bigint; open: boolean; forPower: bigint; againstPower: bigint; abstainPower: bigint; totalPower: bigint };

const tallyView = (t: RawTally): TallyView => ({
  end: Number(t.end),
  open: t.open,
  for: t.forPower,
  against: t.againstPower,
  abstain: t.abstainPower,
  total: t.totalPower,
});

export async function readPool(client: ChainClient, poolId: bigint): Promise<PoolView> {
  const p = await client.readContract({ address: POOLS_ADDRESS, abi: pooledFundingAbi, functionName: "getPool", args: [poolId] });
  return {
    id: poolId,
    spaceId: p.spaceId,
    proposer: p.proposer,
    kind: KINDS[p.kind] ?? "request",
    domain: p.domain,
    status: STATUSES[p.status] ?? "voting",
    funders: p.funders,
    round: p.round,
    fundingSeconds: p.fundingPeriod,
    deadline: Number(p.deadline),
    closureCooldown: Number(p.closureCooldown),
    target: p.target,
    pledged: p.pledged,
    refunded: p.refunded,
    listing: tallyView(p.listing),
    closure: tallyView(p.closure),
    title: p.title,
  };
}

export interface BallotView {
  choice: Choice | null;
  power: bigint;
}

export interface SpaceView {
  steward: Address;
  feeRecipient: Address;
  votingSeconds: number;
  totalPower: readonly bigint[];
}

export interface Snapshot {
  // Seconds to add to the local clock to get block time.
  chainSkew: number;
  space: SpaceView | null;
  pool: PoolView | null;
  poolIds: bigint[];
  eth: Record<Address, bigint>;
  usdc: Record<Address, bigint>;
  pledges: Record<Address, bigint>;
  ballots: Record<Address, BallotView>;
  power: Record<Address, bigint>;
}

export interface SnapshotQuery {
  spaceId: bigint | null;
  // The pool to detail; defaults to the newest pool of the space.
  poolId?: bigint | null;
  // Accounts whose ETH balance is read, and those whose demo USDC balance is read.
  accounts: readonly Address[];
  holders: readonly Address[];
  funders: readonly Address[];
  voters: readonly Address[];
}

const record = <T>(keys: readonly Address[], values: readonly T[]): Record<Address, T> =>
  Object.fromEntries(keys.map((key, i) => [key, values[i]])) as Record<Address, T>;

// Everything the live panel shows, read from the chain in two batched round trips. Ballots and powers
// are only read while a vote is open, to stay light on the public RPC.
export async function readSnapshot(client: ChainClient, q: SnapshotQuery): Promise<Snapshot> {
  await assertChain(client);
  const read = { address: POOLS_ADDRESS, abi: pooledFundingAbi } as const;
  const [block, eth, usdc, space, poolIds] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    Promise.all(q.accounts.map((address) => client.getBalance({ address }))),
    Promise.all(q.holders.map((a) => client.readContract({ address: USDC_ADDRESS, abi: demoUsdcAbi, functionName: "balanceOf", args: [a] }))),
    q.spaceId === null ? null : client.readContract({ ...read, functionName: "getSpace", args: [q.spaceId] }),
    q.spaceId === null ? [] : client.readContract({ ...read, functionName: "poolIdsOf", args: [q.spaceId] }),
  ]);
  const base = {
    chainSkew: Number(block.timestamp) - Date.now() / 1000,
    space: space && {
      steward: space.steward,
      feeRecipient: space.feeRecipient,
      votingSeconds: space.votingPeriod,
      totalPower: space.totalPower,
    },
    poolIds: [...poolIds],
    eth: record(q.accounts, eth),
    usdc: record(q.holders, usdc),
  };
  const poolId = q.poolId ?? poolIds.at(-1) ?? null;
  if (q.spaceId === null || poolId === null) return { ...base, pool: null, pledges: {}, ballots: {}, power: {} };

  const pool = await readPool(client, poolId);
  const voters = pool.status === "voting" || pool.closure.open ? q.voters : [];
  const [pledges, ballots, power] = await Promise.all([
    Promise.all(q.funders.map((f) => client.readContract({ ...read, functionName: "pledgeOf", args: [poolId, f] }))),
    Promise.all(voters.map((v) => client.readContract({ ...read, functionName: "ballotOf", args: [poolId, pool.round, v] }))),
    Promise.all(voters.map((v) => client.readContract({ ...read, functionName: "powerOf", args: [pool.spaceId, v, pool.domain] }))),
  ]);
  return {
    ...base,
    pool,
    pledges: record(q.funders, pledges),
    ballots: record(
      voters,
      ballots.map((b) => ({ choice: CHOICES[b.choice] ?? null, power: b.power })),
    ),
    power: record(voters, power),
  };
}

// Everything the pools pages show for one sandbox space: every pool, who pledged what, the Points of
// the known voters and their ballots on the votes that are open. Two batched round trips.
export interface SpaceSnapshot {
  // Seconds to add to the local clock to get block time.
  chainSkew: number;
  space: SpaceView | null;
  pools: PoolView[];
  eth: Record<Address, bigint>;
  usdc: Record<Address, bigint>;
  points: Record<Address, Points>;
  // By pool id, then by account.
  pledges: Record<string, Record<Address, bigint>>;
  ballots: Record<string, Record<Address, BallotView>>;
}

export interface SpaceQuery {
  spaceId: bigint | null;
  accounts: readonly Address[];
  holders: readonly Address[];
  funders: readonly Address[];
  voters: readonly Address[];
}

export const openVoteOf = (pool: PoolView): TallyView | null =>
  pool.status === "voting" ? pool.listing : pool.status === "building" && pool.closure.open ? pool.closure : null;

export async function readSpaceSnapshot(client: ChainClient, q: SpaceQuery): Promise<SpaceSnapshot> {
  await assertChain(client);
  const read = { address: POOLS_ADDRESS, abi: pooledFundingAbi } as const;
  const spaceId = q.spaceId;
  const [block, eth, usdc, space, poolIds, points] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    Promise.all(q.accounts.map((address) => client.getBalance({ address }))),
    Promise.all(q.holders.map((a) => client.readContract({ address: USDC_ADDRESS, abi: demoUsdcAbi, functionName: "balanceOf", args: [a] }))),
    spaceId === null ? null : client.readContract({ ...read, functionName: "getSpace", args: [spaceId] }),
    spaceId === null ? [] : client.readContract({ ...read, functionName: "poolIdsOf", args: [spaceId] }),
    spaceId === null ? [] : Promise.all(q.voters.map((v) => client.readContract({ ...read, functionName: "pointsOf", args: [spaceId, v] }))),
  ]);
  const pools = await Promise.all(poolIds.map((id) => readPool(client, id)));
  const voting = pools.filter((p) => openVoteOf(p) !== null);
  const [pledges, ballots] = await Promise.all([
    Promise.all(pools.map((p) => Promise.all(q.funders.map((f) => client.readContract({ ...read, functionName: "pledgeOf", args: [p.id, f] }))))),
    Promise.all(voting.map((p) => Promise.all(q.voters.map((v) => client.readContract({ ...read, functionName: "ballotOf", args: [p.id, p.round, v] }))))),
  ]);
  return {
    chainSkew: Number(block.timestamp) - Date.now() / 1000,
    space: space && { steward: space.steward, feeRecipient: space.feeRecipient, votingSeconds: space.votingPeriod, totalPower: space.totalPower },
    pools,
    eth: record(q.accounts, eth),
    usdc: record(q.holders, usdc),
    points: record(
      spaceId === null ? [] : q.voters,
      points.map((p) => [p[0], p[1], p[2], p[3]] as Points),
    ),
    pledges: Object.fromEntries(pools.map((p, i) => [p.id.toString(), record(q.funders, pledges[i])])),
    ballots: Object.fromEntries(
      voting.map((p, i) => [
        p.id.toString(),
        record(
          q.voters,
          ballots[i].map((b) => ({ choice: CHOICES[b.choice] ?? null, power: b.power })),
        ),
      ]),
    ),
  };
}
