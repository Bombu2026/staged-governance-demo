import { EXPLORER_BASE, LAMPORTS_PER_SOL } from "./constants";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function shortenAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1 ? address : `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

function explorerUrl(kind: "tx" | "address", id: string): string {
  if (!BASE58.test(id)) throw new Error(`Not a base58 ${kind === "tx" ? "signature" : "address"}: ${id}`);
  return `${EXPLORER_BASE}/${kind}/${id}?cluster=devnet`;
}

export const explorerTxUrl = (signature: string) => explorerUrl("tx", signature);
export const explorerAddressUrl = (address: string) => explorerUrl("address", address);

export function formatSol(lamports: number | bigint): string {
  const n = Number(lamports) / LAMPORTS_PER_SOL;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n !== 0 && Math.abs(n) < 0.001 ? 9 : 4 })} SOL`;
}
