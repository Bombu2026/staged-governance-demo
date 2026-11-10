import type { ReactNode } from "react";
import { explorerAddressUrl, explorerTxUrl, shortenAddress } from "@/lib/devnet/format";

const LINK = "underline decoration-line-strong underline-offset-[3px] hover:decoration-accent";

export function External({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK} ${className}`}>
      {children}
    </a>
  );
}

export function Address({ address }: { address: string }) {
  return (
    <External href={explorerAddressUrl(address)} className="font-mono text-[13px]">
      <span title={address}>{shortenAddress(address)}</span>
    </External>
  );
}

export function TxLink({ signature }: { signature: string }) {
  return (
    <External href={explorerTxUrl(signature)} className="font-mono text-[13px]">
      {shortenAddress(signature, 6)} on Solana Explorer (devnet)
    </External>
  );
}

export interface PreviewLine {
  program: string;
  action: string;
  detail: ReactNode;
}

export function TxPreview({ heading, signer, lines, note }: { heading: string; signer: string; lines: PreviewLine[]; note?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line-strong bg-canvas p-4 text-sm sm:p-5">
      <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted">{heading}</p>
      <p className="mt-1 text-muted">
        Signed by <span className="font-bold text-ink">{signer}</span>
      </p>
      <ol className="mt-3 space-y-2">
        {lines.map((line, i) => (
          <li key={i} className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[11rem_1fr]">
            <span className="font-mono text-[13px] text-muted">
              {i + 1}. {line.program}
            </span>
            <span>
              <span className="font-bold">{line.action}</span> {line.detail}
            </span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-3 leading-snug text-muted">{note}</p>}
    </div>
  );
}

export function Step({ n, title, state, children }: { n: number; title: string; state: "todo" | "active" | "done"; children?: ReactNode }) {
  return (
    <section className={`rounded-lg p-4 sm:p-5 ${state === "active" ? "bg-raised" : "bg-canvas"}`}>
      <header className="flex items-center gap-3">
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-bold ${
            state === "done" ? "bg-success/12 text-success" : state === "active" ? "bg-accent text-on-accent" : "text-muted ring-1 ring-inset ring-line-strong"
          }`}
        >
          {state === "done" ? "✓" : n}
        </span>
        <h4 className={`font-bold ${state === "todo" ? "text-muted" : ""}`}>{title}</h4>
      </header>
      {children && <div className="mt-4 space-y-4">{children}</div>}
    </section>
  );
}
