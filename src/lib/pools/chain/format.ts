import { EXPLORER_BASE } from "./constants";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function shortenAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 3 ? address : `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

export function explorerTxUrl(hash: string): string {
  if (!HASH.test(hash)) throw new Error(`Not a transaction hash: ${hash}`);
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  if (!ADDRESS.test(address)) throw new Error(`Not an address: ${address}`);
  return `${EXPLORER_BASE}/address/${address}`;
}

// 1234500000000000n -> "0.001235 ETH"
export function formatEth(wei: bigint): string {
  const n = Number(wei) / 1e18;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && Math.abs(n) < 0.0001 ? 9 : 6 })} ETH`;
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
