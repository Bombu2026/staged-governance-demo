"use client";

import { type Dispatch, useState } from "react";
import {
  type Action,
  type Mode,
  type SignerId,
  type State,
  DEPOSIT_AMOUNT,
  MODE_LABEL,
  SIGNERS,
  THRESHOLD,
  TIMELOCK_HOURS,
  etaOf,
  formatAmount,
  signerLabel,
} from "@/lib/governance";
import { Timeline } from "./timeline";
import { ActionButton, Badge, Callout, Panel, SampleTag, bind } from "./ui";

const MODE_SPECS: Record<Mode, { keys: string; notice: string; pause: string }> = {
  today: { keys: "1 of 1", notice: "0 h", pause: "None" },
  proposed: { keys: `${THRESHOLD} of 3`, notice: `${TIMELOCK_HOURS} h`, pause: "Any 1 key, lifted by 2" },
};

const BIG_NUMBER = "font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl";
const ROW_LABEL = "font-mono text-[11px] font-bold uppercase tracking-wider text-muted";

export function StageUpgrade({ state, dispatch }: { state: State; dispatch: Dispatch<Action> }) {
  const act = bind(state, dispatch);
  return (
    <div className="space-y-6">
      <p className="max-w-prose text-lg leading-relaxed">
        Today a single owner-held key can replace the escrow logic of the vaults that hold funders&apos; money, and the
        change is live the moment it is signed. The proposal puts upgrades behind a <span className="whitespace-nowrap">2-of-3</span> multisig and a 48 h timelock,
        so one stolen key cannot act alone and funders always see a change coming before it lands.
      </p>

      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Upgrade setup">
        {(["today", "proposed"] as const).map((mode) => {
          const active = state.mode === mode;
          const spec = MODE_SPECS[mode];
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              onClick={() => !active && dispatch({ type: "setMode", mode })}
              className={`rounded-xl p-5 text-left transition-colors motion-reduce:transition-none sm:p-6 ${
                active ? "bg-surface ring-2 ring-inset ring-accent" : "ring-1 ring-inset ring-line-strong hover:bg-surface"
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-lg font-bold leading-snug">{MODE_LABEL[mode]}</span>
                <span
                  className={`mt-1 grid size-5 shrink-0 place-items-center rounded-full border-2 ${active ? "border-accent" : "border-line-strong"}`}
                >
                  {active && <span className="size-2.5 rounded-full bg-accent" />}
                </span>
              </span>
              <span className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <span className="text-muted">Keys to upgrade</span>
                <span className="font-mono">{spec.keys}</span>
                <span className="text-muted">Notice to funders</span>
                <span className={`font-mono font-bold ${mode === "today" ? "text-danger" : "text-warning"}`}>
                  {spec.notice}
                </span>
                <span className="text-muted">Emergency pause</span>
                <span className="font-mono">{spec.pause}</span>
              </span>
            </button>
          );
        })}
      </div>

      <Panel
        title="Simulated clock"
        meta={
          <>
            <ActionButton {...act({ type: "advanceClock", hours: 12 })}>+12 h</ActionButton>
            <ActionButton {...act({ type: "advanceClock", hours: 24 })}>+24 h</ActionButton>
          </>
        }
      >
        <p className={BIG_NUMBER}>
          Hour {state.clock}
          <span className="ml-3 text-sm font-medium tracking-normal text-muted">
            day {Math.floor(state.clock / 24) + 1}, {String(state.clock % 24).padStart(2, "0")}:00
          </span>
        </p>
        <Timeline state={state} />
      </Panel>

      <div className="grid gap-6 2xl:grid-cols-2">
        <VaultPanel state={state} act={act} />
        {state.mode === "today" ? (
          <SingleKeyPanel state={state} act={act} />
        ) : (
          <MultisigPanel state={state} act={act} />
        )}
      </div>
    </div>
  );
}

type Bound = ReturnType<typeof bind>;

function VaultPanel({ state, act }: { state: State; act: Bound }) {
  const { vault, upgrade, clock } = state;
  const total = vault.reserved + vault.free;
  const eta = etaOf(upgrade);
  return (
    <Panel
      title="Vault"
      meta={
        <>
          <SampleTag />
          {vault.paused ? <Badge tone="danger">Paused</Badge> : <Badge tone="success">Active</Badge>}
        </>
      }
    >
      <div>
        <p className={BIG_NUMBER}>
          {formatAmount(total)} <span className="text-base font-medium tracking-normal text-muted">USDC</span>
        </p>
        <p className="mt-1 text-sm text-muted">held in the vault</p>
      </div>

      <div className="flex h-4 overflow-hidden rounded-md bg-raised" aria-hidden="true">
        <div className="hatch text-faint" style={{ width: `${(vault.reserved / total) * 100}%` }} />
        <div className="bg-ink transition-[width] motion-reduce:transition-none" style={{ width: `${(vault.free / total) * 100}%` }} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <div>
          <dt className="flex items-center gap-1.5 text-muted">
            <span className="hatch inline-block size-3 shrink-0 rounded-[3px] bg-raised text-faint" />
            Reserved for approved awards
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums">{formatAmount(vault.reserved)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted">
            <span className="inline-block size-3 shrink-0 rounded-[3px] bg-ink" />
            Free funds
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums">{formatAmount(vault.free)}</dd>
        </div>
        <div>
          <dt className="text-muted">Withdrawn by funders</dt>
          <dd className="mt-0.5 font-mono tabular-nums">{formatAmount(vault.withdrawn)}</dd>
        </div>
        <div>
          <dt className="text-muted">Escrow logic</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono">v{vault.version}</span>
            {vault.compromised ? <Badge tone="danger">Attacker-written</Badge> : <Badge>Team-written</Badge>}
          </dd>
        </div>
      </dl>

      {eta !== null && upgrade && (
        <Callout tone="warning" title={clock < eta ? `Exit window open: ${eta - clock} h left` : "Exit window elapsed"}>
          {clock < eta
            ? `v${upgrade.to} is queued and cannot execute before hour ${eta}. A funder who disagrees can withdraw free funds now; reserved funds stay for approved awards.`
            : `v${upgrade.to} passed its ETA and can execute at any moment. Withdrawing still works until it does.`}
        </Callout>
      )}

      <div className="border-t border-line pt-5">
        <p className={`mb-3 ${ROW_LABEL}`}>Funder actions</p>
        <div className="flex flex-wrap items-start gap-2">
          <ActionButton variant={eta !== null ? "primary" : "secondary"} {...act({ type: "withdraw" })}>
            Withdraw free funds
          </ActionButton>
          <ActionButton {...act({ type: "deposit" })}>Deposit {formatAmount(DEPOSIT_AMOUNT)}</ActionButton>
        </div>
      </div>
    </Panel>
  );
}

function SingleKeyPanel({ state, act }: { state: State; act: Bound }) {
  const last = state.history[state.history.length - 1];
  const shown = last?.mode === "today" ? last : null;
  return (
    <Panel title="Upgrade control" meta={<SampleTag />}>
      <div>
        <p className="text-lg font-bold">Owner key</p>
        <p className="mt-1 text-sm text-muted">One key decides. No second signer, no delay, no pause.</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <ActionButton variant="primary" {...act({ type: "ownerUpgrade" })}>
          Upgrade escrow logic to v{state.vault.version + 1}
        </ActionButton>
        <ActionButton variant="danger" {...act({ type: "stealOwnerKey" })}>
          Simulate a stolen key
        </ActionButton>
      </div>
      {shown &&
        (shown.stolen ? (
          <Callout tone="danger" title={`Stolen key: v${shown.to} live at hour ${shown.closedAt}`}>
            The attacker signed with the owner key and the new escrow logic took effect in the same instant. Funders had
            no window to react: by the time anyone could see the change, it already governed every dollar in the vault.
          </Callout>
        ) : (
          <Callout tone="neutral" title={`v${shown.to} live at hour ${shown.closedAt}`}>
            The owner key signed and the upgrade took effect at once, with 0 h notice to funders. Had this key been stolen,
            the result would have looked exactly the same.
          </Callout>
        ))}
    </Panel>
  );
}

function MultisigPanel({ state, act }: { state: State; act: Bound }) {
  const { upgrade, vault, clock } = state;
  const [stolenKey, setStolenKey] = useState<SignerId>("A");
  const eta = etaOf(upgrade);
  const last = state.history[state.history.length - 1];

  return (
    <Panel
      title="Upgrade control"
      meta={
        <>
          <SampleTag />
          <Badge tone="accent">
            {THRESHOLD} of 3 · {TIMELOCK_HOURS} h
          </Badge>
        </>
      }
    >
      {upgrade ? (
        <div className="space-y-4 rounded-lg bg-canvas p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-lg font-bold">
              v{vault.version} → v{upgrade.to}
            </p>
            {upgrade.queuedAt === null ? (
              <Badge tone="warning">
                Pending {upgrade.approvals.length}/{THRESHOLD}
              </Badge>
            ) : (
              <Badge tone="accent">Queued</Badge>
            )}
            {upgrade.stolen && <Badge tone="danger">Stolen key</Badge>}
          </div>
          <p className="text-sm text-muted">
            {upgrade.stolen ? `Proposed with a stolen copy of ${signerLabel(upgrade.proposer)}` : `Proposed by ${signerLabel(upgrade.proposer)}`}{" "}
            at hour {upgrade.proposedAt}.
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">Approvals</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-mono">
                {SIGNERS.map((s) => (
                  <span
                    key={s.id}
                    title={s.label}
                    className={`grid size-7 place-items-center rounded-md text-xs font-bold ${
                      upgrade.approvals.includes(s.id) ? "bg-accent text-on-accent" : "text-muted ring-1 ring-inset ring-line-strong"
                    }`}
                  >
                    {s.id}
                  </span>
                ))}
                <span className="ml-1 whitespace-nowrap">
                  {upgrade.approvals.length} of {THRESHOLD}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Cancel votes</dt>
              <dd className="mt-1 font-mono leading-7">
                {upgrade.cancels.length} of {THRESHOLD}
              </dd>
            </div>
          </dl>
          {eta !== null && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-3xl font-bold tabular-nums tracking-tight text-warning">
                {clock < eta ? `${eta - clock} h` : "ETA reached"}
              </span>
              <span className="text-sm text-muted">
                {clock < eta ? `until ETA at hour ${eta}` : `at hour ${eta}`}
              </span>
            </div>
          )}
          <ActionButton variant="primary" {...act({ type: "execute" })}>
            Execute upgrade
          </ActionButton>
          {upgrade.stolen && upgrade.queuedAt === null && (
            <Callout tone="danger" title="One stolen key is not enough">
              The attacker holds a single key, so this proposal sits at 1 of {THRESHOLD} approvals and can never queue
              alone. Any two of the other keys can cancel it, and no funds or logic have changed.
            </Callout>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas p-4 text-sm sm:p-5">
          <span className="text-muted">No upgrade in flight.</span>
          {last?.mode === "proposed" && (
            <>
              <Badge tone={last.outcome === "executed" ? "success" : "neutral"}>
                {last.outcome === "executed" ? "Executed" : "Cancelled"}
              </Badge>
              <span>
                v{last.to} {last.outcome} at hour {last.closedAt}
                {last.outcome === "executed" && last.queuedAt !== null
                  ? `, ${last.closedAt - last.queuedAt} h after it was queued.`
                  : "."}
              </span>
            </>
          )}
        </div>
      )}

      <ul className="divide-y divide-line border-y border-line">
        {SIGNERS.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 px-2 py-[18px] @xl:flex-row @xl:items-start @xl:justify-between">
            <div className="min-w-0">
              <p className="font-bold">{s.label}</p>
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {upgrade?.approvals.includes(s.id) && <Badge tone="accent">Approved</Badge>}
                {upgrade?.cancels.includes(s.id) && <Badge tone="neutral">Cancel vote</Badge>}
                {vault.pausedBy === s.id && <Badge tone="danger">Paused vault</Badge>}
                {vault.unpauseVotes.includes(s.id) && <Badge tone="success">Unpause vote</Badge>}
                {upgrade?.stolen && upgrade.proposer === s.id && <Badge tone="danger">Key stolen</Badge>}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-2 @xl:justify-end">
              {!upgrade && (
                <ActionButton {...act({ type: "propose", signer: s.id, stolen: false })}>
                  Propose v{vault.version + 1}
                </ActionButton>
              )}
              {upgrade && upgrade.queuedAt === null && (
                <ActionButton {...act({ type: "approve", signer: s.id })}>Approve</ActionButton>
              )}
              {upgrade && <ActionButton {...act({ type: "cancel", signer: s.id })}>Cancel</ActionButton>}
              {vault.paused ? (
                <ActionButton {...act({ type: "unpause", signer: s.id })}>Unpause</ActionButton>
              ) : (
                <ActionButton variant="danger" {...act({ type: "pause", signer: s.id })}>
                  Pause
                </ActionButton>
              )}
            </div>
          </li>
        ))}
      </ul>

      {vault.paused && vault.pausedBy && (
        <Callout tone="danger" title={`Paused by ${signerLabel(vault.pausedBy)}`}>
          Deposits and upgrade execution are blocked, while withdrawals of free funds still work. The pause itself changed
          no logic and no balance. Unpause votes: {vault.unpauseVotes.length} of {THRESHOLD}.
        </Callout>
      )}

      <div className="space-y-4 rounded-lg bg-canvas p-4 sm:p-5">
        <div>
          <p className="font-bold">Simulate a stolen key</p>
          <p className="mt-1 text-sm text-muted">
            An attacker obtains one signer key and tries to push their own escrow logic with it.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <span className="text-muted">Stolen key</span>
            <select
              value={stolenKey}
              onChange={(e) => setStolenKey(e.target.value as SignerId)}
              className="min-h-11 rounded-md border border-input-border bg-raised px-3 text-ink"
            >
              {SIGNERS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <ActionButton variant="danger" {...act({ type: "propose", signer: stolenKey, stolen: true })}>
            Simulate a stolen key
          </ActionButton>
        </div>
      </div>
    </Panel>
  );
}
