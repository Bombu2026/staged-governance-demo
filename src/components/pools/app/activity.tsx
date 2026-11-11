import type { LogItem } from "../../event-log";

// The log of what happened, newest first. Refusals are marked; live entries link to their transaction.
export function Activity({ items, limit, empty, compact }: { items: LogItem[]; limit: number; empty: string; compact?: boolean }) {
  const shown = [...items].reverse().slice(0, limit);
  if (shown.length === 0) return <p className={`rounded-xl bg-surface text-[15px] leading-relaxed text-muted ${compact ? "p-4" : "p-6"}`}>{empty}</p>;
  return (
    <ol data-activity className="divide-y divide-line overflow-hidden rounded-xl bg-surface">
      {shown.map((e) => (
        <li key={e.seq} className={`${compact ? "px-4 py-3" : "px-5 py-4 sm:px-6"} ${e.refusal ? "border-l-[3px] border-l-danger bg-danger/8" : ""}`}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
            <span className="tabular-nums">{e.live ? e.live.time : e.stamp}</span>
            <span className="font-bold text-ink">{e.actor}</span>
            {e.refusal && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger">Refused</span>}
          </p>
          <p className={`mt-1 leading-snug ${compact ? "text-sm" : "text-[15px]"}`}>{e.text}</p>
          {e.refusal && <p className="mt-1 text-sm leading-snug text-danger">Why: {e.refusal}</p>}
          {e.live?.href && (
            <a href={e.live.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-mono text-xs text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-hover">
              {compact ? "View on BaseScan" : e.live.linkLabel}
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
