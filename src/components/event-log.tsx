import { explorerTxUrl } from "@/lib/devnet/format";
import type { LogEntry } from "@/lib/governance";
import { Badge } from "./ui";

const hour = (h: number) => `h${String(h).padStart(3, "0")}`;

export function EventLog({ log }: { log: LogEntry[] }) {
  const latest = log[log.length - 1];
  return (
    <aside aria-labelledby="log-title" className="min-w-0 lg:sticky lg:top-40 lg:self-start">
      <div className="rounded-xl bg-surface p-5 sm:p-8">
        <header className="flex items-center justify-between gap-2">
          <h2 id="log-title" className="text-[15px] font-bold text-muted">
            Event log
          </h2>
          <span className="font-mono text-xs font-medium tabular-nums text-muted">
            {log.length} {log.length === 1 ? "event" : "events"}
          </span>
        </header>
        <p className="mt-3 text-sm leading-snug text-muted">
          Every action lands here, refused ones included. Blocked buttons still take a click so you can read why.
        </p>
        {log.length === 0 ? (
          <p className="mt-4 border-t border-line px-2 py-[18px] text-[15px] leading-relaxed text-ink">
            Nothing yet. Start in stage 1: try an upgrade with the single key, then switch to the proposed setup.
          </p>
        ) : (
          <ol className="mt-4 max-h-[26rem] overflow-y-auto border-t border-line lg:max-h-[calc(100dvh-23rem)]">
            {[...log].reverse().map((e) => (
              <li
                key={e.seq}
                className={`border-b border-l-[3px] border-b-line py-[18px] pl-3 pr-2 last:border-b-0 ${
                  e.refusal ? "border-l-danger bg-danger/8" : "border-l-transparent"
                }`}
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
                  {e.devnet ? (
                    <>
                      <Badge tone="accent">Devnet</Badge>
                      <span className="font-medium tabular-nums">{e.devnet.time}</span>
                    </>
                  ) : (
                    <span className="font-medium tabular-nums">{hour(e.hour)}</span>
                  )}
                  <span className="font-bold text-ink">{e.actor}</span>
                  {e.refusal && <Badge tone="danger">Refused</Badge>}
                </p>
                <p className="mt-1.5 text-[15px] leading-snug">{e.text}</p>
                {e.refusal && <p className="mt-1.5 text-sm leading-snug text-danger">Why: {e.refusal}</p>}
                {e.devnet?.signature && (
                  <a
                    href={explorerTxUrl(e.devnet.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block font-mono text-xs text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-hover"
                  >
                    View transaction on Solana Explorer (devnet)
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="sr-only" aria-live="polite">
          {latest ? `${latest.actor}: ${latest.refusal ? `refused, ${latest.refusal}` : latest.text}` : ""}
        </p>
      </div>
    </aside>
  );
}
