import { Badge } from "./ui";

export interface LogItem {
  seq: number;
  // Simulated time of the entry, already formatted ("h012", "day 3").
  stamp: string;
  actor: string;
  text: string;
  refusal: string | null;
  // Present only on entries from a live testnet panel.
  live?: { network: string; time: string; href: string | null; linkLabel: string };
}

export function EventLog({ items, empty }: { items: LogItem[]; empty: string }) {
  const latest = items[items.length - 1];
  return (
    <aside aria-labelledby="log-title" className="min-w-0 lg:sticky lg:top-40 lg:self-start">
      <div className="rounded-xl bg-surface p-5 sm:p-8">
        <header className="flex items-center justify-between gap-2">
          <h2 id="log-title" className="text-[15px] font-bold text-muted">
            Event log
          </h2>
          <span className="font-mono text-xs font-medium tabular-nums text-muted">
            {items.length} {items.length === 1 ? "event" : "events"}
          </span>
        </header>
        <p className="mt-3 text-sm leading-snug text-muted">
          Every action lands here, refused ones included. Blocked buttons still take a click so you can read why.
        </p>
        {items.length === 0 ? (
          <p className="mt-4 border-t border-line px-2 py-[18px] text-[15px] leading-relaxed text-ink">{empty}</p>
        ) : (
          <ol className="mt-4 max-h-[26rem] overflow-y-auto border-t border-line lg:max-h-[calc(100dvh-23rem)]">
            {[...items].reverse().map((e) => (
              <li
                key={e.seq}
                className={`border-b border-l-[3px] border-b-line py-[18px] pl-3 pr-2 last:border-b-0 ${
                  e.refusal ? "border-l-danger bg-danger/8" : "border-l-transparent"
                }`}
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
                  {e.live ? (
                    <>
                      <Badge tone="accent">{e.live.network}</Badge>
                      <span className="font-medium tabular-nums">{e.live.time}</span>
                    </>
                  ) : (
                    <span className="font-medium tabular-nums">{e.stamp}</span>
                  )}
                  <span className="font-bold text-ink">{e.actor}</span>
                  {e.refusal && <Badge tone="danger">Refused</Badge>}
                </p>
                <p className="mt-1.5 text-[15px] leading-snug">{e.text}</p>
                {e.refusal && <p className="mt-1.5 text-sm leading-snug text-danger">Why: {e.refusal}</p>}
                {e.live?.href && (
                  <a
                    href={e.live.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block font-mono text-xs text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-hover"
                  >
                    {e.live.linkLabel}
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
