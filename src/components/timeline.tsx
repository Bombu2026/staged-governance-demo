import { type State, THRESHOLD, etaOf } from "@/lib/governance";

const STEPS = [12, 24, 48, 96, 192, 384, 768];

function anchor(pct: number) {
  if (pct < 8) return "translate-x-0";
  if (pct > 92) return "-translate-x-full";
  return "-translate-x-1/2";
}

export function Timeline({ state }: { state: State }) {
  const { clock, upgrade, history, vault } = state;
  const eta = etaOf(upgrade);
  const end = Math.max(72, Math.ceil((Math.max(clock, eta ?? 0) + 12) / 24) * 24);
  const step = STEPS.find((s) => end / s <= 6) ?? STEPS[STEPS.length - 1];
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  const pct = (h: number) => (h / end) * 100;

  const executed = history.filter((h) => h.outcome === "executed");
  const points = new Map<number, typeof executed>();
  for (const record of executed) points.set(record.closedAt, [...(points.get(record.closedAt) ?? []), record]);

  return (
    <figure className="space-y-3">
      <div className="relative h-[104px] select-none" aria-hidden="true">
        <div className="absolute inset-x-0 top-[38px] h-px bg-line-strong" />
        <div className="absolute left-0 top-[36px] h-[5px] rounded-full bg-ink/25" style={{ width: `${pct(clock)}%` }} />

        {executed
          .filter((r) => r.queuedAt !== null && r.closedAt > r.queuedAt)
          .map((r) => (
            <div
              key={`band-${r.to}-${r.closedAt}`}
              className="hatch absolute top-[24px] h-[30px] border-x border-warning/40 text-warning/30"
              style={{ left: `${pct(r.queuedAt ?? 0)}%`, width: `${pct(r.closedAt - (r.queuedAt ?? 0))}%` }}
            />
          ))}

        {upgrade && upgrade.queuedAt !== null && eta !== null && (
          <>
            <div
              className="hatch absolute top-[22px] flex h-[34px] items-start overflow-hidden border-x-2 border-warning bg-warning/12 text-warning/40"
              style={{ left: `${pct(upgrade.queuedAt)}%`, width: `${pct(eta - upgrade.queuedAt)}%` }}
            >
              <span className="m-1 whitespace-nowrap rounded-[3px] bg-surface px-1 font-mono text-[10px] font-bold uppercase tracking-wider text-warning">
                Exit window
              </span>
            </div>
            <div
              className="absolute top-[22px] h-[34px] bg-warning/25"
              style={{ left: `${pct(upgrade.queuedAt)}%`, width: `${pct(Math.min(clock, eta) - upgrade.queuedAt)}%` }}
            />
            <span
              className={`absolute top-[60px] whitespace-nowrap font-mono text-[11px] font-bold text-warning ${anchor(pct(eta))}`}
              style={{ left: `${pct(eta)}%` }}
            >
              ETA h{eta}
            </span>
          </>
        )}

        {upgrade && upgrade.queuedAt === null && (
          <span
            className={`absolute top-[60px] whitespace-nowrap font-mono text-[11px] font-bold ${upgrade.stolen ? "text-danger" : "text-warning"} ${anchor(pct(upgrade.proposedAt))}`}
            style={{ left: `${pct(upgrade.proposedAt)}%` }}
          >
            v{upgrade.to} {upgrade.approvals.length}/{THRESHOLD}
          </span>
        )}

        {[...points.entries()].map(([hour, records]) => {
          const stolen = records.some((r) => r.stolen);
          const first = records[0];
          const lastRecord = records[records.length - 1];
          const label = first === lastRecord ? `v${first.to}` : `v${first.to}–v${lastRecord.to}`;
          const notice = lastRecord.closedAt - (lastRecord.queuedAt ?? lastRecord.closedAt);
          return (
            <div key={`pt-${hour}`}>
              <div
                className={`absolute top-[33px] size-[11px] -translate-x-1/2 rotate-45 border-2 ${stolen ? "border-danger bg-danger" : "border-ink bg-surface"}`}
                style={{ left: `${pct(hour)}%` }}
              />
              {!upgrade && (
                <span
                  className={`absolute top-[60px] whitespace-nowrap font-mono text-[11px] font-bold ${stolen ? "text-danger" : "text-ink"} ${anchor(pct(hour))}`}
                  style={{ left: `${pct(hour)}%` }}
                >
                  {label} · {notice} h notice
                </span>
              )}
            </div>
          );
        })}

        <div className="absolute top-[14px] h-[46px] w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${pct(clock)}%` }} />
        <span
          className={`absolute top-0 whitespace-nowrap font-mono text-[11px] font-bold text-ink ${anchor(pct(clock))}`}
          style={{ left: `${pct(clock)}%` }}
        >
          now h{clock}
        </span>

        {ticks.map((t) => (
          <div key={t} className="absolute top-[80px]" style={{ left: `${pct(t)}%` }}>
            <div className="h-1.5 w-px bg-line-strong" />
            <span className={`absolute top-2 whitespace-nowrap font-mono text-[10px] text-muted ${anchor(pct(t))}`}>{t} h</span>
          </div>
        ))}
      </div>
      <figcaption className="text-sm leading-relaxed text-muted">{caption(state, eta)}</figcaption>
      {vault.paused && upgrade && upgrade.queuedAt !== null && (
        <p className="text-sm text-danger">The vault is paused, so the queued upgrade cannot execute even after its ETA.</p>
      )}
    </figure>
  );
}

function caption({ clock, upgrade, mode, history }: State, eta: number | null) {
  if (upgrade && upgrade.queuedAt !== null && eta !== null) {
    return clock < eta
      ? `v${upgrade.to} was queued at hour ${upgrade.queuedAt}. It cannot execute before hour ${eta}: ${eta - clock} h left in the exit window.`
      : `v${upgrade.to} reached its ETA at hour ${eta} and can execute now.`;
  }
  if (upgrade) {
    return `v${upgrade.to} was proposed at hour ${upgrade.proposedAt} and waits for a second approval (${upgrade.approvals.length} of ${THRESHOLD}). Until it queues, its 48 h clock has not started.`;
  }
  const lastRecord = history[history.length - 1];
  if (mode === "today") {
    return lastRecord?.mode === "today"
      ? `v${lastRecord.to} took effect at hour ${lastRecord.closedAt}, in the same instant it was signed. The band where funders could react has zero width.`
      : "In this setup an upgrade has no queue: it takes effect the moment the owner key signs, so there is no window to draw.";
  }
  return "No upgrade in flight. A proposal needs 2 of 3 keys to queue, then waits 48 h before anyone can execute it.";
}
