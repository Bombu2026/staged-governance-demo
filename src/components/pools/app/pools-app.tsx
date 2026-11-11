"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { CHAIN_NAME } from "@/lib/pools/chain/constants";
import type { Kind } from "@/lib/pools/sim";
import { SHELL, SiteFooter, SiteHeader } from "../../site-header";
import type { Toast } from "./engine";
import { HomeView } from "./home-view";
import { OpenPool } from "./open-pool";
import { PoolView } from "./pool-view";
import { SetupView } from "./setup-view";
import { useDemoEngine } from "./use-demo-engine";
import { useLive } from "./use-live";
import { WalletMenu } from "./wallet-menu";

type Route = { view: "home" } | { view: "pool"; id: number } | { view: "new"; kind: Kind | null };

function parse(hash: string): Route {
  const pool = /^#\/pool\/(\d{1,9})$/.exec(hash);
  if (pool) return { view: "pool", id: Number(pool[1]) };
  const fresh = /^#\/new(?:\/(request|proposal))?$/.exec(hash);
  if (fresh) return { view: "new", kind: (fresh[1] as Kind | undefined) ?? null };
  return { view: "home" };
}

const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

// The page's location lives in the hash, so the back button works and the site stays a static export.
function useRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  return parse(hash);
}

const go = (hash: string) => {
  window.location.hash = hash;
};

const TOAST_TONE: Record<Toast["tone"], string> = {
  neutral: "border-line-strong",
  accent: "border-accent",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
};

function Toasts({ toast, busy, onDismiss }: { toast: Toast | null; busy: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, toast.tone === "danger" ? 14_000 : 8_000);
    return () => clearTimeout(timer);
    // The timer restarts for each new toast only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex flex-col items-start gap-3 sm:inset-x-auto sm:bottom-6 sm:left-6">
      {busy && (
        <p role="status" className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border border-accent bg-surface px-4 py-3 text-[15px] font-bold shadow-[0_18px_50px_rgba(0,0,0,0.5)]">
          <span aria-hidden="true" className="size-3 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          {busy}
        </p>
      )}
      {toast && (
        <div role="status" className={`pointer-events-auto w-full max-w-sm rounded-xl border-l-4 bg-surface px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.5)] ${TOAST_TONE[toast.tone]}`}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[15px] font-bold">{toast.title}</p>
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink">
              ×
            </button>
          </div>
          <p className="mt-0.5 text-sm leading-snug text-muted">{toast.text}</p>
          {toast.href && (
            <a href={toast.href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block font-mono text-xs text-accent underline decoration-accent/40 underline-offset-2">
              View on BaseScan
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function PoolsApp() {
  const demo = useDemoEngine();
  const live = useLive();
  const route = useRoute();
  const connected = live.wallet !== null;
  const engine = connected ? live.engine : demo.engine;

  // Pools are numbered differently in the sample data and on the contract, so switching goes home.
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (wasConnected.current !== connected) {
      wasConnected.current = connected;
      go("#/");
    }
  }, [connected]);

  // Each screen starts at its top, including the board that follows the sandbox setup.
  const key = !engine ? "setup" : route.view === "pool" ? `pool-${route.id}` : route.view;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [key]);

  const pool = engine && route.view === "pool" ? engine.pools.find((p) => p.id === route.id) : undefined;
  const toast = engine ? engine.toast : live.toast;
  const dismiss = engine ? engine.dismissToast : live.dismissToast;
  const busy = engine ? engine.busy : live.busy ? `${live.busy.label}: ${live.busy.stage === "wallet" ? "confirm in your wallet" : `waiting for ${CHAIN_NAME}`}` : null;
  const modeLine = connected
    ? `Live on ${CHAIN_NAME}, in your own sandbox${live.spaceId === null ? "" : ` (space #${live.spaceId})`}. Testnet ETH and demo USDC have no value.`
    : `Sample data: you act as ${demo.persona}. Connect a wallet, top right, to run the same rules on ${CHAIN_NAME}.`;

  return (
    <>
      <SiteHeader current="pools">
        <WalletMenu live={live} persona={demo.persona} onPersona={demo.setPersona} balanceOf={demo.walletOf} onReset={demo.reset} />
      </SiteHeader>

      <main className={SHELL}>
        {!engine ? (
          <SetupView live={live} />
        ) : route.view === "new" ? (
          <OpenPool key={`${engine.mode}-${engine.me.name}`} engine={engine} initial={route.kind} onDone={(id) => go(`#/pool/${id}`)} />
        ) : route.view === "pool" && pool ? (
          <PoolView key={`${engine.mode}-${pool.id}`} engine={engine} pool={pool} />
        ) : route.view === "pool" ? (
          <div className="py-24 text-center">
            <p className="text-xl font-bold">Pool #{route.id} is not here</p>
            <p className="mt-2 text-muted">{engine.mode === "live" ? "It may still be confirming, or it belongs to another sandbox." : "The sample data has no pool with this number."}</p>
            <a href="#/" className="mt-6 inline-block font-bold underline decoration-line-strong underline-offset-4">
              All pools
            </a>
          </div>
        ) : (
          <HomeView engine={engine} modeLine={modeLine} />
        )}
      </main>

      <SiteFooter>
        <p className="mt-1">
          Companies, contributors, wallets and Points are sample data. The sample state lives only in this tab. On {CHAIN_NAME}, the demo keys that play the other people are generated in this tab and
          hold testnet gas only. The contracts are not audited.
        </p>
      </SiteFooter>
      <Toasts toast={toast} busy={busy} onDismiss={dismiss} />
    </>
  );
}
