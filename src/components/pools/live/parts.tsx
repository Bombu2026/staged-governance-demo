import { explorerAddressUrl, explorerTxUrl, shortenAddress } from "@/lib/pools/chain/format";
import { External } from "../../devnet/parts";

export { External, Step, TxPreview, type PreviewLine } from "../../devnet/parts";

export function Address({ address }: { address: string }) {
  return (
    <External href={explorerAddressUrl(address)} className="font-mono text-[13px]">
      <span title={address}>{shortenAddress(address)}</span>
    </External>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <External href={explorerTxUrl(hash)} className="font-mono text-[13px]">
      {shortenAddress(hash, 6)} on BaseScan (Base Sepolia)
    </External>
  );
}
